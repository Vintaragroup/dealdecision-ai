/**
 * packages/core/src/temporal/__tests__/temporal-alignment.test.ts
 *
 * Phase 3: Unit tests for the Temporal Alignment Engine.
 *
 * Covers 6 key scenarios:
 *  1. Historical workbook revenue vs projected deck revenue → not comparable
 *  2. Booked vs recognized revenue, same period → definition mismatch
 *  3. Fact labeled "current" vs explicit "FY2024" → current_vs_labeled_period
 *  4. Workbook FY2024 vs deck 2024 → comparable, same_period
 *  5. Multiple metrics with projected-vs-historical → grouped flag emitted
 *  6. 1 comparable discrepancy + N temporal mismatches → grouped isolation
 *
 * Plus unit tests for classifyFactTemporally and getMetricDefinitionFamily.
 */

import type { FinancialFactV1 } from "../../financial-facts/financial-fact-v1";
import {
  canCompareFactsTemporally,
  classifyFactTemporally,
  getMetricDefinitionFamily,
  buildGroupedTemporalMismatchFlag,
} from "../temporal-alignment";
import { FinancialIntegrityAnalyzerV1 } from "../../analyzers/financial-integrity-analyzer-v1";
import type { IntegrityFlag } from "../../types/financial-integrity-v1";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let factSeq = 0;

function makeFact(
  overrides: Partial<FinancialFactV1> &
    Pick<FinancialFactV1, "metric_key" | "period_type" | "period_label" | "value">,
): FinancialFactV1 {
  const id = `ta-test-${++factSeq}`;
  return {
    fact_id: id,
    deal_id: "deal-ta-test",
    source_kind: "xlsx",
    unit: "currency",
    currency: "USD",
    confidence: "high",
    reconciliation_status: "ok",
    temporal_scope: "historical",
    ...overrides,
  } as FinancialFactV1;
}

const analyzer = new FinancialIntegrityAnalyzerV1();

function temporalAlignmentFlags(flags: IntegrityFlag[]) {
  return flags.filter((f) => f.flag_key === "period_alignment:grouped_temporal_mismatch");
}

function crossSourceFlags(flags: IntegrityFlag[]) {
  return flags.filter((f) => f.flag_key.startsWith("cross_source_discrepancy:"));
}

// ─── classifyFactTemporally ──────────────────────────────────────────────────

describe("classifyFactTemporally", () => {
  test("projected temporal_scope → 'projected'", () => {
    const f = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2026",
      value: 10_000_000,
      temporal_scope: "projected",
    });
    expect(classifyFactTemporally(f)).toBe("projected");
  });

  test("scenario temporal_scope → 'scenario'", () => {
    const f = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2026",
      value: 12_000_000,
      temporal_scope: "scenario",
    });
    expect(classifyFactTemporally(f)).toBe("scenario");
  });

  test("target temporal_scope → 'target'", () => {
    const f = makeFact({
      metric_key: "arr",
      period_type: "annual",
      period_label: "2027",
      value: 5_000_000,
      temporal_scope: "target",
    });
    expect(classifyFactTemporally(f)).toBe("target");
  });

  test("period_label='current' + xlsx source → 'current_snapshot'", () => {
    const f = makeFact({
      metric_key: "cash",
      period_type: "unknown",
      period_label: "current",
      value: 500_000,
      source_kind: "xlsx",
    });
    expect(classifyFactTemporally(f)).toBe("current_snapshot");
  });

  test("period_label='current' + deck source → 'current_partial'", () => {
    const f = makeFact({
      metric_key: "mrr",
      period_type: "monthly",
      period_label: "current",
      value: 80_000,
      source_kind: "deck",
    });
    expect(classifyFactTemporally(f)).toBe("current_partial");
  });

  test("period_type='ttm' → 'ttm'", () => {
    const f = makeFact({
      metric_key: "revenue",
      period_type: "ttm",
      period_label: "TTM",
      value: 4_000_000,
    });
    expect(classifyFactTemporally(f)).toBe("ttm");
  });

  test("period_label includes 'ytd' → 'ytd'", () => {
    const f = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024 YTD",
      value: 2_000_000,
    });
    expect(classifyFactTemporally(f)).toBe("ytd");
  });

  test("historical scope + explicit year → 'historical_actual'", () => {
    const f = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "FY2024",
      value: 5_000_000,
      temporal_scope: "historical",
    });
    expect(classifyFactTemporally(f)).toBe("historical_actual");
  });

  test("unknown scope + explicit year label → 'historical_actual' (assumed)", () => {
    const f = makeFact({
      metric_key: "burn_rate",
      period_type: "monthly",
      period_label: "2024-03",
      value: 80_000,
      temporal_scope: "unknown",
    });
    expect(classifyFactTemporally(f)).toBe("historical_actual");
  });

  test("empty period_label + unknown scope → 'unknown'", () => {
    const f = makeFact({
      metric_key: "revenue",
      period_type: "unknown",
      period_label: "",
      value: 1_000_000,
      temporal_scope: "unknown",
    });
    expect(classifyFactTemporally(f)).toBe("unknown");
  });
});

