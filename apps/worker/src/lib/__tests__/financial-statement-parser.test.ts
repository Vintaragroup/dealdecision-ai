/**
 * Unit tests for financial-statement-parser.ts
 *
 * Covers:
 *  - parseFinancialStatementV1: guard cases, period detection, label mapping,
 *    series extraction, derived metrics
 *  - Format helpers: formatRevenueSeries, formatYoY, formatCAGR, formatGrossMargin
 *  - pickBestStatement: selection logic
 *
 * Real data shapes from Deal Decision AI XLSX Income Statement docs are used
 * as regression fixtures (docs 15707ff7 / b5ee7394).
 */

import { describe, it, expect } from "vitest";
import {
	parseFinancialStatementV1,
	formatRevenueSeries,
	formatYoY,
	formatCAGR,
	formatGrossMargin,
	pickBestStatement,
	type FinancialStatementV1,
} from "../financial-statement-parser.js";

// ─── Fixture helpers ────────────────────────────────────────────────────────

const SOURCE = {
	documentId: "15707ff7-fc9c-4eed-934d-c5585d938e76",
	pageRef: "dpu:doc:15707ff7:page:0",
};

/**
 * Minimal valid DPU payload for an excel_range page with annual summary rows.
 * Mirrors the structure of Deal Decision AI Income Statement V1 (doc 15707ff7).
 */
function makeV1Payload(overrides?: {
	rows_preview?: unknown[];
	kind?: string;
}) {
	return {
		page_type: "excel_range",
		page_text: "Income Statement V1 | Headers: ...",
		structured: {
			kind: overrides?.kind ?? "excel_range",
			sheet_name: "Income Statement",
			headers: ["col_A", "col_B", "col_C", "col_D", "col_E"],
			rows_preview: overrides?.rows_preview ?? [
				// title row
				{ col_A: "DealDecision AI Pro Forma Income Statement", col_B: null, col_C: null, col_D: null, col_E: null },
				// period header row: year integers
				{ col_A: "Summary Results", col_B: null, col_C: 2026, col_D: 2027, col_E: 2028 },
				// financial rows
				{ col_A: "Total Revenues", col_B: null, col_C: 3337000, col_D: 15502000, col_E: 35778000 },
				{ col_A: "Total Expenses", col_B: null, col_C: 3018437.36, col_D: 6615082.08, col_E: 12599570 },
				{ col_A: "Gross Profit", col_B: null, col_C: 318562.64, col_D: 8886917.92, col_E: 23178430 },
			],
		},
	};
}

/**
 * V2 scenario: negative first-period gross profit (doc b5ee7394).
 */
function makeV2Payload() {
	return {
		page_type: "excel_range",
		page_text: "Income Statement V2 | ...",
		structured: {
			kind: "excel_range",
			sheet_name: "Income Statement",
			headers: ["col_A", "col_B", "col_C", "col_D", "col_E"],
			rows_preview: [
				{ col_A: "DealDecision AI Pro Forma Income Statement", col_B: null, col_C: null, col_D: null, col_E: null },
				{ col_A: "Summary Results", col_B: null, col_C: 2026, col_D: 2027, col_E: 2028 },
				{ col_A: "Total Revenues", col_B: null, col_C: 1503000, col_D: 9462000, col_E: 22694000 },
				{ col_A: "Total Expenses", col_B: null, col_C: 1998790, col_D: 4629961.04, col_E: 10342310 },
				{ col_A: "Gross Profit", col_B: null, col_C: -495790, col_D: 4832038.96, col_E: 12351690 },
			],
		},
	};
}

// ─── parseFinancialStatementV1 — guard cases ─────────────────────────────────

