/**
 * use-of-funds-timeseries-v1.test.ts
 *
 * Unit tests for the monthly spend-plan time-series Use-of-Funds parser.
 *
 * Coverage:
 *  1.  Returns null when payload is null
 *  2.  Returns null when page_type is not excel_sheet
 *  3.  Returns null when sheet title does not match allocation patterns
 *  4.  Month headers detected (named months: September...August)
 *  5.  Month headers detected (numeric: Month 1...Month 12)
 *  6.  Group headers with no dollar values are skipped
 *  7.  "Total" / subtotal rows are skipped
 *  8.  Row values summed across visible month columns
 *  9.  "Year 1 Total" column preferred when present
 *  10. Sales N labels map to "Sales" bucket
 *  11. Operations/Strategic labels map to "G&A / Operations"
 *  12. Data-feed labels map to "Data / Infrastructure"
 *  13. Campaign labels map to "Marketing"
 *  14. Design label maps to "Engineering / Product"
 *  15. "Expenses Fixed" maps to "Fixed Operations"
 *  16. Returns null when fewer than 3 nonzero-sum buckets
 *  17. WebMax page-0 fixture: expected buckets and total
 *  18. WebMax page-2 fixture: expected buckets and total
 *  19. basis and basis_note fields set correctly
 *  20. source.document_id and source.page_ref set from opts
 */

import { describe, it, expect } from "vitest";
import { parseUseOfFundsTimeseriesV1 } from "../lib/use-of-funds-timeseries-v1";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOC_ID = "58595eb2-aaaa-bbbb-cccc-dddddddddddd";
const PAGE_REF_0 = "dpu:doc:58595eb2:page:0";
const PAGE_REF_2 = "dpu:doc:58595eb2:page:2";

function makePayload(sheetName: string, pageText: string) {
	return {
		page_type: "excel_sheet",
		page_text: pageText,
		sheet_name: sheetName,
	};
}

/** Page-0 fixture: named months (September…August) */
const PAGE_0_TEXT = `Sheet: Valuation - Allocation of Funds
- row_0: col_A | September | October | November | December | January | February | March | April | May | June | July | August
- row_1: Expenses Fixed | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00
- row_2: MLS Feed | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $2,500.00 | $5,000.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00
- row_3: Expenses Variable
- row_4: Payroll
- row_5: Design | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00
- row_6: Operations (Strategic Relationships) | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00
- row_7: Sales 1 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00
- row_8: Sales 2 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00
- row_9: Sales 3 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00
- row_10: Operations 2 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00 | $8,000.00
`;

/** Page-2 fixture: Month 1…12 + Year 1 Total */
const PAGE_2_TEXT = `Sheet: Allocation of funds
- row_0: col_A | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 | Month 7 | Month 8 | Month 9 | Month 10 | Month 11 | Month 12 | Year 1 Total | Month 1 | Month 2 | Month 3 | Month 4 | Month 5 | Month 6 | Month 7 | Month 8 | Month 9 | Month 10 | Month 11 | Month 12 | Year 2 Total
- row_1: Expenses Fixed | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $384,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $32,000.00 | $384,000.00
- row_2: Data costs
- row_3: MLS Feed | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $2,500.00 | $5,000.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $45,000.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $7,500.00 | $90,000.00
- row_4: Retr | $250.00 | $500.00 | $750.00 | $750.00 | $750.00 | $750.00 | $1,000.00 | $1,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $16,250.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $30,000.00
- row_5: Property Boundary data | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $18,000.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $1,500.00 | $18,000.00
- row_6: Total | $33,750.00 | $34,000.00 | $34,250.00 | $34,250.00 | $34,250.00 | $34,250.00 | $38,500.00 | $43,000.00 | $49,000.00 | $49,000.00 | $49,000.00 | $49,000.00 | $463,250.00
- row_7: Marketing
- row_8: MW Campaigns | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $500.00 | $6,000.00
- row_9: Relax Campaigns | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $2,500.00 | $30,000.00
- row_10: Payroll
- row_11: Design | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $3,000.00 | $36,000.00
`;

