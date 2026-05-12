/**
 * synthetic-actuals-fixture.test.ts
 *
 * REF-DEAL-5 behavioral validation for the SyntheticActuals ground-truth spec.
 * Exercises `buildFinancialTruthV1` with a fixture representing SynthCo
 * Technologies — a P&L XLSX with FY2023 + FY2024 Actuals and FY2025 + FY2026
 * Budgets in the same workbook.
 *
 * Ground truth: evaluation/ground_truth/SyntheticActuals.json
 *
 * Failure modes targeted:
 *   FM-1  Compiler promotes FY2025 Budget over FY2024 Actual as current_state.revenue
 *   FM-2  Burn rate derived from FY2025 Budget opex instead of FY2024 Actual opex
 *   FM-3  projected_only_dataset erroneously set when actuals are present
 *   FM-4  Budget revenue rows not excluded from primary resolution (projected_excluded_count < 2)
 *
 * Fixture XLSX contract (whole USD — no $000s scale):
 *   Period           Revenue      Total Opex     Gross Margin %
 *   FY2023 Actual  $1,680,000   $2,040,000       37.5%
 *   FY2024 Actual  $2,400,000   $2,280,000       45.0%   ← current_state
 *   FY2025 Budget  $4,200,000   $3,600,000       70.0%   ← forward projection +1
 *   FY2026 Budget  $7,500,000   $5,100,000       75.0%   ← forward projection +2
 *
 * All DB and API checks are SKIPPED for this synthetic deal.
 * See validate_financial_extraction.py for spec coherence checks.
 */

import { describe, it, expect } from "vitest";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { FinancialFactV1, FinancialFactSourceKind } from "@dealdecision/core";
import type { TemporalScope } from "@dealdecision/core";

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEAL_ID = "00000000-0000-4000-8000-000000000001";  // matches SyntheticActuals.json
const DOC_XLSX = "doc-synthco-pl-xlsx-0001";

const FY2023_ACTUAL_REVENUE  = 1_680_000;
const FY2024_ACTUAL_REVENUE  = 2_400_000;  // ← ground truth current_state.revenue
const FY2025_BUDGET_REVENUE  = 4_200_000;  // ← must NOT win current_state
const FY2026_BUDGET_REVENUE  = 7_500_000;

const FY2024_ACTUAL_BURN_MONTHLY = 190_000;   // $2,280,000 opex / 12
const FY2025_BUDGET_BURN_MONTHLY = 300_000;   // $3,600,000 opex / 12 — must NOT win

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function makeRevFact(opts: {
  period_label: string;
  value: number;
  temporal_scope: TemporalScope;
  source_kind?: FinancialFactSourceKind;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id:       `synthco-rev-${_seq}`,
    deal_id:       DEAL_ID,
    document_id:   DOC_XLSX,
    source_kind:   opts.source_kind ?? "xlsx",
    metric_key:    "revenue",
    metric_label:  "Total Revenue",
    period_type:   "annual",
    period_label:  opts.period_label,
    value:         opts.value,
    unit:          "currency",
    currency:      "USD",
    confidence:    opts.temporal_scope === "historical" ? "high" : "medium",
    source_pointer: `SynthCo P&L row='Total Revenue' col='${opts.period_label}'`,
    excerpt:       `Total Revenue ${opts.period_label}: ${opts.value}`,
    temporal_scope: opts.temporal_scope,
  };
}

function makeBurnFact(opts: {
  period_label: string;
  value: number;
  temporal_scope: TemporalScope;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id:       `synthco-burn-${_seq}`,
    deal_id:       DEAL_ID,
    document_id:   DOC_XLSX,
    source_kind:   "xlsx",
    metric_key:    "burn_rate",
    metric_label:  "Monthly Burn (opex/12)",
    period_type:   "monthly",
    period_label:  opts.period_label,
    value:         opts.value,
    unit:          "currency",
    currency:      "USD",
    confidence:    opts.temporal_scope === "historical" ? "high" : "medium",
    source_pointer: `SynthCo P&L derived: Total Opex ${opts.period_label} / 12`,
    excerpt:       `Monthly burn derived from ${opts.period_label} opex`,
    temporal_scope: opts.temporal_scope,
  };
}

const NULL_DECK = {
  schema_version: "deck_financial_signals_v1" as const,
  revenue_mentions: [],
  burn_mentions: [],
  runway_mentions: [],
  margin_mentions: [],
  pricing_mentions: [],
  arr_mrr_mentions: [],
  unit_econ_mentions: [],
  has_revenue: false,
  has_burn: false,
  has_runway: false,
  has_pricing: false,
  has_arr_mrr: false,
  has_unit_economics: false,
  pages_scanned: 0,
};

const NULL_PB = {
  revenue_latest: null,
  burn_monthly: null,
  runway_months: null,
  cash_latest: null,
};

// ─── Full fixture: 4 revenue cols + 2 burn cols ───────────────────────────────

