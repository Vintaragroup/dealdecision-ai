import type { AnalystSegment } from "./analyst-segment";
import type { DeckArchetypeDiagnosticV1, DeckArchetypeV1 } from "./deck-archetypes";
import { getDeckArchetypeExpectedSegmentsV1 } from "./deck-archetypes";

export type ArchetypeSegmentDriftV1 = {
  archetype: string;
  confidence: number;
  segment_analysis: Array<{
    segment_key: string;
    expected_min: number;
    expected_max: number;
    observed_count: number;
    status: "within_range" | "underrepresented" | "overrepresented";
    severity: "info" | "warn" | "critical";
  }>;
  compensating_patterns: Array<{
    missing_segment: string;
    compensated_by: string[];
    rationale: string;
  }>;
  structural_notes: string[];
  overall_assessment: "aligned" | "mostly_aligned" | "misaligned";
};

function toInt(n: unknown, fallback: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.trunc(x);
}

function countFor(segment_counts: Partial<Record<AnalystSegment, number>>, s: AnalystSegment): number {
  return toInt(segment_counts?.[s], 0);
}

function computeStatus(input: {
  observed: number;
  expected_min: number;
  expected_max: number;
}): { status: "within_range" | "underrepresented" | "overrepresented"; delta: number } {
  if (input.observed < input.expected_min) return { status: "underrepresented", delta: input.expected_min - input.observed };
  if (input.observed > input.expected_max) return { status: "overrepresented", delta: input.observed - input.expected_max };
  return { status: "within_range", delta: 0 };
}

function severityFromDelta(delta: number): "info" | "warn" | "critical" {
  if (delta <= 0) return "info";
  if (delta === 1) return "warn";
  return "critical";
}

function hasSynthesisBackedBusinessModel(structured_summary: any): { ok: boolean; confidence: number } {
  const structured = structured_summary && typeof structured_summary === "object" ? structured_summary : null;
  const bm = structured
    ? (structured.business_model_summary_v1 ?? structured.business_model_summary)
    : null;

  const confidence = (bm && typeof bm.confidence === "number" && Number.isFinite(bm.confidence)) ? bm.confidence : 0;
  const valueOk = typeof bm?.value === "string" && bm.value.trim().length > 0;

  const derived = (bm && bm.derived_from && typeof bm.derived_from === "object") ? bm.derived_from : {};
  const hasAnchors =
    (Array.isArray(derived.product_pages) ? derived.product_pages.length : 0) > 0 ||
    (Array.isArray(derived.gtm_pages) ? derived.gtm_pages.length : 0) > 0 ||
    (Array.isArray(derived.traction_pages) ? derived.traction_pages.length : 0) > 0 ||
    (Array.isArray(derived.market_pages) ? derived.market_pages.length : 0) > 0 ||
    (Array.isArray(derived.distribution_pages) ? derived.distribution_pages.length : 0) > 0;

  return { ok: confidence >= 0.7 && valueOk && hasAnchors, confidence };
}

function diagnosticSaysSatisfiedBySynthesis(diagnostics: DeckArchetypeDiagnosticV1[] | null | undefined, segment: AnalystSegment): boolean {
  const ds = Array.isArray(diagnostics) ? diagnostics : [];
  return ds.some((d) => d?.kind === "satisfied_by_synthesis" && d?.segment === segment);
}

export function computeArchetypeSegmentDriftV1(input: {
  deck_archetype: DeckArchetypeV1 | null | undefined;
  diagnostics?: DeckArchetypeDiagnosticV1[] | null;
  structured_summary?: any;
}): ArchetypeSegmentDriftV1 | null {
  const deck = input.deck_archetype ?? null;
  if (!deck || typeof deck !== "object") return null;
  if (deck.version !== "deck_archetype_v1") return null;
  if (deck.key === "unknown") return null;

  const expected = getDeckArchetypeExpectedSegmentsV1(deck.key);
  const segment_counts = deck.segment_counts ?? {};

  const segment_analysis: ArchetypeSegmentDriftV1["segment_analysis"] = expected.map((e) => {
    const observed = countFor(segment_counts, e.segment);
    const status = computeStatus({ observed, expected_min: e.expected_min, expected_max: e.expected_max });
    const severity = severityFromDelta(status.delta);
    return {
      segment_key: e.segment,
      expected_min: e.expected_min,
      expected_max: e.expected_max,
      observed_count: observed,
      status: status.status,
      severity,
    };
  });

  const compensating_patterns: ArchetypeSegmentDriftV1["compensating_patterns"] = [];
  const structural_notes: string[] = [];

  // Compensation pattern: missing/underrepresented business_model can be compensated by a
  // strict synthesized business model summary (provenance anchored) OR by the archetype diagnostic.
  const businessModelRow = segment_analysis.find((r) => r.segment_key === "business_model") ?? null;
  if (businessModelRow && businessModelRow.status === "underrepresented") {
    const synth = hasSynthesisBackedBusinessModel(input.structured_summary);
    const diagOk = diagnosticSaysSatisfiedBySynthesis(input.diagnostics, "business_model");
    if (synth.ok || diagOk) {
      compensating_patterns.push({
        missing_segment: "business_model",
        compensated_by: ["structured_summary.business_model_summary_v1"],
        rationale: synth.ok
          ? `Synthesized business model summary is confidence-gated (confidence=${synth.confidence.toFixed(2)}) and has provenance anchors.`
          : "Archetype diagnostics indicate business_model was satisfied by synthesis under strict rules.",
      });
      structural_notes.push("Business model coverage is structurally light, but compensated by a synthesized, provenance-backed business model summary.");
    } else {
      structural_notes.push("Business model coverage is structurally light and not compensated by synthesis.");
    }
  }

  // Structural narrative notes (fixed templates)
  for (const row of segment_analysis) {
    if (row.status === "within_range") continue;
    if (row.status === "underrepresented") {
      structural_notes.push(
        `Segment '${row.segment_key}' is underrepresented (observed ${row.observed_count} < expected_min ${row.expected_min}).`
      );
    } else {
      structural_notes.push(
        `Segment '${row.segment_key}' is overrepresented (observed ${row.observed_count} > expected_max ${row.expected_max}).`
      );
    }
  }

  // Overall assessment: penalize warn=1, critical=2, but reduce penalty for compensated gaps.
  let penalty = 0;
  let hasCritical = false;
  for (const row of segment_analysis) {
    if (row.severity === "warn") penalty += 1;
    if (row.severity === "critical") {
      penalty += 2;
      hasCritical = true;
    }
  }
  for (const cp of compensating_patterns) {
    if (cp.missing_segment === "business_model") penalty = Math.max(0, penalty - 1);
  }

  const overall_assessment: ArchetypeSegmentDriftV1["overall_assessment"] =
    hasCritical ? "misaligned" : penalty === 0 ? "aligned" : penalty <= 2 ? "mostly_aligned" : "misaligned";

  // Ensure deterministic ordering, de-dupe notes.
  const notes = Array.from(new Set(structural_notes)).slice(0, 32);

  return {
    archetype: deck.key,
    confidence: deck.confidence,
    segment_analysis,
    compensating_patterns,
    structural_notes: notes,
    overall_assessment,
  };
}
