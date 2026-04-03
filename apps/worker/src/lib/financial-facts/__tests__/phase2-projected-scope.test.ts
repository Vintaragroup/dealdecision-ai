/**
 * phase2-projected-scope.test.ts
 *
 * Phase 2 Fix #2 — Projected vs current separation in truth resolution.
 *
 * Validates that `collectFactRegistrySources` (inside `buildFinancialTruthV1`)
 * correctly:
 *   1. Excludes explicitly projected/scenario/target facts from primary resolution
 *   2. Excludes unknown-scope facts whose period year > currentYear
 *   3. Prefers current/historical facts over future-year facts in same document
 *   4. Falls back to projected-only when no current/historical facts exist
 *      and marks the result projected_only_dataset=true
 *   5. Does not let future years outrank current/historical in timeseries collapse
 *   6. Counts excluded projected + future-unknown facts for auditability
 */

import { describe, it, expect } from "vitest";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { FinancialFactV1, FinancialFactSourceKind } from "@dealdecision/core";
import type { TemporalScope } from "@dealdecision/core";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEAL_ID = "phase2-projected-test";
const DOC_A   = "doc-aaaa-0001";
const DOC_B   = "doc-bbbb-0002";

// The reference year used for "future year" comparisons.
// We pick a year well in the future relative to 2026 so tests don't expire.
const FUTURE_YEAR  = new Date().getFullYear() + 2;  // e.g. 2028
const CURRENT_YEAR = new Date().getFullYear();       // 2026
const PAST_YEAR    = CURRENT_YEAR - 2;               // e.g. 2024

