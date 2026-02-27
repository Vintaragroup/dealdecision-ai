/**
 * Financial Statement Extraction v1
 *
 * Deterministically parses XLSX Income Statement / Pro Forma / P&L data from
 * a DPU (Document Page Understanding) payload's `structured.rows_preview` field.
 *
 * Design constraints:
 *  - Zero external dependencies — pure TypeScript, no DB calls.
 *  - Input: raw DPU payload object (as stored in document_page_understanding.payload).
 *  - Output: FinancialStatementV1 | null (null when data is absent or unrecognisable).
 *  - All derived metrics are computed deterministically from the parsed series.
 *  - Exported types and functions are the stable API surface; internals are private.
 *
 * Supported layouts (v1):
 *  - Annual summary with integer year headers (e.g. 2026, 2027, 2028).
 *  - Row labels in col_A, numeric values in col_C / col_D / col_E etc.
 *  - Period header row detected by scanning for a row where ALL non-null data-column
 *    values are integers in [2000, 2100].
 *
 * Not yet supported (v2+):
 *  - Quarterly layouts ("Q1 2026", "2026-Q1", etc.)
 *  - Trailing-twelve-month or LTM layouts.
 *  - COGS-derived gross profit (requires Revenue − COGS arithmetic).
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export type FinancialStatementV1 = {
	schema_version: "financial_statement_v1";
	/** Provenance — document UUID and DPU page evidence ref. */
	source: {
		document_id: string;
		/** e.g. "dpu:doc:15707ff7:page:0" */
		page_ref: string;
	};
	/**
	 * Ordered period labels.
	 * Annual integers: ["2026", "2027", "2028"].
	 * Quarterly strings: ["Q1 2026", "Q2 2026", ...] (v2+).
	 */
	periods: string[];
	/** Annual revenue by period (key = period label). */
	revenue?: Record<string, number>;
	/** Total expenses by period. */
	total_expenses?: Record<string, number>;
	/**
	 * Gross profit by period.
	 * Sourced from an explicit "Gross Profit" row.
	 * COGS-derived computation is NOT performed in v1.
	 */
	gross_profit?: Record<string, number>;
	/**
	 * Net income or EBITDA by period (labelled whichever appears first in the sheet).
	 */
	net_income?: Record<string, number>;
	/** Deterministically computed metrics from the above series. */
	derived?: {
		/** Revenue for the first (nearest-term) period. */
		revenue_latest?: number;
		/**
		 * Year-over-year % growth from the first to the second period.
		 * Positive = growth, negative = contraction.
		 * Null when revenue base is zero/negative (undefined growth rate).
		 */
		revenue_yoy_growth_pct?: number | null;
		/**
		 * CAGR from the first to the last period (N-1 compounding intervals).
		 * Requires >= 3 periods and a positive first-period revenue.
		 */
		revenue_cagr_pct?: number | null;
		/**
		 * Gross margin % for the first period = gross_profit / revenue * 100.
		 * Null when either value is missing or revenue is zero.
		 */
		gross_margin_latest_pct?: number | null;
	};
	diagnostics?: {
		/** Labels of rows that were matched to a financial field. */
		matched_rows: string[];
		/** Total numeric cells successfully parsed across all matched rows. */
		parsed_cells: number;
		/** Non-fatal conditions encountered during parsing. */
		parse_warnings: string[];
	};
};

// ─── Internal label-to-field mapping ─────────────────────────────────────────

type FinSeriesField = "revenue" | "total_expenses" | "gross_profit" | "net_income";

interface LabelMapping {
	pattern: RegExp;
	field: FinSeriesField;
}

/**
 * Priority-ordered: first match wins per row.
 * Patterns are case-insensitive and match the full trimmed col_A label.
 */
const LABEL_MAP: LabelMapping[] = [
	// Revenue variants — must come before "Expenses" to avoid false matches.
	{ pattern: /^(total\s+)?revenues?$/i, field: "revenue" },
	{ pattern: /^sales$/i, field: "revenue" },
	// Expense variants
	{ pattern: /^(total\s+)?expenses?$/i, field: "total_expenses" },
	{ pattern: /^(cogs|cost\s+of\s+(goods\s+)?sold)$/i, field: "total_expenses" },
	// Profit — gross profit row (explicit; COGS-derived not supported in v1)
	{ pattern: /^(gross\s+profit|contribution\s+margin)$/i, field: "gross_profit" },
	// Bottom-line
	{ pattern: /^(net\s+income|ebitda|operating\s+income)$/i, field: "net_income" },
];

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Year integer validator: integer in [2000, 2100].
 * Safely handles both JSON numbers and strings.
 */
