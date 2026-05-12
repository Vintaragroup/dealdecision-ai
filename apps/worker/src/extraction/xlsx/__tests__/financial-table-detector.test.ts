/**
 * __tests__/financial-table-detector.test.ts
 *
 * Unit tests for apps/worker/src/extraction/xlsx/table-detector.ts
 */

import { describe, it, expect } from "vitest";
import { detectFinancialTables, detectUnitScale, isStructuralColumnHeader } from "../table-detector.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExcelRangePayload(
  sheetTitle: string,
  rowsPreview: Record<string, unknown>[],
) {
  return {
    page_type: "excel_range",
    structured: { sheet_title: sheetTitle, rows_preview: rowsPreview },
  };
}

function makeExcelSheetPayload(
  sheetTitle: string,
  headers: string[],
  rows: Record<string, unknown>[],
) {
  return {
    page_type: "excel_sheet",
    structured: { sheet_title: sheetTitle, headers, rows, tables: [] },
  };
}

// ─── excel_range format ───────────────────────────────────────────────────────

const INCOME_ROWS_PREVIEW: Record<string, unknown>[] = [
  // Period header row (values are year integers)
  { col_A: null, col_C: 2023, col_D: 2024, col_E: 2025 },
  // Data rows
  { col_A: "Revenue",           col_C: 5_000_000, col_D: 7_200_000, col_E: 9_800_000 },
  { col_A: "Cost of Goods Sold",col_C: 2_000_000, col_D: 2_800_000, col_E: 3_800_000 },
  { col_A: "Gross Profit",      col_C: 3_000_000, col_D: 4_400_000, col_E: 6_000_000 },
  { col_A: "Net Income",        col_C: 800_000,   col_D: 1_200_000, col_E: 1_900_000 },
];

describe("detectFinancialTables — excel_range", () => {
  it("returns a FinancialTable for a valid income-statement rows_preview", () => {
    const payload = makeExcelRangePayload("P&L", INCOME_ROWS_PREVIEW);
    const tables = detectFinancialTables(payload);
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(t.sheet_name).toBe("P&L");
    expect(t.source_page_type).toBe("excel_range");
    expect(t.row_headers).toContain("Revenue");
    expect(t.row_headers).toContain("Net Income");
    expect(t.column_headers).toContain("2023");
    expect(t.column_headers).toContain("2025");
    expect(t.cell_matrix).toHaveLength(t.row_headers.length);
  });

  it("cell_matrix contains correct values", () => {
    const payload = makeExcelRangePayload("P&L", INCOME_ROWS_PREVIEW);
    const [t] = detectFinancialTables(payload);
    const revenueIdx = t!.row_headers.indexOf("Revenue");
    expect(revenueIdx).toBeGreaterThanOrEqual(0);
    const row = t!.cell_matrix[revenueIdx]!;
    expect(row[0]).toBe(5_000_000);
    expect(row[1]).toBe(7_200_000);
    expect(row[2]).toBe(9_800_000);
  });

  it("classifies as income_statement", () => {
    const payload = makeExcelRangePayload("Income Statement", INCOME_ROWS_PREVIEW);
    const [t] = detectFinancialTables(payload);
    expect(t!.table_kind).toBe("income_statement");
  });

  it("classifies as scenario_model when column headers contain Base/Upside/Downside", () => {
    const scenarioRows: Record<string, unknown>[] = [
      { col_A: null,      col_C: "Base",   col_D: "Upside", col_E: "Downside" },
      { col_A: "Revenue", col_C: 5_000_000, col_D: 7_000_000, col_E: 4_000_000 },
      { col_A: "EBITDA",  col_C: 800_000,  col_D: 1_200_000, col_E: 500_000 },
    ];
    const payload = makeExcelRangePayload("Revenue Model", scenarioRows);
    const [t] = detectFinancialTables(payload);
    expect(t!.table_kind).toBe("scenario_model");
    expect(t!.column_headers).toContain("Base");
    expect(t!.column_headers).toContain("Upside");
  });

  it("returns [] for an empty rows_preview", () => {
    const payload = makeExcelRangePayload("Empty", []);
    expect(detectFinancialTables(payload)).toHaveLength(0);
  });

  it("returns [] when rows have no numeric data", () => {
    const noNumericRows = [
      { col_A: "Label A", col_C: null, col_D: null },
      { col_A: "Label B", col_C: null, col_D: null },
    ];
    const payload = makeExcelRangePayload("NoData", noNumericRows);
    expect(detectFinancialTables(payload)).toHaveLength(0);
  });
});

