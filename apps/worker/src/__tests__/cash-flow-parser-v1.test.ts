/**
 * cash-flow-parser-v1.test.ts
 *
 * Unit tests for the deterministic cash-flow statement parser.
 *
 * Coverage:
 *  1.  Null payload → null
 *  2.  Wrong page_type → null
 *  3.  No recognized cash-flow fields → null (minimum requirement)
 *  4.  net_cash_from_ops recognized → result returned
 *  5.  net_change_in_cash alone satisfies minimum requirement
 *  6.  Period header row detected → periods populated
 *  7.  Single-period fallback → periods = ["P0"]
 *  8.  derived.monthly_burn_from_ops computed when ops < 0
 *  9.  No burn when ops > 0 (profitable ops)
 * 10.  derived.runway_months computed when ending_cash + burn present
 * 11.  ending_cash populated
 * 12.  pickBestCashFlow: null for empty array
 * 13.  pickBestCashFlow: returns single item unchanged
 * 14.  pickBestCashFlow: prefers entry with more populated fields
 */

import { describe, it, expect } from "vitest";
import { parseCashFlowStatementV1, pickBestCashFlow } from "../lib/cash-flow-parser-v1";

const SRC = { documentId: "test-doc-cf", pageRef: "sheet:Cash Flow:0" };

function makePayload(
	rows: Array<{ col_A?: string; col_C?: number | null }>,
	opts?: { kind?: string },
): unknown {
	return {
		page_type:  "excel_range",
		sheet_name: "Cash Flow Statement",
		structured: {
			kind:         opts?.kind ?? "excel_range",
			rows_preview: rows.map((r) => ({ col_A: r.col_A ?? null, col_C: r.col_C ?? null })),
		},
	};
}

describe("parseCashFlowStatementV1", () => {
	it("1. returns null for null payload", () => {
		expect(parseCashFlowStatementV1(null, SRC)).toBeNull();
	});

	it("2. returns null for wrong page_type", () => {
		const p = { page_type: "image", structured: { kind: "excel_range", rows_preview: [] } };
		expect(parseCashFlowStatementV1(p, SRC)).toBeNull();
	});

	it("3. returns null when no cash-flow fields present", () => {
		const p = makePayload([{ col_A: "Revenue", col_C: 50000 }]);
		expect(parseCashFlowStatementV1(p, SRC)).toBeNull();
	});

	it("4. recognizes net_cash_from_ops — result returned", () => {
		const p = makePayload([{ col_A: "Net Cash from Operating Activities", col_C: -25000 }]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.net_cash_from_ops).toBeDefined();
	});

	it("5. net_change_in_cash alone satisfies minimum", () => {
		const p = makePayload([{ col_A: "Net Change in Cash", col_C: -5000 }]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.net_change_in_cash).toBeDefined();
	});

	it("6. period header row detected → periods populated", () => {
		const p = makePayload([
			{ col_A: "",          col_C: 2024 },
			{ col_A: "Net Cash from Operating Activities", col_C: -30000 },
		]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result!.periods).toContain("2024");
	});

	it("7. single-period fallback → periods = ['P0']", () => {
		const p = makePayload([{ col_A: "Net Cash from Operating Activities", col_C: -20000 }]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result!.periods).toEqual(["P0"]);
	});

	it("8. derived.monthly_burn_from_ops computed when ops < 0", () => {
		// Annual ops of -120,000 → monthly burn = 10,000
		const p = makePayload([{ col_A: "Net Cash from Operating Activities", col_C: -120000 }]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result!.derived?.monthly_burn_from_ops).toBeCloseTo(10000, 0);
	});

	it("9. no burn derived when ops > 0 (profitable)", () => {
		const p = makePayload([{ col_A: "Net Cash from Operating Activities", col_C: 50000 }]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result!.derived?.monthly_burn_from_ops ?? null).toBeNull();
	});

	it("10. derived.runway_months computed from ending cash + burn", () => {
		// Ops: -120k/yr → 10k/mo burn; ending cash 60k → 6 months runway
		const p = makePayload([
			{ col_A: "Net Cash from Operating Activities", col_C: -120000 },
			{ col_A: "Ending Cash Balance",                col_C: 60000  },
		]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result!.derived?.runway_months).toBeCloseTo(6, 0);
	});

	it("11. ending_cash populated", () => {
		const p = makePayload([
			{ col_A: "Net Cash from Operating Activities", col_C: -60000 },
			{ col_A: "Cash at End of Period",              col_C: 120000 },
		]);
		const result = parseCashFlowStatementV1(p, SRC);
		expect(result!.ending_cash).toBeDefined();
	});
});

describe("pickBestCashFlow", () => {
	it("12. returns null for empty array", () => {
		expect(pickBestCashFlow([])).toBeNull();
	});

	it("13. returns single item unchanged", () => {
		const p = makePayload([{ col_A: "Net Cash from Operating Activities", col_C: -48000 }]);
		const item = parseCashFlowStatementV1(p, SRC)!;
		expect(pickBestCashFlow([item])).toBe(item);
	});

	it("14. prefers item with more populated fields", () => {
		const pSparse = makePayload([{ col_A: "Net Cash from Operating Activities", col_C: -60000 }]);
		const pRich   = makePayload([
			{ col_A: "Net Cash from Operating Activities", col_C: -60000 },
			{ col_A: "Net Cash from Investing Activities", col_C: -10000 },
			{ col_A: "Net Cash from Financing Activities", col_C: 100000 },
			{ col_A: "Ending Cash Balance",                col_C: 80000  },
		]);
		const sparse = parseCashFlowStatementV1(pSparse, SRC)!;
		const rich   = parseCashFlowStatementV1(pRich, SRC)!;
		expect(pickBestCashFlow([sparse, rich])).toBe(rich);
	});
});
