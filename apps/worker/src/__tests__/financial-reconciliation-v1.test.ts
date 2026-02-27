/**
 * financial-reconciliation-v1.test.ts
 *
 * Unit tests for the deterministic financial reconciliation engine.
 *
 * Coverage:
 *
 * revenue_vs_headcount_flag (tests 1–7):
 *  1.  SKIP when financial statement has no revenue field
 *  2.  SKIP when implied allocation is absent
 *  3.  PASS when headcount cost ≤ 2× revenue
 *  4.  WARN when headcount cost > 2× revenue (≤ 5×)
 *  5.  FAIL when headcount cost > 5× revenue
 *  6.  WARN when revenue is zero (ratio undefined)
 *  7.  Uses IncomeStatementAllocationV1 as fallback when implied allocation absent
 *
 * allocation_vs_growth_flag (tests 8–13):
 *  8.  SKIP when no allocation data at all
 *  9.  PASS when S&M is reasonable (15%) and growth is modest
 * 10.  WARN when S&M > 70% of total (S&M-dominated)
 * 11.  WARN when S&M < 5% AND growth > 100%
 * 12.  WARN when growth > 50% but no S&M bucket identifiable
 * 13.  PASS when growth > 50% but S&M is within reasonable range
 *
 * raise_vs_burn_flag (tests 14–17):
 * 14.  SKIP when UoF total_amount is null
 * 15.  SKIP when financial statement is null
 * 16.  FAIL when raise covers < 6 months of burn
 * 17.  WARN when raise covers 6–11 months of burn
 * 18.  PASS when raise covers ≥ 12 months of burn
 *
 * margin_vs_infra_ratio_flag (tests 19–23):
 * 19.  SKIP when gross_margin not available
 * 20.  WARN when gross_margin is negative
 * 21.  WARN when gross_margin < 40% AND infra allocation > 20%
 * 22.  PASS when gross_margin < 40% but infra allocation ≤ 20%
 * 23.  PASS when gross_margin ≥ 40% (even if no infra data)
 *
 * reconcileFinancialsV1 integration (tests 24–27):
 * 24.  confidence_score = 0 when all flags are SKIP
 * 25.  confidence_score = 1.0 when all 4 flags evaluate
 * 26.  data_sources_used populated with contributing schema versions
 * 27.  evidence_refs is a deduped union across all flags
 */

import { describe, it, expect } from "vitest";
import {
	reconcileFinancialsV1,
	THRESHOLDS,
	type ReconciliationInputs,
} from "../lib/financial-reconciliation-v1";
import type { FinancialStatementV1 } from "../lib/financial-statement-parser";
import type { UseOfFundsV1 } from "../lib/use-of-funds-parser-v1";
import type { ImpliedCapitalAllocationV1 } from "../lib/implied-capital-allocation-v1";
import type { IncomeStatementAllocationV1 } from "../lib/implied-capital-income-statement-v1";

// ─── Fixture factories ────────────────────────────────────────────────────────

const DOC_ID   = "doc-1234-abcd";
const PAGE_REF = "dpu:doc:doc-1234-abcd:page:0";

function makeStmt(opts: {
	revenue?:        number | null;
	total_expenses?: number | null;
	gross_profit?:   number | null;
	gross_margin?:   number | null;
	yoy_growth?:     number | null;
	period?:         string;
}): FinancialStatementV1 {
	const period = opts.period ?? "2026";
	return {
		schema_version: "financial_statement_v1",
		source: { document_id: DOC_ID, page_ref: PAGE_REF },
		periods: [period],
		revenue:          opts.revenue != null       ? { [period]: opts.revenue }        : undefined,
		total_expenses:   opts.total_expenses != null ? { [period]: opts.total_expenses } : undefined,
		gross_profit:     opts.gross_profit != null   ? { [period]: opts.gross_profit }   : undefined,
		derived: {
			revenue_latest:          opts.revenue ?? undefined,
			gross_margin_latest_pct: opts.gross_margin ?? undefined,
			revenue_yoy_growth_pct:  opts.yoy_growth ?? undefined,
		},
	};
}

