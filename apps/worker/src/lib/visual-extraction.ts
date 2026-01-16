import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type { Pool } from "pg";
import path from "path";
import fs from "fs/promises";
import { createHash } from "crypto";

export type VisionExtractorConfig = {
	enabled: boolean;
	visionWorkerUrl: string;
	extractorVersion: string;
	timeoutMs: number;
	maxPages: number;
};

type LogLike = Pick<Console, "log" | "warn" | "error">;

type FsLike = Pick<typeof fs, "readdir" | "stat">;

export type VisionExtractRequest = {
	document_id: string;
	page_index: number;
	image_uri: string;
	extractor_version: string;
};

export type VisionBBox = { x: number; y: number; w: number; h: number };

export type VisionOcrBlock = {
	text: string;
	bbox: VisionBBox;
	confidence?: number | null;
};

export type VisionExtraction = {
	ocr_text?: string | null;
	ocr_blocks: VisionOcrBlock[];
	structured_json: Record<string, unknown>;
	units?: string | null;
	labels: Record<string, unknown>;
	model_version?: string | null;
	confidence: number;
};

export type VisionAsset = {
	asset_type: "chart" | "table" | "map" | "diagram" | "image_text" | "unknown";
	bbox: VisionBBox;
	confidence: number;
	quality_flags: Record<string, unknown>;
	image_uri?: string | null;
	image_hash?: string | null;
	extraction: VisionExtraction;
};

export type VisionExtractResponse = {
	document_id: string;
	page_index: number;
	extractor_version: string;
	assets: VisionAsset[];
};

const SEGMENT_KEYS = [
	"overview",
	"problem",
	"solution",
	"product",
	"market",
	"traction",
	"business_model",
	"competition",
	"team",
	"distribution",
	"raise_terms",
	"exit",
	"risks",
	"financials",
	"unknown",
] as const;

type SegmentKey = (typeof SEGMENT_KEYS)[number];

function coerceSegmentKey(value: unknown): SegmentKey | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return (SEGMENT_KEYS as readonly string[]).includes(trimmed) ? (trimmed as SegmentKey) : null;
}

function coerceJsonObject(value: unknown): Record<string, unknown> {
	if (!value) return {};
	if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		} catch {
			// ignore
		}
	}
	return {};
}

function coerceJsonArray<T = unknown>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed as T[];
		} catch {
			// ignore
		}
	}
	return [];
}

function coerceBBox(value: unknown): VisionBBox {
	const obj = coerceJsonObject(value);
	const x = typeof obj.x === "number" ? obj.x : Number(obj.x);
	const y = typeof obj.y === "number" ? obj.y : Number(obj.y);
	const w = typeof obj.w === "number" ? obj.w : Number(obj.w);
	const h = typeof obj.h === "number" ? obj.h : Number(obj.h);

	return {
		x: Number.isFinite(x) ? x : 0,
		y: Number.isFinite(y) ? y : 0,
		w: Number.isFinite(w) ? w : 1,
		h: Number.isFinite(h) ? h : 1,
	};
}

function normalizeImageUriForApi(imageUri: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
	if (!imageUri) return null;
	const trimmed = String(imageUri).trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
	if (trimmed.startsWith("/uploads/")) return trimmed;

	// Best-effort: map absolute file paths under UPLOAD_DIR to an API-relative URL under /uploads.
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : null;
	if (uploadDir && trimmed.startsWith("/")) {
		try {
			const rel = path.relative(uploadDir, trimmed);
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return `/uploads/${rel.split(path.sep).join("/")}`;
			}
		} catch {
			// fall through
		}
	}

	// Anything else (e.g. /tmp/*) is not web-served.
	return null;
}

function parseBool(input: string | undefined | null): boolean {
	if (!input) return false;
	return ["1", "true", "yes", "on"].includes(input.trim().toLowerCase());
}

function parseIntWithDefault(input: string | undefined, fallback: number): number {
	const v = Number.parseInt(String(input ?? ""), 10);
	return Number.isFinite(v) ? v : fallback;
}

let didWarnVisualExtractionDisabled = false;

export function getVisionExtractorConfig(env: NodeJS.ProcessEnv = process.env): VisionExtractorConfig {
	return {
		enabled: parseBool(env.ENABLE_VISUAL_EXTRACTION),
		visionWorkerUrl: (env.VISION_WORKER_URL || "http://localhost:8000").replace(/\/$/, ""),
		extractorVersion: env.VISION_EXTRACTOR_VERSION || "vision_v1",
		timeoutMs: parseIntWithDefault(env.VISION_TIMEOUT_MS, 8000),
		// Default high enough to cover typical pitch decks while keeping a hard cap via env.
		maxPages: parseIntWithDefault(env.VISION_MAX_PAGES, 50),
	};
}

