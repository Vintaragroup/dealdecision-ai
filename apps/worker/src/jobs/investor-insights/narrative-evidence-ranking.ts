/**
 * narrative-evidence-ranking.ts — PR36.8
 *
 * Deterministic evidence-ranked narrative input selection.
 *
 * Problem: The existing bundle builders (buildProductNarrativeBody,
 * buildProductSignalsBundleSection, buildGtmSignalsBundleSection) select
 * candidates by document/page order — the first keyword-matching page always
 * wins, regardless of quality, specificity, or quantitative grounding.
 *
 * Solution: Score-and-rank candidates before selection. Higher-quality, more
 * specific, more numerically grounded evidence wins over generic clichés and
 * OCR fragments.
 *
 * Design contract:
 *  - Pure module: no I/O, no side effects, no cross-module imports.
 *  - All functions are deterministic for the same input.
 *  - Heavily unit-testable with plain string inputs.
 *  - Phases 1–6 of PR36.8 implemented here:
 *      Phase 1: core scoring helpers
 *      Phase 2: topic-specific ranking rules
 *      Phase 3: minimum quality thresholds (null-on-low-quality)
 *      Phase 5: generic language suppression
 *      Phase 6: consistent cross-surface evidence selection via shared API
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The seven narrative topics that require ranked evidence selection.
 */
export type NarrativeTopic =
	| "product_differentiation"
	| "go_to_market_strategy"
	| "market_position"
	| "financial_outlook"
	| "capital_and_raise"
	| "traction"
	| "business_quality";

/**
 * Source trust tier — used to apply a bonus to more authoritative evidence.
 * Ordered from highest to lowest trust.
 */
export type CandidateSourceType =
	| "canonical_fact" // Phase 2 canonical field / promoted structured fact
	| "structured_section" // Parsed structured section (financial statement, UoF)
	| "focused_bundle" // Keyword-filtered signal bundle
	| "raw_ocr_page"; // Unfiltered OCR page text

/**
 * Optional metadata that can improve scoring accuracy when available.
 */
export interface CandidateMeta {
	/** Source trust tier — higher tiers get a score bonus. */
	sourceType?: CandidateSourceType;
	/** PR36.6 evidence confidence level string, e.g. "STRONG_EVIDENCE" or "CONFLICTING". */
	confidenceLevel?: string;
}

/**
 * Detailed scoring breakdown for a single candidate.
 * Returned by scoreNarrativeCandidate for testing and observability.
 */
export interface NarrativeCandidateScore {
	/** Net score.  Higher is better.  Can be negative. */
	score: number;
	/** Human-readable list of signals (labels + deltas) that drove the score. */
	signals: string[];
}

/**
 * Input candidate for ranking.
 */
export interface NarrativeCandidate {
	text: string;
	meta?: CandidateMeta;
}

/**
 * A ranked candidate that includes its source text, score, and signal breakdown.
 */
export interface ScoredNarrativeCandidate {
	text: string;
	meta: CandidateMeta;
	score: number;
	signals: string[];
}

// ─── Minimum quality thresholds (Phase 3) ────────────────────────────────────

/**
 * Minimum score a candidate must achieve to be included in the output.
 * When ALL candidates are below this threshold, the topic returns null —
 * signalling downstream callers to omit the section rather than emitting filler.
 *
 * Rationale by topic:
 *  - financial_outlook / capital_and_raise: higher bar — only actual data signals qualify.
 *  - product / gtm / market: need some specificity, but a concrete ICP sentence is enough.
 *  - traction / business_quality: more lenient — any relevant signal is better than nothing.
 */
export const TOPIC_MIN_THRESHOLD: Record<NarrativeTopic, number> = {
	product_differentiation: 8,
	go_to_market_strategy: 8,
	market_position: 8,
	financial_outlook: 8,
	capital_and_raise: 8,
	traction: 5,
	business_quality: 5,
};

// ─── Universal pattern constants ──────────────────────────────────────────────

/**
 * Matches quantitative specificity signals:
 * currency amounts, percentages, multipliers, or concrete unit counts.
 */
const QUANTITATIVE_RE =
	/(?:(?:\$|£|€)[\d,.]+(?:\s*(?:K\b|M\b|B\b|T\b|k\b|million\b|billion\b|thousand\b))?|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s*[xX]\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+\s*(?:customers?\b|users?\b|clients?\b|seats?\b|months?\b))/i;

