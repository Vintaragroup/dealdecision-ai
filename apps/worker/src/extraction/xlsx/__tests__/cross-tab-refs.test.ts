/**
 * __tests__/cross-tab-refs.test.ts
 *
 * Tests for cross-tab formula reference detection:
 *   - extractCrossSheetRefs() unit tests (all primary cases)
 *   - hasCrossSheetRefs() unit tests
 *   - Integration: cross_sheet_refs flows through detectFinancialTables →
 *     parseFinancialTable → promoteToFinancialFactV1
 */

import { describe, it, expect } from "vitest";
import { extractCrossSheetRefs, hasCrossSheetRefs } from "../cross-tab-refs.js";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── extractCrossSheetRefs unit tests ────────────────────────────────────────

describe("extractCrossSheetRefs", () => {
  it("returns [] for an empty string", () => {
    expect(extractCrossSheetRefs("")).toEqual([]);
  });

  it("returns [] for a same-sheet formula with no ! operator", () => {
    expect(extractCrossSheetRefs("C3+C4")).toEqual([]);
    expect(extractCrossSheetRefs("SUM(C3:C10)")).toEqual([]);
    expect(extractCrossSheetRefs("IF(B2>0,A1,0)")).toEqual([]);
  });

  it("detects a single unquoted cross-tab reference", () => {
    expect(extractCrossSheetRefs("Inputs!C5")).toEqual(["Inputs"]);
  });

  it("detects a cross-tab reference inside a function call", () => {
    expect(extractCrossSheetRefs("SUM(Model!C3:C10)")).toEqual(["Model"]);
  });

  it("detects a quoted sheet name with spaces", () => {
    expect(extractCrossSheetRefs("'Revenue Build'!D12")).toEqual(["Revenue Build"]);
  });

  it("detects a quoted sheet name with special characters", () => {
    // Ampersands, hyphens, digits are allowed inside quoted names.
    expect(extractCrossSheetRefs("'P&L 2024'!B5")).toEqual(["P&L 2024"]);
  });

  it("detects multiple cross-tab references in one formula", () => {
    expect(extractCrossSheetRefs("Sheet1!A1+Sheet2!B2")).toEqual(["Sheet1", "Sheet2"]);
  });

  it("detects mixed quoted and unquoted references", () => {
    expect(extractCrossSheetRefs("Inputs!C5*'Growth Model'!B2")).toEqual([
      "Growth Model",
      "Inputs",
    ]);
  });

  it("deduplicates repeated references to the same sheet", () => {
    expect(extractCrossSheetRefs("Inputs!A1+Inputs!B2+Inputs!C3")).toEqual(["Inputs"]);
  });

  it("returns sorted output for stable ordering", () => {
    expect(extractCrossSheetRefs("Zzz!A1+Aaa!A1+Mmm!A1")).toEqual(["Aaa", "Mmm", "Zzz"]);
  });

  it("ignores same-sheet range references when mixed with cross-tab reference", () => {
    // SUM(C3:C5) is same-sheet; Inputs!D12 is cross-tab.
    expect(extractCrossSheetRefs("SUM(C3:C5)+Inputs!D12")).toEqual(["Inputs"]);
  });

  it("handles formula with leading = prefix (xlsx.js omits it, but test data may include it)", () => {
    expect(extractCrossSheetRefs("=Inputs!C5")).toEqual(["Inputs"]);
  });

  it("handles multi-sheet SUM range reference", () => {
    expect(extractCrossSheetRefs("SUM(Model!C3:C17)")).toEqual(["Model"]);
  });

  it("handles quoted sheet name with a numeric suffix", () => {
    expect(extractCrossSheetRefs("'Assumptions v2'!B10")).toEqual(["Assumptions v2"]);
  });
});

// ─── hasCrossSheetRefs unit tests ─────────────────────────────────────────────

describe("hasCrossSheetRefs", () => {
  it("returns false for empty string", () => {
    expect(hasCrossSheetRefs("")).toBe(false);
  });

  it("returns false for a same-sheet formula", () => {
    expect(hasCrossSheetRefs("SUM(C3:C5)")).toBe(false);
  });

  it("returns true for a cross-tab formula", () => {
    expect(hasCrossSheetRefs("Inputs!C5")).toBe(true);
  });

  it("returns true for a quoted-name cross-tab formula", () => {
    expect(hasCrossSheetRefs("'Revenue Build'!D12")).toBe(true);
  });
});

// ─── Integration: payload → TypedMetric → FinancialFactV1 ────────────────────

/**
 * Fixture: excel_sheet payload where:
 *   - Revenue FY2023  → formula referencing Inputs sheet          (single cross-tab)
 *   - Revenue FY2024  → formula referencing Inputs + Growth Model (multi cross-tab)
 *   - EBITDA  FY2023  → same-sheet formula (no cross-tab refs)
 *   - EBITDA  FY2024  → literal value (no formula metadata)
 */
