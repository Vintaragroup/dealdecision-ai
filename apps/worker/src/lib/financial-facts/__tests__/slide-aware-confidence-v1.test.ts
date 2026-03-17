/**
 * slide-aware-confidence-v1.test.ts
 *
 * Unit tests for the Phase-10 slide-aware confidence helpers.
 *
 * Coverage:
 *  - applySlideConfidenceBoost: upgrade / downgrade / no-change thresholds
 *  - applySlideAwareness: metadata stamping, confidence adjustment, edge cases
 *  - FINANCIAL_SLIDE_TYPES membership
 */

import { describe, it, expect } from "vitest";
import {
  applySlideConfidenceBoost,
  applySlideAwareness,
  FINANCIAL_SLIDE_TYPES,
  SLIDE_CONFIDENCE_BOOST,
} from "../slide-aware-confidence-v1";
import type { FinancialFactV1 } from "@dealdecision/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<FinancialFactV1> = {}): FinancialFactV1 {
  return {
    fact_id:     "fact-test-001",
    deal_id:     "deal-test-001",
    document_id: "doc-test-001",
    metric_key:  "arr",
    metric_label: "ARR",
    value:       1_000_000,
    unit:        "currency",
    confidence:  "medium",
    source_kind: "pdf_kpi_line",
    page_number: 1,
    extracted_at: new Date().toISOString(),
    ...overrides,
  } as FinancialFactV1;
}

// ─── applySlideConfidenceBoost ────────────────────────────────────────────────

describe("applySlideConfidenceBoost", () => {
  // Upgrade thresholds (boost >= 2)
  it("boost = 4 upgrades medium → high", () => {
    expect(applySlideConfidenceBoost("medium", 4)).toBe("high");
  });

  it("boost = 3 upgrades medium → high", () => {
    expect(applySlideConfidenceBoost("medium", 3)).toBe("high");
  });

  it("boost = 2 upgrades medium → high", () => {
    expect(applySlideConfidenceBoost("medium", 2)).toBe("high");
  });

  it("boost = 1 does NOT upgrade (stays medium)", () => {
    expect(applySlideConfidenceBoost("medium", 1)).toBe("medium");
  });

  it("boost = 0 leaves confidence unchanged", () => {
    expect(applySlideConfidenceBoost("medium", 0)).toBe("medium");
  });

  // Downgrade thresholds (boost <= -1)
  it("boost = -1 downgrades medium → low", () => {
    expect(applySlideConfidenceBoost("medium", -1)).toBe("low");
  });

  it("boost = -2 downgrades medium → low", () => {
    expect(applySlideConfidenceBoost("medium", -2)).toBe("low");
  });

  // Upgrade from low
  it("boost = 4 upgrades low → medium (one level only)", () => {
    expect(applySlideConfidenceBoost("low", 4)).toBe("medium");
  });

  // Cap at high — cannot go above
  it("boost = 4 does not push high above high", () => {
    expect(applySlideConfidenceBoost("high", 4)).toBe("high");
  });

  // Floor at low — cannot go below
  it("boost = -2 does not push low below low", () => {
    expect(applySlideConfidenceBoost("low", -2)).toBe("low");
  });

  // Downgrade from high
  it("boost = -1 downgrades high → medium", () => {
    expect(applySlideConfidenceBoost("high", -1)).toBe("medium");
  });
});

// ─── applySlideAwareness ──────────────────────────────────────────────────────

