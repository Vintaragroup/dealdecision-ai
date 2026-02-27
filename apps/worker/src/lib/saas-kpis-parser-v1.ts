/**
 * SaaS KPIs Parser V1
 *
 * Deterministically parses SaaS / subscription metric data from XLSX DPU payloads
 * (excel_range page_type with rows_preview).
 *
 * Extracted metrics:
 *   mrr, arr, churn_pct, retention_pct, cac, ltv, arpu, ltv_cac_ratio
 *
 * Design rules:
 *  - Pure TypeScript, no DB calls, conservative.
 *  - First match per field wins.
 *  - churn_pct and retention_pct consistency check: if both present, warn when
 *    |churn + retention - 100| > 2.
 *  - Handles both period-based columns (year headers) and single-value KPI tables.
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SaasKpisV1 {
	schema_version: "saas_kpis_v1";
	source: {
		document_id: string;
		page_ref:    string;
	};
	/**
	 * Period labels (year integers or "P0" for single-period KPI table).
	 * For a single-period KPI table this is ["P0"].
	 */
	periods: string[];
	/** Monthly Recurring Revenue by period. */
	mrr?:             Record<string, number>;
	/** Annual Recurring Revenue by period (or derived from MRR * 12). */
	arr?:             Record<string, number>;
	/** Monthly/annual churn rate %, 0–100. */
	churn_pct?:       Record<string, number>;
	/** Monthly/annual retention rate %, 0–100. */
	retention_pct?:   Record<string, number>;
	/** Customer Acquisition Cost (absolute dollar). */
	cac?:             Record<string, number>;
	/** Lifetime Value (absolute dollar). */
	ltv?:             Record<string, number>;
	/** Average Revenue Per User / Account. */
	arpu?:            Record<string, number>;
	derived?: {
		/** LTV / CAC ratio for the first period. */
		ltv_cac_ratio?:     number | null;
		/** ARR derived from MRR * 12 when ARR row absent. */
		arr_from_mrr?:      boolean;
		/** Latest MRR value. */
		mrr_latest?:        number | null;
		/** Latest ARR value (explicit or derived). */
		arr_latest?:        number | null;
	};
	diagnostics: {
		matched_rows:   string[];
		parsed_cells:   number;
		parse_warnings: string[];
	};
}

// ─── Label mapping ─────────────────────────────────────────────────────────────

type KpiField = "mrr" | "arr" | "churn_pct" | "retention_pct" | "cac" | "ltv" | "arpu";

interface LabelMapping {
	pattern: RegExp;
	field:   KpiField;
}

