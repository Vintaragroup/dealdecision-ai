/**
 * extract-chart-fact-claims.test.ts
 *
 * Regression tests for temporal scope classification and fact emission.
 * Part of the section-accuracy stabilization pass (see evaluation/reports/).
 */

import { describe, it, expect } from "vitest";
import {
  extractChartFactClaims,
  inferChartMetricKey,
  detectChartScaleUnit,
} from "../extract-chart-fact-claims";

const BASE_OPTS = {
  deal_id: "deal-test-001",
  visual_asset_id: "asset-abc",
  page_number: 10,
};

// ─── Temporal scope — future-year x-labels ────────────────────────────────────

describe("extractChartFactClaims — temporal_scope", () => {
  const futureChart = {
    chart: {
      type: "bar",
      title: "Revenue Forecast ($M)",
      x_labels: ["2025", "2026", "2027"],
      series: [
        {
          name: "Revenue",
          values: [4.5, 6.0, 7.5],
          unit: null,
          values_are_normalized: false,
        },
      ],
      y_unit: "M",
      confidence: 0.8,
      method: "bar_pixels_v1",
    },
  };

  it("tags facts from future-year x-labels as projected", () => {
    const currentYear = new Date().getFullYear();
    const facts = extractChartFactClaims(futureChart, {
      ...BASE_OPTS,
      slide_type: "financials",
    });
    // All bars with year > current year should be projected
    const projected = facts.filter((f) => f.temporal_scope === "projected");
    const futureYears = ["2025", "2026", "2027"].filter(
      (y) => parseInt(y, 10) > currentYear,
    );
    expect(projected.length).toBeGreaterThanOrEqual(futureYears.length);
  });

  it("tags a chart with 'Forecast' in title as projected regardless of year", () => {
    const chart = {
      chart: {
        ...futureChart.chart,
        title: "Annual Forecast Revenue",
        x_labels: ["Q1", "Q2", "Q3"],
      },
    };
    const facts = extractChartFactClaims(chart, {
      ...BASE_OPTS,
      slide_type: "traction",
    });
    // All facts should be projected because title contains "Forecast"
    for (const f of facts) {
      expect(f.temporal_scope).toBe("projected");
    }
  });

  it("tags a chart with projection keywords in dpu_text as projected", () => {
    const chart = {
      chart: {
        type: "bar",
        title: "Revenue",
        x_labels: ["2023", "2024"],
        series: [
          {
            name: "Revenue",
            values: [2.0, 3.5],
            unit: null,
            values_are_normalized: false,
          },
        ],
        y_unit: "M",
        confidence: 0.8,
        method: "bar_pixels_v1",
      },
    };
    const facts = extractChartFactClaims(chart, {
      ...BASE_OPTS,
      slide_type: "financials",
      dpu_text: "Projected Revenue 2023 2024 Expected Growth Target",
    });
    for (const f of facts) {
      expect(f.temporal_scope).toBe("projected");
    }
  });

  it("tags historical-year bars as historical when no projection keywords", () => {
    const currentYear = new Date().getFullYear();
    const pastYear1 = String(currentYear - 2);
    const pastYear2 = String(currentYear - 1);
    const chart = {
      chart: {
        type: "bar",
        title: "Actual Revenue",
        x_labels: [pastYear1, pastYear2],
        series: [
          {
            name: "Revenue",
            values: [1.5, 2.5],
            unit: null,
            values_are_normalized: false,
          },
        ],
        y_unit: "M",
        confidence: 0.85,
        method: "bar_pixels_v1",
      },
    };
    const facts = extractChartFactClaims(chart, {
      ...BASE_OPTS,
      slide_type: "financials",
      dpu_text: "Actual revenue for past two fiscal years",
    });
    for (const f of facts) {
      expect(f.temporal_scope).toBe("historical");
    }
  });

  it("emits temporal_scope on every returned fact", () => {
    const facts = extractChartFactClaims(futureChart, {
      ...BASE_OPTS,
      slide_type: "financials",
    });
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.temporal_scope).toBeDefined();
    }
  });
});

// ─── detectChartScaleUnit ─────────────────────────────────────────────────────

describe("detectChartScaleUnit", () => {
  it("detects millions", () => {
    expect(detectChartScaleUnit("$M")).toEqual({ multiplier: 1_000_000, unit: "currency" });
    expect(detectChartScaleUnit("in millions")).toEqual({ multiplier: 1_000_000, unit: "currency" });
  });

  it("detects thousands", () => {
    expect(detectChartScaleUnit("$K")).toEqual({ multiplier: 1_000, unit: "currency" });
  });

  it("detects percent", () => {
    const r = detectChartScaleUnit("percent");
    expect(r?.unit).toBe("percent");
  });

  it("returns null for empty text", () => {
    expect(detectChartScaleUnit("")).toBeNull();
  });
});

// ─── inferChartMetricKey ──────────────────────────────────────────────────────

describe("inferChartMetricKey", () => {
  it("infers mrr from dpu text containing MRR keyword", () => {
    // "MRR" alone (not "recurring revenue") should hit the mrr pattern
    expect(inferChartMetricKey(undefined, "MRR growth over 12 months")).toBe("mrr");
  });

  it("infers arr from chart title", () => {
    expect(inferChartMetricKey(undefined, undefined, "ARR Growth ($M)")).toBe("arr");
  });

  it("infers revenue from slide_type financials when no keywords match", () => {
    expect(inferChartMetricKey("financials", "quarterly data breakdown")).toBe("revenue");
  });

  it("returns null when no signal available", () => {
    expect(inferChartMetricKey(undefined, "team overview headcount")).toBeNull();
  });
});
