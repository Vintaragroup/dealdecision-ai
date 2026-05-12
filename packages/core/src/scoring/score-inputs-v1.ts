import { createHash } from "crypto";
import { stableJsonStringify } from "../lib/stable-json";

export type ScoreInputsV1KpiKey =
	| "revenue"
	| "customers"
	| "growth"
	| "marketing_attributed_revenue_email_sms"
	| "paid_media_conversion_pct"
	| "first_party_database_size"
	| "first_party_database_active_pct";

export type ScoreInputsV1Kpi = {
	key: ScoreInputsV1KpiKey;
	confidence: number;
	sources: Array<{
		document_id: string | null;
		page_index: number | null;
	}>;
	value_raw?: string | null;
};

export type ScoreInputsV1 = {
	version: "deterministic_score_inputs_v1";
	inputs_hash: string;
	segments: {
		total_nodes: number;
		counts: Record<string, number>;
		override_ratio: number | null;
		overridden_nodes: number | null;
	};
	deck: {
		deck_archetype_key: string | null;
		drift_assessment: "aligned" | "mostly_aligned" | "misaligned" | "unknown";
	};
	kpis: ScoreInputsV1Kpi[];
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const asObject = (v: unknown): Record<string, unknown> | null =>
	v != null && typeof v === "object" ? (v as Record<string, unknown>) : null;

const normalizeKey = (s: string): string =>
	s
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_{2,}/g, "_");

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

function extractSegmentCounts(nodes: any[]): { total: number; counts: Record<string, number> } {
	const counts: Record<string, number> = {};
	const arr = Array.isArray(nodes) ? nodes : [];
	for (const n of arr) {
		const k = asString((n as any)?.segment_key) ?? "unknown";
		counts[k] = (counts[k] ?? 0) + 1;
	}
	return { total: arr.length, counts };
}

function extractOverrideStats(nodes: any[]): { overridden_nodes: number | null; override_ratio: number | null } {
	const arr = Array.isArray(nodes) ? nodes : [];
	if (arr.length === 0) return { overridden_nodes: null, override_ratio: null };
	let overridden = 0;
	for (const n of arr) {
		const rules: unknown = (n as any)?.segment_reason?.rules_hit;
		const hit = Array.isArray(rules)
			? rules.some((r) => typeof r === "string" && r.startsWith("segmenter:override:"))
			: false;
		if (hit) overridden += 1;
	}
	return {
		overridden_nodes: overridden,
		override_ratio: clamp01(overridden / arr.length),
	};
}

function kpiFromStructured(structured_summary: any, key: ScoreInputsV1KpiKey): ScoreInputsV1Kpi {
	const root = asObject(structured_summary);
	if (!root) return { key, confidence: 0, sources: [], value_raw: null };

	const get = (path: string[]): any => {
		let cur: any = root;
		for (const p of path) {
			if (!cur || typeof cur !== "object") return null;
			cur = (cur as any)[p];
		}
		return cur;
	};

	const field = (() => {
		switch (key) {
			case "revenue":
			case "customers":
			case "growth":
				return (root as any)[key];
			case "marketing_attributed_revenue_email_sms":
				return get(["marketing_metrics", "attributed_revenue"]);
			case "paid_media_conversion_pct":
				return get(["marketing_metrics", "paid_media_conversion_pct"]);
			case "first_party_database_size":
				return get(["marketing_metrics", "first_party_database_size"]);
			case "first_party_database_active_pct":
				return get(["marketing_metrics", "first_party_database_active_pct"]);
			default:
				return null;
		}
	})();

	// If the field doesn't exist in structured_summary, still return a stable empty KPI.
	if (!field || typeof field !== "object") return { key, confidence: 0, sources: [], value_raw: null };

	// Special-case: attributed revenue is only meaningful when the channel is email/SMS.
	if (key === "marketing_attributed_revenue_email_sms") {
		const channel = asString((field as any)?.channel);
		if (channel && normalizeKey(channel) !== "email_sms") {
			return { key, confidence: 0, sources: [], value_raw: null };
		}
	}

	const confidence = asNumber((field as any)?.confidence) ?? 0;
	const sourcesRaw: unknown = (field as any)?.sources;
	const sourcesArr: any[] = Array.isArray(sourcesRaw) ? sourcesRaw : [];

	const sources = sourcesArr
		.map((s) => {
			const docId = asString(s?.source_document_id) ?? asString(s?.document_id) ?? null;
			const pageIndex = asNumber(s?.page_index);
			return { document_id: docId, page_index: pageIndex };
		})
		.filter((s) => s.document_id != null || s.page_index != null);

	let value_raw: string | null = null;
	const v = (field as any)?.value;
	if (typeof (field as any)?.value_raw === "string") value_raw = asString((field as any).value_raw);
	else if (typeof v === "string") value_raw = v;
	else if (v && typeof v === "object") {
		value_raw = asString((v as any).raw) ?? asString((v as any).value) ?? null;
	}

	return {
		key,
		confidence: clamp01(confidence),
		sources,
		value_raw,
	};
}

