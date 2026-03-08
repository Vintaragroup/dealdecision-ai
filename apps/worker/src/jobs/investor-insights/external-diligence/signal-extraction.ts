/**
 * PR36.2 — External Due Diligence: Signal Extraction
 *
 * Deterministic, schema-based signal extraction from filtered Tavily results.
 * Produces typed BucketSignal structs per bucket — no LLM, no I/O.
 *
 * Each extractor:
 *   - Takes the filtered ExternalSearchResult[] for one bucket
 *   - Returns a typed signal struct with a one-sentence human summary
 *   - Falls back gracefully when results are empty/unhelpful
 *
 * Design principles:
 *   - Conservative: only assert what can be reasonably inferred from text
 *   - No hallucination: use "unknown" rather than guessing
 *   - Deterministic: same input always produces same output
 */

import type { ExternalSearchResult } from "./external-diligence-schema";
import type {
	CompanyFootprintSignal,
	CompetitiveLandscapeSignal,
	MarketOutlookSignal,
	FounderTeamSignal,
	FinancialContextSignal,
	ExternalRisksSignal,
	BucketSignal,
} from "./external-diligence-schema";

// ─── Utility helpers ──────────────────────────────────────────────────────────

function getDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return url.toLowerCase().slice(0, 60);
	}
}

function combinedText(results: ExternalSearchResult[]): string {
	return results.map((r) => `${r.title} ${r.snippet}`).join(" ").toLowerCase();
}

function mentionsAny(text: string, terms: string[]): boolean {
	return terms.some((t) => text.includes(t.toLowerCase()));
}

/** Extract unique proper-noun-like phrases that appear near competitor signals */
function extractCompetitorNames(results: ExternalSearchResult[], companyName: string | null): string[] {
	const names: Set<string> = new Set();
	const companyLower = companyName?.toLowerCase() ?? "";

	// Pattern: "vs.", "alternative to", "competitor", "compared to", "like [Name]"
	const VS_RE = /\bvs\.?\s+([A-Z][A-Za-z0-9\-&]{1,30})\b/g;
	const ALT_RE = /\balternatives?\s+(?:to\s+)?([A-Z][A-Za-z0-9\-&]{1,30})\b/g;
	const COMP_RE = /\bcompetitors?\s+(?:include|are|like)\s+([A-Z][A-Za-z0-9\-&]{1,30})\b/g;
	const LIKE_RE = /\btools?\s+(?:like|such as)\s+([A-Z][A-Za-z0-9\-&]{1,30})\b/g;

	for (const r of results) {
		const text = `${r.title} ${r.snippet}`;
		for (const re of [VS_RE, ALT_RE, COMP_RE, LIKE_RE]) {
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(text)) !== null) {
				const name = m[1]!.trim();
				if (name.toLowerCase() !== companyLower && name.length > 2) {
					names.add(name);
				}
			}
		}
	}

	return Array.from(names).slice(0, 6);
}

/** Extract growth/direction keywords from a snippet corpus */
function classifyMarketDirection(
	text: string
): "growing" | "flat" | "declining" | "mixed" | "unknown" {
	const growthTerms = ["growing", "growth", "expand", "increasing", "surge", "boom", "rise", "uptick", "CAGR", "accelerat"];
	const declineTerms = ["declining", "shrinking", "contraction", "slowdown", "decrease", "saturat", "headwind", "struggling"];
	const flatTerms = ["stagnant", "stable", "plateau", "flat"];

	const growthCount = growthTerms.filter((t) => text.includes(t.toLowerCase())).length;
	const declineCount = declineTerms.filter((t) => text.includes(t.toLowerCase())).length;
	const flatCount = flatTerms.filter((t) => text.includes(t.toLowerCase())).length;

	if (growthCount === 0 && declineCount === 0 && flatCount === 0) return "unknown";
	if (growthCount >= 2 && declineCount === 0) return "growing";
	if (declineCount >= 2 && growthCount === 0) return "declining";
	if (flatCount >= 2 && growthCount === 0 && declineCount === 0) return "flat";
	if (growthCount > 0 && declineCount > 0) return "mixed";
	if (growthCount > declineCount) return "growing";
	if (declineCount > growthCount) return "declining";
	return "mixed";
}

