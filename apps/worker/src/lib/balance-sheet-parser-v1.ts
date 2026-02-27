/**
 * Balance Sheet Parser V1
 *
 * Deterministically parses Balance Sheet data from XLSX DPU payloads
 * (excel_range page_type with rows_preview).
 *
 * Extracted fields:
 *   - cash / cash_and_equivalents
 *   - accounts_receivable
 *   - total_current_assets
 *   - total_assets
 *   - accounts_payable
 *   - total_current_liabilities
 *   - total_liabilities
 *   - total_equity  (stockholders' equity / shareholders' equity / net assets)
 *   - debt_outstanding  (long-term debt / notes payable)
 *   - retained_earnings
 *
 * Design constraints (mirroring financial-statement-parser.ts):
 *  - Zero external dependencies — pure TypeScript, no DB calls.
 *  - Input:  raw DPU payload object (payload.structured.rows_preview).
 *  - Output: BalanceSheetV1 | null.
 *  - Conservative: never fabricates missing rows.
 *  - Supports multi-period balance sheets (year columns), single-period stubs.
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export interface BalanceSheetV1 {
	schema_version: "balance_sheet_v1";
	source: {
		document_id: string;
		page_ref:    string;
	};
	/**
	 * Ordered period labels (e.g. ["2025", "2026"]).
	 * Empty when no year-header row is found; single entry when only one period present.
	 */
	periods: string[];
	/** Cash & cash equivalents by period, or null when row absent. */
	cash?:                     Record<string, number>;
	accounts_receivable?:      Record<string, number>;
	total_current_assets?:     Record<string, number>;
	total_assets?:             Record<string, number>;
	accounts_payable?:         Record<string, number>;
	total_current_liabilities?: Record<string, number>;
	total_liabilities?:        Record<string, number>;
	/** Total stockholders' / shareholders' equity. */
	total_equity?:             Record<string, number>;
	debt_outstanding?:         Record<string, number>;
	retained_earnings?:        Record<string, number>;
	/** Derived: assets_equal_liabilities_plus_equity check per period. */
	derived?: {
		balance_check?: Record<string, boolean>;
		cash_latest?:   number | null;
		debt_latest?:   number | null;
	};
	diagnostics: {
		matched_rows:   string[];
		parsed_cells:   number;
		parse_warnings: string[];
	};
}

// ─── Label mapping ─────────────────────────────────────────────────────────────

type BsField =
	| "cash"
	| "accounts_receivable"
	| "total_current_assets"
	| "total_assets"
	| "accounts_payable"
	| "total_current_liabilities"
	| "total_liabilities"
	| "total_equity"
	| "debt_outstanding"
	| "retained_earnings";

interface LabelMapping {
	pattern: RegExp;
	field:   BsField;
}

/** Priority-ordered; first match wins per row. */
const LABEL_MAP: LabelMapping[] = [
	// Cash first to avoid "total current assets" partial matches
	{ pattern: /^cash\s*(?:&|and)?\s*cash\s+equivalents?$/i,           field: "cash" },
	{ pattern: /^cash\s*$/i,                                             field: "cash" },
	{ pattern: /^accounts?\s+receivable$/i,                              field: "accounts_receivable" },
	{ pattern: /^total\s+current\s+assets?$/i,                           field: "total_current_assets" },
	{ pattern: /^total\s+assets?$/i,                                     field: "total_assets" },
	{ pattern: /^accounts?\s+payable$/i,                                 field: "accounts_payable" },
	{ pattern: /^total\s+current\s+liabilities$/i,                       field: "total_current_liabilities" },
	{ pattern: /^total\s+liabilities?$/i,                                field: "total_liabilities" },
	{ pattern: /^(?:total\s+)?(?:stockholders?['']?\s+equity|shareholders?['']?\s+equity|net\s+assets?)$/i,
	                                                                      field: "total_equity" },
	{ pattern: /^(?:long[- ]?term\s+debt|notes?\s+payable|debt\s+outstanding|long[- ]?term\s+obligations?)$/i,
	                                                                      field: "debt_outstanding" },
	{ pattern: /^retained\s+(?:earnings?|deficit)$/i,                    field: "retained_earnings" },
];

// ─── Shared XLSX row utilities (duplicated from financial-statement-parser for independence) ──

function isYearInteger(v: unknown): boolean {
	if (typeof v === "number") return Number.isInteger(v) && v >= 2000 && v <= 2100;
	if (typeof v === "string") {
		const n = Number(v.trim());
		return Number.isInteger(n) && n >= 2000 && n <= 2100;
	}
	return false;
}

