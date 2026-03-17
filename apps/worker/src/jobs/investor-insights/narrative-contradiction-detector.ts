/**
 * narrative-contradiction-detector.ts — PR36.9
 *
 * Deterministic topic-level narrative contradiction detection.
 *
 * Design contract:
 *  - Pure module: no I/O, no side effects, no cross-module imports beyond
 *    narrative-evidence-ranking.ts (for ScoredNarrativeCandidate) and
 *    narrative-contradiction-v1.ts (for types).
 *  - All functions are deterministic for the same input.
 *  - Conservative thresholds: only material investor-relevant divergence triggers a flag.
 *    Minor wording variation, synonym usage, or different aspect coverage never fires.
 *  - Heavily unit-testable with plain string inputs.
 *
 * Phases implemented here:
 *   Phase 2: Core detection helpers
 *   Phase 3: detectNarrativeContradiction used by the bundle selection layer
 */

import type { ScoredNarrativeCandidate } from "./narrative-evidence-ranking.js";
import { TOPIC_MIN_THRESHOLD } from "./narrative-evidence-ranking.js";
import type {
	NarrativeTopic,
	NarrativeContradictionV1,
	NarrativeContradictionStatus,
	NarrativeContradictionReason,
} from "./narrative-contradiction-v1.js";

// ─── Category detection pattern sets ─────────────────────────────────────────
//
// Each set contains patterns identifying a distinct, often mutually exclusive
// product or business category. When candidates match patterns from opposing
// sides of the same axis, a category or semantic divergence is detected.

/** Two-sided marketplace / transaction-fee model indicators. */
const PRODUCT_MARKETPLACE_RE =
	/\b(?:marketplace\b|two[-\s]?sided\s+(?:market|platform)?\b|buyer[s]?\s+(?:and|&)\s+seller[s]?\b|listing[s]?\s+(?:fee|platform)?\b|platform\s+fee\b|commission[-\s]?based\b|connect[s]?\s+(?:buyer[s]?\s+and\s+seller[s]?|lender[s]?\s+and\s+borrower[s]?|investors?\s+and\s+founder[s]?)\b)\b/i;

/** Single-sided SaaS workflow tool indicators (NOT marketplace). */
const PRODUCT_SAAS_TOOL_RE =
	/\b(?:workflow\s+automation\b|SaaS\s+(?:platform|tools?|product)\b|no[-\s]?code\s+(?:tool|platform)\b|automation\s+(?:software|tools?|platform)\b|dashboard\s+(?:for|that|to)\b|API[-\s]?(?:first|platform|tool)\b|embedded\s+(?:tool|software|product)\b)\b/i;

/** Consumer / B2C product indicators. */
const PRODUCT_CONSUMER_RE =
	/\b(?:consumer\s+(?:product|app|platform)\b|B2C\b|personal\s+(?:finance|insurance|loan|savings)\b|individual\s+(?:user|consumer)\b|end[-\s]?consumer\b|retail\s+(?:investor|customer)\b|app\s+(?:for|that\s+helps?)\s+(?:individual|consumer)\b)\b/i;

/** B2B enterprise product indicators (NOT consumer). */
const PRODUCT_B2B_RE =
	/\b(?:B2B\b|enterprise\s+(?:software|solution|platform|product|deal|client)\b|business\s+(?:software|tool|solution|workflow)\b|team\s+(?:workflow|collaboration|productivity)\b|sold\s+to\s+(?:business|enterprise|company|firm)\b)\b/i;

// ─── GTM motion pattern sets (mutually exclusive in extreme form) ─────────────

/** Product-led growth / self-serve / freemium indicators. */
const GTM_PLG_RE =
	/\b(?:product[-\s]?led\b|PLG\b|self[-\s]?serve\b|freemium\b|viral\s+(?:growth|loop|coefficient|adoption)\b|bottom[-\s]?up\b|free\s+tier\b|sign[-\s]?up\s+(?:and|to)\b|no[\s-]?sales[-\s]?team\b)\b/i;

/** Direct outbound sales / AE-driven sales motion indicators. */
const GTM_DIRECT_SALES_RE =
	/\b(?:direct\s+(?:sales?|selling)\b|inside\s+sales?\b|outbound\s+(?:sales?|email|dialing|motion)\b|account\s+executive[s]?\b|SDR[s]?\b|AE[s]?\b|sales[-\s]?led\s+(?:growth)?\b|enterprise\s+(?:sales?\s+team|sales?\s+motion|deal)\b)\b/i;

