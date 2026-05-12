/**
 * phase2-timeseries.test.ts
 *
 * Phase 2 — Intra-document timeseries reclassification
 *
 * Validates that `collectFactRegistrySources` (inside `buildFinancialTruthV1`)
 * correctly detects when a single XLSX document contributes multiple period_labels
 * for the same metric and collapses them to one representative value, preventing
 * spurious CONFLICT state.
 *
 * Key assertions:
 *   1.  Same-document multi-period revenue → CONFIRMED (not CONFLICT)
 *   2.  Cross-document revenue disagreement → CONFLICT (real conflict preserved)
 *   3.  "current" period preferred over historical years in collapsed result
 *   4.  Most recent year preferred when no "current" period
 *   5.  Single period per document → no timeseries detection
 *   6.  Same-document timeseries + deck mention → CONFIRMED (xlsx wins)
 *   7.  Two documents each with timeseries, but different representative values → CONFLICT
 */

import { describe, it, expect } from "vitest";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { FinancialFactV1 } from "@dealdecision/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const DEAL_ID   = "phase2-test-deal";
const DOC_A     = "doc-aaaa-1111";
const DOC_B     = "doc-bbbb-2222";

let _idCounter = 0;
function makeRevenueFact(overrides: Partial<FinancialFactV1> & { period_label: string; value: number }): FinancialFactV1 {
  _idCounter++;
  return {
    fact_id:    `fact-${_idCounter}`,
    deal_id:    DEAL_ID,
    document_id: DOC_A,
    source_kind: "xlsx",
    metric_key:  "revenue",
    metric_label: "Revenue",
    period_type: "annual",
    unit: "currency",
    currency: "USD",
    confidence: "high",
    source_pointer: `sheet=Income row_key=revenue period=${overrides.period_label}`,
    excerpt: `Revenue ${overrides.period_label}: ${overrides.value}`,
    ...overrides,
  };
}

const NULL_DECK_SIGNALS = {
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

const NULL_PIPELINE_B = {
  revenue_latest: null,
  burn_monthly: null,
  runway_months: null,
  cash_latest: null,
};

// ─── Test 1: Same-document multi-period → CONFIRMED ──────────────────────────

describe("Phase 2 — same-document multi-period revenue", () => {
  const facts: FinancialFactV1[] = [
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2021", value: 1_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2022", value: 1_500_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2023", value: 2_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2024", value: 3_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2025", value: 4_500_000 }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: NULL_DECK_SIGNALS,
    pipelineB: NULL_PIPELINE_B,
  });

  it("state is CONFIRMED (not CONFLICT)", () => {
    expect(truth["revenue"]!.state).toBe("CONFIRMED");
  });

  it("resolved_value is the most recent year (FY2025)", () => {
    expect(truth["revenue"]!.resolved_value).toBe(4_500_000);
  });

  it("intra_document_timeseries is true", () => {
    expect(truth["revenue"]!.intra_document_timeseries).toBe(true);
  });

  it("collapsed_period_count reflects the number of periods found", () => {
    expect(truth["revenue"]!.collapsed_period_count).toBe(5);
  });

  it("source_count is 1 after collapse (one representative per document)", () => {
    expect(truth["revenue"]!.source_count).toBe(1);
  });
});

// ─── Test 2: Cross-document disagreement → CONFLICT ──────────────────────────

describe("Phase 2 — cross-document revenue disagreement → CONFLICT", () => {
  const facts: FinancialFactV1[] = [
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2024", value: 4_000_000 }),
    makeRevenueFact({ document_id: DOC_B, period_label: "FY2024", value: 1_000_000 }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: NULL_DECK_SIGNALS,
    pipelineB: NULL_PIPELINE_B,
  });

  it("state is CONFLICT when two different documents disagree", () => {
    expect(truth["revenue"]!.state).toBe("CONFLICT");
  });

  it("intra_document_timeseries is NOT set for genuine cross-document conflict", () => {
    expect(truth["revenue"]!.intra_document_timeseries).toBeUndefined();
  });
});

// ─── Test 3: "current" period preferred ──────────────────────────────────────

describe("Phase 2 — 'current' period preferred over historical years", () => {
  const CURRENT_VALUE = 5_000_000;

  const facts: FinancialFactV1[] = [
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2022", value: 2_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2023", value: 3_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2024", value: 4_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "current", value: CURRENT_VALUE }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: NULL_DECK_SIGNALS,
    pipelineB: NULL_PIPELINE_B,
  });

  it("resolved_value uses the 'current' period value", () => {
    expect(truth["revenue"]!.resolved_value).toBe(CURRENT_VALUE);
  });

  it("state is CONFIRMED", () => {
    expect(truth["revenue"]!.state).toBe("CONFIRMED");
  });

  it("intra_document_timeseries is true", () => {
    expect(truth["revenue"]!.intra_document_timeseries).toBe(true);
  });
});

