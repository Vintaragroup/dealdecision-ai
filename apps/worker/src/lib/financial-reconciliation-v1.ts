/**
 * financial-reconciliation-v1.ts
 *
 * Deterministic cross-check engine for Phase I financial intelligence.
 * Compares revenue, expense, allocation, and raise data across all available
 * parsed structures to emit conservative, evidence-backed risk flags.
 *
 * No LLM involvement. Pure function. Conservative thresholds.
 *
 * ─── Four flags ────────────────────────────────────────────────────────────
 *
 * revenue_vs_headcount_flag
 *   Cross: FinancialStatementV1.revenue[P0] vs ImpliedCapitalAllocationV1.total
 *   FAIL:  headcount > 5× revenue  (unsustainable burn)
 *   WARN:  headcount > 2× revenue  (elevated burn ratio)
 *   PASS:  headcount ≤ 2× revenue
 *   SKIP:  either value absent
 *
 * allocation_vs_growth_flag
 *   Cross: S&M bucket % (from UoF or implied) vs revenue_yoy_growth_pct
 *   WARN:  S&M < 5%  AND growth > 100% — suspicious (high growth, minimal S&M budget)
 *   WARN:  S&M > 70% — excessively S&M-dominated allocation
 *   WARN:  growth > 50% but no explicit S&M bucket found
 *   PASS:  none of the above conditions triggered
 *   SKIP:  no allocation data available
 *
 * raise_vs_burn_flag
 *   Cross: UoF.total_amount (raise) vs FinancialStatement.total_expenses / 12 (monthly burn)
 *   FAIL:  raise covers < 6 months of burn
 *   WARN:  raise covers 6–11 months of burn
 *   PASS:  raise covers ≥ 12 months of burn
 *   SKIP:  raise amount or burn rate absent
 *
 * margin_vs_infra_ratio_flag
 *   Cross: FinancialStatement.derived.gross_margin_latest_pct vs infra bucket %
 *   WARN:  gross_margin < 40% AND infra_ratio > 20%  (high infra drag on low-margin biz)
 *   WARN:  gross_margin < 0%  (negative margin — cost-side structural concern)
 *   PASS:  neither condition triggered
 *   SKIP:  gross_margin unavailable
 *
 * ─── Confidence score ──────────────────────────────────────────────────────
 *   confidence_score = (count of non-SKIP flags) / 4
 *   A score of 1.0 means all four checks had sufficient data.
 *   A score of 0.0 means no checks could run (data absent across the board).
 */

import type { FinancialStatementV1 } from "./financial-statement-parser.js";
import type { UseOfFundsV1 } from "./use-of-funds-parser-v1.js";
import type { ImpliedCapitalAllocationV1 } from "./implied-capital-allocation-v1.js";
import type { IncomeStatementAllocationV1 } from "./implied-capital-income-statement-v1.js";
import type { BalanceSheetV1 } from "./balance-sheet-parser-v1.js";
import type { CashFlowStatementV1 } from "./cash-flow-parser-v1.js";
import type { CapTableV1 } from "./cap-table-parser-v1.js";
import type { SaasKpisV1 } from "./saas-kpis-parser-v1.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ReconciliationFlagStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

export interface ReconciliationFlag {
	/** Machine-readable status. */
	status: ReconciliationFlagStatus;
	/** Human-readable explanation of why the flag was set. */
	reason: string;
	/** Raw numeric values used in the evaluation (for traceability). */
	values: Record<string, number | null>;
	/** DPU page refs or parser schema_version strings backing this evaluation. */
	evidence_refs: string[];
}

export interface FinancialReconciliationV1 {
	schema_version: "financial_reconciliation_v1";
	deal_id: string;
	flags: {
		revenue_vs_headcount_flag:         ReconciliationFlag;
		allocation_vs_growth_flag:         ReconciliationFlag;
		raise_vs_burn_flag:                ReconciliationFlag;
		margin_vs_infra_ratio_flag:        ReconciliationFlag;
		// Phase K new flags
		burn_vs_runway_flag:               ReconciliationFlag;
		revenue_vs_cac_flag:               ReconciliationFlag;
		churn_vs_growth_flag:              ReconciliationFlag;
		cap_table_vs_raise_instrument_flag: ReconciliationFlag;
		// Phase L new flag
		dilution_visibility_flag:           ReconciliationFlag;
	};
	/**
	 * Fraction of the (now 9) flags that had sufficient data to evaluate (0–1.0).
	 * Rounds to 2 decimal places.
	 */
	confidence_score: number;
	/** Union of all evidence_refs across all flags. */
	evidence_refs: string[];
	/** Schema versions of parsers that contributed data to this reconciliation. */
	data_sources_used: string[];
}

