/**
 * Fact Plausibility Guards — Page-level semantic context validation.
 *
 * Provides a generic guard interface and per-field implementations that reject
 * canonical fact extractions when the source page lacks appropriate semantic
 * context or contains disqualifying context signals.
 *
 * Guards complement the existing window-based taint checks (numeric-context-taxonomy)
 * by operating at full-page scope and requiring positive evidence of company
 * context — not just absence of market/competitor language.
 *
 * Architecture:
 *   packages/core/src/fact-plausibility-guards.ts  ← this file (generic interface + guards)
 *   apps/worker/src/jobs/investor-insights/stages/stage-2-deterministic.ts  ← integration
 *   apps/worker/src/jobs/investor-insights/deal-fusion.ts                   ← integration
 */

// ── Generic Guard Interface ───────────────────────────────────────────────────

export interface FactPlausibilityResult {
	/** When false, the extraction should be suppressed. */
	allowed: boolean;
	/** Human-readable reason code for suppression audit trail. */
	reason?: string;
}

/**
 * A guard function that evaluates whether a page is a plausible source for a
 * specific canonical field.
 *
 * @param field     The canonical field name (e.g. "raise_amount").
 * @param pageText  The full normalized text of the source page.
 * @param value     The extracted value string for context-sensitive checks.
 * @returns         A FactPlausibilityResult indicating whether the extraction is allowed.
 */
export type FactPlausibilityGuard = (
	field: string,
	pageText: string,
	value: string,
) => FactPlausibilityResult;

// ── Context Keyword Dictionaries ─────────────────────────────────────────────

/**
 * Fundraising context: keywords indicating a company-level capital raise.
 * Includes past-tense forms (raised, funded), structural labels (round size,
 * the ask, ticket size), and stage descriptors (pre-seed, series a/b/c).
 * Presence is required for raise_amount acceptance.
 */
const FUNDRAISING_CONTEXT = [
	// Verb forms
	"raising",
	"raised",
	"raise",         // standalone word — "Equity $1.5MM raise on a $6MM Valuation"
	// Funding-round descriptor phrases
	"funding round",
	"seed round",
	"bridge round",
	"bridge raise",
	"bridge funding",
	"bridge financing",
	"pre-seed",
	"pre seed",
	"series a",
	"series b",
	"series c",
	// Capital raise phrases
	"capital raise",
	"fundraise",
	"fundraising",
	// Structural ask-deck labels
	"round size",
	"ticket size",
	"the ask",
	"seeking",
	// Past-tense / completion phrasing
	"funded",
	"funding",       // "Total funding $4M raised"
	// Investment round phrase (more specific than bare "investment")
	"investment round",
] as const;

/**
 * Market context: keywords that appear on slides about the external market,
 * not the company's own performance. Presence disqualifies raise_amount / arr_value.
 */
const MARKET_CONTEXT = [
	"market size",
	"tam",
	"sam",
	"som",
	"market opportunity",
	"global market",
	"industry size",
] as const;

/**
 * Company traction context: keywords that indicate company-owned operating metrics.
 * Required for revenue / customer count acceptance.
 */
const COMPANY_CONTEXT = [
	"our",
	"we",
	"company",
	"platform",
	"product",
	"customers",
	"users",
] as const;

/**
 * Competitor context: keywords that indicate the value belongs to a competitor
 * or external entity rather than the presenting company.
 */
const COMPETITOR_CONTEXT = [
	"competitor",
	"competitive landscape",
	"benchmark",
	"industry leader",
	"peer",
] as const;

// ── Helper: keyword presence check (case-insensitive) ────────────────────────

/**
 * Returns true when any keyword in `list` is found in `text` (case-insensitive).
 * Multi-word phrases use substring matching; single words use word-boundary regex
 * to avoid false positives (e.g. "sam" matching "samsung").
 */
function containsAny(text: string, list: ReadonlyArray<string>): boolean {
	const lower = text.toLowerCase();
	for (const kw of list) {
		if (kw.includes(" ")) {
			if (lower.includes(kw)) return true;
		} else {
			if (new RegExp(`\\b${kw}\\b`, "i").test(text)) return true;
		}
	}
	return false;
}

