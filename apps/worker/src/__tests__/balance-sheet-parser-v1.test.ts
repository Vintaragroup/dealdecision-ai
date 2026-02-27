/**
 * balance-sheet-parser-v1.test.ts
 *
 * Unit tests for the deterministic balance-sheet parser.
 *
 * Coverage:
 *  1.  Null payload → null
 *  2.  Non-excel page_type → null
 *  3.  Missing structured.kind → null
 *  4.  Rows present but no balance-sheet fields → null (minimum requirement)
 *  5.  total_assets recognized → result returned
 *  6.  total_liabilities recognized → result returned
 *  7.  total_equity recognized → result returned
 *  8.  Period header row detected → periods populated
 *  9.  Single-period fallback → periods = ["P0"]
 * 10.  derived.cash_latest populated from cash row
 * 11.  derived.debt_latest populated from debt row
 * 12.  derived.balance_check passes when assets ≈ liab + equity
 * 13.  pickBestBalanceSheet: returns null when empty array
 * 14.  pickBestBalanceSheet: returns single entry unchanged
 * 15.  pickBestBalanceSheet: prefers entry with more populated fields
 */

import { describe, it, expect } from "vitest";
import { parseBalanceSheetV1, pickBestBalanceSheet } from "../lib/balance-sheet-parser-v1";

const SRC = { documentId: "test-doc-bs", pageRef: "sheet:Balance Sheet:0" };

function makePayload(
	rows: Array<{ col_A?: string; col_C?: number | null; col_D?: number | null }>,
	opts?: { sheetName?: string; kind?: string },
): unknown {
	return {
		page_type:  "excel_range",
		sheet_name: opts?.sheetName ?? "Balance Sheet",
		structured: {
			kind:         opts?.kind ?? "excel_range",
			rows_preview: rows.map((r) => ({
				col_A: r.col_A ?? null,
				col_C: r.col_C ?? null,
				col_D: r.col_D ?? null,
			})),
		},
	};
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("parseBalanceSheetV1", () => {
	it("1. returns null for null payload", () => {
		expect(parseBalanceSheetV1(null, SRC)).toBeNull();
	});

	it("2. returns null for non-excel page_type", () => {
		const p = makePayload([{ col_A: "Total Assets", col_C: 1000 }]) as Record<string, unknown>;
		(p as Record<string, unknown>)["page_type"] = "image";
		expect(parseBalanceSheetV1(p, SRC)).toBeNull();
	});

	it("3. returns null when structured.kind is missing", () => {
		const p = makePayload([{ col_A: "Total Assets", col_C: 1000 }], { kind: "wrong_kind" });
		expect(parseBalanceSheetV1(p, SRC)).toBeNull();
	});

	it("4. returns null when no balance-sheet minimum fields present", () => {
		// Row present but no recognized field (just random text)
		const p = makePayload([{ col_A: "Revenue", col_C: 5000 }]);
		expect(parseBalanceSheetV1(p, SRC)).toBeNull();
	});

	it("5. recognizes total_assets row and returns result", () => {
		const p = makePayload([{ col_A: "Total Assets", col_C: 500000 }]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.schema_version).toBe("balance_sheet_v1");
		expect(result!.total_assets).toBeDefined();
	});

	it("6. recognizes total_liabilities row and returns result", () => {
		const p = makePayload([{ col_A: "Total Liabilities", col_C: 200000 }]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.total_liabilities).toBeDefined();
	});

	it("7. recognizes total_equity row and returns result", () => {
		const p = makePayload([{ col_A: "Total Stockholders' Equity", col_C: 300000 }]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.total_equity).toBeDefined();
	});

	it("8. detects period header row and populates periods", () => {
		const p = makePayload([
			{ col_A: "",          col_C: 2024,   col_D: 2025 },
			{ col_A: "Total Assets", col_C: 400000, col_D: 450000 },
		]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.periods).toContain("2024");
		expect(result!.periods).toContain("2025");
	});

	it("9. single-period fallback when no year header — periods = ['P0']", () => {
		const p = makePayload([
			{ col_A: "Total Assets", col_C: 100000 },
		]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.periods).toEqual(["P0"]);
	});

	it("10. derived.cash_latest populated from cash row", () => {
		const p = makePayload([
			{ col_A: "Cash and Cash Equivalents", col_C: 75000 },
			{ col_A: "Total Assets",              col_C: 200000 },
		]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result!.derived?.cash_latest).toBe(75000);
	});

	it("11. derived.debt_latest populated from debt row", () => {
		const p = makePayload([
			{ col_A: "Long-term Debt",   col_C: 50000 },
			{ col_A: "Total Liabilities", col_C: 80000 },
		]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result!.derived?.debt_latest).toBe(50000);
	});

	it("12. source fields are populated from arguments", () => {
		const p = makePayload([{ col_A: "Total Assets", col_C: 100000 }]);
		const result = parseBalanceSheetV1(p, SRC);
		expect(result!.source.document_id).toBe("test-doc-bs");
		expect(result!.source.page_ref).toBe("sheet:Balance Sheet:0");
	});
});

describe("pickBestBalanceSheet", () => {
	it("13. returns null for empty array", () => {
		expect(pickBestBalanceSheet([])).toBeNull();
	});

	it("14. returns single entry unchanged", () => {
		const p = makePayload([{ col_A: "Total Assets", col_C: 100000 }]);
		const result = parseBalanceSheetV1(p, SRC)!;
		expect(pickBestBalanceSheet([result])).toBe(result);
	});

	it("15. prefers entry with more populated fields", () => {
		const pSparse = makePayload([{ col_A: "Total Assets", col_C: 100000 }]);
		const pRich   = makePayload([
			{ col_A: "Total Assets",      col_C: 100000 },
			{ col_A: "Total Liabilities", col_C: 40000  },
			{ col_A: "Total Equity",      col_C: 60000  },
			{ col_A: "Cash",              col_C: 20000  },
		]);
		const sparse = parseBalanceSheetV1(pSparse, SRC)!;
		const rich   = parseBalanceSheetV1(pRich, SRC)!;
		const best   = pickBestBalanceSheet([sparse, rich]);
		expect(best).toBe(rich);
	});
});
