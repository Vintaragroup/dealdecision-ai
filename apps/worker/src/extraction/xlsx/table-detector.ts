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
import { parsePeriodLabel } from "./period-parser.js";
import type { WorkbookGraphPayload } from "./dependency-graph.js";

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
  /**
   * Detected unit scale multiplier for all numeric cells in this table.
   *
   * Default: 1 (no scaling — raw cell values are absolute).
   * 1_000   = workbook states "in thousands" / "$000s"
   * 1_000_000 = workbook states "in millions" / "$MM"
   *
   * Applied by parseFinancialTable() before emitting TypedMetric values.
   * When absent (undefined), parseFinancialTable() treats it as 1.
   */
  unit_scale_factor?: number;
  /**
   * The source text snippet that triggered the unit scale detection,
   * e.g. "in thousands" or "$000s". Null when no scaling was detected.
   * Preserved for downstream traceability (stamped in typing_reason).
   */
  unit_scale_source_text?: string | null;
  /**
   * Optional per-cell Excel formula strings, keyed by "rowIdx:colIdx" (both
   * 0-based within the cell_matrix dimensions).
   *
   * Populated by fromExcelSheet() when the source DPU payload carries a
   * formula_grid (present for workbooks extracted via excel.ts ≥ formula-
   * traceability version). Absent for excel_range payloads and pre-
   * formula-traceability extractions.
   *
   * Used by parseFinancialTable() to set value_kind / formula on TypedMetric.
   */
  formula_map?: Record<string, string>;

  /**
   * Optional workbook-level cell value index for cross-sheet reference resolution.
   *
   * Maps lookup keys ("SheetName!CellAddr") to raw cell values extracted from
   * the workbook at processing time (built in excel.ts while all sheets are
   * in memory). Populated by fromExcelSheet() when the DPU page payload carries
   * a `cross_sheet_resolved` field in its `structured` block.
   *
   * Used by parseFinancialTable() to resolve direct single-cell cross-tab refs
   * (e.g. =Inputs!C5) into concrete values on TypedMetric.
   *
   * Keys format: "SheetName!CELLADDR"  e.g. "Inputs!C5", "Revenue Build!D12"
   * Values: raw numeric or string cell values; absent keys → unresolvable.
   *
   * Absent when the DPU payload did not include cross-sheet resolution data
   * (pre-2D extractions, excel_range payloads, or non-workbook sources).
   */
  cross_sheet_value_index?: Record<string, unknown>;

  /**
   * Workbook dependency graph summary from Phase 2E analysis.
   *
   * Contains:
   *   - `circular_cells`: cell keys ("SheetName!CellAddr") involved in circular
   *     reference chains detected in the workbook.
   *   - `cell_depths`: depth of each formula cell from its literal leaf inputs.
   *
   * Used by parseFinancialTable() to populate `formula_dependencies`,
   * `dependency_depth`, and `circular_reference_detected` on TypedMetric.
   *
   * Absent when the DPU payload did not include workbook graph data
   * (pre-2E extractions, excel_range payloads, or non-workbook sources).
   */
  workbook_graph?: WorkbookGraphPayload;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MIN_ROW_HEADERS = 2;
const MIN_COL_HEADERS = 2;

// ─── Unit scale detection ─────────────────────────────────────────────────────

/**
 * Ordered scale patterns. Billions before millions before thousands to prevent
 * partial matches (e.g. "millions" must not match a "billions" label).
 *
 * Covers the most common institutional workbook denominations:
 *   - "in thousands" / "(in thousands)" / "in US thousands"
 *   - "$000s" / "£000s" / "€000s" / "(000s)"
 *   - "in millions" / "(in millions)" / "$MM" / "£MM" / "€MM"
 *   - "in billions"
 */