/** Enterprise segment signals. */
const GTM_ENTERPRISE_SEGMENT_RE =
	/\b(?:Fortune\s+\d+\b|large\s+enterprise\b|enterprise\s+(?:deal|client|customer|contract|account)\b|top[-\s]?tier\s+company\b|global\s+(?:bank|insurer|company)\b)\b/i;

/** SMB / startup segment signals. */
const GTM_SMB_SEGMENT_RE =
	/\b(?:SMB\b|small\s+(?:business|company)\b|startup[s]?\b|early[-\s]?stage\s+company\b|freelancer[s]?\b|solopreneur[s]?\b)\b/i;

// ─── Financial stage signals ──────────────────────────────────────────────────

/** Pre-revenue / early-stage maturity signals. */
const FINANCIAL_PRE_REVENUE_RE =
	/\b(?:pre[-\s]?revenue\b|no\s+revenue\b|not\s+yet\s+generating\s+revenue\b|first\s+(?:paying\s+)?(?:customer|client|user|revenue)\b|MVP\b|beta\s+(?:launch|customer|user|test)\b|early\s+(?:adopter|traction|customer|pilot)\b|seeking\s+(?:first|initial)\s+(?:customer|client|revenue)\b)\b/i;

/** Post-revenue maturity signals — ARR/MRR with amounts, substantial KPIs. */
const FINANCIAL_POST_REVENUE_RE =
	/\b(?:ARR\b|MRR\b|annual\s+recurring\s+revenue\b|monthly\s+recurring\s+revenue\b|revenue\s+of\s*(?:\$|£|€))/i;

// ─── Capital / raise signal patterns ─────────────────────────────────────────

/** Equity raise / investment instrument signals. */
const CAPITAL_EQUITY_RAISE_RE =
	/\b(?:rais(?:ing|es?)\s+(?:\$|£|€)[\d,.]+\b|equity\s+(?:raise|round|financing)\b|SAFE\b|convertible\s+note[s]?\b|priced\s+round\b|Series\s+[A-F]\b|Seed\s+round\b|investment\s+round\b)\b/i;

/** Volume / GMV metric signals that are NOT equity raises. */
const CAPITAL_VOLUME_METRIC_RE =
	/\b(?:GMV\b|gross\s+merchandise\s+value\b|transaction\s+volume\b|total\s+(?:payment|processing|transaction)\s+volume\b|platform\s+volume\b|book(?:ed)?\s+(?:volume|GTV)\b|GTV\b)\b/i;

// ─── Numeric extraction ───────────────────────────────────────────────────────

/**
 * Extract the first numeric dollar/pound/euro amount from a text string.
 * Returns the normalized value in base units (e.g. "$2.4M" → 2_400_000).
 * Returns null if no amount is found.
 */
export function extractLeadingMonetaryAmount(text: string): number | null {
	const match =
		/(?:\$|£|€)\s*([\d,.]+)\s*(K\b|M\b|B\b|T\b|million\b|billion\b|thousand\b|k\b)?/i.exec(text);
	if (!match) return null;
	const raw = parseFloat(match[1].replace(/,/g, ""));
	if (isNaN(raw)) return null;
	const suffix = (match[2] ?? "").toLowerCase();
	if (suffix === "k" || suffix === "thousand") return raw * 1_000;
	if (suffix === "m" || suffix === "million") return raw * 1_000_000;
	if (suffix === "b" || suffix === "billion") return raw * 1_000_000_000;
	if (suffix === "t") return raw * 1_000_000_000_000;
	return raw;
}

/**
 * Extract ALL monetary amounts from a text string.
 * Returns an array sorted ascending. Empty array when none found.
 */
export function extractAllMonetaryAmounts(text: string): number[] {
	const amounts: number[] = [];
	const re = /(?:\$|£|€)\s*([\d,.]+)\s*(K\b|M\b|B\b|T\b|million\b|billion\b|thousand\b|k\b)?/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const raw = parseFloat(match[1].replace(/,/g, ""));
		if (!isNaN(raw)) {
			const suffix = (match[2] ?? "").toLowerCase();
			let base = raw;
			if (suffix === "k" || suffix === "thousand") base = raw * 1_000;
			else if (suffix === "m" || suffix === "million") base = raw * 1_000_000;
			else if (suffix === "b" || suffix === "billion") base = raw * 1_000_000_000;
			amounts.push(base);
		}
	}
	return amounts.sort((a, b) => a - b);
}

