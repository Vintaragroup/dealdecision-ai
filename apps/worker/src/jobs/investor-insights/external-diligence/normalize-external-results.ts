/**
 * PR35 / PR36.2 — External Due Diligence: Normalizer
 *
 * Post-processes raw Tavily bucket results into a clean ExternalDiligenceV1
 * payload before it is serialised for LLM or UI consumption.
 *
 * Responsibilities:
 *   1. Dedup results by URL across all buckets
 *   2. Quality-filter + rank each bucket (drops job boards, penalises noise)
 *   3. Extract typed bucket signals via deterministic pattern matching
 *   4. Build ClaimCorroboration records by cross-checking canonical Phase-2
 *      fields against web snippets (company_footprint + external_risks buckets)
 *   5. Derive run_status from bucket statuses
 *
 * Pure function beyond structured logging — no Tavily calls, no DB access.
 */

import type {
	ExternalDiligenceV1,
	ExternalDiligenceBucket,
	ExternalSearchResult,
	ClaimCorroboration,
	CorroborationVerdict,
	ExternalDiligenceRunStatus,
} from "./external-diligence-schema";
import type { RunTavilySearchesResult } from "./run-tavily-searches";
import type { ExternalDiligenceQueryPlan } from "./external-diligence-schema";
import { filterAndRankResults } from "./result-quality-filter";
import { extractBucketSignal } from "./signal-extraction";
import { synthesizeExternalSignals } from "./signal-synthesis/synthesize-external-signals";

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Remove duplicate URLs across the full result set.
 * When the same URL appears in multiple buckets, only the first occurrence is kept.
 * Modifies buckets in-place (returns new array with updated results).
 */
