/**
 * PR35 — External Due Diligence Layer v1
 * Schema definitions: ExternalDiligenceV1 and related types.
 *
 * These types are used by the worker-side assembler and consumed (via serialised
 * body text) by the LLM interpretation layer in llm-interpretation-v1.ts.
 *
 * ⚠️ IMPORTANT: The raw Tavily response is NEVER passed to the LLM.
 *    All Tavily output passes through normalize-external-results.ts first,
 *    which maps it to ExternalDiligenceV1 before any LLM consumption.
 */

// ─── Bucket keys ──────────────────────────────────────────────────────────────

export type ExternalDiligenceBucketKey =
	| "company_overview"
	| "competitors"
	| "market_trends"
	| "company_news"
	| "founder_team_signals"
	| "financial_market_context";

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
}

// ─── Query plan ───────────────────────────────────────────────────────────────

export interface ExternalDiligenceQueryPlan {
	company_name: string | null;
	sector: string | null;
	founder_name: string | null;
	queries: Record<ExternalDiligenceBucketKey, string>;
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