// ─── Context-specific amount extraction ──────────────────────────────────────

/** Regex that anchors dollar amounts near recurring-revenue context words. */
const ARR_MRR_CONTEXT_RE =
	/(?:ARR\b|MRR\b|annual\s+recurring\s+revenue\b|monthly\s+recurring\s+revenue\b).{0,120}(?:\$|£|€)/i;
const ARR_MRR_CONTEXT_RE_B =
	/(?:\$|£|€).{0,120}(?:ARR\b|MRR\b|annual\s+recurring\s+revenue\b|monthly\s+recurring\s+revenue\b)/i;

/** Extract the first dollar amount that appears in ARR/MRR context. */
function extractArrMrrAmount(text: string): number | null {
	if (!ARR_MRR_CONTEXT_RE.test(text) && !ARR_MRR_CONTEXT_RE_B.test(text)) return null;
	return extractLeadingMonetaryAmount(text);
}

// ─── Numeric divergence check ─────────────────────────────────────────────────

const NUMERIC_DIVERGENCE_THRESHOLD = 3; // 3× = minor, 5× = strong → conflicting

/**
 * Compare two numeric amounts and return a divergence classification.
 * Returns null when either amount is null/zero (no comparison possible).
 */
function classifyNumericDivergence(
	amtA: number | null,
	amtB: number | null,
): { status: NarrativeContradictionStatus; ratio: number } | null {
	if (!amtA || !amtB || amtA <= 0 || amtB <= 0) return null;
	const ratio = Math.max(amtA, amtB) / Math.min(amtA, amtB);
	if (ratio >= 5) return { status: "conflicting", ratio };
	if (ratio >= NUMERIC_DIVERGENCE_THRESHOLD) return { status: "mixed", ratio };
	return null;
}

// ─── Core classification helpers ──────────────────────────────────────────────

interface DisagreementClassification {
	status: NarrativeContradictionStatus;
	reason: NarrativeContradictionReason | null;
	notes: string[];
}

/**
 * Classify the disagreement between two candidate text strings for a specific topic.
 *
 * Returns status="none" when no material investor-relevant divergence is detected.
 *
 * Design notes:
 *  - "mixed" = both framings could coexist in reality (e.g. enterprise sales + SMB growth)
 *  - "conflicting" = framings are mutually exclusive or numerically incompatible
 *  - Only fire on investor-relevant signals that change the investment conclusion
 */
export function classifyNarrativeDisagreement(
	a: string,
	b: string,
	topic: NarrativeTopic,
): DisagreementClassification {
	const none: DisagreementClassification = { status: "none", reason: null, notes: [] };

	// Safety: don't compare trivially short fragments
	if (a.trim().length < 20 || b.trim().length < 20) return none;

	switch (topic) {
		case "product_differentiation":
			return classifyProductDiff(a, b);

		case "go_to_market_strategy":
			return classifyGtmDisagreement(a, b);

		case "financial_outlook":
			return classifyFinancialDisagreement(a, b);

		case "capital_and_raise":
			return classifyCapitalDisagreement(a, b);

		case "traction":
			return classifyTractionDisagreement(a, b);

		case "market_position":
			return classifyMarketDisagreement(a, b);

		case "business_quality":
			return classifyBusinessQualityDisagreement(a, b);

		default:
			return none;
	}
}

// ─── Topic-specific classifiers ───────────────────────────────────────────────

