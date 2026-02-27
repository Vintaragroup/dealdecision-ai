/**
 * financial-layout-classifier-v1.test.ts
 *
 * Unit tests for the deterministic XLSX financial-layout classifier.
 *
 * Coverage:
 *  1.  Null payload → layout "unknown", confidence "low"
 *  2.  Non-excel page_type (e.g. "image") → layout "other", confidence "high"
 *  3.  Excel_range page with no matching signals → layout "unknown"
 *  4.  Income-statement detected from sheet_name alone
 *  5.  Income-statement detected from content signals (col_A row labels)
 *  6.  Income-statement: high confidence when ≥ 2 signals
 *  7.  Use-of-funds (excel_range) detected from title
 *  8.  Use-of-funds (excel_range) detected from content signals
 *  9.  Use-of-funds timeseries (excel_sheet) — month header signals
 * 10.  Use-of-funds timeseries — WebMax "Allocation of Funds" tab fixture → use_of_funds
 * 11.  Budget model (excel_sheet) — payroll/headcount signals
 * 12.  Cap-table detection from title
 * 13.  Cash-flow detection from title + content
 * 14.  Balance-sheet detection from title
 * 15.  Low-confidence path: single weak content signal
 * 16.  classifyDealLayouts: has_income_statement flag set from pages
 * 17.  classifyDealLayouts: has_use_of_funds flag set from pages
 * 18.  classifyDealLayouts: has_budget_model flag set from pages
 * 19.  classifyDealLayouts: layout_coverage_pct calculation
 * 20.  classifyDealLayouts: non-excel pages excluded from total_xl_pages
 */

import { describe, it, expect } from "vitest";
import {
	classifyPage,
	classifyDealLayouts,
	type ClassifierPageInput,
} from "../lib/financial-layout-classifier-v1";

// ─── Payload helpers ──────────────────────────────────────────────────────────

const DOC_A = "doc-aaaa-1111";
const DOC_B = "doc-bbbb-2222";

function makeExcelRange(opts: {
	sheet_name?: string;
	rowLabels?: string[];
}): ClassifierPageInput {
	return {
		document_id: DOC_A,
		page_index:  0,
		payload: {
			page_type:  "excel_range",
			sheet_name: opts.sheet_name ?? null,
			structured: {
				rows_preview: (opts.rowLabels ?? []).map((lbl) => ({ col_A: lbl })),
			},
		},
	};
}

function makeExcelSheet(opts: {
	sheet_name?: string;
	page_text?: string;
	docId?: string;
	pageIndex?: number;
}): ClassifierPageInput {
	return {
		document_id: opts.docId ?? DOC_A,
		page_index:  opts.pageIndex ?? 0,
		payload: {
			page_type:  "excel_sheet",
			sheet_name: opts.sheet_name ?? null,
			page_text:  opts.page_text ?? "",
		},
	};
}

