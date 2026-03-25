/**
 * extraction/xlsx/cross-tab-refs.ts
 *
 * Deterministic cross-tab (cross-worksheet) formula reference detection.
 *
 * Parses an Excel formula string and extracts the names of any worksheets
 * referenced by that formula using SheetName! notation.
 *
 * This is a traceability utility only — it parses formula syntax using regex.
 * It does NOT evaluate formulas, resolve cell values, detect circular
 * references, or trace dependency chains across the workbook.
 *
 * Design rules:
 *   - Pure function: same inputs → same outputs.
 *   - Never throws.
 *   - Returns a sorted, deduplicated array of sheet names.
 *   - Handles both quoted ('Sheet Name'!A1) and unquoted (Sheet1!A1) formats.
 *   - Works with or without a leading "=" prefix (xlsx.js omits it in cell.f).
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract all worksheet names referenced by a formula string.
 *
 * Supports:
 *   - Unquoted names:  `Inputs!C5`, `Sheet1!A1`
 *   - Quoted names:    `'Revenue Build'!D12`, `'P&L 2024'!A1:B10`
 *   - Functions:       `SUM(Model!C3:C17)`, `IF(Assumptions!B2>0,A1,0)`
 *   - Multiple refs:   `Sheet1!A1+Sheet2!B2`
 *   - Mixed:           `SUM(C3:C5)+Inputs!D12` (C3:C5 is same-sheet, Inputs is cross-tab)
 *
 * Does NOT support:
 *   - External workbook references: `[Book2]Sheet1!A1`
 *   - Named ranges that resolve cross-tab (requires workbook context)
 *
 * @param formula  Raw formula string (with or without leading "=").
 * @returns        Sorted array of unique sheet names. Empty when formula
 *                 has no cross-tab references or is empty.
 */
export function extractCrossSheetRefs(formula: string): string[] {
  if (!formula || typeof formula !== "string") return [];

  const refs = new Set<string>();

  // ── Phase 1: Quoted sheet names ─────────────────────────────────────────
  // Pattern: 'Any Sheet Name'!
  // Quoted names can contain spaces, hyphens, ampersands, and most special
  // characters. The only character they cannot contain is a single-quote.
  const quotedRe = /'([^']+)'!/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(formula)) !== null) {
    const name = m[1]!.trim();
    if (name) refs.add(name);
  }

  // ── Phase 2: Unquoted sheet names ───────────────────────────────────────
  // Strip all quoted-reference syntax first to prevent partial matches.
  // e.g. `'Revenue Build'!D12` → strip so "Build" is not accidentally matched
  // as an unquoted sheet reference by the next regex pass.
  const stripped = formula.replace(/'[^']*'!/g, "");

  // Unquoted Excel sheet names must start with a letter or underscore, followed
  // by letters, digits, underscores, or dots; and must be immediately followed
  // by "!" (the sheet reference separator). Names requiring quoting (spaces,
  // hyphens, etc.) will have been handled in Phase 1 above.
  const unquotedRe = /\b([A-Za-z_][A-Za-z0-9_.]*)!/g;
  while ((m = unquotedRe.exec(stripped)) !== null) {
    refs.add(m[1]!);
  }

  // Return sorted for deterministic, stable output.
  return [...refs].sort();
}

/**
 * Returns true when a formula string contains at least one cross-tab reference.
 *
 * Convenience wrapper around extractCrossSheetRefs().
 *
 * @param formula  Raw formula string (with or without leading "=").
 */
export function hasCrossSheetRefs(formula: string): boolean {
  return extractCrossSheetRefs(formula).length > 0;
}
