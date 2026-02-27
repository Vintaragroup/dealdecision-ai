/**
 * implied-capital-income-statement-v1.test.ts
 *
 * Unit tests for the income-statement implied capital allocation parser.
 *
 * Coverage:
 *  1.  Returns null for null payload
 *  2.  Returns null when page_type is not excel_range
 *  3.  Returns null when rows_preview is empty
 *  4.  Returns null when no income-statement title/signals detected
 *  5.  Returns null when only summary rows (Total Revenues, Total Expenses) — no categories
 *  6.  Returns null when fewer than 3 expense categories with nonzero values
 *  7.  Extracts expense categories between Total Revenues and Total Expenses
 *  8.  Skips Total/subtotal/section header rows
 *  9.  Skips revenue rows (before Total Revenues boundary)
 * 10.  Uses earliest 4-digit year column key
 * 11.  Falls back to col_1 when no year key
 * 12.  Bucket mapping: Payroll/Marketing/Technology/G&A/Sales/R&D
 * 13.  Percentages sum to ~100
 * 14.  source.document_id and source.page_ref set from opts
 * 15.  period_label derived from column key
 * 16.  DealDecision fixture: returns null (only summary rows, no categories)
 */

import { describe, it, expect } from "vitest";
import { parseImpliedCapitalIncomeStatementV1 } from "../lib/implied-capital-income-statement-v1";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOC_ID = "15707ff7-aaaa-bbbb-cccc-dddddddddddd";
const PAGE_REF = "dpu:doc:15707ff7:page:0";
const OPTS = { documentId: DOC_ID, pageRef: PAGE_REF };

/** Rows with expense categories — realistic income statement schema */
function makeFullIncomeStatement(yearKey = "2026") {
	return {
		page_type: "excel_range",
		rows_preview: [
			{ label: "DealDecision AI Pro Forma Income Statement" },
			{ label: "Summary Results", [yearKey]: null },
			// Revenue section
			{ label: "VC Subscriptions", [yearKey]: 120000 },
			{ label: "PE Subscriptions", [yearKey]: 80000 },
			{ label: "Total Revenues", [yearKey]: 200000 },
			// Expense section (categories)
			{ label: "Payroll & Benefits", [yearKey]: 90000 },
			{ label: "Marketing & Sales", [yearKey]: 30000 },
			{ label: "Technology & Infrastructure", [yearKey]: 25000 },
			{ label: "G&A", [yearKey]: 15000 },
			{ label: "Legal & Compliance", [yearKey]: 10000 },
			{ label: "Total Expenses", [yearKey]: 170000 },
			{ label: "Gross Profit", [yearKey]: 30000 },
		],
	};
}