function isYearInteger(v: unknown): boolean {
	if (typeof v === "number") {
		return Number.isInteger(v) && v >= 2000 && v <= 2100;
	}
	if (typeof v === "string") {
		const n = Number(v.trim());
		return Number.isInteger(n) && n >= 2000 && n <= 2100;
	}
	return false;
}

/**
 * Extract all non-label data columns from a row object.
 * Excludes col_A (label) and col_B (often blank or a unit column).
 * Returns sorted ascending by key (col_C < col_D < col_E < ...).
 */
function dataColumnsOf(row: Record<string, unknown>): Array<{ key: string; value: unknown }> {
	return Object.entries(row)
		.filter(([k]) => k !== "col_A" && k !== "col_B")
		.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
		.map(([key, value]) => ({ key, value }));
}

/**
 * From a candidate period-header row, extract the ordered period column keys
 * (e.g. ["col_C","col_D","col_E"]) and their period labels (e.g. ["2026","2027","2028"]).
 *
 * @returns null when fewer than 2 year values are found.
 */
function extractPeriodColumns(
	row: Record<string, unknown>
): { periodKeys: string[]; periods: string[] } | null {
	const cols = dataColumnsOf(row).filter(({ value }) => value !== null && value !== undefined);
	const yearCols = cols.filter(({ value }) => isYearInteger(value));
	if (yearCols.length < 2) return null;
	// Verify EVERY non-null value is a year (guards against mixed data rows)
	if (yearCols.length !== cols.length) {
		// Allow cols with empty strings as "empty"
		const nonYearNonEmpty = cols.filter(
			({ value }) =>
				!isYearInteger(value) &&
				!(typeof value === "string" && value.trim() === ""),
		);
		if (nonYearNonEmpty.length > 0) return null;
	}
	return {
		periodKeys: yearCols.map((c) => c.key),
		periods: yearCols.map(({ value }) => String(Math.round(Number(value)))),
	};
}

/**
 * Map a col_A label to its FinancialStatementV1 series field.
 * Returns null when the label is unrecognised.
 */
function mapLabel(label: string): FinSeriesField | null {
	const trimmed = label.trim();
	for (const { pattern, field } of LABEL_MAP) {
		if (pattern.test(trimmed)) return field;
	}
	return null;
}

/**
 * Extract a numeric series from a row given the known period column keys.
 * Each period gets a numeric value or is omitted when the cell is null/non-numeric.
 */
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
		const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,]/g, "").trim());
		if (!Number.isFinite(n)) {
			warnings.push(`Non-numeric cell at ${key} (${String(raw).slice(0, 20)})`);
			continue;
		}
		series[period] = n;
		parsedCells++;
	}
	return { series, parsedCells, warnings };
}

// ─── Derived metric helpers ───────────────────────────────────────────────────

function round1(x: number): number {
	return Math.round(x * 10) / 10;
}

/**
 * YoY growth %: (period[1] - period[0]) / abs(period[0]) * 100.
 * Returns null when the base is zero or absent.
 */
function computeYoYGrowth(series: Record<string, number>, periods: string[]): number | null {
	if (periods.length < 2) return null;
	const v0 = series[periods[0]!];
	const v1 = series[periods[1]!];
	if (v0 === undefined || v1 === undefined) return null;
	if (v0 === 0) return null;
	return round1(((v1 - v0) / Math.abs(v0)) * 100);
}

/**
 * CAGR %: (last/first)^(1/(N-1)) - 1 expressed as %.
 * Returns null when fewer than 3 periods, or when the first period is zero/negative.
 */
function computeCAGR(series: Record<string, number>, periods: string[]): number | null {
	if (periods.length < 3) return null;
	const vFirst = series[periods[0]!];
	const vLast = series[periods[periods.length - 1]!];
	if (vFirst === undefined || vLast === undefined) return null;
	if (vFirst <= 0) return null; // undefined or misleading CAGR from a negative or zero base
	const years = periods.length - 1;
	return round1((Math.pow(vLast / vFirst, 1 / years) - 1) * 100);
}