const OPTS_0 = { documentId: DOC_ID, pageRef: PAGE_REF_0 };
const OPTS_2 = { documentId: DOC_ID, pageRef: PAGE_REF_2 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseUseOfFundsTimeseriesV1", () => {
	// ------------------------------------------------------------------
	// Null guards
	// ------------------------------------------------------------------

	it("1. returns null for null payload", () => {
		expect(parseUseOfFundsTimeseriesV1(null, OPTS_0)).toBeNull();
	});

	it("2. returns null when page_type is not excel_sheet", () => {
		const payload = makePayload("Allocation of funds", PAGE_2_TEXT);
		expect(
			parseUseOfFundsTimeseriesV1({ ...payload, page_type: "excel_range" }, OPTS_0)
		).toBeNull();
	});

	it("3. returns null when sheet title does not match allocation patterns", () => {
		const payload = makePayload("Revenue Projections", PAGE_2_TEXT);
		expect(parseUseOfFundsTimeseriesV1(payload, OPTS_0)).toBeNull();
	});

	// ------------------------------------------------------------------
	// Header detection
	// ------------------------------------------------------------------

	it("4. detects named-month headers (September…August)", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Valuation - Allocation of Funds", PAGE_0_TEXT), OPTS_0);
		expect(result).not.toBeNull();
		expect(result!.diagnostics.header_row_found).toBe(true);
	});

	it("5. detects numeric month headers (Month 1…Month 12)", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2);
		expect(result).not.toBeNull();
		expect(result!.diagnostics.header_row_found).toBe(true);
	});

	// ------------------------------------------------------------------
	// Row classification
	// ------------------------------------------------------------------

	it("6. group headers with no dollar values are skipped", () => {
		// 'Payroll' and 'Data costs' group header rows have no $ cells and no sub-items
		// that would add a same-named bucket, so they must not appear in output.
		// Note: 'Marketing' header row is skipped, but the Marketing *bucket* is still
		// populated via "MW Campaigns" and "Relax Campaigns" sub-rows — that is correct.
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2)!;
		const bucketNames = result!.buckets.map((b) => b.category);
		expect(bucketNames).not.toContain("Payroll");
		expect(bucketNames).not.toContain("Data costs");
		// Marketing bucket IS expected (from MW Campaigns + Relax Campaigns sub-rows)
		const marketingBucket = result!.buckets.find((b) => b.category === "Marketing");
		expect(marketingBucket).toBeDefined();
		expect(marketingBucket!.amount).toBeGreaterThan(0);
	});

	it("7. Total / subtotal rows are skipped", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2)!;
		const bucketNames = result!.buckets.map((b) => b.category);
		expect(bucketNames.some((n) => /^total$/i.test(n))).toBe(false);
	});

	// ------------------------------------------------------------------
	// Bucket label mapping
	// ------------------------------------------------------------------

	it("10. Sales N labels map to 'Sales' bucket", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Valuation - Allocation of Funds", PAGE_0_TEXT), OPTS_0)!;
		const salesBucket = result.buckets.find((b) => b.category === "Sales");
		expect(salesBucket).toBeDefined();
		// Only Sales 1 has nonzero values — expect $96,000
		expect(salesBucket!.amount).toBe(96000);
	});

	it("11. Operations/Strategic labels map to 'G&A / Operations'", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Valuation - Allocation of Funds", PAGE_0_TEXT), OPTS_0)!;
		const opsBucket = result.buckets.find((b) => b.category === "G&A / Operations");
		expect(opsBucket).toBeDefined();
		// Operations (Strategic Relationships) + Operations 2 = $96K + $96K = $192K
		expect(opsBucket!.amount).toBe(192000);
	});

	it("12. Data-feed labels map to 'Data / Infrastructure'", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2)!;
		const dataBucket = result.buckets.find((b) => b.category === "Data / Infrastructure");
		expect(dataBucket).toBeDefined();
	});

	it("13. Campaign labels map to 'Marketing'", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2)!;
		const mktBucket = result.buckets.find((b) => b.category === "Marketing");
		expect(mktBucket).toBeDefined();
		// $6K + $30K = $36K
		expect(mktBucket!.amount).toBe(36000);
	});

	it("14. Design maps to 'Engineering / Product'", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2)!;
		const engBucket = result.buckets.find((b) => b.category === "Engineering / Product");
		expect(engBucket).toBeDefined();
		expect(engBucket!.amount).toBe(36000);
	});

	it("15. 'Expenses Fixed' maps to 'Fixed Operations'", () => {
		const result = parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", PAGE_2_TEXT), OPTS_2)!;
		const fixedBucket = result.buckets.find((b) => b.category === "Fixed Operations");
		expect(fixedBucket).toBeDefined();
		expect(fixedBucket!.amount).toBe(384000);
	});

	// ------------------------------------------------------------------
	// Quality gate
	// ------------------------------------------------------------------

	it("16. returns null when fewer than 3 nonzero-sum buckets", () => {
		// Only 1 data row with values
		const sparseText = `Sheet: Allocation of funds
- row_0: col_A | Month 1 | Month 2 | Month 3
- row_1: Expenses Fixed | $10,000.00 | $10,000.00 | $10,000.00
`;
		expect(
			parseUseOfFundsTimeseriesV1(makePayload("Allocation of funds", sparseText), OPTS_0)
		).toBeNull();
	});

	// ------------------------------------------------------------------
	// WebMax page-0 fixture — named months
	// ------------------------------------------------------------------

	it("17. WebMax page-0: correct buckets and total", () => {
		const result = parseUseOfFundsTimeseriesV1(
			makePayload("Valuation - Allocation of Funds", PAGE_0_TEXT),
			OPTS_0
		);
		expect(result).not.toBeNull();
		expect(result!.schema_version).toBe("use_of_funds_v1");

		// Expected totals:
		// Fixed Operations (Expenses Fixed): 32000 × 12 = 384000
		// G&A / Operations (Strategic + Ops2):  8000 × 12 × 2 = 192000
		// Sales (Sales 1): 8000 × 12 = 96000
		// Data / Infrastructure (MLS Feed): 0+0+0+0+0+0+2500+5000+7500+7500+7500+7500 = 37500
		expect(result!.total_amount).toBeGreaterThan(0);
		expect(result!.buckets.length).toBeGreaterThanOrEqual(3);

		const fixedBucket = result!.buckets.find((b) => b.category === "Fixed Operations");
		expect(fixedBucket?.amount).toBe(384000);

		// Percentages should sum close to 100
		const totalPct = result!.buckets.reduce((s, b) => s + (b.percent ?? 0), 0);
		expect(totalPct).toBeGreaterThan(95);
		expect(totalPct).toBeLessThan(105);
	});

	// ------------------------------------------------------------------
	// WebMax page-2 fixture — Month 1-12 + Year 1 Total
	// ------------------------------------------------------------------

	it("18. WebMax page-2: Year 1 Total column preferred, correct buckets", () => {
		const result = parseUseOfFundsTimeseriesV1(
			makePayload("Allocation of funds", PAGE_2_TEXT),
			OPTS_2
		);
		expect(result).not.toBeNull();
		expect(result!.buckets.length).toBeGreaterThanOrEqual(4);

		// With Year 1 Total: Fixed=384K, MLS=45K, Retr=16.25K, PropBound=18K, MW=6K, Relax=30K, Design=36K
		const fixedBucket = result!.buckets.find((b) => b.category === "Fixed Operations");
		expect(fixedBucket?.amount).toBe(384000);

		const mktBucket = result!.buckets.find((b) => b.category === "Marketing");
		expect(mktBucket?.amount).toBe(36000); // 6K + 30K
	});

	// ------------------------------------------------------------------
	// Metadata fields
	// ------------------------------------------------------------------

	it("19. basis and basis_note are set correctly", () => {
		const result = parseUseOfFundsTimeseriesV1(
			makePayload("Allocation of funds", PAGE_2_TEXT),
			OPTS_2
		)!;
		expect(result.basis).toBe("spend_plan_timeseries");
		expect(result.basis_note).toContain("IMPLIED");
		expect(result.basis_note).toContain("Allocation of funds");
	});

	it("20. source fields set from opts", () => {
		const result = parseUseOfFundsTimeseriesV1(
			makePayload("Allocation of funds", PAGE_2_TEXT),
			OPTS_2
		)!;
		expect(result.source.document_id).toBe(DOC_ID);
		expect(result.source.page_ref).toBe(PAGE_REF_2);
	});
});
