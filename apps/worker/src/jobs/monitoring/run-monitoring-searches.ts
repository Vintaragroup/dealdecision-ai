/**
 * PR37 — Deal Risk Radar: Monitoring Search Runner
 *
 * Cost-bounded, flag-gated Tavily search executor for continuous monitoring.
 * Mirrors the PR35 run-tavily-searches.ts pattern with monitoring-specific
 * configuration (4 buckets, news-biased search, tighter result caps).
 *
 * Cost-bounding:
 *   MAX_MONITORING_QUERIES=4
 *   MAX_MONITORING_RESULTS_PER_QUERY=5
 *   MAX_MONITORING_TOTAL_RESULTS=20
 *
 * Feature flags (same as PR35):
 *   TAVILY_ENABLED="true"  — required or all searches are skipped
 *   TAVILY_API_KEY         — required when TAVILY_ENABLED is true
 *
 * Graceful degradation:
 *   - Per-bucket failures emit a structured MONITORING_QUERY_FAIL log and
 *     set status="failed"; they do NOT throw.
 *   - Network timeout: 10 s per query.
 *   - Never throws — always returns a RunMonitoringSearchesResult.
 */

import { tavily } from "@tavily/core";
import type {
	MonitoringSearchResult,
	MonitoringSearchBucket,
	MonitoringBucketKey,
	MonitoringQueryPlan,
} from "./monitoring-schema";
import {
	MONITORING_BUCKET_ORDER,
	MAX_MONITORING_RESULTS_PER_QUERY,
	MAX_MONITORING_TOTAL_RESULTS,
	MAX_MONITORING_SNIPPET_CHARS,
} from "./monitoring-schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitiseSnippet(content: string): string {
	return content
		.replace(/\r?\n+/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim()
		.slice(0, MAX_MONITORING_SNIPPET_CHARS);
}

function parsePublishedDate(raw: string | undefined): string | null {
	if (!raw || raw === "N/A") return null;
	try {
		const d = new Date(raw);
		return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
	} catch {
		return null;
	}
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface RunMonitoringSearchesResult {
	buckets: MonitoringSearchBucket[];
	total_results_fetched: number;
	queries_run: number;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Execute up to 4 Tavily news searches against the monitoring query plan.
 *
 * Respects cost-bounding constants and feature-flag guards.  Never throws.
 *
 * @param plan    Query plan built by buildMonitoringQueryPlan()
 * @param dealId  Deal identifier for structured logging
 */
export async function runMonitoringSearches(
	plan: MonitoringQueryPlan,
	dealId: string
): Promise<RunMonitoringSearchesResult> {
	const enabled = process.env["TAVILY_ENABLED"] === "true";
	const apiKey = process.env["TAVILY_API_KEY"];

	// ── Feature-flag guard ──────────────────────────────────────────────────
	if (!enabled || !apiKey) {
		const reason = !enabled ? "TAVILY_ENABLED not set" : "TAVILY_API_KEY missing";
		const reasonCode = !enabled ? "feature_flag_disabled" : "missing_tavily_key";
		console.log(
			JSON.stringify({
				event: "MONITORING_SKIPPED",
				reason_code: reasonCode,
				reason,
				deal_id: dealId,
				ts: new Date().toISOString(),
			})
		);
		return {
			buckets: MONITORING_BUCKET_ORDER.map((bucket) => ({
				bucket,
				query_used: plan.queries[bucket],
				results: [],
				results_count: 0,
				status: "skipped",
			})),
			total_results_fetched: 0,
			queries_run: 0,
		};
	}

	// ── Initialise Tavily client ────────────────────────────────────────────
	const client = tavily({ apiKey });

	const buckets: MonitoringSearchBucket[] = [];
	let totalResultsFetched = 0;
	let queriesRun = 0;

	// ── Execute queries in bucket order ────────────────────────────────────
	for (const bucketKey of MONITORING_BUCKET_ORDER) {
		// Hard cap: stop if total-results limit already reached
		if (totalResultsFetched >= MAX_MONITORING_TOTAL_RESULTS) {
			buckets.push({
				bucket: bucketKey,
				query_used: plan.queries[bucketKey],
				results: [],
				results_count: 0,
				status: "skipped",
			});
			continue;
		}

		const query = plan.queries[bucketKey];
		const remainingSlots = MAX_MONITORING_TOTAL_RESULTS - totalResultsFetched;
		const maxResults = Math.min(MAX_MONITORING_RESULTS_PER_QUERY, remainingSlots);

		console.log(
			JSON.stringify({
				event: "MONITORING_QUERY_START",
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
				topic: "news",
				includeAnswer: false,
				includeUsage: false,
				timeout: 10000,
			});

			queriesRun++;

			const results: MonitoringSearchResult[] = response.results.map((r) => ({
				url: r.url,
				title: r.title ?? "",
				snippet: sanitiseSnippet(r.content ?? ""),
				score: typeof r.score === "number" ? +r.score.toFixed(3) : 0,
				published_date: parsePublishedDate(r.publishedDate),
				bucket: bucketKey as MonitoringBucketKey,
			}));

			totalResultsFetched += results.length;

			console.log(
				JSON.stringify({
					event: "MONITORING_QUERY_OK",
					deal_id: dealId,
					bucket: bucketKey,
					results_count: results.length,
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
					event: "MONITORING_QUERY_FAIL",
					deal_id: dealId,
					bucket: bucketKey,
					query,
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
	};
}
