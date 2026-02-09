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

function kpiEvidencePresent(structured_summary: any): boolean {
  const ss = structured_summary && typeof structured_summary === "object" ? structured_summary : null;
  if (!ss) return false;

  const hasValue = (field: any): boolean => {
    if (!field || typeof field !== "object") return false;
    const direct = typeof field.value === "string" ? field.value.trim() : "";
    const raw = typeof field.value?.raw === "string" ? field.value.raw.trim() : "";
    return Boolean(direct || raw);
  };

  // Deterministic interpretation: "KPI evidence" here means the structured_summary
  // contains a non-empty revenue or customers value (promoted or derived).
  return hasValue(ss.revenue) || hasValue(ss.customers);
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

  const coreSegments: AnalystSegment[] = ["product", "market", "traction"];

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

  const rowBySegment = new Map<string, (typeof segment_analysis)[number]>();
  for (const row of segment_analysis) rowBySegment.set(row.segment_key, row);

  const coreMissing = coreSegments.some((s) => {
    const row = rowBySegment.get(s);
    if (!row) return true;
    return row.observed_count < row.expected_min;
  });
  const corePresent = coreSegments.every((s) => {
    const row = rowBySegment.get(s);
    if (!row) return false;
    return row.observed_count >= Math.max(1, row.expected_min);
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

      // Deterministic severity dampening: compensated required segment should not remain critical.
      if (businessModelRow.severity === "critical") businessModelRow.severity = "warn";
    } else {
      structural_notes.push("Business model coverage is structurally light and not compensated by synthesis.");
    }
  }

  // Archetype-aware severity overrides (consumer_apparel_dtc only).
  if (deck.key === "consumer_apparel_dtc") {
    const teamRow = rowBySegment.get("team") ?? null;
    if (teamRow && teamRow.status === "overrepresented") {
      const over = Math.max(0, teamRow.observed_count - teamRow.expected_max);
      if (over <= 4) {
        teamRow.severity = "warn";
      } else {
        teamRow.severity = coreMissing ? "critical" : "warn";
      }
    }

    const finRow = rowBySegment.get("financials") ?? null;
    if (finRow && finRow.status === "overrepresented") {
      const over = Math.max(0, finRow.observed_count - finRow.expected_max);
      if (over <= 1) {
        finRow.severity = "warn";
      } else {
        const marketMissing = (rowBySegment.get("market")?.observed_count ?? 0) < (rowBySegment.get("market")?.expected_min ?? 1);
        const tractionMissing = (rowBySegment.get("traction")?.observed_count ?? 0) < (rowBySegment.get("traction")?.expected_min ?? 1);
        finRow.severity = (over >= 2 && (marketMissing || tractionMissing)) ? "critical" : "warn";
      }
    }
  }

  // Explicit compensation patterns (deterministic, consumer_apparel_dtc only).
  if (deck.key === "consumer_apparel_dtc") {
    const teamRow = rowBySegment.get("team") ?? null;
    if (teamRow && teamRow.status === "overrepresented" && corePresent) {
      compensating_patterns.push({
        missing_segment: "team_overrep_compensated_by_core_segments",
        compensated_by: coreSegments,
        rationale: "Team coverage exceeds typical expectations, but product/market/traction are present. This is common in hiring-forward consumer decks.",
      });
      if (teamRow.severity === "critical") teamRow.severity = "warn";

      const hasKpis = kpiEvidencePresent(input.structured_summary);
      structural_notes.push(
        hasKpis
          ? "Team coverage exceeds typical expectations for consumer_apparel_dtc decks; however, required segments (product, market, traction) are present and KPI evidence is available. This pattern is common for hiring-forward decks and does not indicate structural misalignment."
          : "Team coverage exceeds typical expectations for consumer_apparel_dtc decks; however, required segments (product, market, traction) are present. This pattern is common for hiring-forward decks and does not indicate structural misalignment."
      );
    }

    const marketRow = rowBySegment.get("market") ?? null;
    const tractionRow = rowBySegment.get("traction") ?? null;
    const hasKpis = kpiEvidencePresent(input.structured_summary);
    if (marketRow && marketRow.status === "overrepresented" && (tractionRow?.observed_count ?? 0) >= 1 && hasKpis) {
      compensating_patterns.push({
        missing_segment: "market_overrep_compensated_by_traction_and_kpis",
        compensated_by: ["traction", "kpi:revenue_or_customers"],
        rationale: "Market coverage exceeds typical expectations, but traction is present and KPI evidence exists (revenue or customers).",
      });
      if (marketRow.severity === "critical") marketRow.severity = "warn";
      structural_notes.push("Market coverage is heavy, but compensated by traction presence and KPI evidence (revenue/customers). This does not indicate structural misalignment.");
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

  const requiredSegments = expected
    .filter((e) => e.expected_min > 0)
    .map((e) => String(e.segment));

  const productMissing = (rowBySegment.get("product")?.observed_count ?? 0) < (rowBySegment.get("product")?.expected_min ?? 1);
  const marketMissing = (rowBySegment.get("market")?.observed_count ?? 0) < (rowBySegment.get("market")?.expected_min ?? 1);
  const tractionMissing = (rowBySegment.get("traction")?.observed_count ?? 0) < (rowBySegment.get("traction")?.expected_min ?? 1);

  const unknownRow = rowBySegment.get("unknown") ?? null;
  const unknownHardCritical = Boolean(
    unknownRow &&
    unknownRow.status === "overrepresented" &&
    (unknownRow.observed_count - unknownRow.expected_max) >= 2
  );

  const raiseTermsRow = rowBySegment.get("raise_terms") ?? null;
  const raiseTermsHardCritical = Boolean(
    raiseTermsRow &&
    raiseTermsRow.status === "overrepresented" &&
    (productMissing || tractionMissing)
  );

  // Preserve strictness for compliance archetype: extreme operations dominance is a structural blocker.
  const operationsRow = rowBySegment.get("operations") ?? null;
  const complianceOpsHardCritical = Boolean(
    deck.key === "enterprise_saas_compliance" &&
    operationsRow &&
    operationsRow.status === "overrepresented" &&
    (operationsRow.observed_count - operationsRow.expected_max) >= 2
  );

  const hasHardCritical =
    productMissing ||
    marketMissing ||
    tractionMissing ||
    unknownHardCritical ||
    raiseTermsHardCritical ||
    complianceOpsHardCritical;

  const criticalRequiredCount = segment_analysis.filter(
    (r) => r.severity === "critical" && requiredSegments.includes(String(r.segment_key))
  ).length;

  const hasCritical = segment_analysis.some((r) => r.severity === "critical");
  const hasWarn = segment_analysis.some((r) => r.severity === "warn");

  const overall_assessment: ArchetypeSegmentDriftV1["overall_assessment"] = hasHardCritical
    ? "misaligned"
    : criticalRequiredCount >= 2
      ? "misaligned"
      : hasCritical
        ? "mostly_aligned"
        : hasWarn
          ? "mostly_aligned"
          : "aligned";

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
