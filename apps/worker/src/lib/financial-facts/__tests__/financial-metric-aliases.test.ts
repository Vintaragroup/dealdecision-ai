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
