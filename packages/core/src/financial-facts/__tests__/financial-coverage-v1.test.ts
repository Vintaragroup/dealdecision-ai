/**
 * financial-coverage-v1.test.ts — packages/core
 *
 * Tests for:
 *  - detectFinancialFactConflictsV1
 *  - buildFinancialCoverageV1
 */

import {
  detectFinancialFactConflictsV1,
  buildFinancialCoverageV1,
} from "../financial-coverage-v1";
import type { FinancialFactV1 } from "../financial-fact-v1";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _factSeq = 0;
function makeFact(
  metric_key: string,
  value: number,
  opts: Partial<FinancialFactV1> = {}
): FinancialFactV1 {
  const id = ++_factSeq;
  return {
    fact_id:      `factv1:d1:${metric_key}:annual:FY2024:${String(id).padStart(8, "0")}`,
    deal_id:      "d1",
    source_kind:  "xlsx",
    metric_key,
    period_type:  "annual",
    period_label: "FY2024",
    value,
    unit:         "currency",
    confidence:   "high",
    ...opts,
  };
}

// ─── detectFinancialFactConflictsV1 ──────────────────────────────────────────

describe("detectFinancialFactConflictsV1", () => {
  it("returns [] for empty input", () => {
    expect(detectFinancialFactConflictsV1([])).toEqual([]);
  });

  it("returns [] for single fact", () => {
    const f = makeFact("revenue", 1_000_000);
    expect(detectFinancialFactConflictsV1([f])).toEqual([]);
  });

  it("detects conflict when two facts have >5% divergence", () => {
    const f1 = makeFact("revenue", 1_000_000);
    const f2 = makeFact("revenue", 800_000); // 20% lower
    const conflicts = detectFinancialFactConflictsV1([f1, f2]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].metric_key).toBe("revenue");
    expect(conflicts[0].values).toContain(1_000_000);
    expect(conflicts[0].values).toContain(800_000);
    expect(conflicts[0].divergence_pct).toBeGreaterThan(0.05);
  });

  it("does NOT flag conflict when values are within 5%", () => {
    const f1 = makeFact("revenue", 1_000_000);
    const f2 = makeFact("revenue", 1_020_000); // 2% difference
    expect(detectFinancialFactConflictsV1([f1, f2])).toHaveLength(0);
  });

  it("does NOT flag conflict for different metric keys", () => {
    const f1 = makeFact("revenue",   1_000_000);
    const f2 = makeFact("burn_rate",   500_000);
    expect(detectFinancialFactConflictsV1([f1, f2])).toHaveLength(0);
  });

  it("does NOT flag conflict for same metric, different periods", () => {
    const f1 = makeFact("revenue", 1_000_000, { period_label: "FY2024" });
    const f2 = makeFact("revenue",   500_000, { period_label: "FY2023",
      fact_id: "factv1:d1:revenue:annual:FY2023:00000099" });
    expect(detectFinancialFactConflictsV1([f1, f2])).toHaveLength(0);
  });

  it("deduplicates by fact_id — same fact_id should not self-conflict", () => {
    const f = makeFact("revenue", 1_000_000);
    expect(detectFinancialFactConflictsV1([f, f])).toHaveLength(0);
  });

  it("never throws on malformed input", () => {
    expect(() =>
      detectFinancialFactConflictsV1(null as unknown as FinancialFactV1[])
    ).not.toThrow();
  });
});

// ─── buildFinancialCoverageV1 ─────────────────────────────────────────────────

describe("buildFinancialCoverageV1", () => {
  it("returns empty profile for no facts", () => {
    const cov = buildFinancialCoverageV1("d1", []);
    expect(cov.total_facts).toBe(0);
    expect(cov.metrics_present).toHaveLength(0);
    expect(cov.statements.income_statement).toBe(false);
  });

  it("sets income_statement=true when revenue fact present", () => {
    const facts = [makeFact("revenue", 1_200_000)];
    const cov = buildFinancialCoverageV1("d1", facts);
    expect(cov.statements.income_statement).toBe(true);
    expect(cov.metrics_present).toContain("revenue");
  });

  it("sets cash_flow=true when cash+burn_rate present", () => {
    const facts = [
      makeFact("cash", 900_000),
      makeFact("burn_rate", 100_000),
    ];
    const cov = buildFinancialCoverageV1("d1", facts);
    expect(cov.statements.cash_flow).toBe(true);
  });

  it("populates yearly periods from annual facts", () => {
    const facts = [
      makeFact("revenue", 1_000_000, { period_label: "FY2024" }),
      makeFact("revenue", 2_000_000, {
        period_label: "FY2025",
        fact_id: "factv1:d1:revenue:annual:FY2025:00000099",
      }),
    ];
    const cov = buildFinancialCoverageV1("d1", facts);
    expect(cov.periods.yearly).toContain("FY2024");
    expect(cov.periods.yearly).toContain("FY2025");
  });

  it("infers metrics_missing when revenue present but gross_margin absent", () => {
    const facts = [makeFact("revenue", 1_000_000)];
    const cov = buildFinancialCoverageV1("d1", facts);
    expect(cov.metrics_missing).toContain("gross_margin");
  });

  it("does NOT add gross_margin to missing when it is present", () => {
    const facts = [
      makeFact("revenue", 1_000_000),
      makeFact("gross_margin", 65, { unit: "percent" }),
    ];
    const cov = buildFinancialCoverageV1("d1", facts);
    expect(cov.metrics_missing).not.toContain("gross_margin");
  });

  it("surfaces conflicts via detectFinancialFactConflictsV1 integration", () => {
    const f1 = makeFact("revenue", 1_000_000);
    const f2 = makeFact("revenue", 700_000); // 30% divergence
    const cov = buildFinancialCoverageV1("d1", [f1, f2]);
    expect(cov.conflicts).toHaveLength(1);
    expect(cov.conflicts[0].metric).toBe("revenue");
  });

  it("returns correct confidence_distribution", () => {
    const facts = [
      makeFact("revenue", 1_000_000, { confidence: "high" }),
      makeFact("burn_rate", 100_000, { confidence: "medium" }),
      makeFact("runway_months", 10, { confidence: "low", unit: "number" }),
    ];
    const cov = buildFinancialCoverageV1("d1", facts);
    expect(cov.confidence_distribution.high).toBe(1);
    expect(cov.confidence_distribution.medium).toBe(1);
    expect(cov.confidence_distribution.low).toBe(1);
  });

  it("never throws on malformed input", () => {
    expect(() =>
      buildFinancialCoverageV1("d1", null as unknown as FinancialFactV1[])
    ).not.toThrow();
  });
});