function dataColumnsOf(row: Record<string, unknown>): Array<{ key: string; value: unknown }> {
	return Object.entries(row)
		.filter(([k]) => k !== "col_A" && k !== "col_B")
		.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
		.map(([key, value]) => ({ key, value }));
}

function extractPeriodColumns(
	row: Record<string, unknown>
): { periodKeys: string[]; periods: string[] } | null {
	const cols = dataColumnsOf(row).filter(({ value }) => value !== null && value !== undefined);
	const yearCols = cols.filter(({ value }) => isYearInteger(value));
	if (yearCols.length < 1) return null;
	const nonYearNonEmpty = cols.filter(
		({ value }) => !isYearInteger(value) && !(typeof value === "string" && value.trim() === ""),
	);
	if (nonYearNonEmpty.length > 0) return null;
	return {
		periodKeys: yearCols.map((c) => c.key),
		periods: yearCols.map(({ value }) => String(Math.round(Number(value)))),
	};
}

function mapLabel(label: string): BsField | null {
	const trimmed = label.trim();
	for (const { pattern, field } of LABEL_MAP) {
		if (pattern.test(trimmed)) return field;
	}
	return null;
}

function extractSeries(
	row: Record<string, unknown>,
	periodKeys: string[],
	periods: string[],
): { series: Record<string, number>; parsedCells: number; warnings: string[] } {
	const series: Record<string, number> = {};
	let parsedCells = 0;
	const warnings: string[] = [];
	for (let i = 0; i < periodKeys.length; i++) {
		const key = periodKeys[i]!;
		const period = periods[i]!;
		const raw = row[key];
		if (raw === null || raw === undefined) continue;
		// Handle parenthetical negatives: (1,234) → -1234
		const rawStr = String(raw).trim().replace(/\(([^)]+)\)/, "-$1");
		const n = typeof raw === "number" ? raw : Number(rawStr.replace(/[$,]/g, ""));
		if (!Number.isFinite(n)) {
			warnings.push(`Non-numeric at ${key}: ${String(raw).slice(0, 20)}`);
			continue;
		}
		series[period] = n;
		parsedCells++;
	}
	return { series, parsedCells, warnings };
}

/**
 * Fallback: single-period extraction — scans first non-null numeric data column
 * and assigns it to a synthetic period label "P0".
 */
function extractSinglePeriodValue(
	row: Record<string, unknown>
): number | null {
	const cols = dataColumnsOf(row);
	for (const { value } of cols) {
		if (value === null || value === undefined) continue;
		const rawStr = String(value).trim().replace(/\(([^)]+)\)/, "-$1");
		const n = typeof value === "number" ? value : Number(rawStr.replace(/[$,]/g, ""));
		if (Number.isFinite(n)) return n;
	}
	return null;
}

// ─── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a BalanceSheetV1 from a DPU payload object.
 *
 * Returns null when:
 *  - payload is not an object / not excel_range.
 *  - rows_preview is absent or empty.
 *  - No balance-sheet row labels are found (total_assets, total_liabilities, etc.).
 */