function classifyProductDiff(a: string, b: string): DisagreementClassification {
	// Check for CATEGORY DIVERGENCE: marketplace vs SaaS tool
	const aIsMarketplace = PRODUCT_MARKETPLACE_RE.test(a);
	const bIsMarketplace = PRODUCT_MARKETPLACE_RE.test(b);
	const aIsSaasTool = PRODUCT_SAAS_TOOL_RE.test(a);
	const bIsSaasTool = PRODUCT_SAAS_TOOL_RE.test(b);

	if (
		(aIsMarketplace && bIsSaasTool && !bIsMarketplace) ||
		(bIsMarketplace && aIsSaasTool && !aIsMarketplace)
	) {
		return {
			status: "conflicting",
			reason: "category_divergence",
			notes: [
				"Candidates imply mutually exclusive product categories: marketplace (transaction-fee model) vs SaaS workflow tool.",
				"Do NOT collapse to a single settled claim for product_differentiation.",
			],
		};
	}

	// Check for B2B vs B2C divergence
	const aIsConsumer = PRODUCT_CONSUMER_RE.test(a);
	const bIsConsumer = PRODUCT_CONSUMER_RE.test(b);
	const aIsB2B = PRODUCT_B2B_RE.test(a);
	const bIsB2B = PRODUCT_B2B_RE.test(b);

	if (
		(aIsConsumer && bIsB2B && !bIsConsumer) ||
		(bIsConsumer && aIsB2B && !aIsConsumer)
	) {
		return {
			status: "conflicting",
			reason: "category_divergence",
			notes: [
				"Candidates imply mutually exclusive customer models: B2C consumer product vs B2B enterprise tool.",
				"Do NOT collapse to a single settled claim for product_differentiation.",
			],
		};
	}

	return { status: "none", reason: null, notes: [] };
}

function classifyGtmDisagreement(a: string, b: string): DisagreementClassification {
	const aIsPLG = GTM_PLG_RE.test(a);
	const bIsPLG = GTM_PLG_RE.test(b);
	const aIsDirect = GTM_DIRECT_SALES_RE.test(a);
	const bIsDirect = GTM_DIRECT_SALES_RE.test(b);

	// PLG and direct sales can coexist (land-and-expand), so this is "mixed" not "conflicting"
	// Only flag if one STRONGLY implies PLG-only or direct-only
	const aPLGOnly = aIsPLG && !aIsDirect;
	const bPLGOnly = bIsPLG && !bIsDirect;
	const aDirectOnly = aIsDirect && !aIsPLG;
	const bDirectOnly = bIsDirect && !bIsPLG;

	if ((aPLGOnly && bDirectOnly) || (bPLGOnly && aDirectOnly)) {
		return {
			status: "mixed",
			reason: "semantic_divergence",
			notes: [
				"Candidates imply different GTM motions: one suggests product-led/self-serve, the other direct sales.",
				"Both could coexist in a land-and-expand model, but the primary framing diverges.",
			],
		};
	}

	// Segment divergence: SMB vs large enterprise (can coexist, but flag as mixed)
	const aIsEnterprise = GTM_ENTERPRISE_SEGMENT_RE.test(a);
	const bIsEnterprise = GTM_ENTERPRISE_SEGMENT_RE.test(b);
	const aIsSMB = GTM_SMB_SEGMENT_RE.test(a);
	const bIsSMB = GTM_SMB_SEGMENT_RE.test(b);

	if (
		(aIsEnterprise && !aIsSMB && bIsSMB && !bIsEnterprise) ||
		(bIsEnterprise && !bIsSMB && aIsSMB && !aIsEnterprise)
	) {
		return {
			status: "mixed",
			reason: "semantic_divergence",
			notes: [
				"Candidates reference materially different target segments: enterprise vs SMB/startup.",
				"Qualify language — the primary ICP may be unclear.",
			],
		};
	}

	return { status: "none", reason: null, notes: [] };
}