// ─── getMetricDefinitionFamily ───────────────────────────────────────────────

describe("getMetricDefinitionFamily", () => {
  test("'revenue' → 'recognized'", () => {
    expect(getMetricDefinitionFamily("revenue")).toBe("recognized");
  });

  test("'arr' → 'arr_mrr'", () => {
    expect(getMetricDefinitionFamily("arr")).toBe("arr_mrr");
  });

  test("'mrr' → 'arr_mrr'", () => {
    expect(getMetricDefinitionFamily("mrr")).toBe("arr_mrr");
  });

  test("'booked_revenue' → 'booked'", () => {
    expect(getMetricDefinitionFamily("booked_revenue")).toBe("booked");
  });

  test("'direct_cash_received' → 'cash'", () => {
    expect(getMetricDefinitionFamily("direct_cash_received")).toBe("cash");
  });

  test("'burn_rate' → 'other'", () => {
    expect(getMetricDefinitionFamily("burn_rate")).toBe("other");
  });

  test("'ebitda' → 'other'", () => {
    expect(getMetricDefinitionFamily("ebitda")).toBe("other");
  });

  test("unknown metric → 'other'", () => {
    expect(getMetricDefinitionFamily("my_custom_kpi")).toBe("other");
  });
});

// ─── canCompareFactsTemporally ────────────────────────────────────────────────

