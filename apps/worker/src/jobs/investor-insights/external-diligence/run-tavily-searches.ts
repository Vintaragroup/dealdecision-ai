/**
 * PR35 / PR36.2 — External Due Diligence: Tavily Search Runner
 *
 * Cost-bounded, flag-gated Tavily search executor.
 *
 * Cost-bounding:
 *   - MAX_QUERIES=6 — hard cap on queries per job
 *   - MAX_RESULTS_PER_QUERY=5 — maxResults passed to Tavily
 *   - MAX_TOTAL_RESULTS=30 — abort once accumulated total hits this
 *
 * Feature flags (checked at runtime):
 *   - TAVILY_ENABLED="true"  — must be set or all queries are skipped
 *   - TAVILY_API_KEY         — required when TAVILY_ENABLED is true
 *
 * Graceful degradation:
 *   - Per-bucket failures emit a structured EXTERNAL_DILIGENCE_QUERY_FAIL log and
 *     status="failed" on the bucket; they do NOT throw.
 *   - Network timeout per query: 10 s.
 */

import { tavily } from "@tavily/core";
import type {
	ExternalDiligenceBucket,
	ExternalDiligenceBucketKey,
	ExternalSearchResult,
} from "./external-diligence-schema";
import {
	MAX_RESULTS_PER_QUERY,
	MAX_TOTAL_RESULTS,
	MAX_SNIPPET_CHARS,
} from "./external-diligence-schema";
import type { ExternalDiligenceQueryPlan } from "./external-diligence-schema";

// ─── Bucket ordering (defines execution priority if total-results cap is hit) ──

const BUCKET_ORDER: ExternalDiligenceBucketKey[] = [
	"company_footprint",
	"competitive_landscape",
	"market_outlook",
	"founder_team_signals",
	"financial_context",
	"external_risks",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Trim snippet to LLM-safe length and strip newlines for inline serialisation */
function sanitiseSnippet(content: string): string {
	return content
		.replace(/\r?\n+/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim()
		.slice(0, MAX_SNIPPET_CHARS);
}

/** Parse ISO date — returns null when Tavily returns an empty/invalid string */
function parsePublishedDate(raw: string | undefined): string | null {
	if (!raw || raw === "N/A") return null;
	try {
		const d = new Date(raw);
		return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
	} catch {
		return null;
	}
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface RunTavilySearchesResult {
	buckets: ExternalDiligenceBucket[];
	total_results_fetched: number;
	queries_run: number;
	tavily_credits_used: number | null;
}

/**
 * Execute up to MAX_QUERIES Tavily searches against the provided query plan.
 *
 * Respects cost-bounding constants and feature-flag guards.  Never throws —
 * all errors are contained per-bucket with status="failed".
 *
 * @param plan     Query plan built by buildExternalDiligenceQueryPlan()
 * @param dealId   Deal identifier for structured logging
 * @returns        RunTavilySearchesResult with populated buckets
 */
export async function runTavilySearches(
	plan: ExternalDiligenceQueryPlan,
	dealId: string
): Promise<RunTavilySearchesResult> {
	const enabled = process.env["TAVILY_ENABLED"] === "true";
	const apiKey = process.env["TAVILY_API_KEY"];

	// ── Feature-flag guard ──────────────────────────────────────────────────
	if (!enabled || !apiKey) {
		const reason = !enabled ? "TAVILY_ENABLED not set" : "TAVILY_API_KEY missing";
		console.log(
			JSON.stringify({
				event: "EXTERNAL_DILIGENCE_SKIPPED",
				reason_code: !enabled ? "feature_flag_disabled" : "missing_tavily_key",
				reason,
				deal_id: dealId,
				ts: new Date().toISOString(),
			})
		);
		return {
			buckets: BUCKET_ORDER.map((bucket) => ({
				bucket,
				query_used: plan.queries[bucket].query,
				results: [],
				results_count: 0,
				status: "skipped",
			})),
			total_results_fetched: 0,
			queries_run: 0,
			tavily_credits_used: null,
		};
	}

	// ── Initialise Tavily client ─────────────────────────────────────────────
	const client = tavily({ apiKey });

	const buckets: ExternalDiligenceBucket[] = [];
	let totalResultsFetched = 0;
	let queriesRun = 0;
	let totalCredits = 0;

	// ── Execute queries in order ─────────────────────────────────────────────
	for (const bucketKey of BUCKET_ORDER) {
		// Hard cap: stop if total-results limit is already reached
		if (totalResultsFetched >= MAX_TOTAL_RESULTS) {
			buckets.push({
				bucket: bucketKey,
				query_used: plan.queries[bucketKey].query,
				results: [],
				results_count: 0,
				status: "skipped",
			});
			continue;
		}

		const spec = plan.queries[bucketKey];
		const query = spec.query;
		const remainingSlots = MAX_TOTAL_RESULTS - totalResultsFetched;
		const maxResults = Math.min(MAX_RESULTS_PER_QUERY, remainingSlots);

		console.log(
			JSON.stringify({
				event: "EXTERNAL_DILIGENCE_QUERY_START",
				deal_id: dealId,
				bucket: bucketKey,
				query,
				max_results: maxResults,
				ts: new Date().toISOString(),
			})
		);

		try {
			const response = await client.search(query, {
				maxResults,
				searchDepth: "basic",
				includeAnswer: false,
				includeUsage: true,
				timeout: 10000,
				...(spec.topic ? { topic: spec.topic } : {}),
				...(spec.excludeDomains ? { excludeDomains: spec.excludeDomains } : {}),
				...(spec.days ? { days: spec.days } : {}),
			});

			queriesRun++;
			if (response.usage?.credits) {
				totalCredits += response.usage.credits;
			}

			const results: ExternalSearchResult[] = response.results.map((r) => ({
				url: r.url,
				title: r.title ?? "",
				snippet: sanitiseSnippet(r.content ?? ""),
				score: typeof r.score === "number" ? +r.score.toFixed(3) : 0,
				published_date: parsePublishedDate(r.publishedDate),
				bucket: bucketKey,
			}));

			totalResultsFetched += results.length;

			console.log(
				JSON.stringify({
					event: "EXTERNAL_DILIGENCE_QUERY_OK",
					deal_id: dealId,
					bucket: bucketKey,
					results_count: results.length,
					credits_this_query: response.usage?.credits ?? null,
					ts: new Date().toISOString(),
				})
			);

			buckets.push({
				bucket: bucketKey,
				query_used: query,
				results,
				results_count: results.length,
				status: results.length > 0 ? "ok" : "empty",
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				JSON.stringify({
					event: "EXTERNAL_DILIGENCE_QUERY_FAIL",
					deal_id: dealId,
					bucket: bucketKey,
					query: spec.query,
					error: message,
					ts: new Date().toISOString(),
				})
			);
			buckets.push({
				bucket: bucketKey,
				query_used: query,
				results: [],
				results_count: 0,
				status: "failed",
				error_message: message.slice(0, 200),
			});
		}
	}

	return {
		buckets,
		total_results_fetched: totalResultsFetched,
		queries_run: queriesRun,
		tavily_credits_used: totalCredits > 0 ? totalCredits : null,
	};
}