/** Matches a complete sentence: capital letter at start AND terminal punctuation at end. */
const SENTENCE_START_RE = /^[A-Z]/;
const TERMINAL_PUNCT_RE = /[.!?]\s*$/;

/** Matches multi-sentence text (period/! followed by space + capital = new sentence). */
const MULTI_SENTENCE_RE = /[.!?]\s+[A-Z]/;

/**
 * "Why better" comparative language — signals the candidate explains differentiation.
 * Used both as a universal quality signal and referenced per topic.
 */
const WHY_BETTER_RE =
	/\b(?:versus\b|compared\s+to\b|unlike\b|better\s+than\b|advantage\s+over\b|more\s+(?:efficient|accurate|reliable|scalable|powerful)\s+than\b|replac(?:es?|ing)\b|outperforms?\b|differentiates?\b|superior\s+to\b|rather\s+than\b)\b/i;

/**
 * Evidence-backed phrasing — signals a grounded claim rather than assertion.
 */
const EVIDENCE_BACKED_RE =
	/\b(?:we\s+(?:achieved|generated|closed|signed|renewed|grew|retain|report)\b|our\s+(?:customers?|clients?|users?)\s+(?:include\b|report\b|are\b|use\b|have\b)|as\s+reported\b|according\s+to\b)\b/i;

/**
 * Placeholder / missing data signals — strongly penalised.
 */
const PLACEHOLDER_RE =
	/\b(?:not\s+determinable|not\s+disclosed|unknown\b|tbd\b|n\/a\b|to\s+be\s+determined|information\s+(?:not\s+)?available|data\s+not\s+available|not\s+yet\s+disclosed)\b/i;

// ─── Generic suppression patterns (Phase 5) ──────────────────────────────────

/**
 * Business-cliché phrases that indicate low-information content.
 *
 * Each match applies a cumulative penalty of up to 15 points, capped at -30
 * total across all suppression matches for a single candidate.
 *
 * Design note: these are exported so callers and tests can assert coverage.
 */
export const GENERIC_SUPPRESSION_SIGNALS: ReadonlyArray<{ re: RegExp; label: string }> = [
	{ re: /\binnovative\s+(?:platform|solution|approach|technology)\b/i, label: "generic:innovative_platform" },
	{ re: /\bdesigned\s+to\s+(?:enhance|improve|empower|streamline|transform|revolutionize)\b/i, label: "generic:designed_to_verb" },
	{
		// Only exempt when AI is paired with a specific technical process verb.
		// "leverages AI to help businesses" → still generic (not exempted).
		// "leverages AI to process transactions" → specific (exempt).
		re: /\bleverages?\s+AI\b(?!\s+to\s+(?:process\b|analyze\b|extract\b|classify\b|detect\b|identify\b|predict\b|automate\b|generate\b|optimize\b|score\b|rank\b|reduce\b|match\b|parse\b|transform\b))/i,
		label: "generic:leverages_ai_ungrounded",
	},
	{ re: /\bmodern\s+(?:shopping|business|workplace|consumer)\s+behaviou?rs?\b/i, label: "generic:modern_behaviors" },
	{ re: /\bpassionate\s+(?:team|founder|about\s+\w+)\b/i, label: "generic:passionate" },
	{ re: /\bgame[-\s]?chang(?:er|ing)\b/i, label: "generic:game_changing" },
	{ re: /\bcutting[-\s]?edge\b/i, label: "generic:cutting_edge" },
	{ re: /\bstate[-\s]?of[-\s]?the[-\s]?art\b/i, label: "generic:state_of_the_art" },
	{ re: /\bworld[-\s]?class\b/i, label: "generic:world_class" },
	{ re: /\bbest[-\s]?in[-\s]?class\b/i, label: "generic:best_in_class" },
	{ re: /\brevolutionar(?:y|izing|ize)\b/i, label: "generic:revolutionary" },
	{ re: /\bbest[-\s]?of[-\s]?breed\b/i, label: "generic:best_of_breed" },
	{ re: /\bby\s+leveraging\b/i, label: "generic:by_leveraging" },
	{ re: /\bnext[-\s]?generation\s+(?:platform|solution|technology)\b/i, label: "generic:next_gen_platform" },
	{ re: /\bholistic\s+(?:approach|solution|platform)\b/i, label: "generic:holistic" },
	// ── Capital-raise / use-of-funds boilerplate ──────────────────────────────
	// These phrases appear on "Capital Allocation" / "Use of Funds" pitch-deck
	// slides describing how proceeds are deployed — NOT the product itself.
	// Suppressing them prevents fundraise slides from outranking product pages
	// in buildProductNarrativeBody (Root Cause B — Palm generic boilerplate).
	{ re: /\bstrategic\s+hires?\b/i, label: "generic:strategic_hires" },
	{ re: /\bunlock\s+(?:the\s+)?(?:growth|potential|opportunity)\b/i, label: "generic:unlock_growth" },
	{
		re: /\b(?:this\s+)?(?:seed|series\s+[a-f])\s+round\s+(?:will|to)\s+(?:enable|fund|support|allow)\b/i,
		label: "generic:raise_enables_verb",
	},
	{ re: /\bcapital\s+alloca(?:tion|te)\b/i, label: "generic:capital_allocation" },
	{ re: /\bscale\s+(?:our\s+)?marketing\b/i, label: "generic:scale_marketing" },
	{ re: /\bengage\s+(?:the\s+)?(?:necessary|key|right)\s+talent\b/i, label: "generic:engage_talent" },
];