const LABEL_MAP: LabelMapping[] = [
	// MRR first — matches before ARR to avoid partial "arr" match
	{ pattern: /^\s*(?:monthly\s+recurring\s+revenue|mrr)\s*\/?\s*(?:monthly\s+recurring\s+revenue|mrr)?\s*$/i, field: "mrr" },
	{ pattern: /^\s*mrr\s*$/i,                                                              field: "mrr" },
	{ pattern: /^\s*monthly\s+recurring\s+revenue\s*$/i,                                    field: "mrr" },
	{ pattern: /^\s*(?:annual(?:ized)?\s+recurring\s+revenue|arr)\s*$/i,                    field: "arr" },
	{ pattern: /^\s*arr\s*$/i,                                                               field: "arr" },
	{ pattern: /^\s*churn(?:\s+rate)?\s*(?:%|percent)?\s*$/i,                               field: "churn_pct" },
	{ pattern: /^\s*(?:logo|gross|net)\s+churn\s*(?:rate)?\s*$/i,                           field: "churn_pct" },
	{ pattern: /^\s*(?:net\s+)?retention(?:\s+rate)?\s*(?:%|percent)?\s*$/i,                field: "retention_pct" },
	{ pattern: /^\s*(?:gross\s+)?logo\s+retention\s*$/i,                                    field: "retention_pct" },
	{ pattern: /^\s*cac\s*$/i,                                                               field: "cac" },
	{ pattern: /^\s*customer\s+acquisition\s+cost\s*$/i,                                    field: "cac" },
	{ pattern: /^\s*(?:customer\s+)?(?:lifetime\s+value|ltv)\s*$/i,                         field: "ltv" },
	{ pattern: /^\s*(?:clv|customer\s+lifetime\s+value)\s*$/i,                              field: "ltv" },
	{ pattern: /^\s*(?:average\s+revenue\s+per\s+user|arpu|arpua|arpa)\s*$/i,               field: "arpu" },
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

function mapLabel(label: string): KpiField | null {
	const t = label.trim();
	for (const { pattern, field } of LABEL_MAP) {
		if (pattern.test(t)) return field;
	}
	return null;
}

/**
 * Parse a numeric value from a KPI cell.
 * Handles: "$50,000", "50K", "50M", "47.5%", "(1,234)", "0.03" (fraction churn).
 * For churn/retention: converts fractions 0–1 to percentages 0–100.
 */
function parseKpiCell(v: unknown, field: KpiField): number | null {
	if (v === null || v === undefined) return null;
	let s = String(v).trim();
	// Unwrap parenthetical negatives
	s = s.replace(/^\(([^)]+)\)$/, "-$1");
	// Strip % suffix and store flag
	const hasPctSuffix = s.endsWith("%");
	if (hasPctSuffix) s = s.slice(0, -1).trim();
	// Strip currency + commas
	s = s.replace(/[$,]/g, "");
	// Handle K/M/B multipliers
	const mult = /([kmb])$/i.exec(s);
	if (mult) {
		s = s.slice(0, -1);
		const n = Number(s);
		if (!Number.isFinite(n)) return null;
		const multiplier = mult[1]!.toLowerCase() === "k" ? 1_000 : mult[1]!.toLowerCase() === "m" ? 1_000_000 : 1_000_000_000;
		const result = n * multiplier;
		// churn/retention: if multiplier used with pct suffix, skip
		if ((field === "churn_pct" || field === "retention_pct") && !hasPctSuffix) return null;
		return result;
	}
	const n = Number(s);
	if (!Number.isFinite(n)) return null;
	// Convert fraction-form churn/retention (0.0 – 1.0) to percentage
	if ((field === "churn_pct" || field === "retention_pct") && !hasPctSuffix && n >= 0 && n <= 1) {
		return Math.round(n * 1000) / 10; // 0.035 → 3.5
	}
	return n;
}

function extractSeries(
	row: Record<string, unknown>,
	periodKeys: string[],
	periods: string[],
	field: KpiField,
): { series: Record<string, number>; parsedCells: number; warnings: string[] } {
	const series: Record<string, number> = {};
	let parsedCells = 0;
	const warnings: string[] = [];
	for (let i = 0; i < periodKeys.length; i++) {
		const key    = periodKeys[i]!;
		const period = periods[i]!;
		const raw    = row[key];
		if (raw === null || raw === undefined) continue;
		const n = parseKpiCell(raw, field);
		if (n === null) { warnings.push(`Non-numeric at ${key}: ${String(raw).slice(0, 20)}`); continue; }
		series[period] = n;
		parsedCells++;
	}
	return { series, parsedCells, warnings };
}