// ─── Reconciliation inputs ────────────────────────────────────────────────────

export interface ReconciliationInputs {
	dealId: string;
	financialStatement:         FinancialStatementV1 | null;
	useOfFunds:                 UseOfFundsV1 | null;
	impliedCapitalAllocation:   ImpliedCapitalAllocationV1 | null;
	incomeStatementAllocation:  IncomeStatementAllocationV1 | null;
	// Phase K: new optional inputs
	balanceSheet?:              BalanceSheetV1 | null;
	cashFlow?:                  CashFlowStatementV1 | null;
	capTable?:                  CapTableV1 | null;
	saasKpis?:                  SaasKpisV1 | null;
}

// ─── Flag-level thresholds (exported for test assertion) ─────────────────────

export const THRESHOLDS = {
	/** headcount_cost / revenue ratio at which we emit FAIL */
	HEADCOUNT_FAIL_RATIO:  5,
	/** headcount_cost / revenue ratio at which we emit WARN */
	HEADCOUNT_WARN_RATIO:  2,
	/** S&M bucket % below which we warn if growth is also high */
	SM_LOW_PCT_THRESHOLD:  5,
	/** Revenue YoY growth % above which we pair with SM_LOW to warn */
	GROWTH_HIGH_THRESHOLD: 100,
	/** Revenue YoY growth % above which we consider growth notable */
	GROWTH_NOTABLE_THRESHOLD: 50,
	/** S&M bucket % above which allocation is considered S&M-dominated */
	SM_HIGH_PCT_THRESHOLD: 70,
	/** Minimum raise/burn runway months before emitting FAIL */
	RUNWAY_FAIL_MONTHS:    6,
	/** Minimum raise/burn runway months before emitting WARN */
	RUNWAY_WARN_MONTHS:    12,
	/** Gross margin % below which we consider margin structurally low */
	MARGIN_LOW_PCT:        40,
	/** Infra/tech bucket % above which we consider infra drag present */
	INFRA_HIGH_PCT:        20,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SM_BUCKET_RE      = /sales.*marketing|marketing.*sales|\bs\s*[&+]\s*m\b|s&m|growth\s+marketing/i;
const INFRA_BUCKET_RE   = /infra(structure)?|cloud|hosting|tech(nology)?/i;

function skip(reason: string): ReconciliationFlag {
	return { status: "SKIP", reason, values: {}, evidence_refs: [] };
}

function dedupeRefs(refs: string[]): string[] {
	return [...new Set(refs.filter(Boolean))];
}

/**
 * Find the first matching bucket percent (0–100) from a UseOfFundsV1,
 * or null if none match the given pattern.
 */
function findUofBucketPct(uof: UseOfFundsV1, re: RegExp): { pct: number; label: string } | null {
	for (const b of uof.buckets) {
		if (re.test(b.category)) {
			if (b.percent != null) return { pct: b.percent, label: b.category };
			// Derive % from amount if total_amount is available.
			if (b.amount != null && uof.total_amount != null && uof.total_amount > 0) {
				return { pct: (b.amount / uof.total_amount) * 100, label: b.category };
			}
		}
	}
	return null;
}

/**
 * Find an infra/tech bucket from ImpliedCapitalAllocationV1 buckets.
 * Returns pct_of_total * 100, or null.
 */
function findImpliedInfraPct(impl: ImpliedCapitalAllocationV1): number | null {
	for (const b of impl.buckets) {
		if (INFRA_BUCKET_RE.test(b.category)) {
			if (b.pct_of_total != null) return b.pct_of_total * 100;
		}
	}
	return null;
}

/**
 * Find a S&M budget % from ImpliedCapitalAllocationV1.
 */
function findImpliedSmPct(impl: ImpliedCapitalAllocationV1): number | null {
	for (const b of impl.buckets) {
		if (SM_BUCKET_RE.test(b.category)) {
			if (b.pct_of_total != null) return b.pct_of_total * 100;
		}
	}
	return null;
}

/**
 * First period value from a Record<string, number> series using the
 * FinancialStatementV1.periods ordering.
 */
function firstPeriodValue(
	series: Record<string, number> | undefined,
	periods: string[]
): number | null {
	if (!series || periods.length === 0) return null;
	const v = series[periods[0]!];
	return typeof v === "number" ? v : null;
}

// ─── Flag evaluators ──────────────────────────────────────────────────────────

function evalRevenueVsHeadcount(
	stmt:   FinancialStatementV1 | null,
	impl:   ImpliedCapitalAllocationV1 | null,
	incSt:  IncomeStatementAllocationV1 | null,
): ReconciliationFlag {
	if (!stmt || !stmt.revenue) return skip("No financial statement revenue data");

	const revenue = firstPeriodValue(stmt.revenue, stmt.periods);
	if (revenue == null) return skip("Revenue not available for first period");

	// Headcount cost: prefer ImpliedCapitalAllocationV1 (budget-model derived),
	// fall back to IncomeStatementAllocationV1 total.
	const headcountCost =
		impl?.total_annual_cost_usd ??
		incSt?.total_annual_amount ??
		null;

	if (headcountCost == null) return skip("No headcount/cost data (implied allocation absent)");

	const refs: string[] = dedupeRefs([
		stmt.source.page_ref,
		...(impl?.source.page_refs ?? []),
		...(incSt ? [incSt.source.page_ref] : []),
	]);

	const ratio = revenue > 0 ? headcountCost / revenue : null;

	if (ratio == null) {
		return {
			status:       "WARN",
			reason:       "Revenue is zero or negative — headcount ratio undefined",
			values:       { revenue, headcount_cost_usd: headcountCost, ratio: null },
			evidence_refs: refs,
		};
	}

	if (ratio > THRESHOLDS.HEADCOUNT_FAIL_RATIO) {
		return {
			status:       "FAIL",
			reason:       `Headcount cost is ${ratio.toFixed(1)}× revenue (threshold: >${THRESHOLDS.HEADCOUNT_FAIL_RATIO}× → FAIL)`,
			values:       { revenue, headcount_cost_usd: headcountCost, ratio },
			evidence_refs: refs,
		};
	}

	if (ratio > THRESHOLDS.HEADCOUNT_WARN_RATIO) {
		return {
			status:       "WARN",
			reason:       `Headcount cost is ${ratio.toFixed(1)}× revenue (threshold: >${THRESHOLDS.HEADCOUNT_WARN_RATIO}× → WARN)`,
			values:       { revenue, headcount_cost_usd: headcountCost, ratio },
			evidence_refs: refs,
		};
	}

	return {
		status:       "PASS",
		reason:       `Headcount cost is ${ratio.toFixed(1)}× revenue — within acceptable range`,
		values:       { revenue, headcount_cost_usd: headcountCost, ratio },
		evidence_refs: refs,
	};
}

function evalAllocationVsGrowth(
	stmt: FinancialStatementV1 | null,
	uof:  UseOfFundsV1 | null,
	impl: ImpliedCapitalAllocationV1 | null,
): ReconciliationFlag {
	if (!uof && !impl) return skip("No allocation data (UoF and implied allocation both absent)");

	// Resolve S&M pct — prefer explicit UoF, fall back to implied.
	let smPct: number | null = null;
	let smLabel = "S&M (unknown source)";
	const refs: string[] = [];

	if (uof) {
		const match = findUofBucketPct(uof, SM_BUCKET_RE);
		if (match != null) {
			smPct = match.pct;
			smLabel = `S&M from UoF bucket "${match.label}"`;
		}
		refs.push(uof.source.page_ref);
	}
	if (smPct == null && impl) {
		const p = findImpliedSmPct(impl);
		if (p != null) { smPct = p; smLabel = "S&M from implied allocation"; }
		refs.push(...impl.source.page_refs);
	}

	const growthPct = stmt?.derived?.revenue_yoy_growth_pct ?? null;
	if (stmt) refs.push(stmt.source.page_ref);

	const values: Record<string, number | null> = {
		sm_allocation_pct: smPct,
		revenue_yoy_growth_pct: growthPct,
	};
	const evidenceRefs = dedupeRefs(refs);

	if (smPct == null) {
		// No S&M bucket found in any source.
		if (growthPct != null && growthPct > THRESHOLDS.GROWTH_NOTABLE_THRESHOLD) {
			return {
				status:       "WARN",
				reason:       `Revenue growth is ${growthPct.toFixed(1)}% YoY but no S&M allocation bucket is identifiable`,
				values,
				evidence_refs: evidenceRefs,
			};
		}
		return {
			status:       "PASS",
			reason:       "No S&M bucket identified; no growth anomaly detected",
			values,
			evidence_refs: evidenceRefs,
		};
	}

	// High S&M dominance check.
	if (smPct > THRESHOLDS.SM_HIGH_PCT_THRESHOLD) {
		return {
			status:       "WARN",
			reason:       `${smLabel} is ${smPct.toFixed(1)}% of total — S&M-dominated allocation (>${THRESHOLDS.SM_HIGH_PCT_THRESHOLD}%)`,
			values,
			evidence_refs: evidenceRefs,
		};
	}

	// Low S&M + high growth mismatch.
	if (
		smPct < THRESHOLDS.SM_LOW_PCT_THRESHOLD &&
		growthPct != null &&
		growthPct > THRESHOLDS.GROWTH_HIGH_THRESHOLD
	) {
		return {
			status:       "WARN",
			reason:       `${smLabel} is only ${smPct.toFixed(1)}% of total but revenue YoY growth is ${growthPct.toFixed(1)}% — low S&M budget vs. high growth claim`,
			values,
			evidence_refs: evidenceRefs,
		};
	}

	return {
		status:       "PASS",
		reason:       `${smLabel} is ${smPct.toFixed(1)}% of total — within expected range`,
		values,
		evidence_refs: evidenceRefs,
	};
}

function evalRaiseVsBurn(
	stmt: FinancialStatementV1 | null,
	uof:  UseOfFundsV1 | null,
): ReconciliationFlag {
	const raiseAmount = uof?.total_amount ?? null;
	if (raiseAmount == null) return skip("Raise amount not available (no explicit UoF total_amount)");

	if (!stmt || !stmt.total_expenses) return skip("Burn rate unavailable (no total_expenses in financial statement)");

	const annualBurn = firstPeriodValue(stmt.total_expenses, stmt.periods);
	if (annualBurn == null) return skip("total_expenses not available for first period");
	if (annualBurn <= 0) return skip("Annual burn rate is zero or negative — cannot compute runway");

	const monthlyBurn   = annualBurn / 12;
	const runwayMonths  = raiseAmount / monthlyBurn;

	const refs = dedupeRefs([uof!.source.page_ref, stmt.source.page_ref]);
	const values = { raise_amount_usd: raiseAmount, annual_burn_usd: annualBurn, monthly_burn_usd: monthlyBurn, runway_months: runwayMonths };

	if (runwayMonths < THRESHOLDS.RUNWAY_FAIL_MONTHS) {
		return {
			status:       "FAIL",
			reason:       `Raise ($${raiseAmount.toLocaleString("en-US")}) covers only ${runwayMonths.toFixed(1)} months of burn — below ${THRESHOLDS.RUNWAY_FAIL_MONTHS}-month minimum`,
			values,
			evidence_refs: refs,
		};
	}

	if (runwayMonths < THRESHOLDS.RUNWAY_WARN_MONTHS) {
		return {
			status:       "WARN",
			reason:       `Raise ($${raiseAmount.toLocaleString("en-US")}) covers ${runwayMonths.toFixed(1)} months of burn — below ${THRESHOLDS.RUNWAY_WARN_MONTHS}-month target`,
			values,
			evidence_refs: refs,
		};
	}

	return {
		status:       "PASS",
		reason:       `Raise covers ${runwayMonths.toFixed(1)} months of burn — adequate runway`,
		values,
		evidence_refs: refs,
	};
}

function evalMarginVsInfra(
	stmt: FinancialStatementV1 | null,
	uof:  UseOfFundsV1 | null,
	impl: ImpliedCapitalAllocationV1 | null,
): ReconciliationFlag {
	const grossMargin = stmt?.derived?.gross_margin_latest_pct ?? null;

	if (grossMargin == null) return skip("Gross margin not available in financial statement");

	// Resolve infra pct — prefer implicit, fall back to UoF.
	let infraPct: number | null = null;
	const refs: string[] = [];
	if (stmt) refs.push(stmt.source.page_ref);

	if (impl) {
		infraPct = findImpliedInfraPct(impl);
		refs.push(...impl.source.page_refs);
	}
	if (infraPct == null && uof) {
		const match = findUofBucketPct(uof, INFRA_BUCKET_RE);
		if (match != null) infraPct = match.pct;
		refs.push(uof.source.page_ref);
	}

	const values: Record<string, number | null> = {
		gross_margin_pct: grossMargin,
		infra_pct_of_allocation: infraPct,
	};
	const evidenceRefs = dedupeRefs(refs);

	if (grossMargin < 0) {
		return {
			status:       "WARN",
			reason:       `Gross margin is ${grossMargin.toFixed(1)}% — negative margin indicates cost-side structural concern`,
			values,
			evidence_refs: evidenceRefs,
		};
	}

	if (grossMargin < THRESHOLDS.MARGIN_LOW_PCT && infraPct != null && infraPct > THRESHOLDS.INFRA_HIGH_PCT) {
		return {
			status:       "WARN",
			reason:       `Gross margin ${grossMargin.toFixed(1)}% is low AND infra allocation is ${infraPct.toFixed(1)}% — infrastructure cost drag on low-margin business`,
			values,
			evidence_refs: evidenceRefs,
		};
	}

	return {
		status:       "PASS",
		reason:       grossMargin < THRESHOLDS.MARGIN_LOW_PCT
			? `Gross margin ${grossMargin.toFixed(1)}% is below ${THRESHOLDS.MARGIN_LOW_PCT}% but infra allocation is within range`
			: `Gross margin ${grossMargin.toFixed(1)}% and infra allocation are within expected ranges`,
		values,
		evidence_refs: evidenceRefs,
	};
}

// ─── Phase K: new flag evaluators ─────────────────────────────────────────────

/**
 * burn_vs_runway_flag
 * Cross: cash_balance (balance_sheet OR cash_flow.ending_cash) vs monthly_burn (cash_flow OR financial_statement).
 * FAIL: runway < 6 months
 * WARN: runway 6–11 months
 * PASS: runway ≥ 12 months
 * SKIP: either cash or burn absent
 */
function evalBurnVsRunway(
	bs:   BalanceSheetV1 | null | undefined,
	cf:   CashFlowStatementV1 | null | undefined,
	stmt: FinancialStatementV1 | null,
): ReconciliationFlag {
	// Resolve cash balance: prefer balance_sheet cash, fall back to cash_flow ending_cash
	let cashBalance: number | null = null;
	const cashRef: string[] = [];

	if (bs?.derived?.cash_latest != null) {
		cashBalance = bs.derived.cash_latest;
		cashRef.push(bs.source.page_ref);
	} else if (cf?.ending_cash && bs == null) {
		const p0 = cf.periods[0];
		if (p0) cashBalance = cf.ending_cash[p0] ?? null;
		if (cashBalance !== null) cashRef.push(cf.source.page_ref);
	}

	if (cashBalance == null) return skip("Cash balance unavailable (no balance_sheet or cash_flow ending_cash)");

	// Resolve monthly burn: prefer cash_flow.derived, fall back to financial_statement expenses/12
	let monthlyBurn: number | null = null;
	const burnRef: string[] = [];

	if (cf?.derived?.monthly_burn_from_ops != null) {
		monthlyBurn = cf.derived.monthly_burn_from_ops;
		burnRef.push(cf.source.page_ref);
	} else if (stmt?.total_expenses) {
		const p0 = stmt.periods[0];
		const annualBurn = p0 ? stmt.total_expenses[p0] : null;
		if (annualBurn != null && annualBurn > 0) {
			monthlyBurn = annualBurn / 12;
			burnRef.push(stmt.source.page_ref);
		}
	}

	if (monthlyBurn == null || monthlyBurn <= 0) return skip("Monthly burn unavailable or zero");

	const runwayMonths = cashBalance / monthlyBurn;
	const refs = dedupeRefs([...cashRef, ...burnRef]);
	const values = { cash_balance: cashBalance, monthly_burn: monthlyBurn, runway_months: runwayMonths };

	if (runwayMonths < THRESHOLDS.RUNWAY_FAIL_MONTHS) {
		return { status: "FAIL", reason: `Cash runway is ${runwayMonths.toFixed(1)} months (below ${THRESHOLDS.RUNWAY_FAIL_MONTHS}-month minimum)`, values, evidence_refs: refs };
	}
	if (runwayMonths < THRESHOLDS.RUNWAY_WARN_MONTHS) {
		return { status: "WARN", reason: `Cash runway is ${runwayMonths.toFixed(1)} months (below ${THRESHOLDS.RUNWAY_WARN_MONTHS}-month target)`, values, evidence_refs: refs };
	}
	return { status: "PASS", reason: `Cash runway is ${runwayMonths.toFixed(1)} months — adequate`, values, evidence_refs: refs };
}

/**
 * revenue_vs_cac_flag
 * Cross: revenue_latest vs cac (SaaS KPIs), checking CAC payback period.
 * WARN: CAC payback period > 24 months (cac / (arpu || mrr_per_customer) > 24)
 * WARN: LTV/CAC < 3 when both present
 * PASS: metrics within range
 * SKIP: SaaS KPIs absent
 */
function evalRevenueVsCac(
	saas: SaasKpisV1 | null | undefined,
): ReconciliationFlag {
	if (!saas) return skip("SaaS KPIs absent (no saas_kpis_v1 parsed)");

	const p0 = saas.periods[0];
	if (!p0) return skip("SaaS KPIs: no period data");

	const cac    = saas.cac?.[p0] ?? null;
	const ltv    = saas.ltv?.[p0] ?? null;
	const arpu   = saas.arpu?.[p0] ?? null;
	const mrr    = saas.mrr?.[p0] ?? null;

	if (cac == null) return skip("CAC not present in SaaS KPIs");

	const refs = dedupeRefs([saas.source.page_ref]);
	const values: Record<string, number | null> = { cac, ltv, arpu, mrr };

	// LTV/CAC check
	if (ltv != null && ltv > 0 && cac > 0) {
		const ltvCacRatio = ltv / cac;
		values["ltv_cac_ratio"] = Math.round(ltvCacRatio * 10) / 10;
		if (ltvCacRatio < 3) {
			return {
				status: "WARN",
				reason: `LTV/CAC ratio is ${values["ltv_cac_ratio"]} — below the 3× SaaS benchmark`,
				values,
				evidence_refs: refs,
			};
		}
	}

	// CAC payback via ARPU (monthly)
	const monthly = arpu ?? mrr;
	if (monthly != null && monthly > 0 && cac > 0) {
		const paybackMonths = cac / monthly;
		values["cac_payback_months"] = Math.round(paybackMonths * 10) / 10;
		if (paybackMonths > 24) {
			return {
				status: "WARN",
				reason: `CAC payback period is ${values["cac_payback_months"]} months (>24-month threshold)`,
				values,
				evidence_refs: refs,
			};
		}
	}

	return {
		status: "PASS",
		reason:  ltv != null ? `LTV/CAC ratio ${values["ltv_cac_ratio"]} and CAC payback within range` : "CAC within acceptable range",
		values,
		evidence_refs: refs,
	};
}

/**
 * churn_vs_growth_flag
 * Cross: churn_pct (SaaS KPIs) vs revenue_yoy_growth_pct (financial_statement).
 * FAIL: churn > 10% AND growth < 0% (contracting AND high churn)
 * WARN: churn > 10% (elevated churn for any SaaS biz)
 * WARN: churn > growth_pct/12 (monthly churn exceeds implied monthly growth)
 * PASS: neither condition triggered
 * SKIP: churn absent
 */
function evalChurnVsGrowth(
	saas: SaasKpisV1 | null | undefined,
	stmt: FinancialStatementV1 | null,
): ReconciliationFlag {
	if (!saas) return skip("SaaS KPIs absent");
	const p0 = saas.periods[0];
	if (!p0) return skip("SaaS KPIs: no period data");

	const churn = saas.churn_pct?.[p0] ?? null;
	if (churn == null) return skip("Churn rate not present in SaaS KPIs");

	const growthPct = stmt?.derived?.revenue_yoy_growth_pct ?? null;
	const refs = dedupeRefs([saas.source.page_ref, ...(stmt ? [stmt.source.page_ref] : [])]);
	const values: Record<string, number | null> = { churn_pct: churn, revenue_yoy_growth_pct: growthPct };

	if (churn > 10 && growthPct != null && growthPct < 0) {
		return {
			status: "FAIL",
			reason: `Churn is ${churn.toFixed(1)}% and revenue is contracting ${growthPct.toFixed(1)}% — compounding decline`,
			values, evidence_refs: refs,
		};
	}
	if (churn > 10) {
		return {
			status: "WARN",
			reason: `Churn rate of ${churn.toFixed(1)}% exceeds 10% threshold for SaaS businesses`,
			values, evidence_refs: refs,
		};
	}
	if (growthPct != null) {
		const impliedMonthlyGrowth = growthPct / 12;
		if (churn > impliedMonthlyGrowth && impliedMonthlyGrowth > 0) {
			return {
				status: "WARN",
				reason: `Monthly churn (${churn.toFixed(1)}%) exceeds implied monthly revenue growth (${impliedMonthlyGrowth.toFixed(1)}%)`,
				values, evidence_refs: refs,
			};
		}
	}
	return {
		status: "PASS",
		reason: `Churn rate ${churn.toFixed(1)}% within acceptable range`,
		values, evidence_refs: refs,
	};
}

/**
 * cap_table_vs_raise_instrument_flag
 * Cross: cap_table.safe_notes_present vs raise_instrument text (from UoF / evidence).
 * WARN: cap_table shows SAFEs/notes but no raise instrument identified in deal docs
 * WARN: cap_table option_pool_pct missing when raise_round is Series A or later (expected for dilution modelling)
 * PASS: consistent or insufficient data
 * SKIP: no cap table
 */
function evalCapTableVsRaiseInstrument(
	cap: CapTableV1 | null | undefined,
	uof: UseOfFundsV1 | null,
): ReconciliationFlag {
	if (!cap) return skip("Cap table absent");

	const refs = dedupeRefs([cap.source.page_ref, ...(uof ? [uof.source.page_ref] : [])]);
	const values: Record<string, number | null> = {
		option_pool_pct: cap.option_pool_pct,
		total_pct: cap.total_pct,
	};

	if (cap.safe_notes_present && !uof) {
		return {
			status: "WARN",
			reason: "Cap table references SAFEs / convertible notes but no Use-of-Funds table found — instrument consistency unverifiable",
			values, evidence_refs: refs,
		};
	}

	if (cap.option_pool_pct == null && cap.stakeholders.length > 2) {
		return {
			status: "WARN",
			reason: "Cap table has multiple stakeholder rows but no option pool percentage identified",
			values, evidence_refs: refs,
		};
	}

	const totalPct = cap.total_pct;
	if (totalPct != null && Math.abs(totalPct - 100) > 5) {
		return {
			status: "WARN",
			reason: `Cap table ownership percentages sum to ${totalPct.toFixed(1)}% — does not add to ~100%`,
			values, evidence_refs: refs,
		};
	}

	return {
		status: "PASS",
		reason: "Cap table structure is consistent with available raise information",
		values, evidence_refs: refs,
	};
}

/**
 * dilution_visibility_flag
 * Checks whether the cap table exposes sufficient dilution data for a
 * prospective investor to model their ownership post-investment.
 * WARN: cap table present but no ownership percentages in any stakeholder row
 * WARN: cap table present but post_money_shares is null (no fully-diluted share count)
 * WARN: option pool missing when cap table has multiple stakeholders (≥3 rows)
 * PASS: cap table has both pct column AND post_money_shares
 * SKIP: no cap table data
 */
function evalDilutionVisibility(
	cap: CapTableV1 | null | undefined,
): ReconciliationFlag {
	if (!cap) return skip("Cap table absent — dilution visibility cannot be assessed");

	const refs = dedupeRefs([cap.source.page_ref]);
	const hasPctData    = cap.stakeholders.some((s) => s.pct !== null);
	const hasShareCount = cap.post_money_shares !== null;
	const hasOptionPool = cap.option_pool_pct !== null;

	const values: Record<string, number | null> = {
		stakeholder_count:  cap.stakeholders.length,
		option_pool_pct:    cap.option_pool_pct,
		post_money_shares:  cap.post_money_shares,
		total_pct:          cap.total_pct,
	};

	if (!hasPctData && !hasShareCount) {
		return {
			status: "WARN",
			reason: "Cap table present but no ownership percentages or share counts found — dilution modelling not possible",
			values,
			evidence_refs: refs,
		};
	}

	if (!hasShareCount) {
		return {
			status: "WARN",
			reason: "Cap table has ownership % but no post-money fully-diluted share count — dilution modelling incomplete",
			values,
			evidence_refs: refs,
		};
	}

	if (!hasOptionPool && cap.stakeholders.length >= 3) {
		return {
			status: "WARN",
			reason: "Cap table has multiple stakeholders but no option pool percentage identified — potential undisclosed dilution",
			values,
			evidence_refs: refs,
		};
	}

	return {
		status: "PASS",
		reason: "Cap table exposes sufficient dilution data (ownership % and post-money share count present)",
		values,
		evidence_refs: refs,
	};
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run all nine reconciliation checks against available parsed financial data.
 *
 * Pure function — no DB calls, no side-effects.
 */
export function reconcileFinancialsV1(inputs: ReconciliationInputs): FinancialReconciliationV1 {
	const { dealId, financialStatement, useOfFunds, impliedCapitalAllocation, incomeStatementAllocation,
	        balanceSheet, cashFlow, capTable, saasKpis } = inputs;

	const flags: FinancialReconciliationV1["flags"] = {
		// Phase I original flags
		revenue_vs_headcount_flag:  evalRevenueVsHeadcount(
			financialStatement, impliedCapitalAllocation, incomeStatementAllocation
		),
		allocation_vs_growth_flag:  evalAllocationVsGrowth(
			financialStatement, useOfFunds, impliedCapitalAllocation
		),
		raise_vs_burn_flag:         evalRaiseVsBurn(
			financialStatement, useOfFunds
		),
		margin_vs_infra_ratio_flag: evalMarginVsInfra(
			financialStatement, useOfFunds, impliedCapitalAllocation
		),
		// Phase K new flags
		burn_vs_runway_flag:                evalBurnVsRunway(balanceSheet, cashFlow, financialStatement),
		revenue_vs_cac_flag:                evalRevenueVsCac(saasKpis),
		churn_vs_growth_flag:               evalChurnVsGrowth(saasKpis, financialStatement),
		cap_table_vs_raise_instrument_flag: evalCapTableVsRaiseInstrument(capTable, useOfFunds),
		// Phase L new flag
		dilution_visibility_flag:            evalDilutionVisibility(capTable),
	};

	const flagValues = Object.values(flags);
	const nonSkipCount = flagValues.filter((f) => f.status !== "SKIP").length;
	// Confidence now out of 9 flags
	const confidenceScore = Math.round((nonSkipCount / 9) * 100) / 100;

	const allRefs = dedupeRefs(flagValues.flatMap((f) => f.evidence_refs));

	const sourcesUsed: string[] = [];
	if (financialStatement)        sourcesUsed.push(financialStatement.schema_version);
	if (useOfFunds)                sourcesUsed.push(useOfFunds.schema_version);
	if (impliedCapitalAllocation)  sourcesUsed.push(impliedCapitalAllocation.schema_version);
	if (incomeStatementAllocation) sourcesUsed.push(incomeStatementAllocation.schema_version);
	if (balanceSheet)              sourcesUsed.push(balanceSheet.schema_version);
	if (cashFlow)                  sourcesUsed.push(cashFlow.schema_version);
	if (capTable)                  sourcesUsed.push(capTable.schema_version);
	if (saasKpis)                  sourcesUsed.push(saasKpis.schema_version);

	return {
		schema_version:    "financial_reconciliation_v1",
		deal_id:           dealId,
		flags,
		confidence_score:  confidenceScore,
		evidence_refs:     allRefs,
		data_sources_used: [...new Set(sourcesUsed)],
	};
}