describe("canCompareFactsTemporally", () => {
  // ── Scenario 1: Historical workbook vs projected deck ────────────────────

  test("[Scenario 1] historical workbook revenue vs projected deck revenue → not comparable", () => {
    const wbFact = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024",
      value: 5_000_000,
      source_kind: "xlsx",
      temporal_scope: "historical",
    });
    const deckFact = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2027",
      value: 18_000_000,
      source_kind: "deck",
      temporal_scope: "projected",
    });
    const result = canCompareFactsTemporally(wbFact, deckFact);
    expect(result.comparable).toBe(false);
    expect(result.reason).toBe("projected_vs_historical");
    expect(result.severity).toBe("critical");
  });

  // ── Scenario 2: Booked vs recognized revenue ─────────────────────────────

  test("[Scenario 2] booked_revenue vs revenue (recognized), same period → definition_mismatch", () => {
    const bookedFact = makeFact({
      metric_key: "booked_revenue",
      period_type: "annual",
      period_label: "2024",
      value: 6_000_000,
    });
    const recognizedFact = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024",
      value: 4_500_000,
    });
    const result = canCompareFactsTemporally(bookedFact, recognizedFact);
    expect(result.comparable).toBe(false);
    expect(result.reason).toBe("definition_mismatch");
    expect(result.severity).toBe("warning");
  });

  test("[Scenario 2b] booked vs arr_mrr → definition_mismatch", () => {
    const a = makeFact({ metric_key: "bookings", period_type: "annual", period_label: "2024", value: 3_000_000 });
    const b = makeFact({ metric_key: "arr", period_type: "annual", period_label: "2024", value: 2_500_000 });
    const result = canCompareFactsTemporally(a, b);
    expect(result.comparable).toBe(false);
    expect(result.reason).toBe("definition_mismatch");
  });

  test("[Scenario 2c] revenue vs revenue (same family) → comparable", () => {
    const a = makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 5_000_000, source_kind: "xlsx" });
    const b = makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 4_800_000, source_kind: "deck" });
    const result = canCompareFactsTemporally(a, b);
    expect(result.comparable).toBe(true);
    expect(result.reason).toBe("same_period");
  });

  // ── Scenario 3: "current" vs explicit period label ───────────────────────

  test("[Scenario 3] fact labeled 'current' vs fact labeled 'FY2024' → current_vs_labeled_period", () => {
    const currentFact = makeFact({
      metric_key: "arr",
      period_type: "annual",
      period_label: "current",
      value: 2_000_000,
      source_kind: "deck",
    });
    const labeledFact = makeFact({
      metric_key: "arr",
      period_type: "annual",
      period_label: "FY2024",
      value: 1_800_000,
      source_kind: "xlsx",
    });
    const result = canCompareFactsTemporally(currentFact, labeledFact);
    expect(result.comparable).toBe(false);
    expect(result.reason).toBe("current_vs_labeled_period");
    expect(result.severity).toBe("warning");
  });

  // ── Scenario 4: Same period, different sources → comparable ──────────────

  test("[Scenario 4] workbook FY2024 revenue vs deck 2024 revenue → comparable (same_period or compatible)", () => {
    const wbFact = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "FY2024",
      value: 5_000_000,
      source_kind: "xlsx",
      temporal_scope: "historical",
    });
    const deckFact = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "FY2024",
      value: 5_100_000,
      source_kind: "deck",
      temporal_scope: "historical",
    });
    const result = canCompareFactsTemporally(wbFact, deckFact);
    expect(result.comparable).toBe(true);
  });

  // ── TTM vs annual ─────────────────────────────────────────────────────────

  test("TTM vs annual for same metric → compatible_rollup (comparable)", () => {
    const ttmFact = makeFact({
      metric_key: "revenue",
      period_type: "ttm",
      period_label: "TTM",
      value: 4_200_000,
    });
    const annualFact = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024",
      value: 4_000_000,
    });
    const result = canCompareFactsTemporally(ttmFact, annualFact);
    expect(result.comparable).toBe(true);
    expect(result.reason).toBe("compatible_rollup");
  });

  // ── Unknown period facts ──────────────────────────────────────────────────

  test("both facts with unknown period → comparable (unknown_periods or same_period)", () => {
    const a = makeFact({ metric_key: "revenue", period_type: "unknown", period_label: "", value: 1_000_000, temporal_scope: "unknown" });
    const b = makeFact({ metric_key: "revenue", period_type: "unknown", period_label: "", value: 950_000, temporal_scope: "unknown" });
    const result = canCompareFactsTemporally(a, b);
    expect(result.comparable).toBe(true);
  });

  // ── Both projected → comparable ───────────────────────────────────────────

  test("both projected same period → comparable (same projected class)", () => {
    const a = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2027",
      value: 20_000_000,
      temporal_scope: "projected",
      source_kind: "xlsx",
    });
    const b = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2027",
      value: 18_000_000,
      temporal_scope: "projected",
      source_kind: "deck",
    });
    const result = canCompareFactsTemporally(a, b);
    expect(result.comparable).toBe(true);
    expect(result.reason).toBe("same_period");
  });

  // ── Projected vs scenario → both in projected class → comparable ──────────

  test("projected vs scenario → both in projected class → comparable", () => {
    const a = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2027",
      value: 20_000_000,
      temporal_scope: "projected",
    });
    const b = makeFact({
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2027",
      value: 18_000_000,
      temporal_scope: "scenario",
    });
    // Both are in PROJECTED_CLASSES — the projectedVsHistorical check passes (both projected)
    const result = canCompareFactsTemporally(a, b);
    expect(result.comparable).toBe(true);
  });
});

// ─── buildGroupedTemporalMismatchFlag ─────────────────────────────────────────

describe("buildGroupedTemporalMismatchFlag", () => {
  test("produces correct flag_key and status", () => {
    const flag = buildGroupedTemporalMismatchFlag(["revenue", "arr"], ["revenue: projected_vs_historical", "arr: projected_vs_historical"]);
    expect(flag.flag_key).toBe("period_alignment:grouped_temporal_mismatch");
    expect(flag.status).toBe("FAIL");
    expect(flag.severity).toBe("high");
  });

  test("note contains all affected metric names", () => {
    const flag = buildGroupedTemporalMismatchFlag(["burn_rate", "cash", "revenue"], []);
    expect(flag.note).toContain("burn_rate");
    expect(flag.note).toContain("cash");
    expect(flag.note).toContain("revenue");
  });

  test("deduplicates repeated metric names", () => {
    const flag = buildGroupedTemporalMismatchFlag(["revenue", "revenue", "arr"], []);
    // Should only list revenue once
    const revMatches = (flag.note.match(/revenue/g) ?? []).length;
    expect(revMatches).toBe(1);
  });

  test("single metric → note says '1 metric'", () => {
    const flag = buildGroupedTemporalMismatchFlag(["arr"], ["arr: reason"]);
    expect(flag.note).toMatch(/^1 metric/);
  });
});

