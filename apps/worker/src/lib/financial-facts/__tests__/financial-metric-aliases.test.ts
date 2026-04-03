/**
 * financial-metric-aliases.test.ts
 */

import { describe, it, expect } from "vitest";
import { normalizeMetricKey, METRIC_ALIAS_MAP, isKnownMetricKey, KNOWN_CANONICAL_METRIC_KEYS } from "../financial-metric-aliases";

describe("normalizeMetricKey", () => {
  it("returns canonical key for known aliases (case-insensitive)", () => {
    expect(normalizeMetricKey("Revenue")).toBe("revenue");
    expect(normalizeMetricKey("Total Revenue")).toBe("revenue");
    expect(normalizeMetricKey("TOTAL REVENUES")).toBe("revenue");
    expect(normalizeMetricKey("Net Sales")).toBe("revenue");
    expect(normalizeMetricKey("Sales")).toBe("revenue");
  });

  it("normalizes burn rate aliases", () => {
    expect(normalizeMetricKey("Burn")).toBe("burn_rate");
    expect(normalizeMetricKey("Monthly Burn")).toBe("burn_rate");
    expect(normalizeMetricKey("Net Burn")).toBe("burn_rate");
    expect(normalizeMetricKey("Cash Burn")).toBe("burn_rate");
  });

  it("normalizes runway aliases", () => {
    expect(normalizeMetricKey("Runway")).toBe("runway_months");
    expect(normalizeMetricKey("Cash Runway")).toBe("runway_months");
    expect(normalizeMetricKey("Months of Runway")).toBe("runway_months");
  });

  it("normalizes ARR and MRR", () => {
    expect(normalizeMetricKey("ARR")).toBe("arr");
    expect(normalizeMetricKey("Annual Recurring Revenue")).toBe("arr");
    expect(normalizeMetricKey("MRR")).toBe("mrr");
    expect(normalizeMetricKey("Monthly Recurring Revenue")).toBe("mrr");
  });

  it("normalizes gross margin aliases", () => {
    expect(normalizeMetricKey("Gross Margin")).toBe("gross_margin");
    expect(normalizeMetricKey("GM%")).toBe("gross_margin");
    expect(normalizeMetricKey("Gross Margin %")).toBe("gross_margin");
  });

  it("strips trailing % and : from label", () => {
    expect(normalizeMetricKey("Churn Rate")).toBe("churn_pct");
  });

  it("slugifies unknown labels rather than crashing", () => {
    const result = normalizeMetricKey("Some Unknown KPI 2024");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/^[a-z0-9_]+$/);
  });

  it("handles empty string gracefully", () => {
    const result = normalizeMetricKey("   ");
    expect(typeof result).toBe("string");
  });

  it("alias map has at least 30 entries", () => {
    expect(Object.keys(METRIC_ALIAS_MAP).length).toBeGreaterThanOrEqual(30);
  });
});

// ─── isKnownMetricKey ─────────────────────────────────────────────────────────

describe("isKnownMetricKey", () => {
  it("returns true for canonical alias-mapped keys", () => {
    expect(isKnownMetricKey("revenue")).toBe(true);
    expect(isKnownMetricKey("arr")).toBe(true);
    expect(isKnownMetricKey("burn_rate")).toBe(true);
    expect(isKnownMetricKey("pre_money_valuation")).toBe(true);
    expect(isKnownMetricKey("net_revenue_retention")).toBe(true);
  });

  it("returns false for OCR artifact slugs", () => {
    expect(isKnownMetricKey("and_fortune")).toBe(false);
    expect(isKnownMetricKey("warehouse_associate_day")).toBe(false);
    expect(isKnownMetricKey("fortune_500_partner")).toBe(false);
  });

  it("returns false for job-title slugs", () => {
    expect(isKnownMetricKey("senior_analyst")).toBe(false);
    expect(isKnownMetricKey("director_of_engineering")).toBe(false);
  });

  it("KNOWN_CANONICAL_METRIC_KEYS contains all alias values", () => {
    for (const val of Object.values(METRIC_ALIAS_MAP)) {
      expect(KNOWN_CANONICAL_METRIC_KEYS.has(val)).toBe(true);
    }
  });
});

// ─── Critical metric alias coverage ──────────────────────────────────────────

describe("normalizeMetricKey — raise_amount aliases", () => {
  it("maps 'the ask' to raise_amount (DealDecision real-deal pattern)", () => {
    expect(normalizeMetricKey("The Ask")).toBe("raise_amount");
    expect(normalizeMetricKey("the ask")).toBe("raise_amount");
  });

  it("maps 'amount raising' to raise_amount", () => {
    expect(normalizeMetricKey("Amount Raising")).toBe("raise_amount");
  });

  it("maps 'funding sought' to raise_amount", () => {
    expect(normalizeMetricKey("Funding Sought")).toBe("raise_amount");
  });

  it("maps 'pre-seed raise' to raise_amount", () => {
    expect(normalizeMetricKey("Pre-Seed Raise")).toBe("raise_amount");
    expect(normalizeMetricKey("Pre Seed Raise")).toBe("raise_amount");
  });

  it("maps existing raise aliases unchanged", () => {
    expect(normalizeMetricKey("Raising")).toBe("raise_amount");
    expect(normalizeMetricKey("Capital Raise")).toBe("raise_amount");
    expect(normalizeMetricKey("Seed Round")).toBe("raise_amount");
    expect(normalizeMetricKey("Series A")).toBe("raise_amount");
  });
});

