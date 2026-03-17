/**
 * Numeric Context Taxonomy — Phase 1 of Numeric Context + Contradiction Gates.
 *
 * Defines the canonical categories for numeric values extracted from deal materials.
 * A category determines whether a value is company-owned, market/external, or
 * ambiguous, and is used by context guard functions to suppress misattributed values
 * before they reach the governed narrative.
 *
 * Architecture:
 *   - numeric-context-taxonomy.ts   ← this file: types + constants
 *   - stage-2-deterministic.ts      ← uses context guards (isArrMatchTainted,
 *                                      isValuationMatchTainted) per field extractor
 *   - stage-3-llm.ts                ← filters isSuspect=true fields from canonicalFieldsBody
 */

// ── Category taxonomy ─────────────────────────────────────────────────────────

/**
 * Describes what a numeric value represents in deal materials.
 * Used to gate which values are safe to surface in canonical field extraction.
 */
export const NumericContextCategory = {
	// ── Company-owned financing values ───────────────────────────────────────
	/** The company's own fundraise amount (current round). */
	COMPANY_RAISE: "company_raise",
	/** The company's own post-money or pre-money valuation. */
	COMPANY_VALUATION: "company_valuation",

	// ── Company operating metrics (present/historical) ───────────────────────
	/** Annual Recurring Revenue reported by the company. */
	COMPANY_ARR: "company_arr",
	/** Monthly Recurring Revenue reported by the company. */
	COMPANY_MRR: "company_mrr",
	/** Revenue reported by the company (annual/quarterly/total). */
	COMPANY_REVENUE: "company_revenue",
	/** Gross Merchandise Value reported by the company. */
	COMPANY_GMV: "company_gmv",
	/** User/customer count reported by the company. */
	COMPANY_USERS: "company_users",
	/** Growth rate reported by the company. */
	COMPANY_GROWTH: "company_growth",

	// ── Market / external values — NOT company-owned ─────────────────────────
	/** Total Addressable Market size. */
	MARKET_TAM: "market_tam",
	/** Serviceable Addressable Market size. */
	MARKET_SAM: "market_sam",
	/** Serviceable Obtainable Market size. */
	MARKET_SOM: "market_som",
	/** Generic market size figure (no explicit TAM/SAM/SOM label). */
	MARKET_SIZE: "market_size",
	/** A competitor's metric (valuation, revenue, etc.) — NOT the company's. */
	COMPETITOR_METRIC: "competitor_metric",
	/** An industry benchmark or average not tied to the company. */
	INDUSTRY_BENCHMARK: "industry_benchmark",

	// ── Forward-looking / hypothetical ───────────────────────────────────────
	/** A projected or target metric (future, not current/historical). */
	FORWARD_PROJECTION: "forward_projection",
	/** A formal financial model target or scenario. */
	FORWARD_TARGET: "forward_target",

	// ── Ambiguous / unresolvable ─────────────────────────────────────────────
	/** Context insufficient to determine ownership or scope. */
	AMBIGUOUS: "ambiguous",
	/**
	 * Context signals strongly suggest wrong category assignment.
	 * Values classified as SUSPECT are suppressed from governed narrative.
	 */
	SUSPECT: "suspect",
} as const;

export type NumericContextCategory =
	(typeof NumericContextCategory)[keyof typeof NumericContextCategory];

// ── Reason codes for suspect/suppressed canonical fields ─────────────────────

/**
 * Reason codes emitted when a canonical field extraction is suppressed due to
 * context guard detection. These extend the existing P2_REASON system and are
 * surfaced in the conflicts/withheld section of the governed summary.
 */
export const NumericContextSuppressReason = {
	/** ARR match appeared in a market/industry ARR context, not company ARR. */
	ARR_MARKET_CONTEXT_TAINT: "ARR_MARKET_CONTEXT_TAINT",
	/** Valuation match appeared in a competitor or external entity context. */
	VALUATION_COMPETITOR_CONTEXT_TAINT: "VALUATION_COMPETITOR_CONTEXT_TAINT",
	/** Revenue match appeared in a market-size revenue context, not company revenue. */
	REVENUE_MARKET_CONTEXT_TAINT: "REVENUE_MARKET_CONTEXT_TAINT",
	/** MRR match appeared in a market/industry context, not company MRR. */
	MRR_MARKET_CONTEXT_TAINT: "MRR_MARKET_CONTEXT_TAINT",
} as const;