// ─── Integration with FinancialIntegrityAnalyzerV1 ──────────────────────────

describe("FinancialIntegrityAnalyzerV1 — Phase 3 temporal alignment integration", () => {
  // ── Scenario 5: Multiple metrics with projected-vs-historical → grouped flag ──

  test("[Scenario 5] 3 metrics each with projected+historical → single grouped_temporal_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      // revenue: historical workbook + projected deck
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 5_000_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2027", value: 20_000_000, source_kind: "deck", temporal_scope: "projected" }),
      // arr: historical + projected
      makeFact({ metric_key: "arr", period_type: "annual", period_label: "2024", value: 3_000_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "arr", period_type: "annual", period_label: "2027", value: 12_000_000, source_kind: "deck", temporal_scope: "projected" }),
      // burn_rate: historical + projected
      makeFact({ metric_key: "burn_rate", period_type: "monthly", period_label: "2024", value: 150_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "burn_rate", period_type: "monthly", period_label: "2027", value: 400_000, source_kind: "deck", temporal_scope: "projected" }),
    ];

    const result = await analyzer.analyze({ financial_facts: facts });

    const grouped = temporalAlignmentFlags(result.flags);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.note).toContain("revenue");
    expect(grouped[0]!.note).toContain("arr");
    expect(grouped[0]!.note).toContain("burn_rate");

    // Must NOT emit old-style per-metric temporal_scope_mismatch flags
    const oldStyle = result.flags.filter((f) => f.flag_key.includes("temporal_scope_mismatch"));
    expect(oldStyle).toHaveLength(0);
  });

  // ── Scenario 6: Comparable discrepancy + temporal mismatches → conflict isolation ──

  test("[Scenario 6] 1 real numeric conflict + 2 temporal mismatches → cross_source_discrepancy only for comparable pair", async () => {
    const facts: FinancialFactV1[] = [
      // cash: comparable pair → real discrepancy (>20% divergence)
      makeFact({ metric_key: "cash", period_type: "annual", period_label: "2024", value: 2_000_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "cash", period_type: "annual", period_label: "2024", value: 900_000, source_kind: "deck", temporal_scope: "historical" }),
      // revenue: temporal mismatch (projected vs historical) → should NOT produce cross_source_discrepancy
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 5_000_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 18_000_000, source_kind: "deck", temporal_scope: "projected" }),
      // arr: temporal mismatch → should NOT produce cross_source_discrepancy
      makeFact({ metric_key: "arr", period_type: "annual", period_label: "2024", value: 3_000_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "arr", period_type: "annual", period_label: "2024", value: 10_000_000, source_kind: "deck", temporal_scope: "projected" }),
    ];

    const result = await analyzer.analyze({ financial_facts: facts });

    // Only cash should produce a cross_source_discrepancy flag
    const discrepancyFlags = crossSourceFlags(result.flags);
    expect(discrepancyFlags.some((f) => f.flag_key === "cross_source_discrepancy:cash")).toBe(true);
    expect(discrepancyFlags.some((f) => f.flag_key === "cross_source_discrepancy:revenue")).toBe(false);
    expect(discrepancyFlags.some((f) => f.flag_key === "cross_source_discrepancy:arr")).toBe(false);

    // Temporal mismatches absorbed into grouped flag
    const grouped = temporalAlignmentFlags(result.flags);
    expect(grouped).toHaveLength(1);
  });

  // ── No projected facts → no grouped flag ─────────────────────────────────

  test("all historical facts → no grouped_temporal_mismatch flag emitted", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 5_000_000, source_kind: "xlsx", temporal_scope: "historical" }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 4_800_000, source_kind: "deck", temporal_scope: "historical" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    expect(temporalAlignmentFlags(result.flags)).toHaveLength(0);
  });
});
