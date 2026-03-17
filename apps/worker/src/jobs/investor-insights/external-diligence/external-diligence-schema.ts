/**
 * PR35 / PR36.2 — External Due Diligence Layer v1
 * Schema definitions: ExternalDiligenceV1 and related types.
 *
 * PR36.2 changes:
 *   - Renamed bucket keys to investor-grade purposes
 *   - Added BucketQuerySpec for per-bucket Tavily parameters
 *   - Added per-bucket BucketSignal types (deterministic signal extraction)
 *   - ExternalDiligenceBucket gains optional `signal` field
 *
 * ⚠️ IMPORTANT: The raw Tavily response is NEVER passed to the LLM.
 *    All Tavily output passes through normalize-external-results.ts first,
 *    which maps it to ExternalDiligenceV1 before any LLM consumption.
 */

// ─── Bucket keys ──────────────────────────────────────────────────────────────

/**
 * PR36.2 investor-grade bucket mapping:
 *   company_footprint    — Does the company have a real, verifiable public presence?
 *   competitive_landscape — Who are the actual direct and adjacent competitors?
 *   market_outlook       — Is the category growing, flat, or declining?
 *   founder_team_signals — What public evidence exists about the founder/team?
 *   financial_context    — Does the raise/stage look typical vs. market benchmarks?
 *   external_risks       — What public risks, news, or concerns should investors know?
 */
export type ExternalDiligenceBucketKey =
	| "company_footprint"
	| "competitive_landscape"
	| "market_outlook"
	| "founder_team_signals"
	| "financial_context"
	| "external_risks";

// ─── Per-result ───────────────────────────────────────────────────────────────

/**
 * A single normalised search result (safe for LLM consumption).
 * Derived from TavilySearchResult — never carries raw Tavily response shape.
 */
export interface ExternalSearchResult {
	/** Source URL */
	url: string;
	/** Article / page title */
	title: string;
	/** Truncated content snippet (max 500 chars) — LLM-safe */
	snippet: string;
	/** Tavily relevance score 0–1 */
	score: number;
	/** ISO date or null if not available */
	published_date: string | null;
	/** Which query bucket this result belongs to */
	bucket: ExternalDiligenceBucketKey;
}

// ─── Per-bucket query spec ────────────────────────────────────────────────────

/**
 * PR36.2: Richer per-bucket query configuration passed to runTavilySearches.
 * Allows per-bucket topic, domain exclusions, and recency controls.
 */
export interface BucketQuerySpec {
	/** The Tavily query string */
	query: string;
	/** Tavily search topic: 'general' | 'news' | 'finance' */
	topic?: "general" | "news" | "finance";
	/** Domains to exclude from results (noise reduction) */
	excludeDomains?: string[];
	/** Days lookback for news/recency (only honoured when topic='news') */
	days?: number;
}

// ─── Per-bucket deterministic signals ────────────────────────────────────────

/** PR36.2: Deterministic signals extracted by signal-extraction.ts per bucket */

export interface CompanyFootprintSignal {
	kind: "company_footprint";
	/** Company appears to have a public website or product page */
	website_found: boolean;
	/** Funding profile found (Crunchbase, TechCrunch, etc.) */
	funding_profile_found: boolean;
	/** Press or media coverage found */
	press_found: boolean;
	/** Overall footprint quality */
	footprint_quality: "strong" | "moderate" | "weak" | "none";
	/** One-sentence investor-readable summary */
	summary: string;
}

export interface CompetitiveLandscapeSignal {
	kind: "competitive_landscape";
	/** Direct competitor names found in results */
	direct_competitor_names: string[];
	/** Adjacent / alternative product names */
	adjacent_names: string[];
	/** Category structure */
	category_fragmentation: "fragmented" | "consolidated" | "emerging" | "unknown";
	/** Competitive intensity signal */
	competitive_intensity: "high" | "medium" | "low" | "unknown";
	/** One-sentence investor-readable summary */
	summary: string;
}

