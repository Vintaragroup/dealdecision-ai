/**
 * PR35 / PR36.2 / PR36.4 — External Due Diligence: Query Plan Builder
 *
 * Derives 6 Tavily BucketQuerySpecs from InsightSlotInputs, optional deal name,
 * and optional canonical fields body.
 *
 * PR36.2 changes:
 *   - Renamed bucket keys to investor-grade purposes
 *   - Each bucket now produces a BucketQuerySpec
 *   - Queries seeded from company name, sector, founder, raise round
 *   - Added product_category extraction for competitive/market queries
 *   - Added canonicalFieldsBody parsing
 *   - Added domain exclusions per-bucket
 *
 * PR36.4 changes (Query Planner Hardening):
 *   - Company name normalization via normalizeCompanyName() — strips "Inc.", "LLC", ".ai", etc.
 *   - Entity-anchored queries via buildCompanyEntityQuery() — always quoted for entity resolution
 *   - Category inference delegated to inferProductCategory() with keyword + sector heuristics,
 *     which prevents company name from leaking into market/competitor queries as the base term
 *   - Improved competitor queries: quoted category-seeded forms ("X" competitors alternatives)
 *   - Improved market queries: never fall back to bare company name as market base
 *   - Improved founder queries: entity-anchored with company name for disambiguation
 *   - Improved news/risk queries: launch + announcement focus, not just generic "news"
 *
 * Query buckets (MAX_QUERIES=6):
 *   1. company_footprint       — verifiable public presence, funding profile, press
 *   2. competitive_landscape   — direct and adjacent competitors in the product category
 *   3. market_outlook          — category-specific direction, tailwinds, headwinds
 *   4. founder_team_signals    — founder public profile and credibility
 *   5. financial_context       — stage/sector raise benchmarks
 *   6. external_risks          — recent company-specific news and risk signals
 *
 * Pure function — no I/O, no Tavily calls.
 */

import type { InsightSlotInputs } from "../stages/stage-2-deterministic";
import type {
	ExternalDiligenceQueryPlan,
	ExternalDiligenceBucketKey,
	BucketQuerySpec,
} from "./external-diligence-schema";
import {
	normalizeCompanyName,
	buildCompanyEntityQuery,
	buildFounderEntityQuery,
} from "./query-entity-utils";
import { inferProductCategory } from "./infer-product-category";

// ─── Shared noise domain exclusions ──────────────────────────────────────────

const GENERIC_NOISE_EXCLUDES: string[] = [
	"quora.com", "reddit.com", "answers.yahoo.com", "stackoverflow.com",
	"ehow.com", "wikihow.com", "about.com", "investopedia.com",
];

const JOB_BOARD_EXCLUDES: string[] = [
	"indeed.com", "glassdoor.com", "linkedin.com/jobs", "wellfound.com/jobs",
	"boards.greenhouse.io", "jobs.lever.co", "ziprecruiter.com",
];

// ─── Extraction helpers ───────────────────────────────────────────────────────

/**
 * Attempt to extract the company name from the raw DPU page text.
 *
 * Strategy:
 *   1. Look for "Company: <Name>", "About <Name>", or "Introducing <Name>".
 *   2. Look for possessive brand marker ("XXX is a ...").
 *   3. Fall back to dealName if provided.
 */
function extractCompanyNameFromPages(
	pages: InsightSlotInputs["dpuPages"],
	dealName?: string | null
): string | null {
	const LABEL_RE =
		/(?:^|\n)\s*(?:Company|About|Introducing)\s*[:\-]\s*([A-Z][A-Za-z0-9&\-.,\s]{1,40}?)(?:\n|$)/m;
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

// extractProductCategoryFromPages has been superseded by inferProductCategory()
// from ./infer-product-category, which adds keyword heuristics + sector mapping.
// See PR36.4.

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
			const words = m[1].trim().split(/\s+/).slice(0, 2);
			return words.join(" ");
		}
	}
	return null;
}

/**
 * Extract raise_round from a canonical fields body string.
 *
 * Format: "field=raise_round value=Seed ..."
 */
function extractRaiseRoundFromCanonical(canonicalFieldsBody: string | null): string | null {
	if (!canonicalFieldsBody) return null;
	const m = /field=raise_round\s+value=([^\s]+)/.exec(canonicalFieldsBody);
	if (m?.[1] && m[1] !== "null" && m[1] !== "N/A") return m[1].trim();
	return null;
}

/**
 * Extract sector from canonical fields body as a fallback.
 */
function extractSectorFromCanonical(canonicalFieldsBody: string | null): string | null {
	if (!canonicalFieldsBody) return null;
	const m = /field=(?:sector|industry|vertical)\s+value=([^\s]+(?:\s+[^\s]+)?)/.exec(canonicalFieldsBody);
	if (m?.[1] && m[1] !== "null" && m[1] !== "N/A") return m[1].trim().slice(0, 40);
	return null;
}

// ─── Query builders (PR36.4 hardened) ────────────────────────────────────────

/**
 * Company Footprint — find public presence, product pages, funding profiles.
 *
 * PR36.4: uses entity-anchored query with quoted company name + funding signals.
 */
function buildCompanyFootprintQuery(name: string): BucketQuerySpec {
	return {
		query: buildCompanyEntityQuery(name, "footprint"),
		topic: "general",
		excludeDomains: [...GENERIC_NOISE_EXCLUDES, ...JOB_BOARD_EXCLUDES],
	};
}

/**
 * Competitive Landscape — find direct and adjacent competitors.
 *
 * PR36.4: category is now always quoted for exact-phrase matching.
 * Competitor query uses "X" competitors alternatives when category is known,
 * which surfaces software comparison pages rather than generic market research.
 * Falls back to entity-anchored company query only when category is null.
 */