// ─── Source type bonus table ──────────────────────────────────────────────────

const SOURCE_TYPE_BONUS: Record<CandidateSourceType, number> = {
	canonical_fact: 5,
	structured_section: 3,
	focused_bundle: 1,
	raw_ocr_page: 0,
};

// ─── Confidence level bonus table (PR36.6) ────────────────────────────────────

const CONFIDENCE_LEVEL_BONUS: Readonly<Record<string, number>> = {
	VERIFIED: 5,
	STRONG_EVIDENCE: 5,
	WEAK_EVIDENCE: -2,
	CONFLICTING: -15,
	PROVISIONAL: -5,
	SUPPRESSED: -50,
};

// ─── Topic-specific signal tables (Phase 2) ──────────────────────────────────

interface TopicSignal {
	re: RegExp;
	score: number;
	label: string;
}

// ── Product Differentiation ───────────────────────────────────────────────────
// Prefer: workflow descriptions, integration signals, proprietary claims,
//         "why better" evidence, concrete feature / use-case language.
// Avoid: generic "platform" / "solution" taglines (handled by suppression).
const PRODUCT_DIFF_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		re: /\b(?:workflow[s]?\b|automat(?:es?|ion|ing|ically)\b)/i,
		score: 10,
		label: "product:workflow_automation",
	},
	{
		re: /\b(?:integrat(?:es?|ion|ing)\s+with\b|connects?\s+(?:to|with)\b|plug[-\s]?in[s]?\b|API\s+(?:integration|connect|access)\b|SDK\b)\b/i,
		score: 8,
		label: "product:integration",
	},
	{
		re: /\b(?:patented?\b|proprietary\s+(?:algorithm|model|method|approach|technology|data|scoring)\b)\b/i,
		score: 10,
		label: "product:proprietary_claim",
	},
	{
		re: WHY_BETTER_RE,
		score: 10,
		label: "product:why_better",
	},
	{
		re: /\b(?:AI[-\s]?(?:powered|driven|based|native)\b|machine\s+learning\b|ML\b|deep\s+learning\b)/i,
		score: 4,
		label: "product:ai_claim",
	},
	{
		re: /\b(?:use\s+case[s]?\b|what\s+we\s+(?:do\b|build\b|offer\b|solve\b)|how\s+(?:it|we)\s+works?\b|key\s+(?:feature|capability|function)\b)\b/i,
		score: 5,
		label: "product:use_case_language",
	},
	{
		re: /\b(?:end[-\s]?to[-\s]?end\b|full[-\s]?stack\b|no[-\s]?code\b|low[-\s]?code\b|self[-\s]?serve\b|embedded\b|white[-\s]?label\b)\b/i,
		score: 5,
		label: "product:architecture_signal",
	},
	{
		re: /\b(?:real[-\s]?time\b|instant\b|in\s+seconds\b|automated\b)\s+\w+/i,
		score: 4,
		label: "product:speed_automation_claim",
	},
];