export type NumericContextSuppressReason =
	(typeof NumericContextSuppressReason)[keyof typeof NumericContextSuppressReason];

// ── Context guard helpers (character-window taint checks) ─────────────────────

/** Window size (chars on each side of match) used for ARR context checks. */
export const ARR_TAINT_WINDOW = 120;

/** Window size for valuation competitor checks. */
export const VALUATION_TAINT_WINDOW = 150;

/**
 * ARR market-size taint regex.
 *
 * Fires when the context window around an ARR match contains market/segment
 * language indicating the ARR figure describes an external market rather than
 * the company's own metric.
 *
 * Examples that SHOULD taint:
 *   - "The $200M ARR market segment"          → "market segment" near ARR
 *   - "TAM: $200M ARR businesses"             → TAM near ARR
 *   - "ARR market size: $1.5B"                → "market size" near ARR
 *   - "industry ARR pool of $300M"            → "industry" near ARR
 *
 * Examples that should NOT taint:
 *   - "Our ARR is $200M"                      → "our" implies company ownership
 *   - "ARR reached $10M in Q3"                → growth narrative
 *   - "current ARR: $500K"                    → "current" is company-scoped
 *   - "$3M ARR growing 200% YoY"              → traction slide
 */
export const ARR_MARKET_TAINT_RE =
	/\b(?:TAM|SAM|SOM|total\s+addressable|serviceable\s+addressable|serviceable\s+obtainable|addressable\s+market|market\s+size|market\s+segment|market\s+opportunity|industry\s+ARR|ARR\s+market|ARR\s+segment|ARR\s+pool|ARR\s+businesses?|segment|sector|industry)\b|(?<!-)market(?!\w)/i;

/**
 * Safe ARR company-ownership signals.
 * When any of these appear within window, the match is treated as company ARR
 * and the taint check is skipped (overrides ARR_MARKET_TAINT_RE).
 *
 * These are strong, unambiguous ownership assertions:
 *   - "our ARR", "we have ARR", "company ARR", "current ARR"
 *   - "ARR is", "ARR was", "ARR of $X", "ARR reached", "ARR grew", "ARR hit"
 *   - "ARR: $X" (colon form, common in slide layouts)
 *   - "We reached $XM ARR", "achieving $XM ARR"
 */
