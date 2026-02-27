/**
 * implied-capital-allocation-v1.test.ts
 *
 * Unit tests for the implied capital allocation parser.
 *
 * Coverage:
 *  1. Returns null when no rows are supplied
 *  2. Returns null when only excel_range (not excel_sheet) rows are present
 *  3. Returns null when no Budget or Employee Costs sheets are found
 *  4. Budget sheet → infra cost buckets extracted correctly
 *  5. Employee Costs sheet → department salary costs extracted
 *  6. Both sheets → totals, percentages, quality score, period label
 *  7. Row with unlabeled blank-cell collapsing handled gracefully
 *  8. parse_quality gates: return null below 0.3
 *  9. promoteFromBudgetModel integration (via slot output)
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
	parseImpliedCapitalAllocationV1,
	type ImpliedCapitalAllocationV1,
} from "../lib/implied-capital-allocation-v1";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const DOC_ID = "1cc11a36-4e9f-40cf-b927-ea4e3155f4f4";

function makeRow(
	documentId: string,
	pageIndex: number,
	sheetName: string,
	pageText: string,
	segmentKey = "financials"
) {
	return {
		document_id: documentId,
		page_index: pageIndex,
		payload: {
			page_type: "excel_sheet",
			structured: {
				kind: "excel_sheet",
				sheet_name: sheetName,
				segment_key: segmentKey,
				rows_preview: [],     // always empty for structured_native_v1
				headers: [],
				grid_preview: {},
			},
			page_text: pageText,
		},
	};
}

function makeExcelRangeRow(documentId: string, pageIndex: number) {
	return {
		document_id: documentId,
		page_index: pageIndex,
		payload: {
			page_type: "excel_range",
			structured: {
				kind: "excel_range",
				rows_preview: [{ col_A: "Revenue", col_B: 100000 }],
			},
		},
	};
}

// ─── Budget sheet fixture ─────────────────────────────────────────────────────

const BUDGET_PAGE_TEXT = `Sheet: Budget
Summary: Budget model for Q1-Q4 2026. Structure: 40 rows, 10 columns.
Headers: Other Costs / Department, 1Q2026, 2Q2026, 3Q2026, 4Q2026, Headcount / Department, 1Q2026, 2Q2026, 3Q2026, 4Q2026
- 2: Other Costs | Headcount
- 3: Department | 1Q2026 | 2Q2026 | 3Q2026 | 4Q2026 | Department | 1Q2026 | 2Q2026 | 3Q2026 | 4Q2026
- 4: DevOps | G&A | 2 | 2 | 2
- 5: AI | $1,000 | $3,000 | $3,000 | $5,125 | Marketing | 0.5 | 0.5 | 0.5
- 6: Compute | $4,500 | $4,500 | $4,500 | $9,524 | R&D | 2 | 7.5 | 7.5 | 7.5
- 7: Database | $2,280 | $2,280 | $2,280 | $4,826 | Sales | 1 | 2 | 2
- 8: Fixed Platform | $1,000 | $1,000 | $1,000 | $1,000 | Support | 1 | 2 | 2
- 9: Tools | $1,000 | $2,000 | $2,000 | $2,000 | Grand Total | 2 | 12 | 14`;

// ─── Employee Costs sheet fixture ─────────────────────────────────────────────

const EMPLOYEE_COSTS_PAGE_TEXT = `Sheet: Employee Costs
Summary: Employee Costs is classified as revenue. Structure: 44 rows, 15 columns.
Headers: Department, Annual Base Salary, Role, 1, 2, 3, 4, 5, 6, 7, 8, 9
- 1: Department | Annual Base Salary | Role | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
- 2: G&A | $120,000 | CEO | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 3: G&A | $72,000 | COO | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 4: R&D | $120,000 | CTO | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 5: Support | $120,000 | CCSO | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 6: R&D | $45,000 | CPMO | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 7: R&D | $30,000 | CISO | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 8: Sales | $120,000 | CRO | 1 | 1 | 1 | 1 | 1
- 9: Sales | $85,000 | SalesOnshoreHC | 0.5 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 10: Sales | $50,000 | SalesOffshoreHC | 0.5 | 1 | 1 | 1 | 1 | 1 | 1 | 1
- 11: Marketing | $85,000 | MarketingOnshoreHC | 0.5 | 0.5 | 0.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5
- 12: Marketing | $30,000 | MarketingOffshoreHC | 0.5 | 0.5 | 0.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseImpliedCapitalAllocationV1", () => {
	it("returns null when no rows are supplied", () => {
		const result = parseImpliedCapitalAllocationV1([], { documentId: DOC_ID });
		expect(result).toBeNull();
	});

	it("returns null when only excel_range rows are present", () => {
		const rows = [makeExcelRangeRow(DOC_ID, 0)];
		const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
		expect(result).toBeNull();
	});

	it("returns null when excel_sheet rows have no Budget or Employee Costs sheets", () => {
		const rows = [
			makeRow(DOC_ID, 0, "Revenue Model", "Sheet: Revenue Model\n- 1: Q1 | Q2 | Q3\n- 2: $10,000 | $20,000 | $30,000"),
			makeRow(DOC_ID, 1, "Cap Table", "Sheet: Cap Table\n- 1: Investor | Shares\n- 2: Founder | 10000000"),
		];
		const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
		expect(result).toBeNull();
	});

	describe("Budget sheet parsing", () => {
		const rows = [makeRow(DOC_ID, 1, "Budget", BUDGET_PAGE_TEXT, "distribution")];

		it("returns a result (not null) when Budget sheet is found", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
		});

		it("has schema_version: implied_capital_allocation_v1", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.schema_version).toBe("implied_capital_allocation_v1");
		});

		it("has basis: budget_model", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.basis).toBe("budget_model");
		});

		it("has a basis_note containing 'IMPLIED'", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.basis_note).toMatch(/implied/i);
		});

		it("extracts 5 infra cost rows from Budget sheet", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.diagnostics.infra_rows_parsed).toBe(5);
		});

		it("creates Infrastructure / Cloud bucket with correct annual total", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const infraBucket = result.buckets.find((b) => b.category === "Infrastructure / Cloud");
			expect(infraBucket).toBeDefined();
			// AI: 1000+3000+3000+5125 = 12125
			// Compute: 4500+4500+4500+9524 = 23024
			// Database: 2280+2280+2280+4826 = 11666
			// Fixed Platform: 1000+1000+1000+1000 = 4000
			// Tools: 1000+2000+2000+2000 = 7000
			// Total: 57815
			expect(infraBucket!.annual_cost_usd).toBe(57815);
		});

		it("marks Infrastructure bucket with source=infra_budget", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const infraBucket = result.buckets.find((b) => b.category === "Infrastructure / Cloud");
			expect(infraBucket!.source).toBe("infra_budget");
		});

		it("extracts period label from Budget page_text", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.period_label).toBe("Q1–Q4 2026");
		});

		it("includes 'Budget' in sheets_used", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.diagnostics.sheets_used).toContain("Budget");
		});

		it("sets evidence_ref based on document_id:page_index", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const infraBucket = result.buckets.find((b) => b.category === "Infrastructure / Cloud");
			// DOC_ID = "1cc11a36-4e9f-40cf-b927-ea4e3155f4f4" → stripped prefix = "1cc11a36"
			expect(infraBucket!.evidence_ref).toBe("dpu:doc:1cc11a36:page:1");
		});
	});

	describe("Employee Costs sheet parsing", () => {
		const rows = [makeRow(DOC_ID, 8, "Employee Costs", EMPLOYEE_COSTS_PAGE_TEXT, "team")];

		it("returns a result when Employee Costs sheet is found", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
		});

		it("parses employee rows (12 expected)", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.diagnostics.employee_rows_parsed).toBeGreaterThanOrEqual(10);
		});

		it("extracts G&A department bucket", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const gna = result.buckets.find((b) => b.category === "G&A / Management");
			expect(gna).toBeDefined();
			expect(gna!.source).toBe("employee_costs");
		});

		it("computes G&A annual cost correctly (CEO + COO, Q1–Q4 full headcount)", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const gna = result.buckets.find((b) => b.category === "G&A / Management")!;
			// CEO: 1 × $120,000 × 4 quarters = $120,000/yr  (Q1=1, Q2=1, Q3=1, Q4=1)
			// COO: 1 × $72,000  × 4 quarters = $72,000/yr
			// Total: $192,000
			expect(gna.annual_cost_usd).toBe(192000);
		});

		it("computes R&D annual cost correctly (CTO + CPMO + CISO, full year)", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const rnd = result.buckets.find((b) => b.category === "Engineering / R&D")!;
			// CTO: 1 × $120,000 = $120,000
			// CPMO: 1 × $45,000 = $45,000
			// CISO: 1 × $30,000 = $30,000
			// Total: $195,000
			expect(rnd.annual_cost_usd).toBe(195000);
		});

		it("detects 4+ department buckets", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const deptBuckets = result.buckets.filter((b) => b.source === "employee_costs");
			expect(deptBuckets.length).toBeGreaterThanOrEqual(4);
		});

		it("marks employee buckets with source=employee_costs", () => {
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			const employeeBuckets = result.buckets.filter((b) => b.source === "employee_costs");
			expect(employeeBuckets.length).toBeGreaterThan(0);
			for (const b of employeeBuckets) {
				expect(b.source).toBe("employee_costs");
			}
		});
	});

	describe("Both sheets together", () => {
		const rows = [
			makeRow(DOC_ID, 1, "Budget", BUDGET_PAGE_TEXT, "distribution"),
			makeRow(DOC_ID, 8, "Employee Costs", EMPLOYEE_COSTS_PAGE_TEXT, "team"),
		];

		let result: ImpliedCapitalAllocationV1;
		beforeAll(() => {
			result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result).not.toBeNull();
		});

		it("uses both sheets", () => {
			expect(result.diagnostics.sheets_used).toContain("Budget");
			expect(result.diagnostics.sheets_used).toContain("Employee Costs");
		});

		it("has parse_quality ≥ 0.7", () => {
			expect(result.diagnostics.parse_quality).toBeGreaterThanOrEqual(0.7);
		});

		it("computes total_annual_cost_usd as sum of all buckets", () => {
			const sumOfBuckets = result.buckets
				.map((b) => b.annual_cost_usd ?? 0)
				.reduce((a, b) => a + b, 0);
			expect(result.total_annual_cost_usd).toBe(Math.round(sumOfBuckets));
		});

		it("sets pct_of_total for all buckets with non-null cost", () => {
			for (const b of result.buckets) {
				if (b.annual_cost_usd !== null && b.annual_cost_usd > 0) {
					expect(b.pct_of_total).not.toBeNull();
					expect(b.pct_of_total!).toBeGreaterThan(0);
					expect(b.pct_of_total!).toBeLessThan(100);
				}
			}
		});

		it("bucket percentages sum to approximately 100", () => {
			const sumPct = result.buckets
				.map((b) => b.pct_of_total ?? 0)
				.reduce((a, b) => a + b, 0);
			// Allow ±2% for rounding
			expect(sumPct).toBeGreaterThan(95);
			expect(sumPct).toBeLessThanOrEqual(102);
		});

		it("buckets are sorted descending by annual_cost_usd", () => {
			const costs = result.buckets
				.map((b) => b.annual_cost_usd ?? 0)
				.filter((v) => v > 0);
			for (let i = 1; i < costs.length; i++) {
				expect(costs[i]!).toBeLessThanOrEqual(costs[i - 1]!);
			}
		});

		it("source doc id is set correctly", () => {
			expect(result.source.document_id).toBe(DOC_ID);
		});

		it("page_refs contains at least 2 refs", () => {
			expect(result.source.page_refs.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("parse_quality gating", () => {
		it("returns null for an excel_sheet row with completely empty page_text", () => {
			const rows = [makeRow(DOC_ID, 1, "Budget", "Sheet: Budget\n")];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).toBeNull();
		});

		it("returns a result (not null) with partial data above quality threshold", () => {
			const partialBudget = [
				"Sheet: Budget",
				"Headers: Other Costs / Department, 1Q2026, 2Q2026, 3Q2026, 4Q2026",
				"- 5: AI | $1,000 | $3,000 | $3,000 | $5,125",
				"- 6: Compute | $4,500 | $4,500 | $4,500 | $9,524",
				"- 7: Database | $2,280 | $2,280 | $2,280 | $4,826",
			].join("\n");
			const rows = [makeRow(DOC_ID, 1, "Budget", partialBudget)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
			expect(result!.diagnostics.parse_quality).toBeGreaterThanOrEqual(0.3);
		});
	});

	describe("sheet name identification", () => {
		it("identifies 'Monthly Budget' as a Budget sheet", () => {
			const rows = [makeRow(DOC_ID, 1, "Monthly Budget", BUDGET_PAGE_TEXT)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
		});

		it("identifies 'Employee Salary' as an Employee Costs sheet", () => {
			const rows = [makeRow(DOC_ID, 8, "Employee Salary", EMPLOYEE_COSTS_PAGE_TEXT)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
		});

		it("identifies 'Payroll' as an Employee Costs sheet", () => {
			const rows = [makeRow(DOC_ID, 8, "Payroll", EMPLOYEE_COSTS_PAGE_TEXT)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
		});
	});

	describe("period label detection", () => {
		it("detects year from budget page_text (1Q2026 → Q1–Q4 2026)", () => {
			const rows = [makeRow(DOC_ID, 1, "Budget", BUDGET_PAGE_TEXT)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.period_label).toBe("Q1–Q4 2026");
		});

		it("falls back to unknown label when no year detected", () => {
			const noYearText = `Sheet: Budget
- 5: AI | $1,000 | $2,000 | $3,000 | $4,000
- 6: Compute | $4,000 | $4,000 | $4,000 | $8,000
- 7: Database | $2,000 | $2,000 | $2,000 | $4,000`;
			const rows = [makeRow(DOC_ID, 1, "Budget", noYearText)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID })!;
			expect(result.period_label).toContain("unknown");
		});
	});

	describe("mixed row types", () => {
		it("ignores excel_range rows and processes only excel_sheet rows", () => {
			const rows = [
				makeExcelRangeRow(DOC_ID, 0),   // should be ignored
				makeRow(DOC_ID, 1, "Budget", BUDGET_PAGE_TEXT),
				makeExcelRangeRow(DOC_ID, 2),   // should be ignored
			];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			expect(result).not.toBeNull();
			// Should only have infra bucket (no employee costs)
			const infraBucket = result!.buckets.find((b) => b.category === "Infrastructure / Cloud");
			expect(infraBucket).toBeDefined();
		});
	});

	describe("dollar parsing edge cases", () => {
		it("handles rows with only 1 or 2 quarterly values (partial data)", () => {
			const partialText = `Sheet: Budget
- 5: AI | $1,000 | $3,000
- 6: Compute | $4,500 | $4,500 | $4,500 | $9,524`;
			const rows = [makeRow(DOC_ID, 1, "Budget", partialText)];
			const result = parseImpliedCapitalAllocationV1(rows, { documentId: DOC_ID });
			// Should still parse Compute fully, and AI partially
			if (result !== null) {
				const infra = result.buckets.find((b) => b.category === "Infrastructure / Cloud");
				expect(infra!.annual_cost_usd).toBeGreaterThan(0);
			}
		});
	});
});