const ALL_REVENUE_FACTS: FinancialFactV1[] = [
  makeRevFact({ period_label: "FY2023 Actual", value: FY2023_ACTUAL_REVENUE, temporal_scope: "historical" }),
  makeRevFact({ period_label: "FY2024 Actual", value: FY2024_ACTUAL_REVENUE, temporal_scope: "historical" }),
  makeRevFact({ period_label: "FY2025 Budget", value: FY2025_BUDGET_REVENUE, temporal_scope: "projected" }),
  makeRevFact({ period_label: "FY2026 Budget", value: FY2026_BUDGET_REVENUE, temporal_scope: "projected" }),
];

const ALL_BURN_FACTS: FinancialFactV1[] = [
  makeBurnFact({ period_label: "FY2024 Actual", value: FY2024_ACTUAL_BURN_MONTHLY, temporal_scope: "historical" }),
  makeBurnFact({ period_label: "FY2025 Budget", value: FY2025_BUDGET_BURN_MONTHLY, temporal_scope: "projected" }),
];

// ─── FM-1: Actuals beat budget in current_state.revenue ──────────────────────

describe("REF-DEAL-5 FM-1: FY2024 Actual revenue wins over FY2025 Budget", () => {
  const truth = buildFinancialTruthV1({
    facts: ALL_REVENUE_FACTS,
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const rev = truth["revenue"]!;

  it("revenue state is CONFIRMED", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("resolved_value is FY2024 Actual ($2.4M), not FY2025 Budget ($4.2M)", () => {
    expect(rev.resolved_value).toBeGreaterThanOrEqual(FY2024_ACTUAL_REVENUE * 0.9);
    expect(rev.resolved_value).toBeLessThanOrEqual(FY2024_ACTUAL_REVENUE * 1.1);
  });

  it("resolved_value is not the FY2025 Budget amount", () => {
    const val = rev.resolved_value ?? 0;
    // Must not be within 10% of the budget figure
    const isNearBudget = val >= FY2025_BUDGET_REVENUE * 0.9 && val <= FY2025_BUDGET_REVENUE * 1.1;
    expect(isNearBudget).toBe(false);
  });
});

// ─── FM-2: Burn from actuals, not from budget ─────────────────────────────────

describe("REF-DEAL-5 FM-2: FY2024 Actual burn wins over FY2025 Budget burn", () => {
  const truth = buildFinancialTruthV1({
    facts: [...ALL_REVENUE_FACTS, ...ALL_BURN_FACTS],
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const burn = truth["burn_rate"]!;

  it("burn_rate state is CONFIRMED", () => {
    expect(burn.state).toBe("CONFIRMED");
  });

  it("resolved burn is from actuals (~$190K/month), not budget (~$300K/month)", () => {
    expect(burn.resolved_value).toBeGreaterThanOrEqual(FY2024_ACTUAL_BURN_MONTHLY * 0.85);
    expect(burn.resolved_value).toBeLessThanOrEqual(FY2024_ACTUAL_BURN_MONTHLY * 1.15);
  });

  it("resolved burn is not the FY2025 Budget burn amount", () => {
    const val = burn.resolved_value ?? 0;
    const isNearBudget = val >= FY2025_BUDGET_BURN_MONTHLY * 0.85 && val <= FY2025_BUDGET_BURN_MONTHLY * 1.15;
    expect(isNearBudget).toBe(false);
  });
});

// ─── FM-3: Historical actuals present → not projected_only_dataset ────────────

describe("REF-DEAL-5 FM-3: projected_only_dataset is not set when actuals are present", () => {
  const truth = buildFinancialTruthV1({
    facts: ALL_REVENUE_FACTS,
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const rev = truth["revenue"]!;

  it("projected_only_dataset is not true", () => {
    expect(rev.projected_only_dataset).not.toBe(true);
  });
});

// ─── FM-4: Budget facts excluded from primary resolution ──────────────────────

describe("REF-DEAL-5 FM-4: both budget revenue rows counted as projected_excluded", () => {
  const truth = buildFinancialTruthV1({
    facts: ALL_REVENUE_FACTS,
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const rev = truth["revenue"]!;

  it("projected_excluded_count is at least 2 (FY2025 + FY2026 budgets excluded)", () => {
    expect(rev.projected_excluded_count ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ─── Edge case: pipelineB budget burn does not contaminate resolution ─────────

describe("REF-DEAL-5 edge: pipelineB budget burn signal does not override actual XLSX burn", () => {
  const truth = buildFinancialTruthV1({
    facts: ALL_BURN_FACTS,
    deckFinancialSignals: NULL_DECK,
    // Simulate pipeline B having picked up the larger budget burn figure
    pipelineB: { revenue_latest: null, burn_monthly: FY2025_BUDGET_BURN_MONTHLY, runway_months: null, cash_latest: null },
  });
  const burn = truth["burn_rate"]!;

  it("XLSX actual burn wins over pipelineB budget burn input", () => {
    // The historical XLSX fact should have higher source priority than pipelineB
    const val = burn.resolved_value ?? 0;
    expect(val).toBeLessThan(FY2025_BUDGET_BURN_MONTHLY);
  });
});
