/**
 * cap-table-parser-v1.test.ts
 *
 * Unit tests for the deterministic cap-table parser.
 *
 * Coverage:
 *  1.  Null payload → null
 *  2.  Wrong page_type → null
 *  3.  No stakeholder rows with numeric data → null
 *  4.  Single common-stock stakeholder row → result returned
 *  5.  Preferred stock row → stakeholder.row_type = "preferred"
 *  6.  Option pool row → option_pool_pct populated + row_type = "option_pool"
 *  7.  SAFE note row → safe_notes_present = true + row_type = "safe_note"
 *  8.  Total row captured in total_shares / total_pct (not in stakeholders)
 *  9.  Multiple stakeholders accumulated correctly
 * 10.  source fields populated from arguments
 * 11.  pickBestCapTable: null for empty array
 * 12.  pickBestCapTable: returns single item unchanged
 * 13.  pickBestCapTable: prefers entry with more stakeholder rows
 * 14.  post_money_shares: populated from explicit "Post-Money Shares" row
 * 15.  post_money_shares: falls back to total_shares when no explicit row
 * 16.  post_money_shares: null when no total row and no explicit PM-shares row
 * 17.  OCR artifact: letter-O in percent treated as digit-0
 */

import { describe, it, expect } from "vitest";
import { parseCapTableV1, pickBestCapTable } from "../lib/cap-table-parser-v1";

const SRC = { documentId: "test-doc-ct", pageRef: "sheet:Cap Table:0" };

function makePayload(
	rows: Array<{ col_A?: string; col_B?: number | null; col_C?: number | null; col_D?: number | null }>,
	opts?: { kind?: string },
): unknown {
	return {
		page_type:  "excel_range",
		sheet_name: "Cap Table",
		structured: {
			kind:         opts?.kind ?? "excel_range",
			rows_preview: rows.map((r) => ({
				col_A: r.col_A ?? null,
				col_B: r.col_B ?? null,
				col_C: r.col_C ?? null,
				col_D: r.col_D ?? null,
			})),
		},
	};
}