function classifyFinancialDisagreement(a: string, b: string): DisagreementClassification {
	// Stage divergence: pre-revenue vs post-revenue ARR
	const aIsPreRevenue = FINANCIAL_PRE_REVENUE_RE.test(a);
	const bIsPreRevenue = FINANCIAL_PRE_REVENUE_RE.test(b);
	const aIsPostRevenue = FINANCIAL_POST_REVENUE_RE.test(a);
	const bIsPostRevenue = FINANCIAL_POST_REVENUE_RE.test(b);

	if (
		(aIsPreRevenue && bIsPostRevenue && !bIsPreRevenue) ||
		(bIsPreRevenue && aIsPostRevenue && !aIsPreRevenue)
	) {
		return {
			status: "conflicting",
			reason: "stage_vs_metric_divergence",
			notes: [
				"One candidate implies pre-revenue or MVP stage; the other references post-revenue ARR/MRR metrics.",
				"These are mutually exclusive maturity signals — verify which is current.",
			],
		};
	}

	// Numeric divergence: ARR/MRR amounts
	const arrA = extractArrMrrAmount(a);
	const arrB = extractArrMrrAmount(b);

	if (arrA !== null && arrB !== null) {
		const div = classifyNumericDivergence(arrA, arrB);
		if (div) {
			return {
				status: div.status,
				reason: "numeric_divergence",
				notes: [
					`ARR/MRR amounts differ by ${div.ratio.toFixed(1)}×.`,
					div.status === "conflicting"
						? "Do NOT present a single revenue figure without noting the discrepancy."
						: "Qualify financial claims — multiple figures are present.",
				],
			};
		}
	}

	// General numeric divergence across all dollar amounts in context
	const amtsA = extractAllMonetaryAmounts(a);
	const amtsB = extractAllMonetaryAmounts(b);
	if (amtsA.length > 0 && amtsB.length > 0) {
		// Compare the largest amounts from each candidate
		const maxA = amtsA[amtsA.length - 1];
		const maxB = amtsB[amtsB.length - 1];
		const div = classifyNumericDivergence(maxA, maxB);
		if (div && div.status === "conflicting") {
			return {
				status: "mixed",
				reason: "numeric_divergence",
				notes: [
					`Financial figures differ significantly (${div.ratio.toFixed(1)}× divergence) across candidates.`,
					"Qualify financial language.",
				],
			};
		}
	}

	return { status: "none", reason: null, notes: [] };
}

/**
 * Remove amounts that appear in a valuation/cap context (e.g. "$15M cap", "$20M pre-money")
 * from a text before numeric comparison, so that cap amounts aren't mistaken for raise amounts.
 */
function stripCapValuationAmounts(text: string): string {
	return text.replace(
		/(?:\$|£|€)[\d,.]+(?:\s*(?:K\b|M\b|B\b|million\b|billion\b|thousand\b|k\b))?\s+(?:cap\b|valuation\b|pre[-\s]?money(?:\s+valuation)?\b|post[-\s]?money(?:\s+valuation)?\b)/gi,
		"",
	);
}

function classifyCapitalDisagreement(a: string, b: string): DisagreementClassification {
	// Equity raise vs volume metric confusion
	const aIsEquity = CAPITAL_EQUITY_RAISE_RE.test(a);
	const bIsEquity = CAPITAL_EQUITY_RAISE_RE.test(b);
	const aIsVolume = CAPITAL_VOLUME_METRIC_RE.test(a);
	const bIsVolume = CAPITAL_VOLUME_METRIC_RE.test(b);

	if (
		(aIsEquity && !aIsVolume && bIsVolume && !bIsEquity) ||
		(bIsEquity && !bIsVolume && aIsVolume && !aIsEquity)
	) {
		return {
			status: "conflicting",
			reason: "source_divergence",
			notes: [
				"One candidate references an equity raise; the other references a volume/GMV metric.",
				"These are fundamentally different financial concepts. Do NOT conflate them.",
				"Verify carefully — GMV is not equity raised.",
			],
		};
	}

	// Numeric divergence: raise amounts
	// Strip cap/valuation amounts first so "$15M cap" is not compared against the raise size.
	const cleanA = stripCapValuationAmounts(a);
	const cleanB = stripCapValuationAmounts(b);
	const amtsA = extractAllMonetaryAmounts(cleanA).filter((x) => x >= 1000); // filter < $1K noise
	const amtsB = extractAllMonetaryAmounts(cleanB).filter((x) => x >= 1000);

	if (
		aIsEquity &&
		bIsEquity &&
		amtsA.length > 0 &&
		amtsB.length > 0
	) {
		const maxA = amtsA[amtsA.length - 1];
		const maxB = amtsB[amtsB.length - 1];
		const div = classifyNumericDivergence(maxA, maxB);
		if (div) {
			return {
				status: div.status,
				reason: "numeric_divergence",
				notes: [
					`Raise amounts differ by ${div.ratio.toFixed(1)}×.`,
					"Verify which figure represents the current equity raise.",
				],
			};
		}
	}

	return { status: "none", reason: null, notes: [] };
}

