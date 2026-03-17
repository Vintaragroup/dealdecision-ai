/**
 * __tests__/financial-table-detector.test.ts
 *
 * Unit tests for apps/worker/src/extraction/xlsx/table-detector.ts
 */

import { describe, it, expect } from "vitest";
import { detectFinancialTables } from "../table-detector.js";

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
