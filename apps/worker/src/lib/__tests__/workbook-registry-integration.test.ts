/**
 * Phase 2 Integration: Workbook Facts in Financial Fact Registry
 *
 * Coverage:
 *  1. buildFinancialFactRegistryV1 — workbookFacts appear in registry output
 *  2. buildFinancialFactRegistryV1 — workbookFacts with projection safety:
 *       projected workbook fact is DROPPED when historical fact exists for same key
 *  3. buildFinancialFactRegistryV1 — projected workbook fact IS INCLUDED when
 *       no historical/current fact exists for same key
 *  4. buildFinancialFactRegistryV1 — scenario workbook fact is DROPPED when
 *       historical fact exists; both occupy same metric_key+period_label
 *  5. buildFinancialFactRegistryV1 — workbookFacts empty array is safe (no crash)
 *  6. buildFinancialFactRegistryV1 — workbookFacts undefined is safe (no crash)
 *  7. mergeFactsByConfidence — realized incoming replaces projected existing
 *  8. mergeFactsByConfidence — existing realized blocks incoming projected
 *  9. mergeFactsByConfidence — two realized facts: higher source_kind rank wins
 * 10. FusedFact / registry output: scenario + temporal_scope survive end-to-end
 */

import { describe, it, expect } from "vitest";
import type { FinancialFactV1 } from "@dealdecision/core";
import { buildFinancialFactRegistryV1 } from "../build-financial-fact-registry-v1.js";
import { mergeFactsByConfidence } from "../financial-facts/populate-financial-fact-registry-v1.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEAL_ID = "deal-reg-integ-001";
const DOC_ID  = "doc-reg-integ-001";

/** Build a minimal valid FinancialFactV1 with overrides. */
function makeFactV1(overrides: Partial<FinancialFactV1> & {
  metric_key: string;
  period_label: string;
  value: number;
}): FinancialFactV1 {
  const { metric_key, period_label, value, ...rest } = overrides;
  return {
    fact_id:      `factv1:${DEAL_ID}:${metric_key}:unknown:${period_label}:${Math.random().toString(36).slice(2, 10)}`,
    deal_id:      DEAL_ID,
    document_id:  DOC_ID,
    source_kind:  "xlsx",
    metric_key,
    period_label,
    period_type:  "unknown",
    value,
    unit:         "currency",
    currency:     "USD",
    confidence:   "medium",
    ...rest,
  };
}

// Historical revenue fact from structured parser (already in registry)
const HISTORICAL_REVENUE: FinancialFactV1 = makeFactV1({
  fact_id:       `factv1:${DEAL_ID}:revenue:annual:2024:aabbccdd`,
  metric_key:    "revenue",
  period_label:  "2024",
  period_type:   "annual",
  value:         7_200_000,
  temporal_scope: "historical",
  source_kind:   "xlsx",
  confidence:    "high",
});

// Projected workbook fact for the SAME metric+period
const PROJECTED_REVENUE_SAME_PERIOD: FinancialFactV1 = makeFactV1({
  metric_key:    "revenue",
  period_label:  "2024",
  period_type:   "annual",
  value:         9_000_000,  // different (model) value
  temporal_scope: "projected",
  source_kind:   "xlsx",
  confidence:    "medium",
});

// Projected workbook fact for a DIFFERENT future period (2028 is unambiguously future)
const PROJECTED_REVENUE_FUTURE: FinancialFactV1 = makeFactV1({
  metric_key:    "revenue",
  period_label:  "2028",
  period_type:   "annual",
  value:         12_000_000,
  temporal_scope: "projected",
  source_kind:   "xlsx",
  confidence:    "medium",
});

// Scenario workbook fact — same period as historical fact
const SCENARIO_REVENUE: FinancialFactV1 = makeFactV1({
  metric_key:    "revenue",
  period_label:  "2024",
  period_type:   "annual",
  value:         8_500_000,
  temporal_scope: "scenario",
  scenario:      "Upside",
  source_kind:   "xlsx",
  confidence:    "medium",
});

// Unique workbook ARR fact with no collision
const WORKBOOK_ARR: FinancialFactV1 = makeFactV1({
  metric_key:    "arr",
  period_label:  "2024",
  period_type:   "annual",
  value:         3_600_000,
  temporal_scope: "historical",
  source_kind:   "xlsx",
  confidence:    "high",
});

// ─── 1. workbookFacts appear in registry output ───────────────────────────────