function classifyTractionDisagreement(a: string, b: string): DisagreementClassification {
	// Maturity divergence: early-stage signals vs significant scale signals
	const aIsEarly = FINANCIAL_PRE_REVENUE_RE.test(a);
	const bIsEarly = FINANCIAL_PRE_REVENUE_RE.test(b);

	// Scale signals: meaningful customer counts (≥10), any NRR/expansion metric
	const SCALE_TRACTION_RE =
		/\b(?:NRR\b|net\s+(?:revenue\s+)?retention\b|expansion\s+revenue\b|\d{2,}\s*(?:\+\s*)?(?:customer|client|user)[s]?\b)\b/i;
	const aHasScale = SCALE_TRACTION_RE.test(a);
	const bHasScale = SCALE_TRACTION_RE.test(b);

	if ((aIsEarly && bHasScale && !bIsEarly) || (bIsEarly && aHasScale && !aIsEarly)) {
		return {
			status: "mixed",
			reason: "stage_vs_metric_divergence",
			notes: [
				"Candidates imply materially different traction maturity levels.",
				"Qualify traction claims — early-stage and scale-stage signals are both present.",
			],
		};
	}

	return { status: "none", reason: null, notes: [] };
}

function classifyMarketDisagreement(a: string, b: string): DisagreementClassification {
	// Market size numeric divergence (TAM in context)
	const TAM_CONTEXT_RE = /\b(?:TAM\b|SAM\b|SOM\b|total\s+addressable\s+market\b|market\s+(?:size|opportunity)\b)/i;
	const aHasTam = TAM_CONTEXT_RE.test(a);
	const bHasTam = TAM_CONTEXT_RE.test(b);

	if (aHasTam && bHasTam) {
		const amtsA = extractAllMonetaryAmounts(a);
		const amtsB = extractAllMonetaryAmounts(b);
		if (amtsA.length > 0 && amtsB.length > 0) {
			const maxA = amtsA[amtsA.length - 1];
			const maxB = amtsB[amtsB.length - 1];
			const div = classifyNumericDivergence(maxA, maxB);
			if (div) {
				return {
					status: div.status,
					reason: "numeric_divergence",
					notes: [
						`Market size figures differ by ${div.ratio.toFixed(1)}×.`,
						"Verify which figure represents the relevant addressable market for this deal.",
					],
				};
			}
		}
	}

	// Category drift: significantly different market framing (e.g. insurance vs fintech)
	// Use a broader check — if both reference significantly different market verticals
	const INSURANCE_RE = /\b(?:insurance\b|insur(?:tech|ance\s+market)\b|underwriting\b|policy\b|premium[s]?\b)/i;
	const MORTGAGE_RE = /\b(?:mortgage[s]?\b|home\s+loan[s]?\b|real\s+estate\s+(?:finance|loan)\b|origination[s]?\b)\b/i;
	const ECOMMERCE_RE = /\b(?:e[-\s]?commerce\b|online\s+(?:retail|shopping|store)\b|D2C\b)\b/i;
	const FINTECH_INFRA_RE = /\b(?:payments?\s+(?:infrastructure|platform|network)\b|payment\s+processing\b|banking\s+infrastructure\b)\b/i;

	const marketCategoryChecks: Array<[RegExp, string]> = [
		[INSURANCE_RE, "insurance"],
		[MORTGAGE_RE, "mortgage/home-loan"],
		[ECOMMERCE_RE, "e-commerce"],
		[FINTECH_INFRA_RE, "payments infrastructure"],
	];

	const aCats = marketCategoryChecks.filter(([re]) => re.test(a)).map(([, label]) => label);
	const bCats = marketCategoryChecks.filter(([re]) => re.test(b)).map(([, label]) => label);

	// Conflict when both have categories and none overlap
	const overlap = aCats.filter((c) => bCats.includes(c));
	if (aCats.length > 0 && bCats.length > 0 && overlap.length === 0) {
		return {
			status: "mixed",
			reason: "category_divergence",
			notes: [
				`Candidates reference different market categories: [${aCats.join(", ")}] vs [${bCats.join(", ")}].`,
				"Qualify market framing — may indicate category drift across slides.",
			],
		};
	}

	return { status: "none", reason: null, notes: [] };
}

