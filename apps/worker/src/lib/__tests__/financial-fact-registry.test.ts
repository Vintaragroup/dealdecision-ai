/**
 * financial-fact-registry.test.ts
 *
 * Tests for the public financial-fact-registry entry point.
 *
 * All imports go through lib/financial-fact-registry to validate the
 * public API surface, not the internal subfolder files.
 *
 * Coverage:
 *  1.  SOURCE_KIND_RANK ordering: pdf_table > xlsx > pdf_kpi_line > deck > unknown
 *  2.  rankFinancialFacts: sorts descending by source_kind rank
 *  3.  rankFinancialFacts: does not mutate the input array
 *  4.  rankFinancialFacts: empty input → empty output
 *  5.  mergeFinancialFacts: pdf_table (rank 4) beats xlsx (rank 3) — same metric+period
 *  6.  mergeFinancialFacts: xlsx (rank 3) beats pdf_kpi_line (rank 2) — same metric+period
 *  7.  mergeFinancialFacts: pdf_kpi_line (rank 2) beats deck (rank 1) — same metric+period
 *  8.  mergeFinancialFacts: different metric_key+period_label → both facts kept
 *  9.  mergeFinancialFacts: same key, same rank → first fact wins
 * 10.  mergeFinancialFacts: empty input → empty output
 * 11.  extractFinancialTableClaims + source_kind_override='xlsx' → all facts get source_kind='xlsx'
 * 12.  extractFinancialTableClaims default → all facts get source_kind='pdf_table'
 */

import { describe, it, expect } from "vitest";
import type { FinancialFactV1 } from "@dealdecision/core";
import {
  SOURCE_KIND_RANK,
  TEMPORAL_SCOPE_RANK,
  rankFinancialFacts,
  mergeFinancialFacts,
  extractFinancialTableClaims,
  detectFinancialTableCandidate,
} from "../financial-fact-registry";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFact(
  overrides: Partial<FinancialFactV1> & {
    source_kind: FinancialFactV1["source_kind"];
    metric_key?: string;
    period_label?: string;
  },
): FinancialFactV1 {
  return {
    fact_id: `fact-${Math.random().toString(36).slice(2)}`,
    deal_id: "deal-test",
    document_id: "doc-test",
    metric_key: "revenue",
    metric_label: "Revenue",
    period_type: "annual",
    period_label: "FY2024",
    value: 1_000_000,
    unit: "currency",
    currency: "USD",
    confidence: "medium",
    ...overrides,
  } as FinancialFactV1;
}

const FINANCIAL_TABLE_TEXT = `
Revenue    | $1,200,000 | $2,400,000
Burn Rate  | $80,000    | $100,000
ARR        | $1,200,000 | $2,400,000
`.trim();

const BASE_EXTRACT_OPTS = {
  deal_id: "deal-registry-test",
  document_id: "doc-registry-001",
  page_number: 0,
};

// ─── 1. SOURCE_KIND_RANK ordering ────────────────────────────────────────────

describe("SOURCE_KIND_RANK", () => {
  it("has correct relative ordering: pdf_table > xlsx > pdf_kpi_line > deck > unknown", () => {
    expect(SOURCE_KIND_RANK["pdf_table"]).toBeGreaterThan(SOURCE_KIND_RANK["xlsx"]);
    expect(SOURCE_KIND_RANK["xlsx"]).toBeGreaterThan(SOURCE_KIND_RANK["pdf_kpi_line"]);
    expect(SOURCE_KIND_RANK["pdf_kpi_line"]).toBeGreaterThan(SOURCE_KIND_RANK["deck"]);
    expect(SOURCE_KIND_RANK["deck"]).toBeGreaterThan(SOURCE_KIND_RANK["unknown"]);
  });

  it("has exact values matching the spec (pdf_table=4, xlsx=3, pdf_kpi_line=2, deck=1, unknown=0)", () => {
    expect(SOURCE_KIND_RANK["pdf_table"]).toBe(4);
    expect(SOURCE_KIND_RANK["xlsx"]).toBe(3);
    expect(SOURCE_KIND_RANK["pdf_kpi_line"]).toBe(2);
    expect(SOURCE_KIND_RANK["deck"]).toBe(1);
    expect(SOURCE_KIND_RANK["unknown"]).toBe(0);
  });
});

// ─── 2-4. rankFinancialFacts ──────────────────────────────────────────────────

describe("rankFinancialFacts", () => {
  it("sorts facts descending by source_kind rank (highest confidence first)", () => {
    const deck = makeFact({ source_kind: "deck", metric_key: "revenue" });
    const xlsx = makeFact({ source_kind: "xlsx", metric_key: "revenue" });
    const pdf = makeFact({ source_kind: "pdf_table", metric_key: "revenue" });
    const kpi = makeFact({ source_kind: "pdf_kpi_line", metric_key: "revenue" });

    const input = [deck, kpi, xlsx, pdf];
    const ranked = rankFinancialFacts(input);

    expect(ranked[0].source_kind).toBe("pdf_table");
    expect(ranked[1].source_kind).toBe("xlsx");
    expect(ranked[2].source_kind).toBe("pdf_kpi_line");
    expect(ranked[3].source_kind).toBe("deck");
  });

  it("does not mutate the input array", () => {
    const deck = makeFact({ source_kind: "deck" });
    const pdf = makeFact({ source_kind: "pdf_table" });
    const input = [deck, pdf];

    rankFinancialFacts(input);

    // Original order must be unchanged
    expect(input[0].source_kind).toBe("deck");
    expect(input[1].source_kind).toBe("pdf_table");
  });

  it("returns empty array for empty input", () => {
    expect(rankFinancialFacts([])).toEqual([]);
  });
});