// ── Go-To-Market Strategy ─────────────────────────────────────────────────────
// Prefer: ICP descriptions, pricing specifics, channel/partner signals,
//         land-and-expand or sales motion language.
// Avoid: generic market-opportunity language.
const GTM_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		re: /\b(?:target(?:ed)?\s+(?:customer[s]?\b|buyer[s]?\b|segment\b|market\b|audience\b)|ideal\s+customer(?:\s+profile)?\b|ICP\b|our\s+(?:customer[s]?\b|client[s]?\b)\s+(?:is\b|are\b|include\b))\b/i,
		score: 12,
		label: "gtm:icp_segment",
	},
	{
		re: /(?:(?:\$|£|€)\d[\d,.]*\s*(?:per\s+(?:seat\b|user\b|month\b|year\b)|\/(?:mo|yr|month|year|seat|user)\b|\/\s*(?:seat|user|month|year)\b)|per[-\s]seat\s+pricing\b|per[-\s]user\b)/i,
		score: 12,
		label: "gtm:per_unit_pricing",
	},
	{
		re: /\b(?:pricing\s+(?:model\b|tier[s]?\b|plan[s]?\b|structure\b)|starter\s+plan\b|enterprise\s+plan\b|freemium\b|free\s+trial\b|annual\s+contract\b|monthly\s+subscription\b)\b/i,
		score: 8,
		label: "gtm:pricing_model",
	},
	{
		re: /\b(?:channel[s]?\b|partner(?:ship)?[s]?\b|resell(?:er|ing)?\b|distribution\s+(?:channel|network|partner)\b|alliance[s]?\b|referral\s+partner[s]?\b)\b/i,
		score: 8,
		label: "gtm:channel_partner",
	},
	{
		re: /\b(?:land[-\s]?and[-\s]?expand\b|net\s+(?:revenue\s+)?retention\b|NRR\b|expansion\s+revenue\b|upsell[s]?\b|cross[-\s]?sell\b)\b/i,
		score: 8,
		label: "gtm:land_expand",
	},
	{
		re: /\b(?:direct\s+sale[s]?\b|inside\s+sale[s]?\b|outbound\b|inbound\b|demand\s+gen(?:eration)?\b|sales\s+(?:motion\b|strategy\b|hire[s]?\b|team\b))\b/i,
		score: 6,
		label: "gtm:sales_motion",
	},
	{
		re: /\b(?:SMB\b|mid[-\s]?market\b|enterprise\s+(?:customer[s]?\b|client[s]?\b|account[s]?\b)|small\s+business(?:es)?\b|Fortune\s+\d+\b)\b/i,
		score: 5,
		label: "gtm:segment_clarity",
	},
];

// ── Market Position ───────────────────────────────────────────────────────────
// Prefer: TAM/SAM/SOM with context, competitor contrasts, sized market numbers,
//         category positioning with growth rationale.
// Avoid: isolated market numbers without category framing.
const MARKET_POSITION_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		re: /\b(?:TAM\b|SAM\b|SOM\b|total\s+addressable\s+market\b|serviceable\s+addressable\s+market\b|serviceable\s+obtainable\s+market\b)\b/i,
		score: 12,
		label: "market:tam_sam_som",
	},
	{
		re: /(?:(?:\$|£|€)[\d,.]+\s*(?:B\b|M\b|K\b|billion\b|million\b|trillion\b)?)\s*(?:market\b|opportunity\b|TAM\b|SAM\b|addressable\b)/i,
		score: 10,
		label: "market:sized_market_number",
	},
	{
		re: /\b(?:competi(?:tor[s]?\b|tive\b|ition\b)|vs\.\s*[A-Z]|against\s+[A-Z]|incumbent[s]?\b|alternative[s]?\b)\b/i,
		score: 10,
		label: "market:competitor_mention",
	},
	{
		re: /\b(?:category\s+(?:leader\b|leadership\b|creation\b|definition\b)|market\s+(?:leader\b|leadership\b|position\b|share\b)|vertical\s+(?:SaaS\b|focus\b|leader\b))\b/i,
		score: 8,
		label: "market:category_position",
	},
	{
		re: /\b(?:growing\s+at\b|CAGR\b|year[-\s]?over[-\s]?year\b|YoY\b|market\s+(?:growth\b|growing\b|expanding\b))\b/i,
		score: 8,
		label: "market:growth_context",
	},
	{
		re: /\b(?:with\s+(?:\d+%|context\b)|in\s+the\s+context\s+of\b|relative\s+to\s+(?:market\b|peers\b|competitors\b))\b/i,
		score: 5,
		label: "market:contextual_framing",
	},
];