function buildCompetitiveLandscapeQuery(
	name: string,
	productCategory: string | null
): BucketQuerySpec {
	const query = productCategory
		? `"${productCategory}" competitors alternatives tools`
		: `"${name}" competitors alternatives similar tools`;

	return {
		query,
		topic: "general",
		excludeDomains: [...GENERIC_NOISE_EXCLUDES, ...JOB_BOARD_EXCLUDES],
	};
}

/**
 * Market Outlook — find growth rate, CAGR, tailwinds, headwinds for the category.
 *
 * PR36.4: never falls back to bare company name as the market base.
 * When only company name is available, emits a generic "software market growth"
 * query which is still more useful than "DealDecisionAI market size growth".
 */
function buildMarketOutlookQuery(
	sector: string | null,
	productCategory: string | null
): BucketQuerySpec {
	let query: string;
	if (productCategory) {
		query = `"${productCategory}" market size growth 2025`;
	} else if (sector) {
		query = `${sector} market growth outlook 2025`;
	} else {
		query = "software startup market growth outlook 2025";
	}

	return {
		query,
		topic: "general",
		excludeDomains: GENERIC_NOISE_EXCLUDES,
	};
}

/**
 * Founder / Team Signals — find public biography, prior roles, credibility signals.
 *
 * PR36.4: uses buildFounderEntityQuery() when a founder name is available,
 * which adds the company name as a disambiguator for common names.
 * Falls back to entity-anchored company founder query.
 */
function buildFounderTeamQuery(
	founderName: string | null,
	companyName: string
): BucketQuerySpec {
	const query = founderName
		? buildFounderEntityQuery(founderName, companyName)
		: buildCompanyEntityQuery(companyName, "founder");

	return {
		query,
		topic: "general",
		excludeDomains: [...GENERIC_NOISE_EXCLUDES, ...JOB_BOARD_EXCLUDES],
	};
}

/**
 * Financial Context — stage and sector funding benchmarks.
 *
 * PR36.4: sector now quoted when present to improve precision.
 */
function buildFinancialContextQuery(
	sector: string | null,
	raiseRound: string | null,
	name: string
): BucketQuerySpec {
	const sectorStr = sector ? `"${sector}"` : `"${name}" startup`;
	const query = raiseRound
		? `${sectorStr} ${raiseRound} funding benchmark valuation 2025`
		: `${sectorStr} seed funding benchmark valuation 2025`;

	return {
		query,
		topic: "finance",
		excludeDomains: GENERIC_NOISE_EXCLUDES,
	};
}

/**
 * External Risks — recent company-specific news for reputational/risk signals.
 *
 * PR36.4: uses entity-anchored news query (launch, announcement focus)
 * to reduce unrelated sports/government/generic content.
 */
function buildExternalRisksQuery(name: string): BucketQuerySpec {
	return {
		query: buildCompanyEntityQuery(name, "news"),
		topic: "news",
		excludeDomains: [...GENERIC_NOISE_EXCLUDES, ...JOB_BOARD_EXCLUDES],
		days: 365,
	};
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the Tavily query plan from deal inputs.
 *
 * Returns an ExternalDiligenceQueryPlan with 6 BucketQuerySpecs (one per bucket)
 * plus the extracted signals used to build them.
 *
 * Pure function — safe to call in unit tests without any mocks.
 */
export function buildExternalDiligenceQueryPlan(
	inputs: InsightSlotInputs,
	dealName?: string | null,
	canonicalFieldsBody?: string | null
): ExternalDiligenceQueryPlan {
	// Extract raw signals from pages + canonical
	const rawCompanyName = extractCompanyNameFromPages(inputs.dpuPages, dealName);
	const sectorFromPages = extractSectorFromPages(inputs.dpuPages);
	const sectorFromCanonical = extractSectorFromCanonical(canonicalFieldsBody ?? null);
	const sector = sectorFromPages ?? sectorFromCanonical;
	const founderName = extractFounderNameFromPages(inputs.dpuPages);
	const raiseRound = extractRaiseRoundFromCanonical(canonicalFieldsBody ?? null);

	// PR36.4: normalize company name (strips legal suffixes, TLDs)
	const companyName = rawCompanyName ? normalizeCompanyName(rawCompanyName) : null;

	// PR36.4: infer product category via keyword heuristics + sector mapping
	// (supersedes extractProductCategoryFromPages — same page-level extraction
	// plus additional keyword scanning and sector→category fallback)
	const productCategory = inferProductCategory(
		inputs.dpuPages,
		sector,
		canonicalFieldsBody ?? null
	);

	// Fallback company label when nothing was detected
	const companyLabel = companyName ?? "this company";

	const queries: Record<ExternalDiligenceBucketKey, BucketQuerySpec> = {
		company_footprint: buildCompanyFootprintQuery(companyLabel),
		// PR36.4: sector param removed — category already subsumes it
		competitive_landscape: buildCompetitiveLandscapeQuery(companyLabel, productCategory),
		// PR36.4: company label removed — market query never uses bare company name
		market_outlook: buildMarketOutlookQuery(sector, productCategory),
		founder_team_signals: buildFounderTeamQuery(founderName, companyLabel),
		financial_context: buildFinancialContextQuery(sector, raiseRound, companyLabel),
		external_risks: buildExternalRisksQuery(companyLabel),
	};

	return {
		company_name: companyName,
		sector,
		founder_name: founderName,
		product_category: productCategory,
		queries,
	};
}