// ── Per-field Guard Functions ─────────────────────────────────────────────────

/**
 * Guard for raise_amount.
 *
 * Requires: at least one FUNDRAISING_CONTEXT keyword present on the page.
 * Rejects:  when MARKET_CONTEXT or COMPETITOR_CONTEXT keywords are present.
 *
 * Rationale: a valid raise-amount page must discuss the company's own fundraise,
 * not a market opportunity size or competitor activity.
 *
 * Examples that PASS:
 *   "We are raising a $5M seed round"             → "raising" + "seed round"
 *   "The Ask: $3M — Seed funding round"           → "funding round" present
 *
 * Examples that FAIL:
 *   "$500M global market opportunity"             → MARKET_CONTEXT ("global market")
 *   "Fundraising landscape: $500M raised by peers" → COMPETITOR_CONTEXT ("peer")
 *   "$12M mentioned in use-of-funds breakdown"    → no FUNDRAISING_CONTEXT
 */
function guardRaiseAmount(
	_field: string,
	pageText: string,
	_value: string,
): FactPlausibilityResult {
	const hasFundraisingCtx = containsAny(pageText, FUNDRAISING_CONTEXT);
	// Market context is only disqualifying when there is NO fundraising context to
	// anchor the extraction — investor decks sometimes mention both a market size AND
	// the raise ask on the same slide (e.g. "Raising $2M. TAM $50B.").
	if (containsAny(pageText, MARKET_CONTEXT) && !hasFundraisingCtx) {
		return { allowed: false, reason: "RAISE_CONTEXT_INVALID:MARKET_CONTEXT_ON_PAGE" };
	}
	if (containsAny(pageText, COMPETITOR_CONTEXT)) {
		return { allowed: false, reason: "RAISE_CONTEXT_INVALID:COMPETITOR_CONTEXT_ON_PAGE" };
	}
	if (!hasFundraisingCtx) {
		return { allowed: false, reason: "RAISE_CONTEXT_INVALID:NO_FUNDRAISING_CONTEXT" };
	}
	return { allowed: true };
}

/**
 * Guard for arr_value.
 *
 * Requires: ARR or annual recurring revenue keyword present on the page.
 * Rejects:  when MARKET_CONTEXT is present without any compensating COMPANY_CONTEXT,
 *           or when COMPETITOR_CONTEXT is present.
 *
 * Company context override: a page that contains both MARKET_CONTEXT and strong
 * company ownership signals (e.g. "our ARR") is still accepted, because investor
 * decks sometimes present company metrics alongside market-sizing data on the same slide.
 *
 * Examples that PASS:
 *   "Our ARR reached $12M in Q3"               → company ownership + ARR keyword
 *   "ARR: $2.4M (Q4 2024)"                     → ARR keyword present
 *
 * Examples that FAIL:
 *   "The SaaS market generates $12B ARR"        → MARKET_CONTEXT without company context
 *   "Competitor ARR is $500M"                   → COMPETITOR_CONTEXT
 */
function guardArr(
	_field: string,
	pageText: string,
	_value: string,
): FactPlausibilityResult {
	if (containsAny(pageText, MARKET_CONTEXT)) {
		// Company context rescues a page that incidentally contains a market term
		if (!containsAny(pageText, COMPANY_CONTEXT)) {
			return { allowed: false, reason: "ARR_CONTEXT_INVALID:MARKET_CONTEXT_WITHOUT_COMPANY_CONTEXT" };
		}
	}
	if (containsAny(pageText, COMPETITOR_CONTEXT)) {
		return { allowed: false, reason: "ARR_CONTEXT_INVALID:COMPETITOR_CONTEXT_ON_PAGE" };
	}
	// Require ARR keyword explicitly — provides a positive signal check
	const hasArrKeyword = /\b(?:ARR|annual\s+recurring\s+revenue|our\s+ARR|company\s+ARR)\b/i.test(pageText);
	if (!hasArrKeyword) {
		return { allowed: false, reason: "ARR_CONTEXT_INVALID:NO_ARR_KEYWORD" };
	}
	return { allowed: true };
}

