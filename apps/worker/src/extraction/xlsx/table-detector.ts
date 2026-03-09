/**
 * extraction/xlsx/table-detector.ts
 *
 * Detects structured financial tables from XLSX DPU payload objects.
 *
 * The investor-insights pipeline receives XLSX data from the vision worker
 * in two page_type formats:
 *
 *   "excel_range"  — structured rows_preview: Array<{col_A, col_C, col_D, ...}>
 *                    where col_A = row label, col_C+ = period values.
 *                    Used by: financial-statement-parser, balance-sheet-parser, etc.
 *
 *   "excel_sheet"  — normalization.ts format: {rows, headers, tables}
 *                    Used by: normalization.ts, use-of-funds-timeseries-v1.
 *
 * This module wraps both formats into a single `FinancialTable` structure so
 * that financial-model-interpreter.ts can operate on either.
 *
 * Design rules:
 *   - Zero side effects. Never throws — returns [] on any failure.
 *   - Returns at most one table per DPU page (the primary financial grid).
 *   - Minimum viable table: >= 2 row headers + >= 2 column headers.
 */

import { classifySheet, type SheetKind } from "./sheet-classifier.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A structured financial table with typed row/column headers and a numeric
 * cell matrix.
 *
 * Row index `i` and column index `j` pair:
 *   row_headers[i]   = row label (e.g. "Revenue")
 *   column_headers[j] = period/scenario label (e.g. "2024", "Base", "2025E")
 *   cell_matrix[i][j] = numeric value or null when missing / non-numeric
 */