function deduplicateByUrl(
	buckets: ExternalDiligenceBucket[]
): ExternalDiligenceBucket[] {
	const seen = new Set<string>();
	return buckets.map((bucket) => {
		const deduped = bucket.results.filter((r) => {
			const key = r.url.toLowerCase().replace(/\/$/, "");
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		return {
			...bucket,
			results: deduped,
			results_count: deduped.length,
		};
	});
}

// ─── Claim corroboration ──────────────────────────────────────────────────────

/**
 * Patterns for extracting currency amounts from snippets.
 * Matches forms like "$500K", "$1.5M", "$50 million", "€2B", "£1.2M".
 */
const MONEY_RE =
	/(?:[€£$]|USD|EUR|GBP)\s*[\d,]+(?:\.\d+)?\s*(?:[BbMmKkTt]|million|billion|thousand)?/gi;

/** Check whether a snippet plausibly contains a given dollar-amount value. */
function snippetMentionsAmount(snippet: string, value: string): boolean {
	const snipLower = snippet.toLowerCase();
	// Direct substring check first
	if (snipLower.includes(value.toLowerCase())) return true;
	// Extract amounts from both and check for approximate match
	const snipAmounts = (snippet.match(MONEY_RE) ?? []).map((a) =>
		a.replace(/\s/g, "").toLowerCase()
	);
	const targetAmount = value.replace(/\s/g, "").toLowerCase();
	return snipAmounts.some((a) => a === targetAmount || a.startsWith(targetAmount));
}

/** Check whether a snippet plausibly mentions a company or sector name. */
function snippetMentionsEntity(snippet: string, entity: string): boolean {
	return snippet.toLowerCase().includes(entity.toLowerCase());
}

/**
 * Determine corroboration verdict for a single claim against a set of results.
 *
 * Strategy:
 *   - "corroborated": the claim value appears (or a close match) in one of the snippets
 *   - "contradicted": the company IS mentioned but a clearly different value appears
 *   - "not_found": the company or claim cannot be confirmed or denied from available snippets
 */
function corroborateClaimAgainstResults(
	claimField: string,
	claimValue: string,
	companyName: string | null,
	results: ExternalSearchResult[]
): { verdict: CorroborationVerdict; signal: string; sourceUrl: string } | null {
	if (results.length === 0) return null;

	const companyFound = companyName
		? results.filter((r) => snippetMentionsEntity(r.snippet, companyName))
		: results;

	if (companyFound.length === 0) {
		return null; // company not mentioned — no corroboration evidence
	}

	// Check for corroboration
	for (const r of companyFound) {
		if (snippetMentionsAmount(r.snippet, claimValue)) {
			return {
				verdict: "corroborated",
				signal: r.snippet.slice(0, 200),
				sourceUrl: r.url,
			};
		}
	}

	// Check for contradiction: company found + different amount present
	if (claimField === "raise_amount" || claimField === "valuation_pre" || claimField === "valuation_post") {
		for (const r of companyFound) {
			const amounts = r.snippet.match(MONEY_RE);
			if (amounts && amounts.length > 0) {
				const firstAmount = amounts[0].replace(/\s/g, "").toUpperCase();
				const canonical = claimValue.replace(/\s/g, "").toUpperCase();
				if (firstAmount !== canonical) {
					return {
						verdict: "contradicted",
						signal: r.snippet.slice(0, 200),
						sourceUrl: r.url,
					};
				}
			}
		}
	}

	// Mention without value → not_found for this specific claim
	return {
		verdict: "not_found",
		signal: companyFound[0]!.snippet.slice(0, 200),
		sourceUrl: companyFound[0]!.url,
	};
}

/**
 * Build claim corroborations by cross-checking canonical Phase-2 field values
 * (expressed as key=value pairs in a canonical body string) against search results.
 *
 * @param canonicalFieldsBody  The same formatted canonical body as passed to the LLM
 * @param companyName          Extracted company name
 * @param allResults           All deduplicated search results (from company_overview + company_news)
 */
function buildClaimCorroborations(
	canonicalFieldsBody: string | null,
	companyName: string | null,
	allResults: ExternalSearchResult[]
): ClaimCorroboration[] {
	if (!canonicalFieldsBody || allResults.length === 0) return [];

	// Filter to company-facing buckets for corroboration (most likely to contain accurate data)
	const relevantResults = allResults.filter(
		(r) => r.bucket === "company_footprint" || r.bucket === "external_risks"
	);
	if (relevantResults.length === 0) return [];

	const corroborations: ClaimCorroboration[] = [];

	// Parse "field=key value=VALUE" lines from the canonical body
	// Format: "field=raise_amount value=$500K evidence=... reason=..."
	const FIELD_LINE_RE = /field=(\S+)\s+value=([^\s]+(?:\s+[^\s]+)*?)(?:\s+evidence=|\s+reason=|$)/gm;
	let match: RegExpExecArray | null;
	while ((match = FIELD_LINE_RE.exec(canonicalFieldsBody)) !== null) {
		const field = match[1];
		const value = match[2]?.trim();
		if (!field || !value || value === "null" || value === "N/A") continue;

		// Only attempt corroboration for fields with concrete measurable values
		const CORROBORATABLE_FIELDS = new Set([
			"raise_amount",
			"valuation_pre",
			"valuation_post",
		]);
		if (!CORROBORATABLE_FIELDS.has(field)) continue;

		const result = corroborateClaimAgainstResults(
			field,
			value,
			companyName,
			relevantResults
		);
		if (result) {
			corroborations.push({
				claim_field: field,
				claim_value: value,
				web_signal: result.signal,
				source_url: result.sourceUrl,
				verdict: result.verdict,
			});
		}
	}

	return corroborations;
}

// ─── Run status derivation ────────────────────────────────────────────────────

function deriveRunStatus(buckets: ExternalDiligenceBucket[]): ExternalDiligenceRunStatus {
	const statuses = buckets.map((b) => b.status);
	if (statuses.every((s) => s === "skipped")) return "skipped";
	const ran = buckets.filter((b) => b.status === "ok" || b.status === "empty");
	const failed = buckets.filter((b) => b.status === "failed");
	if (ran.length === 0 && failed.length > 0) return "failed";
	if (failed.length > 0) return "partial";
	return "succeeded";
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Normalise raw Tavily search output into an ExternalDiligenceV1 payload.
 *
 * @param searchResult      Output of runTavilySearches()
 * @param plan              Query plan (supplies company_name etc.)
 * @param canonicalFieldsBody  Optional canonical body for claim corroboration
 */
export function normalizeExternalResults(
	searchResult: RunTavilySearchesResult,
	plan: ExternalDiligenceQueryPlan,
	canonicalFieldsBody: string | null = null
): ExternalDiligenceV1 {
	// 1. Dedup by URL across all buckets
	const dedupedBuckets = deduplicateByUrl(searchResult.buckets);

	// 2. Quality-filter + rank each bucket; attach typed signal
	const processedBuckets: ExternalDiligenceBucket[] = dedupedBuckets.map((bucket) => {
		const filtered = filterAndRankResults(
			bucket.results,
			bucket.bucket,
			plan.company_name
		);
		const signal = extractBucketSignal(bucket.bucket, filtered, {
			companyName: plan.company_name,
			sector: plan.sector,
			founderName: plan.founder_name,
		});
		return {
			...bucket,
			results: filtered,
			results_count: filtered.length,
			signal: signal ?? undefined,
		};
	});

	// 3. Flatten all results for corroboration
	const allResults: ExternalSearchResult[] = processedBuckets.flatMap(
		(b) => b.results
	);

	// 4. Build claim corroborations
	const claimCorroborations = buildClaimCorroborations(
		canonicalFieldsBody,
		plan.company_name,
		allResults
	);

	// 5. Derive run_status
	const runStatus = deriveRunStatus(processedBuckets);

	// 6. Updated total (after dedup + filter)
	const totalAfterDedup = allResults.length;

	const diligence: ExternalDiligenceV1 = {
		schema_version: "external_diligence_v1",
		run_status: runStatus,
		total_results_fetched: totalAfterDedup,
		queries_run: searchResult.queries_run,
		buckets: processedBuckets,
		claim_corroborations: claimCorroborations,
		company_name_used: plan.company_name,
		sector_used: plan.sector,
		ran_at: new Date().toISOString(),
		tavily_credits_used: searchResult.tavily_credits_used,
	};

	// 7. PR36.3: Cross-bucket synthesis — deterministic, no I/O
	// Only synthesise when at least one bucket actually has results
	if (processedBuckets.some((b) => b.results.length > 0)) {
		diligence.synthesis = synthesizeExternalSignals(diligence);
	}

	return diligence;
}