describe("buildFinancialFactRegistryV1 — workbookFacts merging", () => {
  it("workbook facts appear in empty registry", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [WORKBOOK_ARR],
    });
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(3_600_000);
  });

  it("multiple workbook facts all appear when no collision", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [PROJECTED_REVENUE_FUTURE, WORKBOOK_ARR],
    });
    expect(facts.find((f) => f.metric_key === "revenue")).toBeDefined();
    expect(facts.find((f) => f.metric_key === "arr")).toBeDefined();
  });

  it("workbook facts carry source_kind='xlsx'", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [WORKBOOK_ARR],
    });
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr!.source_kind).toBe("xlsx");
  });

  it("workbook fact temporal_scope is preserved in registry output", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [PROJECTED_REVENUE_FUTURE],
    });
    const f = facts.find((f) => f.metric_key === "revenue" && f.period_label === "2028");
    expect(f!.temporal_scope).toBe("projected");
  });

  it("workbook fact scenario field is preserved in registry output", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [SCENARIO_REVENUE],
    });
    // SCENARIO_REVENUE period_label="2024" — no historical entry in registry
    const f = facts.find((f) => f.metric_key === "revenue" && f.scenario === "Upside");
    expect(f).toBeDefined();
    expect(f!.scenario).toBe("Upside");
    expect(f!.temporal_scope).toBe("scenario");
  });
});

// ─── 2 & 4. Projection safety — projected/scenario blocked by historical ──────

describe("buildFinancialFactRegistryV1 — projection safety", () => {
  // We feed a historical fact via orchestratorBenchmarks isn't sufficient —
  // historical facts enter via the structured parser series.  We use a
  // financialStatement with period_label="2024" to seed the registry BEFORE
  // workbookFacts are merged (step 7 runs after steps 1-6).
  //
  // Rather than constructing a full FinancialStatementV1, we verify the guard
  // in step 7 directly by calling buildFinancialFactRegistryV1 with ONLY
  // workbookFacts and relying on the fact_id dedup map: provide two workbook
  // facts with the same fact_id — one historical, one projected — and ensure
  // the historical one wins.

  it("projected workbook fact does NOT displace historical workbook fact for same metric+period", () => {
    // HISTORICAL_REVENUE has temporal_scope="historical"
    // PROJECTED_REVENUE_SAME_PERIOD has temporal_scope="projected", same period
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [HISTORICAL_REVENUE, PROJECTED_REVENUE_SAME_PERIOD],
    });
    const rev2024 = facts.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    // Only one fact should survive (historical wins)
    expect(rev2024.length).toBe(1);
    expect(rev2024[0]!.temporal_scope).toBe("historical");
    expect(rev2024[0]!.value).toBe(7_200_000);
  });

  it("order-independent: projected first, historical second → historical wins", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [PROJECTED_REVENUE_SAME_PERIOD, HISTORICAL_REVENUE],
    });
    const rev2024 = facts.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev2024.length).toBe(1);
    expect(rev2024[0]!.temporal_scope).toBe("historical");
  });

  it("projected workbook fact IS included when no realized fact exists for that period", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [PROJECTED_REVENUE_FUTURE],
    });
    const f = facts.find((f) => f.metric_key === "revenue" && f.period_label === "2028");
    expect(f).toBeDefined();
    expect(f!.temporal_scope).toBe("projected");
  });

  it("scenario workbook fact for same period as historical is blocked", () => {
    // Historical 2024 revenue + scenario 2024 revenue → historical wins
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [HISTORICAL_REVENUE, SCENARIO_REVENUE],
    });
    const rev2024 = facts.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev2024.length).toBe(1);
    expect(rev2024[0]!.temporal_scope).toBe("historical");
  });
});

// ─── 5 & 6. Defensive: empty & undefined workbookFacts ───────────────────────

describe("buildFinancialFactRegistryV1 — defensive workbookFacts", () => {
  it("empty workbookFacts array does not crash", () => {
    expect(() =>
      buildFinancialFactRegistryV1({ dealId: DEAL_ID, workbookFacts: [] })
    ).not.toThrow();
  });

  it("undefined workbookFacts does not crash", () => {
    expect(() =>
      buildFinancialFactRegistryV1({ dealId: DEAL_ID, workbookFacts: undefined })
    ).not.toThrow();
  });

  it("omitted workbookFacts does not crash", () => {
    expect(() =>
      buildFinancialFactRegistryV1({ dealId: DEAL_ID })
    ).not.toThrow();
  });
});

// ─── 7 & 8. mergeFactsByConfidence projection safety ──────────────────────────