function safeDocIdForPath(documentId: string): string {
	return String(documentId || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function dirExists(fsImpl: FsLike, dir: string): Promise<boolean> {
	try {
		const s = await fsImpl.stat(dir);
		return s.isDirectory();
	} catch {
		return false;
	}
}

function candidateArtifactDirs(params: {
	documentId: string;
	meta?: unknown;
	env?: NodeJS.ProcessEnv;
}): string[] {
	const env = params.env ?? process.env;
	const safeId = safeDocIdForPath(params.documentId);
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");

	const dirs: string[] = [];
	const metaObj = params.meta && typeof params.meta === "object" ? (params.meta as any) : null;
	for (const key of ["debug_dir", "debugDir", "artifacts_dir", "artifactsDir", "rendered_pages_dir", "renderedPagesDir"]) {
		const v = metaObj?.[key];
		if (typeof v === "string" && v.trim()) dirs.push(v.trim());
	}

	// Known extractor debug location (only exists if PDF_EXTRACT_DEBUG=1 at extraction time)
	dirs.push(path.join("/tmp/pdf_extract_debug", safeId));

	// Common “uploads/artifacts” patterns (best-effort; may not exist)
	dirs.push(path.join(uploadDir, "rendered_pages", safeId));
	dirs.push(path.join(uploadDir, "page_images", safeId));
	dirs.push(path.join(uploadDir, "extracted_images", safeId));
	dirs.push(path.join(uploadDir, "artifacts", safeId, "pages"));
	dirs.push(path.join(uploadDir, "artifacts", safeId));
	dirs.push(path.join(uploadDir, safeId, "pages"));
	dirs.push(path.join(uploadDir, safeId));

	// Dedupe while preserving order
	return Array.from(new Set(dirs));
}

function parsePageIndexFromFilename(fileName: string): number | null {
	const name = fileName.toLowerCase();
	if (!(name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) return null;

	// Examples: page_001_raw.png, page-12.png, page12.jpg
	const m = name.match(/page[_\-]?0*(\d{1,6})/);
	if (!m) return null;
	const n = Number.parseInt(m[1], 10);
	return Number.isFinite(n) ? n : null;
}

function pickBestPerPage(candidates: string[]): string {
	// Prefer “raw” over “pre” over anything else.
	const rank = (p: string) => {
		const n = p.toLowerCase();
		if (n.includes("_raw")) return 3;
		if (n.includes("_pre")) return 2;
		return 1;
	};
	return candidates.sort((a, b) => rank(b) - rank(a))[0];
}

export async function resolvePageImageUris(
	pool: Pool,
	documentId: string,
	options?: {
		logger?: LogLike;
		fsImpl?: FsLike;
		env?: NodeJS.ProcessEnv;
	}
): Promise<string[]> {
	const logger = options?.logger ?? console;
	const fsImpl = options?.fsImpl ?? fs;

	try {
		const { rows } = await pool.query<{ page_count: number | null; extraction_metadata: unknown | null }>(
			`SELECT page_count, extraction_metadata
			   FROM documents
			  WHERE id = $1
			  LIMIT 1`,
			[sanitizeText(documentId)]
		);
		const row = rows?.[0];
		const pageCount = typeof row?.page_count === "number" && Number.isFinite(row.page_count) ? row.page_count : 0;

		const dirs = candidateArtifactDirs({ documentId, meta: row?.extraction_metadata, env: options?.env });
		for (const dir of dirs) {
			if (!(await dirExists(fsImpl, dir))) continue;
			let files: string[] = [];
			try {
				files = await fsImpl.readdir(dir);
			} catch {
				continue;
			}

			const hasZero = files.some((f) => parsePageIndexFromFilename(f) === 0);
			const byIndex = new Map<number, string[]>();
			for (const f of files) {
				const parsed = parsePageIndexFromFilename(f);
				if (parsed === null) continue;
				const pageIndex = hasZero ? parsed : parsed - 1;
				if (pageIndex < 0) continue;
				if (pageCount && pageCount > 0 && pageIndex >= pageCount) continue;
				const full = path.join(dir, f);
				const list = byIndex.get(pageIndex) ?? [];
				list.push(full);
				byIndex.set(pageIndex, list);
			}

			const inferredPageCount =
				pageCount && pageCount > 0
					? pageCount
					: byIndex.size > 0
						? Math.max(...Array.from(byIndex.keys())) + 1
						: 0;

			const ordered: string[] = [];
			for (let i = 0; i < inferredPageCount; i += 1) {
				const cands = byIndex.get(i);
				if (!cands || cands.length === 0) continue;
				ordered.push(pickBestPerPage(cands));
			}

			if (ordered.length > 0) {
				// If the document row never had page_count, infer it from rendered pages so downstream
				// extraction (and UI) can behave deterministically.
				if ((!pageCount || pageCount <= 0) && inferredPageCount > 0) {
					try {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[sanitizeText(documentId), inferredPageCount]
						);
						logger.log(
							JSON.stringify({
								event: "PAGE_COUNT_INFERRED_FROM_RENDERED_PAGES",
								document_id: documentId,
								page_count: inferredPageCount,
								dir,
							})
						);
					} catch {
						// ignore
					}
				}
				return ordered;
			}
		}

		if (!pageCount || pageCount <= 0) {
			logger.log(
				JSON.stringify({
					event: "NO_PAGE_IMAGES_AVAILABLE",
					document_id: documentId,
					reason: "page_count_missing_and_no_images_found",
					searched_dirs: dirs,
				})
			);
			return [];
		}

		logger.log(
			JSON.stringify({
				event: "NO_PAGE_IMAGES_AVAILABLE",
				document_id: documentId,
				reason: "no_matching_files",
				searched_dirs: dirs,
				page_count: pageCount,
			})
		);
		return [];
	} catch (err) {
		logger.warn(
			`[visual_extraction] resolvePageImageUris failed doc=${documentId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return [];
	}
}

export async function backfillVisualAssetImageUris(params: {
	pool: Pool;
	documentId: string;
	pageImageUris: string[];
	env?: NodeJS.ProcessEnv;
}): Promise<{ updated: number }> {
	const env = params.env ?? process.env;
	let updated = 0;

	for (let i = 0; i < params.pageImageUris.length; i += 1) {
		const normalized = normalizeImageUriForApi(params.pageImageUris[i], env);
		if (!normalized) continue;
		try {
			const res = await params.pool.query<{ rowCount?: number }>(
				`UPDATE visual_assets
					 SET image_uri = $3
				 WHERE document_id = $1
				   AND page_index = $2
				   AND (image_uri IS NULL OR image_uri = '')`,
				[sanitizeText(params.documentId), i, normalized]
			);
			updated += res.rowCount ?? 0;
		} catch (err) {
			console.warn(
				`[visual_extraction] backfill image_uri failed doc=${params.documentId} page=${i}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	return { updated };
}

export async function hasTable(pool: Pool, table: string): Promise<boolean> {
	try {
		const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
		return rows?.[0]?.oid !== null;
	} catch {
		return false;
	}
}

export async function callVisionWorker(
	config: VisionExtractorConfig,
	request: VisionExtractRequest,
	fetchImpl: typeof fetch = fetch
): Promise<VisionExtractResponse | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const res = await fetchImpl(`${config.visionWorkerUrl}/extract-visuals`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		if (!res.ok) {
			return null;
		}

		const json = (await res.json()) as VisionExtractResponse;
		if (!json || typeof json !== "object") return null;
		if (!Array.isArray((json as any).assets)) return null;
		return json;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

type UpsertVisualAssetInput = {
	documentId: string;
	pageIndex: number;
	assetType: VisionAsset["asset_type"];
	bbox: VisionBBox;
	imageUri: string | null;
	imageHash: string | null;
	extractorVersion: string;
	confidence: number;
	qualityFlags: Record<string, unknown>;
};

export async function upsertVisualAsset(pool: Pool, input: UpsertVisualAssetInput): Promise<string> {
	const baseParams = [
		sanitizeText(input.documentId),
		input.pageIndex,
		sanitizeText(input.assetType),
		JSON.stringify(sanitizeDeep(input.bbox)),
		input.imageUri,
		input.imageHash,
		sanitizeText(input.extractorVersion),
		input.confidence,
		JSON.stringify(sanitizeDeep(input.qualityFlags ?? {})),
	];

	if (input.imageHash) {
		const { rows } = await pool.query<{ id: string }>(
			`INSERT INTO visual_assets (
			   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
			 ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
			 ON CONFLICT (document_id, page_index, extractor_version, image_hash)
			 DO UPDATE SET
			   asset_type = EXCLUDED.asset_type,
			   bbox = EXCLUDED.bbox,
			   image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri),
			   confidence = GREATEST(visual_assets.confidence, EXCLUDED.confidence),
			   quality_flags = visual_assets.quality_flags || EXCLUDED.quality_flags
			 RETURNING id`,
			baseParams
		);
		return rows[0].id;
	}

	const { rows } = await pool.query<{ id: string }>(
		`INSERT INTO visual_assets (
		   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
		 ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
		 ON CONFLICT (document_id, page_index, extractor_version) WHERE image_hash IS NULL
		 DO UPDATE SET
		   asset_type = EXCLUDED.asset_type,
		   bbox = EXCLUDED.bbox,
		   image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri),
		   confidence = GREATEST(visual_assets.confidence, EXCLUDED.confidence),
		   quality_flags = visual_assets.quality_flags || EXCLUDED.quality_flags
		 RETURNING id`,
		baseParams
	);
	return rows[0].id;
}

type UpsertVisualExtractionInput = {
	visualAssetId: string;
	extractorVersion: string;
	ocrText: string | null;
	ocrBlocks: VisionOcrBlock[];
	structuredJson: Record<string, unknown>;
	units: string | null;
	labels: Record<string, unknown>;
	modelVersion: string | null;
	confidence: number;
};

export async function upsertVisualExtraction(pool: Pool, input: UpsertVisualExtractionInput): Promise<void> {
	await pool.query(
		`INSERT INTO visual_extractions (
		   visual_asset_id, ocr_text, ocr_blocks, structured_json, units, labels,
		   extractor_version, model_version, confidence
		 ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9)
		 ON CONFLICT (visual_asset_id, extractor_version)
		 DO UPDATE SET
		   ocr_text = COALESCE(EXCLUDED.ocr_text, visual_extractions.ocr_text),
		   ocr_blocks = CASE
		     WHEN jsonb_typeof(EXCLUDED.ocr_blocks) = 'array' AND jsonb_array_length(EXCLUDED.ocr_blocks) > 0 THEN EXCLUDED.ocr_blocks
		     ELSE visual_extractions.ocr_blocks
		   END,
		   structured_json = visual_extractions.structured_json || EXCLUDED.structured_json,
		   units = COALESCE(EXCLUDED.units, visual_extractions.units),
		   labels = visual_extractions.labels || EXCLUDED.labels,
		   model_version = COALESCE(EXCLUDED.model_version, visual_extractions.model_version),
		   confidence = GREATEST(visual_extractions.confidence, EXCLUDED.confidence)
		`,
		[
			sanitizeText(input.visualAssetId),
			input.ocrText,
			JSON.stringify(sanitizeDeep(Array.isArray(input.ocrBlocks) ? input.ocrBlocks : [])),
			JSON.stringify(
				sanitizeDeep(
					input.structuredJson && typeof input.structuredJson === "object" && !Array.isArray(input.structuredJson)
						? input.structuredJson
						: {}
				)
			),
			input.units,
			JSON.stringify(
				sanitizeDeep(input.labels && typeof input.labels === "object" && !Array.isArray(input.labels) ? input.labels : {})
			),
			sanitizeText(input.extractorVersion),
			input.modelVersion,
			input.confidence,
		]
	);
}

export async function insertEvidenceLinkIfMissing(pool: Pool, input: {
	documentId: string;
	pageIndex: number | null;
	evidenceType: string;
	visualAssetId: string | null;
	ref: Record<string, unknown>;
	snippet: string | null;
	confidence: number;
}) {
	await pool.query(
		`INSERT INTO evidence_links (document_id, page_index, evidence_type, visual_asset_id, ref, snippet, confidence)
		 SELECT $1, $2, $3, $4, $5::jsonb, $6, $7
		 WHERE NOT EXISTS (
		   SELECT 1
		     FROM evidence_links
		    WHERE document_id = $1
		      AND page_index IS NOT DISTINCT FROM $2
		      AND evidence_type = $3
		      AND visual_asset_id IS NOT DISTINCT FROM $4
		 )`,
		[
			sanitizeText(input.documentId),
			input.pageIndex,
			sanitizeText(input.evidenceType),
			input.visualAssetId ? sanitizeText(input.visualAssetId) : null,
			JSON.stringify(sanitizeDeep(input.ref ?? {})),
			input.snippet,
			input.confidence,
		]
	);
}

export async function persistVisionResponse(
	pool: Pool,
	response: VisionExtractResponse,
	options?: { pageImageUri?: string | null; env?: NodeJS.ProcessEnv }
): Promise<{ persisted: number; withImageUri: number }> {
	let persisted = 0;
	let withImageUri = 0;
	const env = options?.env ?? process.env;
	const pageImageUri = options?.pageImageUri ?? null;
	const pageImageUriNormalized = normalizeImageUriForApi(pageImageUri, env);

	const docKind = await (async () => {
		try {
			const res = await pool.query(
				`SELECT type, extraction_metadata
				   FROM documents
				  WHERE id = $1
				  LIMIT 1`,
				[sanitizeText(response.document_id)]
			);
			const row = res.rows?.[0] as any;
			return deduceDocKind({ type: row?.type ?? null, extraction_metadata: row?.extraction_metadata ?? null });
		} catch {
			return "unknown";
		}
	})();

	for (const asset of response.assets ?? []) {
		const normalizedAssetImageUri = normalizeImageUriForApi(asset.image_uri ?? null, env) ?? pageImageUriNormalized;
		const assetBBox = coerceBBox((asset as any)?.bbox);
		const assetQualityFlags = coerceJsonObject((asset as any)?.quality_flags) ?? {};
		const extractionObj = (asset as any)?.extraction;
		const ocrText = typeof extractionObj?.ocr_text === "string" ? extractionObj.ocr_text : null;
		const ocrBlocks = coerceJsonArray<VisionOcrBlock>(extractionObj?.ocr_blocks);
		const structuredJson = coerceJsonObject(extractionObj?.structured_json);
		const labels = coerceJsonObject(extractionObj?.labels);
		const titleFromLabels = typeof (labels as any)?.title === "string" ? String((labels as any).title) : "";
		const titleFromStructured = typeof (structuredJson as any)?.title === "string" ? String((structuredJson as any).title) : "";
		const hasAnyTextSignal = Boolean(titleFromLabels.trim() || titleFromStructured.trim() || (ocrText && ocrText.trim()));

		// Persist a stable segment assignment for vision assets (PDF/images).
		// Resolution order: quality_flags.segment_key -> structured_json.segment_key -> infer from OCR/labels.
		const existingFromQuality = coerceSegmentKey((assetQualityFlags as any)?.segment_key);
		const existingFromStructured = coerceSegmentKey((structuredJson as any)?.segment_key);
		let segmentKey: SegmentKey | null = existingFromQuality ?? existingFromStructured;
		let segmentWasInferred = false;
		let unknownReasonCode: string | null = null;
		if (!segmentKey) {
			const combined = [titleFromLabels, titleFromStructured, ocrText].filter(Boolean).join("\n");
			segmentKey = classifySegmentKeyFromText(combined, "unknown");
			segmentWasInferred = true;
			if (segmentKey === "unknown") {
				unknownReasonCode = combined.trim().length === 0 ? "NO_TEXT" : "LOW_SIGNAL";
			}
		} else if (segmentKey === "unknown") {
			unknownReasonCode = hasAnyTextSignal ? "LOW_SIGNAL" : "NO_TEXT";
		}

		// For XLSX-derived page images, treat the segment assignment as a structured pipeline output.
		// This lets the API treat segment_key as persisted/promoted (instead of "hint-only") and avoids "unknown" grouping.
		const isExcelDoc = docKind === "excel";
		if (isExcelDoc && (typeof (assetQualityFlags as any)?.source !== "string" || !String((assetQualityFlags as any).source).startsWith("structured_"))) {
			(assetQualityFlags as any).source = "structured_excel_render_v1";
			(assetQualityFlags as any).original_source = response.extractor_version;
		}

		// Skip persisting empty page-image artifacts for Excel documents.
		// These frequently have no OCR/title signal, become segment_key=unknown, and add noise to the graph.
		if (isExcelDoc && asset.asset_type === "image_text" && !hasAnyTextSignal && (!segmentKey || segmentKey === "unknown")) {
			continue;
		}

		const qualityFlagsWithSeg: any = { ...(assetQualityFlags ?? {}) };
		if (typeof qualityFlagsWithSeg.source !== "string" || !qualityFlagsWithSeg.source.trim()) {
			qualityFlagsWithSeg.source = response.extractor_version;
		}
		if (segmentKey && !existingFromQuality) {
			qualityFlagsWithSeg.segment_key = segmentKey;
			if (segmentWasInferred && (typeof qualityFlagsWithSeg.segment_source !== "string" || !qualityFlagsWithSeg.segment_source.trim())) {
				qualityFlagsWithSeg.segment_source = "inferred_ocr_v1";
			}
		}
		if (segmentKey === "unknown" && unknownReasonCode && (typeof qualityFlagsWithSeg.unknown_reason_code !== "string" || !qualityFlagsWithSeg.unknown_reason_code.trim())) {
			qualityFlagsWithSeg.unknown_reason_code = unknownReasonCode;
		}
		const structuredJsonWithSeg = segmentKey && !existingFromStructured
			? { ...structuredJson, segment_key: segmentKey }
			: structuredJson;

		const visualAssetId = await upsertVisualAsset(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			assetType: asset.asset_type,
			bbox: assetBBox,
			imageUri: normalizedAssetImageUri,
			imageHash: asset.image_hash ?? null,
			extractorVersion: response.extractor_version,
			confidence: asset.confidence ?? 0,
			qualityFlags: qualityFlagsWithSeg,
		});

		if (normalizedAssetImageUri) withImageUri += 1;

		await upsertVisualExtraction(pool, {
			visualAssetId,
			extractorVersion: response.extractor_version,
			ocrText: ocrText,
			ocrBlocks: ocrBlocks,
			structuredJson: structuredJsonWithSeg,
			units: asset.extraction?.units ?? null,
			labels: labels,
			modelVersion: asset.extraction?.model_version ?? null,
			confidence: asset.extraction?.confidence ?? asset.confidence ?? 0,
		});

		const snippetRaw = ocrText;
		const snippet = snippetRaw && snippetRaw.length > 500 ? `${snippetRaw.slice(0, 497)}...` : snippetRaw;

		await insertEvidenceLinkIfMissing(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			evidenceType: "visual_asset",
			visualAssetId,
			ref: {
				asset_type: asset.asset_type,
				bbox: assetBBox,
				image_uri: normalizedAssetImageUri,
				page_image_uri: pageImageUriNormalized,
				image_hash: asset.image_hash ?? null,
				extractor_version: response.extractor_version,
			},
			snippet,
			confidence: asset.confidence ?? 0,
		});

		persisted += 1;
	}

	return { persisted, withImageUri };
}

export function deduceDocKind(meta: { extraction_metadata?: any; type?: string | null }): string {
	const fromMeta = meta.extraction_metadata && typeof meta.extraction_metadata === "object"
		? ((meta.extraction_metadata as any).doc_kind ?? (meta.extraction_metadata as any).contentType ?? null)
		: null;
	const kindRaw = (fromMeta || meta.type || "").toString().toLowerCase();
	if (kindRaw.includes("excel") || kindRaw.endsWith("xlsx") || kindRaw === "xls") return "excel";
	if (kindRaw.includes("powerpoint") || kindRaw.includes("ppt")) return "powerpoint";
	if (kindRaw.includes("word") || kindRaw.includes("doc")) return "word";
	if (kindRaw.includes("image")) return "image";
	return kindRaw || "unknown";
}

type SyntheticAssetBuild = {
	pageIndex: number;
	asset: VisionAsset;
};

function hashKey(parts: Array<string | number>): string {
	return createHash("sha256").update(parts.map((p) => String(p)).join("|"), "utf8").digest("hex");
}

export function toTextLoose(node: unknown): string {
	const seen = new WeakSet<object>();

	const stripPoison = (s: string) => {
		// Never allow implicit object stringification markers to leak into classifier text.
		const cleaned = s.replace(/\[object Object\]/g, " ");
		return cleaned.replace(/\s+/g, " ").trim();
	};

	const walk = (value: unknown, depth: number): string => {
		if (value == null) return "";
		if (typeof value === "string") return stripPoison(value);
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		if (Array.isArray(value)) {
			const parts = value.map((v) => walk(v, depth - 1)).filter(Boolean);
			return stripPoison(parts.join("\n"));
		}
		if (typeof value !== "object") return "";
		if (depth <= 0) return "";

		const obj = value as any;
		if (seen.has(obj)) return "";
		seen.add(obj);

		const parts: string[] = [];

		// Common direct keys.
		for (const k of ["text", "value", "content"]) {
			const v = obj?.[k];
			const t = walk(v, depth - 1);
			if (t) parts.push(t);
		}

		// Common rich-text container keys.
		if (Array.isArray(obj?.runs)) {
			const runText = obj.runs.map((r: any) => walk(r, depth - 1)).filter(Boolean).join("");
			if (runText) parts.push(stripPoison(runText));
		}

		for (const k of ["children", "items", "elements"]) {
			if (!Array.isArray(obj?.[k])) continue;
			const t = (obj[k] as any[]).map((c) => walk(c, depth - 1)).filter(Boolean).join("\n");
			if (t) parts.push(stripPoison(t));
		}

		return stripPoison(parts.join("\n"));
	};

	return walk(node, 8);
}

function cleanTextForClassification(input: unknown): string {
	const raw = toTextLoose(input);
	if (!raw) return "";
	// Guard: strip any remaining poisoning artifacts (defensive in case upstream already persisted it).
	return raw.replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
}

type ExcelSheetUnderstandingV1 = {
	schema_version: "excel_sheet_understanding_v1";
	sheet_name: string;
	detected_type:
		| "revenue"
		| "expenses"
		| "cash_flow"
		| "use_of_funds"
		| "valuation"
		| "cap_table"
		| "financial_model"
		| "unknown";
	confidence: number; // 0..1
	segment_key?: SegmentKey;

	metrics_v1?: ExcelSheetMetricsV1;

	structure: {
		row_count?: number;
		header_count?: number;
		headers_sample: string[];
		row_labels_sample: string[];
		numeric_columns_sample: string[];
	};

	time: {
		granularity: "monthly" | "quarterly" | "annual" | "unknown";
		headers_detected: boolean;
		time_headers_sample: string[];
	};

	units: {
		currency_hint: string | null;
	};

	flags: string[];
};

type ExcelTimeSeriesTableLite = {
	kind?: string;
	name?: string;
	label_col?: string;
	value_cols: Array<{ col: string; header: string }>;
	rows: Array<{ label: string; values: Record<string, { value?: unknown; formula?: string }> }>;
};

type ExcelSheetMetricsV1 = {
	schema_version: "excel_sheet_metrics_v1";
	source: "time_series_table" | "sheet_rows" | "grid_preview" | "none";

	time_series?: {
		period_count: number;
		first_period_label: string | null;
		last_period_label: string | null;
		granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	};

	key_series?: {
		label: string;
		start_value: number | null;
		end_value: number | null;
		growth_pct: number | null;
		start_period_label: string | null;
		end_period_label: string | null;
		missing_ratio: number;
	};

	distribution?: {
		total_value: number;
		top_categories: Array<{ label: string; value: number; pct_of_total: number }>;
		percent_column_sum?: { value: number; expected: 1 | 100; within_tolerance: boolean };
	};

	quality: {
		numeric_cells: number;
		total_cells_scanned: number;
		numeric_ratio: number;
	};

	flags: string[];
};

function parseExcelNumeric(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value !== "string") return null;
	let t = value.trim();
	if (!t) return null;
	// Handle (123) negative accounting format.
	let negative = false;
	if (/^\(.*\)$/.test(t)) {
		negative = true;
		t = t.replace(/^\(|\)$/g, "");
	}
	// Remove currency symbols and thousand separators.
	t = t.replace(/[$€£,\s]/g, "");
	if (!t) return null;
	let isPercent = false;
	if (/%$/.test(t)) {
		isPercent = true;
		t = t.replace(/%$/, "");
	}
	// Common suffixes like k/m/b.
	let multiplier = 1;
	if (/^[+-]?[0-9]*\.?[0-9]+[kmb]$/i.test(t)) {
		const suffix = t.slice(-1).toLowerCase();
		t = t.slice(0, -1);
		if (suffix === "k") multiplier = 1_000;
		if (suffix === "m") multiplier = 1_000_000;
		if (suffix === "b") multiplier = 1_000_000_000;
	}
	const n = Number(t);
	if (!Number.isFinite(n)) return null;
	let out = n * multiplier;
	if (isPercent) out = out / 100;
	if (negative) out = -out;
	return out;
}

function formatCompactNumber(n: number, currencyHint: string | null): string {
	const abs = Math.abs(n);
	const sign = n < 0 ? "-" : "";
	const prefix = currencyHint === "USD" ? "$" : currencyHint === "EUR" ? "€" : currencyHint === "GBP" ? "£" : "";
	const fmt = (v: number, suffix: string) => `${sign}${prefix}${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${suffix}`;
	if (abs >= 1_000_000_000) return fmt(abs / 1_000_000_000, "B");
	if (abs >= 1_000_000) return fmt(abs / 1_000_000, "M");
	if (abs >= 1_000) return fmt(abs / 1_000, "K");
	return `${sign}${prefix}${abs.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)}`;
}

function formatPct(p: number): string {
	return `${(p * 100).toFixed(Math.abs(p) >= 1 ? 0 : 1)}%`;
}

function parseTimeSortKey(header: string): { sortKey: number | null; label: string } {
	const raw = cleanTextForClassification(header);
	const t = raw.toLowerCase();
	if (!t) return { sortKey: null, label: raw };

	// Month N
	const mN = t.match(/^month\s*(\d+)\b/);
	if (mN) return { sortKey: Number(mN[1]), label: raw };

	// Month name
	const monthMap: Record<string, number> = {
		jan: 1,
		january: 1,
		feb: 2,
		february: 2,
		mar: 3,
		march: 3,
		apr: 4,
		april: 4,
		may: 5,
		jun: 6,
		june: 6,
		jul: 7,
		july: 7,
		aug: 8,
		august: 8,
		sep: 9,
		september: 9,
		oct: 10,
		october: 10,
		nov: 11,
		november: 11,
		dec: 12,
		december: 12,
	};
	if (monthMap[t] != null) return { sortKey: monthMap[t], label: raw };

	// Quarter (optionally with year)
	const q = t.match(/\bq([1-4])\b(?:\s*(\d{4}))?/);
	if (q) {
		const qn = Number(q[1]);
		const yr = q[2] ? Number(q[2]) : 0;
		return { sortKey: yr ? yr * 10 + qn : qn, label: raw };
	}

	// FY / Year
	const fy = t.match(/^fy\s*(\d{2,4})$/);
	if (fy) {
		let year = Number(fy[1]);
		if (year < 100) year = 2000 + year;
		return { sortKey: year, label: raw };
	}
	const year = t.match(/^(\d{4})$/);
	if (year) return { sortKey: Number(year[1]), label: raw };

	return { sortKey: null, label: raw };
}

function buildMetricsFromTimeSeriesTable(input: {
	detectedType: ExcelSheetUnderstandingV1["detected_type"];
	granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	currencyHint: string | null;
	table: ExcelTimeSeriesTableLite;
}): { metrics: ExcelSheetMetricsV1; investorEvidence: string[]; analystEvidence: string[] } {
	const flags: string[] = [];
	const cols = Array.isArray(input.table?.value_cols) ? input.table.value_cols : [];
	const rows = Array.isArray(input.table?.rows) ? input.table.rows : [];

	const colMeta = cols
		.map((c) => {
			const header = cleanTextForClassification(c?.header ?? c?.col);
			const parsed = parseTimeSortKey(header);
			return { col: String(c?.col ?? ""), header, sortKey: parsed.sortKey, label: parsed.label };
		})
		.filter((c) => c.col);

	// Keep original order if we cannot sort meaningfully.
	const canSort = colMeta.some((c) => c.sortKey != null);
	const ordered = canSort
		? [...colMeta].sort((a, b) => {
			if (a.sortKey == null && b.sortKey == null) return 0;
			if (a.sortKey == null) return 1;
			if (b.sortKey == null) return -1;
			return a.sortKey - b.sortKey;
		})
		: colMeta;

	const pickRowScore = (labelRaw: string): number => {
		const label = labelRaw.toLowerCase();
		if (!label.trim()) return 0;
		if (input.detectedType === "revenue") {
			if (/\b(total\s*)?(revenue|sales)\b/.test(label)) return 6;
			if (/\b(arr|mrr)\b/.test(label)) return 5;
			if (/\btotal\b/.test(label)) return 4;
		}
		if (input.detectedType === "expenses") {
			if (/\b(total\s*)?(expense|opex|cogs)\b/.test(label)) return 6;
			if (/\btotal\b/.test(label)) return 4;
		}
		if (input.detectedType === "cash_flow") {
			if (/\b(cash\s*flow|burn|runway|cash\s*balance)\b/.test(label)) return 6;
		}
		return 1;
	};

	type SeriesCandidate = {
		label: string;
		values: Array<number | null>;
		missing: number;
		numericCount: number;
		score: number;
		endValue: number | null;
	};
	let best: SeriesCandidate | null = null;
	let bestAny: SeriesCandidate | null = null;

	let numericCells = 0;
	let totalCells = 0;

	const isLikelyRatioRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		return /\b(retention|ratio|margin|%|percent|pct)\b/.test(t);
	};

	const isLikelyTotalRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		return /\b(total|subtotal|sum)\b/.test(t);
	};

	const isLikelyHeaderRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		// Avoid selecting section headers like "Revenue" with no values.
		return /^(revenue|sales|expenses|opex|cogs|cash\s*flow|runway|burn)$/i.test(t);
	};

	const computeCandidate = (r: any): SeriesCandidate => {
		const label = cleanTextForClassification(r?.label);
		const series: Array<number | null> = [];
		let missing = 0;
		let numericCount = 0;
		let endValue: number | null = null;
		for (const c of ordered) {
			totalCells += 1;
			// NOTE: excel.ts stores time-series row values keyed by the header string (e.g. "Month 1"),
			// not by the column letter. Prefer header key and fall back to column letter.
			const valuesObj = (r as any)?.values ?? {};
			const cell = valuesObj?.[c.header] ?? valuesObj?.[c.label] ?? valuesObj?.[c.col];
			const n = parseExcelNumeric(cell?.value);
			if (n == null) missing += 1;
			else {
				numericCells += 1;
				numericCount += 1;
				endValue = n;
			}
			series.push(n);
		}
		const score = pickRowScore(label);
		return { label, values: series, missing, numericCount, score, endValue };
	};

	for (const r of rows.slice(0, 120)) {
		const cand = computeCandidate(r);
		// Track best-any regardless of data coverage (debugging / fallback)
		if (!bestAny) bestAny = cand;
		else {
			const betterScore = cand.score > bestAny.score;
			const betterEnd = (cand.endValue ?? -Infinity) > (bestAny.endValue ?? -Infinity);
			const fewerMissing = cand.missing < bestAny.missing;
			if (betterScore || (cand.score === bestAny.score && (betterEnd || fewerMissing))) {
				bestAny = cand;
			}
		}

		// Only consider as key series if it has enough numeric coverage.
		// NOTE: do not exclude labels like "Revenue" here; many real sheets have a numeric Revenue row.
		const viable = cand.numericCount >= 2;
		if (!viable) continue;
		if (!best) best = cand;
		else {
			// Prefer higher semantic score, then higher numeric coverage, then fewer missing.
			const betterScore = cand.score > best.score;
			const betterCoverage = cand.numericCount > best.numericCount;
			const fewerMissing = cand.missing < best.missing;
			if (betterScore || (cand.score === best.score && (betterCoverage || fewerMissing))) {
				best = cand;
			}
		}
	}

	const periodCount = ordered.length;
	const firstPeriod = ordered[0]?.label ?? null;
	const lastPeriod = ordered[ordered.length - 1]?.label ?? null;

	const metrics: ExcelSheetMetricsV1 = {
		schema_version: "excel_sheet_metrics_v1",
		source: "time_series_table",
		time_series: {
			period_count: periodCount,
			first_period_label: firstPeriod,
			last_period_label: lastPeriod,
			granularity: input.granularity,
		},
		quality: {
			numeric_cells: numericCells,
			total_cells_scanned: totalCells,
			numeric_ratio: totalCells > 0 ? numericCells / totalCells : 0,
		},
		flags,
	};

	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];

	// If the expected headline row (e.g. "Revenue") exists but has no values, derive a usable series from line items.
	const maybeDeriveSumSeries = (): SeriesCandidate | null => {
		if (periodCount < 2) return null;
		if (input.detectedType !== "revenue" && input.detectedType !== "expenses" && input.detectedType !== "cash_flow") return null;

		// Build per-row numeric series once for summation.
		const candidates: Array<{ label: string; values: Array<number | null>; numericCount: number }> = [];
		for (const r of rows.slice(0, 150)) {
			const label = cleanTextForClassification((r as any)?.label);
			if (!label) continue;
			if (isLikelyRatioRowLabel(label)) continue;
			if (isLikelyTotalRowLabel(label)) continue;
			// Do not include blank header-like rows (they tend to be section labels).
			if (isLikelyHeaderRowLabel(label)) continue;
			const valuesObj = (r as any)?.values ?? {};
			const series = ordered.map((c) => {
				const cell = valuesObj?.[c.header] ?? valuesObj?.[c.label] ?? valuesObj?.[c.col];
				return parseExcelNumeric(cell?.value);
			});
			const numericCount = series.filter((v) => v != null).length;
			if (numericCount < 2) continue;
			candidates.push({ label, values: series, numericCount });
		}
		if (candidates.length < 2) return null;

		const sumSeries: Array<number | null> = [];
		let missing = 0;
		let numericCount = 0;
		let endValue: number | null = null;
		for (let i = 0; i < periodCount; i++) {
			let s = 0;
			let count = 0;
			for (const r of candidates) {
				const v = r.values[i];
				if (v == null) continue;
				s += v;
				count += 1;
			}
			if (count === 0) {
				missing += 1;
				sumSeries.push(null);
			} else {
				numericCount += 1;
				endValue = s;
				sumSeries.push(s);
			}
		}

		const label = input.detectedType === "expenses" ? "Estimated total expenses (sum of line items)" : "Estimated total (sum of line items)";
		return { label, values: sumSeries, missing, numericCount, score: 2, endValue };
	};

	// If we're a revenue/expenses/cash-flow sheet and the semantic "total" row is present but empty,
	// a derived sum-of-lines series is usually a better investor-facing headline than picking a random line item.
	const derivedPreferred = (() => {
		const derived = maybeDeriveSumSeries();
		if (!derived) return null;
		if (!bestAny) return null;
		if (bestAny.numericCount >= 2) return null;
		// Only prefer derivation when the strongest semantic match is a header-ish total row with no values.
		if (bestAny.score < 4) return null;
		if (!isLikelyHeaderRowLabel(bestAny.label)) return null;
		return derived;
	})();

	if ((derivedPreferred || best) && periodCount >= 2) {
		const chosen = derivedPreferred ?? best!;
		const firstIdx = chosen.values.findIndex((v) => v != null);
		const lastIdx = (() => {
			for (let i = chosen.values.length - 1; i >= 0; i--) if (chosen.values[i] != null) return i;
			return -1;
		})();
		const start = firstIdx >= 0 ? (chosen.values[firstIdx] as number) : null;
		const end = lastIdx >= 0 ? (chosen.values[lastIdx] as number) : null;
		const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
		const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
		const missingRatio = periodCount > 0 ? chosen.missing / periodCount : 1;
		let growthPct: number | null = null;
		if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);

		metrics.key_series = {
			label: chosen.label || "(unlabeled)",
			start_value: start,
			end_value: end,
			growth_pct: growthPct,
			start_period_label: startLabel ?? null,
			end_period_label: endLabel ?? null,
			missing_ratio: missingRatio,
		};
		if (derivedPreferred) flags.push("derived_key_series_sum_of_rows");

		if (start != null && end != null) {
			const startTxt = formatCompactNumber(start, input.currencyHint);
			const endTxt = formatCompactNumber(end, input.currencyHint);
			const growthTxt = growthPct != null ? ` (${formatPct(growthPct)} change)` : "";
			investorEvidence.push(
				`${chosen.label || "Key series"} changes from ${startTxt} to ${endTxt} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthTxt}.`
			);
			analystEvidence.push(
				`metrics_v1(time_series_table): key_series=${chosen.label || "(unlabeled)"}, periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`
			);
		} else {
			analystEvidence.push(
				`metrics_v1(time_series_table): selected key_series=${chosen.label || "(unlabeled)"}, but could not compute start/end (insufficient numeric values).`
			);
			flags.push("key_series_missing_values");
		}
	}

	// Fallback: if no viable series was found, try deriving a series from row sums.
	if (!metrics.key_series && (!best || (best.numericCount < 2 && periodCount >= 2)) && periodCount >= 2) {
		const derived = maybeDeriveSumSeries();
		if (derived) {
			const firstIdx = derived.values.findIndex((v) => v != null);
			const lastIdx = (() => {
				for (let i = derived.values.length - 1; i >= 0; i--) if (derived.values[i] != null) return i;
				return -1;
			})();
			const start = firstIdx >= 0 ? (derived.values[firstIdx] as number) : null;
			const end = lastIdx >= 0 ? (derived.values[lastIdx] as number) : null;
			const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
			const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
			const missingRatio = periodCount > 0 ? derived.missing / periodCount : 1;
			let growthPct: number | null = null;
			if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);

			metrics.key_series = {
				label: derived.label,
				start_value: start,
				end_value: end,
				growth_pct: growthPct,
				start_period_label: startLabel ?? null,
				end_period_label: endLabel ?? null,
				missing_ratio: missingRatio,
			};
			flags.push("derived_key_series_sum_of_rows");
			if (start != null && end != null) {
				investorEvidence.push(
					`${derived.label} changes from ${formatCompactNumber(start, input.currencyHint)} to ${formatCompactNumber(end, input.currencyHint)} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthPct != null ? ` (${formatPct(growthPct)} change)` : ""}.`
				);
				analystEvidence.push(
					`metrics_v1(time_series_table): derived key_series from sum of line items; periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`
				);
			} else {
				analystEvidence.push(
					"metrics_v1(time_series_table): attempted to derive a key series from row sums, but still could not compute start/end."
				);
				flags.push("key_series_missing_values");
			}
		}
	}

	if (metrics.quality.numeric_ratio < 0.15) flags.push("low_numeric_ratio");
	if (periodCount > 0 && metrics.key_series && metrics.key_series.missing_ratio > 0.5) flags.push("high_missing_ratio");

	return { metrics, investorEvidence, analystEvidence };
}