function makeUof(opts: {
	total_amount?:  number | null;
	buckets?:       Array<{ category: string; amount?: number | null; percent?: number | null }>;
}): UseOfFundsV1 {
	return {
		schema_version: "use_of_funds_v1",
		source: { document_id: DOC_ID, page_ref: "dpu:doc:doc-1234-abcd:page:1" },
		total_amount: opts.total_amount ?? null,
		total_percent: 100,
		buckets: (opts.buckets ?? []).map((b) => ({
			category: b.category,
			amount:   b.amount ?? null,
			percent:  b.percent ?? null,
		})),
		diagnostics: { header_row_found: true, parsed_rows: opts.buckets?.length ?? 0, parse_warnings: [] },
	};
}

function makeImplied(opts: {
	total_cost?:     number | null;
	buckets?:        Array<{ category: string; pct?: number | null; annual_cost?: number | null }>;
}): ImpliedCapitalAllocationV1 {
	return {
		schema_version: "implied_capital_allocation_v1",
		basis: "budget_model",
		basis_note: "IMPLIED from operational budget model",
		source: { document_id: DOC_ID, page_refs: ["dpu:doc:doc-1234-abcd:page:2"] },
		period_label: "Q1–Q4 2026",
		total_annual_cost_usd: opts.total_cost ?? null,
		buckets: (opts.buckets ?? []).map((b) => ({
			category:        b.category,
			annual_cost_usd: b.annual_cost ?? null,
			pct_of_total:    b.pct != null ? b.pct / 100 : null,
			source:          "employee_costs" as const,
			evidence_ref:    "dpu:doc:doc-1234-abcd:page:2",
		})),
		diagnostics: {
			sheets_used:           ["Employee Costs"],
			infra_rows_parsed:     0,
			employee_rows_parsed:  opts.buckets?.length ?? 0,
			parse_quality:         0.9,
			notes:                 [],
		},
	};
}

function makeIncSt(totalAmount: number): IncomeStatementAllocationV1 {
	return {
		schema_version: "income_statement_allocation_v1",
		basis: "income_statement",
		basis_note: "Derived from income statement expense breakdown",
		source: { document_id: DOC_ID, page_ref: "dpu:doc:doc-1234-abcd:page:0" },
		period_label: "2026",
		total_annual_amount: totalAmount,
		buckets: [
			{ category: "Payroll", annual_amount: totalAmount, pct_of_total: 100, column_key: "2026" },
		],
		diagnostics: { expense_rows_parsed: 1, nonzero_rows: 1, parse_warnings: [] },
	};
}

function baseInputs(overrides: Partial<ReconciliationInputs> = {}): ReconciliationInputs {
	return {
		dealId:                    "deal-test-001",
		financialStatement:        null,
		useOfFunds:                null,
		impliedCapitalAllocation:  null,
		incomeStatementAllocation: null,
		...overrides,
	};
}

// ─── revenue_vs_headcount_flag ────────────────────────────────────────────────

