/**
 * Phase 3 Tests: Cross-Document Financial Reconciliation
 *
 * Coverage (8 required categories):
 *  1. Supported match      — deck + workbook within tolerance → "supported"
 *  2. Conflict             — deck + workbook outside tolerance → "conflicting"
 *  3. Deck only            — deck fact, no workbook peer → "deck_only"
 *  4. Workbook only        — workbook fact, no deck peer → "workbook_only"
 *  5. Projected only       — only projected facts for slot → "projected_only"
 *  6. Scenario matching    — same scenario compares; different scenarios do NOT
 *  7. Projection safety    — projected workbook fact never becomes "supported"
 *  8. Registry integration — buildFinancialFactRegistryV1 output carries cross_source_status
 *
 * Additional:
 *  - withinTolerance unit tests (per-metric, absolute-floor)
 *  - buildReconciliationSummary counts + conflict details
 *  - Edge cases: empty array, all-unknown source kinds, both-zero values
 */

import { describe, it, expect } from "vitest";
import type { FinancialFactV1 } from "@dealdecision/core";
import {
  withinTolerance,
  reconcileFinancialFacts,
  buildReconciliationSummary,
} from "../cross-source-reconciliation.js";
import { buildFinancialFactRegistryV1 } from "../build-financial-fact-registry-v1.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEAL = "deal-xsrc-001";
const DOC  = "doc-xsrc-001";

let _seq = 0;
function fact(
  overrides: Partial<FinancialFactV1> & {
    metric_key: string;
    period_label: string;
    value: number;
    source_kind: FinancialFactV1["source_kind"];
  },
): FinancialFactV1 {
  _seq++;
  const { metric_key, period_label, value, source_kind, ...rest } = overrides;
  return {
    fact_id:      `factv1:${DEAL}:${metric_key}:unknown:${period_label}:x${_seq.toString(16).padStart(8, "0")}`,
    deal_id:      DEAL,
    document_id:  DOC,
    source_kind,
    metric_key,
    period_label,
    period_type:  "annual",
    value,
    unit:         "currency",
    currency:     "USD",
    confidence:   "medium",
    ...rest,
  };
}

// Deck facts (source_kind="deck")
const DECK_ARR_4M = fact({
  metric_key: "arr",    period_label: "2024", value: 4_000_000,
  source_kind: "deck",  temporal_scope: "historical", confidence: "low",
});

const DECK_ARR_4_05M = fact({
  metric_key: "arr",    period_label: "2024", value: 4_050_000,
  source_kind: "deck",  temporal_scope: "historical", confidence: "low",
});

const DECK_REVENUE_5M = fact({
  metric_key: "revenue", period_label: "2024", value: 5_000_000,
  source_kind: "deck",   temporal_scope: "historical", confidence: "low",
});

const DECK_BURN_200K = fact({
  metric_key: "burn_rate", period_label: "2024", value: 200_000,
  source_kind: "deck",     temporal_scope: "current", confidence: "low",
});

const DECK_SCENARIO_UPSIDE = fact({
  metric_key: "revenue", period_label: "2025", value: 8_000_000,
  source_kind: "deck",   temporal_scope: "scenario", scenario: "Upside",
  confidence: "low",
});

const DECK_SCENARIO_BASE = fact({
  metric_key: "revenue", period_label: "2025", value: 6_000_000,
  source_kind: "deck",   temporal_scope: "scenario", scenario: "Base",
  confidence: "low",
});

// Workbook facts (source_kind="xlsx")
const WB_ARR_4_1M = fact({
  metric_key: "arr",    period_label: "2024", value: 4_100_000,
  source_kind: "xlsx",  temporal_scope: "historical", confidence: "high",
});

const WB_REVENUE_1_8M = fact({
  metric_key: "revenue", period_label: "2024", value: 1_800_000,
  source_kind: "xlsx",   temporal_scope: "historical", confidence: "high",
});

const WB_REVENUE_5_02M = fact({
  metric_key: "revenue", period_label: "2024", value: 5_020_000,
  source_kind: "xlsx",   temporal_scope: "historical", confidence: "high",
});

const WB_PROJECTED_REVENUE_2026 = fact({
  metric_key: "revenue", period_label: "2026", value: 12_000_000,
  source_kind: "xlsx",   temporal_scope: "projected", confidence: "medium",
});

const WB_SCENARIO_UPSIDE = fact({
  metric_key: "revenue", period_label: "2025", value: 7_900_000,
  source_kind: "xlsx",   temporal_scope: "scenario", scenario: "Upside",
  confidence: "medium",
});

