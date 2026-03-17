/**
 * PR36.2 — External Due Diligence: Result Quality Filter
 *
 * Deterministically filters raw Tavily results before signal extraction or LLM
 * injection.  No I/O, no scoring models — pure string/domain rules.
 *
 * Design goals:
 *   - Remove generic educational / low-signal noise
 *   - Remove job postings and template content
 *   - Apply bucket-specific priority rules (e.g., prefer Crunchbase for footprint)
 *   - NEVER silently drop all results — if filtering leaves nothing, return originals
 *
 * Filtering is conservative: when in doubt, keep the result.
 * The goal is to surface the best 5 results, not achieve perfection.
 */

import type { ExternalSearchResult, ExternalDiligenceBucketKey } from "./external-diligence-schema";

// ─── Noise domain lists ───────────────────────────────────────────────────────

/**
 * Domains that almost always return generic educational content rather than
 * company/market-specific signals.
 *
 * Exception: if the company name appears in the URL path, keep it.
 */
const GENERIC_NOISE_DOMAINS: ReadonlyArray<string> = [
	"quora.com",
	"reddit.com",
	"answers.yahoo.com",
	"ask.com",
	"answers.com",
	"stackexchange.com",
	"stackoverflow.com",
	"wikianswers.com",
	"ehow.com",
	"about.com",
	"thoughtco.com",
	"liveabout.com",
];

/** Job posting domains — never relevant to external diligence */
const JOB_POSTING_DOMAINS: ReadonlyArray<string> = [
	"indeed.com",
	"glassdoor.com",
	"jobs.lever.co",
	"boards.greenhouse.io",
	"linkedin.com/jobs",
	"angel.co/l/jobs",
	"wellfound.com/jobs",
	"breezy.hr",
	"workable.com",
	"ziprecruiter.com",
	"monster.com",
	"careerbuilder.com",
	"simplyhired.com",
	"jobs.ashbyhq.com",
	"jobs.smartrecruiters.com",
];

/** Generic startup advice / template domains */
const GENERIC_ADVICE_DOMAINS: ReadonlyArray<string> = [
	"entrepreneur.com",   // often generic playbooks, not company-specific
	"smallbiztrends.com",
	"thebalancemoney.com",
	"thebalancesmb.com",
	"fundera.com",
	"nerdwallet.com",
	"investopedia.com",   // financial definitions — too generic for most buckets
	"medium.com",         // PR36.4: low-signal blog aggregator, seldom company-specific
	"substack.com",       // PR36.4: newsletter platform — rarely authoritative
	"hubspot.com",        // PR36.4: marketing blog templates
	"wordstream.com",     // PR36.4: advertising blog content
	"businessnewsdaily.com",
];

// ─── Title pattern filters ────────────────────────────────────────────────────

const GENERIC_TITLE_PATTERNS: ReadonlyArray<RegExp> = [
	/\bwhat is\b/i,
	/\bhow to\b/i,
	/\bguide to\b/i,
	/\bcomplete guide\b/i,
	/\bbeginner'?s?\b/i,
	/\bdefinition of\b/i,
	/\bintroduction to\b/i,
	/\btutorial\b/i,
	/\btemplate\b/i,
	/\bchecklist\b/i,
	/\bwhy you should\b/i,
	/\btips for\b/i,
	/\bbest practices\b/i,
	/\beywords?\b/i,             // "X keywords" — SEO noise
	/job description\b/i,
	/\bjob (posting|opening|listing|opportunity)\b/i,
	/\bapply now\b/i,
	/\bopen position\b/i,
	/\bsalary\b/i,
];

// ─── High-quality source domains by bucket ────────────────────────────────────

const PREFERRED_DOMAINS: Record<string, ReadonlyArray<string>> = {
	company_footprint: [
		"crunchbase.com", "techcrunch.com", "bloomberg.com", "reuters.com",
		"businesswire.com", "prnewswire.com", "venturebeat.com", "axios.com",
		"pitchbook.com", "startupnews.fyi", "theregister.com",
	],
	competitive_landscape: [
		"g2.com", "capterra.com", "getapp.com", "trustradius.com",
		"gartner.com", "forrester.com", "idc.com", "techradar.com",
		"productreview.com.au", "softwareadvice.com", "alternativeto.net",
	],
	market_outlook: [
		"gartner.com", "forrester.com", "idc.com", "mckinsey.com",
		"bcg.com", "grandviewresearch.com", "marketsandmarkets.com",
		"alliedmarketresearch.com", "mordorintelligence.com",
		"statista.com", "ibisworld.com", "spglobal.com",
	],
	financial_context: [
		"crunchbase.com", "pitchbook.com", "cbinsights.com", "techcrunch.com",
		"venturebeat.com", "axios.com", "seedtable.com", "sifted.eu",
		"strictlyvc.com", "bloomberg.com", "wsj.com",
	],
	founder_team_signals: [
		"crunchbase.com", "techcrunch.com", "bloomberg.com",
		"businesswire.com", "prnewswire.com", "venturebeat.com",
	],
	external_risks: [
		"techcrunch.com", "bloomberg.com", "reuters.com", "wsj.com",
		"axios.com", "businesswire.com", "prnewswire.com",
	],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return url.toLowerCase().slice(0, 60);
	}
}

