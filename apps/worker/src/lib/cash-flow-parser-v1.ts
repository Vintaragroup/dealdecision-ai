/**
 * Cash Flow Statement Parser V1
 *
 * Deterministically parses Cash Flow Statement data from XLSX DPU payloads
 * (excel_range page_type with rows_preview).
 *
 * Extracted fields:
 *   - net_cash_from_ops       (operating activities)
 *   - net_cash_from_investing (investing activities)
 *   - net_cash_from_financing (financing activities)
 *   - net_change_in_cash      (net increase/decrease in cash)
 *   - beginning_cash          (cash at beginning of period)
 *   - ending_cash             (cash at end of period)
 *
 * Derived:
 *   - monthly_burn  (from ops; abs(net_cash_from_ops) / 12 when negative)
 *   - runway_months (ending_cash / monthly_burn)
 *
 * Design constraints: pure TypeScript, no DB calls, conservative extraction.
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CashFlowStatementV1 {
	schema_version: "cash_flow_v1";
	source: {
		document_id: string;
		page_ref:    string;
	};
	periods: string[];
	net_cash_from_ops?:       Record<string, number>;
	net_cash_from_investing?: Record<string, number>;
	net_cash_from_financing?: Record<string, number>;
	net_change_in_cash?:      Record<string, number>;
	beginning_cash?:          Record<string, number>;
	ending_cash?:             Record<string, number>;
	derived?: {
		/** Monthly cash burn from operating activities (absolute value, for positive = outflow). */
		monthly_burn_from_ops?:  number | null;
		/** Runway in months: ending_cash / monthly_burn. Null when either absent. */
		runway_months?:          number | null;
	};
	diagnostics: {
		matched_rows:   string[];
		parsed_cells:   number;
		parse_warnings: string[];
	};
}

// ─── Label mapping ─────────────────────────────────────────────────────────────

type CfField =
	| "net_cash_from_ops"
	| "net_cash_from_investing"
	| "net_cash_from_financing"
	| "net_change_in_cash"
	| "beginning_cash"
	| "ending_cash";

interface LabelMapping {
	pattern: RegExp;
	field:   CfField;
}

const LABEL_MAP: LabelMapping[] = [
	{ pattern: /^net\s+cash\s+(?:from|provided\s+by|used\s+in)\s+operating/i,             field: "net_cash_from_ops" },
	{ pattern: /^(?:net\s+)?cash\s+(?:from|provided\s+by|used\s+in)\s+operations?$/i,     field: "net_cash_from_ops" },
	{ pattern: /^operating\s+activities?$/i,                                                field: "net_cash_from_ops" },
	{ pattern: /^net\s+cash\s+(?:from|used\s+in)\s+investing/i,                            field: "net_cash_from_investing" },
	{ pattern: /^investing\s+activities?$/i,                                                field: "net_cash_from_investing" },
	{ pattern: /^net\s+cash\s+(?:from|provided\s+by)\s+financing/i,                        field: "net_cash_from_financing" },
	{ pattern: /^financing\s+activities?$/i,                                                field: "net_cash_from_financing" },
	{ pattern: /^net\s+(?:increase|decrease|change)\s+in\s+cash/i,                         field: "net_change_in_cash" },
	{ pattern: /^net\s+cash\s+(?:increase|decrease)$/i,                                    field: "net_change_in_cash" },
	{ pattern: /^cash\s+(?:at\s+)?(?:beginning|start)\s+(?:of\s+)?(?:period|year|month)$/i, field: "beginning_cash" },
	{ pattern: /^(?:beginning|opening)\s+cash\s+(?:balance|position)?$/i,                  field: "beginning_cash" },
	{ pattern: /^cash\s+(?:at\s+)?(?:end|close)\s+(?:of\s+)?(?:period|year|month)$/i,     field: "ending_cash" },
	{ pattern: /^(?:ending|closing)\s+cash\s+(?:balance|position)?$/i,                     field: "ending_cash" },
];

// ─── Shared XLSX utilities ─────────────────────────────────────────────────────

function isYearInteger(v: unknown): boolean {
	if (typeof v === "number") return Number.isInteger(v) && v >= 2000 && v <= 2100;
	if (typeof v === "string") { const n = Number(v.trim()); return Number.isInteger(n) && n >= 2000 && n <= 2100; }
	return false;
}

function dataColumnsOf(row: Record<string, unknown>): Array<{ key: string; value: unknown }> {
	return Object.entries(row)
		.filter(([k]) => k !== "col_A" && k !== "col_B")
		.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
		.map(([key, value]) => ({ key, value }));
}

function extractPeriodColumns(row: Record<string, unknown>): { periodKeys: string[]; periods: string[] } | null {
	const cols = dataColumnsOf(row).filter(({ value }) => value !== null && value !== undefined);
	const yearCols = cols.filter(({ value }) => isYearInteger(value));
	if (yearCols.length < 1) return null;
	const nonYearNonEmpty = cols.filter(({ value }) => !isYearInteger(value) && !(typeof value === "string" && value.trim() === ""));
	if (nonYearNonEmpty.length > 0) return null;
	return {
		periodKeys: yearCols.map((c) => c.key),
		periods:    yearCols.map(({ value }) => String(Math.round(Number(value)))),
	};
}