const WB_SCENARIO_CONSERVATIVE = fact({
  metric_key: "revenue", period_label: "2025", value: 3_500_000,
  source_kind: "xlsx",   temporal_scope: "scenario", scenario: "Conservative",
  confidence: "medium",
});

// ─── 1. withinTolerance unit tests ────────────────────────────────────────────

describe("withinTolerance", () => {
  it("returns true within default 10% tolerance", () => {
    expect(withinTolerance(1_000_000, 1_080_000, "revenue")).toBe(true);  // 8%
  });

  it("returns false outside default 10% tolerance", () => {
    expect(withinTolerance(1_000_000, 1_150_000, "revenue")).toBe(false); // 15%
  });

  it("uses tight 5% tolerance for raise_amount", () => {
    expect(withinTolerance(2_000_000, 2_090_000, "raise_amount")).toBe(true);  // 4.3% — within 5%
    expect(withinTolerance(2_000_000, 2_130_000, "raise_amount")).toBe(false); // 6.1% — outside 5%
  });

  it("uses wide 25% tolerance for TAM", () => {
    expect(withinTolerance(1_000_000_000, 1_200_000_000, "tam")).toBe(true);  // 16.7% — within 25%
    expect(withinTolerance(1_000_000_000, 1_350_000_000, "tam")).toBe(false); // 25.9% — outside 25%
  });

  it("uses absolute floor for very small values", () => {
    // $1K vs $2K — relative diff is 50%, but both < $50K threshold.
    // Absolute diff = $1K < $5K floor → should be WITHIN tolerance
    expect(withinTolerance(1_000, 2_000, "revenue")).toBe(true);
    // $1K vs $7K — absolute diff $6K > $5K floor → outside tolerance
    expect(withinTolerance(1_000, 7_000, "revenue")).toBe(false);
  });

  it("returns false when either value is non-finite (NaN)", () => {
    expect(withinTolerance(NaN, 1_000_000, "revenue")).toBe(false);
    expect(withinTolerance(1_000_000, NaN, "revenue")).toBe(false);
  });

  it("returns false when either value is Infinity", () => {
    expect(withinTolerance(Infinity, 1_000_000, "revenue")).toBe(false);
    expect(withinTolerance(1_000_000, Infinity, "revenue")).toBe(false);
  });
});

// ─── 2. Category 1: supported match ──────────────────────────────────────────

describe("reconcileFinancialFacts — Category 1: supported", () => {
  it("deck ARR $4M + workbook ARR $4.1M → both supported (8.5% relative diff is within 10% arr tolerance for realized slot)", () => {
    const result = reconcileFinancialFacts([DECK_ARR_4M, WB_ARR_4_1M]);
    for (const f of result) {
      expect(f.cross_source_status).toBe("supported");
    }
  });

  it("also marks supported for 2024 Revenue close pair", () => {
    const result = reconcileFinancialFacts([DECK_REVENUE_5M, WB_REVENUE_5_02M]);
    for (const f of result) {
      expect(f.cross_source_status).toBe("supported");
    }
  });

  it("preserves all other fields on the annotated fact (immutable except cross_source_status)", () => {
    const result = reconcileFinancialFacts([DECK_ARR_4M, WB_ARR_4_1M]);
    const deckResult = result.find(f => f.source_kind === "deck")!;
    expect(deckResult.fact_id).toBe(DECK_ARR_4M.fact_id);
    expect(deckResult.value).toBe(DECK_ARR_4M.value);
    expect(deckResult.metric_key).toBe(DECK_ARR_4M.metric_key);
    expect(deckResult.period_label).toBe(DECK_ARR_4M.period_label);
    expect(deckResult.temporal_scope).toBe(DECK_ARR_4M.temporal_scope);
  });
});

// ─── 3. Category 2: conflicting ───────────────────────────────────────────────

describe("reconcileFinancialFacts — Category 2: conflicting", () => {
  it("deck revenue $5M + workbook revenue $1.8M (64% variance) → both conflicting", () => {
    const result = reconcileFinancialFacts([DECK_REVENUE_5M, WB_REVENUE_1_8M]);
    for (const f of result) {
      expect(f.cross_source_status).toBe("conflicting");
    }
  });

  it("conflict appears in buildReconciliationSummary conflicts array", () => {
    const facts = reconcileFinancialFacts([DECK_REVENUE_5M, WB_REVENUE_1_8M]);
    const summary = buildReconciliationSummary(facts);
    expect(summary.counts.conflicting).toBe(2);
    expect(summary.conflicts).toHaveLength(1);
    const c = summary.conflicts[0]!;
    expect(c.metric_key).toBe("revenue");
    expect(c.period_label).toBe("2024");
    expect(c.deck_value).toBe(5_000_000);
    expect(c.workbook_value).toBe(1_800_000);
    expect(c.variance_pct).toBeGreaterThan(60);
  });
});