const UNIT_SCALE_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly factor: number }> = [
  // Billions
  {
    pattern: /\bin\s+(?:us\s+)?billions?\b|\(in\s+billions?\)/i,
    factor: 1_000_000_000,
  },
  // Millions — "in millions", "(in millions)", "$MM", "£MM", "€MM", "(£MM)"
  {
    pattern: /\bin\s+(?:us\s+)?millions?\b|\(in\s+millions?\)|[$€£¥₹]\s*mm\b|\([$€£¥₹]?\s*mm\)/i,
    factor: 1_000_000,
  },
  // Thousands — "in thousands", "(in thousands)", "$000s", "£000s", "€000s", "(000s)", "(£000s)"
  {
    pattern: /\bin\s+(?:us\s+)?thousands?\b|\(in\s+thousands?\)|[$€£¥₹]\s*000s?\b|\([$€£¥₹]?\s*000s?\)/i,
    factor: 1_000,
  },
];

/**
 * Scan an array of text strings for workbook/table unit scaling markers.
 *
 * Returns { factor: 1, source_text: null } when no scaling marker is found
 * (i.e. raw cell values should be used as-is).
 *
 * First match across texts × patterns wins. Patterns are checked largest-first
 * to prevent "thousands" from matching a "billions" header.
 *
 * @param texts  Candidate strings: sheet title, top-row labels, header cells.
 * @returns      Scale multiplier and matched source text.
 */
export function detectUnitScale(texts: string[]): { factor: number; source_text: string | null } {
  for (const text of texts) {
    const t = text.trim();
    if (!t) continue;
    for (const { pattern, factor } of UNIT_SCALE_PATTERNS) {
      if (pattern.test(t)) {
        return { factor, source_text: t };
      }
    }
  }
  return { factor: 1, source_text: null };
}

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

  // Fallback 1b: mixed period-string + year-integer header row.
  // Handles patterns like "TTM, 2023, 2024" where at least one column is a
  // non-integer period string (TTM, Q1 2024, etc.) and the rest are year integers.
  // This fires when Step 1 (all-year-integers) and Fallback 1 (all-strings) both fail.
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
      // Every column must be a year integer OR a recognizable period string.
      const allPeriods = nonNull.every(([, v]) => {
        if (isYear(v)) return true;
        return parsePeriodLabel(String(v)).period_type !== "unknown";
      });
      // At least one column must be a non-year-integer (otherwise Step 1 fires).
      const hasNonYearPeriod = nonNull.some(([, v]) => !isYear(v));
      if (allPeriods && hasNonYearPeriod) {
        headerRowIdx = i;
        periodKeys   = nonNull.map(([k]) => k);
        // Normalize year-integers to strings; period-strings to canonical form.
        periodLabels = nonNull.map(([, v]) => {
          if (isYear(v)) return String(Math.round(Number(v)));
          return parsePeriodLabel(String(v)).normalized || String(v);
        });
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

  // ── Step 2: Detect unit scaling ────────────────────────────────────────
  // Scan sheet title + first 5 rows (col_A prose + any string-valued data
  // cells) for denominator markers like "in thousands" or "$000s".
  const scaleScanTexts: string[] = [sheetTitle];
  for (let i = 0; i < Math.min(5, rowsPreview.length); i++) {
    const row = rowsPreview[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r["col_A"] === "string") scaleScanTexts.push(r["col_A"]);
    // String-valued data cells in top rows may contain column-level markers
    for (const v of Object.values(r)) {
      if (typeof v === "string" && v.trim()) scaleScanTexts.push(v);
    }
  }
  // Also scan the detected period-header row when it falls beyond row 4.
  // Workbooks with multi-row title sections can push the header row to index 5+,
  // causing denominator markers like "($000)" in the header to be missed above.
  if (headerRowIdx >= 5 && headerRowIdx < rowsPreview.length) {
    const hRow = rowsPreview[headerRowIdx];
    if (hRow && typeof hRow === "object") {
      for (const v of Object.values(hRow as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) scaleScanTexts.push(v);
      }
    }
  }
  const { factor: unit_scale_factor, source_text: unit_scale_source_text } =
    detectUnitScale(scaleScanTexts);

  // ── Step 3: Extract label rows and cell matrix ─────────────────────────
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

  // ── Step 4: Classify the table ─────────────────────────────────────────
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
    unit_scale_factor,
    unit_scale_source_text,
  };
}

