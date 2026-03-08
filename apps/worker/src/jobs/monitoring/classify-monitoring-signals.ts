/**
 * PR37 — Deal Risk Radar: Signal Classifier
 *
 * Maps raw Tavily search results (per monitoring bucket) to typed DealRiskRadarV1
 * event types using deterministic keyword-based heuristics.
 *
 * No LLM calls — all classification is deterministic.
 *
 * Classification is deliberately conservative:
 *   - Each source result generates at most ONE event.
 *   - Impact is over-estimated rather than under-estimated (investors prefer
 *     awareness of potential risks over missed signals).
 *
 * @pure (no I/O, no side effects)
 */

import type {
	MonitoringSearchBucket,
	MonitoringSearchResult,
	CompetitorEvent,
	MarketEvent,
	CompanyEvent,
	FounderSignal,
	MonitoringEventImpact,
} from "./monitoring-schema";

// ─── Impact keyword sets ──────────────────────────────────────────────────────

const HIGH_IMPACT_KEYWORDS = [
	"funding", "raises", "raised", "acquisition", "acquired", "merger", "acquires",
	"ipo", "lawsuit", "sued", "fine", "penalt", "bankrupt", "shutdown", "shut down",
	"series a", "series b", "series c", "series d", "$", "million", "billion",
];

const MEDIUM_IMPACT_KEYWORDS = [
	"launches", "launched", "announces", "announced", "hiring", "hires", "hired",
	"expands", "expansion", "partnership", "partners", "integrat", "new product",
	"raises seed", "pre-seed", "accelerator", "incubator",
];

// ─── Company event category keywords ─────────────────────────────────────────

const LEGAL_KEYWORDS = [
	"lawsuit", "sued", "legal", "court", "regulatory", "compliance", "fine",
	"penalt", "enforce", "settlement", "fdic", "sec", "ftc", "doj",
];

const FUNDING_KEYWORDS = [
	"funding", "raises", "raised", "series", "seed", "capital", "investment",
	"investor", "venture", "vc", "ipo", "spac",
];

const PRODUCT_KEYWORDS = [
	"launch", "launches", "launched", "feature", "product", "release", "update",
	"version", "unveil", "introduces", "announces product",
];

// ─── Market direction keywords ────────────────────────────────────────────────

const POSITIVE_MARKET_KEYWORDS = [
	"growth", "growing", "expanding", "surge", "record", "opportunity", "bull",
	"investment up", "funding up", "vc activity", "strong demand",
];