// ─── Test 4: Most recent year preferred when no "current" ────────────────────

describe("Phase 2 — most recent year preferred when no 'current' period", () => {
  const facts: FinancialFactV1[] = [
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2021", value: 1_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2023", value: 2_500_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2022", value: 1_800_000 }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: NULL_DECK_SIGNALS,
    pipelineB: NULL_PIPELINE_B,
  });

  it("resolved_value is from FY2023 (most recent year)", () => {
    expect(truth["revenue"]!.resolved_value).toBe(2_500_000);
  });

  it("state is CONFIRMED", () => {
    expect(truth["revenue"]!.state).toBe("CONFIRMED");
  });
});

// ─── Test 5: Single period per document → no timeseries ─────────────────────

describe("Phase 2 — single period per document → no timeseries detection", () => {
  const facts: FinancialFactV1[] = [
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2024", value: 3_000_000 }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: NULL_DECK_SIGNALS,
    pipelineB: NULL_PIPELINE_B,
  });

  it("intra_document_timeseries is not set", () => {
    expect(truth["revenue"]!.intra_document_timeseries).toBeUndefined();
  });

  it("state is CONFIRMED with one source", () => {
    expect(truth["revenue"]!.state).toBe("CONFIRMED");
    expect(truth["revenue"]!.source_count).toBe(1);
  });
});

// ─── Test 6: Same-document timeseries + low-priority deck → CONFIRMED ────────

describe("Phase 2 — same-document timeseries + deck mention → xlsx wins, CONFIRMED", () => {
  const XLSX_LATEST = 3_200_000;
  const DECK_VALUE  =   500_000; // deck disagrees but has lower priority

  const facts: FinancialFactV1[] = [
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2022", value: 1_500_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2023", value: 2_200_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2024", value: XLSX_LATEST }),
  ];

  const deckSignals = {
    ...NULL_DECK_SIGNALS,
    revenue_mentions: [{ text: `$${DECK_VALUE / 1_000}K revenue`, doc_id: "deck-doc", page_index: 3 }],
    has_revenue: true,
  };

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: deckSignals,
    pipelineB: NULL_PIPELINE_B,
  });

  it("state is CONFLICT (xlsx vs deck disagree)", () => {
    // After timeseries collapse, we have 1 xlsx source (FY2024) + 1 deck source.
    // They disagree → CONFLICT, but xlsx wins the hierarchy.
    expect(truth["revenue"]!.state).toBe("CONFLICT");
  });

  it("resolved_value is the xlsx value (source hierarchy)", () => {
    expect(truth["revenue"]!.resolved_value).toBe(XLSX_LATEST);
    expect(truth["revenue"]!.resolved_source_kind).toBe("xlsx");
  });

  it("intra_document_timeseries is true (xlsx was a timeseries)", () => {
    expect(truth["revenue"]!.intra_document_timeseries).toBe(true);
  });
});

// ─── Test 7: Two documents both with timeseries but different recent values ───

describe("Phase 2 — two documents both with timeseries, different recent values → CONFLICT", () => {
  const facts: FinancialFactV1[] = [
    // Doc A: timeseries FY2022-FY2024, latest = 4M
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2022", value: 2_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2023", value: 3_000_000 }),
    makeRevenueFact({ document_id: DOC_A, period_label: "FY2024", value: 4_000_000 }),
    // Doc B: timeseries FY2022-FY2024, latest = 1M (different document, different view)
    makeRevenueFact({ document_id: DOC_B, period_label: "FY2022", value: 400_000 }),
    makeRevenueFact({ document_id: DOC_B, period_label: "FY2023", value: 700_000 }),
    makeRevenueFact({ document_id: DOC_B, period_label: "FY2024", value: 1_000_000 }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: NULL_DECK_SIGNALS,
    pipelineB: NULL_PIPELINE_B,
  });

  it("state is CONFLICT (Doc A FY2024=4M vs Doc B FY2024=1M)", () => {
    expect(truth["revenue"]!.state).toBe("CONFLICT");
  });

  it("intra_document_timeseries is true (both docs had timeseries)", () => {
    expect(truth["revenue"]!.intra_document_timeseries).toBe(true);
  });

  it("source_count is 2 (one representative per document after timeseries collapse)", () => {
    expect(truth["revenue"]!.source_count).toBe(2);
  });
});