describe("parseFinancialStatementV1 guard cases", () => {
	it("returns null for non-object input", () => {
		expect(parseFinancialStatementV1(null, SOURCE)).toBeNull();
		expect(parseFinancialStatementV1(42, SOURCE)).toBeNull();
		expect(parseFinancialStatementV1("string", SOURCE)).toBeNull();
	});

	it("returns null when page_type is not excel_range", () => {
		expect(parseFinancialStatementV1({ page_type: "page_image" }, SOURCE)).toBeNull();
		expect(parseFinancialStatementV1({ page_type: "excel_sheet" }, SOURCE)).toBeNull();
		expect(parseFinancialStatementV1({}, SOURCE)).toBeNull();
	});

	it("returns null when structured is absent or wrong kind", () => {
		expect(parseFinancialStatementV1({ page_type: "excel_range" }, SOURCE)).toBeNull();
		expect(parseFinancialStatementV1(
			{ page_type: "excel_range", structured: { kind: "excel_sheet", rows_preview: [] } },
			SOURCE,
		)).toBeNull();
	});

	it("returns null when rows_preview is empty or absent", () => {
		expect(parseFinancialStatementV1(
			{ page_type: "excel_range", structured: { kind: "excel_range" } },
			SOURCE,
		)).toBeNull();
		expect(parseFinancialStatementV1(
			{ page_type: "excel_range", structured: { kind: "excel_range", rows_preview: [] } },
			SOURCE,
		)).toBeNull();
	});

	it("returns null when no period header row can be detected", () => {
		const payload = {
			page_type: "excel_range",
			structured: {
				kind: "excel_range",
				rows_preview: [
					// no row with >= 2 year integers
					{ col_A: "Revenue", col_C: 5000, col_D: 8000 },
				],
			},
		};
		expect(parseFinancialStatementV1(payload, SOURCE)).toBeNull();
	});

	it("returns null when period row is detected but no financial label rows match", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Header", col_B: null, col_C: 2026, col_D: 2027, col_E: 2028 },
				{ col_A: "Active Customers", col_B: null, col_C: 100, col_D: 200, col_E: 300 },
				{ col_A: "Headcount", col_B: null, col_C: 5, col_D: 10, col_E: 15 },
			],
		});
		expect(parseFinancialStatementV1(payload, SOURCE)).toBeNull();
	});
});

// ─── parseFinancialStatementV1 — period detection ────────────────────────────

describe("parseFinancialStatementV1 period detection", () => {
	it("detects integer year periods in a summary row", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE);
		expect(result).not.toBeNull();
		expect(result!.periods).toEqual(["2026", "2027", "2028"]);
	});

	it("ignores the title row and correctly identifies the period row", () => {
		// title row has all nulls in data columns → should not be period row
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE);
		expect(result!.periods[0]).toBe("2026");
	});

	it("handles rows_preview with only 2 periods", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Period", col_C: 2025, col_D: 2026 },
				{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE);
		expect(result!.periods).toEqual(["2025", "2026"]);
	});

	it("rejects a row as period header when mixed year and non-year data columns exist", () => {
		const payload = makeV1Payload({
			rows_preview: [
				// mixed: 2026 is year, 5000 is not → NOT a period row
				{ col_A: "Some Label", col_C: 2026, col_D: 5000, col_E: 2028 },
				// fallback: clean period row
				{ col_A: "Years", col_C: 2026, col_D: 2027, col_E: 2028 },
				{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000, col_E: 3000000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE);
		expect(result).not.toBeNull();
		expect(result!.periods).toEqual(["2026", "2027", "2028"]);
	});
});

// ─── parseFinancialStatementV1 — label mapping ───────────────────────────────

describe("parseFinancialStatementV1 label mapping", () => {
	it("maps 'Total Revenues' to revenue field", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.revenue).toBeDefined();
		expect(result.diagnostics?.matched_rows).toContain("Total Revenues");
	});

	it("maps 'Revenue' (singular) to revenue field", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Revenue", col_C: 500000, col_D: 750000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.revenue).toBeDefined();
	});

	it("maps 'Sales' to revenue field", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Sales", col_C: 500000, col_D: 750000 },
			],
		});
		expect(parseFinancialStatementV1(payload, SOURCE)?.revenue).toBeDefined();
	});

	it("maps 'Total Expenses' to total_expenses field", () => {
		expect(parseFinancialStatementV1(makeV1Payload(), SOURCE)?.total_expenses).toBeDefined();
	});

	it("maps 'Gross Profit' to gross_profit field", () => {
		expect(parseFinancialStatementV1(makeV1Payload(), SOURCE)?.gross_profit).toBeDefined();
	});

	it("maps 'Net Income' to net_income field", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Net Income", col_C: 50000, col_D: 120000 },
			],
		});
		expect(parseFinancialStatementV1(payload, SOURCE)?.net_income).toBeDefined();
	});

	it("maps 'EBITDA' to net_income field", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "EBITDA", col_C: 50000, col_D: 120000 },
			],
		});
		expect(parseFinancialStatementV1(payload, SOURCE)?.net_income).toBeDefined();
	});

	it("first matching row wins for each field (duplicate labels skipped)", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000 },
				// second 'Revenue' row should be ignored
				{ col_A: "Revenue", col_C: 9999999, col_D: 9999999 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.revenue?.["2025"]).toBe(1000000);
		expect(result.diagnostics?.matched_rows.filter((r) => r.includes("Revenue")).length).toBe(1);
	});

	it("ignores non-financial labels like 'Active Customers'", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Active Customers", col_C: 100, col_D: 200 },
				{ col_A: "Total Revenues", col_C: 500000, col_D: 750000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.diagnostics?.matched_rows).not.toContain("Active Customers");
		expect(result.revenue).toBeDefined();
	});
});