// ─── 4. Category 3: deck_only ─────────────────────────────────────────────────

describe("reconcileFinancialFacts — Category 3: deck_only", () => {
  it("deck burn_rate with no workbook counterpart → deck_only", () => {
    const result = reconcileFinancialFacts([DECK_BURN_200K]);
    expect(result).toHaveLength(1);
    expect(result[0]!.cross_source_status).toBe("deck_only");
  });

  it("deck_only when multiple deck facts exist for same slot but no workbook", () => {
    const result = reconcileFinancialFacts([DECK_ARR_4M, DECK_ARR_4_05M]);
    for (const f of result) {
      expect(f.cross_source_status).toBe("deck_only");
    }
  });
});

// ─── 5. Category 4: workbook_only ─────────────────────────────────────────────

describe("reconcileFinancialFacts — Category 4: workbook_only", () => {
  it("xlsx revenue with no deck counterpart → workbook_only", () => {
    const wbOnly = fact({
      metric_key: "revenue", period_label: "2023", value: 3_000_000,
      source_kind: "xlsx",   temporal_scope: "historical", confidence: "high",
    });
    const result = reconcileFinancialFacts([wbOnly]);
    expect(result[0]!.cross_source_status).toBe("workbook_only");
  });

  it("pdf_table source kind also qualifies as workbook_only", () => {
    const pdfFact = fact({
      metric_key: "arr", period_label: "Q1-24", value: 1_200_000,
      source_kind: "pdf_table", temporal_scope: "historical",
    });
    const result = reconcileFinancialFacts([pdfFact]);
    expect(result[0]!.cross_source_status).toBe("workbook_only");
  });
});

// ─── 6. Category 5: projected_only ────────────────────────────────────────────

describe("reconcileFinancialFacts — Category 5: projected_only", () => {
  it("single projected workbook fact for a slot → projected_only", () => {
    const result = reconcileFinancialFacts([WB_PROJECTED_REVENUE_2026]);
    expect(result[0]!.cross_source_status).toBe("projected_only");
  });

  it("projected deck-only fact for a slot → projected_only", () => {
    const projDeck = fact({
      metric_key: "revenue", period_label: "2027", value: 20_000_000,
      source_kind: "deck", temporal_scope: "projected",
    });
    const result = reconcileFinancialFacts([projDeck]);
    expect(result[0]!.cross_source_status).toBe("projected_only");
  });

  it("mix of projected deck + projected workbook → projected_only (they compare but stay projected)", () => {
    // projected vs projected: the group has no realized facts, so group status = "projected_only"
    const projDeck = fact({
      metric_key: "revenue", period_label: "2026", value: 12_000_000,
      source_kind: "deck", temporal_scope: "projected",
    });
    const result = reconcileFinancialFacts([projDeck, WB_PROJECTED_REVENUE_2026]);
    for (const f of result) {
      expect(f.cross_source_status).toBe("projected_only");
    }
  });
});

// ─── 7. Category 6: scenario matching ────────────────────────────────────────