/** Extract tailwind phrases from text */
function extractTailwinds(text: string): string[] {
	const patterns = [
		/(?:driven by|fueled by|boosted by|supported by)\s+([^.]{10,60}?)(?:\.|,)/gi,
		/(?:tailwind|growth driver|growth factor)[\s:]+([^.]{10,60}?)(?:\.|,)/gi,
	];
	const found: string[] = [];
	for (const re of patterns) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null && found.length < 3) {
			const phrase = m[1]!.trim().replace(/\s+/g, " ");
			if (phrase.length >= 10 && phrase.length <= 80) found.push(phrase);
		}
	}
	return found;
}

/** Extract headwind phrases from text */
function extractHeadwinds(text: string): string[] {
	const patterns = [
		/(?:headwind|challenge|barrier|risk|concern|obstacle)[\s:]+([^.]{10,60}?)(?:\.|,)/gi,
		/(?:faces|hampered by|hindered by)\s+([^.]{10,60}?)(?:\.|,)/gi,
	];
	const found: string[] = [];
	for (const re of patterns) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null && found.length < 3) {
			const phrase = m[1]!.trim().replace(/\s+/g, " ");
			if (phrase.length >= 10 && phrase.length <= 80) found.push(phrase);
		}
	}
	return found;
}

// ─── Per-bucket extractors ────────────────────────────────────────────────────

/**
 * Company Footprint: Does the company have a verifiable public presence?
 */
export function extractCompanyFootprintSignal(
	results: ExternalSearchResult[],
	companyName: string | null
): CompanyFootprintSignal {
	if (results.length === 0) {
		return {
			kind: "company_footprint",
			website_found: false,
			funding_profile_found: false,
			press_found: false,
			footprint_quality: "none",
			summary: "No public footprint found — company may have limited external presence.",
		};
	}

	const companySlug = companyName?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
	const text = combinedText(results);

	const PRESS_DOMAINS = ["techcrunch.com", "bloomberg.com", "reuters.com", "businesswire.com",
		"prnewswire.com", "venturebeat.com", "axios.com", "wsj.com", "ft.com", "theinformation.com"];
	const FUNDING_DOMAINS = ["crunchbase.com", "pitchbook.com", "cbinsights.com"];

	const website_found =
		companySlug.length > 3 &&
		results.some((r) => getDomain(r.url).includes(companySlug) || r.url.toLowerCase().includes(companySlug));
	const funding_profile_found =
		results.some((r) => FUNDING_DOMAINS.some((d) => getDomain(r.url).includes(d))) ||
		mentionsAny(text, ["raised", "funding round", "seed round", "series a", "valuation"]);
	const press_found = results.some((r) => PRESS_DOMAINS.some((d) => getDomain(r.url).includes(d)));

	const signalCount = [website_found, funding_profile_found, press_found].filter(Boolean).length;
	const footprint_quality: CompanyFootprintSignal["footprint_quality"] =
		signalCount >= 3 ? "strong" :
		signalCount === 2 ? "moderate" :
		signalCount === 1 ? "weak" : "none";

	const companyLabel = companyName ?? "Company";
	const summary =
		footprint_quality === "strong"
			? `${companyLabel} has a strong public presence with website, funding profile, and press coverage found.`
			: footprint_quality === "moderate"
			? `${companyLabel} has moderate public footprint: ${[website_found && "website", funding_profile_found && "funding profile", press_found && "press coverage"].filter(Boolean).join(", ")} found.`
			: footprint_quality === "weak"
			? `${companyLabel} has limited public footprint — only partial signals found.`
			: `No public footprint found for ${companyLabel}.`;

	return { kind: "company_footprint", website_found, funding_profile_found, press_found, footprint_quality, summary };
}

/**
 * Competitive Landscape: Who are the real competitors?
 */