/**
 * Gross margin %: gross_profit / revenue * 100 for the first period.
 * Returns null when either value is absent or revenue is zero.
 */
function computeGrossMargin(
	revenue: Record<string, number> | undefined,
	grossProfit: Record<string, number> | undefined,
	periods: string[],
): number | null {
	if (!revenue || !grossProfit || periods.length === 0) return null;
	const period0 = periods[0]!;
	const rev = revenue[period0];
	const gp = grossProfit[period0];
	if (rev === undefined || gp === undefined || rev === 0) return null;
	return round1((gp / rev) * 100);
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a FinancialStatementV1 from a DPU payload object.
 *
 * Returns null when:
 *  - `dpuPayload` is not an object.
 *  - `payload.page_type` is not "excel_range".
 *  - `payload.structured.rows_preview` is absent or empty.
 *  - No period header row can be detected (no 2 integer year values found).
 *  - No recognised financial row labels are found.
 *
 * @param dpuPayload   The raw `payload` JSON from `document_page_understanding`.
 * @param source       Provenance: document UUID and canonical page ref string.
 */
export function parseFinancialStatementV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string },
): FinancialStatementV1 | null {
	// ── Guard: must be an excel_range DPU payload ────────────────────────────
	if (!dpuPayload || typeof dpuPayload !== "object") return null;
	const p = dpuPayload as Record<string, unknown>;

	const pageType = p["page_type"];
	if (pageType !== "excel_range") return null;

	const structured = p["structured"];
	if (!structured || typeof structured !== "object") return null;
	const s = structured as Record<string, unknown>;

	if (s["kind"] !== "excel_range") return null;

	const rowsPreview = s["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	// ── Phase 1: detect period header row ───────────────────────────────────
	let periodKeys: string[] = [];
	let periods: string[] = [];
	const parseWarnings: string[] = [];

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as Record<string, unknown>;
		const detected = extractPeriodColumns(row);
		if (detected) {
			periodKeys = detected.periodKeys;
			periods = detected.periods;
			break;
		}
	}

	if (periods.length === 0) {
		// No period row detected — not a parseable annual summary layout.
		return null;
	}

	// ── Phase 2: extract financial row series ────────────────────────────────
	const seriesMap: Partial<Record<FinSeriesField, Record<string, number>>> = {};
	const matchedRows: string[] = [];
	let parsedCellsTotal = 0;
	// Track which fields have already been set (first occurrence wins)
	const fieldsSeen = new Set<FinSeriesField>();

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const row = rawRow as Record<string, unknown>;

		const label = typeof row["col_A"] === "string" ? row["col_A"] : null;
		if (!label) continue;

		const field = mapLabel(label);
		if (!field || fieldsSeen.has(field)) continue;

		const { series, parsedCells, warnings } = extractSeries(row, periodKeys, periods);
		if (parsedCells === 0) continue; // skip rows with no extractable numbers

		fieldsSeen.add(field);
		seriesMap[field] = series;
		matchedRows.push(label.trim());
		parsedCellsTotal += parsedCells;
		parseWarnings.push(...warnings);
	}

	if (matchedRows.length === 0) {
		// Rows found but none matched our label allowlist.
		return null;
	}

	// ── Phase 3: compute derived metrics ────────────────────────────────────
	const rev = seriesMap["revenue"];
	const gp = seriesMap["gross_profit"];

	const derived: FinancialStatementV1["derived"] = {};
	let hasDerived = false;

	if (rev && periods.length > 0 && rev[periods[0]!] !== undefined) {
		derived.revenue_latest = rev[periods[0]!];
		hasDerived = true;
	}

	const yoy = computeYoYGrowth(rev ?? {}, periods);
	if (yoy !== null) {
		derived.revenue_yoy_growth_pct = yoy;
		hasDerived = true;
	} else if (rev && periods.length >= 2) {
		derived.revenue_yoy_growth_pct = null; // explicitly null = computed but undefined (zero base)
		hasDerived = true;
	}

	const cagr = computeCAGR(rev ?? {}, periods);
	if (periods.length >= 3) {
		derived.revenue_cagr_pct = cagr; // null when first period is non-positive
		hasDerived = true;
	}

	const gm = computeGrossMargin(rev, gp, periods);
	if (gp !== undefined && rev !== undefined) {
		derived.gross_margin_latest_pct = gm; // null when rev=0
		hasDerived = true;
	}

	// ── Assemble result ──────────────────────────────────────────────────────
	const result: FinancialStatementV1 = {
		schema_version: "financial_statement_v1",
		source: {
			document_id: source.documentId,
			page_ref: source.pageRef,
		},
		periods,
		...(seriesMap["revenue"] ? { revenue: seriesMap["revenue"] } : {}),
		...(seriesMap["total_expenses"] ? { total_expenses: seriesMap["total_expenses"] } : {}),
		...(seriesMap["gross_profit"] ? { gross_profit: seriesMap["gross_profit"] } : {}),
		...(seriesMap["net_income"] ? { net_income: seriesMap["net_income"] } : {}),
		...(hasDerived ? { derived } : {}),
		diagnostics: {
			matched_rows: matchedRows,
			parsed_cells: parsedCellsTotal,
			parse_warnings: parseWarnings,
		},
	};

	return result;
}

