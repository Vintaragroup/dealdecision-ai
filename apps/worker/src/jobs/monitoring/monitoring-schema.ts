/**
 * PR37 — Deal Risk Radar v1
 * Schema definitions for the continuous monitoring layer.
 *
 * Monitoring runs independently of the initial investor_insights job.
 * Results are stored as a `deal_risk_radar_v1` section in the existing
 * investor_insight_reports render_package.
 *
 * Safety contract:
 *   - Monitoring events are ADDITIVE — they never overwrite canonical fields.
 *   - External failures do not break the pipeline (always returns DealRiskRadarV1
 *     with run_status="skipped" or "failed" rather than throwing).
 *   - Tavily cost-bounding constants mirror PR35 but with tighter limits.
 */

// ─── Bucket keys ──────────────────────────────────────────────────────────────

export type MonitoringBucketKey =
	| "competitor_signals"
	| "company_signals"
	| "market_signals"
	| "founder_team_signals";

export const MONITORING_BUCKET_ORDER: MonitoringBucketKey[] = [
	"company_signals",
	"competitor_signals",
	"market_signals",
	"founder_team_signals",
];

// ─── Cost-bounding constants ───────────────────────────────────────────────────

/** Maximum number of Tavily queries per monitoring run (4 buckets). */
export const MAX_MONITORING_QUERIES = 4;

/** Maximum results per individual Tavily query. */
export const MAX_MONITORING_RESULTS_PER_QUERY = 5;

/** Hard ceiling on total results fetched before aborting further queries. */
export const MAX_MONITORING_TOTAL_RESULTS = 20;

/** Maximum length of a single search result snippet stored in the schema. */
export const MAX_MONITORING_SNIPPET_CHARS = 400;

/** Default repeat interval for the monitoring scheduler: 7 days in ms. */
export const MONITORING_REPEAT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Impact levels ────────────────────────────────────────────────────────────

export type MonitoringEventImpact = "low" | "medium" | "high";

export type SignalConsensus =
	| "bullish"           // mostly positive/opportunity signals
	| "bearish"           // predominantly negative/risk signals
	| "mixed"             // mix of positive and negative signals
	| "neutral"           // signals present but directionally inconclusive
	| "insufficient_data"; // too few sources to draw a conclusion

// ─── Per-result ───────────────────────────────────────────────────────────────

export interface MonitoringSearchResult {
	url: string;
	title: string;
	snippet: string;
	score: number;
	published_date: string | null;
	bucket: MonitoringBucketKey;
}

// ─── Per-bucket ───────────────────────────────────────────────────────────────

export type MonitoringBucketStatus = "ok" | "empty" | "skipped" | "failed";

export interface MonitoringSearchBucket {
	bucket: MonitoringBucketKey;
	query_used: string;
	results: MonitoringSearchResult[];
	results_count: number;
	status: MonitoringBucketStatus;
	error_message?: string;
}

// ─── Monitoring query plan ────────────────────────────────────────────────────

export interface MonitoringQueryPlan {
	/** Company name derived from existing report context. */
	company_name: string | null;
	/** Sector extracted from existing report context. */
	sector: string | null;
	/** Competitor names parsed from LLM competitive_landscape field. */
	competitor_names: string[];
	/** Founder names parsed from existing diligence data. */
	founder_names: string[];
	/** Four query strings, one per monitoring bucket. */
	queries: Record<MonitoringBucketKey, string>;
}

// ─── Event types (per PR37 spec) ──────────────────────────────────────────────

export interface CompetitorEvent {
	/** Company name — derived from signal or query context. */
	company: string;
	/** Short description of the event (≤ 120 chars). */
	event: string;
	/** Assessed impact level. */
	impact: MonitoringEventImpact;
	/** Source URLs (de-duped). */
	evidence_urls: string[];
}

export interface MarketEvent {
	/** Short description of the market event. */
	description: string;
	/** Sector / industry this event relates to. */
	sector: string;
	/** Market direction for investors. */
	direction: "positive" | "negative" | "neutral";
	/** Source URLs (de-duped). */
	evidence_urls: string[];
}

export interface CompanyEvent {
	/** Short description of the event. */
	event: string;
	/** Event category. */
	category: "product" | "legal" | "press" | "funding" | "other";
	/** Assessed impact level. */
	impact: MonitoringEventImpact;
	/** Source URLs (de-duped). */
	evidence_urls: string[];
}

export interface FounderSignal {
	/** Founder/team member name (if determinable). */
	name: string;
	/** Signal description. */
	signal: string;
	/** Assessed impact level. */
	impact: MonitoringEventImpact;
	/** Source URLs (de-duped). */
	evidence_urls: string[];
}

// ─── Run status ───────────────────────────────────────────────────────────────

export type MonitoringRunStatus =
	/** At least one bucket succeeded. */
	| "succeeded"
	/** Some buckets succeeded, some failed. */
	| "partial"
	/** All buckets failed. */
	| "failed"
	/** Feature flag disabled or API key missing. */
	| "skipped";

// ─── Top-level schema ─────────────────────────────────────────────────────────

export interface DealRiskRadarV1 {
	schema_version: "deal_risk_radar_v1";

	/** Competitor news, funding, product launches, acquisitions. */
	competitor_events: CompetitorEvent[];

	/** Market shifts, regulation, macro signals. */
	market_events: MarketEvent[];

	/** Company-specific press, legal, product, or funding signals. */
	company_events: CompanyEvent[];

	/** Founder/team leadership, career, or reputation signals. */
	founder_signals: FounderSignal[];

	/** Total search results fetched across all buckets. */
	source_count: number;

	/** Overall signal consensus from signal volume and diversity. */
	signal_consensus: SignalConsensus;

	/** Deal ID this radar belongs to. */
	deal_id: string;

	/** ISO timestamp when this monitoring run completed. */
	ran_at: string;

	/** ISO timestamp when the next scheduled run is planned. null before first schedule. */
	next_scheduled_at: string | null;

	/** Status of this monitoring run. */
	run_status: MonitoringRunStatus;

	/** Total number of Tavily results fetched (raw, before filtering). */
	total_sources_fetched: number;

	/** Company name used in queries. null when not determinable. */
	company_name_used: string | null;

	/** Sector used in queries. null when not determinable. */
	sector_used: string | null;
}