export function extractCompetitiveLandscapeSignal(
	results: ExternalSearchResult[],
	companyName: string | null,
	sector: string | null
): CompetitiveLandscapeSignal {
	if (results.length === 0) {
		return {
			kind: "competitive_landscape",
			direct_competitor_names: [],
			adjacent_names: [],
			category_fragmentation: "unknown",
			competitive_intensity: "unknown",
			summary: "No external competitive landscape data found.",
		};
	}

	const text = combinedText(results);
	const allNames = extractCompetitorNames(results, companyName);

	// Direct competitors: appear in direct comparison context
	const VS_DIRECT_RE = /\bvs\.?\s+([A-Z][A-Za-z0-9\-&]{1,30})\b/gi;
	const directFromVs: Set<string> = new Set();
	let m: RegExpExecArray | null;
	for (const r of results) {
		VS_DIRECT_RE.lastIndex = 0;
		while ((m = VS_DIRECT_RE.exec(`${r.title} ${r.snippet}`)) !== null) {
			const name = m[1]!.trim();
			if ((companyName ? name.toLowerCase() !== companyName.toLowerCase() : true) && name.length > 2) {
				directFromVs.add(name);
			}
		}
	}

	const direct_competitor_names = Array.from(directFromVs).slice(0, 4);
	const adjacent_names = allNames.filter((n) => !directFromVs.has(n)).slice(0, 4);

	// Fragmentation: many competitors = fragmented; few big names = consolidated
	const totalNames = direct_competitor_names.length + adjacent_names.length;
	const category_fragmentation: CompetitiveLandscapeSignal["category_fragmentation"] =
		totalNames >= 5 ? "fragmented" :
		totalNames >= 2 ? "consolidated" :
		mentionsAny(text, ["emerging", "nascent", "new market", "early stage"]) ? "emerging" : "unknown";

	const competitive_intensity: CompetitiveLandscapeSignal["competitive_intensity"] =
		totalNames >= 5 ? "high" :
		totalNames >= 2 ? "medium" :
		totalNames >= 1 ? "low" : "unknown";

	const sectorLabel = sector ?? "the category";
	const summary =
		direct_competitor_names.length > 0
			? `${direct_competitor_names.slice(0, 3).join(", ")} are among the key players in ${sectorLabel}. Category appears ${category_fragmentation}.`
			: adjacent_names.length > 0
			? `Found ${adjacent_names.slice(0, 2).join(", ")} as adjacent alternatives. Direct competitor landscape is unclear.`
			: "No specific competitor names extracted — category may be emerging or poorly indexed.";

	return { kind: "competitive_landscape", direct_competitor_names, adjacent_names, category_fragmentation, competitive_intensity, summary };
}

/**
 * Market Outlook: Is the category growing, flat, or declining?
 */
export function extractMarketOutlookSignal(
	results: ExternalSearchResult[],
	sector: string | null
): MarketOutlookSignal {
	if (results.length === 0) {
		return {
			kind: "market_outlook",
			direction: "unknown",
			tailwinds: [],
			headwinds: [],
			summary: "No external market outlook data found.",
		};
	}

	const text = combinedText(results);
	const direction = classifyMarketDirection(text);
	const tailwinds = extractTailwinds(text);
	const headwinds = extractHeadwinds(text);

	const sectorLabel = sector ?? "the market";
	const summary =
		direction === "growing"
			? `${sectorLabel} appears to be growing based on external research signals.${tailwinds.length > 0 ? ` Key tailwinds: ${tailwinds[0]}.` : ""}`
			: direction === "declining"
			? `${sectorLabel} shows signs of decline or saturation based on external signals.`
			: direction === "flat"
			? `${sectorLabel} appears relatively stable with limited growth signals.`
			: direction === "mixed"
			? `${sectorLabel} shows mixed signals — both growth tailwinds and headwinds found.`
			: `Insufficient data to characterise the ${sectorLabel} market direction.`;

	return { kind: "market_outlook", direction, tailwinds, headwinds, summary };
}