describe("mergeFactsByConfidence — projection safety", () => {
  /** Build a duplicate with different fact_id but same metric+period for merge test. */
  function dup(base: FinancialFactV1, overrides: Partial<FinancialFactV1>): FinancialFactV1 {
    return { ...base, fact_id: `dup-${Math.random().toString(36).slice(2)}`, ...overrides };
  }

  it("realized incoming replaces projected existing (same metric+period)", () => {
    const projected = dup(HISTORICAL_REVENUE, {
      fact_id: "proj-existing",
      value: 9_000_000,
      temporal_scope: "projected",
      source_kind: "xlsx",
    });
    const realized = dup(HISTORICAL_REVENUE, {
      fact_id: "real-incoming",
      value: 7_200_000,
      temporal_scope: "historical",
      source_kind: "xlsx",
    });

    // Feed projected first, then realized
    const { merged, droppedCount } = mergeFactsByConfidence([projected, realized]);

    const rev = merged.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev.length).toBe(1);
    expect(rev[0]!.temporal_scope).toBe("historical");
    expect(rev[0]!.value).toBe(7_200_000);
    expect(droppedCount).toBeGreaterThan(0);
  });

  it("existing realized blocks incoming projected (same metric+period)", () => {
    const realized = dup(HISTORICAL_REVENUE, {
      fact_id: "real-existing",
      value: 7_200_000,
      temporal_scope: "historical",
      source_kind: "xlsx",
    });
    const projected = dup(HISTORICAL_REVENUE, {
      fact_id: "proj-incoming",
      value: 9_000_000,
      temporal_scope: "projected",
      source_kind: "xlsx",
    });

    // Feed realized first, then projected
    const { merged, droppedCount } = mergeFactsByConfidence([realized, projected]);

    const rev = merged.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev.length).toBe(1);
    expect(rev[0]!.temporal_scope).toBe("historical");
    expect(rev[0]!.value).toBe(7_200_000);
    expect(droppedCount).toBeGreaterThan(0);
  });

  it("existing realized blocks incoming scenario (same metric+period)", () => {
    const realized = dup(HISTORICAL_REVENUE, {
      fact_id: "real-base",
      temporal_scope: "historical",
      source_kind: "pdf_table",
    });
    const scenario = dup(HISTORICAL_REVENUE, {
      fact_id: "scenario-upside",
      value: 9_500_000,
      temporal_scope: "scenario",
      scenario: "Upside",
    });

    const { merged } = mergeFactsByConfidence([realized, scenario]);

    const rev = merged.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev.length).toBe(1);
    expect(rev[0]!.temporal_scope).toBe("historical");
  });

  it("two realized facts: higher source_kind rank wins", () => {
    const pdfFact = dup(HISTORICAL_REVENUE, {
      fact_id: "pdf-fact",
      value: 7_000_000,
      temporal_scope: "historical",
      source_kind: "pdf_table",          // rank 4 — highest
    });
    const xlsxFact = dup(HISTORICAL_REVENUE, {
      fact_id: "xlsx-fact",
      value: 7_500_000,
      temporal_scope: "historical",
      source_kind: "xlsx",               // rank 3
    });

    // xlsx first, then pdf
    const { merged } = mergeFactsByConfidence([xlsxFact, pdfFact]);
    const rev = merged.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev.length).toBe(1);
    expect(rev[0]!.source_kind).toBe("pdf_table");
    expect(rev[0]!.value).toBe(7_000_000);
  });

  it("two projected facts: normal source_kind rank applies", () => {
    const xlsxProjected = dup(PROJECTED_REVENUE_SAME_PERIOD, {
      fact_id:      "xlsx-proj",
      temporal_scope: "projected",
      source_kind:  "xlsx",        // rank 3
      value:        9_000_000,
    });
    const deckProjected = dup(PROJECTED_REVENUE_SAME_PERIOD, {
      fact_id:      "deck-proj",
      temporal_scope: "projected",
      source_kind:  "deck",        // rank 1
      value:        8_000_000,
    });

    // xlsx first, then deck
    const { merged } = mergeFactsByConfidence([xlsxProjected, deckProjected]);
    const rev = merged.filter((f) => f.metric_key === "revenue" && f.period_label === "2024");
    // xlsx rank > deck rank, xlsx wins
    expect(rev.length).toBe(1);
    expect(rev[0]!.source_kind).toBe("xlsx");
  });
});

// ─── 10. scenario + temporal_scope survive through full registry pipeline ──────

describe("Registry end-to-end — scenario and temporal_scope preservation", () => {
  it("scenario ARR fact retains scenario and temporal_scope in registry output", () => {
    const scenarioArr = makeFactV1({
      metric_key:    "arr",
      period_label:  "Upside",
      period_type:   "unknown",
      value:         5_000_000,
      temporal_scope: "scenario",
      scenario:      "Upside",
      source_kind:   "xlsx",
      confidence:    "medium",
    });

    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [scenarioArr],
    });

    const f = facts.find((f) => f.metric_key === "arr");
    expect(f).toBeDefined();
    expect(f!.temporal_scope).toBe("scenario");
    expect(f!.scenario).toBe("Upside");
  });

  it("historical ARR fact retains temporal_scope='historical' in registry output", () => {
    const historicalArr = makeFactV1({
      metric_key:    "arr",
      period_label:  "2024",
      period_type:   "annual",
      value:         4_200_000,
      temporal_scope: "historical",
      source_kind:   "xlsx",
      confidence:    "high",
    });

    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      workbookFacts: [historicalArr],
    });

    const f = facts.find((f) => f.metric_key === "arr");
    expect(f!.temporal_scope).toBe("historical");
  });
});