function kpiFromInputDocuments(inputDocuments: unknown, key: ScoreInputsV1KpiKey): ScoreInputsV1Kpi {
	const docs: any[] = Array.isArray(inputDocuments) ? (inputDocuments as any[]) : [];
	const normalizedTarget = normalizeKey(key);

	for (const doc of docs) {
		const metrics: any[] = Array.isArray(doc?.metrics) ? doc.metrics : [];
		for (const m of metrics) {
			const mk = asString(m?.key) ?? asString(m?.name) ?? null;
			if (!mk) continue;
			if (normalizeKey(mk) !== normalizedTarget) continue;

			const confidence = clamp01(asNumber(m?.confidence) ?? 0.7);
			const value_raw = asString(m?.raw) ?? asString(m?.value) ?? (m?.value != null ? String(m.value) : null);
			const document_id = asString(m?.document_id) ?? asString(m?.source_document_id) ?? asString(doc?.document_id) ?? asString(doc?.id) ?? null;
			const page_index = asNumber(m?.page_index);

			return {
				key,
				confidence,
				sources: [{ document_id, page_index }].filter((s) => s.document_id != null || s.page_index != null),
				value_raw,
			};
		}
	}

	return { key, confidence: 0, sources: [], value_raw: null };
}

function driftAssessmentFromMetadata(metadata: any): ScoreInputsV1["deck"]["drift_assessment"] {
	const m = asObject(metadata);
	const drift = m ? (m as any).archetype_segment_drift_v1 : null;
	const a = asString(drift?.overall_assessment);
	if (a === "aligned" || a === "mostly_aligned" || a === "misaligned") return a;
	return "unknown";
}

function deckArchetypeKeyFromMetadata(metadata: any): string | null {
	const m = asObject(metadata);
	const da = m ? (m as any).deck_archetype : null;
	const key = asString(da?.key);
	return key;
}

export function buildDeterministicScoreInputsV1(args: {
	structured_summary: any;
	segmented_nodes: any[];
	metadata: any;
	// Optional: if present, we can surface additional traction/marketing KPIs even when
	// structured_summary doesn't (yet) include them.
	input_documents?: any[];
}): ScoreInputsV1 {
	const { total, counts } = extractSegmentCounts(args.segmented_nodes);
	const overrides = extractOverrideStats(args.segmented_nodes);
	const driftAssessment = driftAssessmentFromMetadata(args.metadata);
	const deckKey = deckArchetypeKeyFromMetadata(args.metadata);

	const kpiKeys: ScoreInputsV1KpiKey[] = [
		"revenue",
		"customers",
		"growth",
		"marketing_attributed_revenue_email_sms",
		"paid_media_conversion_pct",
		"first_party_database_size",
		"first_party_database_active_pct",
	];

	const kpis: ScoreInputsV1Kpi[] = kpiKeys
		.map((k) => {
			const fromStructured = kpiFromStructured(args.structured_summary, k);
			// A field nulled by a guard (applyFinalPublishGuard / field_authority_guard) has
			// confidence=0 and value_raw=null but may retain sources[] for provenance.
			// Treat this as "missing data" and fall back to input_documents — never use the
			// nulled value as a negative signal against the deal.
			const isNulledByGuard = fromStructured.confidence === 0 && fromStructured.value_raw == null;
			if (!isNulledByGuard && (fromStructured.value_raw != null || fromStructured.sources.length > 0 || fromStructured.confidence > 0)) return fromStructured;
			return kpiFromInputDocuments(args.input_documents, k);
		})
		.sort((a, b) => a.key.localeCompare(b.key));

	const unsigned: Omit<ScoreInputsV1, "inputs_hash"> = {
		version: "deterministic_score_inputs_v1",
		segments: {
			total_nodes: total,
			counts,
			override_ratio: overrides.override_ratio,
			overridden_nodes: overrides.overridden_nodes,
		},
		deck: {
			deck_archetype_key: deckKey,
			drift_assessment: driftAssessment,
		},
		kpis,
	};

	const inputs_hash = sha256Hex(stableJsonStringify(unsigned));
	return { ...unsigned, inputs_hash };
}
