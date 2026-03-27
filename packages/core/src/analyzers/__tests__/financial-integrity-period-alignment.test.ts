/**
 * packages/core/src/analyzers/__tests__/financial-integrity-period-alignment.test.ts
 *
 * Unit tests for Phase 4 (Period Alignment Checks) of FinancialIntegrityAnalyzerV1.
 *
 * Runs under Jest (globals: describe / test / expect).
 */

import { FinancialIntegrityAnalyzerV1 } from "../financial-integrity-analyzer-v1";
import type { FinancialFactV1 } from "../../financial-facts/financial-fact-v1";
import type { IntegrityFlag } from "../../types/financial-integrity-v1";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let factSeq = 0;

/**
 * Construct a minimal FinancialFactV1 for testing.
 * Only period_type, period_label, metric_key, value, temporal_scope matter here.
 */
function makeFact(
  overrides: Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "period_type" | "period_label" | "value">,
): FinancialFactV1 {
  const id = `test-fact-${++factSeq}`;
  return {
    fact_id: id,
    deal_id: "deal-test",
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

function periodAlignmentFlags(flags: IntegrityFlag[]) {
  return flags.filter((f) => f.flag_key.startsWith("period_alignment:"));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FinancialIntegrityAnalyzerV1 — Phase 4: Period Alignment", () => {
  // ── 4a: Per-metric period type mismatch ─────────────────────────────────

  test("annual vs annual same metric same period → no period_alignment flags", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 1_000_000, source_kind: "xlsx" }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 950_000, source_kind: "deck" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    expect(periodAlignmentFlags(result.flags)).toHaveLength(0);
  });

  test("annual vs quarterly same metric → FAIL period_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 1_000_000 }),
      makeFact({ metric_key: "revenue", period_type: "quarterly", period_label: "Q1 2024", value: 250_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    expect(paFlags).toHaveLength(1);
    expect(paFlags[0]!.flag_key).toBe("period_alignment:period_mismatch:revenue");
    expect(paFlags[0]!.status).toBe("FAIL");
    expect(paFlags[0]!.severity).toBe("high");
    expect(paFlags[0]!.note).toContain("annual");
    expect(paFlags[0]!.note).toContain("quarterly");
  });

  test("annual vs TTM same metric → WARN incompatible_period_comparison flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 4_000_000 }),
      makeFact({ metric_key: "revenue", period_type: "ttm", period_label: "TTM", value: 4_100_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    expect(paFlags).toHaveLength(1);
    expect(paFlags[0]!.flag_key).toBe("period_alignment:incompatible_period_comparison:revenue");
    expect(paFlags[0]!.status).toBe("WARN");
    expect(paFlags[0]!.severity).toBe("medium");
  });

  test("quarterly vs TTM same metric → FAIL period_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "burn_rate", period_type: "quarterly", period_label: "Q4 2024", value: 300_000 }),
      makeFact({ metric_key: "burn_rate", period_type: "ttm", period_label: "TTM", value: 1_200_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    const mismatch = paFlags.find((f) => f.flag_key.startsWith("period_alignment:period_mismatch"));
    expect(mismatch).toBeDefined();
    expect(mismatch!.status).toBe("FAIL");
  });

  test("two different metrics with clean period types → no spurious cross-metric flags", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 1_000_000 }),
      makeFact({ metric_key: "burn_rate", period_type: "monthly", period_label: "2024", value: 80_000 }),
    ];
    // Each metric has only ONE period type → no mismatch within any single metric.
    const result = await analyzer.analyze({ financial_facts: facts });
    const revFlags = periodAlignmentFlags(result.flags).filter((f) => f.flag_key.includes(":revenue"));
    const burnFlags = periodAlignmentFlags(result.flags).filter((f) => f.flag_key.includes(":burn_rate"));
    expect(revFlags).toHaveLength(0);
    expect(burnFlags).toHaveLength(0);
  });

  // ── 4b: Ambiguous "current" period ──────────────────────────────────────

  test("'current' period alongside explicit year → WARN ambiguous_current_period flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "arr", period_type: "annual", period_label: "current", value: 2_000_000, source_kind: "deck" }),
      makeFact({ metric_key: "arr", period_type: "annual", period_label: "2024", value: 1_800_000, source_kind: "xlsx" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    const ambiguous = paFlags.find((f) => f.flag_key === "period_alignment:ambiguous_current_period:arr");
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.status).toBe("WARN");
    expect(ambiguous!.severity).toBe("low");
  });

  test("all 'current' period labels → no ambiguous_current_period flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "mrr", period_type: "monthly", period_label: "current", value: 100_000, source_kind: "xlsx" }),
      makeFact({ metric_key: "mrr", period_type: "monthly", period_label: "current", value: 98_000, source_kind: "deck" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const ambiguousFlags = periodAlignmentFlags(result.flags).filter((f) =>
      f.flag_key.includes("ambiguous_current_period"),
    );
    expect(ambiguousFlags).toHaveLength(0);
  });

  // ── 4c: Derivation period mismatch (cash + burn → runway) ───────────────

  test("cash annual + burn annual → no derivation_period_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "cash", period_type: "annual", period_label: "2024", value: 3_000_000 }),
      makeFact({ metric_key: "burn_rate", period_type: "annual", period_label: "2024", value: 100_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const derivFlags = periodAlignmentFlags(result.flags).filter((f) =>
      f.flag_key === "period_alignment:derivation_period_mismatch",
    );
    expect(derivFlags).toHaveLength(0);
  });

  test("cash annual + burn quarterly → FAIL derivation_period_mismatch", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "cash", period_type: "annual", period_label: "2024", value: 3_000_000 }),
      makeFact({ metric_key: "burn_rate", period_type: "quarterly", period_label: "Q4 2024", value: 300_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const derivFlags = periodAlignmentFlags(result.flags).filter((f) =>
      f.flag_key === "period_alignment:derivation_period_mismatch",
    );
    expect(derivFlags).toHaveLength(1);
    expect(derivFlags[0]!.status).toBe("FAIL");
    expect(derivFlags[0]!.severity).toBe("high");
    expect(derivFlags[0]!.fact_type).toBe("runway_months");
    expect(derivFlags[0]!.note).toContain("cash");
    expect(derivFlags[0]!.note).toContain("burn_rate");
  });

  test("projected cash (annual) + projected burn (quarterly) → no derivation_period_mismatch (projected facts skipped)", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "cash", period_type: "annual", period_label: "2025", value: 5_000_000, temporal_scope: "projected" }),
      makeFact({ metric_key: "burn_rate", period_type: "quarterly", period_label: "Q1 2025", value: 500_000, temporal_scope: "projected" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const derivFlags = periodAlignmentFlags(result.flags).filter((f) =>
      f.flag_key === "period_alignment:derivation_period_mismatch",
    );
    // Both are projected → cash and burn are filtered out → no derivation flag
    expect(derivFlags).toHaveLength(0);
  });

  test("cash monthly + burn monthly → no derivation_period_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "cash", period_type: "monthly", period_label: "2024-12", value: 600_000 }),
      makeFact({ metric_key: "burn_rate", period_type: "monthly", period_label: "2024-12", value: 50_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const derivFlags = periodAlignmentFlags(result.flags).filter((f) =>
      f.flag_key === "period_alignment:derivation_period_mismatch",
    );
    expect(derivFlags).toHaveLength(0);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  test("empty facts → no period_alignment flags (graceful no-op)", async () => {
    const result = await analyzer.analyze({ financial_facts: [] });
    expect(periodAlignmentFlags(result.flags)).toHaveLength(0);
  });

  test("unknown period_type facts → no mismatch flag (cannot determine)", async () => {
    // Facts with period_type "unknown" should be skipped and not cause false positives.
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "unknown", period_label: "current", value: 1_000_000 }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 1_000_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const mismatchFlags = periodAlignmentFlags(result.flags).filter((f) =>
      f.flag_key.startsWith("period_alignment:period_mismatch"),
    );
    // unknown + annual → compatibility returns "ok" → no mismatch flag
    expect(mismatchFlags).toHaveLength(0);
  });

  test("multiple metrics each clean → only the mismatched metric is flagged", async () => {
    const facts: FinancialFactV1[] = [
      // Clean: burn_rate all annual
      makeFact({ metric_key: "burn_rate", period_type: "annual", period_label: "2024", value: 1_200_000 }),
      // Mismatched: revenue mixes annual + quarterly
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 5_000_000 }),
      makeFact({ metric_key: "revenue", period_type: "quarterly", period_label: "Q1 2024", value: 1_200_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    expect(paFlags).toHaveLength(1);
    expect(paFlags[0]!.flag_key).toBe("period_alignment:period_mismatch:revenue");
  });

  // ── 4d: Temporal scope mismatch (projected vs historical) ───────────────────────

  test("projected vs historical same metric → FAIL grouped_temporal_mismatch", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2024", value: 5_000_000, temporal_scope: "historical" }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2026", value: 12_000_000, temporal_scope: "projected" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    const groupedFlag = paFlags.find((f) => f.flag_key === "period_alignment:grouped_temporal_mismatch");
    expect(groupedFlag).toBeDefined();
    expect(groupedFlag!.status).toBe("FAIL");
    expect(groupedFlag!.severity).toBe("high");
    expect(groupedFlag!.note).toContain("revenue");
  });

  test("both projected same metric → no grouped_temporal_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2026", value: 12_000_000, temporal_scope: "projected", source_kind: "xlsx" }),
      makeFact({ metric_key: "revenue", period_type: "annual", period_label: "2026", value: 11_500_000, temporal_scope: "projected", source_kind: "deck" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const groupedFlags = periodAlignmentFlags(result.flags).filter((f) => f.flag_key === "period_alignment:grouped_temporal_mismatch");
    expect(groupedFlags).toHaveLength(0);
  });

  // ── 4e: Quarterly label mismatch (Q1 vs Q2) ──────────────────────────────

  test("Q1 vs Q2 same metric quarterly → WARN quarter_label_mismatch", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "quarterly", period_label: "Q1 2024", value: 1_200_000 }),
      makeFact({ metric_key: "revenue", period_type: "quarterly", period_label: "Q2 2024", value: 1_400_000 }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const paFlags = periodAlignmentFlags(result.flags);
    const quarterMismatch = paFlags.find((f) => f.flag_key === "period_alignment:quarter_label_mismatch:revenue");
    expect(quarterMismatch).toBeDefined();
    expect(quarterMismatch!.status).toBe("WARN");
    expect(quarterMismatch!.severity).toBe("medium");
  });

  test("Q1 2024 vs Q1 2024 same quarter different sources → no quarter_label_mismatch flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", period_type: "quarterly", period_label: "Q1 2024", value: 1_200_000, source_kind: "xlsx" }),
      makeFact({ metric_key: "revenue", period_type: "quarterly", period_label: "Q1 2024", value: 1_150_000, source_kind: "deck" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const qFlags = periodAlignmentFlags(result.flags).filter((f) => f.flag_key.includes("quarter_label_mismatch"));
    expect(qFlags).toHaveLength(0);
  });
});
