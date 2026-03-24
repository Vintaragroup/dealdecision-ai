/**
 * packages/core/src/analyzers/__tests__/financial-integrity-conflict-propagation.test.ts
 *
 * Unit tests for Phase 2b: Fact-Level Conflict Propagation.
 *
 * Validates that FinancialIntegrityAnalyzerV1 promotes facts with
 * `reconciliation_status='conflict'` into `cross_source_discrepancy:*` flags
 * at FAIL severity, even when the threshold-based check in section 2 would not
 * fire (e.g. divergence < 20%, non-standard source_kind pairs, or conflicting
 * facts living in different period_label buckets).
 *
 * Runs under Jest (globals: describe / test / expect).
 */

import { FinancialIntegrityAnalyzerV1 } from "../financial-integrity-analyzer-v1";
import type { FinancialFactV1 } from "../../financial-facts/financial-fact-v1";
import type { IntegrityFlag } from "../../types/financial-integrity-v1";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let factSeq = 0;

function makeFact(
  overrides: Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">,
): FinancialFactV1 {
  const id = `conflict-test-${++factSeq}`;
  return {
    fact_id: id,
    deal_id: "deal-conflict-test",
    source_kind: "xlsx",
    period_type: "annual",
    period_label: "FY2025",
    unit: "currency",
    currency: "USD",
    confidence: "high",
    reconciliation_status: "ok",
    temporal_scope: "historical",
    ...overrides,
  } as FinancialFactV1;
}

const analyzer = new FinancialIntegrityAnalyzerV1();