// ─── 5-10. mergeFinancialFacts ────────────────────────────────────────────────

describe("mergeFinancialFacts", () => {
  it("pdf_table (rank 4) wins over xlsx (rank 3) on same metric+period", () => {
    const xlsx = makeFact({ source_kind: "xlsx", metric_key: "revenue", period_label: "FY2024", value: 1_000_000 });
    const pdf = makeFact({ source_kind: "pdf_table", metric_key: "revenue", period_label: "FY2024", value: 1_200_000 });

    const { merged } = mergeFinancialFacts([xlsx, pdf]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source_kind).toBe("pdf_table");
    expect(merged[0].value).toBe(1_200_000);
  });

  it("xlsx (rank 3) wins over pdf_kpi_line (rank 2) on same metric+period", () => {
    const kpi = makeFact({ source_kind: "pdf_kpi_line", metric_key: "arr", period_label: "current", value: 500_000 });
    const xlsx = makeFact({ source_kind: "xlsx", metric_key: "arr", period_label: "current", value: 620_000 });

    const { merged } = mergeFinancialFacts([kpi, xlsx]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source_kind).toBe("xlsx");
    expect(merged[0].value).toBe(620_000);
  });

  it("pdf_kpi_line (rank 2) wins over deck (rank 1) on same metric+period", () => {
    const deck = makeFact({ source_kind: "deck", metric_key: "burn_rate", period_label: "current", value: 90_000 });
    const kpi = makeFact({ source_kind: "pdf_kpi_line", metric_key: "burn_rate", period_label: "current", value: 85_000 });

    const { merged } = mergeFinancialFacts([deck, kpi]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source_kind).toBe("pdf_kpi_line");
  });

  it("keeps both facts when metric_key differs, even at same source_kind", () => {
    const revenue = makeFact({ source_kind: "pdf_table", metric_key: "revenue", period_label: "FY2024" });
    const arr = makeFact({ source_kind: "pdf_table", metric_key: "arr", period_label: "FY2024" });

    const { merged } = mergeFinancialFacts([revenue, arr]);

    expect(merged).toHaveLength(2);
  });

  it("keeps both facts when period_label differs, even at same metric_key", () => {
    const fy24 = makeFact({ source_kind: "pdf_table", metric_key: "revenue", period_label: "FY2024" });
    const fy25 = makeFact({ source_kind: "pdf_table", metric_key: "revenue", period_label: "FY2025" });

    const { merged } = mergeFinancialFacts([fy24, fy25]);

    expect(merged).toHaveLength(2);
  });

  it("when same rank on same metric+period, first fact wins", () => {
    const first = makeFact({ source_kind: "xlsx", metric_key: "revenue", period_label: "FY2024", value: 111 });
    const second = makeFact({ source_kind: "xlsx", metric_key: "revenue", period_label: "FY2024", value: 222 });

    const { merged } = mergeFinancialFacts([first, second]);

    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe(111);
  });

  it("returns empty merged array for empty input", () => {
    const { merged, droppedCount } = mergeFinancialFacts([]);
    expect(merged).toEqual([]);
    expect(droppedCount).toBe(0);
  });
});

// ─── 11-12. extractFinancialTableClaims ──────────────────────────────────────

describe("extractFinancialTableClaims — source_kind via financial-fact-registry", () => {
  it("tags all extracted facts with source_kind='xlsx' when source_kind_override='xlsx'", () => {
    const facts = extractFinancialTableClaims(FINANCIAL_TABLE_TEXT, {
      ...BASE_EXTRACT_OPTS,
      source_kind_override: "xlsx",
    });

    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.source_kind).toBe("xlsx");
    }
  });

  it("defaults to source_kind='pdf_table' when no override is provided", () => {
    const facts = extractFinancialTableClaims(FINANCIAL_TABLE_TEXT, {
      ...BASE_EXTRACT_OPTS,
    });

    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.source_kind).toBe("pdf_table");
    }
  });
});

// ─── Bonus: detectFinancialTableCandidate guard ───────────────────────────────

describe("detectFinancialTableCandidate — re-exported guard", () => {
  it("returns true for text containing financial table signals", () => {
    expect(detectFinancialTableCandidate(FINANCIAL_TABLE_TEXT)).toBe(true);
  });

  it("returns false for text with no financial signals", () => {
    expect(detectFinancialTableCandidate("Hello world, this is a cover slide.")).toBe(false);
  });
});

// ─── TEMPORAL_SCOPE_RANK tiers ────────────────────────────────────────────────