describe("revenue_vs_headcount_flag", () => {
	it("1. SKIP when financial statement has no revenue field", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: null }),
			impliedCapitalAllocation: makeImplied({ total_cost: 500_000 }),
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("SKIP");
	});

	it("2. SKIP when implied allocation is absent and no income-statement fallback", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 1_000_000 }),
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("SKIP");
	});

	it("3. PASS when headcount cost ≤ 2× revenue", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ revenue: 500_000 }),
			impliedCapitalAllocation: makeImplied({ total_cost: 800_000 }), // 1.6×
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("PASS");
		expect(r.flags.revenue_vs_headcount_flag.values["ratio"]).toBeCloseTo(1.6, 1);
	});

	it("4. WARN when headcount cost is between 2× and 5× revenue", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ revenue: 200_000 }),
			impliedCapitalAllocation: makeImplied({ total_cost: 600_000 }), // 3×
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("WARN");
		expect(r.flags.revenue_vs_headcount_flag.values["ratio"]).toBeCloseTo(3.0, 1);
	});

	it("5. FAIL when headcount cost > 5× revenue", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ revenue: 100_000 }),
			impliedCapitalAllocation: makeImplied({ total_cost: 600_001 }), // > 5×
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("FAIL");
		expect(r.flags.revenue_vs_headcount_flag.reason).toMatch(/headcount cost/i);
	});

	it("6. WARN when revenue is zero (ratio undefined)", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ revenue: 0 }),
			impliedCapitalAllocation: makeImplied({ total_cost: 300_000 }),
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("WARN");
		expect(r.flags.revenue_vs_headcount_flag.values["ratio"]).toBeNull();
	});

	it("7. Uses IncomeStatementAllocationV1 as headcount fallback when implied is null", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:        makeStmt({ revenue: 100_000 }),
			incomeStatementAllocation: makeIncSt(150_000), // 1.5× → PASS
		}));
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("PASS");
	});
});

// ─── allocation_vs_growth_flag ────────────────────────────────────────────────

describe("allocation_vs_growth_flag", () => {
	it("8. SKIP when no UoF and no implied allocation", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 1_000_000, yoy_growth: 120 }),
		}));
		expect(r.flags.allocation_vs_growth_flag.status).toBe("SKIP");
	});

	it("9. PASS when S&M is 15% and growth is modest (40%)", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 500_000, yoy_growth: 40 }),
			useOfFunds: makeUof({
				total_amount: 2_000_000,
				buckets: [
					{ category: "Sales & Marketing", percent: 15 },
					{ category: "Engineering",       percent: 50 },
					{ category: "G&A",               percent: 35 },
				],
			}),
		}));
		expect(r.flags.allocation_vs_growth_flag.status).toBe("PASS");
	});

	it("10. WARN when S&M > 70% of total allocation", () => {
		const r = reconcileFinancialsV1(baseInputs({
			useOfFunds: makeUof({
				total_amount: 1_000_000,
				buckets: [
					{ category: "Sales & Marketing", percent: 75 },
					{ category: "Engineering",       percent: 25 },
				],
			}),
		}));
		expect(r.flags.allocation_vs_growth_flag.status).toBe("WARN");
		expect(r.flags.allocation_vs_growth_flag.reason).toMatch(/s&m-dominated/i);
	});

	it("11. WARN when S&M < 5% AND revenue growth > 100%", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 1_000_000, yoy_growth: 150 }),
			useOfFunds: makeUof({
				total_amount: 2_000_000,
				buckets: [
					{ category: "Sales & Marketing", percent: 3 },
					{ category: "Engineering",       percent: 97 },
				],
			}),
		}));
		expect(r.flags.allocation_vs_growth_flag.status).toBe("WARN");
		expect(r.flags.allocation_vs_growth_flag.reason).toMatch(/low s&m budget vs\. high growth/i);
	});

	it("12. WARN when growth > 50% but no S&M bucket is identifiable", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 1_000_000, yoy_growth: 80 }),
			useOfFunds: makeUof({
				total_amount: 2_000_000,
				buckets: [
					{ category: "Engineering", percent: 60 },
					{ category: "G&A",         percent: 40 },
				],
			}),
		}));
		expect(r.flags.allocation_vs_growth_flag.status).toBe("WARN");
		expect(r.flags.allocation_vs_growth_flag.reason).toMatch(/no s&m allocation bucket/i);
	});

	it("13. PASS when growth > 50% but S&M is within reasonable range (20%)", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 500_000, yoy_growth: 75 }),
			useOfFunds: makeUof({
				total_amount: 2_000_000,
				buckets: [
					{ category: "Sales & Marketing", percent: 20 },
					{ category: "Engineering",       percent: 55 },
					{ category: "G&A",               percent: 25 },
				],
			}),
		}));
		expect(r.flags.allocation_vs_growth_flag.status).toBe("PASS");
	});
});