function classifyBusinessQualityDisagreement(a: string, b: string): DisagreementClassification {
	// Stage maturity: pre-revenue vs post-revenue metrics (e.g. NRR, margin)
	const aIsEarly = FINANCIAL_PRE_REVENUE_RE.test(a);
	const bIsEarly = FINANCIAL_PRE_REVENUE_RE.test(b);
	const aIsPostRevenue = FINANCIAL_POST_REVENUE_RE.test(a);
	const bIsPostRevenue = FINANCIAL_POST_REVENUE_RE.test(b);

	if (
		(aIsEarly && bIsPostRevenue && !bIsEarly) ||
		(bIsEarly && aIsPostRevenue && !aIsEarly)
	) {
		return {
			status: "mixed",
			reason: "stage_vs_metric_divergence",
			notes: [
				"Candidates imply materially different business maturity levels (pre-revenue vs post-revenue).",
				"Qualify business quality claims accordingly.",
			],
		};
	}

	return { status: "none", reason: null, notes: [] };
}

// ─── Public detection API ─────────────────────────────────────────────────────

/**
 * Test whether two text candidates represent a meaningful investor-relevant
 * disagreement for a given topic.
 *
 * Returns false for:
 * - Trivially short texts
 * - Minor wording variation / different aspect coverage
 * - Candidates that simply address different sub-topics without conflicting
 *
 * @example
 *   hasMeaningfulTopicDisagreement(
 *     "StackFactor automates due diligence workflows...",
 *     "StackFactor is a marketplace connecting investors to deal sources...",
 *     "product_differentiation"
 *   );
 *   // true — category_divergence (SaaS tool vs marketplace)
 */
export function hasMeaningfulTopicDisagreement(
	a: string,
	b: string,
	topic: NarrativeTopic,
): boolean {
	const classification = classifyNarrativeDisagreement(a, b, topic);
	return classification.status !== "none";
}

/**
 * Detect and classify the narrative contradiction across an array of ranked
 * candidates for a specific topic.
 *
 * Algorithm:
 *  1. Filter candidates to those above the topic's minimum quality threshold.
 *  2. If fewer than 2 qualified candidates → status = "none".
 *  3. Compare the best candidate against each runner-up using
 *     classifyNarrativeDisagreement.
 *  4. Take the most severe classification found (conflicting > mixed > none).
 *
 * Returns a NarrativeContradictionV1 record regardless of status.
 * When status = "none", secondary_texts and notes are empty.
 *
 * @param candidates  Ranked candidates (output of rankNarrativeCandidates).
 *                    Must already be sorted descending by score.
 * @param topic       The narrative topic these candidates belong to.
 */
export function detectNarrativeContradiction(
	candidates: ScoredNarrativeCandidate[],
	topic: NarrativeTopic,
): NarrativeContradictionV1 {
	const threshold = TOPIC_MIN_THRESHOLD[topic];
	const qualified = candidates.filter((c) => c.score >= threshold);

	// Default: no contradiction when insufficient candidates
	if (qualified.length === 0) {
		return {
			topic,
			status: "none",
			reason: null,
			primary_text: candidates[0]?.text ?? "",
			secondary_texts: [],
			notes: [],
		};
	}

	if (qualified.length === 1) {
		return {
			topic,
			status: "none",
			reason: null,
			primary_text: qualified[0].text,
			secondary_texts: [],
			notes: [],
		};
	}

	const primary = qualified[0];
	const runners = qualified.slice(1, 4); // compare against up to 3 runner-ups

	let bestStatus: NarrativeContradictionStatus = "none";
	let bestReason: NarrativeContradictionReason | null = null;
	let bestNotes: string[] = [];
	const conflictingSecondaries: string[] = [];

	for (const runner of runners) {
		const classification = classifyNarrativeDisagreement(primary.text, runner.text, topic);
		if (classification.status === "none") continue;

		// Track all runner-ups that conflict
		conflictingSecondaries.push(runner.text);

		// Take most severe classification
		if (
			classification.status === "conflicting" ||
			(classification.status === "mixed" && bestStatus === "none")
		) {
			bestStatus = classification.status;
			bestReason = classification.reason;
			bestNotes = classification.notes;
		}
	}

	if (bestStatus === "none") {
		// No meaningful disagreement found — still return all secondary evidence
		return {
			topic,
			status: "none",
			reason: null,
			primary_text: primary.text,
			secondary_texts: runners.map((r) => r.text),
			notes: [],
		};
	}

	return {
		topic,
		status: bestStatus,
		reason: bestReason,
		primary_text: primary.text,
		secondary_texts: conflictingSecondaries,
		notes: bestNotes,
	};
}