// ─── excel_sheet (normalization format) handler ───────────────────────────────

// ─── grid_preview → rows bridge ──────────────────────────────────────────────

/**
 * Convert a grid_preview cells array into a rows array compatible with fromExcelSheet.
 *
 * grid_preview format (from structured_native_v1 extractor):
 *   { cells: [{ a: "A1", t: "s"|"n", v: string|number, w?: string }, ...] }
 *
 * Each cell's address is parsed to (col_letter, row_number). Cells are grouped
 * by row and mapped to header keys using column letter → header index mapping.
 *
 * Column mapping: header[0] ("col_A") → column A, header[1] → column B or
 * next seen column, etc. Missing columns are auto-skipped.
 */
function buildRowsFromGridPreview(gridPreview: unknown, headers: string[]): unknown[] {
  if (!gridPreview || typeof gridPreview !== "object") return [];
  const gp = gridPreview as Record<string, unknown>;
  const cells = Array.isArray(gp["cells"]) ? gp["cells"] as unknown[] : [];
  if (cells.length === 0 || headers.length === 0) return [];

  // Parse cells into a row→col map
  const rowMap = new Map<number, Map<string, unknown>>();
  const seenCols = new Set<string>();
  for (const cell of cells) {
    if (!cell || typeof cell !== "object") continue;
    const c = cell as Record<string, unknown>;
    const addr = typeof c["a"] === "string" ? c["a"] : null;
    if (!addr) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) continue;
    const colLetter = m[1]!;
    const rowNum = parseInt(m[2]!, 10);
    seenCols.add(colLetter);
    let row = rowMap.get(rowNum);
    if (!row) { row = new Map(); rowMap.set(rowNum, row); }
    row.set(colLetter, c["t"] === "n" ? c["v"] : (typeof c["v"] === "string" ? c["v"] : null));
  }

  // Build column letter → header index mapping.
  // headers[0] is typically "col_A" → column "A". Remaining headers map to
  // remaining columns in alphabetical order, skipping any that weren't seen.
  const sortedCols = Array.from(seenCols).sort();
  const colToHeader = new Map<string, string>();
  // First header always maps to the first column letter seen
  if (sortedCols.length > 0 && headers.length > 0) {
    colToHeader.set(sortedCols[0]!, headers[0]!);
    let hi = 1;
    for (let ci = 1; ci < sortedCols.length && hi < headers.length; ci++, hi++) {
      colToHeader.set(sortedCols[ci]!, headers[hi]!);
    }
  }

  // Build rows as objects keyed by header names (same as normalization.ts output)
  const rowNums = Array.from(rowMap.keys()).sort((a, b) => a - b);
  const result: unknown[] = [];
  for (const rowNum of rowNums) {
    const cellMap = rowMap.get(rowNum)!;
    const obj: Record<string, unknown> = {};
    for (const [colLetter, value] of cellMap) {
      const header = colToHeader.get(colLetter);
      if (header) obj[header] = value;
    }
    if (Object.keys(obj).length > 0) result.push(obj);
  }
  return result;
}