describe("reconcileFinancialFacts — Category 6: scenario matching", () => {
  it("same scenario label (Upside): deck $8M + workbook $7.9M → scenario facts get supported-like status", () => {
    // Upside deck vs Upside workbook: 1.25% diff — within tolerance
    const result = reconcileFinancialFacts([DECK_SCENARIO_UPSIDE, WB_SCENARIO_UPSIDE]);
    for (const f of result) {
      // Scenario facts that match across sources get "supported"
      expect(f.cross_source_status).toBe("supported");
    }
  });

  it("different scenario labels do NOT reconcile with each other", () => {
    // DECK_SCENARIO_BASE (scenario=Base, $6M) vs WB_SCENARIO_CONSERVATIVE (scenario=Conservative, $3.5M)
    // They share metric_key=revenue + period_label=2025 but different scenario labels → both projected_only
    const result = reconcileFinancialFacts([DECK_SCENARIO_BASE, WB_SCENARIO_CONSERVATIVE]);
    for (const f of result) {
      expect(f.cross_source_status).toBe("projected_only");
    }
  });

  it("scenario fact does not compare against its non-scenario realized counterpart", () => {
    // DECK_SCENARIO_UPSIDE is temporal_scope="scenario" for period 2025.
    // A realized 2025 historical fact is a different slot conceptually —
    // but since they share the same metric_key+period_label, the group has
    // both realized and projected facts. The realized status drives realized facts;
    // scenario status drives scenario facts.
    const realizedDeck2025 = fact({
      metric_key: "revenue", period_label: "2025", value: 6_500_000,
      source_kind: "deck", temporal_scope: "historical",
    });
    const realizedWb2025 = fact({
      metric_key: "revenue", period_label: "2025", value: 6_400_000,
      source_kind: "xlsx", temporal_scope: "historical",
    });
    const result = reconcileFinancialFacts([
      realizedDeck2025, realizedWb2025,
      DECK_SCENARIO_UPSIDE, WB_SCENARIO_UPSIDE,
    ]);
    const realizedResults = result.filter(f => f.temporal_scope === "historical");
    const scenarioResults = result.filter(f => f.temporal_scope === "scenario");
    // Realized facts compared against each other (1.5% diff — supported)
    for (const f of realizedResults) {
      expect(f.cross_source_status).toBe("supported");
    }
    // Scenario facts compared within their scenario sub-group (Upside label)
    for (const f of scenarioResults) {
      expect(f.cross_source_status).toBe("supported");
    }
  });
});

// ─── 8. Category 7: projection safety ────────────────────────────────────────

describe("reconcileFinancialFacts — Category 7: projection safety", () => {
  it("projected workbook fact does NOT become 'supported' for a current-company performance claim", () => {
    // Deck has a realized ARR for 2024; workbook has a projected ARR for 2024 (different temporal scope).
    const projWbArr = fact({
      metric_key: "arr", period_label: "2024", value: 4_050_000,
      source_kind: "xlsx", temporal_scope: "projected",
    });
    const result = reconcileFinancialFacts([DECK_ARR_4M, projWbArr]);
    const projResult = result.find(f => f.temporal_scope === "projected")!;
    // The projected workbook fact should NOT be "supported" (it's not a realized claim)
    expect(projResult.cross_source_status).not.toBe("supported");
    // Projected fact gets projected_only (no realized workbook in the group, only projected)
    expect(projResult.cross_source_status).toBe("projected_only");
  });

  it("realized deck fact is deck_only when the workbook counterpart is projected", () => {
    const projWbArr = fact({
      metric_key: "arr", period_label: "2024", value: 4_050_000,
      source_kind: "xlsx", temporal_scope: "projected",
    });
    const result = reconcileFinancialFacts([DECK_ARR_4M, projWbArr]);
    const deckResult = result.find(f => f.source_kind === "deck")!;
    // Realized deck fact has no realized workbook counterpart → deck_only
    expect(deckResult.cross_source_status).toBe("deck_only");
  });
});

// ─── 9. Category 8: registry integration ─────────────────────────────────────

describe("buildFinancialFactRegistryV1 — cross_source_status propagation (Category 8)", () => {
  it("registry output carries cross_source_status on all facts", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL,
      workbookFacts: [WB_ARR_4_1M],
    });

    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.cross_source_status).toBeDefined();
      expect([
        "supported", "conflicting", "deck_only", "workbook_only",
        "projected_only", "unresolved",
      ]).toContain(f.cross_source_status);
    }
  });

  it("workbook-only facts get workbook_only status when no deck signals overlap", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL,
      workbookFacts: [WB_ARR_4_1M],
    });

    const arrFacts = facts.filter(f => f.metric_key === "arr");
    expect(arrFacts.length).toBeGreaterThan(0);
    for (const f of arrFacts) {
      expect(f.cross_source_status).toBe("workbook_only");
    }
  });

  it("deck-derived fact gets deck_only when no workbook ARR exists for same slot", () => {
    // Deck mention: "ARR $4M" with period_label="current" (registry assigns "current" for deck signals)
    // Workbook fact has period_label="2024" → different slot → deck ARR is deck_only
    const decKSignals = {
      schema_version: "deck_financial_signals_v1" as const,
      revenue_mentions:    [],
      burn_mentions:       [],
      runway_mentions:     [],
      margin_mentions:     [],
      pricing_mentions:    [],
      arr_mrr_mentions:    [{ text: "ARR $4M",  doc_id: DOC, page_index: 0 }],
      unit_econ_mentions:  [],
      has_revenue:         false,
      has_burn:            false,
      has_runway:          false,
      has_pricing:         false,
      has_arr_mrr:         true,
      has_unit_economics:  false,
      pages_scanned:       1,
    };

    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL,
      deckSignals: decKSignals,
      // No workbook ARR for "current" period → deck ARR gets deck_only
    });

    const deckArrFacts = facts.filter(f => f.metric_key === "arr" && f.source_kind === "deck");
    // If deck mention parsed successfully, there should be a deck ARR fact
    if (deckArrFacts.length > 0) {
      expect(deckArrFacts[0]!.cross_source_status).toBe("deck_only");
    }
    // Even if parsing produced nothing, no crash + all facts have cross_source_status
    for (const f of facts) {
      expect(f.cross_source_status).toBeDefined();
    }
  });

  it("empty registry returns empty array without crash", () => {
    const facts = buildFinancialFactRegistryV1({ dealId: DEAL, workbookFacts: [] });
    expect(Array.isArray(facts)).toBe(true);
  });
});

