/**
 * PR36.4 — External Due Diligence: Product Category Inference
 *
 * Derives a concise, search-ready "product category" string from deal signals.
 *
 * Why this matters:
 *   Competitor and market queries depend on a specific category term. If the category
 *   is null, buildCompetitiveLandscapeQuery and buildMarketOutlookQuery fall back to
 *   the raw company name — producing queries like "DealDecisionAI market size growth"
 *   which return irrelevant content.
 *
 * Strategy (priority order):
 *   1. Page-level product descriptors  — "the X platform", "a X solution", "X software"
 *   2. Section title + qualifier combo — "About → AI investment analysis"
 *   3. Sector keyword → category mapping (e.g., "FinTech" → "financial technology software")
 *   4. Canonical field sector fallback — sector value appended with " software"
 *   5. Returns null if all sources fail (callers fall back to company entity queries)
 *
 * Outputs are intentionally concise (≤40 chars) so they work well as Tavily query seeds.
 *
 * Pure function — no I/O, no LLM.
 */

import type { InsightSlotInputs } from "../stages/stage-2-deterministic";

// ─── Sector keyword → category mapping ───────────────────────────────────────

/**
 * Maps commonly-observed sector keywords (from canonical fields or page text)
 * to concise, search-ready category terms.
 *
 * Ordered from most-specific to least; first match wins.
 */
const SECTOR_CATEGORY_MAP: ReadonlyArray<[pattern: RegExp, category: string]> = [
	// ── High-specificity verticals (must precede generic fintech/AI patterns) ──
	// Car / auto / vehicle finance lending (Carmoola-class)
	[/\bcar\s+financ|\bauto\s+(?:lending|financ|loan)|\bvehicle\s+financ|\bmotor\s+financ|\bcar\s+loan|\bcar\s+credit|\bauto\s+fintech\b/i,
	                                                                             "car finance technology"],
	// Digital mortgage / lending workflow SaaS (WebMax-class)
	[/\bmortgage\s+(?:saas|software|platform|tech(?:nology)?|workflow|fintech|origination|process)|\bdigital\s+mortgage|\blending\s+workflow|\bmortgage\s+automat|\bhomebuying\s+platform|\bmortgage\s+lead/i,
	                                                                             "digital mortgage software"],
	// Talent intelligence / skills platform (StackFactor-class)
	[/\btalent\s+intelligence|\bskills?\s+(?:intelligence|mapping|assessment\s+platform)|\bworkforce\s+(?:learning|intelligence|analytics)|\btalent\s+analytics|\bskills?\s+gap\s+analysis|\bproficiency\s+(?:mapping|platform)/i,
	                                                                             "talent intelligence platform"],
	// Consumer / personal lending fintech (BNPL, personal loans)
	[/\bconsumer\s+(?:lending|loan)|\bpersonal\s+loan(?:s|\s+platform)|\bbuy\s+now\s+pay\s+later|\bbnpl\b|\bloan\s+origination\s+(?:software|platform)/i,
	                                                                             "consumer lending technology"],
	// B2B embedded finance / open banking
	[/\bembedded\s+finance|\bopen\s+banking|\bbanking\s+as\s+a\s+service|\bbaas\b|\bpayment\s+infrastructure/i,
	                                                                             "embedded finance platform"],
	// B2B software verticals
	[/\bai\b.*\bfinance\b|\bfinance\b.*\bai\b|\bfintech\b|\bfinancial\s+tech/i,     "AI financial analysis software"],
	[/\bai\b.*\binvest|\binvest.*\bai\b|\bventure\s+ai\b/i,                        "AI investment analysis software"],
	[/\bdeal\s+flow|\bprivate\s+equity|\bvc\s+software|\binvestor\s+tool/i,        "venture capital deal flow software"],
	[/\blegal\s+tech|\blegaltech\b|\bcontract.*ai\b/i,                             "legal technology software"],
	[/\bhr\s+tech|\bhuman\s+resources\s+software|\bpeople\s+ops/i,                 "HR technology software"],
	[/\bhealth\s*tech|\bhealthcare\s+software|\bclinical\s+ai\b/i,                 "healthcare technology software"],
	[/\breal\s+estate\s+tech|\bproptech\b/i,                                       "real estate technology software"],
	[/\bedtech\b|\beducation\s+tech|\be-?learning\s+platform/i,                    "education technology software"],
	[/\binsurtech\b|\binsurance\s+tech/i,                                          "insurance technology software"],
	[/\blogistics\s+tech|\bsupply\s+chain\s+software|\bfreight\s+tech/i,           "logistics technology software"],
	[/\bsecurity\s+software|\bcybersecurity\b|\binfosec\b/i,                       "cybersecurity software"],
	[/\bdata\s+analytics\b|\bbusiness\s+intelligence\b|\bBI\s+software/i,          "data analytics software"],
	[/\bdevops\b|\bdeveloper\s+tools\b|\bci\/cd\b/i,                               "developer tools software"],
	[/\be-?commerce\b|\bretail\s+tech\b|\bshopify\s+alternative/i,                 "e-commerce software"],
	[/\bmarketing\s+tech|\bmartech\b|\bcustomer\s+engagement/i,                   "marketing technology software"],
	[/\bcrm\b|\bcustomer\s+relationship/i,                                         "CRM software"],
	[/\bsaas\b|\bsoftware.as.a.service/i,                                          "SaaS software platform"],
	// Broad AI / automation catch-all (last resort in this map)
	[/\bai\b|\bartificial\s+intelligence\b|\bmachine\s+learning\b/i,               "AI software platform"],
];