// ─── excel_sheet handler ─────────────────────────────────────────────────────

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

  const sheetTitle = typeof s["sheet_title"] === "string" ? s["sheet_title"]
    : typeof s["sheet_name"] === "string" ? s["sheet_name"] : "unknown";
  const headers: string[] = Array.isArray(s["headers"]) ? (s["headers"] as string[]).filter((h) => typeof h === "string") : [];
  let rows: unknown[] = Array.isArray(s["rows"]) ? (s["rows"] as unknown[]) : [];

  // Fallback: build rows from grid_preview cells when rows is absent.
  // grid_preview is a sparse cells array: [{a:"A1",t:"s",v:"Revenue"},{a:"C1",t:"n",v:1000}, ...]
  if (rows.length === 0 && headers.length > 0) {
    rows = buildRowsFromGridPreview(s["grid_preview"], headers);
  }

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

  // Read formula_grid from the DPU payload when available.
  // Keyed by "rawRowIndex:headerName" (0-based within rows[]).
  const rawFormulaGrid: Record<string, string> | null =
    typeof s["formula_grid"] === "object" && s["formula_grid"] !== null && !Array.isArray(s["formula_grid"])
      ? (s["formula_grid"] as Record<string, string>)
      : null;
  // formula_map will be keyed by "matrixRowIdx:colIdx" (0-based within cell_matrix).
  const formulaMap: Record<string, string> = {};

  // Read cross_sheet_resolved from the DPU payload when available.
  // Keys: "SheetName!CellAddr" → raw cell value (number | string | null).
  // Built by excel.ts at workbook extraction time while all sheets are in memory.
  const rawCrossSheetResolved: Record<string, unknown> | null =
    typeof s["cross_sheet_resolved"] === "object" && s["cross_sheet_resolved"] !== null && !Array.isArray(s["cross_sheet_resolved"])
      ? (s["cross_sheet_resolved"] as Record<string, unknown>)
      : null;

  // Read workbook_graph from the DPU payload when available.
  // Built by excel.ts after all sheets are processed; contains circular_cells
  // and cell_depths for dependency graph analysis (Phase 2E).
  const rawWorkbookGraph: WorkbookGraphPayload | null = (() => {
    const g = s["workbook_graph"];
    if (!g || typeof g !== "object" || Array.isArray(g)) return null;
    const gObj = g as Record<string, unknown>;
    if (!Array.isArray(gObj["circular_cells"])) return null;
    if (typeof gObj["cell_depths"] !== "object" || gObj["cell_depths"] === null) return null;
    return g as WorkbookGraphPayload;
  })();

  for (let rawRowIdx = 0; rawRowIdx < rows.length; rawRowIdx++) {
    const row = rows[rawRowIdx];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label = typeof r[labelCol] === "string" ? (r[labelCol] as string).trim() : "";
    if (!label) continue;

    const cells = valueCols.map((col) => toNum(r[col]));
    if (cells.every((c) => c === null)) continue;

    // Capture formula references before pushing so matrixRowIdx = rowHeaders.length.
    if (rawFormulaGrid) {
      const matrixRowIdx = rowHeaders.length;
      for (let colIdx = 0; colIdx < valueCols.length; colIdx++) {
        const colName = valueCols[colIdx]!;
        const f = rawFormulaGrid[`${rawRowIdx}:${colName}`];
        if (f) formulaMap[`${matrixRowIdx}:${colIdx}`] = f;
      }
    }

    rowHeaders.push(label);
    matrix.push(cells);
  }

  if (rowHeaders.length < MIN_ROW_HEADERS) return null;

  // ── Step 3: Detect unit scaling ───────────────────────────────────────
  // Scan sheet title + column headers for denominator markers.
  const scaleScanTexts: string[] = [sheetTitle, ...headers];
  const { factor: unit_scale_factor, source_text: unit_scale_source_text } =
    detectUnitScale(scaleScanTexts);

  // ── Step 4: Classify ──────────────────────────────────────────────────
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
    unit_scale_factor,
    unit_scale_source_text,
    ...(Object.keys(formulaMap).length > 0 ? { formula_map: formulaMap } : {}),
    ...(rawCrossSheetResolved && Object.keys(rawCrossSheetResolved).length > 0
      ? { cross_sheet_value_index: rawCrossSheetResolved }
      : {}),
    ...(rawWorkbookGraph ? { workbook_graph: rawWorkbookGraph } : {}),
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