function buildMetricsFromGridPreview(input: {
	detectedType: ExcelSheetUnderstandingV1["detected_type"];
	granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	currencyHint: string | null;
	headers: string[];
	gridCells: any[];
}): { metrics: ExcelSheetMetricsV1; investorEvidence: string[]; analystEvidence: string[] } {
	const flags: string[] = [];
	const cells = Array.isArray(input.gridCells) ? input.gridCells : [];
	const byAddr = new Map<string, any>();
	for (const c of cells) {
		const a = typeof c?.a === "string" ? c.a : "";
		if (!a) continue;
		byAddr.set(a.toUpperCase(), c);
	}

	// Attempt: header row is row 1.
	const headerCols: Array<{ col: string; header: string }> = [];
	for (let i = 0; i < Math.min(20, input.headers.length); i++) {
		const colLetter = String.fromCharCode("A".charCodeAt(0) + i);
		const addr = `${colLetter}1`;
		const c = byAddr.get(addr);
		const h = cleanTextForClassification(c?.w ?? c?.v ?? input.headers[i]);
		if (!h) continue;
		headerCols.push({ col: colLetter, header: h });
	}

	const numericCols = headerCols.filter((c) => isMonthHeaderToken(c.header) || /\b(month|q[1-4]|fy|\d{4})\b/i.test(c.header));
	const ordered = numericCols
		.map((c) => ({ ...c, ...parseTimeSortKey(c.header) }))
		.sort((a, b) => {
			if (a.sortKey == null && b.sortKey == null) return 0;
			if (a.sortKey == null) return 1;
			if (b.sortKey == null) return -1;
			return a.sortKey - b.sortKey;
		});

	let numericCells = 0;
	let totalCells = 0;

	// Find a candidate label row (prefer row 2..15).
	const candidateRows: Array<{ row: number; label: string; values: Array<number | null>; missing: number }> = [];
	for (let rr = 2; rr <= 18; rr++) {
		const labelCell = byAddr.get(`A${rr}`);
		const label = cleanTextForClassification(labelCell?.w ?? labelCell?.v);
		if (!label) continue;
		const values: Array<number | null> = [];
		let missing = 0;
		for (const c of ordered) {
			totalCells += 1;
			const vCell = byAddr.get(`${c.col}${rr}`);
			const n = parseExcelNumeric(vCell?.v ?? vCell?.w);
			if (n == null) missing += 1;
			else numericCells += 1;
			values.push(n);
		}
		candidateRows.push({ row: rr, label, values, missing });
	}

	const pickRowScore = (labelRaw: string): number => {
		const label = labelRaw.toLowerCase();
		if (input.detectedType === "revenue") {
			if (/\b(total\s*)?(revenue|sales)\b/.test(label)) return 6;
			if (/\b(arr|mrr)\b/.test(label)) return 5;
		}
		if (input.detectedType === "use_of_funds") {
			if (/\b(total|sum)\b/.test(label)) return 3;
		}
		return 1;
	};

	let best = candidateRows
		.map((r) => ({ ...r, score: pickRowScore(r.label) }))
		.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			const aEnd = (() => {
				for (let i = a.values.length - 1; i >= 0; i--) if (a.values[i] != null) return a.values[i] as number;
				return -Infinity;
			})();
			const bEnd = (() => {
				for (let i = b.values.length - 1; i >= 0; i--) if (b.values[i] != null) return b.values[i] as number;
				return -Infinity;
			})();
			return bEnd - aEnd;
		})[0];

	const periodCount = ordered.length;
	const firstPeriod = ordered[0]?.label ?? null;
	const lastPeriod = ordered[ordered.length - 1]?.label ?? null;

	const metrics: ExcelSheetMetricsV1 = {
		schema_version: "excel_sheet_metrics_v1",
		source: "grid_preview",
		time_series: periodCount
			? { period_count: periodCount, first_period_label: firstPeriod, last_period_label: lastPeriod, granularity: input.granularity }
			: undefined,
		quality: {
			numeric_cells: numericCells,
			total_cells_scanned: totalCells,
			numeric_ratio: totalCells > 0 ? numericCells / totalCells : 0,
		},
		flags,
	};

	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];

	if (best && periodCount >= 2) {
		const firstIdx = best.values.findIndex((v) => v != null);
		const lastIdx = (() => {
			for (let i = best.values.length - 1; i >= 0; i--) if (best.values[i] != null) return i;
			return -1;
		})();
		const start = firstIdx >= 0 ? (best.values[firstIdx] as number) : null;
		const end = lastIdx >= 0 ? (best.values[lastIdx] as number) : null;
		const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
		const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
		const missingRatio = periodCount > 0 ? best.missing / periodCount : 1;
		let growthPct: number | null = null;
		if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);
		metrics.key_series = {
			label: best.label,
			start_value: start,
			end_value: end,
			growth_pct: growthPct,
			start_period_label: startLabel ?? null,
			end_period_label: endLabel ?? null,
			missing_ratio: missingRatio,
		};
		if (start != null && end != null) {
			const startTxt = formatCompactNumber(start, input.currencyHint);
			const endTxt = formatCompactNumber(end, input.currencyHint);
			const growthTxt = growthPct != null ? ` (${formatPct(growthPct)} change)` : "";
			investorEvidence.push(
				`${best.label} changes from ${startTxt} to ${endTxt} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthTxt}.`
			);
			analystEvidence.push(`metrics_v1(grid_preview): key_series=${best.label}, periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`);
		}
	}

	if (metrics.quality.numeric_ratio < 0.08) flags.push("low_numeric_ratio");
	return { metrics, investorEvidence, analystEvidence };
}