/**
 * Guard for revenue_value.
 *
 * Requires: COMPANY_CONTEXT keywords present.
 * Rejects:  when "industry revenue", "market revenue", or "competitor revenue"-class
 *           language is present on the page.
 *
 * Examples that PASS:
 *   "Company revenue reached $8M in 2024"       → COMPANY_CONTEXT present
 *   "Our annual revenue: $500K"                 → "our" company context
 *
 * Examples that FAIL:
 *   "Industry revenue is $8B"                   → industry revenue taint
 *   "Market revenue opportunity: $5B"           → market revenue taint
 */
function guardRevenue(
	_field: string,
	pageText: string,
	_value: string,
): FactPlausibilityResult {
	const industryRevenueTaint =
		/\b(?:industry\s+revenue|market\s+revenue|competitor(?:'?s?)?\s+revenue|sector\s+revenue|peer\s+revenue|total\s+addressable\s+revenue)\b/i.test(
			pageText,
		);
	if (industryRevenueTaint) {
		return { allowed: false, reason: "REVENUE_CONTEXT_INVALID:INDUSTRY_REVENUE_ON_PAGE" };
	}
	if (!containsAny(pageText, COMPANY_CONTEXT)) {
		return { allowed: false, reason: "REVENUE_CONTEXT_INVALID:NO_COMPANY_CONTEXT" };
	}
	return { allowed: true };
}

/**
 * Guard for customer_count.
 *
 * Requires: customer/users/clients keyword present.
 * Rejects:  when industry/benchmark/market-average language is present on the page
 *           without compensating explicit company ownership signals.
 *
 * Examples that PASS:
 *   "We serve 1,200 customers"                  → company context + customers keyword
 *   "Active customers: 450"                     → customers keyword
 *
 * Examples that FAIL:
 *   "The industry serves 1.2M customers"        → industry taint
 *   "Market average: 500 customers"             → benchmark/average taint
 */
function guardCustomerCount(
	_field: string,
	pageText: string,
	_value: string,
): FactPlausibilityResult {
	const industryTaint =
		/\b(?:industry|average|benchmark|market\s+(?:average|size)|sector\s+average|peers?\s+(?:have|serve))\b/i.test(
			pageText,
		);
	if (industryTaint) {
		// Explicit company ownership phrases rescue the page
		const hasOwnership =
			/\b(?:our\s+customers?|customer\s+base|platform\s+customers?|paying\s+customers?|active\s+customers?)\b/i.test(
				pageText,
			);
		if (!hasOwnership) {
			return { allowed: false, reason: "CUSTOMER_COUNT_CONTEXT_INVALID:INDUSTRY_CONTEXT_ON_PAGE" };
		}
	}
	const hasCustomerKeyword =
		/\b(?:customers?|users?|clients?)\b/i.test(pageText);
	if (!hasCustomerKeyword) {
		return { allowed: false, reason: "CUSTOMER_COUNT_CONTEXT_INVALID:NO_CUSTOMER_KEYWORD" };
	}
	return { allowed: true };
}

// ── Guard Registry ────────────────────────────────────────────────────────────

/**
 * Registry of plausibility guards keyed by canonical field name.
 *
 * Applied in stage-2-deterministic.ts (evalCanonicalField) and deal-fusion.ts
 * (findBestMatchInDoc) before a canonical fact is accepted.
 *
 * Fields not in this registry are accepted without a page-level plausibility check.
 * Market-claim fields (tam_value, sam_value, som_value) intentionally excluded —
 * market context is correct for those fields.
 */
export const FACT_PLAUSIBILITY_GUARDS: Record<string, FactPlausibilityGuard> = {
	raise_amount:   guardRaiseAmount,
	arr_value:      guardArr,
	revenue_value:  guardRevenue,
	customer_count: guardCustomerCount,
};