let _seq = 0;
function makeRevFact(opts: {
  document_id?: string;
  period_label: string;
  value: number;
  temporal_scope?: TemporalScope;
  source_kind?: FinancialFactSourceKind;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id: `fact-proj-${_seq}`,
    deal_id: DEAL_ID,
    document_id: opts.document_id ?? DOC_A,
    source_kind: opts.source_kind ?? "xlsx",
    metric_key: "revenue",
    metric_label: "Revenue",
    period_type: "annual",
    period_label: opts.period_label,
    value: opts.value,
    unit: "currency",
    currency: "USD",
    confidence: "high",
    source_pointer: `test period=${opts.period_label}`,
    excerpt: `Revenue ${opts.period_label}: ${opts.value}`,
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
  pages_scanned: 10,
};

const NULL_PB = { revenue_latest: null, burn_monthly: null, runway_months: null, cash_latest: null };

// Helper to run truth builder
function buildTruth(facts: FinancialFactV1[]) {
  return buildFinancialTruthV1({ facts, deckFinancialSignals: NULL_DECK, pipelineB: NULL_PB });
}

// ─── Test 1: Explicitly projected fact excluded ───────────────────────────────

describe("Phase 2 Fix #2 — explicitly projected fact excluded from resolution", () => {
  const CURRENT_VAL  = 3_000_000;
  const PROJ_VAL     = 8_000_000;  // projected; should not win

  const facts = [
    makeRevFact({ period_label: `FY${PAST_YEAR}`, value: CURRENT_VAL, temporal_scope: "historical" }),
    makeRevFact({ period_label: `FY${FUTURE_YEAR}`, value: PROJ_VAL, temporal_scope: "projected" }),
  ];

  const truth = buildTruth(facts);
  const rev = truth["revenue"]!;

  it("state is CONFIRMED (one non-projected source)", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("resolved_value is the historical value, not the projected one", () => {
    expect(rev.resolved_value).toBe(CURRENT_VAL);
  });

  it("projected_excluded_count is 1", () => {
    expect(rev.projected_excluded_count).toBe(1);
  });

  it("projected_only_dataset is not set", () => {
    expect(rev.projected_only_dataset).toBeUndefined();
  });
});

// ─── Test 2: Unknown-scope future-year fact excluded ──────────────────────────

describe("Phase 2 Fix #2 — unknown-scope future-year fact deprioritized", () => {
  const HISTORICAL_VAL = 2_500_000;
  const FUTURE_VAL     = 9_000_000;  // future year, no temporal_scope → should be deprioritized

  const facts = [
    makeRevFact({ period_label: `FY${PAST_YEAR}`, value: HISTORICAL_VAL }),
    // No temporal_scope + future year → should be excluded from primary
    makeRevFact({ period_label: `FY${FUTURE_YEAR}`, value: FUTURE_VAL }),
  ];

  const truth = buildTruth(facts);
  const rev = truth["revenue"]!;

  it("state is CONFIRMED (future-year unknown-scope excluded from primary)", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("resolved_value uses the historical value, not the future year", () => {
    expect(rev.resolved_value).toBe(HISTORICAL_VAL);
  });

  it("future_unknown_excluded_count is 1", () => {
    expect(rev.future_unknown_excluded_count).toBe(1);
  });

  it("projected_only_dataset is not set", () => {
    expect(rev.projected_only_dataset).toBeUndefined();
  });
});

// ─── Test 3: Same-document mix — current/historical preferred over future-year ─

describe("Phase 2 Fix #2 — same-document: current period preferred over future year in timeseries", () => {
  const CURRENT_VAL = 4_000_000;
  const PROJ_VAL    = 7_000_000;

  const facts = [
    // This doc has both historical and future-year facts
    makeRevFact({ period_label: `FY${PAST_YEAR - 1}`, value: 2_500_000, temporal_scope: "historical" }),
    makeRevFact({ period_label: `FY${PAST_YEAR}`, value: CURRENT_VAL, temporal_scope: "historical" }),
    makeRevFact({ period_label: `FY${FUTURE_YEAR}`, value: PROJ_VAL, temporal_scope: "projected" }),
  ];

  const truth = buildTruth(facts);
  const rev = truth["revenue"]!;

  it("state is CONFIRMED", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("resolved_value is the most recent historical value, not future-year", () => {
    expect(rev.resolved_value).toBe(CURRENT_VAL);
  });

  it("intra_document_timeseries is true (multi-period document)", () => {
    // projected facts are excluded before grouping, so the 2 historical facts
    // form a timeseries in the same doc
    expect(rev.intra_document_timeseries).toBe(true);
  });

  it("projected_excluded_count reflects the excluded projected fact", () => {
    expect(rev.projected_excluded_count).toBe(1);
  });
});

// ─── Test 4: Projected-only dataset resolves but is marked ───────────────────

describe("Phase 2 Fix #2 — projected-only dataset", () => {
  const PROJ_VAL_A = 5_000_000;
  const PROJ_VAL_B = 5_200_000;  // close agreement

  const facts = [
    makeRevFact({ period_label: `FY${FUTURE_YEAR}`, value: PROJ_VAL_A, temporal_scope: "projected" }),
    makeRevFact({ period_label: `FY${FUTURE_YEAR + 1}`, value: PROJ_VAL_B, temporal_scope: "projected" }),
  ];

  const truth = buildTruth(facts);
  const rev = truth["revenue"]!;

  it("projected_only_dataset is true", () => {
    expect(rev.projected_only_dataset).toBe(true);
  });

  it("state resolves (not INSUFFICIENT) — projected facts provide a value", () => {
    // Projected-only deal still resolves, but dataset is clearly marked
    expect(rev.state).not.toBe("INSUFFICIENT");
    expect(rev.resolved_value).not.toBeNull();
  });

  it("projected_excluded facts NOT counted in excluded (they are the only source)", () => {
    // When they are the only source, they are used as fallback, not excluded
    expect(rev.projected_excluded_count).toBeUndefined();
  });
});

// ─── Test 5: Future-year unknown-scope only → also projected-only fallback ───

describe("Phase 2 Fix #2 — future-year unknown-scope only dataset", () => {
  const FUTURE_VAL = 6_000_000;

  const facts = [
    makeRevFact({ period_label: `FY${FUTURE_YEAR}`, value: FUTURE_VAL }),
    // No temporal_scope, future year only
  ];

  const truth = buildTruth(facts);
  const rev = truth["revenue"]!;

  it("projected_only_dataset is true (future-year unknown used as fallback)", () => {
    expect(rev.projected_only_dataset).toBe(true);
  });

  it("still resolves to the only available value", () => {
    expect(rev.state).not.toBe("INSUFFICIENT");
    expect(rev.resolved_value).toBe(FUTURE_VAL);
  });
});

// ─── Test 6: Current + projected cross-document — CONFIRMED from current ─────

describe("Phase 2 Fix #2 — current doc CONFIRMED, projected doc excluded", () => {
  const CURRENT_DOC_VAL  = 3_500_000;
  const PROJECTED_DOC_VAL = 10_000_000;

  const facts = [
    // Doc A: historical revenue
    makeRevFact({ document_id: DOC_A, period_label: `FY${PAST_YEAR}`, value: CURRENT_DOC_VAL, temporal_scope: "historical" }),
    // Doc B: projected-only revenue (different document)
    makeRevFact({ document_id: DOC_B, period_label: `FY${FUTURE_YEAR}`, value: PROJECTED_DOC_VAL, temporal_scope: "projected" }),
  ];

  const truth = buildTruth(facts);
  const rev = truth["revenue"]!;

  it("state is CONFIRMED (only one primary source survives)", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("resolved_value is from the current/historical source", () => {
    expect(rev.resolved_value).toBe(CURRENT_DOC_VAL);
  });

  it("projected_excluded_count is 1", () => {
    expect(rev.projected_excluded_count).toBe(1);
  });
});

// ─── Test 7: Scenario fact excluded ──────────────────────────────────────────

describe("Phase 2 Fix #2 — scenario fact excluded", () => {
  const ACTUAL_VAL   = 2_000_000;
  const SCENARIO_VAL = 15_000_000;

  const facts = [
    makeRevFact({ period_label: `FY${PAST_YEAR}`, value: ACTUAL_VAL, temporal_scope: "historical" }),
    makeRevFact({ period_label: `FY${FUTURE_YEAR} bull case`, value: SCENARIO_VAL, temporal_scope: "scenario" }),
  ];

  const truth = buildTruth(facts);

  it("resolved_value is the actual value, not the scenario", () => {
    expect(truth["revenue"]!.resolved_value).toBe(ACTUAL_VAL);
  });

  it("projected_excluded_count is 1 (scenario is counted as projected exclusion)", () => {
    expect(truth["revenue"]!.projected_excluded_count).toBe(1);
  });
});

// ─── Test 8: past-year no-scope fact passes (historical inference) ────────────

describe("Phase 2 Fix #2 — past-year unknown-scope fact is included as primary", () => {
  const PAST_VAL = 1_800_000;

  const facts = [
    // No temporal_scope but year is clearly in the past
    makeRevFact({ period_label: `FY${PAST_YEAR}`, value: PAST_VAL }),
  ];

  const truth = buildTruth(facts);

  it("state is CONFIRMED (unknown-past is in primary set)", () => {
    expect(truth["revenue"]!.state).toBe("CONFIRMED");
  });

  it("resolved_value is set", () => {
    expect(truth["revenue"]!.resolved_value).toBe(PAST_VAL);
  });

  it("projected_only_dataset is not set", () => {
    expect(truth["revenue"]!.projected_only_dataset).toBeUndefined();
  });
});
