import { createHash } from "crypto";
import { stableJsonStringify } from "../lib/stable-json";

export type ScoreInputsV1KpiKey = "revenue" | "customers" | "growth";

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
	const field = root ? (root as any)[key] : null;
	const confidence = asNumber(field?.confidence) ?? 0;
	const sourcesRaw: unknown = field?.sources;
	const sourcesArr: any[] = Array.isArray(sourcesRaw) ? sourcesRaw : [];

	const sources = sourcesArr
		.map((s) => {
			const docId = asString(s?.source_document_id) ?? asString(s?.document_id) ?? null;
			const pageIndex = asNumber(s?.page_index);
			return { document_id: docId, page_index: pageIndex };
		})
		.filter((s) => s.document_id != null || s.page_index != null);

	let value_raw: string | null = null;
	const v = field?.value;
	if (typeof v === "string") value_raw = v;
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
}): ScoreInputsV1 {
	const { total, counts } = extractSegmentCounts(args.segmented_nodes);
	const overrides = extractOverrideStats(args.segmented_nodes);
	const driftAssessment = driftAssessmentFromMetadata(args.metadata);
	const deckKey = deckArchetypeKeyFromMetadata(args.metadata);

	const kpis: ScoreInputsV1Kpi[] = [
		kpiFromStructured(args.structured_summary, "revenue"),
		kpiFromStructured(args.structured_summary, "customers"),
		kpiFromStructured(args.structured_summary, "growth"),
	].sort((a, b) => a.key.localeCompare(b.key));

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