/**
 * Founder / Team Signals: What public evidence exists for the founder?
 */
export function extractFounderTeamSignal(
	results: ExternalSearchResult[],
	founderName: string | null,
	companyName: string | null
): FounderTeamSignal {
	if (results.length === 0) {
		return {
			kind: "founder_team_signals",
			profile_found: false,
			prior_role_found: false,
			credibility_signals: [],
			limited_footprint: true,
			summary: "No founder or team signals found publicly.",
		};
	}

	const text = combinedText(results);
	const founderLower = founderName?.toLowerCase() ?? "";
	const companyLower = companyName?.toLowerCase() ?? "";

	// Profile found: founder name appears in a result title or URL
	const profile_found = founderName
		? results.some(
			(r) =>
				r.title.toLowerCase().includes(founderLower) ||
				r.url.toLowerCase().includes(founderLower.replace(/\s+/g, ""))
		)
		: results.some((r) => /\b(founder|ceo|co-founder|cto)\b/i.test(r.title));

	// Prior role: hint of previous employer
	const prior_role_found = mentionsAny(text, [
		"previously at", "formerly", "prior to", "before founding", "co-founded",
		"alumnus", "alumna", "ex-", "previously worked",
	]);

	// Credibility signals: known brands, exits, awards
	const CREDIBILITY_TERMS = [
		"YC", "Y Combinator", "Sequoia", "a16z", "TechCrunch 50", "Forbes 30 Under 30",
		"acquired by", "exit", "IPO", "Google", "Amazon", "Microsoft", "Meta", "Apple",
		"McKinsey", "Goldman", "Harvard", "MIT", "Stanford",
	];
	const credibility_signals = CREDIBILITY_TERMS.filter((t) =>
		text.toLowerCase().includes(t.toLowerCase())
	).slice(0, 4);

	// Limited footprint: no meaningful signals
	const limited_footprint = !profile_found && credibility_signals.length === 0 && !prior_role_found;

	const targetLabel = founderName ?? (companyName ? `${companyName} founder` : "Founder");
	const summary =
		limited_footprint
			? `No meaningful public footprint found for ${targetLabel}.`
			: profile_found && credibility_signals.length > 0
			? `${targetLabel} has a public profile with credibility signals: ${credibility_signals.slice(0, 2).join(", ")}.`
			: profile_found
			? `${targetLabel} has a public profile.${prior_role_found ? " Prior role evidence found." : ""}`
			: `Partial founder signals found — ${prior_role_found ? "prior role evidence present" : "no direct profile found"}.`;

	return { kind: "founder_team_signals", profile_found, prior_role_found, credibility_signals, limited_footprint, summary };
}

/**
 * Financial Context: Does the raise/stage look typical vs. market benchmarks?
 */
export function extractFinancialContextSignal(
	results: ExternalSearchResult[],
	sector: string | null
): FinancialContextSignal {
	if (results.length === 0) {
		return {
			kind: "financial_context",
			raise_level: "unknown",
			funding_environment: "unknown",
			summary: "No external financial context data found.",
		};
	}

	const text = combinedText(results);

	// Funding environment
	const funding_environment: FinancialContextSignal["funding_environment"] =
		mentionsAny(text, ["funding activity", "active market", "investment surge", "record funding", "strong deal flow", "investor appetite"])
			? "supportive"
			: mentionsAny(text, ["funding slowdown", "funding drought", "valuation correction", "down round", "reduced investment", "cautious investors"])
			? "weak"
			: mentionsAny(text, ["selective", "disciplined", "cautious but", "steady", "moderate funding"])
			? "selective"
			: "unknown";

	// Raise level (relative to benchmarks mentioned)
	const raise_level: FinancialContextSignal["raise_level"] =
		mentionsAny(text, ["above average", "premium valuation", "above market", "unicorn territory"])
			? "above_benchmark"
			: mentionsAny(text, ["below average", "bootstrap", "lean raise", "conservative valuation", "underfunded"])
			? "below_benchmark"
			: mentionsAny(text, ["typical", "average", "standard", "median", "in-line"])
			? "typical"
			: "unknown";

	const sectorLabel = sector ?? "the sector";
	const summary =
		funding_environment !== "unknown" && raise_level !== "unknown"
			? `Funding environment for ${sectorLabel} is ${funding_environment}. Raise level appears ${raise_level} vs. benchmarks.`
			: funding_environment !== "unknown"
			? `Funding environment for ${sectorLabel} is ${funding_environment}.`
			: raise_level !== "unknown"
			? `Raise level appears ${raise_level} relative to available benchmarks.`
			: `Insufficient benchmark data to assess raise/funding context for ${sectorLabel}.`;

	return { kind: "financial_context", raise_level, funding_environment, summary };
}