function makeNonExcel(pageType: string): ClassifierPageInput {
	return {
		document_id: DOC_A,
		page_index:  5,
		payload: { page_type: pageType },
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("classifyPage", () => {
	// 1. Null payload
	it("returns unknown layout when payload is null", () => {
		const result = classifyPage({ document_id: DOC_A, page_index: 0, payload: null });
		expect(result.layout).toBe("unknown");
		expect(result.confidence).toBe("low");
		expect(result.notes).toEqual(expect.arrayContaining(["null payload"]));
	});

	// 2. Non-excel page_type
	it("returns other layout for non-excel page_types", () => {
		const result = classifyPage(makeNonExcel("image"));
		expect(result.layout).toBe("other");
		expect(result.confidence).toBe("high");
	});

	it("returns other layout for pdf_text page_type", () => {
		const result = classifyPage(makeNonExcel("pdf_text"));
		expect(result.layout).toBe("other");
	});

	// 3. No signals
	it("returns unknown when excel_range page has no matching signals", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "General Notes", rowLabels: ["Notes", "Summary"] }));
		expect(result.layout).toBe("unknown");
		expect(result.matched_signals).toHaveLength(0);
	});

	// 4. Income statement from sheet_name
	it("detects income_statement from sheet_name 'Income Statement'", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Income Statement" }));
		expect(result.layout).toBe("income_statement");
		expect(result.matched_signals.some((s) => s.startsWith("title:"))).toBe(true);
	});

	it("detects income_statement from sheet_name 'P&L'", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "P&L" }));
		expect(result.layout).toBe("income_statement");
	});

	it("detects income_statement from sheet_name 'Pro Forma'", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Pro Forma Financials" }));
		expect(result.layout).toBe("income_statement");
	});

	// 5. Income statement from content
	it("detects income_statement from content row labels (Total Revenues + Gross Profit)", () => {
		const result = classifyPage(
			makeExcelRange({ rowLabels: ["Total Revenues", "Gross Profit", "Operating Expenses"] })
		);
		expect(result.layout).toBe("income_statement");
	});

	// 6. Income statement high confidence (≥ 2 signals)
	it("assigns high confidence to income_statement with ≥ 2 signals", () => {
		const result = classifyPage(
			makeExcelRange({
				sheet_name: "Income Statement",
				rowLabels:  ["Total Revenues", "Gross Profit"],
			})
		);
		expect(result.layout).toBe("income_statement");
		expect(result.confidence).toBe("high");
		expect(result.matched_signals.length).toBeGreaterThanOrEqual(2);
	});

	// 7. Use of funds (excel_range) from title
	it("detects use_of_funds from sheet_name 'Use of Funds'", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Use of Funds" }));
		expect(result.layout).toBe("use_of_funds");
		expect(result.confidence).toMatch(/^high|medium$/);
	});

	it("detects use_of_funds from sheet_name 'Allocation of Funds'", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Allocation of Funds" }));
		expect(result.layout).toBe("use_of_funds");
	});

	it("detects use_of_funds from sheet_name 'Use of Proceeds'", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Use of Proceeds" }));
		expect(result.layout).toBe("use_of_funds");
	});

	// 8. Use of funds from content signals
	it("detects use_of_funds from content: allocation + sales & marketing", () => {
		const result = classifyPage(
			makeExcelRange({ rowLabels: ["Allocation", "Engineering", "Sales & Marketing", "Operations"] })
		);
		expect(result.layout).toBe("use_of_funds");
	});

	// 9. Use of funds timeseries (excel_sheet) — month signals
	it("detects use_of_funds timeseries from excel_sheet with monthly headers", () => {
		const result = classifyPage(
			makeExcelSheet({
				sheet_name: "Allocation of Funds",
				page_text:  "Month 1\tMonth 2\tMonth 3\tMonth 12\nYear 1 Total\nExpenses Fixed\n",
			})
		);
		expect(result.layout).toBe("use_of_funds");
		expect(result.confidence).toBe("high");
	});

	// 10. WebMax Allocation of Funds fixture
	it("classifies WebMax 'Allocation of Funds' timeseries tab as use_of_funds", () => {
		const webmaxAllocPayload: ClassifierPageInput = {
			document_id: "webmax-doc-001",
			page_index:  2,
			payload: {
				page_type:  "excel_sheet",
				sheet_name: "Allocation of Funds",
				page_text: [
					"Sheet: Allocation of Funds",
					"",
					"Category\tMonth 1\tMonth 2\tMonth 3\tMonth 6\tMonth 12\tYear 1 Total",
					"Sales & Marketing\t5000\t5000\t6000\t8000\t10000\t80000",
					"Engineering\t15000\t15000\t15000\t15000\t15000\t180000",
					"G&A\t3000\t3000\t3000\t3000\t3000\t36000",
					"Expenses Fixed\t500\t500\t500\t500\t500\t6000",
				].join("\n"),
			},
		};
		const result = classifyPage(webmaxAllocPayload);
		expect(result.layout).toBe("use_of_funds");
		expect(result.confidence).toBe("high");
		expect(result.parse_prerequisites).toEqual(
			expect.arrayContaining([expect.stringContaining("monthly header")])
		);
	});

	// 11. Budget model
	it("detects budget_model from excel_sheet with payroll signals", () => {
		const result = classifyPage(
			makeExcelSheet({
				sheet_name: "Payroll",
				page_text:  "Name\tSalary\tAnnual Cost\nJohn\t120000\t140000\nHeadcount: 12",
			})
		);
		expect(result.layout).toBe("budget_model");
	});

	it("detects budget_model from headcount sheet with salary + headcount signals", () => {
		const result = classifyPage(
			makeExcelSheet({
				sheet_name: "Headcount",
				page_text:  "Role\tBase Salary\tFully Loaded\nEngineer\t120000\t145000\n",
			})
		);
		expect(result.layout).toBe("budget_model");
		expect(result.confidence).toBe("high");
	});

	// 12. Cap table
	it("detects cap_table from sheet_name", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Cap Table" }));
		expect(result.layout).toBe("cap_table");
	});

	it("detects cap_table from capitalization keyword in sheet name", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Capitalization Table" }));
		expect(result.layout).toBe("cap_table");
	});

	// 13. Cash flow
	it("detects cash_flow from sheet_name + content", () => {
		const result = classifyPage(
			makeExcelSheet({
				sheet_name: "Cash Flow",
				page_text:  "Net Cash\tOperating Activities\nBurn Rate\t15000\n",
			})
		);
		expect(result.layout).toBe("cash_flow");
		expect(result.confidence).toBe("high");
	});

	// 14. Balance sheet
	it("detects balance_sheet from sheet_name", () => {
		const result = classifyPage(makeExcelRange({ sheet_name: "Balance Sheet" }));
		expect(result.layout).toBe("balance_sheet");
	});

	// 15. Medium confidence: single content signal (below highThreshold of 2)
	it("assigns medium confidence for a single content signal for income_statement", () => {
		// income_statement has highThreshold=2, mediumThreshold=1
		// "Gross Profit" alone satisfies exactly 1 content signal → medium confidence
		const result = classifyPage(
			makeExcelRange({ rowLabels: ["Gross Profit"] })
		);
		expect(result.layout).toBe("income_statement");
		expect(result.confidence).toBe("medium");
		expect(result.matched_signals).toHaveLength(1);
	});
});