export const ARR_COMPANY_OWNERSHIP_RE =
	/\b(?:our\s+ARR|my\s+ARR|we\s+(?:have|reached?|hit|grew|achieved?)\s+(?:\$[\d,.]+\s*[BMKbmk]?\s+)?ARR|ARR\s+(?:is|was|of|reached?|grew|hit|:)|current\s+ARR|company(?:'?s?)?\s+ARR|achieving\s+(?:\$[\d,.]+\s*[BMKbmk]?\s+)?ARR)\b/i;

/**
 * Valuation competitor/external entity taint regex.
 *
 * Fires when the context window around a valuation match contains signals
 * that the valuation belongs to a competitor, peer, or external entity rather
 * than the company presenting the deck.
 *
 * Examples that SHOULD taint:
 *   - "Our competitor has a $8B valuation"     → "competitor" near valuation
 *   - "industry leader valued at $8B"          → "industry leader" + valuation
 *   - "market leader at $8B valuation"         → "market leader"
 *   - "publicly traded comps at $8B"           → "publicly traded"
 *   - "comparable companies at $8B valuation"  → "comparable"
 *   - "peers are valued at $5B"                → "peers"
 *   - "sector benchmark valuation $4B"         → "benchmark"
 *   - "Competitive Landscape ... $8B valuation" → "competitive landscape" slide heading
 *   - "Competitive Analysis ... $5B valuation"  → competitor analysis slide
 *
 * Examples that should NOT taint:
 *   - "post-money valuation $10M"              → explicit post-money (form A)
 *   - "we are valued at $10M"                  → "we" ownership
 *   - "our company valuation is $10M"          → "our" ownership
 *   - "SAFE cap $10M"                          → SAFE context
 */
export const VALUATION_COMPETITOR_TAINT_RE =
	/\b(?:competitor|rivals?|industry\s+leader|market\s+leader|publicly\s+traded|comparable?\s+compan|comparabl[ey]|peer(?:s|\s+group)?|benchmark|sector\s+average|comps?(?:\s+at)?|third.party|third\s+part|their\s+valuation|them(?:\s+at)?|existing\s+(?:players?|companies)|incumbent|established\s+player|unicorn\s+peers?|late.stage\s+peers?|competitive\s+(?:landscape|analysis|overview|map)|competing\s+(?:compan|product|solution|platform))\b/i;

/**
 * Safe valuation company-ownership signals.
 * When any of these appear within the window, competitor taint is overridden.
 */
export const VALUATION_COMPANY_OWNERSHIP_RE =
	/\b(?:our\s+(?:company\s+)?valuation|we\s+are\s+valued\s+at|we(?:'re|\s+are)\s+(?:currently\s+)?valued|company\s+(?:is\s+)?valued\s+at|post[-\s]money\s+valuation|pre[-\s]money\s+valuation|our\s+SAFE|our\s+cap)\b/i;

// ── MRR context guard constants ───────────────────────────────────────────────

/** Window size (chars on each side of match) used for MRR context checks. */
export const MRR_TAINT_WINDOW = 120;

/**
 * MRR market-size taint regex.
 *
 * Fires when the context window around an MRR match contains market/segment
 * language indicating the MRR figure describes an external market rather than
 * the company's own metric.
 *
 * Examples that SHOULD taint:
 *   - "total MRR market of $500M"             → "market" near MRR
 *   - "industry MRR pool: $2B"                → "industry" near MRR
 *   - "MRR market opportunity: $300M"          → "market opportunity"
 *   - "TAM expressed as MRR: $50M"            → TAM near MRR
 *
 * Examples that should NOT taint:
 *   - "our MRR is $200K"                      → company ownership
 *   - "MRR reached $50K in Q3"                → growth narrative
 *   - "current MRR: $120K"                    → traction slide
 */
export const MRR_MARKET_TAINT_RE =
	/\b(?:TAM|SAM|SOM|total\s+addressable|serviceable\s+addressable|serviceable\s+obtainable|addressable\s+market|market\s+size|market\s+segment|market\s+opportunity|industry\s+MRR|MRR\s+market|MRR\s+segment|MRR\s+pool|segment|sector|industry)\b|(?<!-)market(?!\w)/i;

/**
 * Safe MRR company-ownership signals.
 * When any of these appear within window, the taint check is skipped.
 *
 * Includes:
 *   - Possessive forms: "our MRR", "my MRR", "company MRR", "current MRR"
 *   - Verb forms: "MRR is/was/of/reached/grew/hit/:"
 *   - Growth narrative: "we reached $X MRR", "achieving $X MRR"
 *   - Bare label: "MRR $X" — when MRR immediately precedes a dollar amount,
 *     it is acting as a traction-slide metric label (always company-owned).
 *     (Separate alternation — no trailing word boundary required.)
 */
export const MRR_COMPANY_OWNERSHIP_RE =
	/\b(?:our\s+MRR|my\s+MRR|we\s+(?:have|reached?|hit|grew|achieved?)\s+(?:\$[\d,.]+\s*[BMKbmk]?\s+)?MRR|MRR\s+(?:is|was|of|reached?|grows?|grew|hit|:)|current\s+MRR|company(?:'?s?)?\s+MRR|achieving\s+(?:\$[\d,.]+\s*[BMKbmk]?\s+)?MRR)\b|\bMRR\s+\$/i;

// ── Revenue context guard constants ──────────────────────────────────────────

/** Window size (chars on each side of match) used for revenue context checks. */
export const REVENUE_TAINT_WINDOW = 150;

/**
 * Revenue market-size taint regex.
 *
 * Fires when the context window around a revenue match contains market/sector
 * language indicating the revenue figure describes an external market or a
 * competitor rather than the company's own revenue.
 *
 * Examples that SHOULD taint:
 *   - "market revenue opportunity: $5B"       → "market revenue"
 *   - "industry revenue pool of $2B"          → "industry revenue"
 *   - "total addressable revenue: $10B"       → "total addressable"
 *   - "competitor revenue: $8B"               → "competitor" near revenue
 *   - "sector revenue: $3B"                   → sector context
 *
 * Examples that should NOT taint:
 *   - "our revenue is $500K"                  → company ownership
 *   - "revenue reached $1M in 2024"           → growth narrative
 *   - "annual revenue: $800K"                 → company metric
 */
export const REVENUE_MARKET_TAINT_RE =
	/\b(?:TAM|SAM|SOM|total\s+addressable|serviceable\s+addressable|serviceable\s+obtainable|addressable\s+market|market\s+(?:size|revenue|revenues?)|market\s+opportunity|industry\s+revenue|sector\s+revenue|competitor(?:'?s?)?\s+revenue|peer\s+revenue|benchmark\s+revenue|revenue\s+(?:market|pool|opportunity|potential))\b|(?<!-)market(?!\w)/i;

/**
 * Safe revenue company-ownership signals.
 * When any of these appear within window, revenue market taint is overridden.
 */
export const REVENUE_COMPANY_OWNERSHIP_RE =
	/\b(?:our\s+revenues?|my\s+revenues?|we\s+(?:generated?|earned?|achieved?|recorded?|reported?)\s+(?:\$[\d,.]+\s*[BMKbmk]?\s+)?revenues?|revenues?\s+(?:is|was|of|reached?|grew|hit|:)|current\s+revenues?|company(?:'?s?)?\s+revenues?|annual\s+revenues?\s*(?:is|was|of|:)|achieving\s+(?:\$[\d,.]+\s*[BMKbmk]?\s+)?revenues?)\b/i;

// ── Customer count context guard constants ────────────────────────────────────

/** Window size (chars on each side of match) used for customer count checks. */
export const CUSTOMER_TAINT_WINDOW = 150;

/**
 * Customer count competitor/external taint regex.
 *
 * Fires when the context window around a customer count match contains signals
 * that the count belongs to a competitor or is an industry benchmark rather
 * than the company's own customer base.
 *
 * Examples that SHOULD taint:
 *   - "competitors serve 10,000 customers"    → "competitor" near count
 *   - "industry average of 500 customers"     → "industry average"
 *   - "publicly traded peers have 50K users"  → "publicly traded peers"
 *   - "market leader with 1M customers"       → "market leader"
 *
 * Examples that should NOT taint:
 *   - "we have 120 customers"                 → company ownership
 *   - "our customer base: 450"                → company metric
 *   - "currently serving 200 clients"         → active company context
 */
export const CUSTOMER_COMPETITOR_TAINT_RE =
	/\b(?:competitor(?:s)?|rival(?:s)?|industry\s+(?:leader|average|benchmark)|market\s+leader|publicly\s+traded|comparable\s+compan|peer(?:s|\s+group)?|benchmark|sector\s+average|comps?|third.party|existing\s+(?:players?|companies)|incumbent|established\s+player|competitive\s+(?:landscape|analysis|overview))\b/i;

/**
 * Safe customer count company-ownership signals.
 * When any of these appear within window, competitor taint is overridden.
 */
export const CUSTOMER_COMPANY_OWNERSHIP_RE =
	/\b(?:our\s+customers?|we\s+(?:have|serve|work\s+with|signed?|onboarded?)\s+\d|we\s+(?:currently\s+)?(?:have|serve)\s+(?:over\s+)?\d|customer\s+(?:count|base|list|number)|current\s+customers?|company(?:'?s?)?\s+customers?|active\s+customers?|paying\s+customers?|signed\s+customers?)\b/i;
