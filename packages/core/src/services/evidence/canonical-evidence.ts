import { createHash } from "crypto";
import { z } from "zod";
import type { Pool } from "pg";

import { stableJsonStringify } from "../../lib/stable-json";
import type { Evidence } from "./service";

export const EvidenceItemSchema = z.object({
	evidence_id: z.string(),
	deal_id: z.string().uuid(),

	source_type: z.string(),
	source_path: z.string(),

	source_document_id: z.string().uuid().nullable().optional(),
	source_visual_asset_id: z.string().uuid().nullable().optional(),
	source_understanding_patch_id: z.string().uuid().nullable().optional(),

	tags: z.array(z.string()).default([]),
	confidence: z.number().min(0).max(1).default(0.5),
	extracted_at: z.string(),

	content_text: z.string().nullable().optional(),
	content_json: z.unknown().nullable().optional(),
	meta: z.record(z.unknown()).default({}),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidencePacketOmissionSchema = z.object({
	evidence_id: z.string(),
	source_path: z.string().optional(),
	reason: z.string(),
});

export type EvidencePacketOmission = z.infer<typeof EvidencePacketOmissionSchema>;

export const EvidencePacketSchema = z.object({
	packet_id: z.string(),
	deal_id: z.string().uuid(),	
	purpose: z.string(),
	created_at: z.string(),
	config: z.record(z.unknown()).default({}),
	selected: z.array(EvidenceItemSchema),
	omitted: z.array(EvidencePacketOmissionSchema).default([]),
});

export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;

export type IngestResult = {
	inserted: number;
	updated: number;
	skipped: number;
	warnings: string[];
};

export type IngestExistingArtifactsOptions = {
	maxDocs?: number;
	maxDocChunks?: number;
	// Optional provenance linkage (only written when the DB columns exist).
	run_id?: string | null;
	step_run_id?: string | null;
};

export type EvidencePacketSelectionConfig = {
	minConfidence?: number;
	maxItems?: number;
	preferTags?: string[];
	maxOmissions?: number;
};

export interface CanonicalEvidenceService {
	ingestExistingArtifacts(deal_id: string, opts?: IngestExistingArtifactsOptions): Promise<IngestResult>;
	getEvidencePacket(deal_id: string, purpose: string, config?: EvidencePacketSelectionConfig): Promise<EvidencePacket>;
	listEvidenceItems(deal_id: string, opts?: { limit?: number }): Promise<EvidenceItem[]>;

	// Back-compat helper: map selected EvidenceItems into the legacy Evidence shape
	toLegacyEvidence(items: EvidenceItem[]): Evidence[];
}

export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/[\t ]+/g, " ")
		.replace(/\n[\t ]+/g, "\n")
		.replace(/[\t ]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function computeEvidenceId(seed: {
	deal_id: string;
	source_type: string;
	source_path: string;
	content_text?: string | null;
	content_json?: unknown;
	tags?: string[];
}): string {
	const tags = Array.from(new Set((seed.tags ?? []).map(String))).sort();
	const payload = stableJsonStringify({
		deal_id: seed.deal_id,
		source_type: seed.source_type,
		source_path: seed.source_path,
		content_text: seed.content_text ? normalizeText(seed.content_text) : null,
		content_json: seed.content_json ?? null,
		tags,
	});
	return `ev_${sha256Hex(payload).slice(0, 32)}`;
}

export function computePacketId(seed: {
	deal_id: string;
	purpose: string;
	config: EvidencePacketSelectionConfig;
	selected_ids: string[];
}): string {
	const payload = stableJsonStringify({
		deal_id: seed.deal_id,
		purpose: seed.purpose,
		config: seed.config,
		selected_ids: seed.selected_ids,
	});
	return `pkt_${sha256Hex(payload).slice(0, 32)}`;
}

function chunkTextByParagraphs(text: string, opts: { minLen: number; maxLen: number; maxChunks: number }): string[] {
	const normalized = normalizeText(text);
	if (!normalized) return [];

	const paras = normalized.split(/\n\n+/g).map((p) => p.trim()).filter(Boolean);
	const chunks: string[] = [];

	let buf = "";
	const pushBuf = () => {
		const s = buf.trim();
		if (s.length >= opts.minLen) chunks.push(s);
		buf = "";
	};

	for (const p of paras) {
		if (chunks.length >= opts.maxChunks) break;
		if (!buf) {
			buf = p;
			continue;
		}
		if ((buf + "\n\n" + p).length <= opts.maxLen) {
			buf = buf + "\n\n" + p;
		} else {
			pushBuf();
			buf = p;
		}
	}
	if (chunks.length < opts.maxChunks) pushBuf();
	return chunks.slice(0, opts.maxChunks);
}

export function selectEvidenceForPacket(
	items: EvidenceItem[],
	config: Required<Pick<EvidencePacketSelectionConfig, "minConfidence" | "maxItems" | "preferTags" | "maxOmissions">>
): { selected: EvidenceItem[]; omitted: EvidencePacketOmission[] } {
	const prefer = new Set(config.preferTags.map((t) => String(t).toLowerCase()));

	const scored = items.map((it) => {
		const tags = (it.tags ?? []).map((t) => String(t).toLowerCase());
		const tagMatch = prefer.size === 0 ? 0 : tags.some((t) => prefer.has(t)) ? 1 : 0;
		return { it, tagMatch };
	});

	const comparator = (a: { it: EvidenceItem; tagMatch: number }, b: { it: EvidenceItem; tagMatch: number }) => {
		if (a.tagMatch !== b.tagMatch) return b.tagMatch - a.tagMatch;
		if ((a.it.confidence ?? 0) !== (b.it.confidence ?? 0)) return (b.it.confidence ?? 0) - (a.it.confidence ?? 0);
		const at = String(a.it.extracted_at ?? "");
		const bt = String(b.it.extracted_at ?? "");
		if (at !== bt) return bt.localeCompare(at);
		return String(a.it.evidence_id).localeCompare(String(b.it.evidence_id));
	};

	const eligible = scored.filter((s) => (s.it.confidence ?? 0) >= config.minConfidence).sort(comparator);
	const ineligible = scored.filter((s) => (s.it.confidence ?? 0) < config.minConfidence).sort(comparator);

	const selected = eligible.slice(0, config.maxItems).map((s) => s.it);
	const selectedIds = new Set(selected.map((s) => s.evidence_id));

	const omitted: EvidencePacketOmission[] = [];
	for (const s of eligible) {
		if (omitted.length >= config.maxOmissions) break;
		if (selectedIds.has(s.it.evidence_id)) continue;
		omitted.push({ evidence_id: s.it.evidence_id, source_path: s.it.source_path, reason: "not_selected" });
	}
	for (const s of ineligible) {
		if (omitted.length >= config.maxOmissions) break;
		omitted.push({ evidence_id: s.it.evidence_id, source_path: s.it.source_path, reason: "below_min_confidence" });
	}

	return { selected, omitted };
}

export class CanonicalEvidenceServiceImpl implements CanonicalEvidenceService {
	constructor(private readonly pool: Pool) {}

	private evidenceItemsWriteShape:
		| { hasRunId: boolean; hasStepRunId: boolean; hasUpdatedAtTrigger: boolean }
		| null = null;

	private async getEvidenceItemsWriteShape(): Promise<{
		hasRunId: boolean;
		hasStepRunId: boolean;
		hasUpdatedAtTrigger: boolean;
	}> {
		if (this.evidenceItemsWriteShape) return this.evidenceItemsWriteShape;
		try {
			const { rows } = await this.pool.query<{ column_name: string }>(
				`SELECT column_name
				   FROM information_schema.columns
				  WHERE table_schema = 'public'
				    AND table_name = 'evidence_items'`
			);
			const cols = new Set(rows.map((r) => r.column_name));

			let hasUpdatedAtTrigger = false;
			try {
				const trg = await this.pool.query(
					`SELECT 1
					   FROM pg_trigger t
					   JOIN pg_class c ON c.oid = t.tgrelid
					   JOIN pg_namespace n ON n.oid = c.relnamespace
					  WHERE n.nspname = 'public'
					    AND c.relname = 'evidence_items'
					    AND t.tgname = 'trg_evidence_items_set_updated_at'
					    AND NOT t.tgisinternal
					  LIMIT 1`
				);
				hasUpdatedAtTrigger = trg.rowCount === 1;
			} catch {
				hasUpdatedAtTrigger = false;
			}

			this.evidenceItemsWriteShape = {
				hasRunId: cols.has("run_id"),
				hasStepRunId: cols.has("step_run_id"),
				hasUpdatedAtTrigger,
			};
			return this.evidenceItemsWriteShape;
		} catch {
			this.evidenceItemsWriteShape = { hasRunId: false, hasStepRunId: false, hasUpdatedAtTrigger: false };
			return this.evidenceItemsWriteShape;
		}
	}

	toLegacyEvidence(items: EvidenceItem[]): Evidence[] {
		const nowIso = new Date().toISOString();
		return items.map((it) => ({
			evidence_id: it.evidence_id,
			deal_id: it.deal_id,
			source_type: (it.source_type as any) ?? "document",
			source: it.source_path,
			content: it.content_text ?? (it.content_json ? stableJsonStringify(it.content_json) : ""),
			confidence: typeof it.confidence === "number" ? it.confidence : 0.5,
			verified: false,
			extracted_at: it.extracted_at ?? nowIso,
			created_at: nowIso,
		})) as any;
	}

	async listEvidenceItems(deal_id: string, opts?: { limit?: number }): Promise<EvidenceItem[]> {
		const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
		const res = await this.pool.query(
			`SELECT evidence_id, deal_id::text as deal_id, source_type, source_path,
				source_document_id::text as source_document_id,
				source_visual_asset_id::text as source_visual_asset_id,
				source_understanding_patch_id::text as source_understanding_patch_id,
				tags, confidence,
				extracted_at::text as extracted_at,
				content_text,
				content_json,
				meta
			FROM evidence_items
			WHERE deal_id = $1
			ORDER BY confidence DESC, extracted_at DESC, evidence_id ASC
			LIMIT $2`,
			[deal_id, limit]
		);
		return res.rows.map((r: any) => EvidenceItemSchema.parse(r));
	}

	async ingestExistingArtifacts(deal_id: string, opts?: IngestExistingArtifactsOptions): Promise<IngestResult> {
		const result: IngestResult = { inserted: 0, updated: 0, skipped: 0, warnings: [] };

		// Best-effort: if tables aren’t present in a given env, fail open.
		try {
			await this.pool.query("SELECT 1 FROM evidence_items LIMIT 1");
		} catch (err: any) {
			result.warnings.push(`evidence_items_unavailable:${err?.code ?? "unknown"}`);
			return result;
		}

		const maxDocs = Math.max(1, Math.min(50, opts?.maxDocs ?? 25));
		const maxDocChunks = Math.max(1, Math.min(200, opts?.maxDocChunks ?? 50));
		const shape = await this.getEvidenceItemsWriteShape();

		const buildUpsert = (spec: {
			columns: string[];
			values: any[];
			conflictSetSqlParts: string[];
		}) => {
			const columns = [...spec.columns];
			const values = [...spec.values];
			const conflictSetSqlParts = [...spec.conflictSetSqlParts];

			// Preserve old behavior in pre-migration envs (no trigger) while avoiding reliance
			// on app-level updated_at when the trigger exists.
			if (!shape.hasUpdatedAtTrigger) {
				conflictSetSqlParts.unshift("updated_at = now()");
			}

			if (shape.hasRunId && opts?.run_id) {
				columns.push("run_id");
				values.push(opts.run_id);
				conflictSetSqlParts.push("run_id = COALESCE(evidence_items.run_id, EXCLUDED.run_id)");
			}
			if (shape.hasStepRunId && opts?.step_run_id) {
				columns.push("step_run_id");
				values.push(opts.step_run_id);
				conflictSetSqlParts.push(
					"step_run_id = COALESCE(evidence_items.step_run_id, EXCLUDED.step_run_id)"
				);
			}
			const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
			const sql = `INSERT INTO evidence_items (${columns.join(", ")}) VALUES (${placeholders})\nON CONFLICT (evidence_id) DO UPDATE SET\n${conflictSetSqlParts.join(",\n")}\nRETURNING (xmax = 0) as inserted`;
			return { sql, values };
		};

		// 1) Documents → paragraph chunks
		try {
			const docs = await this.pool.query(
				`SELECT id::text as id, deal_id::text as deal_id, title, type, full_text, uploaded_at
				 FROM documents
				 WHERE deal_id = $1 AND deleted_at IS NULL
				 ORDER BY uploaded_at DESC NULLS LAST, id DESC
				 LIMIT $2`,
				[deal_id, maxDocs]
			);

			for (const d of docs.rows as any[]) {
				const fullText = typeof d.full_text === "string" ? d.full_text : "";
				const chunks = chunkTextByParagraphs(fullText, { minLen: 120, maxLen: 1200, maxChunks: maxDocChunks });
				for (let i = 0; i < chunks.length; i++) {
					const source_path = `document:${d.id}:chunk:${i}`;
					const tags = ["document", "text", String(d.type ?? "")].filter(Boolean);
					const evidence_id = computeEvidenceId({
						deal_id,
						source_type: "document",
						source_path,
						content_text: chunks[i],
						tags,
					});
					const extracted_at = d.uploaded_at ? new Date(d.uploaded_at).toISOString() : new Date().toISOString();

					const { sql, values } = buildUpsert({
						columns: [
							"evidence_id",
							"deal_id",
							"source_type",
							"source_path",
							"source_document_id",
							"tags",
							"confidence",
							"extracted_at",
							"content_text",
							"content_json",
							"meta",
						],
						values: [
							evidence_id,
							deal_id,
							"document",
							source_path,
							d.id,
							tags,
							0.9,
							extracted_at,
							chunks[i],
							null,
							stableJsonStringify({ title: d.title ?? null, type: d.type ?? null }),
						],
						conflictSetSqlParts: [
							"confidence = GREATEST(evidence_items.confidence, EXCLUDED.confidence)",
							"tags = EXCLUDED.tags",
							"extracted_at = GREATEST(evidence_items.extracted_at, EXCLUDED.extracted_at)",
							"content_text = EXCLUDED.content_text",
							"meta = EXCLUDED.meta",
						],
					});

					const q = await this.pool.query(sql, values);

					const inserted = Boolean((q.rows?.[0] as any)?.inserted);
					if (inserted) result.inserted++;
					else result.updated++;
				}
			}
		} catch (err: any) {
			result.warnings.push(`documents_ingest_failed:${err?.code ?? "unknown"}`);
		}

		// 2) Understanding patches → evidence snippets (best-effort)
		try {
			const patches = await this.pool.query(
				`SELECT id::text as id, created_at, input_hash, patch_json
				 FROM understanding_patches
				 WHERE deal_id = $1
				 ORDER BY created_at DESC, id DESC
				 LIMIT 10`,
				[deal_id]
			);

			for (const p of patches.rows as any[]) {
				const pj = p.patch_json ?? null;
				const extracted_at = p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString();
				const source_path = `understanding_patch:${p.id}:input_hash:${String(p.input_hash ?? "")}`;
				const tags = ["understanding", "patch"].filter(Boolean);
				const evidence_id = computeEvidenceId({ deal_id, source_type: "understanding", source_path, content_json: pj, tags });

				const { sql, values } = buildUpsert({
					columns: [
						"evidence_id",
						"deal_id",
						"source_type",
						"source_path",
						"source_understanding_patch_id",
						"tags",
						"confidence",
						"extracted_at",
						"content_text",
						"content_json",
						"meta",
					],
					values: [
						evidence_id,
						deal_id,
						"understanding",
						source_path,
						p.id,
						tags,
						0.7,
						extracted_at,
						null,
						pj,
						stableJsonStringify({ input_hash: p.input_hash ?? null }),
					],
					conflictSetSqlParts: [
						"tags = EXCLUDED.tags",
						"extracted_at = GREATEST(evidence_items.extracted_at, EXCLUDED.extracted_at)",
						"content_json = EXCLUDED.content_json",
						"meta = EXCLUDED.meta",
					],
				});

				const q = await this.pool.query(sql, values);
				const inserted = Boolean((q.rows?.[0] as any)?.inserted);
				if (inserted) result.inserted++;
				else result.updated++;
			}
		} catch (err: any) {
			result.warnings.push(`understanding_ingest_failed:${err?.code ?? "unknown"}`);
		}

		// 3) Visual extractions → evidence summary per visual_asset (best-effort)
		try {
			const rows = await this.pool.query(
				`WITH latest AS (
					SELECT ve.*,
						ROW_NUMBER() OVER (PARTITION BY ve.visual_asset_id ORDER BY ve.created_at DESC) AS rn
					FROM visual_extractions ve
				)
				SELECT
					va.id::text as visual_asset_id,
					va.document_id::text as document_id,
					va.page_index,
					va.asset_type,
					va.confidence as asset_confidence,
					va.created_at as asset_created_at,
					latest.extractor_version,
					latest.ocr_text,
					latest.structured_json,
					latest.confidence as extraction_confidence,
					latest.created_at as extraction_created_at
				FROM visual_assets va
				LEFT JOIN latest ON latest.visual_asset_id = va.id AND latest.rn = 1
				WHERE va.deal_id = $1 AND va.deleted_at IS NULL
				ORDER BY COALESCE(latest.created_at, va.created_at) DESC, va.id DESC
				LIMIT 200`,
				[deal_id]
			);

			for (const r of rows.rows as any[]) {
				const ocr = typeof r.ocr_text === "string" ? r.ocr_text : "";
				const structured = r.structured_json ?? null;
				const extracted_at = r.extraction_created_at
					? new Date(r.extraction_created_at).toISOString()
					: r.asset_created_at
						? new Date(r.asset_created_at).toISOString()
						: new Date().toISOString();
				const source_path = `visual_asset:${r.visual_asset_id}:page:${r.page_index}:type:${String(r.asset_type ?? "")}`;
				const tags = ["visual", String(r.asset_type ?? ""), "ocr"].filter(Boolean);
				const evidence_id = computeEvidenceId({
					deal_id,
					source_type: "visual",
					source_path,
					content_text: ocr,
					content_json: structured,
					tags,
				});

				const confidence = Math.max(0.4, Math.min(0.95, Number(r.extraction_confidence ?? r.asset_confidence ?? 0.6)));

				const { sql, values } = buildUpsert({
					columns: [
						"evidence_id",
						"deal_id",
						"source_type",
						"source_path",
						"source_document_id",
						"source_visual_asset_id",
						"tags",
						"confidence",
						"extracted_at",
						"content_text",
						"content_json",
						"meta",
					],
					values: [
						evidence_id,
						deal_id,
						"visual",
						source_path,
						r.document_id,
						r.visual_asset_id,
						tags,
						confidence,
						extracted_at,
						ocr ? normalizeText(ocr).slice(0, 4000) : null,
						structured,
						stableJsonStringify({ extractor_version: r.extractor_version ?? null }),
					],
					conflictSetSqlParts: [
						"confidence = GREATEST(evidence_items.confidence, EXCLUDED.confidence)",
						"tags = EXCLUDED.tags",
						"extracted_at = GREATEST(evidence_items.extracted_at, EXCLUDED.extracted_at)",
						"content_text = EXCLUDED.content_text",
						"content_json = EXCLUDED.content_json",
						"meta = EXCLUDED.meta",
					],
				});

				const q = await this.pool.query(sql, values);
				const inserted = Boolean((q.rows?.[0] as any)?.inserted);
				if (inserted) result.inserted++;
				else result.updated++;
			}
		} catch (err: any) {
			result.warnings.push(`visual_ingest_failed:${err?.code ?? "unknown"}`);
		}

		return result;
	}

	async getEvidencePacket(deal_id: string, purpose: string, config?: EvidencePacketSelectionConfig): Promise<EvidencePacket> {
		const defaults = {
			minConfidence: 0.5,
			maxItems: 20,
			preferTags: [],
			maxOmissions: 50,
		} satisfies Required<Pick<EvidencePacketSelectionConfig, "minConfidence" | "maxItems" | "preferTags" | "maxOmissions">>;

		const finalConfig = {
			...defaults,
			...config,
			preferTags: Array.from(new Set([...(defaults.preferTags ?? []), ...((config?.preferTags ?? []) as string[])])),
		};

		let items: EvidenceItem[] = [];
		try {
			const res = await this.pool.query(
				`SELECT evidence_id, deal_id::text as deal_id, source_type, source_path,
					source_document_id::text as source_document_id,
					source_visual_asset_id::text as source_visual_asset_id,
					source_understanding_patch_id::text as source_understanding_patch_id,
					tags, confidence,
					extracted_at::text as extracted_at,
					content_text,
					content_json,
					meta
				FROM evidence_items
				WHERE deal_id = $1
				ORDER BY confidence DESC, extracted_at DESC, evidence_id ASC
				LIMIT 500`,
				[deal_id]
			);
			items = res.rows.map((r: any) => EvidenceItemSchema.parse(r));
		} catch (err: any) {
			// Fail open: return empty packet
			items = [];
		}

		const { selected, omitted } = selectEvidenceForPacket(items, finalConfig);
		const packet_id = computePacketId({ deal_id, purpose, config: finalConfig, selected_ids: selected.map((s) => s.evidence_id) });

		return {
			packet_id,
			deal_id,
			purpose,
			created_at: new Date().toISOString(),
			config: finalConfig as any,
			selected,
			omitted,
		};
	}
}