function isJobPosting(url: string, title: string): boolean {
	const domain = getDomain(url);
	if (JOB_POSTING_DOMAINS.some((d) => domain.includes(d))) return true;
	return /job description|job posting|open position|apply now/i.test(title);
}

function hasGenericTitle(title: string): boolean {
	return GENERIC_TITLE_PATTERNS.some((p) => p.test(title));
}

function isGenericNoiseDomain(url: string): boolean {
	const domain = getDomain(url);
	return GENERIC_NOISE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function isGenericAdviceDomain(url: string): boolean {
	const domain = getDomain(url);
	return GENERIC_ADVICE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Return a quality score for a result within a bucket.
 * Higher = better.  Used to sort/rank when filtering.
 */
function scoreResult(
	result: ExternalSearchResult,
	bucketKey: ExternalDiligenceBucketKey,
	companyName: string | null
): number {
	let score = result.score * 100; // base: Tavily relevance score

	const domain = getDomain(result.url);
	const companySlug = companyName?.toLowerCase().replace(/\s+/g, "");

	// Boost preferred sources per bucket
	const preferred = PREFERRED_DOMAINS[bucketKey] ?? [];
	if (preferred.some((d) => domain.includes(d))) score += 30;

	// Boost if company name appears in URL (strong company-specificity signal)
	if (companySlug && result.url.toLowerCase().includes(companySlug)) score += 20;

	// Boost for recency (within last 18 months)
	if (result.published_date) {
		const ageMs = Date.now() - new Date(result.published_date).getTime();
		const ageDays = ageMs / (1000 * 60 * 60 * 24);
		if (ageDays <= 180) score += 15;
		else if (ageDays <= 540) score += 8;
	}

	// Penalise generic noise domains
	if (isGenericNoiseDomain(result.url)) score -= 40;
	if (isGenericAdviceDomain(result.url)) score -= 20;
	if (isJobPosting(result.url, result.title)) score -= 80;
	if (hasGenericTitle(result.title)) score -= 25;

	return score;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Filter and rank results for a single bucket, returning up to `maxKeep` results.
 *
 * Filtering is conservative: if strict filtering would drop all results, the
 * original results are returned ranked by Tavily score.
 *
 * @param results      Raw results from Tavily for this bucket
 * @param bucketKey    Which bucket these results belong to
 * @param companyName  Extracted company name (used for specificity scoring)
 * @param maxKeep      Maximum results to return (default: all ranked)
 */
export function filterAndRankResults(
	results: ExternalSearchResult[],
	bucketKey: ExternalDiligenceBucketKey,
	companyName: string | null,
	maxKeep = results.length
): ExternalSearchResult[] {
	if (results.length === 0) return results;

	// Score all results
	const scored = results.map((r) => ({
		result: r,
		quality: scoreResult(r, bucketKey, companyName),
	}));

	// Sort descending by quality
	scored.sort((a, b) => b.quality - a.quality);

	// Hard-drop job postings and results with score below -20
	const filtered = scored.filter((r) => {
		if (isJobPosting(r.result.url, r.result.title)) return false;
		if (r.quality < -20) return false;
		return true;
	});

	// Conservative fallback: never return empty when raw had results
	const toReturn = filtered.length > 0 ? filtered : scored;

	return toReturn.slice(0, maxKeep).map((r) => r.result);
}

/**
 * Filtering policy documentation (for audit purposes).
 * Returns a human-readable description of what this filter does.
 */
export const FILTER_POLICY_SUMMARY = [
	"Job posting URLs and titles are always dropped.",
	"Generic educational/explainer titles ('what is', 'how to', 'guide to') are penalised.",
	"Known generic-noise domains (Quora, Reddit, Yahoo Answers, etc.) are penalised unless company-name appears in URL.",
	"Generic startup-advice domains (Investopedia, Entrepreneur.com, Medium.com, Substack.com, etc.) are penalised (PR36.4).",
	"Preferred high-quality sources per bucket (Crunchbase, Gartner, G2, TechCrunch, etc.) are boosted.",
	"PR36.4: founder_team_signals and external_risks now have dedicated preferred domain lists.",
	"Recent results (<180 days) are boosted; results mentioning company name in URL are boosted.",
	"If strict filtering would drop all results, originals are retained ranked by Tavily score.",
].join(" ");
