import type { AnalystSegment } from "./analyst-segment";
import { normalizeAnalystSegment } from "./analyst-segment";
import { inferSegmentFromTitleRuleId, segmentDpuPage } from "./segment-dpu-page";

export interface OverrideQualityV1 {
  total_nodes: number;
  overridden_nodes: number;
  override_ratio: number; // overridden_nodes / total_nodes (rounded to 2 decimals)
  by_segment: Record<string, number>;
  by_override_rule: Record<string, number>;
  assessment: "low" | "moderate" | "high";
  notes: string[];
  // Extra diagnostic-only support for dashboard rendering.
  by_override_rule_segments?: Record<string, string[]>;
}

type OverrideQualityInputNode = {
  slide_title?: string | null;
  bullets?: string[] | null;
  segment_key?: AnalystSegment | null;
  structured_segment_key_raw?: string | null;
  quality_flags_segment_key_raw?: string | null;
  segment_reason?: { rules_hit?: string[] | null } | null;
};

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function sortedRecordNumber(input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(input).sort().map((k) => [k, input[k] ?? 0]));
}

function sortedRecordStringArray(input: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.keys(input)
      .sort()
      .map((k) => {
        const arr = Array.isArray(input[k]) ? input[k] : [];
        const uniq = Array.from(new Set(arr.map((x) => String(x)).filter(Boolean))).sort();
        return [k, uniq];
      })
  );
}

function asRulesHit(node: OverrideQualityInputNode): string[] {
  const raw = node && node.segment_reason && Array.isArray(node.segment_reason.rules_hit) ? node.segment_reason.rules_hit : [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function overrideRuleIdFromRulesHit(rulesHit: string[]): string | null {
  const hit = rulesHit.find((x) => typeof x === "string" && x.startsWith("segmenter:override:"));
  return hit ? String(hit) : null;
}

function titleRuleIdFromRulesHit(rulesHit: string[]): string | null {
  const hit = rulesHit.find((x) => typeof x === "string" && x.startsWith("segmenter:title:"));
  return hit ? String(hit) : null;
}

function computeDidOverride(node: OverrideQualityInputNode): {
  did_override: boolean;
  override_rule_id: string | null;
  final_segment_key: AnalystSegment | null;
} {
  const rulesHit = asRulesHit(node);
  const override_rule_id = overrideRuleIdFromRulesHit(rulesHit);
  const title_rule_id = titleRuleIdFromRulesHit(rulesHit);

  const final_segment_key = (node && (node.segment_key as any)) ? (node.segment_key as AnalystSegment) : null;

  const titleOnlySegment = (() => {
    try {
      const res = segmentDpuPage({ title: typeof node.slide_title === "string" ? node.slide_title : null, bullets: [] });
      return res && res.segment_key && res.segment_key !== "unknown" ? res.segment_key : null;
    } catch {
      return null;
    }
  })();

  const inferredFromTitleRule = title_rule_id ? inferSegmentFromTitleRuleId(title_rule_id) : null;
  const inferredFromTitleRuleClean = inferredFromTitleRule && inferredFromTitleRule !== "unknown" ? inferredFromTitleRule : null;

  const fallbackRaw =
    normalizeAnalystSegment(node.structured_segment_key_raw) ??
    normalizeAnalystSegment(node.quality_flags_segment_key_raw) ??
    null;

  const original_segment_key = titleOnlySegment ?? inferredFromTitleRuleClean ?? fallbackRaw ?? null;
  const did_override = Boolean(override_rule_id) && original_segment_key !== final_segment_key;

  return { did_override, override_rule_id, final_segment_key };
}

export function computeOverrideQualityV1(nodes: OverrideQualityInputNode[] | null | undefined): OverrideQualityV1 | null {
  const safe = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  if (safe.length === 0) return null;

  const total_nodes = safe.length;

  let overridden_nodes = 0;
  const by_segment: Record<string, number> = {};
  const by_override_rule: Record<string, number> = {};
  const by_override_rule_segments: Record<string, string[]> = {};

  for (const n of safe) {
    const trace = computeDidOverride(n);
    if (!trace.did_override || !trace.override_rule_id) continue;
    overridden_nodes += 1;

    const segKey = trace.final_segment_key ?? "unsegmented";
    by_segment[String(segKey)] = (by_segment[String(segKey)] ?? 0) + 1;

    const ruleId = String(trace.override_rule_id);
    by_override_rule[ruleId] = (by_override_rule[ruleId] ?? 0) + 1;
    by_override_rule_segments[ruleId] = by_override_rule_segments[ruleId] ?? [];
    by_override_rule_segments[ruleId].push(String(segKey));
  }

  const override_ratio = round2(overridden_nodes / Math.max(1, total_nodes));
  const assessment: OverrideQualityV1["assessment"] =
    override_ratio <= 0.10 ? "low" : override_ratio <= 0.25 ? "moderate" : "high";

  const notes: string[] = [];

  const gtmOverrides = (by_segment.go_to_market ?? 0) + (by_segment.distribution ?? 0);
  if (overridden_nodes >= 2 && gtmOverrides / Math.max(1, overridden_nodes) >= 0.6) {
    notes.push("Overrides concentrated in GTM-related slides");
  }

  const topRule = Object.entries(by_override_rule).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || String(a[0]).localeCompare(String(b[0])))[0] ?? null;
  if (topRule && overridden_nodes >= 3 && (topRule[1] ?? 0) / Math.max(1, overridden_nodes) >= 0.7) {
    notes.push("Overrides dominated by a single override rule");
  }

  if (assessment === "high") {
    notes.push("High override rate may indicate title ambiguity");
  }

  return {
    total_nodes,
    overridden_nodes,
    override_ratio,
    by_segment: sortedRecordNumber(by_segment),
    by_override_rule: sortedRecordNumber(by_override_rule),
    assessment,
    notes,
    by_override_rule_segments: sortedRecordStringArray(by_override_rule_segments),
  };
}