// ── Financial Outlook ─────────────────────────────────────────────────────────
// Prefer: ARR/MRR, margins, burn/runway with actual numbers, growth rate claims.
// Avoid: placeholder revenue projections, vague financial commentary.
const FINANCIAL_OUTLOOK_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		re: /\b(?:ARR\b|MRR\b|annual\s+recurring\s+revenue\b|monthly\s+recurring\s+revenue\b)\b/i,
		score: 15,
		label: "financial:arr_mrr",
	},
	{
		re: /\b(?:gross\s+margin[s]?\b|net\s+margin[s]?\b|EBITDA\b|contribution\s+margin\b|operating\s+margin\b)\b/i,
		score: 10,
		label: "financial:margin",
	},
	{
		re: /\b(?:burn\s+rate\b|monthly\s+burn\b|cash\s+burn\b|runway\b|\d+[-\s]months?\s+(?:of\s+)?runway\b)\b/i,
		score: 10,
		label: "financial:burn_runway",
	},
	{
		re: /\b(?:total\s+revenue\b|revenue\s+(?:of\b|at\b|grew\b|growth\b|trajectory\b)|recognized\s+revenue\b|top[-\s]?line\b)\b/i,
		score: 8,
		label: "financial:revenue_signal",
	},
	{
		re: /\b\d+(?:\.\d+)?%\s*(?:YoY\b|year[-\s]?over[-\s]?year\b|annual\s+growth\b|growth\b|increase\b|CAGR\b)|growing\s+(?:at|by)\s+\d+(?:\.\d+)?%\b/i,
		score: 12,
		label: "financial:growth_rate",
	},
	{
		re: /\b(?:CAC\b|LTV\b|LTV\s*\/\s*CAC\b|payback\s+period\b|customer\s+acquisition\s+cost\b)\b/i,
		score: 8,
		label: "financial:unit_economics",
	},
	{
		re: /\b(?:cash\s+(?:position\b|on\s+hand\b|positive\b|flow\b|generating\b)|free\s+cash\s+flow\b)\b/i,
		score: 6,
		label: "financial:cash_position",
	},
];

// ── Capital & Raise ───────────────────────────────────────────────────────────
// Prefer: explicit raise amount, instrument type, valuation terms, use of funds.
// Avoid: financing-adjacent text that is not the actual raise.
const CAPITAL_RAISE_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		re: /\b(?:rais(?:ing\b|es?\b)|fundrais(?:ing\b|e\b)|seeking\b)\b.{0,60}(?:\$|£|€)[\d,.]+/i,
		score: 15,
		label: "capital:raise_with_amount",
	},
	{
		re: /(?:\$|£|€)[\d,.]+\s*(?:round\b|raise\b|investment\b|funding\b|tranche\b)/i,
		score: 12,
		label: "capital:amount_round_label",
	},
	{
		re: /\b(?:SAFE\b|convertible\s+note[s]?\b|priced\s+round\b|Series\s+[A-F]\b|Seed\s+round\b|Pre[-\s]?[Ss]eed\b|Bridge\s+(?:round\b|note\b))\b/i,
		score: 8,
		label: "capital:instrument",
	},
	{
		re: /\b(?:pre[-\s]?money\s+valuation\b|post[-\s]?money\s+valuation\b|valuation\s+cap\b|discount\s+rate\b|MFN\s+clause\b|pro[-\s]?rata\s+rights?\b)\b/i,
		score: 8,
		label: "capital:valuation_terms",
	},
	{
		re: /\b(?:use\s+of\s+(?:funds?\b|proceeds?\b)|deployment\s+of\s+capital\b|capital\s+allocation\b|allocating\b)\b/i,
		score: 10,
		label: "capital:use_of_funds",
	},
	{
		re: /\b(?:product\s+development\b|sales?\s+(?:hire[s]?\b|team\b)|marketing\s+(?:spend\b|budget\b|hire\b)|hiring\b|headcount\s+expansion\b|infrastructure\b)\b/i,
		score: 5,
		label: "capital:deployment_area",
	},
];

