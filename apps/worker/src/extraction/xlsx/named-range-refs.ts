/**
 * extraction/xlsx/named-range-refs.ts
 *
 * Deterministic named-range reference detection in Excel formula strings.
 *
 * Extracts candidate workbook-level named range identifiers from an Excel
 * formula, distinguishing them from:
 *   - Cross-sheet references (handled separately by cross-tab-refs.ts)
 *   - Built-in Excel function names (SUM, IF, ROUND, etc.)
 *   - Cell address references (A1, B12, XFD100, etc.)
 *   - String literal contents ("text in quotes")
 *
 * This is a traceability utility only — it parses formula syntax via regex.
 * It does NOT:
 *   - Evaluate formulas
 *   - Resolve what value a named range holds
 *   - Detect named ranges that are defined cross-sheet (requires workbook context)
 *   - Distinguish user-defined names from table-structured references ([@col])
 *
 * Design rules:
 *   - Pure function: same inputs → same outputs.
 *   - Never throws.
 *   - Returns a sorted, deduplicated array of candidate named-range identifiers.
 *   - Works with or without a leading "=" prefix (xlsx.js omits it in cell.f).
 */

// ─── Excel function name blocklist ───────────────────────────────────────────

/**
 * Built-in Excel function names to exclude from named-range detection.
 *
 * Primary exclusion is by structural context (identifier immediately followed
 * by "(" in the formula string), which catches nearly all cases. This set
 * provides belt-and-suspenders coverage for unusual formatting and future
 * syntax variations.
 *
 * Function names that do not take arguments (TRUE, FALSE, NA, PI) appear in
 * this list so they are excluded even when not followed by "()".
 */
const EXCEL_FUNCTIONS = new Set<string>([
  // Logical
  "AND", "FALSE", "IF", "IFERROR", "IFNA", "IFS", "NOT", "OR", "SWITCH", "TRUE", "XOR",
  // Math / Trig
  "ABS", "CEILING", "EXP", "FLOOR", "INT", "LN", "LOG", "LOG10", "MAX", "MEDIAN",
  "MIN", "MOD", "MROUND", "N", "PI", "POWER", "RAND", "RANDBETWEEN", "ROUND",
  "ROUNDDOWN", "ROUNDUP", "SIGN", "SQRT", "SUM", "SUMIF", "SUMIFS", "SUMPRODUCT",
  "TRUNC",
  // Statistical
  "AVERAGE", "AVERAGEIF", "AVERAGEIFS", "COUNT", "COUNTA", "COUNTBLANK",
  "COUNTIF", "COUNTIFS", "LARGE", "MODE", "SMALL", "STDEV", "STDEVP", "STDEVS",
  "VAR", "VARP",
  // Lookup / Reference
  "ADDRESS", "CHOOSE", "COLUMN", "COLUMNS", "FILTER", "HLOOKUP", "INDEX",
  "INDIRECT", "MATCH", "OFFSET", "ROW", "ROWS", "SEQUENCE", "SORT", "SORTBY",
  "TRANSPOSE", "UNIQUE", "VLOOKUP", "XMATCH", "XLOOKUP",
  // Text
  "CHAR", "CODE", "CONCAT", "CONCATENATE", "FIND", "LEFT", "LEN", "LOWER", "MID",
  "PROPER", "REPLACE", "RIGHT", "SEARCH", "SUBSTITUTE", "T", "TEXT", "TEXTAFTER",
  "TEXTBEFORE", "TEXTJOIN", "TRIM", "UPPER", "VALUE",
  // Date / Time
  "DATE", "DATEDIF", "DAY", "DAYS", "EDATE", "EOMONTH", "MONTH", "NETWORKDAYS",
  "NOW", "TODAY", "WEEKDAY", "WEEKNUM", "WORKDAY", "YEAR",
  // Financial
  "DB", "DDB", "FV", "IPMT", "IRR", "MIRR", "NPER", "NPV", "PMT", "PPMT",
  "PV", "RATE", "SLN",
  // Type / Info
  "CELL", "ERROR", "ERRORTYPE", "INFO", "ISBLANK", "ISERROR", "ISEVEN",
  "ISFORMULA", "ISLOGICAL", "ISNA", "ISNUMBER", "ISODD", "ISREF", "ISTEXT",
  "NA", "TYPE",
  // Misc
  "FORMULATEXT", "GETPIVOTDATA", "HYPERLINK",
]);

// ─── Cell address pattern ──────────────────────────────────────────────────

/**
 * Matches standard Excel cell address tokens: 1–3 column letters followed
 * immediately by a row number (e.g. A1, B12, XFD1048576).
 *
 * Does NOT match identifiers containing underscores (named ranges like
 * Revenue_2024 are safe). The `^` / `$` anchors ensure the full token is
 * a cell address, not just a prefix match.
 */