function buildUseOfFundsDistributionFromSheetRows(input: {
	headers: string[];
	rows: Array<Record<string, unknown>>;
	currencyHint: string | null;
}): {
	distribution: ExcelSheetMetricsV1["distribution"] | null;
	flags: string[];
	evidence: { investor: string[]; analyst: string[] };
} {
	const flags: string[] = [];
	const investor: string[] = [];
	const analyst: string[] = [];

	const headers = Array.isArray(input.headers) ? input.headers.map((h) => cleanTextForClassification(h)).filter(Boolean) : [];
	const rows = Array.isArray(input.rows) ? input.rows : [];
	if (headers.length === 0 || rows.length === 0) {
		return { distribution: null, flags: ["use_of_funds:no_headers_or_rows"], evidence: { investor, analyst } };
	}

	const headerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
	const labelHints = ["category", "categories", "purpose", "use", "allocation", "item", "line item", "metric", "description", "col_a", "col a", "label"];
	const amountHints = ["amount", "budget", "cost", "spend", "allocated", "usd", "value", "total"];
	const pctHints = ["%", "percent", "pct", "percentage", "share", "portion"];

	const headerScores = headers.map((h) => {
		const n = headerNorm(h);
		const labelScore = labelHints.some((k) => n.includes(k)) ? 3 : 0;
		const amountScore = amountHints.some((k) => n.includes(k)) ? 2 : 0;
		const pctScore = pctHints.some((k) => n.includes(k)) ? 2 : 0;
		return { h, n, labelScore, amountScore, pctScore };
	});

	const getColumnStats = (header: string) => {
		let numericCount = 0;
		let total = 0;
		let max = -Infinity;
		let sum = 0;
		for (const r of rows.slice(0, 250)) {
			const v = (r as any)?.[header];
			const n = parseExcelNumeric(v);
			total += 1;
			if (n == null) continue;
			numericCount += 1;
			sum += n;
			if (n > max) max = n;
		}
		return {
			numericCount,
			total,
			numericRatio: total > 0 ? numericCount / total : 0,
			max: numericCount > 0 ? max : null,
			sum: numericCount > 0 ? sum : 0,
		};
	};

	let labelCol = headerScores.sort((a, b) => b.labelScore - a.labelScore).find((s) => s.labelScore > 0)?.h;
	if (!labelCol) labelCol = headers[0];

	const candidates = headers.map((h) => ({ h, stats: getColumnStats(h), score: headerScores.find((s) => s.h === h) }));
	const amountCol = candidates
		.map((c) => {
			const hint = c.score?.amountScore ?? 0;
			const statScore = c.stats.numericRatio;
			const magnitudeScore = c.stats.max != null ? Math.min(3, Math.log10(Math.max(1, Math.abs(c.stats.max))) / 2) : 0;
			return { h: c.h, totalScore: hint + statScore + magnitudeScore };
		})
		.sort((a, b) => b.totalScore - a.totalScore)[0]?.h;

	const pctCol = candidates
		.map((c) => {
			const hint = c.score?.pctScore ?? 0;
			if (c.stats.numericRatio < 0.3 || c.stats.max == null) return { h: c.h, totalScore: -1 };
			const max = Math.abs(c.stats.max);
			const rangeScore = max <= 1.2 ? 3 : max <= 120 ? 2 : 0;
			return { h: c.h, totalScore: hint + rangeScore + c.stats.numericRatio };
		})
		.sort((a, b) => b.totalScore - a.totalScore)[0]?.h;

	if (!amountCol) return { distribution: null, flags: ["use_of_funds:no_amount_col"], evidence: { investor, analyst } };

	const items: Array<{ label: string; value: number; pctRaw: number | null }> = [];
	for (const r of rows.slice(0, 500)) {
		const labelRaw = cleanTextForClassification((r as any)?.[labelCol]);
		if (!labelRaw) continue;
		const label = labelRaw.trim();
		if (!label) continue;
		if (/^total\b|\bsum\b|\bsubtotal\b/i.test(label)) continue;
		const value = parseExcelNumeric((r as any)?.[amountCol]);
		if (value == null) continue;
		const pctRaw = pctCol ? parseExcelNumeric((r as any)?.[pctCol]) : null;
		items.push({ label, value, pctRaw });
		if (items.length >= 120) break;
	}
	if (items.length < 2) return { distribution: null, flags: ["use_of_funds:insufficient_items"], evidence: { investor, analyst } };

	const totalValue = items.reduce((acc, it) => acc + it.value, 0);
	if (!Number.isFinite(totalValue) || Math.abs(totalValue) < 1e-9) return { distribution: null, flags: ["use_of_funds:bad_total"], evidence: { investor, analyst } };

	const top = [...items]
		.sort((a, b) => b.value - a.value)
		.slice(0, 5)
		.map((it) => ({ label: it.label, value: it.value, pct_of_total: it.value / totalValue }));

	let percentColumnSum: NonNullable<ExcelSheetMetricsV1["distribution"]>["percent_column_sum"] | undefined;
	if (pctCol) {
		const pctVals = items.map((it) => it.pctRaw).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (pctVals.length >= Math.min(6, Math.ceil(items.length * 0.4))) {
			const max = Math.max(...pctVals.map((v) => Math.abs(v)));
			const expected: 1 | 100 = max <= 1.2 ? 1 : 100;
			const sum = pctVals.reduce((a, b) => a + b, 0);
			const within = expected === 1 ? Math.abs(sum - 1) <= 0.03 : Math.abs(sum - 100) <= 3;
			percentColumnSum = { value: sum, expected, within_tolerance: within };
			flags.push(within ? "use_of_funds:percent_sum_ok" : "use_of_funds:percent_sum_off");
		}
	}

	const distribution: ExcelSheetMetricsV1["distribution"] = {
		total_value: totalValue,
		top_categories: top,
		percent_column_sum: percentColumnSum,
	};

	const top1 = top[0];
	if (top1) {
		investor.push(
			`Top allocation appears to be ${top1.label} at ${formatCompactNumber(top1.value, input.currencyHint)} (${formatPct(top1.pct_of_total)} of total).`
		);
	}
	if (percentColumnSum) {
		analyst.push(
			`metrics_v1(use_of_funds): percent_col_sum=${percentColumnSum.value.toFixed(2)} vs expected=${percentColumnSum.expected} (within_tolerance=${percentColumnSum.within_tolerance}).`
		);
	}

	return { distribution, flags, evidence: { investor, analyst } };
}