// ── Traction ──────────────────────────────────────────────────────────────────
// Prefer: customer counts, retention/NRR, named customers, pipeline commitments.
const TRACTION_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		// Matches: "50 customers", "50+ users", "50 paying customers", "50 enterprise clients",
		// "customers signed", "paying customers" etc.
		re: /\b(?:\d+\s*(?:\+\s*)?(?:paying\s+|active\s+|enterprise\s+|new\s+)?(?:customer[s]?\b|client[s]?\b|user[s]?\b|account[s]?\b|subscriber[s]?\b)|(?:paying|active|enterprise|new)\s+customer[s]?\b|customer[s]?\s+(?:signed\b|onboarded\b|paying\b|include\b|to\s+date\b))/i,
		score: 12,
		label: "traction:customer_count",
	},
	{
		re: /\b(?:retention\b|churn\b|NRR\b|net\s+(?:revenue\s+)?retention\b|renewal\s+rate\b|logo\s+churn\b)\b/i,
		score: 10,
		label: "traction:retention",
	},
	{
		re: /\b(?:MoM\b|month[-\s]?over[-\s]?month\b|QoQ\b|quarter[-\s]?over[-\s]?quarter\b|YoY\b)\b/i,
		score: 8,
		label: "traction:period_growth",
	},
	{
		re: /\b(?:named\s+customer[s]?\b|enterprise\s+(?:client\b|account\b)|Fortune\s+\d+\b|F\d{2,3}\b|logo[s]?\b)\b/i,
		score: 12,
		label: "traction:named_customer",
	},
	{
		re: /\b(?:pipeline\b|LOI\b|letter\s+of\s+intent\b|signed\s+contract[s]?\b|committed\s+ARR\b|contracted\s+ARR\b)\b/i,
		score: 6,
		label: "traction:pipeline",
	},
	{
		re: /\b(?:grew\b|growing\b|growth\s+of\b)\s*\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?[xX]\s*(?:growth\b|increase\b|YoY\b)/i,
		score: 8,
		label: "traction:numeric_growth",
	},
];

// ── Business Quality ──────────────────────────────────────────────────────────
// Prefer: unit economics, recurring model, defensibility / network effects,
//         retention signals, team credibility.
const BUSINESS_QUALITY_SIGNALS: ReadonlyArray<TopicSignal> = [
	{
		re: /\b(?:LTV\b|CAC\b|LTV\s*\/\s*CAC\b|payback\s+period\b|unit\s+economics\b|ARPU\b|ACV\b)\b/i,
		score: 12,
		label: "biz:unit_economics",
	},
	{
		re: /\b(?:recurring\s+revenue\b|subscription\s+(?:model\b|revenue\b|business\b)|SaaS\s+model\b|software\s+subscription\b|ARR[-\s]based\b)\b/i,
		score: 8,
		label: "biz:recurring_model",
	},
	{
		re: /\b(?:retention\b|sticky\b|switching\s+cost[s]?\b|net\s+(?:revenue\s+)?retention\b|NRR\b|low\s+churn\b)\b/i,
		score: 8,
		label: "biz:retention_stickiness",
	},
	{
		re: /\b(?:network\s+effect[s]?\b|data\s+(?:advantage\b|moat\b|flywheel\b)|platform\s+(?:effect[s]?\b|moat\b)|viral(?:ity\b|ly\b)?|flywheel\b)\b/i,
		score: 10,
		label: "biz:defensibility",
	},
	{
		re: /\b(?:previously\s+(?:at\b|founded\b|built\b|sold\b)|founder\s+(?:has\b|is\b|was\b|previously\b)|serial\s+(?:entrepreneur\b|founder\b))\b/i,
		score: 8,
		label: "biz:team_signal",
	},
	{
		re: /\b(?:gross\s+margin\b|contribution\s+margin\b|operating\s+leverage\b|scalable\s+(?:model\b|margin[s]?\b))\b/i,
		score: 8,
		label: "biz:margin_model",
	},
];

