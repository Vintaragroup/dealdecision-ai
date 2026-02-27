/**
 * saas-kpis-parser-v1.test.ts
 *
 * Unit tests for the deterministic SaaS KPIs parser.
 *
 * Coverage:
 *  1.  Null payload → null
 *  2.  Wrong page_type → null
 *  3.  Rows present but no recognized KPI fields → null
 *  4.  MRR row recognized → mrr populated
 *  5.  ARR row recognized → arr populated
 *  6.  ARR derived from MRR × 12 when ARR row absent → derived.arr_from_mrr = true
 *  7.  Churn rate row → churn_pct populated (percent form)
 *  8.  Fraction-form churn (0.035) → converted to 3.5%
 *  9.  Retention rate populated
 * 10.  CAC row recognized
 * 11.  LTV row recognized → derived.ltv_cac_ratio computed when both present
 * 12.  Period header row detected → periods populated
 * 13.  Single-period fallback → periods = ["P0"]
 * 14.  derived.mrr_latest and arr_latest populated
 * 15.  pickBestSaasKpis: null for empty array
 * 16.  pickBestSaasKpis: returns single item unchanged
 */

import { describe, it, expect } from "vitest";
import { parseSaasKpisV1, pickBestSaasKpis } from "../lib/saas-kpis-parser-v1";

const SRC = { documentId: "test-doc-saas", pageRef: "sheet:SaaS KPIs:0" };

function makePayload(
	rows: Array<{ col_A?: string; col_C?: number | null; col_D?: number | null }>,
	opts?: { kind?: string },
): unknown {
	return {
		page_type:  "excel_range",
		sheet_name: "SaaS KPIs",
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

describe("parseSaasKpisV1", () => {
	it("1. returns null for null payload", () => {
		expect(parseSaasKpisV1(null, SRC)).toBeNull();
	});

	it("2. returns null for wrong page_type", () => {
		const p = { page_type: "pdf", structured: { kind: "excel_range", rows_preview: [] } };
		expect(parseSaasKpisV1(p, SRC)).toBeNull();
	});

	it("3. returns null when no recognized KPI fields present", () => {
		const p = makePayload([{ col_A: "Marketing Budget", col_C: 50000 }]);
		expect(parseSaasKpisV1(p, SRC)).toBeNull();
	});

	it("4. MRR row recognized", () => {
		const p = makePayload([{ col_A: "MRR", col_C: 120000 }]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.mrr).toBeDefined();
	});

	it("5. ARR row recognized", () => {
		const p = makePayload([{ col_A: "Annual Recurring Revenue", col_C: 1440000 }]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result).not.toBeNull();
		expect(result!.arr).toBeDefined();
	});

	it("6. ARR derived from MRR × 12 when ARR absent — derived.arr_from_mrr = true", () => {
		const p = makePayload([{ col_A: "MRR", col_C: 100000 }]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.derived?.arr_from_mrr).toBe(true);
		expect(result!.derived?.arr_latest).toBeCloseTo(1200000, 0);
	});

	it("7. churn rate populated in percent form", () => {
		const p = makePayload([
			{ col_A: "MRR",        col_C: 100000 },
			{ col_A: "Churn Rate", col_C: 5 },
		]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.churn_pct).toBeDefined();
		const p0Churn = result!.churn_pct?.["P0"] ?? result!.churn_pct?.[result!.periods[0] ?? ""];
		expect(p0Churn).toBeCloseTo(5, 1);
	});

	it("8. fraction-form churn (0.035) converted to 3.5%", () => {
		const p = makePayload([
			{ col_A: "MRR",   col_C: 100000 },
			{ col_A: "Churn", col_C: 0.035 },
		]);
		const result = parseSaasKpisV1(p, SRC);
		const churnVal = result!.churn_pct?.["P0"] ?? result!.churn_pct?.[result!.periods[0] ?? ""];
		expect(churnVal).toBeCloseTo(3.5, 1);
	});

	it("9. retention rate populated", () => {
		const p = makePayload([
			{ col_A: "MRR",            col_C: 80000 },
			{ col_A: "Retention Rate", col_C: 95 },
		]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.retention_pct).toBeDefined();
	});

	it("10. CAC row recognized", () => {
		const p = makePayload([
			{ col_A: "MRR", col_C: 100000 },
			{ col_A: "CAC", col_C: 1500 },
		]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.cac).toBeDefined();
	});

	it("11. LTV row recognized → ltv_cac_ratio derived when both present", () => {
		const p = makePayload([
			{ col_A: "MRR",            col_C: 100000 },
			{ col_A: "CAC",            col_C: 1500 },
			{ col_A: "Lifetime Value", col_C: 9000  },
		]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.ltv).toBeDefined();
		// LTV/CAC = 9000/1500 = 6
		expect(result!.derived?.ltv_cac_ratio).toBeCloseTo(6, 1);
	});

	it("12. period header row detected → periods populated", () => {
		const p = makePayload([
			{ col_A: "",    col_C: 2024,   col_D: 2025 },
			{ col_A: "MRR", col_C: 100000, col_D: 130000 },
		]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.periods).toContain("2024");
		expect(result!.periods).toContain("2025");
	});

	it("13. single-period fallback → periods = ['P0']", () => {
		const p = makePayload([{ col_A: "MRR", col_C: 100000 }]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.periods).toEqual(["P0"]);
	});

	it("14. derived.mrr_latest populated", () => {
		const p = makePayload([{ col_A: "MRR", col_C: 125000 }]);
		const result = parseSaasKpisV1(p, SRC);
		expect(result!.derived?.mrr_latest).toBe(125000);
	});
});

describe("pickBestSaasKpis", () => {
	it("15. returns null for empty array", () => {
		expect(pickBestSaasKpis([])).toBeNull();
	});

	it("16. returns single item unchanged", () => {
		const p = makePayload([{ col_A: "MRR", col_C: 80000 }]);
		const item = parseSaasKpisV1(p, SRC)!;
		expect(pickBestSaasKpis([item])).toBe(item);
	});
});