export function parseBalanceSheetV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string },
): BalanceSheetV1 | null {
	if (!dpuPayload || typeof dpuPayload !== "object") return null;
	const p = dpuPayload as Record<string, unknown>;
	if (p["page_type"] !== "excel_range") return null;

	const structured = p["structured"] as Record<string, unknown> | null | undefined;
	if (!structured) return null;
	if (structured["kind"] !== "excel_range") return null;

	const rowsPreview = structured["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	// ── Phase 1: detect period header row ────────────────────────────────────
	let periodKeys: string[] = [];
	let periods: string[] = [];
	const parseWarnings: string[] = [];

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as Record<string, unknown>;
		const detected = extractPeriodColumns(row);
		if (detected && detected.periods.length >= 1) {
			periodKeys = detected.periodKeys;
			periods = detected.periods;
			break;
		}
	}

	// ── Phase 2: extract balance-sheet row series ─────────────────────────────
	const seriesMap: Partial<Record<BsField, Record<string, number>>> = {};
	const matchedRows: string[] = [];
	let parsedCellsTotal = 0;
	const fieldsSeen = new Set<BsField>();

	const syntheticPeriod = periods.length > 0 ? null : "P0";
	if (syntheticPeriod) periods = [syntheticPeriod];

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as Record<string, unknown>;
		const label = typeof row["col_A"] === "string" ? row["col_A"] : null;
		if (!label) continue;
		const field = mapLabel(label);
		if (!field || fieldsSeen.has(field)) continue;

		let series: Record<string, number>;
		let parsedCells: number;
		let warnings: string[];

		if (syntheticPeriod) {
			const val = extractSinglePeriodValue(row);
			if (val === null) continue;
			series = { [syntheticPeriod]: val };
			parsedCells = 1;
			warnings = [];
		} else {
			const extracted = extractSeries(row, periodKeys, periods);
			series = extracted.series;
			parsedCells = extracted.parsedCells;
			warnings = extracted.warnings;
		}
		if (parsedCells === 0) continue;

		fieldsSeen.add(field);
		seriesMap[field] = series;
		matchedRows.push(label.trim());
		parsedCellsTotal += parsedCells;
		parseWarnings.push(...warnings);
	}

	// Must have at least one key balance sheet row to return a result.
	const hasMinimumFields = fieldsSeen.has("total_assets") || fieldsSeen.has("total_liabilities") || fieldsSeen.has("total_equity");
	if (!hasMinimumFields) return null;

	// ── Phase 3: derived metrics ──────────────────────────────────────────────
	const derived: BalanceSheetV1["derived"] = {};
	let hasDerived = false;

	// Balance check: total_assets ≈ total_liabilities + total_equity (within 1%)
	const ta = seriesMap["total_assets"];
	const tl = seriesMap["total_liabilities"];
	const te = seriesMap["total_equity"];
	if (ta && tl && te) {
		const balanceCheck: Record<string, boolean> = {};
		for (const period of periods) {
			const assets = ta[period];
			const liab   = tl[period];
			const equity = te[period];
			if (assets !== undefined && liab !== undefined && equity !== undefined) {
				const diff = Math.abs(assets - (liab + equity));
				const tol  = Math.abs(assets) * 0.01;  // 1% tolerance
				balanceCheck[period] = diff <= tol;
			}
		}
		if (Object.keys(balanceCheck).length > 0) {
			derived.balance_check = balanceCheck;
			hasDerived = true;
		}
	}

	const cashSeries = seriesMap["cash"];
	if (cashSeries && periods.length > 0) {
		derived.cash_latest = cashSeries[periods[0]!] ?? null;
		hasDerived = true;
	}

	const debtSeries = seriesMap["debt_outstanding"];
	if (debtSeries && periods.length > 0) {
		derived.debt_latest = debtSeries[periods[0]!] ?? null;
		hasDerived = true;
	}

	return {
		schema_version: "balance_sheet_v1",
		source:  { document_id: source.documentId, page_ref: source.pageRef },
		periods: syntheticPeriod ? [syntheticPeriod] : periods,
		...(seriesMap["cash"]                     ? { cash:                     seriesMap["cash"] }                     : {}),
		...(seriesMap["accounts_receivable"]       ? { accounts_receivable:       seriesMap["accounts_receivable"] }       : {}),
		...(seriesMap["total_current_assets"]      ? { total_current_assets:      seriesMap["total_current_assets"] }      : {}),
		...(seriesMap["total_assets"]              ? { total_assets:              seriesMap["total_assets"] }              : {}),
		...(seriesMap["accounts_payable"]          ? { accounts_payable:          seriesMap["accounts_payable"] }          : {}),
		...(seriesMap["total_current_liabilities"] ? { total_current_liabilities: seriesMap["total_current_liabilities"] } : {}),
		...(seriesMap["total_liabilities"]         ? { total_liabilities:         seriesMap["total_liabilities"] }         : {}),
		...(seriesMap["total_equity"]              ? { total_equity:              seriesMap["total_equity"] }              : {}),
		...(seriesMap["debt_outstanding"]          ? { debt_outstanding:          seriesMap["debt_outstanding"] }          : {}),
		...(seriesMap["retained_earnings"]         ? { retained_earnings:         seriesMap["retained_earnings"] }         : {}),
		...(hasDerived ? { derived } : {}),
		diagnostics: {
			matched_rows:   matchedRows,
			parsed_cells:   parsedCellsTotal,
			parse_warnings: parseWarnings,
		},
	};
}

/**
 * Pick the best BalanceSheetV1 from multiple candidates.
 * Prefers the one with the most matched_rows, then most parsed_cells.
 */
export function pickBestBalanceSheet(sheets: BalanceSheetV1[]): BalanceSheetV1 | null {
	if (sheets.length === 0) return null;
	return sheets.reduce((best, curr) => {
		const bRows = best.diagnostics.matched_rows.length;
		const cRows = curr.diagnostics.matched_rows.length;
		if (cRows > bRows) return curr;
		if (cRows === bRows && curr.diagnostics.parsed_cells > best.diagnostics.parsed_cells) return curr;
		return best;
	});
}