function mapLabel(label: string): CfField | null {
	const t = label.trim();
	for (const { pattern, field } of LABEL_MAP) {
		if (pattern.test(t)) return field;
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
		const key    = periodKeys[i]!;
		const period = periods[i]!;
		const raw    = row[key];
		if (raw === null || raw === undefined) continue;
		const rawStr = String(raw).trim().replace(/\(([^)]+)\)/, "-$1");
		const n = typeof raw === "number" ? raw : Number(rawStr.replace(/[$,]/g, ""));
		if (!Number.isFinite(n)) { warnings.push(`Non-numeric at ${key}: ${String(raw).slice(0, 20)}`); continue; }
		series[period] = n;
		parsedCells++;
	}
	return { series, parsedCells, warnings };
}

function extractSinglePeriodValue(row: Record<string, unknown>): number | null {
	for (const { value } of dataColumnsOf(row)) {
		if (value === null || value === undefined) continue;
		const rawStr = String(value).trim().replace(/\(([^)]+)\)/, "-$1");
		const n = typeof value === "number" ? value : Number(rawStr.replace(/[$,]/g, ""));
		if (Number.isFinite(n)) return n;
	}
	return null;
}

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseCashFlowStatementV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string },
): CashFlowStatementV1 | null {
	if (!dpuPayload || typeof dpuPayload !== "object") return null;
	const p = dpuPayload as Record<string, unknown>;
	if (p["page_type"] !== "excel_range") return null;

	const structured = p["structured"] as Record<string, unknown> | null | undefined;
	if (!structured || structured["kind"] !== "excel_range") return null;

	const rowsPreview = structured["rows_preview"];
	if (!Array.isArray(rowsPreview) || rowsPreview.length === 0) return null;

	// Detect period header
	let periodKeys: string[] = [];
	let periods: string[] = [];
	const parseWarnings: string[] = [];

	for (const rawRow of rowsPreview) {
		if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
		const detected = extractPeriodColumns(rawRow as Record<string, unknown>);
		if (detected && detected.periods.length >= 1) { periodKeys = detected.periodKeys; periods = detected.periods; break; }
	}

	const syntheticPeriod = periods.length > 0 ? null : "P0";
	if (syntheticPeriod) periods = [syntheticPeriod];

	// Extract rows
	const seriesMap: Partial<Record<CfField, Record<string, number>>> = {};
	const matchedRows: string[] = [];
	let parsedCellsTotal = 0;
	const fieldsSeen = new Set<CfField>();

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
			series = { [syntheticPeriod]: val }; parsedCells = 1; warnings = [];
		} else {
			({ series, parsedCells, warnings } = extractSeries(row, periodKeys, periods));
		}
		if (parsedCells === 0) continue;

		fieldsSeen.add(field);
		seriesMap[field] = series;
		matchedRows.push(label.trim());
		parsedCellsTotal += parsedCells;
		parseWarnings.push(...warnings);
	}

	// Require at least one cash flow activity row
	const hasMinimum = fieldsSeen.has("net_cash_from_ops") || fieldsSeen.has("net_change_in_cash");
	if (!hasMinimum) return null;

	// Derived metrics
	const derived: CashFlowStatementV1["derived"] = {};
	let hasDerived = false;

	const opsSeries = seriesMap["net_cash_from_ops"];
	const endCashSeries = seriesMap["ending_cash"];

	if (opsSeries && periods.length > 0) {
		const latestOps = opsSeries[periods[0]!];
		if (latestOps !== undefined && latestOps < 0) {
			// Negative ops cash flow = cash burn
			derived.monthly_burn_from_ops = Math.abs(latestOps) / 12;
			hasDerived = true;

			if (endCashSeries && endCashSeries[periods[0]!] !== undefined) {
				const endCash = endCashSeries[periods[0]!]!;
				if (endCash > 0) {
					derived.runway_months = Math.round((endCash / derived.monthly_burn_from_ops) * 10) / 10;
				} else {
					derived.runway_months = null;
				}
				hasDerived = true;
			}
		}
	}

	return {
		schema_version: "cash_flow_v1",
		source:  { document_id: source.documentId, page_ref: source.pageRef },
		periods,
		...(seriesMap["net_cash_from_ops"]       ? { net_cash_from_ops:       seriesMap["net_cash_from_ops"] }       : {}),
		...(seriesMap["net_cash_from_investing"]  ? { net_cash_from_investing: seriesMap["net_cash_from_investing"] }  : {}),
		...(seriesMap["net_cash_from_financing"]  ? { net_cash_from_financing: seriesMap["net_cash_from_financing"] }  : {}),
		...(seriesMap["net_change_in_cash"]       ? { net_change_in_cash:      seriesMap["net_change_in_cash"] }       : {}),
		...(seriesMap["beginning_cash"]           ? { beginning_cash:          seriesMap["beginning_cash"] }           : {}),
		...(seriesMap["ending_cash"]              ? { ending_cash:             seriesMap["ending_cash"] }              : {}),
		...(hasDerived ? { derived } : {}),
		diagnostics: { matched_rows: matchedRows, parsed_cells: parsedCellsTotal, parse_warnings: parseWarnings },
	};
}

export function pickBestCashFlow(stmts: CashFlowStatementV1[]): CashFlowStatementV1 | null {
	if (stmts.length === 0) return null;
	return stmts.reduce((best, curr) => {
		const bRows = best.diagnostics.matched_rows.length;
		const cRows = curr.diagnostics.matched_rows.length;
		if (cRows > bRows) return curr;
		if (cRows === bRows && curr.diagnostics.parsed_cells > best.diagnostics.parsed_cells) return curr;
		return best;
	});
}
