/**
 * extraction/xlsx/cross-tab-resolver.ts
 *
 * Lightweight cross-tab value resolution for Excel financial models.
 *
 * Resolves direct single-cell cross-sheet references from formula strings:
 *   =Inputs!C5             →  { sheet: "Inputs", cell: "C5", value: 12.5 }
 *   ='Revenue Build'!D12   →  { sheet: "Revenue Build", cell: "D12", value: 450000 }
 *   =Model!B7              →  { sheet: "Model", cell: "B7", value: null }  ← not in index
 *
 * Scope of this phase:
 *   ✓  Direct single-cell references (quoted or unquoted sheet name)
 *   ✓  Absolute-ref notation ($C$5, $D$12 — $ stripped before lookup)
 *   ✗  Range references: SUM(Model!C3:C10) — detected but NOT resolved
 *   ✗  Named ranges
 *   ✗  External workbook refs: [Book2]Sheet1!A1
 *   ✗  Nested/indirect resolution
 *
 * Design rules:
 *   - Pure functions: same inputs → same outputs.
 *   - Never throws.
 *   - Fails open: unresolvable refs produce { value: null }.
 *   - Sorted, deterministic output order.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A parsed direct single-cell cross-sheet reference extracted from a formula.
 */
export interface DirectCrossSheetRef {
  /** Worksheet name, exact case (single-quotes stripped). */
  sheet: string;
  /** Cell address, uppercase, $ stripped. e.g. "C5", "D12". */
  cell: string;
  /**
   * Normalized lookup key used to query the workbook cell index.
   * Format: "SheetName!CELLADDR" (e.g. "Revenue Build!D12", "Inputs!C5").
   */
  key: string;
}

/**
 * A resolved cross-sheet cell value.
 *
 * Present in `FinancialFactV1.resolved_cross_sheet_values` when the source
 * formula contained direct single-cell cross-tab references and the workbook
 * cell index was available at extraction time.
 */
export interface ResolvedCrossSheetValue {
  /** Worksheet name. */
  sheet: string;
  /** Cell address, uppercase ($ stripped). */
  cell: string;
  /**
   * Raw cell value when found in the workbook index.
   * null when the ref could not be resolved (sheet not found, cell empty,
   * or workbook index was not available).
   *
   * Only numeric and string values are preserved.
   * Booleans, errors, and other types are returned as null.
   */
  value: number | string | null;
}

// ─── Cell address normalizer ──────────────────────────────────────────────────

/** Uppercase the column and join: ("c", "5") → "C5" */
function normalizeCell(col: string, row: string): string {
  return `${col.toUpperCase()}${row}`;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse direct single-cell cross-sheet references from an Excel formula.
 *
 * Handles:
 *   - Quoted sheet names:    ='Revenue Build'!D12, ='P&L 2024'!A2
 *   - Unquoted sheet names:  =Inputs!C5, =Model!B7
 *   - Absolute references:   =$Inputs!$C$5 ($ stripped)
 *   - Multiple direct refs:  =Inputs!B3+Inputs!C4
 *
 * Excludes:
 *   - Range references:      SUM(Inputs!C3:C17) — "C3" is followed by ":", excluded
 *   - External workbook:     [Book2]Sheet1!A1 — not matched by current patterns
 *
 * @param formula  Raw formula string (with or without leading "=").
 * @returns        Parsed direct cross-sheet refs. Deduped by key. Empty when none.
 */
export function parseDirectCrossSheetRefs(formula: string): DirectCrossSheetRef[] {
  if (!formula || typeof formula !== "string") return [];

  const results: DirectCrossSheetRef[] = [];
  const seen = new Set<string>();

  const add = (sheet: string, col: string, row: string): void => {
    const cell = normalizeCell(col, row);
    const key = `${sheet}!${cell}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ sheet, cell, key });
    }
  };

  // ── Phase 1: Quoted sheet names ─────────────────────────────────────────
  // Pattern: 'Sheet Name'!$?COL$?ROW  — not followed by ":" (range separator).
  // Captures:
  //   m[1] = sheet name (no quotes)
  //   m[2] = column letters (1-3)
  //   m[3] = row number digits
  const quotedRe = /'([^']+)'!\$?([A-Za-z]{1,3})\$?(\d+)(?!:)/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(formula)) !== null) {
    add(m[1]!, m[2]!, m[3]!);
  }

  // ── Phase 2: Unquoted sheet names ───────────────────────────────────────
  // Strip quoted patterns first to prevent partial re-matching of words inside
  // quoted sheet names (e.g. "Build" inside 'Revenue Build'!D12).
  const stripped = formula.replace(/'[^']*'!\$?[A-Za-z]{1,3}\$?\d+/g, "");
  // Pattern: SheetName!$?COL$?ROW — not followed by ":" (range separator).
  // Sheet name must start with letter or underscore (valid Excel identifier start).
  const unquotedRe = /\b([A-Za-z_][A-Za-z0-9_.]*)!\$?([A-Za-z]{1,3})\$?(\d+)(?!:)/g;
  while ((m = unquotedRe.exec(stripped)) !== null) {
    add(m[1]!, m[2]!, m[3]!);
  }

  return results;
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve direct single-cell cross-sheet references against a workbook cell index.
 *
 * The `index` maps lookup keys (`"SheetName!CellAddr"`) to raw cell values.
 * This is built at workbook extraction time (in `excel.ts`) while all sheets
 * are in memory, and carried in the DPU page payload as `cross_sheet_resolved`.
 *
 * Fail-open: refs not found in the index produce `{ value: null }`.
 * The result array always has one entry per unique parsed direct ref.
 *
 * Only numeric and string values are preserved; other types (boolean, Date,
 * error codes) are treated as null for financial display purposes.
 *
 * @param formula  Raw formula string (with or without leading "=").
 * @param index    Workbook cell index: "SheetName!CellAddr" → raw value.
 * @returns        Resolved values. Empty when formula has no direct cross-tab refs.
 */
export function resolveDirectCrossSheetRefs(
  formula: string,
  index: Record<string, unknown>,
): ResolvedCrossSheetValue[] {
  const refs = parseDirectCrossSheetRefs(formula);
  if (refs.length === 0) return [];

  return refs.map(({ sheet, cell, key }) => {
    const raw = index[key];
    let value: number | string | null = null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      value = raw;
    } else if (typeof raw === "string" && raw.trim() !== "") {
      value = raw.trim();
    }
    return { sheet, cell, value };
  });
}