// ─── parseFinancialStatementV1 — series extraction ───────────────────────────

describe("parseFinancialStatementV1 series extraction", () => {
	it("extracts correct values from real V1 fixture", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.revenue?.["2026"]).toBe(3337000);
		expect(result.revenue?.["2027"]).toBe(15502000);
		expect(result.revenue?.["2028"]).toBe(35778000);
		expect(result.total_expenses?.["2026"]).toBeCloseTo(3018437.36);
		expect(result.gross_profit?.["2026"]).toBeCloseTo(318562.64);
	});

	it("handles negative values (V2 fixture — negative gross profit in 2026)", () => {
		const result = parseFinancialStatementV1(makeV2Payload(), SOURCE)!;
		expect(result.gross_profit?.["2026"]).toBe(-495790);
		expect(result.revenue?.["2026"]).toBe(1503000);
	});

	it("skips null cells without crashing", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026, col_E: 2027 },
				{ col_A: "Total Revenues", col_C: null, col_D: 500000, col_E: 800000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.revenue?.["2025"]).toBeUndefined();
		expect(result.revenue?.["2026"]).toBe(500000);
	});

	it("records parsed_cells count correctly", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		// 3 rows × 3 periods = 9 cells
		expect(result.diagnostics?.parsed_cells).toBe(9);
	});

	it("attaches source provenance", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.source.document_id).toBe(SOURCE.documentId);
		expect(result.source.page_ref).toBe(SOURCE.pageRef);
		expect(result.schema_version).toBe("financial_statement_v1");
	});
});

// ─── parseFinancialStatementV1 — derived metrics ─────────────────────────────

describe("parseFinancialStatementV1 derived metrics", () => {
	it("computes revenue_latest as the first-period revenue", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.derived?.revenue_latest).toBe(3337000);
	});

	it("computes revenue_yoy_growth_pct correctly from V1 fixture", () => {
		// (15502000 - 3337000) / 3337000 * 100 = 364.6%
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.derived?.revenue_yoy_growth_pct).toBeCloseTo(364.6, 0);
	});

	it("computes revenue_cagr_pct correctly from V1 fixture", () => {
		// (35778000/3337000)^(1/2) - 1 = 227.4%  (rounded to 1dp)
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.derived?.revenue_cagr_pct).toBeCloseTo(227.4, 0);
	});

	it("computes gross_margin_latest_pct correctly from V1 fixture", () => {
		// 318562.64 / 3337000 * 100 = 9.5%
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.derived?.gross_margin_latest_pct).toBeCloseTo(9.5, 0);
	});

	it("sets revenue_yoy_growth_pct to null when revenue base is zero", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Total Revenues", col_C: 0, col_D: 500000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.derived?.revenue_yoy_growth_pct).toBeNull();
	});

	it("omits revenue_cagr_pct when only 2 periods", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.derived?.revenue_cagr_pct).toBeUndefined();
	});

	it("sets revenue_cagr_pct null when first-period revenue is negative", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026, col_E: 2027 },
				{ col_A: "Total Revenues", col_C: -1000000, col_D: 2000000, col_E: 3000000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.derived?.revenue_cagr_pct).toBeNull();
	});

	it("sets gross_margin_latest_pct null when gross profit is negative (V2)", () => {
		const result = parseFinancialStatementV1(makeV2Payload(), SOURCE)!;
		// -495790 / 1503000 * 100 = -33.0%  (negative, but still computed)
		const gm = result.derived?.gross_margin_latest_pct;
		expect(typeof gm === "number" && gm < 0).toBe(true);
	});

	it("omits gross_margin when gross_profit row is absent", () => {
		const payload = makeV1Payload({
			rows_preview: [
				{ col_A: "Year", col_C: 2025, col_D: 2026 },
				{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000 },
			],
		});
		const result = parseFinancialStatementV1(payload, SOURCE)!;
		expect(result.derived?.gross_margin_latest_pct).toBeUndefined();
	});
});