// ─── Page-level product descriptor extraction ─────────────────────────────────

const PLATFORM_RE =
	/\b(?:the|a|an|our)\s+([A-Za-z][A-Za-z0-9\/\- &]{2,30}?)\s+(?:platform|solution|software|tool|system|product)\b/i;

const SPACE_RE = /\bin\s+the\s+([A-Za-z][A-Za-z0-9\/\- &]{3,35}?)\s+space\b/i;

// Short stop-words that produce useless category strings when extracted alone
const STOPWORD_RE =
	/^(this|that|our|the|a|an|new|best|top|leading|modern|next|first|only|right|perfect|ideal|very|most|more|some|same)$/i;

function extractCategoryFromPages(pages: InsightSlotInputs["dpuPages"]): string | null {
	for (const page of pages.slice(0, 8)) {
		const text = page.text ?? "";

		const mPlatform = PLATFORM_RE.exec(text);
		if (mPlatform?.[1]) {
			const val = mPlatform[1].trim().replace(/\s{2,}/g, " ");
			if (!STOPWORD_RE.test(val) && val.length >= 3) {
				return val.slice(0, 40);
			}
		}

		const mSpace = SPACE_RE.exec(text);
		if (mSpace?.[1]) {
			return mSpace[1].trim().replace(/\s{2,}/g, " ").slice(0, 40);
		}
	}
	return null;
}

// ─── Keyword heuristic from all page text ─────────────────────────────────────

/**
 * Scan all page text (up to 15 pages) against SECTOR_CATEGORY_MAP.
 * Returns the first matching category, or null.
 */
function inferCategoryFromKeywords(
	pages: InsightSlotInputs["dpuPages"],
	sector: string | null,
	canonicalBody: string | null
): string | null {
	// Build a combined text corpus: sector fields + first 15 pages
	const corpus = [
		sector ?? "",
		canonicalBody ?? "",
		...pages.slice(0, 15).map((p) => p.text ?? ""),
	].join(" ");

	for (const [pattern, category] of SECTOR_CATEGORY_MAP) {
		if (pattern.test(corpus)) return category;
	}

	return null;
}

// ─── Canonical sector fallback ────────────────────────────────────────────────

/**
 * Extract sector value from canonical fields body.
 * Returns "X software" if sector is short and clean.
 */
function sectorToCategory(sector: string | null): string | null {
	if (!sector) return null;
	const s = sector.trim();
	if (s.length > 0 && s.length <= 30 && !/^(null|N\/A|unknown|other)$/i.test(s)) {
		// If it already ends with "software" or "platform", use as-is
		if (/software|platform|tool|solution/i.test(s)) return s.slice(0, 40);
		return `${s} software`.slice(0, 40);
	}
	return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Infer the most specific available product category from deal signals.
 *
 * Priority order:
 *   1. Page-level product platform/solution descriptor
 *   2. Keyword heuristic matching against sector + canonical + page text
 *   3. Sector value appended with " software"
 *   4. null (callers fall back to company entity queries)
 *
 * @param pages          DPU pages from InsightSlotInputs
 * @param sector         Sector string already extracted (may be null)
 * @param canonicalBody  Raw canonical fields body string (may be null)
 */
export function inferProductCategory(
	pages: InsightSlotInputs["dpuPages"],
	sector: string | null,
	canonicalBody: string | null
): string | null {
	// 1. Specific page descriptor ("the AI investment analysis platform")
	const fromPages = extractCategoryFromPages(pages);
	if (fromPages) return fromPages;

	// 2. Keyword heuristic
	const fromKeywords = inferCategoryFromKeywords(pages, sector, canonicalBody);
	if (fromKeywords) return fromKeywords;

	// 3. Sector → category mapping
	return sectorToCategory(sector);
}
