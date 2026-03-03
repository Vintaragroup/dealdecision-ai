/**
 * reconcile-financial-facts-v1.test.ts
 */

import { describe, it, expect } from "vitest";
import { reconcileFinancialFactsV1 } from "../reconcile-financial-facts-v1";
import type { FinancialFactV1 } from "@dealdecision/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">): FinancialFactV1 {
  return {
    fact_id:      `factv1:d1:${overrides.metric_key}:annual:FY2024:abc12345`,
    deal_id:      "d1",
    source_kind:  "xlsx",
    period_type:  "annual",
    period_label: "FY2024",
    unit:         "currency",
    confidence:   "high",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reconcileFinancialFactsV1 — runway derivation", () => {
  it("adds runway_months when cash + burn_rate exist for same period", () => {
    const cash  = makeFact({ metric_key: "cash",      value: 1_800_000 });
    const burn  = makeFact({ metric_key: "burn_rate", value:   150_000 });
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    expect(result.length).toBe(3);
    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeDefined();
    expect(runway!.value).toBeCloseTo(12, 1);  // 1_800_000 / 150_000 = 12
    expect(runway!.source_kind).toBe("unknown");
    expect(runway!.confidence).toBe("medium");
    expect(runway!.reconciliation_status).toBe("ok");
  });

  it("does NOT derive runway when runway_months already present", () => {
    const cash    = makeFact({ metric_key: "cash",          value: 1_800_000 });
    const burn    = makeFact({ metric_key: "burn_rate",     value:   150_000 });
    const runway  = makeFact({ metric_key: "runway_months", value: 14 });
    const result  = reconcileFinancialFactsV1([cash, burn, runway], "d1");

    const runwayFacts = result.filter((f) => f.metric_key === "runway_months");
    expect(runwayFacts).toHaveLength(1); // still only original
    expect(runwayFacts[0].value).toBe(14);
  });

  it("does NOT add derived runway when burn_rate is 0 or negative", () => {
    const cash  = makeFact({ metric_key: "cash",      value: 1_000_000 });
    const burn  = makeFact({ metric_key: "burn_rate", value: 0 });
    const result = reconcileFinancialFactsV1([cash, burn], "d1");
    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
  });

  it("does NOT derive when periods do not match", () => {
    const cash  = makeFact({ metric_key: "cash",      value: 1_200_000, period_label: "FY2024" });
    const burn  = makeFact({ metric_key: "burn_rate", value:   100_000, period_label: "FY2025",
      fact_id: "factv1:d1:burn_rate:annual:FY2025:abc12345" });
    const result = reconcileFinancialFactsV1([cash, burn], "d1");
    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
  });

  it("returns original facts unchanged when input is too small", () => {
    const cash = makeFact({ metric_key: "cash", value: 100_000 });
    const result = reconcileFinancialFactsV1([cash], "d1");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(cash); // same reference
  });

  it("never mutates input array", () => {
    const cash  = makeFact({ metric_key: "cash",      value: 600_000 });
    const burn  = makeFact({ metric_key: "burn_rate", value:  60_000 });
    const input = [cash, burn];
    reconcileFinancialFactsV1(input, "d1");
    expect(input).toHaveLength(2); // not mutated
  });

  it("never throws on empty array", () => {
    expect(() => reconcileFinancialFactsV1([], "d1")).not.toThrow();
    expect(reconcileFinancialFactsV1([], "d1")).toEqual([]);
  });
});