/** All topic signal tables keyed by NarrativeTopic. */
const TOPIC_SIGNALS: Readonly<Record<NarrativeTopic, ReadonlyArray<TopicSignal>>> = {
	product_differentiation: PRODUCT_DIFF_SIGNALS,
	go_to_market_strategy: GTM_SIGNALS,
	market_position: MARKET_POSITION_SIGNALS,
	financial_outlook: FINANCIAL_OUTLOOK_SIGNALS,
	capital_and_raise: CAPITAL_RAISE_SIGNALS,
	traction: TRACTION_SIGNALS,
	business_quality: BUSINESS_QUALITY_SIGNALS,
};

// ─── Core scoring function (Phase 1) ─────────────────────────────────────────

/**
 * Score a single narrative candidate string for a given topic.
 *
 * The score is the arithmetic sum of all positive and negative signal weights.
 * Scores can be negative (strongly bad candidate) or well positive (good candidate).
 *
 * Signal categories applied in order:
 *  1. Length checks (early-exit for very short text)
 *  2. Generic suppression phrases (Phase 5)
 *  3. Placeholder / missing-data markers
 *  4. Universal positive signals (quantitative, sentence completeness, comparative)
 *  5. Topic-specific positive signals (Phase 2)
 *  6. Source type bonus (metadata, optional)
 *  7. Confidence level bonus from PR36.6 (metadata, optional)
 *
 * @param text    The candidate text excerpt to score.
 * @param topic   Which narrative topic to score against.
 * @param meta    Optional metadata for source type and confidence level.
 * @returns       NarrativeCandidateScore with net score and signal breakdown.
 *
 * @example
 *   scoreNarrativeCandidate(
 *     'Our workflow automation integrates with CRM, reducing analyst time by 60%.',
 *     'product_differentiation',
 *   );
 *   // { score: ~50, signals: ['quality:quantitative_detail', 'product:workflow_automation', ...] }
 */
export function scoreNarrativeCandidate(
	text: string,
	topic: NarrativeTopic,
	meta?: CandidateMeta,
): NarrativeCandidateScore {
	const signals: string[] = [];
	let score = 0;

	if (!text || typeof text !== "string") {
		return { score: -100, signals: ["base:empty_or_invalid"] };
	}

	const trimmed = text.trim();
	const len = trimmed.length;

	// ── 1. Length signals ──────────────────────────────────────────────────────
	if (len < 20) {
		// Too short to carry any narrative value — hard early exit
		score -= 20;
		signals.push("quality:too_short(<20chars)");
		return { score, signals };
	}
	if (len < 50) {
		score -= 8;
		signals.push("quality:short(<50chars)");
	} else if (len >= 100) {
		score += 3;
		signals.push("quality:adequate_length(>=100chars)");
	}

	// ── 2. Generic suppression (Phase 5) ──────────────────────────────────────
	let genericPenaltyTotal = 0;
	for (const { re, label } of GENERIC_SUPPRESSION_SIGNALS) {
		if (genericPenaltyTotal >= 30) break; // cap reached
		if (re.test(trimmed)) {
			const penalty = Math.min(15, 30 - genericPenaltyTotal);
			genericPenaltyTotal += penalty;
			score -= penalty;
			signals.push(`suppress:${label}(-${penalty})`);
		}
	}

	// ── 3. Placeholder penalty ────────────────────────────────────────────────
	if (PLACEHOLDER_RE.test(trimmed)) {
		score -= 30;
		signals.push("quality:placeholder_text(-30)");
	}

	// ── 4. Universal positive signals ─────────────────────────────────────────
	if (QUANTITATIVE_RE.test(trimmed)) {
		score += 15;
		signals.push("quality:quantitative_detail(+15)");
	}
	if (SENTENCE_START_RE.test(trimmed) && TERMINAL_PUNCT_RE.test(trimmed)) {
		score += 5;
		signals.push("quality:complete_sentence(+5)");
	}
	if (MULTI_SENTENCE_RE.test(trimmed)) {
		score += 5;
		signals.push("quality:multi_sentence(+5)");
	}
	if (WHY_BETTER_RE.test(trimmed)) {
		score += 8;
		signals.push("quality:comparative_language(+8)");
	}
	if (EVIDENCE_BACKED_RE.test(trimmed)) {
		score += 5;
		signals.push("quality:evidence_backed(+5)");
	}

	// ── 5. Topic-specific signals ─────────────────────────────────────────────
	for (const sig of TOPIC_SIGNALS[topic]) {
		if (sig.re.test(trimmed)) {
			score += sig.score;
			signals.push(`topic:${sig.label}(+${sig.score})`);
		}
	}

	// ── 6. Source type bonus ──────────────────────────────────────────────────
	if (meta?.sourceType != null) {
		const bonus = SOURCE_TYPE_BONUS[meta.sourceType];
		if (bonus > 0) {
			score += bonus;
			signals.push(`source:${meta.sourceType}(+${bonus})`);
		}
	}

	// ── 7. Confidence level bonus (PR36.6) ────────────────────────────────────
	if (meta?.confidenceLevel != null) {
		const bonus = CONFIDENCE_LEVEL_BONUS[meta.confidenceLevel] ?? 0;
		if (bonus !== 0) {
			score += bonus;
			const sign = bonus >= 0 ? "+" : "";
			signals.push(`confidence:${meta.confidenceLevel}(${sign}${bonus})`);
		}
	}

	return { score, signals };
}