export interface MarketOutlookSignal {
	kind: "market_outlook";
	/** Overall market direction signal */
	direction: "growing" | "flat" | "declining" | "mixed" | "unknown";
	/** Growth tailwinds extracted from results */
	tailwinds: string[];
	/** Headwinds or risks extracted from results */
	headwinds: string[];
	/** One-sentence investor-readable summary */
	summary: string;
}

export interface FounderTeamSignal {
	kind: "founder_team_signals";
	/** Founder public bio, interview, or bio page found */
	profile_found: boolean;
	/** Prior company or role found */
	prior_role_found: boolean;
	/** Notable credibility signals (e.g., prior exit, notable employer) */
	credibility_signals: string[];
	/** No meaningful public footprint for the founder */
	limited_footprint: boolean;
	/** One-sentence investor-readable summary */
	summary: string;
}

export interface FinancialContextSignal {
	kind: "financial_context";
	/** How the raise compares to stage/sector benchmarks */
	raise_level: "typical" | "above_benchmark" | "below_benchmark" | "unknown";
	/** Current funding environment for the sector */
	funding_environment: "supportive" | "selective" | "weak" | "unknown";
	/** One-sentence investor-readable summary */
	summary: string;
}

export interface ExternalRisksSignal {
	kind: "external_risks";
	/** Brief risk signal descriptions */
	risk_signals: string[];
	/** Regulatory, legal, or compliance concerns found */
	has_regulatory_concern: boolean;
	/** Reputation or PR concerns found */
	has_reputation_concern: boolean;
	/** One-sentence investor-readable summary */
	summary: string;
}

export type BucketSignal =
	| CompanyFootprintSignal
	| CompetitiveLandscapeSignal
	| MarketOutlookSignal
	| FounderTeamSignal
	| FinancialContextSignal
	| ExternalRisksSignal;

// ─── Per-bucket ───────────────────────────────────────────────────────────────

export type ExternalBucketStatus = "ok" | "empty" | "skipped" | "failed";

export interface ExternalDiligenceBucket {
	bucket: ExternalDiligenceBucketKey;
	/** The actual Tavily query string used for this bucket */
	query_used: string;
	results: ExternalSearchResult[];
	results_count: number;
	status: ExternalBucketStatus;
	/** Error message when status = "failed" */
	error_message?: string;
	/** PR36.2: Deterministic signal extracted from results — null when no results */
	signal?: BucketSignal | null;
}

// ─── Claim corroboration ──────────────────────────────────────────────────────

export type CorroborationVerdict = "corroborated" | "contradicted" | "not_found";

/**
 * Cross-checks a specific canonical claim against web evidence.
 * Built from canonical Phase-2 fields + matching web search results.
 */
export interface ClaimCorroboration {
	/** Phase-2 canonical field key, e.g. "raise_amount", "sector" */
	claim_field: string;
	/** The deck-stated value, e.g. "$500K" */
	claim_value: string;
	/** The web snippet that corroborates or contradicts */
	web_signal: string;
	/** URL of the web source */
	source_url: string;
	/** Corroboration verdict */
	verdict: CorroborationVerdict;
}

// ─── Run status ───────────────────────────────────────────────────────────────

export type ExternalDiligenceRunStatus =
	/** All queries ran and at least one returned results */
	| "succeeded"
	/** Some queries ran, at least one failed */
	| "partial"
	/** All queries failed */
	| "failed"
	/** Feature flag disabled or API key missing */
	| "skipped";

// ─── Top-level schema ─────────────────────────────────────────────────────────

export interface ExternalDiligenceV1 {
	schema_version: "external_diligence_v1";
	run_status: ExternalDiligenceRunStatus;
	total_results_fetched: number;
	queries_run: number;
	buckets: ExternalDiligenceBucket[];
	claim_corroborations: ClaimCorroboration[];
	/** Company name used in queries (null if couldn't be derived) */
	company_name_used: string | null;
	/** Sector/market used in queries (null if couldn't be derived) */
	sector_used: string | null;
	ran_at: string;
	/** Tavily credit usage if reported by API, otherwise null */
	tavily_credits_used: number | null;
	/** PR36.3: Cross-bucket synthesised investor conclusions */
	synthesis?: ExternalSignalSynthesisV1;
}

