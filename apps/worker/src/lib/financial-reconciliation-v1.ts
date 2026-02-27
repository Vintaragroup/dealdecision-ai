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
		revenue_vs_headcount_flag:   ReconciliationFlag;
		allocation_vs_growth_flag:   ReconciliationFlag;
		raise_vs_burn_flag:          ReconciliationFlag;
		margin_vs_infra_ratio_flag:  ReconciliationFlag;
	};
	/**
	 * Fraction of the four flags that had sufficient data to evaluate (0–1.0).
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

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run all four reconciliation checks against available parsed financial data.
 *
 * Pure function — no DB calls, no side-effects.
 */
export function reconcileFinancialsV1(inputs: ReconciliationInputs): FinancialReconciliationV1 {
	const { dealId, financialStatement, useOfFunds, impliedCapitalAllocation, incomeStatementAllocation } = inputs;

	const flags: FinancialReconciliationV1["flags"] = {
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
	};

	const flagValues = Object.values(flags);
	const nonSkipCount = flagValues.filter((f) => f.status !== "SKIP").length;
	const confidenceScore = Math.round((nonSkipCount / 4) * 100) / 100;

	const allRefs = dedupeRefs(flagValues.flatMap((f) => f.evidence_refs));

	const sourcesUsed: string[] = [];
	if (financialStatement)       sourcesUsed.push(financialStatement.schema_version);
	if (useOfFunds)               sourcesUsed.push(useOfFunds.schema_version);
	if (impliedCapitalAllocation) sourcesUsed.push(impliedCapitalAllocation.schema_version);
	if (incomeStatementAllocation) sourcesUsed.push(incomeStatementAllocation.schema_version);

	return {
		schema_version:    "financial_reconciliation_v1",
		deal_id:           dealId,
		flags,
		confidence_score:  confidenceScore,
		evidence_refs:     allRefs,
		data_sources_used: [...new Set(sourcesUsed)],
	};
}