const CROSS_TAB_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Summary",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue", FY2023: 1_000_000, FY2024: 1_500_000 },
      { Metric: "EBITDA",  FY2023:   100_000, FY2024:   200_000 },
    ],
    formula_grid: {
      // Revenue FY2023: cross-tab from Inputs sheet
      "0:FY2023": "Inputs!C5",
      // Revenue FY2024: cross-tab from both Inputs and Growth Model
      "0:FY2024": "Inputs!C5*'Growth Model'!B2",
      // EBITDA FY2023: same-sheet formula — no cross-tab
      "1:FY2023": "C5-C6",
      // EBITDA FY2024: no entry — literal value
    },
  },
};

describe("parseFinancialTable — cross_sheet_refs on TypedMetric", () => {
  it("sets cross_sheet_refs on metrics with single cross-tab formula", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    expect(tables.length).toBeGreaterThanOrEqual(1);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });

    const revFY2023 = metrics.find((m) => m.label?.includes("Revenue") && m.label?.includes("2023"));
    expect(revFY2023).toBeDefined();
    expect(revFY2023!.cross_sheet_refs).toEqual(["Inputs"]);
    expect(revFY2023!.value_kind).toBe("formula");
  });

  it("sets cross_sheet_refs for multi-sheet formula with sorted deduplication", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });

    const revFY2024 = metrics.find((m) => m.label?.includes("Revenue") && m.label?.includes("2024"));
    expect(revFY2024).toBeDefined();
    // "Growth Model" sorts before "Inputs"
    expect(revFY2024!.cross_sheet_refs).toEqual(["Growth Model", "Inputs"]);
    expect(revFY2024!.value_kind).toBe("formula");
  });

  it("does NOT set cross_sheet_refs for same-sheet formula", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });

    const ebitdaFY2023 = metrics.find((m) => m.label?.includes("EBITDA") && m.label?.includes("2023"));
    expect(ebitdaFY2023).toBeDefined();
    expect(ebitdaFY2023!.cross_sheet_refs).toBeUndefined();
    expect(ebitdaFY2023!.value_kind).toBe("formula");
    expect(ebitdaFY2023!.formula).toBe("C5-C6");
  });

  it("does NOT set cross_sheet_refs for literal cell", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });

    const ebitdaFY2024 = metrics.find((m) => m.label?.includes("EBITDA") && m.label?.includes("2024"));
    expect(ebitdaFY2024).toBeDefined();
    expect(ebitdaFY2024!.cross_sheet_refs).toBeUndefined();
    expect(ebitdaFY2024!.value_kind).toBe("literal");
  });
});

describe("promoteToFinancialFactV1 — cross_sheet_refs in promoted facts", () => {
  it("carries cross_sheet_refs through to FinancialFactV1 for multi-sheet formula", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "deal_001" });

    const revFY2024Fact = facts.find(
      (f) => f.metric_key === "revenue" && f.period_label.includes("2024"),
    );
    expect(revFY2024Fact).toBeDefined();
    expect(revFY2024Fact!.cross_sheet_refs).toEqual(["Growth Model", "Inputs"]);
    expect(revFY2024Fact!.value_kind).toBe("formula");
  });

  it("carries cross_sheet_refs for single-sheet cross-tab formula", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "deal_001" });

    const revFY2023Fact = facts.find(
      (f) => f.metric_key === "revenue" && f.period_label.includes("2023"),
    );
    expect(revFY2023Fact).toBeDefined();
    expect(revFY2023Fact!.cross_sheet_refs).toEqual(["Inputs"]);
  });

  it("does NOT set cross_sheet_refs on fact from same-sheet formula", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "deal_001" });

    const ebitdaFY2023Fact = facts.find(
      (f) => f.metric_key === "ebitda" && f.period_label.includes("2023"),
    );
    expect(ebitdaFY2023Fact).toBeDefined();
    expect(ebitdaFY2023Fact!.cross_sheet_refs).toBeUndefined();
    expect(ebitdaFY2023Fact!.value_kind).toBe("formula");
  });

  it("does NOT set cross_sheet_refs on fact from literal cell", () => {
    const tables = detectFinancialTables(CROSS_TAB_PAYLOAD);
    const metrics = parseFinancialTable(tables[0]!, { deal_id: "deal_001", currentYear: 2024 });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "deal_001" });

    const ebitdaFY2024Fact = facts.find(
      (f) => f.metric_key === "ebitda" && f.period_label.includes("2024"),
    );
    expect(ebitdaFY2024Fact).toBeDefined();
    expect(ebitdaFY2024Fact!.cross_sheet_refs).toBeUndefined();
    expect(ebitdaFY2024Fact!.value_kind).toBe("literal");
  });
});