/**
 * External Risks: What public risks or concerns should investors know?
 */
export function extractExternalRisksSignal(
	results: ExternalSearchResult[],
	companyName: string | null
): ExternalRisksSignal {
	if (results.length === 0) {
		return {
			kind: "external_risks",
			risk_signals: [],
			has_regulatory_concern: false,
			has_reputation_concern: false,
			summary: "No external risk signals found.",
		};
	}

	const text = combinedText(results);

	const has_regulatory_concern = mentionsAny(text, [
		"regulatory", "compliance", "lawsuit", "litigation", "fined", "penalty",
		"banned", "investigation", "SEC", "FTC", "GDPR violation", "antitrust",
	]);

	const has_reputation_concern = mentionsAny(text, [
		"scandal", "controversy", "backlash", "accused", "fraud", "layoff",
		"fired", "resigned", "mismanagement", "data breach", "outage",
	]);

	// Extract short risk signal descriptions from snippets
	const RISK_PATTERNS: RegExp[] = [
		/\b(regulatory\s+\w+(?:\s+\w+)?)\b/gi,
		/\b(lawsuit\s+(?:against|filed|over)[^.]{0,40})\b/gi,
		/\b(data breach[^.]{0,40})\b/gi,
		/\b(controversy\s+(?:over|around|about)\s+[^.]{0,40})\b/gi,
	];

	const risk_signals: string[] = [];
	for (const re of RISK_PATTERNS) {
		re.lastIndex = 0;
		const m = re.exec(text);
		if (m?.[1] && risk_signals.length < 4) {
			const signal = m[1].trim().slice(0, 80);
			if (!risk_signals.includes(signal)) risk_signals.push(signal);
		}
	}

	const companyLabel = companyName ?? "Company";
	const summary =
		risk_signals.length === 0 && !has_regulatory_concern && !has_reputation_concern
			? `No significant external risk signals found for ${companyLabel}.`
			: [
				has_regulatory_concern && "Regulatory concerns present.",
				has_reputation_concern && "Reputational signals present.",
				risk_signals.length > 0 && `Signals: ${risk_signals.slice(0, 2).join("; ")}.`,
			].filter(Boolean).join(" ");

	return { kind: "external_risks", risk_signals, has_regulatory_concern, has_reputation_concern, summary };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Run the appropriate signal extractor for a given bucket.
 *
 * Returns null when results are empty (signal absent = no card shown in UI).
 */
export function extractBucketSignal(
	bucketKey: string,
	results: ExternalSearchResult[],
	context: {
		companyName: string | null;
		sector: string | null;
		founderName: string | null;
	}
): BucketSignal | null {
	// Never return a signal for empty buckets
	if (results.length === 0) return null;

	switch (bucketKey) {
		case "company_footprint":
			return extractCompanyFootprintSignal(results, context.companyName);
		case "competitive_landscape":
			return extractCompetitiveLandscapeSignal(results, context.companyName, context.sector);
		case "market_outlook":
			return extractMarketOutlookSignal(results, context.sector);
		case "founder_team_signals":
			return extractFounderTeamSignal(results, context.founderName, context.companyName);
		case "financial_context":
			return extractFinancialContextSignal(results, context.sector);
		case "external_risks":
			return extractExternalRisksSignal(results, context.companyName);
		default:
			return null;
	}
}