function buildUseOfFundsDistributionFromGridPreview(input: {
	headers: string[];
	gridCells: any[];
	currencyHint: string | null;
}): {
	distribution: ExcelSheetMetricsV1["distribution"] | null;
	flags: string[];
	evidence: { investor: string[]; analyst: string[] };
} {
	const flags: string[] = [];
	const investor: string[] = [];
	const analyst: string[] = [];

	const cells = Array.isArray(input.gridCells) ? input.gridCells : [];
	if (cells.length === 0) return { distribution: null, flags: ["use_of_funds:no_grid_preview"], evidence: { investor, analyst } };

	const byAddr = new Map<string, any>();
	for (const c of cells) {
		const a = typeof c?.a === "string" ? c.a : "";
		if (!a) continue;
		byAddr.set(a.toUpperCase(), c);
	}

	const headers = Array.isArray(input.headers) ? input.headers.map((h) => cleanTextForClassification(h)).filter(Boolean) : [];
	const maxCols = Math.min(12, Math.max(3, headers.length));

	const getHeaderAt = (colLetter: string): string => {
		const c = byAddr.get(`${colLetter}1`);
		const h = cleanTextForClassification(c?.w ?? c?.v);
		if (h) return h;
		const idx = colLetter.charCodeAt(0) - "A".charCodeAt(0);
		return headers[idx] ?? colLetter;
	};

	const headerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
	const labelHints = ["category", "purpose", "allocation", "item", "description", "metric", "label", "col a", "col_a"];
	const amountHints = ["amount", "budget", "cost", "spend", "allocated", "usd", "value", "total"];
	const pctHints = ["%", "percent", "pct", "percentage", "share"];

	// Determine candidate columns A.. up to maxCols.
	const cols: Array<{ col: string; header: string }> = [];
	for (let i = 0; i < maxCols; i++) {
		cols.push({ col: String.fromCharCode("A".charCodeAt(0) + i), header: getHeaderAt(String.fromCharCode("A".charCodeAt(0) + i)) });
	}

	const colScores = cols.map((c) => {
		const n = headerNorm(c.header);
		return {
			...c,
			labelScore: labelHints.some((k) => n.includes(k)) ? 3 : 0,
			amountScore: amountHints.some((k) => n.includes(k)) ? 2 : 0,
			pctScore: pctHints.some((k) => n.includes(k)) ? 2 : 0,
		};
	});

	let labelCol = colScores.sort((a, b) => b.labelScore - a.labelScore)[0]?.col ?? "A";
	if (!labelCol) labelCol = "A";

	// Score amount column by numeric density in rows 2..18.
	const amountCandidates = cols
		.filter((c) => c.col !== labelCol)
		.map((c) => {
			let numericCount = 0;
			let total = 0;
			let max = -Infinity;
			for (let rr = 2; rr <= 18; rr++) {
				total += 1;
				const cell = byAddr.get(`${c.col}${rr}`);
				const n = parseExcelNumeric(cell?.v ?? cell?.w);
				if (n == null) continue;
				numericCount += 1;
				if (n > max) max = n;
			}
			const headerHint = colScores.find((s) => s.col === c.col)?.amountScore ?? 0;
			const density = total > 0 ? numericCount / total : 0;
			const mag = Number.isFinite(max) ? Math.min(3, Math.log10(Math.max(1, Math.abs(max))) / 2) : 0;
			return { col: c.col, header: c.header, score: headerHint + density + mag };
		})
		.sort((a, b) => b.score - a.score);

	const amountCol = amountCandidates[0]?.col;
	if (!amountCol) return { distribution: null, flags: ["use_of_funds:no_amount_col_grid"], evidence: { investor, analyst } };

	// Percent column detection.
	const pctCandidates = cols
		.filter((c) => c.col !== labelCol && c.col !== amountCol)
		.map((c) => {
			let numericCount = 0;
			let total = 0;
			let max = -Infinity;
			for (let rr = 2; rr <= 18; rr++) {
				total += 1;
				const cell = byAddr.get(`${c.col}${rr}`);
				const n = parseExcelNumeric(cell?.v ?? cell?.w);
				if (n == null) continue;
				numericCount += 1;
				if (n > max) max = n;
			}
			const hint = colScores.find((s) => s.col === c.col)?.pctScore ?? 0;
			const density = total > 0 ? numericCount / total : 0;
			const rangeScore = Number.isFinite(max) ? (Math.abs(max) <= 1.2 ? 3 : Math.abs(max) <= 120 ? 2 : 0) : 0;
			return { col: c.col, header: c.header, score: hint + density + rangeScore };
		})
		.sort((a, b) => b.score - a.score);
	const pctCol = pctCandidates[0]?.score > 1.5 ? pctCandidates[0].col : null;

	const items: Array<{ label: string; value: number; pctRaw: number | null }> = [];
	for (let rr = 2; rr <= 40; rr++) {
		const labelCell = byAddr.get(`${labelCol}${rr}`);
		const label = cleanTextForClassification(labelCell?.w ?? labelCell?.v)?.trim();
		if (!label) continue;
		if (/^total\b|\bsum\b|\bsubtotal\b/i.test(label)) continue;
		const valueCell = byAddr.get(`${amountCol}${rr}`);
		const value = parseExcelNumeric(valueCell?.v ?? valueCell?.w);
		if (value == null) continue;
		const pct = pctCol ? parseExcelNumeric(byAddr.get(`${pctCol}${rr}`)?.v ?? byAddr.get(`${pctCol}${rr}`)?.w) : null;
		items.push({ label, value, pctRaw: pct });
		if (items.length >= 40) break;
	}

	if (items.length < 2) return { distribution: null, flags: ["use_of_funds:insufficient_items_grid"], evidence: { investor, analyst } };

	const totalValue = items.reduce((acc, it) => acc + it.value, 0);
	if (!Number.isFinite(totalValue) || Math.abs(totalValue) < 1e-9) return { distribution: null, flags: ["use_of_funds:bad_total_grid"], evidence: { investor, analyst } };

	const top = [...items]
		.sort((a, b) => b.value - a.value)
		.slice(0, 5)
		.map((it) => ({ label: it.label, value: it.value, pct_of_total: it.value / totalValue }));

	let percentColumnSum: NonNullable<ExcelSheetMetricsV1["distribution"]>["percent_column_sum"] | undefined;
	if (pctCol) {
		const pctVals = items.map((it) => it.pctRaw).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (pctVals.length >= Math.min(4, Math.ceil(items.length * 0.4))) {
			const max = Math.max(...pctVals.map((v) => Math.abs(v)));
			const expected: 1 | 100 = max <= 1.2 ? 1 : 100;
			const sum = pctVals.reduce((a, b) => a + b, 0);
			const within = expected === 1 ? Math.abs(sum - 1) <= 0.05 : Math.abs(sum - 100) <= 5;
			percentColumnSum = { value: sum, expected, within_tolerance: within };
			flags.push(within ? "use_of_funds:percent_sum_ok" : "use_of_funds:percent_sum_off");
		}
	}

	const distribution: ExcelSheetMetricsV1["distribution"] = {
		total_value: totalValue,
		top_categories: top,
		percent_column_sum: percentColumnSum,
	};

	const top1 = top[0];
	if (top1) {
		investor.push(
			`Top allocation appears to be ${top1.label} at ${formatCompactNumber(top1.value, input.currencyHint)} (${formatPct(top1.pct_of_total)} of total).`
		);
	}
	if (percentColumnSum) {
		analyst.push(
			`metrics_v1(use_of_funds:grid_preview): percent_col_sum=${percentColumnSum.value.toFixed(2)} vs expected=${percentColumnSum.expected} (within_tolerance=${percentColumnSum.within_tolerance}).`
		);
	}

	return { distribution, flags, evidence: { investor, analyst } };
}

function isMonthHeaderToken(s: string): boolean {
	const t = String(s ?? "").trim().toLowerCase();
	if (!t) return false;
	if (/^month\s*\d+\b/.test(t)) return true;
	if (/^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/.test(t)) return true;
	if (/\bq[1-4]\b/.test(t)) return true;
	if (/^fy\s*\d{2,4}$/.test(t)) return true;
	if (/^\d{4}$/.test(t)) return true;
	return false;
}

function inferExcelDetectedType(textRaw: string): { type: ExcelSheetUnderstandingV1["detected_type"]; confidence: number; flags: string[] } {
	const t = String(textRaw ?? "").toLowerCase();
	const flags: string[] = [];
	if (!t.trim()) return { type: "unknown", confidence: 0.3, flags };

	const hasRevenue = /\b(revenue|revenues|sales|arr|mrr)\b/.test(t);
	const hasExpenses = /\b(expense|expenses|opex|operating expense|cogs|cost of goods)\b/.test(t);
	const hasCashFlow = /\b(cash flow|cashflow|burn|runway|cash balance)\b/.test(t);
	const hasUseOfFunds = /\b(use of funds|allocation of funds|funds allocation)\b/.test(t);
	const hasValuation = /\b(valuation|pre-money|post-money|waterfall|return multiple|exit)\b/.test(t);
	const hasCapTable = /\b(cap table|captable|ownership|dilution|option pool|share)\b/.test(t);

	if (hasUseOfFunds) return { type: "use_of_funds", confidence: 0.9, flags: ["matched:use_of_funds"] };
	if (hasCapTable) return { type: "cap_table", confidence: 0.85, flags: ["matched:cap_table"] };
	if (hasValuation) return { type: "valuation", confidence: 0.85, flags: ["matched:valuation"] };
	if (hasCashFlow) return { type: "cash_flow", confidence: 0.8, flags: ["matched:cash_flow"] };
	if (hasRevenue && !hasExpenses) return { type: "revenue", confidence: 0.75, flags: ["matched:revenue"] };
	if (hasExpenses && !hasRevenue) return { type: "expenses", confidence: 0.75, flags: ["matched:expenses"] };
	if (hasRevenue && hasExpenses) return { type: "financial_model", confidence: 0.7, flags: ["matched:revenue+expenses"] };

	return { type: "financial_model", confidence: 0.55, flags: ["default:financial_model"] };
}

