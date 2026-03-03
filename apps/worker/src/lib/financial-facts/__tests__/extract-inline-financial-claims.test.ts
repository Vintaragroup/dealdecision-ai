/**
 * extract-inline-financial-claims.test.ts
 *
 * Unit tests for extractInlineFinancialClaims().
 *
 * Validates:
 * - Pattern matching (P1–P5)
 * - Noise gate: no finance keyword near numeric → nothing extracted
 * - Only known metric keys are emitted
 * - source_kind is always "pdf_kpi_line"
 * - confidence is always "medium"
 * - Cap of 20 claims per page
 * - Never throws
 */

import { describe, it, expect } from "vitest";
import { extractInlineFinancialClaims } from "../extract-inline-financial-claims";

const BASE_OPTS = {
  deal_id:     "test-deal-id",
  document_id: "test-doc-id",
  page_number: 1,
};

describe("extractInlineFinancialClaims", () => {
  // ── Pattern 1: Label: $value ───────────────────────────────────────────────

  it("P1 — extracts ARR from colon-separated line", () => {
    const facts = extractInlineFinancialClaims("ARR: $2M", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("arr");
    expect(facts[0]!.value).toBe(2_000_000);
    expect(facts[0]!.unit).toBe("currency");
  });

  it("P1 — extracts MRR from colon-separated line", () => {
    const facts = extractInlineFinancialClaims("MRR: $150k", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("mrr");
    expect(facts[0]!.value).toBe(150_000);
  });

  it("P1 — extracts burn rate from colon-separated line", () => {
    const facts = extractInlineFinancialClaims("Burn Rate: $80k", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("burn_rate");
    expect(facts[0]!.value).toBe(80_000);
  });

  it("P1 — extracts pre-money valuation", () => {
    const facts = extractInlineFinancialClaims(
      "Pre-money valuation: $20M",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("pre_money_valuation");
    expect(facts[0]!.value).toBe(20_000_000);
  });

  it("P1 — extracts gross margin percent", () => {
    const facts = extractInlineFinancialClaims("Gross Margin: 65%", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("gross_margin");
    expect(facts[0]!.value).toBe(65);
    expect(facts[0]!.unit).toBe("percent");
  });

  // ── Pattern 3: Label $value ────────────────────────────────────────────────

  it("P3 — extracts ARR from label-before-value", () => {
    const facts = extractInlineFinancialClaims("ARR $2.5M", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("arr");
    expect(facts[0]!.value).toBe(2_500_000);
  });

  // ── Pattern 4: $value Label ────────────────────────────────────────────────

  it("P4 — extracts valuation from value-before-label", () => {
    const facts = extractInlineFinancialClaims("$8B valuation", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("pre_money_valuation");
    expect(facts[0]!.value).toBe(8_000_000_000);
  });

  it("P4 — extracts ARR from value-before-label", () => {
    const facts = extractInlineFinancialClaims("$3M ARR", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("arr");
    expect(facts[0]!.value).toBe(3_000_000);
  });

  // ── Pattern 5: Raise sentence ──────────────────────────────────────────────

  it("P5 — extracts raise amount from sentence", () => {
    const facts = extractInlineFinancialClaims(
      "We are raising $5M in our Series A round.",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("raise_amount");
    expect(facts[0]!.value).toBe(5_000_000);
  });

  it("P5 — extracts raise from 'raised' sentence", () => {
    const facts = extractInlineFinancialClaims(
      "The company raised $2.5M in seed funding.",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("raise_amount");
  });

  // ── Multi-line extraction ──────────────────────────────────────────────────

  it("extracts multiple facts from a multi-line traction slide", () => {
    const text = [
      "ARR: $4M",
      "MRR: $333k",
      "Gross Margin: 72%",
      "Burn Rate: $120k",
    ].join("\n");

    const facts = extractInlineFinancialClaims(text, BASE_OPTS);
    const keys = facts.map((f) => f.metric_key);

    expect(keys).toContain("arr");
    expect(keys).toContain("mrr");
    expect(keys).toContain("gross_margin");
    expect(keys).toContain("burn_rate");
  });

  // ── source_kind and confidence assertions ─────────────────────────────────

  it("always emits source_kind='pdf_kpi_line'", () => {
    const facts = extractInlineFinancialClaims("ARR: $2M", BASE_OPTS);
    expect(facts[0]!.source_kind).toBe("pdf_kpi_line");
  });

  it("always emits confidence='medium'", () => {
    const facts = extractInlineFinancialClaims("ARR: $2M", BASE_OPTS);
    expect(facts[0]!.confidence).toBe("medium");
  });

  it("populates deal_id and document_id correctly", () => {
    const facts = extractInlineFinancialClaims("ARR: $2M", BASE_OPTS);
    expect(facts[0]!.deal_id).toBe("test-deal-id");
    expect(facts[0]!.document_id).toBe("test-doc-id");
    expect(facts[0]!.page_number).toBe(1);
  });

  // ── Noise gate ────────────────────────────────────────────────────────────

  it("rejects numeric with no finance keyword nearby", () => {
    // Random number with no financial context
    const facts = extractInlineFinancialClaims(
      "The building has 42 floors and 1200 windows.",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(0);
  });

  it("rejects percentage with no finance context", () => {
    const facts = extractInlineFinancialClaims(
      "We scored 95% on the survey.",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(0);
  });

  // ── Unknown metric key rejection ──────────────────────────────────────────

  it("rejects unknown/unmapped metric labels", () => {
    // "synergy multiplier" is not in the alias map → should be discarded
    const facts = extractInlineFinancialClaims(
      "Synergy multiplier: $5M",
      BASE_OPTS,
    );
    // Even if it passes noise gate, the metric_key won't be in KNOWN_INLINE_METRIC_KEYS
    // → either nothing is emitted or the key doesn't match a known one
    facts.forEach((f) => {
      expect(f.metric_key).not.toBe("synergy_multiplier");
    });
  });

  // ── Period extraction ─────────────────────────────────────────────────────

  it("captures period from line context", () => {
    const facts = extractInlineFinancialClaims(
      "ARR: $3M FY2024",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.period_label).toBe("FY2024");
  });

  it("defaults period_label to 'current' when no period found", () => {
    const facts = extractInlineFinancialClaims("ARR: $2M", BASE_OPTS);
    expect(facts[0]!.period_label).toBe("current");
  });

  // ── Cap at 20 claims ──────────────────────────────────────────────────────

  it("caps output at 20 claims per page", () => {
    // Build 30 lines, all valid ARR claims with different periods
    const lines = Array.from(
      { length: 30 },
      (_, i) => `ARR: $${i + 1}M`,
    );
    const facts = extractInlineFinancialClaims(lines.join("\n"), BASE_OPTS);
    expect(facts.length).toBeLessThanOrEqual(20);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("returns [] for empty string", () => {
    expect(extractInlineFinancialClaims("", BASE_OPTS)).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(extractInlineFinancialClaims("   \n  \n  ", BASE_OPTS)).toEqual([]);
  });

  it("never throws on garbage input", () => {
    expect(() =>
      extractInlineFinancialClaims(
        "!!!@@@### $$$ %^& *((( --- ||| \x00\x01",
        BASE_OPTS,
      ),
    ).not.toThrow();
  });

  // ── Ask slide patterns ────────────────────────────────────────────────────

  it("extracts raise_amount from 'Raise Amount' label", () => {
    const facts = extractInlineFinancialClaims(
      "Raise Amount: $3M",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("raise_amount");
  });

  it("extracts post_money_valuation from post-money label", () => {
    const facts = extractInlineFinancialClaims(
      "Post-money valuation: $25M",
      BASE_OPTS,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("post_money_valuation");
  });

  it("extracts gmv from GMV label", () => {
    const facts = extractInlineFinancialClaims("GMV: $10M", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("gmv");
  });
});

// ── detectFinancialTableCandidate expansion tests ─────────────────────────────

import { detectFinancialTableCandidate } from "../extract-financial-table-claims";

describe("detectFinancialTableCandidate (expanded)", () => {
  it("detects valuation mention (new keyword)", () => {
    expect(detectFinancialTableCandidate("Pre-money valuation: $20M")).toBe(true);
  });

  it("detects raise mention (new keyword)", () => {
    expect(detectFinancialTableCandidate("We are raising $5M")).toBe(true);
  });

  it("detects margin mention (new keyword)", () => {
    expect(detectFinancialTableCandidate("Gross margin 72% for FY2024")).toBe(true);
  });

  it("detects opex mention (new keyword)", () => {
    expect(detectFinancialTableCandidate("Total opex $1.2M annually")).toBe(true);
  });

  it("detects via rule E: 2 currency + finance keyword", () => {
    // 2 currency symbols + 'revenue' keyword — should hit rule E
    expect(
      detectFinancialTableCandidate("Revenue grew from $1M to $3M last year"),
    ).toBe(true);
  });

  it("still returns false for non-financial text", () => {
    expect(
      detectFinancialTableCandidate("Our product is built on React and TypeScript."),
    ).toBe(false);
  });
});

// ── mergeFactsByConfidence tests ──────────────────────────────────────────────

import { mergeFactsByConfidence } from "../populate-financial-fact-registry-v1";
import type { FinancialFactV1 } from "@dealdecision/core";

function makeTestFact(
  metricKey: string,
  periodLabel: string,
  sourceKind: FinancialFactV1["source_kind"],
  value = 1_000_000,
): FinancialFactV1 {
  return {
    fact_id:               `test-${metricKey}-${periodLabel}-${sourceKind}`,
    deal_id:               "test-deal",
    source_kind:           sourceKind,
    metric_key:            metricKey,
    period_type:           "annual",
    period_label:          periodLabel,
    value,
    unit:                  "currency",
    confidence:            "medium",
    reconciliation_status: "unknown",
  };
}

describe("mergeFactsByConfidence", () => {
  it("keeps pdf_table over pdf_kpi_line for same metric+period", () => {
    const tableFact  = makeTestFact("arr", "FY2024", "pdf_table",    3_000_000);
    const inlineFact = makeTestFact("arr", "FY2024", "pdf_kpi_line", 2_000_000);
    const { merged } = mergeFactsByConfidence([inlineFact, tableFact]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source_kind).toBe("pdf_table");
    expect(merged[0]!.value).toBe(3_000_000);
  });

  it("keeps xlsx over pdf_kpi_line", () => {
    const xlsxFact   = makeTestFact("arr", "FY2024", "xlsx",         4_000_000);
    const inlineFact = makeTestFact("arr", "FY2024", "pdf_kpi_line", 2_000_000);
    const { merged } = mergeFactsByConfidence([inlineFact, xlsxFact]);
    expect(merged[0]!.source_kind).toBe("xlsx");
  });

  it("keeps pdf_table over xlsx", () => {
    const tableFact = makeTestFact("revenue", "FY2024", "pdf_table", 5_000_000);
    const xlsxFact  = makeTestFact("revenue", "FY2024", "xlsx",      4_000_000);
    const { merged } = mergeFactsByConfidence([xlsxFact, tableFact]);
    expect(merged[0]!.source_kind).toBe("pdf_table");
  });

  it("keeps different metric+period combinations", () => {
    const fact1 = makeTestFact("arr",    "FY2024", "pdf_kpi_line");
    const fact2 = makeTestFact("mrr",    "FY2024", "pdf_kpi_line");
    const fact3 = makeTestFact("arr",    "FY2025", "pdf_kpi_line");
    const { merged } = mergeFactsByConfidence([fact1, fact2, fact3]);
    expect(merged).toHaveLength(3);
  });

  it("counts dropped facts in droppedCount", () => {
    const tableFact  = makeTestFact("arr", "FY2024", "pdf_table");
    const inlineFact = makeTestFact("arr", "FY2024", "pdf_kpi_line");
    const { droppedCount } = mergeFactsByConfidence([tableFact, inlineFact]);
    expect(droppedCount).toBe(1);
  });

  it("returns [] for empty input", () => {
    const { merged, droppedCount } = mergeFactsByConfidence([]);
    expect(merged).toEqual([]);
    expect(droppedCount).toBe(0);
  });
});