describe("applySlideAwareness", () => {
  it("returns empty array when given empty array", () => {
    expect(applySlideAwareness([], "financials", "Financials")).toEqual([]);
  });

  it("returns facts unchanged when slide_type is null", () => {
    const facts = [makeFact()];
    const result = applySlideAwareness(facts, null, "Any Title");
    expect(result).toEqual(facts);
  });

  it("returns facts unchanged when slide_type is undefined", () => {
    const facts = [makeFact()];
    const result = applySlideAwareness(facts, undefined, "Any Title");
    expect(result).toEqual(facts);
  });

  it("stamps slide_type on all returned facts", () => {
    const facts = [makeFact(), makeFact({ fact_id: "f2" })];
    const result = applySlideAwareness(facts, "traction", "Traction KPIs");
    expect(result.every((f) => f.slide_type === "traction")).toBe(true);
  });

  it("stamps slide_title on all returned facts", () => {
    const facts = [makeFact()];
    const result = applySlideAwareness(facts, "financials", "2025 Financials");
    expect(result[0]!.slide_title).toBe("2025 Financials");
  });

  it("financials slide boosts medium → high", () => {
    const facts = [makeFact({ confidence: "medium" })];
    const result = applySlideAwareness(facts, "financials", "Financials");
    expect(result[0]!.confidence).toBe("high");
  });

  it("traction slide boosts medium → high (boost = 3)", () => {
    const facts = [makeFact({ confidence: "medium" })];
    const result = applySlideAwareness(facts, "traction", "Traction");
    expect(result[0]!.confidence).toBe("high");
  });

  it("team slide downgrades medium → low", () => {
    const facts = [makeFact({ confidence: "medium" })];
    const result = applySlideAwareness(facts, "team", "Our Team");
    expect(result[0]!.confidence).toBe("low");
  });

  it("market slide downgrades medium → low", () => {
    const facts = [makeFact({ confidence: "medium" })];
    const result = applySlideAwareness(facts, "market", "Market Opportunity");
    expect(result[0]!.confidence).toBe("low");
  });

  it("unknown slide type stamps metadata but does not change confidence", () => {
    const facts = [makeFact({ confidence: "medium" })];
    const result = applySlideAwareness(facts, "product", "Product Demo");
    expect(result[0]!.slide_type).toBe("product");
    expect(result[0]!.confidence).toBe("medium");
  });

  it("does not mutate the original fact objects", () => {
    const original = makeFact({ confidence: "medium" });
    applySlideAwareness([original], "financials", "Financials");
    expect(original.confidence).toBe("medium");
    expect(original.slide_type).toBeUndefined();
  });

  it("slide_title undefined when not provided — not stamped as 'undefined' string", () => {
    const facts = [makeFact()];
    const result = applySlideAwareness(facts, "financials", null);
    // slide_title should be absent or undefined, never the string "null"/"undefined"
    expect(result[0]!.slide_title).toBeUndefined();
  });
});

// ─── FINANCIAL_SLIDE_TYPES ────────────────────────────────────────────────────

describe("FINANCIAL_SLIDE_TYPES", () => {
  it("contains financials", () => expect(FINANCIAL_SLIDE_TYPES.has("financials")).toBe(true));
  it("contains traction",   () => expect(FINANCIAL_SLIDE_TYPES.has("traction")).toBe(true));
  it("contains raise_terms", () => expect(FINANCIAL_SLIDE_TYPES.has("raise_terms")).toBe(true));
  it("contains use_of_funds", () => expect(FINANCIAL_SLIDE_TYPES.has("use_of_funds")).toBe(true));

  it("does NOT contain team",   () => expect(FINANCIAL_SLIDE_TYPES.has("team")).toBe(false));
  it("does NOT contain market", () => expect(FINANCIAL_SLIDE_TYPES.has("market")).toBe(false));
  it("does NOT contain other",  () => expect(FINANCIAL_SLIDE_TYPES.has("other")).toBe(false));
  it("does NOT contain problem", () => expect(FINANCIAL_SLIDE_TYPES.has("problem")).toBe(false));
});

// ─── SLIDE_CONFIDENCE_BOOST map sanity ───────────────────────────────────────

describe("SLIDE_CONFIDENCE_BOOST", () => {
  it("financials has boost = 4 (highest)", () => expect(SLIDE_CONFIDENCE_BOOST.financials).toBe(4));
  it("traction has boost = 3",            () => expect(SLIDE_CONFIDENCE_BOOST.traction).toBe(3));
  it("raise_terms has boost = 2",         () => expect(SLIDE_CONFIDENCE_BOOST.raise_terms).toBe(2));
  it("use_of_funds has boost = 1",        () => expect(SLIDE_CONFIDENCE_BOOST.use_of_funds).toBe(1));
  it("team has boost = -2",               () => expect(SLIDE_CONFIDENCE_BOOST.team).toBe(-2));
  it("market has boost = -2",             () => expect(SLIDE_CONFIDENCE_BOOST.market).toBe(-2));
});