// ─── Format helpers ──────────────────────────────────────────────────────────

describe("formatRevenueSeries", () => {
	it("formats a 3-period revenue series", () => {
		const rev = { "2026": 3337000, "2027": 15502000, "2028": 35778000 };
		expect(formatRevenueSeries(rev, ["2026", "2027", "2028"])).toBe(
			"$3,337,000 (2026) → $15,502,000 (2027) → $35,778,000 (2028)",
		);
	});

	it("formats negative values with -$ prefix", () => {
		const rev = { "2026": -495790 };
		expect(formatRevenueSeries(rev, ["2026"])).toBe("-$495,790 (2026)");
	});

	it("skips periods not present in the series", () => {
		const rev = { "2027": 15502000 };
		const out = formatRevenueSeries(rev, ["2026", "2027", "2028"]);
		expect(out).toBe("$15,502,000 (2027)");
	});
});

describe("formatYoY", () => {
	it("formats positive growth", () => {
		expect(formatYoY(364.6, ["2026", "2027"])).toBe("+364.6% (2026→2027)");
	});

	it("formats negative growth", () => {
		expect(formatYoY(-12.5, ["2025", "2026"])).toBe("-12.5% (2025→2026)");
	});
});

describe("formatCAGR", () => {
	it("formats 3-year CAGR", () => {
		expect(formatCAGR(227.4, ["2026", "2027", "2028"])).toBe("+227.4% 2yr CAGR");
	});

	it("handles 4-year CAGR", () => {
		const out = formatCAGR(50.0, ["2025", "2026", "2027", "2028"]);
		expect(out).toBe("+50.0% 3yr CAGR");
	});
});

describe("formatGrossMargin", () => {
	it("formats positive margin", () => {
		expect(formatGrossMargin(9.5, ["2026"])).toBe("9.5% (2026)");
	});

	it("formats negative margin", () => {
		expect(formatGrossMargin(-33.0, ["2026"])).toBe("-33.0% (2026)");
	});
});

// ─── pickBestStatement ────────────────────────────────────────────────────────

describe("pickBestStatement", () => {
	it("returns null for empty array", () => {
		expect(pickBestStatement([])).toBeNull();
	});

	it("returns the only element in a single-element array", () => {
		const stmt = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(pickBestStatement([stmt])).toBe(stmt);
	});

	it("prefers statement with more matched rows", () => {
		const rich = parseFinancialStatementV1(makeV1Payload(), SOURCE)!; // 3 rows
		const sparse = parseFinancialStatementV1(
			makeV1Payload({
				rows_preview: [
					{ col_A: "Year", col_C: 2026, col_D: 2027 },
					{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000 },
					// only 1 financial row
				],
			}),
			SOURCE,
		)!; // 1 row
		expect(pickBestStatement([sparse, rich])).toBe(rich);
	});

	it("on equal matched rows, prefers more parsed cells", () => {
		// 2 rows × 2 periods = 4 cells
		const fewer = parseFinancialStatementV1(
			makeV1Payload({
				rows_preview: [
					{ col_A: "Year", col_C: 2026, col_D: 2027 },
					{ col_A: "Total Revenues", col_C: 1000000, col_D: 2000000 },
					{ col_A: "Gross Profit", col_C: 200000, col_D: 400000 },
				],
			}),
			SOURCE,
		)!;
		// 2 rows × 3 periods = 6 cells
		const more = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(pickBestStatement([fewer, more])).toBe(more);
	});
});

// ─── Regression: full V1 payload end-to-end ──────────────────────────────────

describe("regression: V1 Income Statement full parse", () => {
	it("parses the V1 fixture without errors and matches expected shape", () => {
		const result = parseFinancialStatementV1(makeV1Payload(), SOURCE)!;
		expect(result.schema_version).toBe("financial_statement_v1");
		expect(result.periods).toEqual(["2026", "2027", "2028"]);
		expect(Object.keys(result.revenue ?? {})).toEqual(["2026", "2027", "2028"]);
		expect(Object.keys(result.total_expenses ?? {})).toEqual(["2026", "2027", "2028"]);
		expect(Object.keys(result.gross_profit ?? {})).toEqual(["2026", "2027", "2028"]);
		expect(result.derived?.revenue_latest).toBe(3337000);
		// CAGR should be positive and > 100% (high-growth scenario)
		expect((result.derived?.revenue_cagr_pct ?? 0) > 100).toBe(true);
		expect(result.diagnostics?.parse_warnings).toHaveLength(0);
	});
});