describe("TEMPORAL_SCOPE_RANK — tier values", () => {
  it("historical and current are tier 2 (realized)", () => {
    expect(TEMPORAL_SCOPE_RANK["historical"]).toBe(2);
    expect(TEMPORAL_SCOPE_RANK["current"]).toBe(2);
  });

  it("projected, scenario, target are tier 1 (forecast)", () => {
    expect(TEMPORAL_SCOPE_RANK["projected"]).toBe(1);
    expect(TEMPORAL_SCOPE_RANK["scenario"]).toBe(1);
    expect(TEMPORAL_SCOPE_RANK["target"]).toBe(1);
  });

  it("unknown is tier 0 (lowest)", () => {
    expect(TEMPORAL_SCOPE_RANK["unknown"]).toBe(0);
  });

  it("realized > forecast > unknown ordering", () => {
    expect(TEMPORAL_SCOPE_RANK["historical"]).toBeGreaterThan(TEMPORAL_SCOPE_RANK["projected"]);
    expect(TEMPORAL_SCOPE_RANK["projected"]).toBeGreaterThan(TEMPORAL_SCOPE_RANK["unknown"]);
  });
});

// ─── rankFinancialFacts — temporal preference ─────────────────────────────────

describe("rankFinancialFacts — temporal scope is primary sort key", () => {
  it("historical fact ranks above projected of same source_kind", () => {
    const projected = makeFact({ source_kind: "xlsx", metric_key: "revenue", temporal_scope: "projected" } as any);
    const historical = makeFact({ source_kind: "xlsx", metric_key: "revenue", temporal_scope: "historical" } as any);

    const ranked = rankFinancialFacts([projected, historical]);
    expect(ranked[0]!.temporal_scope).toBe("historical");
    expect(ranked[1]!.temporal_scope).toBe("projected");
  });

  it("historical deck outranks projected xlsx (scope tier beats source_kind)", () => {
    const projXlsx = makeFact({ source_kind: "xlsx", metric_key: "revenue", temporal_scope: "projected" } as any);
    const histDeck = makeFact({ source_kind: "deck", metric_key: "revenue", temporal_scope: "historical" } as any);

    const ranked = rankFinancialFacts([projXlsx, histDeck]);
    expect(ranked[0]!.source_kind).toBe("deck");      // historical deck > projected xlsx
    expect(ranked[1]!.source_kind).toBe("xlsx");
  });

  it("current (TTM) scope ranks at same tier as historical — tiebreak by source_kind", () => {
    const ttm = makeFact({ source_kind: "deck", metric_key: "arr", temporal_scope: "current" } as any);
    const ann = makeFact({ source_kind: "xlsx", metric_key: "arr", temporal_scope: "historical" } as any);

    const ranked = rankFinancialFacts([ttm, ann]);
    // Both tier 2 — xlsx outranks deck in secondary sort
    expect(ranked[0]!.source_kind).toBe("xlsx");
    expect(ranked[1]!.source_kind).toBe("deck");
  });

  it("scenario and target rank together with projected (all tier 1)", () => {
    const scenario = makeFact({ source_kind: "xlsx", metric_key: "revenue", temporal_scope: "scenario" } as any);
    const target   = makeFact({ source_kind: "xlsx", metric_key: "revenue", temporal_scope: "target"   } as any);
    const histDeck = makeFact({ source_kind: "deck", metric_key: "revenue", temporal_scope: "historical" } as any);

    const ranked = rankFinancialFacts([scenario, target, histDeck]);
    expect(ranked[0]!.temporal_scope).toBe("historical"); // tier 2 beats both tier-1 items
  });

  it("projected xlsx NOT filtered out when no historical facts exist", () => {
    const proj = makeFact({ source_kind: "xlsx", metric_key: "revenue", temporal_scope: "projected" } as any);
    const ranked = rankFinancialFacts([proj]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.temporal_scope).toBe("projected");
  });

  it("mergeFinancialFacts: realized fact stays when projected fact of same metric+period is also present", () => {
    // Both have period_label "2024" (a projected "2024E" column and an actual "2024" column
    // both produce period_label="2024" after the interpreter's periodSuffix logic)
    const projFact = makeFact({
      source_kind:    "xlsx",
      metric_key:     "revenue",
      period_label:   "2024",
      value:          9_000_000,
      temporal_scope: "projected",
    } as any);
    const actualFact = makeFact({
      source_kind:    "xlsx",
      metric_key:     "revenue",
      period_label:   "2024",
      value:          5_000_000,
      temporal_scope: "historical",
    } as any);

    const { merged } = mergeFinancialFacts([projFact, actualFact]);
    expect(merged).toHaveLength(1);
    // Realized fact wins
    expect(merged[0]!.temporal_scope).toBe("historical");
    expect(merged[0]!.value).toBe(5_000_000);
  });

  it("mergeFinancialFacts: projected fact used as fallback when no actual exists", () => {
    const projFact = makeFact({
      source_kind:    "xlsx",
      metric_key:     "revenue",
      period_label:   "2025",
      value:          12_000_000,
      temporal_scope: "projected",
    } as any);

    const { merged } = mergeFinancialFacts([projFact]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.temporal_scope).toBe("projected");
  });
});