// ─── Query plan ───────────────────────────────────────────────────────────────

export interface ExternalDiligenceQueryPlan {
	company_name: string | null;
	sector: string | null;
	founder_name: string | null;
	/** PR36.2: Extracted product category (more specific than sector) */
	product_category: string | null;
	/** PR36.2: BucketQuerySpec per bucket — includes topic, excludeDomains, days */
	queries: Record<ExternalDiligenceBucketKey, BucketQuerySpec>;
}

// ─── Cost-bounding constants ──────────────────────────────────────────────────

/** Maximum number of Tavily queries to run per job (cost guard) */
export const MAX_QUERIES = 6 as const;
/** Maximum results per individual Tavily query */
export const MAX_RESULTS_PER_QUERY = 5 as const;
/** Absolute maximum total results across all queries (cost guard) */
export const MAX_TOTAL_RESULTS = 30 as const;
/** Maximum characters per result snippet passed to LLM */
export const MAX_SNIPPET_CHARS = 500 as const;
/** Maximum total characters for the serialised external diligence body passed to LLM */
export const MAX_BODY_CHARS = 4000 as const;

// ─── PR36.3: External Signal Synthesis V1 ────────────────────────────────────

/**
 * Deterministic cross-bucket synthesis rating.
 * "unknown" means insufficient data — never guess.
 */
export type SynthesizedRating = "low" | "moderate" | "high" | "unknown";

/**
 * Directional rating for claim validation posture.
 * Reflects whether external evidence supports or contradicts deck claims.
 */
export type DirectionalRating = "positive" | "neutral" | "negative" | "mixed" | "unknown";

/**
 * A single synthesised investor conclusion.
 * Produced by combining structured signals from related buckets.
 */
export interface SynthesisItem {
	/** Investor-grade rating */
	rating: SynthesizedRating;
	/** Concise one-sentence conclusion */
	summary: string;
	/** Deterministic driver labels that explain the rating */
	drivers: string[];
}

/**
 * Claim validation posture — directional rather than rated.
 */
export interface ClaimValidationItem {
	/** Directional verdict from corroboration counts */
	rating: DirectionalRating;
	/** Concise one-sentence summary */
	summary: string;
	/** Deterministic driver labels */
	drivers: string[];
}

/**
 * PR36.3: Cross-bucket synthesised intelligence.
 *
 * Produced by synthesize-external-signals.ts after signal extraction.
 * All fields are deterministic — no LLM, no I/O.
 *
 * Contributing bucket mapping:
 *   market_attractiveness  → market_outlook + financial_context
 *   competitive_pressure   → competitive_landscape + market_outlook
 *   company_visibility     → company_footprint
 *   founder_credibility    → founder_team_signals
 *   external_risk          → external_risks + market_outlook + competitive_landscape + company_footprint
 *   claim_validation_posture → claim_corroborations[]
 */
export interface ExternalSignalSynthesisV1 {
	schema_version: "external_signal_synthesis_v1";
	/** Category direction + funding environment → attractiveness */
	market_attractiveness: SynthesisItem;
	/** Competitor density + market dynamic → pressure investors face */
	competitive_pressure: SynthesisItem;
	/** Company's public footprint quality */
	company_visibility: SynthesisItem;
	/** Founder / team public evidence quality */
	founder_credibility: SynthesisItem;
	/** Aggregated external risk score */
	external_risk: SynthesisItem;
	/** Quality of external corroboration for deck claims */
	claim_validation_posture: ClaimValidationItem;
	/** URLs cited as evidence across all synthesis items */
	evidence_refs: string[];
}