export interface FinancialTable {
  /** Worksheet / tab name (from DPU payload sheet_title or "unknown"). */
  sheet_name: string;
  /** Classified type of this table. */
  table_kind: SheetKind;
  /** Row label values (col A for excel_range; row labels for excel_sheet). */
  row_headers: string[];
  /**
   * Column header labels — period labels, scenario labels, or other column
   * names. For excel_range pages these are typically year integers as strings.
   */
  column_headers: string[];
  /**
   * [row][col] numeric matrix. null = missing or non-parseable cell.
   * Dimensions: cell_matrix.length === row_headers.length,
   *             cell_matrix[i].length === column_headers.length.
   */
  cell_matrix: (number | null)[][];
  /** Source page type ("excel_range" | "excel_sheet"). */
  source_page_type: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MIN_ROW_HEADERS = 2;
const MIN_COL_HEADERS = 2;

/** Loose string→number converter. Returns null on failure. */
function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    let s = v.trim().replace(/,/g, "");
    // Accounting parens: (1234) → -1234
    const neg = /^\(\s*(\d[\d.]*)\s*\)$/.exec(s);
    if (neg) return -parseFloat(neg[1]!);
    s = s.replace(/[$€£¥₹%]/g, "").trim();
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Returns true if the value looks like a year integer (2000..2100). */
function isYear(v: unknown): boolean {
  const n = toNum(v);
  return n !== null && Number.isInteger(n) && n >= 2000 && n <= 2100;
}

/** Returns true if the value looks like a projected-period header (e.g. "2025E", "FY2026E"). */
function isProjectedHeader(s: string): boolean {
  return /\b\d{4}[Ee]\b/.test(s) || /\bfy\s*\d{4}[Ee]\b/i.test(s);
}

// ─── excel_range (rows_preview) handler ──────────────────────────────────────

/**
 * Parses DPU `excel_range` pages.
 *
 * Payload shape:
 *   { structured: { sheet_title?: string, rows_preview: Array<{col_A, col_C?, col_D?, ...}> } }
 */
function fromExcelRange(payload: Record<string, unknown>): FinancialTable | null {
  const structured = payload["structured"];
  if (!structured || typeof structured !== "object") return null;
  const s = structured as Record<string, unknown>;

  const rowsPreview: unknown[] = Array.isArray(s["rows_preview"]) ? (s["rows_preview"] as unknown[]) : [];
  if (rowsPreview.length < MIN_ROW_HEADERS + 1) return null; // +1 for header row

  const sheetTitle = typeof s["sheet_title"] === "string" ? s["sheet_title"] : "unknown";

  // ── Step 1: Find the period-header row ─────────────────────────────────
  // It's the first row where all non-null data columns (col_C+) are year integers.
  let headerRowIdx = -1;
  let periodKeys: string[] = [];
  let periodLabels: string[] = [];

  for (let i = 0; i < rowsPreview.length; i++) {
    const row = rowsPreview[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const dataCols = Object.entries(r)
      .filter(([k]) => k !== "col_A" && k !== "col_B")
      .sort(([a], [b]) => a.localeCompare(b));
    const nonNull = dataCols.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
    if (nonNull.length < MIN_COL_HEADERS) continue;
    // All non-null values must be years
    if (nonNull.every(([, v]) => isYear(v))) {
      headerRowIdx = i;
      periodKeys   = nonNull.map(([k]) => k);
      periodLabels = nonNull.map(([, v]) => String(Math.round(Number(v))));
      break;
    }
  }

  // Fallback 1: string-value header row (scenario labels, text headers).
  // If a row has all non-null data columns as non-empty strings (not year integers),
  // treat them as column headers (e.g. "Base", "Upside", "Downside").
  if (headerRowIdx === -1) {
    for (let i = 0; i < rowsPreview.length; i++) {
      const row = rowsPreview[i];
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const dataCols = Object.entries(r)
        .filter(([k]) => k !== "col_A" && k !== "col_B")
        .sort(([a], [b]) => a.localeCompare(b));
      const nonNull = dataCols.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
      if (nonNull.length < MIN_COL_HEADERS) continue;
      // All non-null values must be strings (and NOT year integers)
      const allStrings = nonNull.every(([, v]) => typeof v === "string" && toNum(v) === null);
      if (allStrings) {
        headerRowIdx = i;
        periodKeys   = nonNull.map(([k]) => k);
        periodLabels = nonNull.map(([, v]) => String(v).trim());
        break;
      }
    }
  }

  // Fallback 2: no explicit header row — use column key names as labels.
  if (headerRowIdx === -1) {
    // Find the first row with >= MIN_COL_HEADERS numeric data cells
    for (let i = 0; i < rowsPreview.length; i++) {
      const row = rowsPreview[i];
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const dataCols = Object.entries(r)
        .filter(([k]) => k !== "col_A" && k !== "col_B")
        .sort(([a], [b]) => a.localeCompare(b));
      const numericCols = dataCols.filter(([, v]) => toNum(v) !== null);
      if (numericCols.length >= MIN_COL_HEADERS) {
        periodKeys   = numericCols.map(([k]) => k);
        periodLabels = periodKeys; // col_C, col_D, etc.
        break;
      }
    }
  }

  if (periodKeys.length < MIN_COL_HEADERS) return null;

  // ── Step 2: Extract label rows and cell matrix ─────────────────────────
  const rowHeaders: string[] = [];
  const matrix: (number | null)[][] = [];

  for (let i = 0; i < rowsPreview.length; i++) {
    if (i === headerRowIdx) continue; // skip the header row itself
    const row = rowsPreview[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label = typeof r["col_A"] === "string" ? r["col_A"].trim() : "";
    if (!label) continue;

    const cells = periodKeys.map((k) => toNum(r[k]));
    // Require at least one non-null cell; skip pure-label rows
    if (cells.every((c) => c === null)) continue;

    rowHeaders.push(label);
    matrix.push(cells);
  }

  if (rowHeaders.length < MIN_ROW_HEADERS) return null;

  // ── Step 3: Classify the table ─────────────────────────────────────────
  const classification = classifySheet({
    name: sheetTitle,
    column_headers: periodLabels,
    row_labels: rowHeaders,
  });

  return {
    sheet_name: sheetTitle,
    table_kind: classification.kind,
    row_headers: rowHeaders,
    column_headers: periodLabels,
    cell_matrix: matrix,
    source_page_type: "excel_range",
  };
}

// ─── excel_sheet (normalization format) handler ───────────────────────────────

/**
 * Parses DPU `excel_sheet` pages.
 *
 * Payload shape (from normalization.ts / vision worker structured output):
 *   { structured: { sheet_title?: string, headers: string[], rows: Array<Record<string,unknown>>, tables: any[] } }
 */
function fromExcelSheet(payload: Record<string, unknown>): FinancialTable | null {
  const structured = payload["structured"];
  if (!structured || typeof structured !== "object") return null;
  const s = structured as Record<string, unknown>;

  const sheetTitle = typeof s["sheet_title"] === "string" ? s["sheet_title"] : "unknown";
  const headers: string[] = Array.isArray(s["headers"]) ? (s["headers"] as string[]).filter((h) => typeof h === "string") : [];
  const rows: unknown[] = Array.isArray(s["rows"]) ? (s["rows"] as unknown[]) : [];

  // Also check for table-nested format used by vision worker
  const tables: unknown[] = Array.isArray(s["tables"]) ? (s["tables"] as unknown[]) : [];
  if (rows.length === 0 && tables.length === 0) return null;
  if (headers.length < MIN_COL_HEADERS + 1) return null; // +1 for label col

  // ── Step 1: Separate label column from value columns ──────────────────
  const labelCol = headers[0]!;
  const valueCols = headers.slice(1);
  if (valueCols.length < MIN_COL_HEADERS) return null;

  // ── Step 2: Build row headers + cell matrix ───────────────────────────
  const rowHeaders: string[] = [];
  const matrix: (number | null)[][] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label = typeof r[labelCol] === "string" ? (r[labelCol] as string).trim() : "";
    if (!label) continue;

    const cells = valueCols.map((col) => toNum(r[col]));
    if (cells.every((c) => c === null)) continue;

    rowHeaders.push(label);
    matrix.push(cells);
  }

  if (rowHeaders.length < MIN_ROW_HEADERS) return null;

  // ── Step 3: Classify ──────────────────────────────────────────────────
  const classification = classifySheet({
    name: sheetTitle,
    column_headers: valueCols,
    row_labels: rowHeaders,
  });

  return {
    sheet_name: sheetTitle,
    table_kind: classification.kind,
    row_headers: rowHeaders,
    column_headers: valueCols,
    cell_matrix: matrix,
    source_page_type: "excel_sheet",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect financial tables from a DPU page payload.
 *
 * Handles both excel_range and excel_sheet page types.
 * Returns at most one table per page (the primary financial grid).
 *
 * Returns [] when:
 *   - The payload is not an excel page.
 *   - The structured data does not contain a recognisable table.
 *   - The table has fewer than MIN_ROW_HEADERS rows or MIN_COL_HEADERS columns.
 */
export function detectFinancialTables(payload: unknown): FinancialTable[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const pageType = typeof p["page_type"] === "string" ? p["page_type"] : null;

  try {
    if (pageType === "excel_range") {
      const t = fromExcelRange(p);
      return t ? [t] : [];
    }
    if (pageType === "excel_sheet") {
      const t = fromExcelSheet(p);
      return t ? [t] : [];
    }
    // If no page_type, attempt both
    const rangeResult = fromExcelRange(p);
    if (rangeResult) return [rangeResult];
    const sheetResult = fromExcelSheet(p);
    if (sheetResult) return [sheetResult];
    return [];
  } catch {
    return [];
  }
}
