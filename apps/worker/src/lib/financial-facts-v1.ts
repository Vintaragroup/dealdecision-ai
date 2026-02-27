/**
 * Financial Facts V1 — Stable Machine-Readable Bridge Object
 *
 * Derives a structured, deterministic financial facts object from a
 * FinancialStatementV1 parsed from XLSX DPU payloads.
 *
 * Intended consumers:
 *   - investor_insight_reports.report_payload (alongside fused_facts)
 *   - Future: Deal Overview V2 / Score pipeline bridge
 *
 * Design rules:
 *   - Pure function: no DB calls, no side-effects
 *   - All numeric fields are rounded to consistent precision
 *   - Labels carry human-readable period context for downstream display
 *   - Diagnostics include parse quality score (0–1) for gating decisions
 */

import type { FinancialStatementV1 } from "./financial-statement-parser.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FinancialFactsV1 {
	schema_version: "financial_facts_v1";
	/** Evidence ref from source DPU page: "dpu:doc:<8hex>:page:<n>" */
	source_ref: string;
	/** Ordered period labels, e.g. ["2026", "2027", "2028"] */
	periods: string[];

	// ── Revenue ────────────────────────────────────────────────────────────────
	/** First (earliest) period revenue in absolute dollars, or null. */
	revenue_latest: number | null;
	/** Human-readable period label for revenue_latest, e.g. "2026". */
	revenue_latest_label: string | null;

	/** YoY revenue growth % (first → second period), rounded to 1 decimal. */
	revenue_yoy_growth_pct: number | null;
	/** Human-readable range label, e.g. "2026 vs 2025" or "2026 → 2027". */
	revenue_yoy_label: string | null;

	/** CAGR across all available periods, rounded to 1 decimal. */
	revenue_cagr_pct: number | null;
	/** CAGR period range, e.g. "2026–2028". */
	revenue_cagr_label: string | null;

	// ── Margin ─────────────────────────────────────────────────────────────────
	/** Gross margin % for earliest period, rounded to 1 decimal. */
	gross_margin_latest_pct: number | null;

	// ── Raw series (pass-through for downstream logic) ─────────────────────────
	revenue_series: Record<string, number> | null;
	gross_profit_series: Record<string, number> | null;
	total_expenses_series: Record<string, number> | null;

	// ── Diagnostics ────────────────────────────────────────────────────────────
	diagnostics: {
		/**
		 * Quality score 0–1:
		 *   1.0 — revenue + gross_profit or net_income present
		 *   0.7 — revenue only
		 *   0.4 — only other rows (expenses, etc.)
		 *   0.0 — no matched rows
		 */
		parse_quality: number;
		matched_rows: string[];
		parsed_cells: number;
		parse_warnings: string[];
	};
}

// ─── Derive ───────────────────────────────────────────────────────────────────

/**
 * Derive a FinancialFactsV1 object from a parsed FinancialStatementV1.
 * Returns null when the statement has no useful data (no revenue, no matched rows).
 */
export function deriveFinancialFactsV1(
	statement: FinancialStatementV1
): FinancialFactsV1 | null {
	const { periods, revenue, gross_profit, total_expenses, derived, diagnostics, source } = statement;

	if (!periods.length) return null;
	if (!(diagnostics?.matched_rows.length)) return null;

	const revenueLatest = derived?.revenue_latest ?? null;
	const revenueLatestLabel = periods[0] ?? null;

	// YoY: first → second period
	const yoyPct = derived?.revenue_yoy_growth_pct !== undefined ? derived.revenue_yoy_growth_pct : null;
	let yoyLabel: string | null = null;
	if (yoyPct !== null && periods.length >= 2) {
		yoyLabel = `${periods[0]} → ${periods[1]}`;
	}

	const cagrPct = derived?.revenue_cagr_pct !== undefined ? derived.revenue_cagr_pct : null;
	let cagrLabel: string | null = null;
	if (cagrPct !== null && periods.length >= 2) {
		cagrLabel = `${periods[0]}–${periods[periods.length - 1]}`;
	}

	const grossMarginPct = derived?.gross_margin_latest_pct !== undefined
		? derived.gross_margin_latest_pct
		: null;

	// Parse quality score
	const hasRevenue = !!revenue;
	const hasGrossProfit = !!gross_profit;
	const hasOtherRows = !!(total_expenses || statement.net_income);
	let parseQuality = 0;
	if (hasRevenue && (hasGrossProfit || hasOtherRows)) {
		parseQuality = 1.0;
	} else if (hasRevenue) {
		parseQuality = 0.7;
	} else if (hasGrossProfit || hasOtherRows) {
		parseQuality = 0.4;
	}

	return {
		schema_version: "financial_facts_v1",
		source_ref: source.page_ref,
		periods,
		revenue_latest: revenueLatest !== null ? Number(revenueLatest.toFixed(2)) : null,
		revenue_latest_label: revenueLatestLabel,
		revenue_yoy_growth_pct: yoyPct !== null ? Number(yoyPct.toFixed(1)) : null,
		revenue_yoy_label: yoyLabel,
		revenue_cagr_pct: cagrPct !== null ? Number(cagrPct.toFixed(1)) : null,
		revenue_cagr_label: cagrLabel,
		gross_margin_latest_pct: grossMarginPct !== null ? Number(grossMarginPct.toFixed(1)) : null,
		revenue_series: revenue ?? null,
		gross_profit_series: gross_profit ?? null,
		total_expenses_series: total_expenses ?? null,
		diagnostics: {
			parse_quality: parseQuality,
			matched_rows: diagnostics?.matched_rows ?? [],
			parsed_cells: diagnostics?.parsed_cells ?? 0,
			parse_warnings: diagnostics?.parse_warnings ?? [],
		},
	};
}