/** DealDecision actual data shape — only summary rows, no expense categories */
const DEALDECISION_ROWS_PREVIEW = {
	page_type: "excel_range",
	rows_preview: [
		{ label: "DealDecision AI Pro Forma Income Statement" },
		{ label: "Summary Results", "2026": null, "2027": null, "2028": null },
		{ label: "Total Revenues", "2026": 200000, "2027": 450000, "2028": 900000 },
		{ label: "Total Expenses", "2026": 170000, "2027": 280000, "2028": 420000 },
		{ label: "Gross Profit", "2026": 30000, "2027": 170000, "2028": 480000 },
		{ label: "Revenue Projections" },
		{ label: "VC/PE Subscriptions", "2026": 80000 },
		{ label: "RIA Subscriptions", "2026": 60000 },
		{ label: "Angel Subscriptions", "2026": 60000 },
	],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseImpliedCapitalIncomeStatementV1", () => {
	it("1. returns null for null payload", () => {
		expect(parseImpliedCapitalIncomeStatementV1(null, OPTS)).toBeNull();
	});

	it("2. returns null when page_type is not excel_range", () => {
		const payload = { ...makeFullIncomeStatement(), page_type: "excel_sheet" };
		expect(parseImpliedCapitalIncomeStatementV1(payload, OPTS)).toBeNull();
	});

	it("3. returns null when rows_preview is empty", () => {
		expect(
			parseImpliedCapitalIncomeStatementV1({ page_type: "excel_range", rows_preview: [] }, OPTS)
		).toBeNull();
	});

	it("4. returns null when no income-statement title or signals detected", () => {
		const payload = {
			page_type: "excel_range",
			rows_preview: [
				{ label: "Market Sizing Analysis" },
				{ label: "TAM", "2026": 5000000000 },
				{ label: "SAM", "2026": 500000000 },
			],
		};
		expect(parseImpliedCapitalIncomeStatementV1(payload, OPTS)).toBeNull();
	});

	it("5. returns null for DealDecision actual data (only summary rows)", () => {
		// This is the critical regression test: DealDecision's income statements
		// lack individual expense category rows. Parser must return null.
		expect(parseImpliedCapitalIncomeStatementV1(DEALDECISION_ROWS_PREVIEW, OPTS)).toBeNull();
	});

	it("6. returns null when fewer than 3 expense categories", () => {
		const payload = {
			page_type: "excel_range",
			rows_preview: [
				{ label: "Pro Forma Income Statement" },
				{ label: "Total Revenues", "2026": 100000 },
				{ label: "Payroll", "2026": 50000 },
				{ label: "Technology", "2026": 20000 },
				{ label: "Total Expenses", "2026": 70000 },
			],
		};
		// Only 2 categories — should fail quality gate
		expect(parseImpliedCapitalIncomeStatementV1(payload, OPTS)).toBeNull();
	});

	it("7. extracts expense categories between Total Revenues and Total Expenses", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS);
		expect(result).not.toBeNull();
		const categories = result!.buckets.map((b) => b.category);
		// Should have Payroll, Marketing, Technology, G&A, Legal (5 categories)
		expect(categories.length).toBeGreaterThanOrEqual(4);
	});

	it("8. skips Total/Gross Profit/section header rows", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS)!;
		const categories = result.buckets.map((b) => b.category);
		expect(categories.some((c) => /^total/i.test(c))).toBe(false);
		expect(categories.some((c) => /gross profit/i.test(c))).toBe(false);
	});

	it("9. skips revenue rows before Total Revenues boundary", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS)!;
		const categories = result.buckets.map((b) => b.category);
		// Revenue rows (VC/PE Subscriptions) should not appear
		expect(categories.every((c) => !/subscription/i.test(c))).toBe(true);
	});

	it("10. uses earliest 4-digit year column when multiple years present", () => {
		const payload = {
			page_type: "excel_range",
			rows_preview: [
				{ label: "Pro Forma Income Statement" },
				{ label: "Total Revenues", "2026": 200000, "2027": 400000, "2028": 800000 },
				{ label: "Payroll", "2026": 80000, "2027": 160000, "2028": 240000 },
				{ label: "Marketing", "2026": 30000, "2027": 60000, "2028": 90000 },
				{ label: "Technology", "2026": 25000, "2027": 50000, "2028": 75000 },
				{ label: "G&A", "2026": 15000, "2027": 30000, "2028": 45000 },
				{ label: "Total Expenses", "2026": 150000, "2027": 300000, "2028": 450000 },
			],
		};
		const result = parseImpliedCapitalIncomeStatementV1(payload, OPTS)!;
		expect(result.period_label).toBe("2026");
		// Should use 2026 values
		const payroll = result.buckets.find((b) => b.category === "Payroll");
		expect(payroll?.annual_amount).toBe(80000);
	});

	it("11. falls back to col_1 when no year key", () => {
		const payload = {
			page_type: "excel_range",
			rows_preview: [
				{ label: "Income Statement" },
				{ label: "Total Revenues", col_1: 200000 },
				{ label: "Payroll", col_1: 80000 },
				{ label: "Marketing", col_1: 30000 },
				{ label: "Technology", col_1: 25000 },
				{ label: "G&A", col_1: 15000 },
				{ label: "Total Expenses", col_1: 150000 },
			],
		};
		const result = parseImpliedCapitalIncomeStatementV1(payload, OPTS);
		expect(result).not.toBeNull();
		expect(result!.period_label).toBe("col 1");
	});

	it("12. bucket mapping: Payroll/Marketing/Technology/G&A/Sales", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS)!;
		const cats = result.buckets.map((b) => b.category);
		expect(cats).toContain("Payroll");
		expect(cats).toContain("Marketing");
		expect(cats).toContain("Technology");
		expect(cats).toContain("G&A");
		expect(cats).toContain("Legal");
	});

	it("13. percentages sum to approximately 100", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS)!;
		const total = result.buckets.reduce((s, b) => s + b.pct_of_total, 0);
		expect(total).toBeGreaterThan(98);
		expect(total).toBeLessThan(102);
	});

	it("14. source fields set from opts", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS)!;
		expect(result.source.document_id).toBe(DOC_ID);
		expect(result.source.page_ref).toBe(PAGE_REF);
	});

	it("15. period_label derived from column key", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement("2026"), OPTS)!;
		expect(result.period_label).toBe("2026");
	});

	it("16. schema_version and basis are correct", () => {
		const result = parseImpliedCapitalIncomeStatementV1(makeFullIncomeStatement(), OPTS)!;
		expect(result.schema_version).toBe("income_statement_allocation_v1");
		expect(result.basis).toBe("income_statement");
		expect(result.basis_note).toContain("IMPLIED");
	});
});
