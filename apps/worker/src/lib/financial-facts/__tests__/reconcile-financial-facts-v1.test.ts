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

// ─── Projection guard ─────────────────────────────────────────────────────────

describe("reconcileFinancialFactsV1 — projection guard (no derivation from forecasts)", () => {
  /** Helper: make projected (temporal_scope="projected") facts. */
  function makeProjFact(overrides: Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">): FinancialFactV1 {
    return {
      fact_id:        `factv1:d1:${overrides.metric_key}:annual:FY2025E:def5678`,
      deal_id:        "d1",
      source_kind:    "xlsx",
      period_type:    "annual",
      period_label:   "FY2025",
      unit:           "currency",
      confidence:     "medium",
      temporal_scope: "projected",
      ...overrides,
    };
  }

  it("does NOT derive runway when both cash and burn_rate are projected", () => {
    const cash = makeProjFact({ metric_key: "cash",      value: 3_000_000 });
    const burn = makeProjFact({ metric_key: "burn_rate", value:   200_000 });
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    // No runway_months should be added — both inputs are projections
    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
    // Original facts preserved unchanged
    expect(result).toHaveLength(2);
  });

  it("does NOT derive runway when only cash is projected", () => {
    const cash = makeProjFact({ metric_key: "cash",      value: 2_400_000 });
    const burn = makeFact    ({ metric_key: "burn_rate", value:   150_000 });
    // Align periods
    cash.period_label = "FY2024";
    burn.period_label = "FY2024";
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it("does NOT derive runway when only burn_rate is projected", () => {
    const cash = makeFact    ({ metric_key: "cash",      value: 1_800_000 });
    const burn = makeProjFact({ metric_key: "burn_rate", value:   120_000 });
    // Align periods
    cash.period_label = "FY2024";
    burn.period_label = "FY2024";
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it("DOES derive runway when both are historical (temporal_scope=historical)", () => {
    const cash = makeFact({ metric_key: "cash",      value: 1_800_000, temporal_scope: "historical" } as Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">);
    const burn = makeFact({ metric_key: "burn_rate", value:   150_000, temporal_scope: "historical" } as Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">);
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeDefined();
    expect(runway!.value).toBeCloseTo(12, 1);
  });

  it("DOES derive runway when temporal_scope is omitted (treated as non-projected)", () => {
    // Omitted temporal_scope — original makeFact helper which doesn't set temporal_scope
    const cash = makeFact({ metric_key: "cash",      value: 900_000 });
    const burn = makeFact({ metric_key: "burn_rate", value:  90_000 });
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeDefined();
    expect(runway!.value).toBeCloseTo(10, 1);
  });

  it("does NOT derive runway when temporal_scope=scenario (considered projected)", () => {
    const cash = makeFact({ metric_key: "cash",      value: 2_400_000, temporal_scope: "scenario" } as Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">);
    const burn = makeFact({ metric_key: "burn_rate", value:   200_000 });
    cash.period_label = "FY2024";
    burn.period_label = "FY2024";
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
  });
});

// ─── Runway derivation — semantic fields ─────────────────────────────────────

describe("reconcileFinancialFactsV1 — runway derived fact fields", () => {
  it("derived runway_months carries is_derived, derivation_rule, semantic_family, semantic_role", () => {
    const cash = makeFact({ metric_key: "cash",      value: 1_800_000 });
    const burn = makeFact({ metric_key: "burn_rate", value:   150_000 });
    const result = reconcileFinancialFactsV1([cash, burn], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeDefined();
    expect(runway!.is_derived).toBe(true);
    expect(runway!.derivation_rule).toBe("runway_months_from_cash_and_burn_rate");
    expect(runway!.semantic_family).toBe("liquidity");
    expect(runway!.semantic_role).toBe("derived");
  });
});

// ─── Gross margin derivation ─────────────────────────────────────────────────

describe("reconcileFinancialFactsV1 — gross_margin derivation", () => {
  /** Build minimal revenue-model facts so semantics gate opens. */
  function grossMarginInputs(overrides?: { revValue?: number; gpValue?: number; period?: string }) {
    const period = overrides?.period ?? "FY2024";
    const revenue = makeFact({
      metric_key:   "revenue",
      value:        overrides?.revValue ?? 2_000_000,
      metric_label: "Revenue",
      period_label: period,
    });
    const grossProfit = makeFact({
      metric_key:   "gross_profit",
      value:        overrides?.gpValue ?? 1_200_000,
      metric_label: "Gross Profit",
      period_label: period,
    });
    return { revenue, grossProfit };
  }

  it("derives gross_margin from revenue + gross_profit when both present (same period)", () => {
    const { revenue, grossProfit } = grossMarginInputs();
    const result = reconcileFinancialFactsV1([revenue, grossProfit], "d1");

    const gm = result.find((f) => f.metric_key === "gross_margin");
    expect(gm).toBeDefined();
    // 1_200_000 / 2_000_000 * 100 = 60%
    expect(gm!.value).toBeCloseTo(60, 1);
    expect(gm!.unit).toBe("percent");
    expect(gm!.source_kind).toBe("unknown");
    expect(gm!.confidence).toBe("medium");
    expect(gm!.reconciliation_status).toBe("ok");
  });

  it("does NOT derive gross_margin when an explicit one already exists for the same period", () => {
    const { revenue, grossProfit } = grossMarginInputs();
    const existingGm = makeFact({ metric_key: "gross_margin", value: 55, unit: "percent" });
    const result = reconcileFinancialFactsV1([revenue, grossProfit, existingGm], "d1");

    const gmFacts = result.filter((f) => f.metric_key === "gross_margin");
    expect(gmFacts).toHaveLength(1);
    expect(gmFacts[0]!.value).toBe(55); // original preserved
  });

  it("does NOT derive gross_margin when revenue is projected", () => {
    const { revenue, grossProfit } = grossMarginInputs();
    revenue.temporal_scope = "projected";
    const result = reconcileFinancialFactsV1([revenue, grossProfit], "d1");
    const gm = result.find((f) => f.metric_key === "gross_margin");
    expect(gm).toBeUndefined();
  });

  it("does NOT derive gross_margin when gross_profit is projected", () => {
    const { revenue, grossProfit } = grossMarginInputs();
    grossProfit.temporal_scope = "projected";
    const result = reconcileFinancialFactsV1([revenue, grossProfit], "d1");
    const gm = result.find((f) => f.metric_key === "gross_margin");
    expect(gm).toBeUndefined();
  });

  it("does NOT derive gross_margin when revenue is zero", () => {
    const { revenue, grossProfit } = grossMarginInputs({ revValue: 0 });
    const result = reconcileFinancialFactsV1([revenue, grossProfit], "d1");
    const gm = result.find((f) => f.metric_key === "gross_margin");
    expect(gm).toBeUndefined();
  });

  it("derived gross_margin has is_derived + derivation_rule + semantic_family + semantic_role", () => {
    const { revenue, grossProfit } = grossMarginInputs();
    const result = reconcileFinancialFactsV1([revenue, grossProfit], "d1");

    const gm = result.find((f) => f.metric_key === "gross_margin");
    expect(gm).toBeDefined();
    expect(gm!.is_derived).toBe(true);
    expect(gm!.derivation_rule).toBe("gross_margin_from_gross_profit_and_revenue");
    expect(gm!.semantic_family).toBe("profitability");
    expect(gm!.semantic_role).toBe("derived");
  });
});

// ─── Burn rate derivation ────────────────────────────────────────────────────

describe("reconcileFinancialFactsV1 — burn_rate derivation from total_expenses", () => {
  /** Build operating-model-signalling facts. We need enough facts so that
   *  interpretFinancialSemantics().hasOperatingModel is true.
   *  The semantics layer checks for revenue + operating cost signals, so we
   *  include a revenue fact alongside total_expenses. */
  function withRevenue(expFact: FinancialFactV1): FinancialFactV1[] {
    const rev = makeFact({
      metric_key:   "revenue",
      value:        5_000_000,
      period_label: expFact.period_label,
    });
    return [rev, expFact];
  }

  it("derives monthly burn_rate directly from monthly total_expenses", () => {
    const expenses = makeFact({
      metric_key:  "total_expenses",
      value:       250_000,
      period_type: "monthly",
      period_label: "Jan 2024",
    });
    const result = reconcileFinancialFactsV1(withRevenue(expenses), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(250_000);
    expect(burn!.period_type).toBe("monthly");
  });

  it("derives monthly burn_rate from annual total_expenses ÷ 12", () => {
    const expenses = makeFact({
      metric_key:   "total_expenses",
      value:        3_000_000,
      period_type:  "annual",
      period_label: "FY2024",
    });
    const result = reconcileFinancialFactsV1(withRevenue(expenses), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(250_000); // 3_000_000 / 12
    expect(burn!.period_type).toBe("monthly");
  });

  it("derives monthly burn_rate from quarterly total_expenses ÷ 3", () => {
    const expenses = makeFact({
      metric_key:   "total_expenses",
      value:        900_000,
      period_type:  "quarterly",
      period_label: "Q1 2024",
    });
    const result = reconcileFinancialFactsV1(withRevenue(expenses), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(300_000); // 900_000 / 3
    expect(burn!.period_type).toBe("monthly");
  });

  it("does NOT derive burn_rate when an explicit one already exists for the same period", () => {
    const expenses = makeFact({
      metric_key:   "total_expenses",
      value:        3_000_000,
      period_type:  "annual",
      period_label: "FY2024",
    });
    const existingBurn = makeFact({
      metric_key:   "burn_rate",
      value:        200_000,
      period_label: "FY2024",
    });
    const facts = [...withRevenue(expenses), existingBurn];
    const result = reconcileFinancialFactsV1(facts, "d1");

    const burnFacts = result.filter((f) => f.metric_key === "burn_rate");
    expect(burnFacts).toHaveLength(1);
    expect(burnFacts[0]!.value).toBe(200_000); // original preserved
  });

  it("does NOT derive burn_rate from projected total_expenses", () => {
    const expenses = makeFact({
      metric_key:      "total_expenses",
      value:           2_400_000,
      period_type:     "annual",
      period_label:    "FY2025",
      temporal_scope:  "projected",
    } as Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">);
    const result = reconcileFinancialFactsV1(withRevenue(expenses), "d1");
    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeUndefined();
  });

  it("derived burn_rate has is_derived + derivation_rule + semantic_family + semantic_role", () => {
    const expenses = makeFact({
      metric_key:   "total_expenses",
      value:        1_800_000,
      period_type:  "annual",
      period_label: "FY2024",
    });
    const result = reconcileFinancialFactsV1(withRevenue(expenses), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.is_derived).toBe(true);
    expect(burn!.derivation_rule).toBe("burn_rate_from_total_expenses_run_rate");
    expect(burn!.semantic_family).toBe("liquidity");
    expect(burn!.semantic_role).toBe("derived");
  });
});

// ─── Rule 3 opex fallback ─────────────────────────────────────────────────────

describe("reconcileFinancialFactsV1 — burn_rate derivation from opex (Rule 3 fallback)", () => {
  function withRevenue(expFact: FinancialFactV1): FinancialFactV1[] {
    return [
      makeFact({ metric_key: "revenue", value: 5_000_000, period_label: expFact.period_label }),
      expFact,
    ];
  }

  it("derives burn_rate from annual opex ÷ 12 when no total_expenses present", () => {
    const opex = makeFact({
      metric_key:   "opex",
      value:        2_400_000,
      period_type:  "annual",
      period_label: "FY2024",
    });
    const result = reconcileFinancialFactsV1(withRevenue(opex), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(200_000); // 2_400_000 / 12
    expect(burn!.derivation_rule).toBe("burn_rate_from_opex_run_rate");
    expect(burn!.is_derived).toBe(true);
  });

  it("derives burn_rate from quarterly opex ÷ 3", () => {
    const opex = makeFact({
      metric_key:   "opex",
      value:        600_000,
      period_type:  "quarterly",
      period_label: "Q2 2024",
    });
    const result = reconcileFinancialFactsV1(withRevenue(opex), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(200_000); // 600_000 / 3
    expect(burn!.derivation_rule).toBe("burn_rate_from_opex_run_rate");
  });

  it("prefers total_expenses over opex when both present", () => {
    const totalExp = makeFact({
      metric_key:   "total_expenses",
      value:        3_600_000,
      period_type:  "annual",
      period_label: "FY2024",
    });
    const opex = makeFact({
      metric_key:   "opex",
      value:        1_200_000, // different value
      period_type:  "annual",
      period_label: "FY2024",
    });
    const rev = makeFact({ metric_key: "revenue", value: 5_000_000, period_label: "FY2024" });
    const result = reconcileFinancialFactsV1([rev, totalExp, opex], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(300_000); // 3_600_000 / 12 from total_expenses
    expect(burn!.derivation_rule).toBe("burn_rate_from_total_expenses_run_rate");
  });

  it("does NOT derive from projected opex", () => {
    const opex = makeFact({
      metric_key:      "opex",
      value:           2_400_000,
      period_type:     "annual",
      period_label:    "FY2025",
      temporal_scope:  "projected",
    } as Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">);
    const result = reconcileFinancialFactsV1(withRevenue(opex), "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeUndefined();
  });
});

// ─── Rule 4: burn_rate from cash_outflow_operating ────────────────────────────

describe("reconcileFinancialFactsV1 — Rule 4: burn_rate from cash_outflow_operating", () => {
  function makeOutflow(overrides: Partial<FinancialFactV1>): FinancialFactV1 {
    return {
      fact_id:      `factv1:d1:cash_outflow_operating:unknown:Year_12:aaa00001`,
      deal_id:      "d1",
      source_kind:  "xlsx",
      metric_key:   "cash_outflow_operating",
      period_type:  "unknown",
      period_label: "Year 12",
      value:        1_453_000,
      unit:         "currency",
      confidence:   "high",
      ...overrides,
    };
  }

  it("derives burn_rate from cash_outflow_operating with ordinal 'Year N' label (÷3)", () => {
    const outflow = makeOutflow({});
    const cash = makeFact({ metric_key: "cash", value: 7_812_000, period_type: "unknown", period_label: "Year 12" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(484_333); // Math.round(1_453_000 / 3)
    expect(burn!.confidence).toBe("low");
    expect(burn!.derivation_rule).toBe("burn_rate_from_cash_outflow_operating");
    expect(burn!.is_derived).toBe(true);
    expect(burn!.semantic_family).toBe("liquidity");
    expect(burn!.period_type).toBe("monthly");
    expect(burn!.period_label).toBe("Year 12");
  });

  it("derives burn_rate even when cash_outflow_operating is temporal_scope=projected", () => {
    const outflow = makeOutflow({ temporal_scope: "projected" });
    const cash = makeFact({ metric_key: "cash", value: 5_000_000, period_type: "unknown", period_label: "Year 12" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined(); // projection guard does NOT apply to Rule 4
  });

  it("derives burn_rate from monthly cash_outflow_operating directly", () => {
    const outflow = makeOutflow({ period_type: "monthly", period_label: "Jan 2024", value: 300_000 });
    const cash = makeFact({ metric_key: "cash", value: 2_400_000, period_label: "Jan 2024" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(300_000); // monthly direct
  });

  it("derives burn_rate from quarterly cash_outflow_operating ÷ 3", () => {
    const outflow = makeOutflow({ period_type: "quarterly", period_label: "Q1 2024", value: 900_000 });
    const cash = makeFact({ metric_key: "cash", value: 5_000_000, period_label: "Q1 2024" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(300_000); // 900_000 / 3
  });

  it("derives burn_rate from annual cash_outflow_operating ÷ 12", () => {
    const outflow = makeOutflow({ period_type: "annual", period_label: "FY2024", value: 2_400_000 });
    const cash = makeFact({ metric_key: "cash", value: 5_000_000, period_label: "FY2024" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(200_000); // 2_400_000 / 12
  });

  it("skips period_type=unknown when label doesn't match Year N pattern", () => {
    const outflow = makeOutflow({ period_type: "unknown", period_label: "TTM", value: 1_000_000 });
    const cash = makeFact({ metric_key: "cash", value: 5_000_000, period_label: "TTM" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeUndefined();
  });

  it("skips low-confidence cash_outflow_operating", () => {
    const outflow = makeOutflow({ confidence: "low" });
    const cash = makeFact({ metric_key: "cash", value: 5_000_000, period_label: "Year 12" });
    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeUndefined();
  });

  it("does NOT derive if explicit burn_rate already exists for same period", () => {
    const outflow = makeOutflow({});
    const cash = makeFact({ metric_key: "cash", value: 7_812_000, period_type: "unknown", period_label: "Year 12" });
    const explicitBurn = makeFact({
      metric_key:   "burn_rate",
      value:        500_000,
      period_label: "Year 12",
      fact_id:      "factv1:d1:burn_rate:monthly:Year_12:explicit0",
    });
    const result = reconcileFinancialFactsV1([outflow, cash, explicitBurn], "d1");

    const burnFacts = result.filter((f) => f.metric_key === "burn_rate");
    expect(burnFacts).toHaveLength(1);
    expect(burnFacts[0]!.value).toBe(500_000); // explicit wins
  });
});

// ─── Rule 4b: runway chaining from cash_outflow_operating ─────────────────────

describe("reconcileFinancialFactsV1 — Rule 4b: runway chaining from cash_outflow_operating", () => {
  it("derives both burn_rate AND runway_months from cash_outflow_operating + cash in one pass", () => {
    const outflow: FinancialFactV1 = {
      fact_id:      "factv1:d1:cash_outflow_operating:unknown:Year_12:aaa00001",
      deal_id:      "d1",
      source_kind:  "xlsx",
      metric_key:   "cash_outflow_operating",
      period_type:  "unknown",
      period_label: "Year 12",
      value:        1_453_000,
      unit:         "currency",
      confidence:   "high",
      temporal_scope: "projected",
    };
    const cash = makeFact({
      metric_key:   "cash",
      value:        7_812_000,
      period_type:  "unknown",
      period_label: "Year 12",
    });

    const result = reconcileFinancialFactsV1([outflow, cash], "d1");

    const burn = result.find((f) => f.metric_key === "burn_rate");
    expect(burn).toBeDefined();
    expect(burn!.value).toBe(484_333);

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeDefined();
    // 7_812_000 / 484_333 ≈ 16.1
    expect(runway!.value).toBeCloseTo(16.1, 0);
    expect(runway!.confidence).toBe("low");
    expect(runway!.is_derived).toBe(true);
    expect(runway!.derivation_rule).toBe("runway_months_from_cash_and_outflow");
    expect(runway!.semantic_family).toBe("liquidity");
  });

  it("does NOT derive runway_months if cash is absent for that period", () => {
    const outflow: FinancialFactV1 = {
      fact_id:      "factv1:d1:cash_outflow_operating:unknown:Year_12:aaa00001",
      deal_id:      "d1",
      source_kind:  "xlsx",
      metric_key:   "cash_outflow_operating",
      period_type:  "unknown",
      period_label: "Year 12",
      value:        1_453_000,
      unit:         "currency",
      confidence:   "high",
    };
    // no cash fact
    const rev = makeFact({ metric_key: "revenue", value: 5_000_000, period_label: "Year 12" });
    const result = reconcileFinancialFactsV1([outflow, rev], "d1");

    const runway = result.find((f) => f.metric_key === "runway_months");
    expect(runway).toBeUndefined();
  });

  it("does NOT duplicate runway_months if it already exists for same period", () => {
    const outflow: FinancialFactV1 = {
      fact_id:      "factv1:d1:cash_outflow_operating:unknown:Year_12:aaa00001",
      deal_id:      "d1",
      source_kind:  "xlsx",
      metric_key:   "cash_outflow_operating",
      period_type:  "unknown",
      period_label: "Year 12",
      value:        1_453_000,
      unit:         "currency",
      confidence:   "high",
    };
    const cash = makeFact({ metric_key: "cash", value: 7_812_000, period_type: "unknown", period_label: "Year 12" });
    const existingRunway = makeFact({
      metric_key:   "runway_months",
      value:        18,
      period_label: "Year 12",
      fact_id:      "factv1:d1:runway_months:annual:Year_12:explicit1",
    });
    const result = reconcileFinancialFactsV1([outflow, cash, existingRunway], "d1");

    const runwayFacts = result.filter((f) => f.metric_key === "runway_months");
    expect(runwayFacts).toHaveLength(1);
    expect(runwayFacts[0]!.value).toBe(18); // original preserved
  });
});

// ─── Rule 5: ARR derivation from structured MRR ───────────────────────────────

describe("reconcileFinancialFactsV1 — Rule 5: ARR derivation from MRR × 12", () => {
  it("derives ARR = MRR × 12 when structured MRR exists and no ARR", () => {
    const mrr = makeFact({ metric_key: "mrr", value: 50_000, source_kind: "xlsx" });
    const result = reconcileFinancialFactsV1([mrr, makeFact({ metric_key: "revenue", value: 600_000 })], "d1");
    const arr = result.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(600_000); // 50_000 × 12
    expect(arr!.source_kind).toBe("structured_derived");
    expect(arr!.is_derived).toBe(true);
    expect(arr!.derivation_rule).toBe("arr_from_mrr_times_12");
    expect(arr!.confidence).toBe("medium");
  });

  it("does NOT derive ARR when explicit ARR already exists for the same period", () => {
    const mrr = makeFact({ metric_key: "mrr", value: 50_000, source_kind: "xlsx" });
    const arr = makeFact({ metric_key: "arr", value: 700_000 });
    const result = reconcileFinancialFactsV1([mrr, arr], "d1");
    const arrFacts = result.filter((f) => f.metric_key === "arr");
    expect(arrFacts).toHaveLength(1);
    expect(arrFacts[0]!.value).toBe(700_000); // original unchanged
  });

  it("does NOT derive ARR from deck MRR (source_kind = deck)", () => {
    const mrrDeck = makeFact({ metric_key: "mrr", value: 100_000, source_kind: "deck" });
    const revenue = makeFact({ metric_key: "revenue", value: 1_200_000 });
    const result = reconcileFinancialFactsV1([mrrDeck, revenue], "d1");
    const arr = result.find((f) => f.metric_key === "arr");
    expect(arr).toBeUndefined();
  });

  it("does NOT derive ARR from narrative MRR (source_kind = narrative)", () => {
    const mrrNarr = makeFact({ metric_key: "mrr", value: 80_000, source_kind: "narrative" });
    const revenue = makeFact({ metric_key: "revenue", value: 960_000 });
    const result = reconcileFinancialFactsV1([mrrNarr, revenue], "d1");
    expect(result.find((f) => f.metric_key === "arr")).toBeUndefined();
  });

  it("does NOT derive ARR from projected MRR (temporal_scope = projected)", () => {
    const mrrProj = makeFact({ metric_key: "mrr", value: 75_000, source_kind: "xlsx", temporal_scope: "projected" });
    const revenue = makeFact({ metric_key: "revenue", value: 900_000 });
    const result = reconcileFinancialFactsV1([mrrProj, revenue], "d1");
    expect(result.find((f) => f.metric_key === "arr")).toBeUndefined();
  });

  it("does NOT derive ARR from low-confidence MRR", () => {
    const mrrLow = makeFact({ metric_key: "mrr", value: 60_000, source_kind: "xlsx", confidence: "low" });
    const revenue = makeFact({ metric_key: "revenue", value: 720_000 });
    const result = reconcileFinancialFactsV1([mrrLow, revenue], "d1");
    expect(result.find((f) => f.metric_key === "arr")).toBeUndefined();
  });

  it("does NOT derive ARR when MRR value is 0", () => {
    const mrrZero = makeFact({ metric_key: "mrr", value: 0, source_kind: "xlsx" });
    const revenue = makeFact({ metric_key: "revenue", value: 500_000 });
    const result = reconcileFinancialFactsV1([mrrZero, revenue], "d1");
    expect(result.find((f) => f.metric_key === "arr")).toBeUndefined();
  });

  it("derived ARR has correct semantic metadata", () => {
    const mrr = makeFact({ metric_key: "mrr", value: 25_000, source_kind: "pdf_table" });
    const revenue = makeFact({ metric_key: "revenue", value: 300_000 });
    const result = reconcileFinancialFactsV1([mrr, revenue], "d1");
    const arr = result.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.semantic_family).toBe("revenue");
    expect(arr!.semantic_role).toBe("derived");
    expect(arr!.reconciliation_status).toBe("ok");
    expect(arr!.unit).toBe("currency");
  });

  it("derives ARR per period — two MRR periods produce two ARR facts", () => {
    const mrr2024 = makeFact({ metric_key: "mrr", value: 40_000, source_kind: "xlsx", period_label: "FY2024",
      fact_id: "factv1:d1:mrr:annual:FY2024:aaa" });
    const mrr2025 = makeFact({ metric_key: "mrr", value: 50_000, source_kind: "xlsx", period_label: "FY2025",
      fact_id: "factv1:d1:mrr:annual:FY2025:bbb" });
    const result = reconcileFinancialFactsV1([mrr2024, mrr2025], "d1");
    const arrFacts = result.filter((f) => f.metric_key === "arr");
    expect(arrFacts).toHaveLength(2);
    const arr2024 = arrFacts.find((f) => f.period_label === "FY2024");
    const arr2025 = arrFacts.find((f) => f.period_label === "FY2025");
    expect(arr2024!.value).toBe(480_000);  // 40_000 × 12
    expect(arr2025!.value).toBe(600_000);  // 50_000 × 12
  });

  it("is idempotent — running reconcile twice does not duplicate the derived ARR", () => {
    const mrr = makeFact({ metric_key: "mrr", value: 30_000, source_kind: "xlsx" });
    const revenue = makeFact({ metric_key: "revenue", value: 360_000 });
    const firstPass = reconcileFinancialFactsV1([mrr, revenue], "d1");
    const secondPass = reconcileFinancialFactsV1(firstPass, "d1");
    const arrFacts = secondPass.filter((f) => f.metric_key === "arr");
    expect(arrFacts).toHaveLength(1);
  });
});