const CELL_ADDRESS_RE = /^[A-Za-z]{1,3}\d+$/;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract candidate named-range identifiers from an Excel formula string.
 *
 * Supports:
 *   - Simple reference:         `=Revenue_2024`                → ["Revenue_2024"]
 *   - Inside function call:     `=SUM(Revenue_2024, Cost_2024)` → ["Cost_2024", "Revenue_2024"]
 *   - Arithmetic expression:    `=Inputs_GrowthRate * Revenue_Base` → \
 *                                 ["Inputs_GrowthRate", "Revenue_Base"]
 *   - Nested formula:           `=IF(ChurnRate > 0.05, ARR_Base, ARR_Downside)` → \
 *                                 ["ARR_Base", "ARR_Downside", "ChurnRate"]
 *   - Mixed with cross-tab:     `=Inputs!C5 * Revenue_Base`    → ["Revenue_Base"]
 *   - Quoted cross-tab:         `=SUM('Revenue Build'!C3:C17) + Rev_Named` → ["Rev_Named"]
 *
 * Does NOT detect:
 *   - Named ranges whose definitions reside on another sheet (requires workbook context)
 *   - Table-structured references: [@ColumnName] or Table1[Column]
 *   - External workbook references: [Book2.xlsx]Sheet1!A1
 *
 * @param formula  Raw formula string (with or without leading "=").
 * @returns        Sorted array of unique candidate named-range identifiers.
 *                 Empty when none are detected.
 */
export function extractNamedRangeRefs(formula: string): string[] {
  if (!formula || typeof formula !== "string") return [];

  // Remove leading "=" prefix (xlsx.js omits it, real formulas include it).
  let f = formula.startsWith("=") ? formula.slice(1) : formula;

  // ── Step 1: Remove text string literals ───────────────────────────────────
  // Replace "..." with "" so that named-looking identifiers inside string
  // arguments (e.g. IF(A1="Revenue_Named", ...)) are not treated as refs.
  f = f.replace(/"[^"]*"/g, '""');

  // ── Step 2: Remove quoted cross-sheet references ───────────────────────────
  // Pattern: 'Sheet Name'!A1  or  'Sheet Name'!A1:B5
  // Strip the entire reference (sheet + cell) so nothing from them leaks.
  f = f.replace(/'[^']*'![A-Za-z0-9_$:]+/g, "");

  // ── Step 3: Remove unquoted cross-sheet references ─────────────────────────
  // Pattern: SheetName!CellRef  (sheet name uses word-char syntax)
  // Strip entire reference to prevent the sheet name from being picked up as
  // a named range candidate.
  f = f.replace(/[A-Za-z_][A-Za-z0-9_]*![A-Za-z0-9_$:]+/g, "");

  // ── Step 4: Remove structured table references ─────────────────────────────
  // Pattern: TableName[Column] or [@Column]
  // Not fully detected, but strip bracket notation so Table/column labels
  // don't surface as named-range candidates.
  f = f.replace(/[A-Za-z_][A-Za-z0-9_]*\[[^\]]*\]/g, "");
  f = f.replace(/\[@[^\]]*\]/g, "");

  // ── Step 5: Extract and filter identifiers ────────────────────────────────
  const refs = new Set<string>();
  const identRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;

  while ((m = identRe.exec(f)) !== null) {
    const name = m[1]!;
    const afterIdx = m.index + name.length;
    const nextChar = f[afterIdx];

    // Identifier immediately followed by "(" → built-in or user-defined function call.
    if (nextChar === "(") continue;

    // Identifier followed by "!" → residual sheet name (belt-and-suspenders after steps 2–3).
    if (nextChar === "!") continue;

    // Standard cell address (e.g. A1, B12, XFD1, C3).
    // Named ranges ALWAYS contain underscores OR have >3 leading letters,
    // so this pattern is safe for typical real-world formulas.
    if (CELL_ADDRESS_RE.test(name)) continue;

    // Known Excel function or constant (TRUE, FALSE, NA, PI, etc.)
    if (EXCEL_FUNCTIONS.has(name.toUpperCase())) continue;

    // Single-character identifiers are ambiguous (likely column letters or
    // range markers); exclude to avoid noise.
    if (name.length < 2) continue;

    refs.add(name);
  }

  return [...refs].sort();
}

/**
 * Returns true when a formula string contains at least one candidate named-range
 * reference (as defined by extractNamedRangeRefs).
 *
 * Convenience wrapper — prefer extractNamedRangeRefs() when you need the names.
 *
 * @param formula  Raw formula string (with or without leading "=").
 */
export function hasNamedRangeRefs(formula: string): boolean {
  return extractNamedRangeRefs(formula).length > 0;
}