function inferCurrencyHint(textRaw: string): string | null {
	const t = String(textRaw ?? "");
	if (!t) return null;
	if (/(\$|usd\b)/i.test(t)) return "USD";
	if (/(€|eur\b)/i.test(t)) return "EUR";
	if (/(£|gbp\b)/i.test(t)) return "GBP";
	return null;
}

function buildExcelSheetUnderstandingV1(input: {
	sheetName: string;
	segmentKey?: SegmentKey;
	headers: string[];
	rowCount?: number;
	numericColumns: string[];
	gridCells: any[];
	table?: ExcelTimeSeriesTableLite;
	sheetRows?: Array<Record<string, unknown>>;
}): { understanding: ExcelSheetUnderstandingV1; investor_summary: string; analyst_summary: string } {
	const headersSample = (Array.isArray(input.headers) ? input.headers : []).slice(0, 18).map((h) => cleanTextForClassification(h)).filter(Boolean);
	const numericColumnsSample = (Array.isArray(input.numericColumns) ? input.numericColumns : []).slice(0, 10).map((h) => cleanTextForClassification(h)).filter(Boolean);

	const colALabels: string[] = [];
	for (const c of Array.isArray(input.gridCells) ? input.gridCells : []) {
		const addr = typeof c?.a === "string" ? c.a : "";
		if (!addr) continue;
		// Prefer column A labels as the most common “row label” column.
		if (!/^A\d+$/i.test(addr)) continue;
		const label = cleanTextForClassification(c?.w ?? c?.v);
		if (!label) continue;
		// Skip obvious header-ish tokens
		if (isMonthHeaderToken(label)) continue;
		if (!colALabels.includes(label)) colALabels.push(label);
		if (colALabels.length >= 12) break;
	}

	// If there is no grid preview (common for structured-native Excel), fall back to table row labels.
	if (colALabels.length === 0 && input.table && Array.isArray(input.table.rows) && input.table.rows.length > 0) {
		for (const r of input.table.rows.slice(0, 18)) {
			const label = cleanTextForClassification((r as any)?.label);
			if (!label) continue;
			if (!colALabels.includes(label)) colALabels.push(label);
			if (colALabels.length >= 12) break;
		}
	}

	const classifyText = [
		input.sheetName ? `sheet: ${input.sheetName}` : "",
		headersSample.length ? `headers: ${headersSample.join(" ")}` : "",
		numericColumnsSample.length ? `numeric: ${numericColumnsSample.join(" ")}` : "",
		colALabels.length ? `labels: ${colALabels.join(" ")}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const detected = inferExcelDetectedType(classifyText);
	const currencyHint = inferCurrencyHint(classifyText);

	const timeHeadersSample = headersSample.filter(isMonthHeaderToken).slice(0, 10);
	const timeHeadersDetected = timeHeadersSample.length >= 2;
	let granularity: ExcelSheetUnderstandingV1["time"]["granularity"] = "unknown";
	if (timeHeadersDetected) {
		const joined = timeHeadersSample.join(" ").toLowerCase();
		if (/(month\s*\d+|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(joined)) granularity = "monthly";
		else if (/\bq[1-4]\b/.test(joined)) granularity = "quarterly";
		else if (/\b\d{4}\b|\bfy\b/.test(joined)) granularity = "annual";
	}

	const baseFlags = [
		...detected.flags,
		...(timeHeadersDetected ? ["time_headers_detected"] : ["time_headers_missing"]),
		...(currencyHint ? [`currency:${currencyHint}`] : []),
	].filter(Boolean);

	let metrics: ExcelSheetMetricsV1 | undefined;
	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];
	if (input.table && Array.isArray(input.table.value_cols) && Array.isArray(input.table.rows) && input.table.value_cols.length >= 2) {
		const res = buildMetricsFromTimeSeriesTable({
			detectedType: detected.type,
			granularity,
			currencyHint,
			table: input.table,
		});
		metrics = res.metrics;
		investorEvidence.push(...res.investorEvidence);
		analystEvidence.push(...res.analystEvidence);
	} else if (Array.isArray(input.gridCells) && input.gridCells.length > 0) {
		const res = buildMetricsFromGridPreview({
			detectedType: detected.type,
			granularity,
			currencyHint,
			headers: input.headers,
			gridCells: input.gridCells,
		});
		metrics = res.metrics;
		investorEvidence.push(...res.investorEvidence);
		analystEvidence.push(...res.analystEvidence);
	}

	// For use-of-funds style sheets, compute a distribution summary from sheet rows if available.
	if (detected.type === "use_of_funds" && Array.isArray(input.sheetRows) && input.sheetRows.length > 0) {
		const dist = buildUseOfFundsDistributionFromSheetRows({
			headers: Array.isArray(input.headers) ? input.headers : [],
			rows: input.sheetRows,
			currencyHint,
		});
		if (dist.distribution) {
			if (!metrics) {
				metrics = {
					schema_version: "excel_sheet_metrics_v1",
					source: "sheet_rows",
					distribution: dist.distribution,
					quality: { numeric_cells: 0, total_cells_scanned: 0, numeric_ratio: 0 },
					flags: [...dist.flags],
				};
			} else {
				metrics.distribution = dist.distribution;
				metrics.flags.push(...dist.flags);
				// If we already had another source, keep it but mark the distribution came from rows.
				if (metrics.source === "grid_preview" || metrics.source === "time_series_table") metrics.source = "sheet_rows";
			}
			// For use-of-funds, distribution evidence is usually the most relevant.
			investorEvidence.unshift(...dist.evidence.investor);
			analystEvidence.unshift(...dist.evidence.analyst);
		}
	}

	// Fallback: if we couldn't compute distribution from rows, try the grid preview.
	if (detected.type === "use_of_funds" && (!metrics?.distribution || metrics.distribution.top_categories.length === 0) && Array.isArray(input.gridCells)) {
		const dist = buildUseOfFundsDistributionFromGridPreview({
			headers: Array.isArray(input.headers) ? input.headers : [],
			gridCells: input.gridCells,
			currencyHint,
		});
		if (dist.distribution) {
			if (!metrics) {
				metrics = {
					schema_version: "excel_sheet_metrics_v1",
					source: "grid_preview",
					distribution: dist.distribution,
					quality: { numeric_cells: 0, total_cells_scanned: 0, numeric_ratio: 0 },
					flags: [...dist.flags],
				};
			} else {
				metrics.distribution = dist.distribution;
				metrics.flags.push(...dist.flags);
			}
			investorEvidence.unshift(...dist.evidence.investor);
			analystEvidence.unshift(...dist.evidence.analyst);
		}
	}

	const flags = [
		...baseFlags,
		...(metrics?.flags?.length
			? metrics.flags.map((f) => {
				const cleaned = String(f || "").replace(/^metrics:/, "");
				return cleaned ? `metrics:${cleaned}` : "";
			})
			: []),
	].filter(Boolean);

	const understanding: ExcelSheetUnderstandingV1 = {
		schema_version: "excel_sheet_understanding_v1",
		sheet_name: input.sheetName,
		detected_type: detected.type,
		confidence: Math.max(0.05, Math.min(1, detected.confidence)),
		segment_key: input.segmentKey,
		metrics_v1: metrics,
		structure: {
			row_count: typeof input.rowCount === "number" ? input.rowCount : undefined,
			header_count: Array.isArray(input.headers) ? input.headers.length : undefined,
			headers_sample: headersSample,
			row_labels_sample: colALabels,
			numeric_columns_sample: numericColumnsSample,
		},
		time: {
			granularity,
			headers_detected: timeHeadersDetected,
			time_headers_sample: timeHeadersSample,
		},
		units: {
			currency_hint: currencyHint,
		},
		flags,
	};

	const rowCountText = typeof understanding.structure.row_count === "number" ? `${understanding.structure.row_count}` : "an unknown number of";
	const headerCountText = typeof understanding.structure.header_count === "number" ? `${understanding.structure.header_count}` : "an unknown number of";
	const typeLabel = understanding.detected_type.replace(/_/g, " ");
	const timeText = understanding.time.headers_detected
		? `It appears to be organized as a ${understanding.time.granularity} time series.`
		: "Time-series headers were not clearly detected.";
	const buildInvestorHeadline = (): string => {
		const m = understanding.metrics_v1;
		if (understanding.detected_type === "use_of_funds" && m?.distribution) {
			const total = formatCompactNumber(m.distribution.total_value, understanding.units.currency_hint);
			const top1 = m.distribution.top_categories?.[0];
			const topText = top1
				? `Largest line item is ${top1.label} at ${formatCompactNumber(top1.value, understanding.units.currency_hint)} (${formatPct(top1.pct_of_total)} of total).`
				: "";
			const pctOk = m.distribution.percent_column_sum
				? m.distribution.percent_column_sum.within_tolerance
					? "Percent column sums look consistent."
					: "Percent column does not sum cleanly; treat the % breakdown as suspect until verified."
				: "";
			return [`Use of funds totals ${total}.`, topText, pctOk].filter(Boolean).join(" ").trim();
		}
		if (m?.key_series && m.key_series.start_value != null && m.key_series.end_value != null) {
			const startTxt = formatCompactNumber(m.key_series.start_value, understanding.units.currency_hint);
			const endTxt = formatCompactNumber(m.key_series.end_value, understanding.units.currency_hint);
			const growthTxt = typeof m.key_series.growth_pct === "number" ? ` (${formatPct(m.key_series.growth_pct)} change)` : "";
			const trend =
				typeof m.key_series.growth_pct === "number"
					? m.key_series.growth_pct > 0.2
						? "This suggests strong growth over the period."
						: m.key_series.growth_pct < -0.1
							? "This suggests a declining trajectory over the period."
							: "This suggests relatively stable performance over the period."
					: "";
			return [
				`${m.key_series.label} changes from ${startTxt} to ${endTxt} from ${m.key_series.start_period_label ?? "(start)"} to ${m.key_series.end_period_label ?? "(end)"}${growthTxt}.`,
				trend,
				m.key_series.missing_ratio > 0.35 ? "Note: many period values are missing." : "",
			]
				.filter(Boolean)
				.join(" ")
				.trim();
		}
		return "";
	};

	const investorHeadline = buildInvestorHeadline();
	const investor_summary = [
		investorHeadline,
		`${understanding.sheet_name} is classified as ${typeLabel}.`,
		timeText,
		understanding.units.currency_hint ? `Currency hint: ${understanding.units.currency_hint}.` : "",
		// Keep a secondary evidence sentence (if present) to help UI previews.
		investorEvidence.length && investorEvidence[0] !== investorHeadline ? investorEvidence[0] : "",
		`Structure: ${rowCountText} rows, ${headerCountText} columns.`,
	]
		.filter(Boolean)
		.join(" ")
		.trim();

	const analyst_summary = [
		`Detected type=${understanding.detected_type} (confidence=${understanding.confidence.toFixed(2)}), segment_key=${understanding.segment_key ?? "(none)"}.`,
		understanding.metrics_v1
			? `metrics_v1(source=${understanding.metrics_v1.source}): numeric_ratio=${understanding.metrics_v1.quality.numeric_ratio.toFixed(2)}.`
			: "metrics_v1: (none)",
		`Headers sample: ${understanding.structure.headers_sample.slice(0, 10).join(" | ") || "(none)"}.`,
		understanding.structure.row_labels_sample.length
			? `Row label sample (col A): ${understanding.structure.row_labels_sample.join(" | ")}.`
			: "Row label sample: (none detected from grid preview).",
		analystEvidence.length ? analystEvidence[0] : "",
		`Flags: ${understanding.flags.join(", ") || "(none)"}.`,
	]
		.filter(Boolean)
		.join(" ")
		.trim();

	return { understanding, investor_summary, analyst_summary };
}

function normalizeTextList(value: unknown, maxItems: number): string[] {
	const arr = Array.isArray(value) ? value : [];
	const out: string[] = [];
	for (const item of arr) {
		const t = cleanTextForClassification(item).trim();
		if (!t) continue;
		out.push(t);
		if (out.length >= maxItems) break;
	}
	return out;
}

function classifySegmentKeyFromText(textRaw: string, defaultKey: SegmentKey = "unknown"): SegmentKey {
	const text = String(textRaw || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return defaultKey;

	// API-aligned keyword sets (keep in sync with apps/api classifySegment headingSets).
	const keywordSets: Record<SegmentKey, string[]> = {
		overview: ["overview", "summary", "executive summary"],
		problem: ["problem", "pain", "challenge", "issue", "gap", "why this matters"],
		solution: ["solution", "approach", "value proposition", "why us"],
		product: ["product", "products", "technology", "features", "feature", "demo", "roadmap", "how it works"],
		market: ["market", "tam", "sam", "som", "opportunity", "segment", "sizing", "cagr"],
		traction: [
			"traction",
			"growth",
			"users",
			"customers",
			"mrr",
			"arr",
			"revenue",
			"retention",
			"pipeline",
			"gmv",
			"kpi",
			"conversion",
			"demo-to-close",
			"demo to close",
			"lift",
		],
		business_model: [
			"business model",
			"pricing",
			"revenue model",
			"unit economics",
			"how we make money",
			"saas",
			"platform",
			"add-ons",
			"addons",
			"subscription",
		],
		distribution: [
			"distribution",
			"go-to-market",
			"go to market",
			"gtm",
			"channels",
			"sales",
			"partnerships",
			"marketing",
			"reseller",
			"partners",
			"channel",
		],
		team: ["team", "founder", "ceo", "cto", "cfo", "bio", "leadership", "advisors", "founders", "meet our team"],
		competition: ["competition", "competitor", "alternative", "compare", "landscape", "moat"],
		risks: ["risk", "challenge", "threat", "mitigation", "compliance", "regulation", "limitation"],
		financials: [
			"financial",
			"financial strategy",
			"profit",
			"loss",
			"p&l",
			"balance",
			"cash",
			"projection",
			"forecast",
			"projections",
			"ebitda",
			"budget",
			"expenses",
			"gross margin",
			"revenue",
			"margin",
			"unit economics",
		],
		raise_terms: ["raise", "funding", "round", "terms", "cap table", "valuation", "use of funds", "investment"],
		exit: ["exit", "exit strategy", "acquisition", "m&a", "strategic options", "acquirer", "acquirers", "strategic buyers"],
		unknown: [],
	};

	const weights: Record<SegmentKey, number> = {
		overview: 1,
		problem: 3,
		solution: 3,
		product: 3,
		market: 3,
		traction: 3,
		business_model: 2,
		distribution: 2,
		team: 2,
		competition: 2,
		risks: 2,
		financials: 3,
		raise_terms: 3,
		exit: 2,
		unknown: 0,
	};

	const scoreByKey = new Map<SegmentKey, number>();
	for (const [key, phrases] of Object.entries(keywordSets) as Array<[SegmentKey, string[]]>) {
		if (key === "unknown") continue;
		let score = 0;
		for (const phrase of phrases) {
			if (!phrase) continue;
			if (text.includes(phrase.toLowerCase())) score += weights[key];
		}
		if (score > 0) scoreByKey.set(key, score);
	}

	let best: SegmentKey = defaultKey;
	let bestScore = 0;
	let secondScore = 0;
	for (const [k, s] of scoreByKey.entries()) {
		if (s > bestScore) {
			secondScore = bestScore;
			bestScore = s;
			best = k;
		} else if (s > secondScore) {
			secondScore = s;
		}
	}

	// Confidence gating: keep deterministic, but avoid over-assigning from weak signal.
	const MIN_SCORE = 2;
	const MIN_MARGIN = 1;
	if (bestScore < MIN_SCORE) return defaultKey;
	if (secondScore > 0 && bestScore < secondScore + MIN_MARGIN) return defaultKey;
	return best;
}

export function inferSegmentKeyFromStructured(params: {
	structuredJson: unknown;
	source: string;
	documentTitle?: string | null;
}): SegmentKey {
	const sj = (params.structuredJson ?? {}) as any;
	const docTitle = typeof params.documentTitle === "string" ? params.documentTitle : "";
	const title = cleanTextForClassification(sj?.title);
	const textSnippet = cleanTextForClassification(sj?.text_snippet);
	const heading = cleanTextForClassification(sj?.heading);
	const bullets = normalizeTextList(sj?.bullets, 20).join("\n");
	const paragraphs = normalizeTextList(sj?.paragraphs, 20).join("\n");
	const sheetName = cleanTextForClassification(sj?.sheet_name);
	const headers = normalizeTextList(sj?.headers, 20).join("\n");
	const numericColumns = normalizeTextList(sj?.numeric_columns, 20).join("\n");
	const sampleRows = Array.isArray(sj?.sample_rows) ? sj.sample_rows : [];
	const firstRowPreview = Array.isArray(sampleRows?.[0])
		? sampleRows[0].slice(0, 20).map((v: any) => cleanTextForClassification(v)).filter(Boolean).join(" ")
		: "";

	const combined = [
		docTitle,
		title,
		heading,
		textSnippet,
		bullets,
		paragraphs,
		sheetName ? `sheet: ${sheetName}` : "",
		headers ? `headers: ${headers}` : "",
		numericColumns ? `numeric: ${numericColumns}` : "",
		firstRowPreview ? `row0: ${firstRowPreview}` : "",
	]
		.filter(Boolean)
		.join("\n");

	// Excel defaults to financials unless there's a stronger signal.
	if (params.source === "structured_excel") {
		const inferred = classifySegmentKeyFromText(combined, "financials");
		return inferred || "financials";
	}

	return classifySegmentKeyFromText(combined, "unknown");
}

export async function resegmentStructuredSyntheticAssets(params: {
	pool: Pool;
	documentId: string;
	documentTitle?: string | null;
}): Promise<{ updated_assets: number; updated_extractions: number }> {
	const sources = ["structured_word", "structured_powerpoint", "structured_excel"];
	const { rows } = await params.pool.query<{
		id: string;
		quality_flags: any;
		structured_json: any;
	}> (
		`SELECT va.id,
		        va.quality_flags,
		        ve.structured_json
		   FROM visual_assets va
		   LEFT JOIN visual_extractions ve
		     ON ve.visual_asset_id = va.id
		    AND ve.extractor_version = va.extractor_version
		  WHERE va.document_id = $1
		    AND (va.quality_flags->>'source') = ANY($2)`,
		[sanitizeText(params.documentId), sources]
	);

	let updatedAssets = 0;
	let updatedExtractions = 0;
	for (const row of rows) {
		const source = typeof row?.quality_flags?.source === "string" ? row.quality_flags.source : "";
		if (!source) continue;
		const inferred = inferSegmentKeyFromStructured({
			structuredJson: row.structured_json,
			source,
			documentTitle: params.documentTitle ?? null,
		});
		if (!inferred) continue;

		const seg = String(inferred);
		// Update visual_assets.quality_flags.segment_key
		const res1 = await params.pool.query(
			`UPDATE visual_assets
			    SET quality_flags = jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedAssets += (res1 as any)?.rowCount ?? 0;

		// Update visual_extractions.structured_json.segment_key (debug/secondary)
		const res2 = await params.pool.query(
			`UPDATE visual_extractions
			    SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE visual_asset_id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedExtractions += (res2 as any)?.rowCount ?? 0;
	}

	return { updated_assets: updatedAssets, updated_extractions: updatedExtractions };
}

function buildSyntheticAssets(params: {
	docKind: string;
	structuredData: any;
	fullContent: any;
}): SyntheticAssetBuild[] {
	const out: SyntheticAssetBuild[] = [];
	const kind = params.docKind;

	const coalesceWordSections = (sectionsIn: any[]): any[] => {
		// Goal: preserve text fidelity while producing a bounded number of nodes suitable for
		// per-segment scoring. We bucket paragraph-level text into segment-specific chunks.
		const MAX_SECTIONS_SCANNED = 200;
		const MAX_CHUNKS_EMITTED = 25;
		const MAX_PARAGRAPHS_PER_CHUNK = 18;
		const MAX_CLASSIFY_TEXT_CHARS = 2400;
		const MAX_TEXT_SNIPPET_CHARS = 900;

		type NormSection = {
			heading: string | null;
			level: number | null;
			paragraphs: string[];
			tableRows: unknown[];
			textSnippet: string;
			segmentKey: SegmentKey;
		};

		const normalizeSection = (section: any): NormSection | null => {
			const heading = cleanTextForClassification(section?.heading) || null;
			const paragraphsRawUnknown = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
			const paragraphsRaw = paragraphsRawUnknown
				.map((p: unknown) => toTextLoose(p))
				.map((p: string) => p.trim())
				.filter(Boolean);
			const paragraphs = normalizeTextList(paragraphsRaw, 30);
			const tableRows = Array.isArray(section?.tables?.[0]?.rows) ? section.tables[0].rows.slice(0, 5) : [];
			const sectionText = cleanTextForClassification(section?.text);
			const textSnippetBase = sectionText || paragraphs.join(" ");
			const textSnippet = textSnippetBase ? textSnippetBase.slice(0, MAX_TEXT_SNIPPET_CHARS) : "";

			if (isEmptyWordSection({ heading, textSnippet, paragraphs, tableRows })) return null;

			const classifyText = [heading ?? "", textSnippet, paragraphs.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			return {
				heading,
				level: typeof section?.level === "number" ? section.level : null,
				paragraphs,
				tableRows,
				textSnippet,
				segmentKey,
			};
		};

		type SegmentBucket = {
			headings: string[];
			paragraphs: string[];
			unit_count: number;
		};

		const tableItems: any[] = [];
		const buckets = new Map<SegmentKey, SegmentBucket>();
		const getBucket = (k: SegmentKey): SegmentBucket => {
			const existing = buckets.get(k);
			if (existing) return existing;
			const created: SegmentBucket = { headings: [], paragraphs: [], unit_count: 0 };
			buckets.set(k, created);
			return created;
		};

		const sections = sectionsIn.slice(0, MAX_SECTIONS_SCANNED).map(normalizeSection).filter(Boolean) as NormSection[];
		for (const s of sections) {
			// Emit tables as their own items (high signal, often financials/traction).
			if (Array.isArray(s.tableRows) && s.tableRows.length > 0) {
				const cellTexts: string[] = [];
				for (const row of s.tableRows.slice(0, 6) as any[]) {
					if (!Array.isArray(row)) continue;
					for (const cell of row.slice(0, 10)) {
						const t = cleanTextForClassification(cell);
						if (t) cellTexts.push(t);
						if (cellTexts.length >= 60) break;
					}
					if (cellTexts.length >= 60) break;
				}
				const classifyText = [s.heading ?? "", cellTexts.join(" "), s.textSnippet].filter(Boolean).join("\n").slice(0, MAX_CLASSIFY_TEXT_CHARS);
				const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
				tableItems.push({
					kind: "word_section",
					segment_key: segmentKey,
					heading: s.heading,
					level: s.level,
					text_snippet: s.textSnippet,
					paragraphs: [],
					table_rows: s.tableRows,
					member_count: 1,
					member_segment_keys: [segmentKey],
				});
			}

			const headingKey = s.heading ? classifySegmentKeyFromText(s.heading, "unknown") : "unknown";
			const unitTexts = s.paragraphs.length > 0 ? s.paragraphs : s.textSnippet ? [s.textSnippet] : [];
			for (const unit of unitTexts) {
				const combined = [s.heading ?? "", unit].filter(Boolean).join("\n");
				let seg = classifySegmentKeyFromText(combined, "unknown");
				if (seg === "unknown" && headingKey !== "unknown") seg = headingKey;
				const bucket = getBucket(seg);
				if (s.heading) bucket.headings.push(s.heading);
				bucket.paragraphs.push(unit);
				bucket.unit_count += 1;
			}
		}

		const outItems: any[] = [];
		// Prefer deterministic segment order; emit unknown last.
		const orderedSegments: SegmentKey[] = [...SEGMENT_KEYS];
		for (const seg of orderedSegments) {
			const bucket = buckets.get(seg);
			if (!bucket) continue;
			const headings = normalizeTextList(bucket.headings, 12);
			// Split into multiple chunks if needed.
			let chunkIndex = 0;
			let cursor = 0;
			while (cursor < bucket.paragraphs.length && outItems.length < MAX_CHUNKS_EMITTED) {
				chunkIndex += 1;
				const paras = bucket.paragraphs.slice(cursor, cursor + MAX_PARAGRAPHS_PER_CHUNK);
				cursor += MAX_PARAGRAPHS_PER_CHUNK;
				const paragraphs = normalizeTextList(paras, MAX_PARAGRAPHS_PER_CHUNK);
				const heading = seg !== "unknown" ? seg : headings[0] ?? null;
				const textSnippet = cleanTextForClassification(paragraphs.join("\n")).slice(0, MAX_TEXT_SNIPPET_CHARS);
				const classifyText = [headings.join("\n"), textSnippet, paragraphs.join("\n")]
					.filter(Boolean)
					.join("\n")
					.slice(0, MAX_CLASSIFY_TEXT_CHARS);
				const stableSeg = seg !== "unknown" ? seg : classifySegmentKeyFromText(classifyText, "unknown");

				outItems.push({
					kind: "word_section",
					segment_key: stableSeg,
					heading,
					headings,
					level: null,
					text_snippet: textSnippet,
					paragraphs,
					table_rows: [],
					member_count: paragraphs.length,
					member_segment_keys: Array.from({ length: paragraphs.length }).map(() => stableSeg),
					chunk_index: chunkIndex,
				});
			}
		}

		return [...tableItems, ...outItems].slice(0, MAX_CHUNKS_EMITTED);
	};

	const hasAnyTableContent = (rows: unknown): boolean => {
		if (!Array.isArray(rows) || rows.length === 0) return false;
		for (const row of rows) {
			if (!Array.isArray(row)) continue;
			for (const cell of row) {
				const t = cleanTextForClassification(cell);
				if (t) return true;
			}
		}
		return false;
	};

	const isEmptyWordSection = (section: {
		heading: string | null;
		textSnippet: string;
		paragraphs: string[];
		tableRows: unknown[];
	}): boolean => {
		const hasHeading = typeof section.heading === "string" && section.heading.trim().length > 0;
		const hasSnippet = typeof section.textSnippet === "string" && section.textSnippet.trim().length > 0;
		const hasParagraphs = Array.isArray(section.paragraphs) && section.paragraphs.some((p) => typeof p === "string" && p.trim().length > 0);
		const hasTable = hasAnyTableContent(section.tableRows);
		return !hasHeading && !hasSnippet && !hasParagraphs && !hasTable;
	};

	if (kind === "excel") {
		const forceExcelSegmentKey = (segmentKey: SegmentKey, classifyText: string): SegmentKey => {
			const t = (classifyText ?? "").toLowerCase();
			const financialSignal = /\b(revenue|revenues|cogs|cost of goods|gross margin|gross profit|expenses|opex|operating expense|p\s*&\s*l|income statement|ebitda|cash balance|cashflow|cash flow|burn|runway|balance sheet|arr|mrr|unit economics)\b/.test(
				t
			);
			const raiseSignal = /\b(cap table|captable|ownership|dilution|valuation|pre-money|post-money|round|financing|raise|use of funds|allocation of funds|term sheet|safe\b|convertible note|note\b)\b/.test(
				t
			);
			if (financialSignal && !raiseSignal) return "financials";
			if (raiseSignal && !financialSignal) return "raise_terms";
			return segmentKey;
		};

		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		sheets.forEach((sheet: any, idx: number) => {
			const sheetName = sheet?.name ?? `Sheet ${idx + 1}`;
			const sheetPageIndex = idx;
			const headers = Array.isArray(sheet?.headers) ? sheet.headers.slice(0, 50) : [];
			const rowCount = typeof sheet?.summary?.totalRows === "number" ? sheet.summary.totalRows : (Array.isArray(sheet?.rows) ? sheet.rows.length : 0);
			const numericColumns = Array.isArray(sheet?.summary?.numericColumns) ? sheet.summary.numericColumns.slice(0, 25) : [];
			const tables = Array.isArray(sheet?.tables) ? sheet.tables : [];
			const gridCells = Array.isArray(sheet?.gridPreview?.cells) ? sheet.gridPreview.cells : [];

			const gridPreviewText = gridCells
				.slice(0, 60)
				.map((c: any) => cleanTextForClassification(c?.w ?? c?.v ?? c?.f))
				.filter(Boolean)
				.join(" ")
				.slice(0, 800);

			// Prefer table-derived structured assets (more signal) if present.
			if (tables.length > 0) {
				for (const [tableIdx, t] of tables.slice(0, 6).entries()) {
					const cols = Array.isArray(t?.value_cols) ? t.value_cols : [];
					const rowLabels = Array.isArray(t?.rows) ? t.rows.slice(0, 10).map((r: any) => cleanTextForClassification(r?.label)).filter(Boolean) : [];
					const classifyText = [
						sheetName ? `sheet: ${sheetName}` : "",
						t?.name ? `table: ${t.name}` : "",
						cols.length ? `cols: ${cols.map((c: any) => c?.header ?? c?.col).filter(Boolean).join(" ")}` : "",
						rowLabels.length ? `rows: ${rowLabels.join(" ")}` : "",
					]
						.filter(Boolean)
						.join("\n");
					const segmentKey = forceExcelSegmentKey(classifySegmentKeyFromText(classifyText, "financials"), classifyText);
					const summary = buildExcelSheetUnderstandingV1({
						sheetName,
						segmentKey,
						headers: normalizeTextList(cols.map((c: any) => c?.header ?? c?.col), 40),
						rowCount: Array.isArray(t?.rows) ? t.rows.length : undefined,
						numericColumns: normalizeTextList(cols.map((c: any) => c?.header ?? c?.col), 25),
						gridCells,
						table: t as any,
					});
					const structuredJson = {
						kind: "excel_sheet",
						segment_key: segmentKey,
						sheet_name: sheetName,
						table: t,
						summary: sheet?.summary ?? {},
						understanding_v1: summary.understanding,
						summary_text_investor: summary.investor_summary,
						summary_text_analyst: summary.analyst_summary,
					};
					out.push({
						pageIndex: sheetPageIndex,
						asset: {
							asset_type: "table",
							bbox: { x: 0, y: 0, w: 1, h: 1 },
							confidence: 0.9,
							quality_flags: { source: "structured_excel", segment_key: segmentKey },
							image_uri: null,
							image_hash: hashKey([params.docKind, sheetName, t?.name ?? tableIdx, "table"]),
							extraction: {
								ocr_text: null,
								ocr_blocks: [],
								structured_json: structuredJson,
								units: null,
								labels: { source: "structured_excel" },
								model_version: null,
								confidence: 0.9,
							},
						},
					});
				}
			}

			// Fallback: emit a sheet-summary synthetic asset.
			const classifyText = [
				sheetName ? `sheet: ${sheetName}` : "",
				headers?.length ? `headers: ${headers.join(" ")}` : "",
				numericColumns?.length ? `numeric: ${numericColumns.join(" ")}` : "",
				gridPreviewText ? `preview: ${gridPreviewText}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const segmentKey = forceExcelSegmentKey(classifySegmentKeyFromText(classifyText, "financials"), classifyText);
			const summary = buildExcelSheetUnderstandingV1({
				sheetName,
				segmentKey,
				headers,
				rowCount,
				numericColumns,
				gridCells,
				sheetRows: Array.isArray(sheet?.rows) ? (sheet.rows as any[]) : undefined,
			});
			const structuredJson = {
				kind: "excel_sheet",
				segment_key: segmentKey,
				sheet_name: sheetName,
				headers,
				row_count: rowCount,
				grid_preview: { maxRows: sheet?.gridPreview?.maxRows, maxCols: sheet?.gridPreview?.maxCols, cells: gridCells.slice(0, 200) },
				summary: sheet?.summary ?? {},
				understanding_v1: summary.understanding,
				summary_text_investor: summary.investor_summary,
				summary_text_analyst: summary.analyst_summary,
			};
			out.push({
				pageIndex: sheetPageIndex,
				asset: {
					asset_type: "table",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.9,
					quality_flags: { source: "structured_excel", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, sheetName, "sheet"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_excel" },
						model_version: null,
						confidence: 0.9,
					},
				},
			});
		});
		return out;
	}

	if (kind === "word") {
		const sections = Array.isArray(params.fullContent?.sections) ? params.fullContent.sections : [];
		const coalesced = coalesceWordSections(sections);
		coalesced.forEach((structuredJson: any, idx: number) => {
			const segmentKey = coerceSegmentKey(structuredJson?.segment_key) ?? "unknown";
			const heading = cleanTextForClassification(structuredJson?.heading) || null;
			const tableRows = Array.isArray(structuredJson?.table_rows) ? structuredJson.table_rows : [];
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: tableRows.length > 0 ? "table" : "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_word", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, heading ?? idx, tableRows.length > 0 ? "table" : "text"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_word" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
		return out;
	}

	if (kind === "powerpoint") {
		const slides = Array.isArray(params.fullContent?.slides) ? params.fullContent.slides : [];
		slides.slice(0, 50).forEach((slide: any, idx: number) => {
			const bullets = normalizeTextList(slide?.bullets, 15);
			const title = typeof slide?.title === "string" ? slide.title : null;
			const textSnippet = typeof slide?.text === "string" ? slide.text.slice(0, 500) : "";
			const classifyText = [title ?? "", textSnippet, bullets.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			const structuredJson = {
				kind: "powerpoint_slide",
				segment_key: segmentKey,
				slide_number: typeof slide?.slideNumber === "number" ? slide.slideNumber : idx + 1,
				title,
				bullets,
				text_snippet: textSnippet,
				notes: typeof slide?.notes === "string" ? slide.notes.slice(0, 500) : null,
				images: Array.isArray(slide?.images) ? slide.images : [],
			};
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_powerpoint", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, structuredJson.slide_number ?? idx]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_powerpoint" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
	}

	return out;
}

export async function persistSyntheticVisualAssets(params: {
	pool: Pool;
	documentId: string;
	docKind: string;
	structuredData: any;
	fullContent: any;
	extractorVersion?: string;
	env?: NodeJS.ProcessEnv;
}): Promise<number> {
	const env = params.env ?? process.env;
	const extractorVersion = params.extractorVersion ?? "structured_native_v1";

	const cleanupStaleExcelSheetSummaries = async (): Promise<void> => {
		if (params.docKind !== "excel") return;
		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		const sheetNames = sheets
			.map((s: any, idx: number) => (typeof s?.name === "string" && s.name.trim() ? s.name.trim() : `Sheet ${idx + 1}`))
			.filter((n: any) => typeof n === "string" && n.length > 0);
		if (sheetNames.length === 0) return;
		const stableSheetHashes = sheetNames.map((name: string) => hashKey(["excel", name, "sheet"]));

		// Remove stale/legacy synthetic sheet-summary assets so lineage doesn't accumulate duplicates.
		// Criteria:
		// - structured synthetic extractor version
		// - kind=excel_sheet + has headers (sheet-summary, not table-derived)
		// - sheet_name in this document's current sheets
		// - either image_hash is not one of the stable per-sheet hashes OR headers contain __EMPTY*
		await params.pool.query(
			`
			WITH stale AS (
				SELECT va.id
				FROM visual_assets va
				JOIN visual_extractions ve
				  ON ve.visual_asset_id = va.id
				 AND ve.extractor_version = va.extractor_version
				WHERE va.document_id = $1
				  AND va.extractor_version = $2
				  AND (ve.structured_json->>'kind') = 'excel_sheet'
				  AND (ve.structured_json ? 'headers')
				  AND (ve.structured_json->>'sheet_name') = ANY($3::text[])
				  AND (
					va.image_hash IS NULL
					OR NOT (va.image_hash = ANY($4::text[]))
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements_text(ve.structured_json->'headers') AS h(value)
						WHERE value ILIKE '__empty%'
					)
				  )
			)
			DELETE FROM visual_assets
			WHERE id IN (SELECT id FROM stale)
			`,
			[params.documentId, extractorVersion, sheetNames, stableSheetHashes]
		);
	};

	await cleanupStaleExcelSheetSummaries();
	const assets = buildSyntheticAssets({ docKind: params.docKind, structuredData: params.structuredData, fullContent: params.fullContent });
	if (assets.length === 0) return 0;

	let persisted = 0;
	const grouped = new Map<number, VisionAsset[]>();
	for (const entry of assets) {
		const list = grouped.get(entry.pageIndex) ?? [];
		list.push(entry.asset);
		grouped.set(entry.pageIndex, list);
	}

	for (const [pageIndex, assetList] of grouped.entries()) {
		const response: VisionExtractResponse = {
			document_id: params.documentId,
			page_index: pageIndex,
			extractor_version: extractorVersion,
			assets: assetList,
		};
		const { persisted: pCount } = await persistVisionResponse(params.pool, response, { pageImageUri: null, env });
		persisted += pCount;
	}

	return persisted;
}

export async function enqueueExtractVisualsIfPossible(params: {
	pool: Pool;
	queue: { add: (name: string, data: any, opts?: any) => Promise<unknown> };
	config: VisionExtractorConfig;
	documentId: string;
	dealId: string;
	logger?: LogLike;
	resolveOptions?: { fsImpl?: FsLike; env?: NodeJS.ProcessEnv };
}): Promise<boolean> {
	const logger = params.logger ?? console;
	if (!params.config.enabled) {
		// Optional fail-safe warning: once per process, when ingest completion tries to enqueue visuals.
		// Only warn for unset or explicit "0" to avoid noisy logs for other falsey values.
		const raw = process.env.ENABLE_VISUAL_EXTRACTION;
		const normalized = typeof raw === "string" ? raw.trim() : "";
		if (!didWarnVisualExtractionDisabled && (normalized.length === 0 || normalized === "0")) {
			didWarnVisualExtractionDisabled = true;
			logger.warn("Visual extraction disabled: ENABLE_VISUAL_EXTRACTION not set");
		}
		return false;
	}

	const imageUris = await resolvePageImageUris(params.pool, params.documentId, {
		logger,
		fsImpl: params.resolveOptions?.fsImpl,
		env: params.resolveOptions?.env,
	});
	if (imageUris.length === 0) return false;

	await params.queue.add(
		"extract_visuals",
		{
			document_id: params.documentId,
			deal_id: params.dealId,
			extractor_version: params.config.extractorVersion,
			image_uris: imageUris,
		},
		{ removeOnComplete: true, removeOnFail: false, delay: 750 }
	);
	logger.log(
		JSON.stringify({
			event: "extract_visuals_enqueued",
			document_id: params.documentId,
			pages: imageUris.length,
		})
	);
	return true;
}
