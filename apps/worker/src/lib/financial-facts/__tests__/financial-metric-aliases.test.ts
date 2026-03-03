/**
 * financial-metric-aliases.test.ts
 */

import { describe, it, expect } from "vitest";
import { normalizeMetricKey, METRIC_ALIAS_MAP } from "../financial-metric-aliases";

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