// ─── excel_sheet format ───────────────────────────────────────────────────────

describe("detectFinancialTables — excel_sheet", () => {
  it("parses headers + rows format", () => {
    const headers = ["Metric", "2023", "2024", "2025"];
    const rows: Record<string, unknown>[] = [
      { Metric: "Revenue",   "2023": 5_000_000, "2024": 7_200_000, "2025": 9_800_000 },
      { Metric: "Net Income","2023": 800_000,   "2024": 1_200_000, "2025": 1_900_000 },
    ];
    const payload = makeExcelSheetPayload("Summary", headers, rows);
    const tables = detectFinancialTables(payload);
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(t.source_page_type).toBe("excel_sheet");
    expect(t.row_headers).toContain("Revenue");
    expect(t.column_headers).toContain("2023");
    expect(t.cell_matrix[0]![0]).toBe(5_000_000);
  });

  it("returns [] when too few headers", () => {
    const payload = makeExcelSheetPayload("Bad", ["MetricOnly"], [
      { MetricOnly: "Revenue" },
    ]);
    expect(detectFinancialTables(payload)).toHaveLength(0);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("detectFinancialTables — edge cases", () => {
  it("returns [] for null payload", () => {
    expect(detectFinancialTables(null)).toHaveLength(0);
  });

  it("returns [] for unknown page_type", () => {
    expect(detectFinancialTables({ page_type: "pdf_image" })).toHaveLength(0);
  });

  it("handles string numeric values with commas", () => {
    const rows: Record<string, unknown>[] = [
      { col_A: null, col_C: 2024, col_D: 2025 },
      { col_A: "Revenue",   col_C: "5,000,000", col_D: "7,200,000" },
      { col_A: "Net Income",col_C: "800,000",   col_D: "1,200,000" },
    ];
    const payload = makeExcelRangePayload("Sheet", rows);
    const [t] = detectFinancialTables(payload);
    expect(t!.cell_matrix[0]![0]).toBe(5_000_000);
  });

  it("handles accounting-format negative values (1,200)", () => {
    const rows: Record<string, unknown>[] = [
      { col_A: null,       col_C: 2024,        col_D: 2025 },
      { col_A: "Net Loss", col_C: "(500,000)", col_D: "(300,000)" },
      { col_A: "EBITDA",   col_C: "(100,000)", col_D: "(50,000)" },
    ];
    const payload = makeExcelRangePayload("Sheet", rows);
    const [t] = detectFinancialTables(payload);
    expect(t!.cell_matrix[0]![0]).toBe(-500_000);
  });
});

// ─── detectUnitScale — pure function ─────────────────────────────────────────

describe("detectUnitScale — marker detection", () => {
  it("detects 'in thousands' inside a sheet title → factor 1000", () => {
    const { factor, source_text } = detectUnitScale(["Revenue Model (in thousands)"]);
    expect(factor).toBe(1_000);
    expect(source_text).toBe("Revenue Model (in thousands)");
  });

  it("detects standalone '(in thousands)' → factor 1000", () => {
    const { factor } = detectUnitScale(["(in thousands)"]);
    expect(factor).toBe(1_000);
  });

  it("detects '$000s' → factor 1000", () => {
    const { factor, source_text } = detectUnitScale(["$000s"]);
    expect(factor).toBe(1_000);
    expect(source_text).toBe("$000s");
  });

  it("detects '£000s' → factor 1000", () => {
    const { factor } = detectUnitScale(["£000s"]);
    expect(factor).toBe(1_000);
  });

  it("detects 'in millions' → factor 1_000_000", () => {
    const { factor, source_text } = detectUnitScale(["in millions"]);
    expect(factor).toBe(1_000_000);
    expect(source_text).toBe("in millions");
  });

  it("detects '$MM' → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["$MM"]);
    expect(factor).toBe(1_000_000);
  });

  it("detects 'in billions' → factor 1_000_000_000", () => {
    const { factor } = detectUnitScale(["in billions"]);
    expect(factor).toBe(1_000_000_000);
  });

  it("returns factor=1 and source_text=null when no marker present", () => {
    const { factor, source_text } = detectUnitScale(["P&L", "Revenue", "2023", "2024"]);
    expect(factor).toBe(1);
    expect(source_text).toBeNull();
  });

  it("returns factor=1 for empty array", () => {
    const { factor, source_text } = detectUnitScale([]);
    expect(factor).toBe(1);
    expect(source_text).toBeNull();
  });

  it("returns the first-text match when multiple markers are present across texts", () => {
    // "in millions" text appears before "in thousands" → millions wins
    const { factor } = detectUnitScale(["in millions", "in thousands"]);
    expect(factor).toBe(1_000_000);
  });

  it("billions pattern does not false-match on a 'millions' string", () => {
    const { factor } = detectUnitScale(["in millions"]);
    expect(factor).toBe(1_000_000);
    expect(factor).not.toBe(1_000_000_000);
  });
});

// ─── detectFinancialTables — unit_scale_factor field (excel_range) ─────────────

describe("detectFinancialTables — unit_scale_factor (excel_range)", () => {
  it("sets unit_scale_factor=1000 when sheet title contains '(in thousands)'", () => {
    const payload = makeExcelRangePayload("P&L (in thousands)", INCOME_ROWS_PREVIEW);
    const [t] = detectFinancialTables(payload);
    expect(t!.unit_scale_factor).toBe(1_000);
    expect(t!.unit_scale_source_text).toBe("P&L (in thousands)");
  });

  it("sets unit_scale_factor=1_000_000 when sheet title contains '(in millions)'", () => {
    const payload = makeExcelRangePayload("Financial Summary (in millions)", INCOME_ROWS_PREVIEW);
    const [t] = detectFinancialTables(payload);
    expect(t!.unit_scale_factor).toBe(1_000_000);
  });

  it("sets unit_scale_factor=1000 when top-row col_A label is '$000s'", () => {
    // Scale marker in first data row's label cell — common in institutional workbooks
    const rows: Record<string, unknown>[] = [
      { col_A: "$000s",      col_C: null, col_D: null },
      { col_A: null,         col_C: 2023, col_D: 2024 },
      { col_A: "Revenue",    col_C: 5,    col_D: 7 },
      { col_A: "Net Income", col_C: 1,    col_D: 2 },
    ];
    const [t] = detectFinancialTables(makeExcelRangePayload("Income Statement", rows));
    expect(t!.unit_scale_factor).toBe(1_000);
    expect(t!.unit_scale_source_text).toBe("$000s");
  });

  it("unit_scale_factor is 1 (or absent) and source_text is null when no marker present", () => {
    const payload = makeExcelRangePayload("P&L", INCOME_ROWS_PREVIEW);
    const [t] = detectFinancialTables(payload);
    expect(t!.unit_scale_factor ?? 1).toBe(1);
    expect(t!.unit_scale_source_text ?? null).toBeNull();
  });
});

// ─── detectFinancialTables — unit_scale_factor field (excel_sheet) ─────────────

describe("detectFinancialTables — unit_scale_factor (excel_sheet)", () => {
  it("sets unit_scale_factor=1000 when sheet title contains '(in thousands)'", () => {
    const headers = ["Metric", "FY2023", "FY2024"];
    const rows = [
      { Metric: "Revenue",    FY2023: 5, FY2024: 7 },
      { Metric: "Net Income", FY2023: 1, FY2024: 2 },
    ];
    const payload = makeExcelSheetPayload("Income Statement (in thousands)", headers, rows);
    const [t] = detectFinancialTables(payload);
    expect(t!.unit_scale_factor).toBe(1_000);
  });

  it("sets unit_scale_factor=1000 when a column header contains '$000s'", () => {
    // Scale marker embedded in column header label — e.g. "FY2023 $000s"
    const headers = ["Metric", "FY2023 $000s", "FY2024 $000s"];
    const rows = [
      { Metric: "Revenue",    "FY2023 $000s": 5, "FY2024 $000s": 7 },
      { Metric: "Net Income", "FY2023 $000s": 1, "FY2024 $000s": 2 },
    ];
    const payload = makeExcelSheetPayload("P&L", headers, rows);
    const [t] = detectFinancialTables(payload);
    expect(t!.unit_scale_factor).toBe(1_000);
  });

  it("unit_scale_factor is 1 (or absent) when no scale marker in title or headers", () => {
    const headers = ["Metric", "FY2023", "FY2024"];
    const rows = [
      { Metric: "Revenue",    FY2023: 5_000_000, FY2024: 7_000_000 },
      { Metric: "Net Income", FY2023:   500_000, FY2024:   900_000 },
    ];
    const payload = makeExcelSheetPayload("P&L", headers, rows);
    const [t] = detectFinancialTables(payload);
    expect(t!.unit_scale_factor ?? 1).toBe(1);
    expect(t!.unit_scale_source_text ?? null).toBeNull();
  });
});

// ─── isStructuralColumnHeader ─────────────────────────────────────────────────

describe("isStructuralColumnHeader — pure function", () => {
  it("identifies col_A … col_Z as structural", () => {
    for (const h of ["col_A", "col_B", "col_C", "col_M", "col_Z"]) {
      expect(isStructuralColumnHeader(h)).toBe(true);
    }
  });

  it("identifies multi-letter col_ placeholders as structural", () => {
    for (const h of ["col_AA", "col_BC", "col_AZ"]) {
      expect(isStructuralColumnHeader(h)).toBe(true);
    }
  });

  it("identifies $000 denomination markers as structural", () => {
    for (const h of ["$000", "$000s", "000s", "000", "£000s", "€000"]) {
      expect(isStructuralColumnHeader(h)).toBe(true);
    }
  });

  it("identifies parenthesised denomination markers as structural", () => {
    for (const h of ["($000)", "(000s)", "(£000s)"]) {
      expect(isStructuralColumnHeader(h)).toBe(true);
    }
  });

  it("identifies scale abbreviations ($M $MM $K $B) as structural", () => {
    for (const h of ["$M", "$MM", "€M", "£M", "$K", "$B"]) {
      expect(isStructuralColumnHeader(h)).toBe(true);
    }
  });

  it("identifies empty/whitespace headers as structural", () => {
    expect(isStructuralColumnHeader("")).toBe(true);
    expect(isStructuralColumnHeader("   ")).toBe(true);
  });

  it("does NOT suppress year strings", () => {
    for (const h of ["2024", "2025", "2023", "2026E", "FY2025"]) {
      expect(isStructuralColumnHeader(h)).toBe(false);
    }
  });

  it("does NOT suppress period labels (Q1, TTM, months)", () => {
    for (const h of ["Q1 2024", "TTM", "January", "Sep", "1Q25"]) {
      expect(isStructuralColumnHeader(h)).toBe(false);
    }
  });

  it("does NOT suppress scenario labels", () => {
    for (const h of ["Base", "Upside", "Downside", "Bear Case", "Bull Case"]) {
      expect(isStructuralColumnHeader(h)).toBe(false);
    }
  });

  it("does NOT suppress ordinal year labels", () => {
    for (const h of ["Year 1", "Year 2", "Year 10", "Yr 3"]) {
      expect(isStructuralColumnHeader(h)).toBe(false);
    }
  });
});

// ─── Structural column noise suppression — StackFactor patterns ───────────────

describe("detectFinancialTables — structural col_X noise suppression (StackFactor / Fix 12)", () => {
  it("returns [] for excel_range salary schedule with col_X column placeholders (Fallback 2 guard)", () => {
    // No period header row — only raw numeric rows with col_C/col_D/col_E keys.
    // Fallback 2 would assign period labels col_C, col_D, col_E — all structural.
    const salaryRows: Record<string, unknown>[] = [
      { col_A: "Employee 1",   col_C: 85_000, col_D: 87_500, col_E: 90_000 },
      { col_A: "Employee 2",   col_C: 70_000, col_D: 72_000, col_E: 74_000 },
      { col_A: "Total Salary", col_C: 155_000, col_D: 159_500, col_E: 164_000 },
    ];
    const payload = makeExcelRangePayload("Salary Schedule", salaryRows);
    expect(detectFinancialTables(payload)).toHaveLength(0);
  });

  it("returns [] for excel_range cap-table allocation sheet with col_X columns", () => {
    const capRows: Record<string, unknown>[] = [
      { col_A: "Founder A",   col_C: 5_000_000, col_D: 4_800_000, col_E: 4_600_000 },
      { col_A: "Investor B",  col_C: 2_000_000, col_D: 2_000_000, col_E: 2_000_000 },
      { col_A: "Option Pool", col_C: 1_000_000, col_D: 1_200_000, col_E: 1_400_000 },
    ];
    const payload = makeExcelRangePayload("Cap Table", capRows);
    expect(detectFinancialTables(payload)).toHaveLength(0);
  });

  it("does NOT suppress a valid financial table that correctly uses year-integer headers", () => {
    // Year-header row: all data columns are year integers → Step 1 fires (no Fallback 2).
    const validRows: Record<string, unknown>[] = [
      { col_A: null,       col_C: 2024,       col_D: 2025 },
      { col_A: "Revenue",  col_C: 1_000_000,  col_D: 2_000_000 },
      { col_A: "EBITDA",   col_C:   50_000,   col_D:  150_000 },
    ];
    const payload = makeExcelRangePayload("P&L", validRows);
    const tables = detectFinancialTables(payload);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.column_headers).toContain("2024");
    expect(tables[0]!.column_headers).toContain("2025");
  });

  it("returns [] for excel_sheet with only $000 denomination headers (no period columns)", () => {
    // DPU produces headers: ["Label", "$000", "$000", "$000"] — all value cols structural.
    const headers = ["Label", "$000", "$000s", "000s"];
    const rows: Record<string, unknown>[] = [
      { Label: "Revenue",   "$000": 1_200, "$000s": 1_500, "000s": 1_800 },
      { Label: "EBITDA",    "$000":   100, "$000s":   150, "000s":   200 },
    ];
    const payload = makeExcelSheetPayload("Denomination Sheet", headers, rows);
    expect(detectFinancialTables(payload)).toHaveLength(0);
  });

  it("returns a table for excel_sheet when some structural headers are mixed with valid period headers", () => {
    // Headers: ["Metric", "$000", "2024", "2025"] — $000 is filtered, 2024/2025 survive.
    const headers = ["Metric", "$000", "2024", "2025"];
    const rows: Record<string, unknown>[] = [
      { Metric: "Revenue",   "$000": 1_200_000, "2024": 1_200_000, "2025": 1_500_000 },
      { Metric: "Net Income","$000":   100_000, "2024":   100_000, "2025":   150_000 },
    ];
    const payload = makeExcelSheetPayload("P&L ($000)", headers, rows);
    const tables = detectFinancialTables(payload);
    expect(tables).toHaveLength(1);
    // $000 column filtered; only 2024 and 2025 survive
    expect(tables[0]!.column_headers).not.toContain("$000");
    expect(tables[0]!.column_headers).toContain("2024");
    expect(tables[0]!.column_headers).toContain("2025");
  });

  it("unit scale detection still works when $000 header is in headers but filtered from valueCols", () => {
    // The $000 header feeds unit-scale detection via scaleScanTexts=[sheetTitle, ...headers].
    // Even after filtering from column_headers, the scale multiplier should apply.
    const headers = ["Metric", "$000", "2024", "2025"];
    const rows: Record<string, unknown>[] = [
      { Metric: "Revenue",    "$000": 5, "2024": 5, "2025": 7 },
      { Metric: "Net Income", "$000": 1, "2024": 1, "2025": 2 },
    ];
    const payload = makeExcelSheetPayload("P&L in $000s", headers, rows);
    const tables = detectFinancialTables(payload);
    // $000 in header name should trigger 1000x scale factor
    expect(tables).toHaveLength(1);
    expect(tables[0]!.unit_scale_factor).toBe(1_000);
  });
});