const NEGATIVE_MARKET_KEYWORDS = [
	"regulation", "ban", "restrict", "contraction", "decline", "downturn",
	"slowdown", "bear", "headwind", "risk", "uncertainty", "layoff", "crisis",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lowerText(result: MonitoringSearchResult): string {
	return `${result.title} ${result.snippet}`.toLowerCase();
}

function assessImpact(text: string): MonitoringEventImpact {
	const lower = text.toLowerCase();
	for (const kw of HIGH_IMPACT_KEYWORDS) {
		if (lower.includes(kw)) return "high";
	}
	for (const kw of MEDIUM_IMPACT_KEYWORDS) {
		if (lower.includes(kw)) return "medium";
	}
	return "low";
}

/** Extracts a short event description: title trimmed to 120 chars. */
function shortEvent(result: MonitoringSearchResult): string {
	return result.title.trim().slice(0, 120);
}

/**
 * Attempt to resolve company name from result textand known competitor list.
 * Returns the first known competitor whose name appears in title/snippet,
 * or falls back to extracting the subject token from the title.
 */
function resolveCompanyName(
	result: MonitoringSearchResult,
	competitorNames: string[]
): string {
	// Check known competitor names first (case-insensitive)
	const lower = lowerText(result);
	for (const comp of competitorNames) {
		if (comp && lower.includes(comp.toLowerCase())) {
			return comp;
		}
	}
	// Fall back: first word-cluster of title (up to first comma/dash/colon)
	const titleSubject = result.title.split(/[,\-:|]/)[0]?.trim();
	return titleSubject?.slice(0, 60) ?? "Unknown";
}

function classifyCompanyEventCategory(text: string): CompanyEvent["category"] {
	const lower = text.toLowerCase();
	for (const kw of LEGAL_KEYWORDS) {
		if (lower.includes(kw)) return "legal";
	}
	for (const kw of FUNDING_KEYWORDS) {
		if (lower.includes(kw)) return "funding";
	}
	for (const kw of PRODUCT_KEYWORDS) {
		if (lower.includes(kw)) return "product";
	}
	return "press";
}

function classifyMarketDirection(text: string): MarketEvent["direction"] {
	const lower = text.toLowerCase();
	let posScore = 0;
	let negScore = 0;
	for (const kw of POSITIVE_MARKET_KEYWORDS) {
		if (lower.includes(kw)) posScore++;
	}
	for (const kw of NEGATIVE_MARKET_KEYWORDS) {
		if (lower.includes(kw)) negScore++;
	}
	if (negScore > posScore) return "negative";
	if (posScore > negScore) return "positive";
	return "neutral";
}

// ─── Per-bucket classifiers ───────────────────────────────────────────────────

function classifyCompetitorBucket(
	results: MonitoringSearchResult[],
	competitorNames: string[]
): CompetitorEvent[] {
	return results.map((result): CompetitorEvent => ({
		company: resolveCompanyName(result, competitorNames),
		event: shortEvent(result),
		impact: assessImpact(lowerText(result)),
		evidence_urls: [result.url],
	}));
}

function classifyCompanyBucket(results: MonitoringSearchResult[]): CompanyEvent[] {
	return results.map((result): CompanyEvent => {
		const text = lowerText(result);
		return {
			event: shortEvent(result),
			category: classifyCompanyEventCategory(text),
			impact: assessImpact(text),
			evidence_urls: [result.url],
		};
	});
}

function classifyMarketBucket(
	results: MonitoringSearchResult[],
	sector: string | null
): MarketEvent[] {
	return results.map((result): MarketEvent => {
		const text = lowerText(result);
		return {
			description: shortEvent(result),
			sector: sector ?? "Technology",
			direction: classifyMarketDirection(text),
			evidence_urls: [result.url],
		};
	});
}

function classifyFounderBucket(
	results: MonitoringSearchResult[],
	founderNames: string[]
): FounderSignal[] {
	return results.map((result): FounderSignal => {
		const lower = lowerText(result);
		// Try to resolve the specific founder whose name appears in the result.
		let name = "Unknown";
		for (const fn of founderNames) {
			if (fn && lower.includes(fn.toLowerCase())) {
				name = fn;
				break;
			}
		}
		if (name === "Unknown" && founderNames.length > 0) {
			name = founderNames[0]!;
		}
		return {
			name,
			signal: shortEvent(result),
			impact: assessImpact(lower),
			evidence_urls: [result.url],
		};
	});
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ClassifiedMonitoringEvents {
	competitor_events: CompetitorEvent[];
	market_events: MarketEvent[];
	company_events: CompanyEvent[];
	founder_signals: FounderSignal[];
}

/**
 * Classify raw monitoring search buckets into typed DealRiskRadarV1 event arrays.
 *
 * Each search result maps to exactly one event entry.  Deduplication is handled
 * separately in dedupe-monitoring-events.ts.
 *
 * @param buckets      Raw search result buckets from runMonitoringSearches()
 * @param context      Context used to resolve competitor/founder names
 * @returns            Classified event arrays (not yet deduplicated)
 */
export function classifyMonitoringSignals(
	buckets: MonitoringSearchBucket[],
	context: { competitor_names: string[]; founder_names: string[]; sector: string | null }
): ClassifiedMonitoringEvents {
	const getBucketResults = (key: MonitoringSearchBucket["bucket"]): MonitoringSearchResult[] =>
		buckets.find((b) => b.bucket === key)?.results ?? [];

	const competitor_events = classifyCompetitorBucket(
		getBucketResults("competitor_signals"),
		context.competitor_names
	);

	const company_events = classifyCompanyBucket(
		getBucketResults("company_signals")
	);

	const market_events = classifyMarketBucket(
		getBucketResults("market_signals"),
		context.sector
	);

	const founder_signals = classifyFounderBucket(
		getBucketResults("founder_team_signals"),
		context.founder_names
	);

	return { competitor_events, market_events, company_events, founder_signals };
}
