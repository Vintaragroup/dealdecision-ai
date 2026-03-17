/**
 * __tests__/xlsx-sheet-classifier.test.ts
 *
 * Unit tests for apps/worker/src/extraction/xlsx/sheet-classifier.ts
 */

import { describe, it, expect } from "vitest";
import {
  classifySheet,
  hasScenarioColumns,
  extractScenarioLabels,
  hasForecastColumns,
  type ClassifySheetInput,
} from "../sheet-classifier.js";

// ─── classifySheet ────────────────────────────────────────────────────────────

describe("classifySheet — income_statement detection", () => {
  it("classifies by sheet name", () => {
    const result = classifySheet({
      name: "P&L",
      column_headers: [],
      row_labels: [],
    });
    expect(result.kind).toBe("income_statement");
    expect(result.confidence).toMatch(/high|medium/);
  });

  it("classifies by row labels", () => {
    const result = classifySheet({
      name: "Analytics", // neutral name with no forecast/model keyword
      column_headers: ["2023", "2024"],
      row_labels: ["Revenue", "Cost of Goods Sold", "Gross Profit", "Net Income"],
    });
    expect(result.kind).toBe("income_statement");
  });
});

describe("classifySheet — scenario_model (highest priority)", () => {
  it("scenario wins over income_statement when ≥2 scenario cols", () => {
    const result = classifySheet({
      name: "Revenue Model",
      column_headers: ["Base", "Upside", "Downside"],
      row_labels: ["Revenue", "Net Income"],
    });
    expect(result.kind).toBe("scenario_model");
  });

  it("treats Bull/Bear/Base as scenario columns", () => {
    const result = classifySheet({
      name: "Model",
      column_headers: ["FY2025", "Bull", "Bear"],
      row_labels: ["ARR"],
    });
    expect(result.kind).toBe("scenario_model");
  });
});

describe("classifySheet — cash_flow", () => {
  it("classifies by sheet name", () => {
    const result = classifySheet({
      name: "Cash Flow Statement",
      column_headers: [],
      row_labels: [],
    });
    expect(result.kind).toBe("cash_flow");
  });

  it("classifies by row labels", () => {
    const result = classifySheet({
      name: "Ops",
      column_headers: ["2023", "2024"],
      row_labels: ["Operating Cash Flow", "Net Cash", "Capex"],
    });
    expect(result.kind).toBe("cash_flow");
  });
});

describe("classifySheet — cap_table", () => {
  it("classifies by name", () => {
    const result = classifySheet({
      name: "Cap Table",
      column_headers: [],
      row_labels: [],
    });
    expect(result.kind).toBe("cap_table");
  });
});

describe("classifySheet — balance_sheet", () => {
  it("classifies by name", () => {
    const result = classifySheet({
      name: "Balance Sheet",
      column_headers: [],
      row_labels: [],
    });
    expect(result.kind).toBe("balance_sheet");
  });
});

describe("classifySheet — unknown fallback", () => {
  it("returns unknown for generic/empty sheet", () => {
    const result = classifySheet({ name: "Sheet1", column_headers: [], row_labels: [] });
    expect(result.kind).toBe("unknown");
    expect(result.confidence).toBe("low");
  });
});

// ─── hasScenarioColumns ───────────────────────────────────────────────────────

describe("hasScenarioColumns", () => {
  it("returns true when >= 2 scenario headers present", () => {
    expect(hasScenarioColumns(["Base", "Upside", "Downside"])).toBe(true);
    expect(hasScenarioColumns(["Bull", "Bear"])).toBe(true);
    expect(hasScenarioColumns(["Case 1", "Case 2", "Case 3"])).toBe(true);
  });

  it("returns false when only 1 scenario header", () => {
    expect(hasScenarioColumns(["Base", "2025", "2026"])).toBe(false);
  });

  it("returns false for plain year columns", () => {
    expect(hasScenarioColumns(["2023", "2024", "2025"])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasScenarioColumns([])).toBe(false);
  });
});

// ─── extractScenarioLabels ────────────────────────────────────────────────────

describe("extractScenarioLabels", () => {
  it("extracts Base/Upside/Downside", () => {
    const labels = extractScenarioLabels(["2024", "Base", "Upside", "Downside"]);
    expect(labels).toContain("Base");
    expect(labels).toContain("Upside");
    expect(labels).toContain("Downside");
    expect(labels).not.toContain("2024");
  });

  it("returns empty array for non-scenario headers", () => {
    expect(extractScenarioLabels(["2023", "2024", "2025"])).toEqual([]);
  });
});

// ─── hasForecastColumns ───────────────────────────────────────────────────────

describe("hasForecastColumns", () => {
  it("detects 2025E style headers", () => {
    expect(hasForecastColumns(["2023", "2024", "2025E"])).toBe(true);
  });

  it("detects FY2025E style headers", () => {
    expect(hasForecastColumns(["FY2025E", "FY2026E"])).toBe(true);
  });

  it("returns false for historical-only columns", () => {
    expect(hasForecastColumns(["2022", "2023", "2024"])).toBe(false);
  });
});