// ─── Deal-level tests ───────────────────────────────────────────────────────

describe("classifyDealLayouts", () => {
	// 16. has_income_statement flag
	it("sets has_income_statement=true when any page is classified as income_statement", () => {
		const pages: ClassifierPageInput[] = [
			makeExcelRange({ sheet_name: "Income Statement" }),
			makeExcelRange({ sheet_name: "Summary" }),
		];
		const result = classifyDealLayouts("deal-001", pages);
		expect(result.has_income_statement).toBe(true);
		expect(result.has_use_of_funds).toBe(false);
	});

	// 17. has_use_of_funds flag
	it("sets has_use_of_funds=true when any page is classified as use_of_funds", () => {
		const pages: ClassifierPageInput[] = [
			makeExcelRange({ sheet_name: "Use of Funds" }),
		];
		const result = classifyDealLayouts("deal-002", pages);
		expect(result.has_use_of_funds).toBe(true);
		expect(result.has_income_statement).toBe(false);
	});

	// 18. has_budget_model flag
	it("sets has_budget_model=true when any page is classified as budget_model", () => {
		const pages: ClassifierPageInput[] = [
			makeExcelSheet({ sheet_name: "Payroll", page_text: "Salary\nHeadcount 10\nPayroll total" }),
		];
		const result = classifyDealLayouts("deal-003", pages);
		expect(result.has_budget_model).toBe(true);
	});

	// 19. layout_coverage_pct
	it("calculates layout_coverage_pct correctly", () => {
		const pages: ClassifierPageInput[] = [
			makeExcelRange({ sheet_name: "Income Statement" }),   // classified
			makeExcelRange({ sheet_name: "Use of Funds" }),       // classified
			makeExcelRange({ sheet_name: "Random Notes" }),       // unknown
			makeExcelRange({ sheet_name: "Another Unknown Sheet" }), // unknown
		];
		const result = classifyDealLayouts("deal-004", pages);
		expect(result.total_xl_pages).toBe(4);
		expect(result.classified_pages).toBe(2);
		expect(result.layout_coverage_pct).toBe(50);
	});

	// 20. Non-excel pages excluded from total_xl_pages
	it("excludes non-excel pages from total_xl_pages and classified_pages counts", () => {
		const pages: ClassifierPageInput[] = [
			makeExcelRange({ sheet_name: "Income Statement" }), // xl
			makeNonExcel("image"),                               // non-xl → excluded
			makeNonExcel("pdf_text"),                            // non-xl → excluded
		];
		const result = classifyDealLayouts("deal-005", pages);
		expect(result.total_xl_pages).toBe(1);
		expect(result.classified_pages).toBe(1);
		expect(result.layout_coverage_pct).toBe(100);
	});

	it("returns schema_version and deal_id correctly", () => {
		const result = classifyDealLayouts("deal-xyz", []);
		expect(result.schema_version).toBe("financial_layout_classifier_v1");
		expect(result.deal_id).toBe("deal-xyz");
	});

	it("returns 0 coverage when there are no excel pages", () => {
		const result = classifyDealLayouts("deal-empty", [makeNonExcel("pdf_text")]);
		expect(result.total_xl_pages).toBe(0);
		expect(result.layout_coverage_pct).toBe(0);
	});

	it("groups pages by document and produces per-doc summaries", () => {
		const pages: ClassifierPageInput[] = [
			{ document_id: DOC_A, page_index: 0, payload: { page_type: "excel_range", sheet_name: "Income Statement", structured: { rows_preview: [] } } },
			{ document_id: DOC_B, page_index: 1, payload: { page_type: "excel_range", sheet_name: "Use of Funds",     structured: { rows_preview: [] } } },
		];
		const result = classifyDealLayouts("deal-multi", pages);
		expect(result.documents).toHaveLength(2);
		const docAId = result.documents.find((d) => d.doc_id === DOC_A);
		const docBId = result.documents.find((d) => d.doc_id === DOC_B);
		expect(docAId?.dominant_layout).toBe("income_statement");
		expect(docBId?.dominant_layout).toBe("use_of_funds");
	});
});