// ─── Canonical field formatting helpers (used by processor.ts) ───────────────

/**
 * Format a revenue series as a human-readable string for canonical_fields value.
 * e.g. "$3,337,000 (2026) → $15,502,000 (2027) → $35,778,000 (2028)"
 */
export function formatRevenueSeries(
	revenue: Record<string, number>,
	periods: string[],
): string {
	return periods
		.filter((p) => revenue[p] !== undefined)
		.map((p) => {
			const v = revenue[p]!;
			const formatted = Math.abs(v).toLocaleString("en-US", {
				minimumFractionDigits: 0,
				maximumFractionDigits: 0,
			});
			const prefix = v < 0 ? "-$" : "$";
			return `${prefix}${formatted} (${p})`;
		})
		.join(" → ");
}

/**
 * Format a YoY growth rate as a canonical value string.
 * e.g. "+364.6% (2026→2027)"
 */
export function formatYoY(
	growthPct: number,
	periods: string[],
): string {
	const sign = growthPct >= 0 ? "+" : "";
	const label = periods.length >= 2 ? ` (${periods[0]}→${periods[1]})` : "";
	return `${sign}${growthPct.toFixed(1)}%${label}`;
}

/**
 * Format a CAGR as a canonical value string.
 * e.g. "+227.8% 3yr CAGR"
 */
export function formatCAGR(
	cagrPct: number,
	periods: string[],
): string {
	const sign = cagrPct >= 0 ? "+" : "";
	const nYears = periods.length - 1;
	return `${sign}${cagrPct.toFixed(1)}% ${nYears}yr CAGR`;
}

/**
 * Format a gross margin % as a canonical value string.
 * e.g. "9.5% (2026)"
 */
export function formatGrossMargin(
	marginPct: number,
	periods: string[],
): string {
	const period0Label = periods.length > 0 ? ` (${periods[0]})` : "";
	return `${marginPct.toFixed(1)}%${period0Label}`;
}

/**
 * Pick the "best" FinancialStatementV1 from a list of parsed statements.
 *
 * Selection criteria (priority order):
 *  1. Most `matched_rows` (more data is better).
 *  2. Most `parsed_cells` (richer series).
 *  3. Earliest in the list (stable ordering — first document wins on ties).
 *
 * Returns null for an empty list.
 */
export function pickBestStatement(
	stmts: FinancialStatementV1[],
): FinancialStatementV1 | null {
	if (stmts.length === 0) return null;
	return stmts.reduce((best, curr) => {
		const bestRows = best.diagnostics?.matched_rows.length ?? 0;
		const currRows = curr.diagnostics?.matched_rows.length ?? 0;
		if (currRows > bestRows) return curr;
		if (currRows === bestRows) {
			const bestCells = best.diagnostics?.parsed_cells ?? 0;
			const currCells = curr.diagnostics?.parsed_cells ?? 0;
			if (currCells > bestCells) return curr;
		}
		return best;
	});
}