function extractSingleValue(row: Record<string, unknown>, field: KpiField): number | null {
	for (const { value } of dataColumnsOf(row)) {
		if (value === null || value === undefined) continue;
		const n = parseKpiCell(value, field);
		if (n !== null) return n;
	}
	return null;
}

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseSaasKpisV1(
	dpuPayload: unknown,
	source: { documentId: string; pageRef: string },
): SaasKpisV1 | null {
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

	const seriesMap: Partial<Record<KpiField, Record<string, number>>> = {};
	const matchedRows: string[] = [];
	let parsedCellsTotal = 0;
	const fieldsSeen = new Set<KpiField>();

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
			const val = extractSingleValue(row, field);
			if (val === null) continue;
			series = { [syntheticPeriod]: val }; parsedCells = 1; warnings = [];
		} else {
			({ series, parsedCells, warnings } = extractSeries(row, periodKeys, periods, field));
		}
		if (parsedCells === 0) continue;

		fieldsSeen.add(field);
		seriesMap[field] = series;
		matchedRows.push(label.trim());
		parsedCellsTotal += parsedCells;
		parseWarnings.push(...warnings);
	}

	// Require at least one SaaS KPI row
	const hasMinimum = fieldsSeen.has("mrr") || fieldsSeen.has("arr") || fieldsSeen.has("churn_pct");
	if (!hasMinimum) return null;

	// Consistency warning: churn + retention should ≈ 100%
	{
		const churnSeries = seriesMap["churn_pct"];
		const retentionSeries = seriesMap["retention_pct"];
		if (churnSeries && retentionSeries && periods.length > 0) {
			const c = churnSeries[periods[0]!];
			const r = retentionSeries[periods[0]!];
			if (c !== undefined && r !== undefined && Math.abs(c + r - 100) > 2) {
				parseWarnings.push(`churn_pct (${c}) + retention_pct (${r}) ≠ 100 — check units`);
			}
		}
	}

	// Derived
	const derived: SaasKpisV1["derived"] = {};
	let hasDerived = false;

	const mrrSeries = seriesMap["mrr"];
	const arrSeries = seriesMap["arr"];
	const p0 = periods[0]!;

	if (mrrSeries) {
		derived.mrr_latest = mrrSeries[p0] ?? null;
		hasDerived = true;
		// Derive ARR from MRR * 12 if ARR row absent
		if (!arrSeries && derived.mrr_latest !== null) {
			const derivedArr: Record<string, number> = {};
			for (const [period, mrr] of Object.entries(mrrSeries)) {
				derivedArr[period] = mrr * 12;
			}
			seriesMap["arr"] = derivedArr;
			derived.arr_from_mrr = true;
			derived.arr_latest   = (derived.mrr_latest ?? 0) * 12;
			hasDerived = true;
		}
	}
	if (arrSeries) {
		derived.arr_latest = arrSeries[p0] ?? null;
		hasDerived = true;
	}

	const cacSeries = seriesMap["cac"];
	const ltvSeries = seriesMap["ltv"];
	if (cacSeries && ltvSeries) {
		const cac = cacSeries[p0];
		const ltv = ltvSeries[p0];
		if (cac !== undefined && ltv !== undefined && cac > 0) {
			derived.ltv_cac_ratio = Math.round((ltv / cac) * 10) / 10;
			hasDerived = true;
		}
	}

	return {
		schema_version: "saas_kpis_v1",
		source:  { document_id: source.documentId, page_ref: source.pageRef },
		periods,
		...(seriesMap["mrr"]           ? { mrr:           seriesMap["mrr"] }           : {}),
		...(seriesMap["arr"]           ? { arr:           seriesMap["arr"] }           : {}),
		...(seriesMap["churn_pct"]     ? { churn_pct:     seriesMap["churn_pct"] }     : {}),
		...(seriesMap["retention_pct"] ? { retention_pct: seriesMap["retention_pct"] } : {}),
		...(seriesMap["cac"]           ? { cac:           seriesMap["cac"] }           : {}),
		...(seriesMap["ltv"]           ? { ltv:           seriesMap["ltv"] }           : {}),
		...(seriesMap["arpu"]          ? { arpu:          seriesMap["arpu"] }          : {}),
		...(hasDerived ? { derived } : {}),
		diagnostics: { matched_rows: matchedRows, parsed_cells: parsedCellsTotal, parse_warnings: parseWarnings },
	};
}

export function pickBestSaasKpis(kpis: SaasKpisV1[]): SaasKpisV1 | null {
	if (kpis.length === 0) return null;
	return kpis.reduce((best, curr) => {
		if (curr.diagnostics.matched_rows.length > best.diagnostics.matched_rows.length) return curr;
		return best;
	});
}