// ─── raise_vs_burn_flag ───────────────────────────────────────────────────────

describe("raise_vs_burn_flag", () => {
	it("14. SKIP when UoF total_amount is null", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 500_000, total_expenses: 1_200_000 }),
			useOfFunds: makeUof({ total_amount: null, buckets: [] }),
		}));
		expect(r.flags.raise_vs_burn_flag.status).toBe("SKIP");
	});

	it("15. SKIP when financial statement is null", () => {
		const r = reconcileFinancialsV1(baseInputs({
			useOfFunds: makeUof({ total_amount: 2_000_000, buckets: [] }),
		}));
		expect(r.flags.raise_vs_burn_flag.status).toBe("SKIP");
	});

	it("16. FAIL when raise covers < 6 months of burn", () => {
		// annual_burn = 1_200_000, monthly_burn = 100_000
		// raise = 400_000 → runway = 4 months → FAIL
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ total_expenses: 1_200_000 }),
			useOfFunds: makeUof({ total_amount: 400_000, buckets: [] }),
		}));
		expect(r.flags.raise_vs_burn_flag.status).toBe("FAIL");
		expect(r.flags.raise_vs_burn_flag.values["runway_months"]).toBeCloseTo(4.0, 1);
	});

	it("17. WARN when raise covers 6–11 months of burn", () => {
		// annual_burn = 1_200_000, monthly_burn = 100_000
		// raise = 900_000 → runway = 9 months → WARN
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ total_expenses: 1_200_000 }),
			useOfFunds: makeUof({ total_amount: 900_000, buckets: [] }),
		}));
		expect(r.flags.raise_vs_burn_flag.status).toBe("WARN");
		expect(r.flags.raise_vs_burn_flag.values["runway_months"]).toBeCloseTo(9.0, 1);
	});

	it("18. PASS when raise covers ≥ 12 months of burn", () => {
		// annual_burn = 600_000, monthly_burn = 50_000
		// raise = 1_000_000 → runway = 20 months → PASS
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ total_expenses: 600_000 }),
			useOfFunds: makeUof({ total_amount: 1_000_000, buckets: [] }),
		}));
		expect(r.flags.raise_vs_burn_flag.status).toBe("PASS");
		expect(r.flags.raise_vs_burn_flag.values["runway_months"]).toBeGreaterThanOrEqual(12);
	});
});

// ─── margin_vs_infra_ratio_flag ───────────────────────────────────────────────

describe("margin_vs_infra_ratio_flag", () => {
	it("19. SKIP when gross_margin not available in financial statement", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 500_000 }), // no gross_margin
		}));
		expect(r.flags.margin_vs_infra_ratio_flag.status).toBe("SKIP");
	});

	it("20. WARN when gross_margin is negative", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 500_000, gross_margin: -10 }),
		}));
		expect(r.flags.margin_vs_infra_ratio_flag.status).toBe("WARN");
		expect(r.flags.margin_vs_infra_ratio_flag.reason).toMatch(/negative margin/i);
	});

	it("21. WARN when gross_margin < 40% AND infra allocation > 20%", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ gross_margin: 25 }),
			impliedCapitalAllocation: makeImplied({
				total_cost: 500_000,
				buckets: [{ category: "Infrastructure / Cloud", pct: 30 }],
			}),
		}));
		expect(r.flags.margin_vs_infra_ratio_flag.status).toBe("WARN");
		expect(r.flags.margin_vs_infra_ratio_flag.reason).toMatch(/infrastructure cost drag/i);
	});

	it("22. PASS when gross_margin < 40% but infra allocation ≤ 20%", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ gross_margin: 30 }),
			impliedCapitalAllocation: makeImplied({
				total_cost: 500_000,
				buckets: [{ category: "Infrastructure / Cloud", pct: 10 }],
			}),
		}));
		expect(r.flags.margin_vs_infra_ratio_flag.status).toBe("PASS");
	});

	it("23. PASS when gross_margin ≥ 40% (no infra check needed)", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ gross_margin: 65 }),
		}));
		expect(r.flags.margin_vs_infra_ratio_flag.status).toBe("PASS");
	});
});