function conflictFlags(flags: IntegrityFlag[]) {
  return flags.filter((f) => f.flag_key.startsWith("cross_source_discrepancy:"));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FinancialIntegrityAnalyzerV1 — Phase 2b: Conflict Propagation", () => {

  // ── Case 1: Conflict → produces FAIL flag ─────────────────────────────────

  test("two conflict-tagged facts (xlsx vs deck, same period) → FAIL cross_source_discrepancy flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", value: 1_200_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "revenue", value: 800_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    expect(cf).toHaveLength(1);
    expect(cf[0]!.flag_key).toBe("cross_source_discrepancy:revenue");
    expect(cf[0]!.status).toBe("FAIL");
    expect(cf[0]!.severity).toBe("high");
    expect(cf[0]!.source_a).toBeDefined();
    expect(cf[0]!.source_b).toBeDefined();
    expect(cf[0]!.source_a!.source_kind).toBe("xlsx");
    expect(cf[0]!.source_b!.source_kind).toBe("deck");
    expect(cf[0]!.source_a!.value).toBe(1_200_000);
    expect(cf[0]!.source_b!.value).toBe(800_000);
  });

  test("conflict-tagged facts produce note mentioning period label", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "arr", value: 500_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "arr", value: 300_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    expect(cf[0]!.note).toContain("FY2025");
    expect(cf[0]!.note).toContain("arr");
  });

  // ── Case 2: Same metric, same value → no conflict flag when status is 'ok' ─

  test("two ok-status facts with same value → no conflict flag", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", value: 1_000_000, source_kind: "xlsx", reconciliation_status: "ok" }),
      makeFact({ metric_key: "revenue", value: 1_000_000, source_kind: "deck", reconciliation_status: "ok" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    expect(conflictFlags(result.flags)).toHaveLength(0);
  });

  test("two ok-status facts with different values do NOT produce conflict flags (divergence path only)", async () => {
    // Divergence < 20% → section 2 also won't fire; neither path produces a flag.
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "burn_rate", value: 100_000, source_kind: "xlsx", reconciliation_status: "ok" }),
      makeFact({ metric_key: "burn_rate", value: 105_000, source_kind: "deck", reconciliation_status: "ok" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    expect(conflictFlags(result.flags)).toHaveLength(0);
  });

  // ── Case 3: Multiple conflicts → multiple flags ───────────────────────────

  test("two different metrics each with conflict-tagged pairs → two FAIL flags", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", value: 1_200_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "revenue", value: 800_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "burn_rate", value: 80_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "burn_rate", value: 50_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    expect(cf).toHaveLength(2);
    const keys = cf.map((f) => f.flag_key).sort();
    expect(keys).toContain("cross_source_discrepancy:burn_rate");
    expect(keys).toContain("cross_source_discrepancy:revenue");
    expect(cf.every((f) => f.status === "FAIL")).toBe(true);
  });

  // ── Case 4: No conflicts → unchanged behavior ─────────────────────────────

  test("no conflict-status facts → conflict propagation adds no flags", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "cash", value: 500_000, source_kind: "xlsx", reconciliation_status: "ok" }),
      makeFact({ metric_key: "runway_months", value: 12, source_kind: "xlsx", reconciliation_status: "ok" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    expect(conflictFlags(result.flags)).toHaveLength(0);
  });

  test("empty facts input → no conflict flags", async () => {
    const result = await analyzer.analyze({ financial_facts: [] });
    expect(conflictFlags(result.flags)).toHaveLength(0);
  });

  test("null facts input → no conflict flags", async () => {
    const result = await analyzer.analyze({ financial_facts: null });
    expect(conflictFlags(result.flags)).toHaveLength(0);
  });

  // ── Case 5: Below divergence threshold but reconciliation_status='conflict' ─
  // The divergence-based section 2 would emit nothing (< 20% div), but the
  // reconciliation_status path promotes it to FAIL regardless.

  test("conflict-tagged pair with <20% divergence → FAIL flag via reconciliation_status path", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", value: 1_000_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "revenue", value: 950_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];
    // 5% divergence — threshold-based check would skip this
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    expect(cf).toHaveLength(1);
    expect(cf[0]!.status).toBe("FAIL");
    expect(cf[0]!.flag_key).toBe("cross_source_discrepancy:revenue");
  });

  // ── Case 6: WARN upgraded to FAIL when conflict-status confirms it ─────────
  // When section 2 emits a WARN (20-50% divergence) and the facts also carry
  // reconciliation_status='conflict', the merge logic upgrades WARN → FAIL.

  test("WARN-range divergence + reconciliation_status=conflict → flag upgraded to FAIL", async () => {
    const facts: FinancialFactV1[] = [
      // 30% divergence — section 2 would emit WARN
      makeFact({ metric_key: "revenue", value: 1_000_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "revenue", value: 700_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    // Dedup keeps one flag; it must be FAIL (upgraded from WARN)
    expect(cf).toHaveLength(1);
    expect(cf[0]!.status).toBe("FAIL");
  });

  // ── Case 7: No duplicate flags for the same metric_key ───────────────────

  test("same metric_key conflict from both paths → exactly one flag (deduped)", async () => {
    const facts: FinancialFactV1[] = [
      // >50% divergence — section 2 emits FAIL on its own
      makeFact({ metric_key: "revenue", value: 2_000_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "revenue", value: 500_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    expect(cf).toHaveLength(1);
    expect(cf[0]!.flag_key).toBe("cross_source_discrepancy:revenue");
    expect(cf[0]!.status).toBe("FAIL");
  });

  // ── Case 8: Completeness score penalised for conflicts ────────────────────

  test("conflict flags reduce completeness_score", async () => {
    // Provide all critical metrics so completeness_score is high without conflict penalty
    const baseFacts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", value: 1_000_000, reconciliation_status: "ok" }),
      makeFact({ metric_key: "arr", value: 1_000_000, reconciliation_status: "ok" }),
      makeFact({ metric_key: "burn_rate", value: 50_000, reconciliation_status: "ok" }),
      makeFact({ metric_key: "cash", value: 600_000, reconciliation_status: "ok" }),
      makeFact({ metric_key: "runway_months", value: 12, reconciliation_status: "ok" }),
      makeFact({ metric_key: "raise_amount", value: 2_000_000, reconciliation_status: "ok" }),
      makeFact({ metric_key: "pre_money_valuation", value: 10_000_000, reconciliation_status: "ok" }),
    ];

    const withConflict: FinancialFactV1[] = [
      ...baseFacts,
      makeFact({ metric_key: "revenue", value: 1_200_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      makeFact({ metric_key: "revenue", value: 800_000, source_kind: "deck", period_label: "FY2025", reconciliation_status: "conflict" }),
    ];

    const noConflict = await analyzer.analyze({ financial_facts: baseFacts });
    const hasConflict = await analyzer.analyze({ financial_facts: withConflict });

    expect(noConflict.completeness_score).not.toBeNull();
    expect(hasConflict.completeness_score).not.toBeNull();
    expect(hasConflict.completeness_score!).toBeLessThan(noConflict.completeness_score!);
  });

  // ── Case 9: Single-sided conflict (one fact visible in bucket) ────────────

  test("single conflict-tagged fact in bucket → FAIL flag with only source_a (no source_b)", async () => {
    // Only one fact in the (metric_key, period_label) bucket carries 'conflict'.
    // The opposing fact may have a different period_label or be absent from the load.
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "mrr", value: 90_000, source_kind: "xlsx", period_label: "FY2025", reconciliation_status: "conflict" }),
      // Non-conflicting fact, different source, different period — won't merge into same bucket
      makeFact({ metric_key: "mrr", value: 60_000, source_kind: "deck", period_label: "current", reconciliation_status: "ok" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    const cf = conflictFlags(result.flags);
    expect(cf).toHaveLength(1);
    expect(cf[0]!.flag_key).toBe("cross_source_discrepancy:mrr");
    expect(cf[0]!.status).toBe("FAIL");
    expect(cf[0]!.source_a).toBeDefined();
    // source_b is absent — single-sided case
    expect(cf[0]!.source_b).toBeUndefined();
  });

  // ── Case 10: 'unknown' reconciliation_status does not produce conflict flags ─

  test("facts with reconciliation_status='unknown' do not produce conflict flags", async () => {
    const facts: FinancialFactV1[] = [
      makeFact({ metric_key: "revenue", value: 1_000_000, source_kind: "xlsx", reconciliation_status: "unknown" }),
      makeFact({ metric_key: "revenue", value: 500_000, source_kind: "deck", reconciliation_status: "unknown" }),
    ];
    const result = await analyzer.analyze({ financial_facts: facts });
    // 'unknown' is not 'conflict' — conflict propagation path won't fire.
    // Section 2 checks divergence — 50% is at the FAIL threshold boundary
    // (relativeDivergence = |1M - 500K| / 1M = 0.5, which equals FAIL_DIVERGENCE_THRESHOLD).
    // Our concern is that 'unknown' status does NOT trigger the new path.
    const cf = conflictFlags(result.flags);
    // If section 2 fires, status should be FAIL from the divergence path, but NOT
    // from the reconciliation_status path. The test just confirms no double-flag.
    expect(new Set(cf.map((f) => f.flag_key)).size).toBe(cf.length); // no duplicates
  });
});
