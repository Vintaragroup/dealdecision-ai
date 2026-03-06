/**
 * PR35 — External Due Diligence: Query Plan Builder
 *
 * Derives the 6 Tavily query strings from InsightSlotInputs and an optional
 * deal name.  Pure function — no I/O, no Tavily calls.
 *
 * Query buckets (MAX_QUERIES=6):
 *   1. company_overview
 *   2. competitors
 *   3. market_trends
 *   4. company_news
 *   5. founder_team_signals
 *   6. financial_market_context
 */

import type { InsightSlotInputs } from "../stages/stage-2-deterministic";
import type {
	ExternalDiligenceQueryPlan,
	ExternalDiligenceBucketKey,
} from "./external-diligence-schema";

// ─── Extraction helpers ───────────────────────────────────────────────────────

/**
 * Attempt to extract the company name from the raw DPU page text.
 *
 * Strategy:
 *   1. Look for "Company: <Name>" or "About <Name>" patterns.
 *   2. Scan for a title-cased two-or-three word sequence on the very first page.
 *   3. Fall back to dealName if provided.
 *
 * Returns null if nothing found.
 */
function extractCompanyNameFromPages(
	pages: InsightSlotInputs["dpuPages"],
	dealName?: string | null
): string | null {
	// Pattern A: explicit label
	const LABEL_RE =
		/(?:^|\n)\s*(?:Company|About|Introducing)\s*[:\-]\s*([A-Z][A-Za-z0-9&\-.,\s]{1,40}?)(?:\n|$)/m;
	// Pattern B: possessive brand marker ("___ is a ..." or "___ provides ...")
	const IS_A_RE =
		/^([A-Z][A-Za-z0-9&\-.]{1,35})\s+(?:is|are|provides?|offers?|enables?|helps?)\b/m;

	for (const page of pages.slice(0, 5)) {
		const text = page.text ?? "";
		const mLabel = LABEL_RE.exec(text);
		if (mLabel?.[1]) {
			return mLabel[1].trim().replace(/\s{2,}/g, " ").slice(0, 60);
		}
		const mIsA = IS_A_RE.exec(text);
		if (mIsA?.[1]) {
			return mIsA[1].trim().slice(0, 60);
		}
	}
	return dealName?.trim() ?? null;
}

/**
 * Attempt to extract a sector/industry signal from DPU page text.
 *
 * Looks for: "industry: X", "sector: X", "vertical: X", "We are in the X market"
 * Returns at most 40 characters.
 */
function extractSectorFromPages(
	pages: InsightSlotInputs["dpuPages"]
): string | null {
	const SECTOR_LABEL_RE =
		/(?:^|\n)\s*(?:industry|sector|vertical|market(?:\s+segment)?)\s*[:\-]\s*([A-Za-z][A-Za-z0-9\/\- &]{1,40}?)(?:\n|$)/im;
	const WE_ARE_RE =
		/\bwe(?:'re|\s+are)\b[^.]{0,30}\b(?:in\s+the|a)\b\s+([A-Za-z][A-Za-z0-9\/\- &]{1,40}?)\s+(?:market|space|industry|sector)\b/i;

	for (const page of pages.slice(0, 10)) {
		const text = page.text ?? "";
		const mLabel = SECTOR_LABEL_RE.exec(text);
		if (mLabel?.[1]) {
			return mLabel[1].trim().replace(/\s{2,}/g, " ").slice(0, 40);
		}
		const mWeAre = WE_ARE_RE.exec(text);
		if (mWeAre?.[1]) {
			return mWeAre[1].trim().replace(/\s{2,}/g, " ").slice(0, 40);
		}
	}
	return null;
}

/**
 * Attempt to extract a founder name from DPU page text.
 *
 * Looks for: "Founder: <Name>", "CEO: <Name>", "Co-Founder: <Name>"
 * Returns the first match as "FirstName LastName" (max 2 words).
 */
function extractFounderNameFromPages(
	pages: InsightSlotInputs["dpuPages"]
): string | null {
	const FOUNDER_RE =
		/(?:^|\n)\s*(?:Founder|Co-?Founder|CEO|Founding\s+Partner)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\n|[,;]|$)/m;

	for (const page of pages.slice(0, 10)) {
		const text = page.text ?? "";
		const m = FOUNDER_RE.exec(text);
		if (m?.[1]) {
			// Return at most first two words (first + last name)
			const words = m[1].trim().split(/\s+/).slice(0, 2);
			return words.join(" ");
		}
	}
	return null;
}

// ─── Query builders ───────────────────────────────────────────────────────────

function buildCompanyOverviewQuery(name: string): string {
	return `"${name}" company overview startup product`;
}

function buildCompetitorsQuery(name: string, sector: string | null): string {
	const sectorPart = sector ? ` ${sector}` : "";
	return `"${name}" competitors alternatives${sectorPart} market`;
}

function buildMarketTrendsQuery(sector: string | null, name: string): string {
	const base = sector ?? name;
	return `${base} market trends industry 2025`;
}

function buildCompanyNewsQuery(name: string): string {
	return `"${name}" news announcement funding 2024 2025`;
}

function buildFounderTeamQuery(
	founderName: string | null,
	companyName: string
): string {
	if (founderName) {
		return `"${founderName}" founder CEO background entrepreneur startup`;
	}
	return `"${companyName}" founder CEO leadership team background`;
}

function buildFinancialMarketContextQuery(
	sector: string | null,
	name: string
): string {
	const base = sector ?? `${name} startup`;
	return `${base} investment valuation benchmarks deal flow 2025`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the Tavily query plan from deal inputs.
 *
 * Returns an ExternalDiligenceQueryPlan with 6 pre-built query strings (one per
 * bucket) plus the extracted company/sector/founder signals used to build them.
 *
 * Pure function — safe to call in unit tests without any mocks.
 */
export function buildExternalDiligenceQueryPlan(
	inputs: InsightSlotInputs,
	dealName?: string | null
): ExternalDiligenceQueryPlan {
	const companyName = extractCompanyNameFromPages(inputs.dpuPages, dealName);
	const sector = extractSectorFromPages(inputs.dpuPages);
	const founderName = extractFounderNameFromPages(inputs.dpuPages);

	// Fallback company label when nothing was detected
	const companyLabel = companyName ?? "this company";

	const queries: Record<ExternalDiligenceBucketKey, string> = {
		company_overview: buildCompanyOverviewQuery(companyLabel),
		competitors: buildCompetitorsQuery(companyLabel, sector),
		market_trends: buildMarketTrendsQuery(sector, companyLabel),
		company_news: buildCompanyNewsQuery(companyLabel),
		founder_team_signals: buildFounderTeamQuery(founderName, companyLabel),
		financial_market_context: buildFinancialMarketContextQuery(sector, companyLabel),
	};

	return {
		company_name: companyName,
		sector,
		founder_name: founderName,
		queries,
	};
}