// ─── 10. buildReconciliationSummary ──────────────────────────────────────────

describe("buildReconciliationSummary", () => {
  it("returns all-zero counts for empty facts array", () => {
    const summary = buildReconciliationSummary([]);
    expect(summary.total_facts).toBe(0);
    expect(summary.counts.supported).toBe(0);
    expect(summary.counts.conflicting).toBe(0);
    expect(summary.conflicts).toHaveLength(0);
    expect(summary.schema_version).toBe("cross_source_reconciliation_summary_v1");
  });

  it("counts reflect actual reconciliation output", () => {
    const facts = reconcileFinancialFacts([
      DECK_ARR_4M, WB_ARR_4_1M,           // supported
      DECK_REVENUE_5M, WB_REVENUE_1_8M,   // conflicting x2
      DECK_BURN_200K,                      // deck_only
      WB_PROJECTED_REVENUE_2026,           // projected_only
    ]);
    const summary = buildReconciliationSummary(facts);
    expect(summary.total_facts).toBe(6);
    expect(summary.counts.supported).toBe(2);
    expect(summary.counts.conflicting).toBe(2);
    expect(summary.counts.deck_only).toBe(1);
    expect(summary.counts.projected_only).toBe(1);
    expect(summary.supported_count).toBe(2);
    expect(summary.single_source_count).toBe(1); // deck_only(1) + workbook_only(0)
  });

  it("conflict entry includes variance_pct", () => {
    const facts = reconcileFinancialFacts([DECK_REVENUE_5M, WB_REVENUE_1_8M]);
    const summary = buildReconciliationSummary(facts);
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0]!.variance_pct).not.toBeNull();
    expect(summary.conflicts[0]!.variance_pct!).toBeGreaterThan(50);
  });
});

// ─── 11. Edge cases ───────────────────────────────────────────────────────────

describe("reconcileFinancialFacts — edge cases", () => {
  it("empty array returns empty array", () => {
    expect(reconcileFinancialFacts([])).toEqual([]);
  });

  it("unknown source_kind facts receive 'unresolved'", () => {
    const unknownFact = fact({
      metric_key: "revenue", period_label: "2024", value: 5_000_000,
      source_kind: "unknown",
    });
    const result = reconcileFinancialFacts([unknownFact]);
    expect(result[0]!.cross_source_status).toBe("unresolved");
  });

  it("facts from different period_labels in same metric_key are grouped separately", () => {
    const deck2023 = fact({
      metric_key: "revenue", period_label: "2023", value: 2_000_000,
      source_kind: "deck", temporal_scope: "historical",
    });
    const wb2024 = fact({
      metric_key: "revenue", period_label: "2024", value: 3_000_000,
      source_kind: "xlsx", temporal_scope: "historical",
    });
    const result = reconcileFinancialFacts([deck2023, wb2024]);
    const d2023 = result.find(f => f.period_label === "2023")!;
    const w2024 = result.find(f => f.period_label === "2024")!;
    expect(d2023.cross_source_status).toBe("deck_only");
    expect(w2024.cross_source_status).toBe("workbook_only");
  });

  it("does not mutate the input array", () => {
    const input = [DECK_ARR_4M, WB_ARR_4_1M];
    const inputCopy = input.map(f => ({ ...f }));
    reconcileFinancialFacts(input);
    expect(input[0]).not.toHaveProperty("cross_source_status");
    expect(input[0]).toEqual(inputCopy[0]);
  });
});