describe("normalizeMetricKey — cash aliases", () => {
  it("maps 'cash position' to cash", () => {
    expect(normalizeMetricKey("Cash Position")).toBe("cash");
    expect(normalizeMetricKey("cash position")).toBe("cash");
  });

  it("maps existing cash aliases unchanged", () => {
    expect(normalizeMetricKey("Cash Balance")).toBe("cash");
    expect(normalizeMetricKey("Cash on Hand")).toBe("cash");
    expect(normalizeMetricKey("Ending Cash")).toBe("cash");
  });
});

describe("normalizeMetricKey — runway aliases", () => {
  it("maps 'operating runway' to runway_months", () => {
    expect(normalizeMetricKey("Operating Runway")).toBe("runway_months");
  });

  it("maps existing runway aliases unchanged", () => {
    expect(normalizeMetricKey("Runway")).toBe("runway_months");
    expect(normalizeMetricKey("Cash Runway")).toBe("runway_months");
    expect(normalizeMetricKey("Months of Runway")).toBe("runway_months");
  });
});

describe("normalizeMetricKey — pre_money_valuation aliases", () => {
  it("maps 'valuation cap' to pre_money_valuation", () => {
    expect(normalizeMetricKey("Valuation Cap")).toBe("pre_money_valuation");
  });

  it("maps existing valuation aliases unchanged", () => {
    expect(normalizeMetricKey("Pre-Money Valuation")).toBe("pre_money_valuation");
    expect(normalizeMetricKey("Pre Money")).toBe("pre_money_valuation");
    expect(normalizeMetricKey("Company Valuation")).toBe("pre_money_valuation");
  });
});

describe("normalizeMetricKey — arr and mrr aliases", () => {
  it("maps 'annual recurring revenue' to arr", () => {
    expect(normalizeMetricKey("Annual Recurring Revenue")).toBe("arr");
  });

  it("maps 'monthly recurring revenue' to mrr", () => {
    expect(normalizeMetricKey("Monthly Recurring Revenue")).toBe("mrr");
  });
});

// ─── Ambiguity regression guards ─────────────────────────────────────────────

describe("normalizeMetricKey — ambiguity guards", () => {
  it("does NOT map bare 'ask' to raise_amount (too generic)", () => {
    // "ask" alone should not match — only "the ask" is in the alias map
    const result = normalizeMetricKey("ask");
    expect(result).not.toBe("raise_amount");
  });

  it("does NOT map 'subscription revenue' to mrr", () => {
    // subscription revenue → revenue (not mrr), as it could be non-recurring
    expect(normalizeMetricKey("Subscription Revenue")).toBe("revenue");
  });

  it("does NOT map 'post-money valuation' to pre_money_valuation", () => {
    expect(normalizeMetricKey("Post-Money Valuation")).toBe("post_money_valuation");
    expect(normalizeMetricKey("Post Money")).toBe("post_money_valuation");
  });
});

// ─── Guardrail: payroll row suppression (G5) ─────────────────────────────────

describe("normalizeMetricKey — payroll row suppression (G5)", () => {
  it("maps 'Sales 1' to opex (not revenue)", () => {
    expect(normalizeMetricKey("Sales 1")).toBe("opex");
  });

  it("maps 'Sales 2' to opex (not revenue)", () => {
    expect(normalizeMetricKey("Sales 2")).toBe("opex");
  });

  it("maps 'Sales 3' to opex (not revenue)", () => {
    expect(normalizeMetricKey("Sales 3")).toBe("opex");
  });

  it("maps 'Sales Rep' to opex (not revenue)", () => {
    expect(normalizeMetricKey("Sales Rep")).toBe("opex");
  });

  it("maps 'Sales Representative' to opex (not revenue)", () => {
    expect(normalizeMetricKey("Sales Representative")).toBe("opex");
  });

  it("maps 'Operations 1' to opex", () => {
    expect(normalizeMetricKey("Operations 1")).toBe("opex");
  });

  it("maps 'Operations 2' to opex", () => {
    expect(normalizeMetricKey("Operations 2")).toBe("opex");
  });

  it("still maps bare 'Sales' to revenue (unchanged)", () => {
    // The payroll guard must not break the existing revenue alias.
    expect(normalizeMetricKey("Sales")).toBe("revenue");
  });

  it("still maps 'Total Sales' to revenue (unchanged)", () => {
    expect(normalizeMetricKey("Total Sales")).toBe("revenue");
  });
});