describe("parseCapTableV1", () => {
	it("1. returns null for null payload", () => {
		expect(parseCapTableV1(null, SRC)).toBeNull();
	});

	it("2. returns null for wrong page_type", () => {
		const p = { page_type: "pdf", structured: { kind: "excel_range", rows_preview: [] } };
		expect(parseCapTableV1(p, SRC)).toBeNull();
	});

	it("3. returns null when no rows have numeric data", () => {
		const p = makePayload([{ col_A: "Stakeholder Name" }]);
		expect(parseCapTableV1(p, SRC)).toBeNull();
	});

	it("4. single common-stock stakeholder row → result returned", () => {
		const p = makePayload([{ col_A: "Founder Inc.", col_B: 1000000, col_C: 60 }]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.schema_version).toBe("cap_table_v1");
		expect(result!.stakeholders.length).toBeGreaterThan(0);
	});

	it("5. preferred stock row → row_type = 'preferred'", () => {
		const p = makePayload([{ col_A: "Series A Preferred", col_B: 500000, col_C: 30 }]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		const row = result!.stakeholders.find((s) => s.row_type === "preferred");
		expect(row).toBeDefined();
	});

	it("6. option pool row → option_pool_pct populated", () => {
		const p = makePayload([
			{ col_A: "Founder",     col_B: 1000000, col_C: 60 },
			{ col_A: "Option Pool", col_B: 200000,  col_C: 12 },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.option_pool_pct).not.toBeNull();
		const poolRow = result!.stakeholders.find((s) => s.row_type === "option_pool");
		expect(poolRow).toBeDefined();
	});

	it("7. SAFE note row → safe_notes_present = true", () => {
		const p = makePayload([
			{ col_A: "Founder",    col_B: 1000000, col_C: 80 },
			{ col_A: "SAFE Note",  col_B: 100000,  col_C: 8  },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.safe_notes_present).toBe(true);
	});

	it("8. total row not included in stakeholders array", () => {
		const p = makePayload([
			{ col_A: "Founder", col_B: 1000000, col_C: 100 },
			{ col_A: "Total",   col_B: 1000000, col_C: 100 },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		const totalRow = result!.stakeholders.find((s) => s.row_type === "total");
		expect(totalRow).toBeUndefined();
		// total_pct should capture it
		expect(result!.total_pct).not.toBeNull();
	});

	it("9. multiple stakeholders accumulated correctly", () => {
		const p = makePayload([
			{ col_A: "Founder A",        col_B: 800000,  col_C: 50 },
			{ col_A: "Founder B",        col_B: 400000,  col_C: 25 },
			{ col_A: "Series A Preferred", col_B: 400000, col_C: 25 },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result!.stakeholders.length).toBe(3);
	});

	it("10. source fields populated", () => {
		const p = makePayload([{ col_A: "Founder", col_B: 1000000, col_C: 100 }]);
		const result = parseCapTableV1(p, SRC);
		expect(result!.source.document_id).toBe("test-doc-ct");
	});

	it("14. post_money_shares: populated from explicit 'Post-Money Shares' row", () => {
		const p = makePayload([
			{ col_A: "Founder",           col_B: null, col_C: 80 },
			{ col_A: "Option Pool",       col_B: null, col_C: 20 },
			// Shares must be in col_C or later — col_B is excluded by parser design.
			// 1_000_000 > 100 so parsePctValue returns null, parseSharesValue returns 1_000_000.
			{ col_A: "Post-Money Shares", col_B: null, col_C: 1_000_000 },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.post_money_shares).toBe(1_000_000);
	});

	it("15. post_money_shares: falls back to total_shares when no explicit PM-shares row", () => {
		const p = makePayload([
			// col_B is excluded; pct goes in col_C, large integer in col_C too works since >100 → shares
			{ col_A: "Founder", col_B: null, col_C: 80 },
			// Total row: col_C = 1_000_000 > 100 → parseSharesValue → totalShares
			{ col_A: "Total",   col_B: null, col_C: 1_000_000 },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		// total_shares extracted from "Total" row
		expect(result!.total_shares).toBe(1_000_000);
		// post_money_shares falls back to total_shares
		expect(result!.post_money_shares).toBe(result!.total_shares);
	});

	it("16. post_money_shares: null when no total row and no explicit PM-shares row", () => {
		const p = makePayload([
			{ col_A: "Founder A", col_B: null, col_C: 60 },
			{ col_A: "Founder B", col_B: null, col_C: 40 },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.total_shares).toBeNull();
		expect(result!.post_money_shares).toBeNull();
	});

	it("17. OCR artifact: letter-O in percent string treated as digit-0", () => {
		const p = makePayload([
			// "5O%" looks like "50%" with letter-O OCR error → should parse as 50
			{ col_A: "Founder", col_B: null, col_C: "5O%" as any },
		]);
		const result = parseCapTableV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.stakeholders[0]!.pct).toBe(50);
	});
});

describe("pickBestCapTable", () => {
	it("11. returns null for empty array", () => {
		expect(pickBestCapTable([])).toBeNull();
	});

	it("12. returns single item unchanged", () => {
		const p = makePayload([{ col_A: "Founder", col_B: 1000000, col_C: 100 }]);
		const item = parseCapTableV1(p, SRC)!;
		expect(pickBestCapTable([item])).toBe(item);
	});

	it("13. prefers entry with more stakeholder rows", () => {
		const pSparse = makePayload([{ col_A: "Founder", col_B: 1000000, col_C: 100 }]);
		const pRich   = makePayload([
			{ col_A: "Founder A",  col_B: 800000,  col_C: 50 },
			{ col_A: "Founder B",  col_B: 400000,  col_C: 25 },
			{ col_A: "Option Pool", col_B: 200000, col_C: 12 },
			{ col_A: "Investor",   col_B: 200000,  col_C: 13 },
		]);
		const sparse = parseCapTableV1(pSparse, SRC)!;
		const rich   = parseCapTableV1(pRich,   SRC)!;
		expect(pickBestCapTable([sparse, rich])).toBe(rich);
	});
});