// ─── reconcileFinancialsV1 integration ───────────────────────────────────────

describe("reconcileFinancialsV1", () => {
	it("24. confidence_score = 0 when all flags are SKIP (no data)", () => {
		const r = reconcileFinancialsV1(baseInputs());
		expect(r.confidence_score).toBe(0);
		expect(r.flags.revenue_vs_headcount_flag.status).toBe("SKIP");
		expect(r.flags.allocation_vs_growth_flag.status).toBe("SKIP");
		expect(r.flags.raise_vs_burn_flag.status).toBe("SKIP");
		expect(r.flags.margin_vs_infra_ratio_flag.status).toBe("SKIP");
	});

	it("25. confidence_score = 1.0 when all 4 flags have sufficient data", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({
				revenue:        600_000,
				total_expenses: 800_000,
				gross_margin:   55,
				yoy_growth:     30,
			}),
			useOfFunds: makeUof({
				total_amount: 2_000_000,
				buckets: [
					{ category: "Sales & Marketing", percent: 25 },
					{ category: "Engineering",       percent: 50 },
					{ category: "G&A",               percent: 25 },
				],
			}),
			impliedCapitalAllocation: makeImplied({
				total_cost: 800_000,
				buckets: [{ category: "Infrastructure / Cloud", pct: 10 }],
			}),
		}));
		expect(r.confidence_score).toBe(1.0);
	});

	it("26. data_sources_used contains schema versions of contributing parsers", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement:       makeStmt({ revenue: 500_000 }),
			useOfFunds:               makeUof({ total_amount: 1_000_000, buckets: [] }),
			impliedCapitalAllocation: makeImplied({ total_cost: 300_000 }),
		}));
		expect(r.data_sources_used).toContain("financial_statement_v1");
		expect(r.data_sources_used).toContain("use_of_funds_v1");
		expect(r.data_sources_used).toContain("implied_capital_allocation_v1");
	});

	it("27. evidence_refs is deduped across all flags", () => {
		const r = reconcileFinancialsV1(baseInputs({
			financialStatement: makeStmt({ revenue: 500_000, total_expenses: 600_000, gross_margin: 50 }),
			useOfFunds: makeUof({ total_amount: 1_200_000, buckets: [{ category: "Sales & Marketing", percent: 20 }] }),
		}));
		// PAGE_REF might appear in multiple flags but should only appear once in evidence_refs
		const refSet = new Set(r.evidence_refs);
		expect(r.evidence_refs.length).toBe(refSet.size);
		expect(r.evidence_refs.length).toBeGreaterThan(0);
	});

	it("28. schema_version is 'financial_reconciliation_v1'", () => {
		const r = reconcileFinancialsV1(baseInputs());
		expect(r.schema_version).toBe("financial_reconciliation_v1");
	});

	it("29. deal_id is propagated correctly", () => {
		const r = reconcileFinancialsV1(baseInputs({ dealId: "deal-xyz-9999" }));
		expect(r.deal_id).toBe("deal-xyz-9999");
	});

	it("30. THRESHOLDS are exported and have expected values", () => {
		expect(THRESHOLDS.HEADCOUNT_FAIL_RATIO).toBe(5);
		expect(THRESHOLDS.HEADCOUNT_WARN_RATIO).toBe(2);
		expect(THRESHOLDS.RUNWAY_FAIL_MONTHS).toBe(6);
		expect(THRESHOLDS.RUNWAY_WARN_MONTHS).toBe(12);
		expect(THRESHOLDS.MARGIN_LOW_PCT).toBe(40);
		expect(THRESHOLDS.INFRA_HIGH_PCT).toBe(20);
	});
});