// ─── Deduplication helper ─────────────────────────────────────────────────────

/**
 * Remove near-duplicate candidates by comparing normalised first 100 characters.
 * Keeps the first occurrence; subsequent duplicates are dropped.
 */
function deduplicateCandidates(candidates: NarrativeCandidate[]): NarrativeCandidate[] {
	const seen = new Set<string>();
	return candidates.filter((c) => {
		const key = c.text
			.trim()
			.slice(0, 100)
			.toLowerCase()
			.replace(/\s+/g, " ");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// ─── Public ranking API ───────────────────────────────────────────────────────

/**
 * Score and rank all candidates for a given topic.
 *
 * Deduplicates near-copies before scoring. Returns candidates sorted descending
 * by score (best candidate first).
 *
 * @example
 *   const ranked = rankNarrativeCandidates(
 *     [
 *       { text: 'We are an innovative platform.' },
 *       { text: 'We automate due diligence workflows, saving analysts 60% of their time.' },
 *     ],
 *     'product_differentiation',
 *   );
 *   // ranked[0].text is the workflow automation candidate
 */
export function rankNarrativeCandidates(
	candidates: NarrativeCandidate[],
	topic: NarrativeTopic,
): ScoredNarrativeCandidate[] {
	const deduped = deduplicateCandidates(candidates);
	return deduped
		.map((c) => {
			const { score, signals } = scoreNarrativeCandidate(c.text, topic, c.meta);
			return { text: c.text, meta: c.meta ?? {}, score, signals };
		})
		.sort((a, b) => b.score - a.score);
}

/**
 * Select the best narrative evidence bundle for a topic, respecting the minimum
 * quality threshold defined in TOPIC_MIN_THRESHOLD.
 *
 * Returns null when no candidate meets the threshold — signalling that the topic
 * should be omitted rather than filled with low-quality filler.
 *
 * Options:
 *  - topN:     max number of top-ranked candidates to include (default: 3).
 *              Using >1 is useful when multi-source context enriches the narrative.
 *  - maxChars: maximum total output characters (default: 1000).
 *
 * @example
 *   const body = selectBestNarrativeCandidate(candidates, 'financial_outlook');
 *   if (!body) {
 *     // No credible financial evidence — omit the section
 *   }
 */
export function selectBestNarrativeCandidate(
	candidates: NarrativeCandidate[],
	topic: NarrativeTopic,
	opts?: { topN?: number; maxChars?: number },
): string | null {
	if (!candidates.length) return null;

	const topN = opts?.topN ?? 3;
	const maxChars = opts?.maxChars ?? 1000;
	const threshold = TOPIC_MIN_THRESHOLD[topic];

	const ranked = rankNarrativeCandidates(candidates, topic);
	const qualified = ranked.filter((c) => c.score >= threshold);

	if (qualified.length === 0) return null;

	const selected = qualified.slice(0, topN);
	const joined = selected.map((c) => c.text.trim()).join("\n\n");
	return joined.slice(0, maxChars);
}
