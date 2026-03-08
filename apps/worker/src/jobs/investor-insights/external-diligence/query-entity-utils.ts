/**
 * PR36.4 — External Due Diligence: Query Entity Utilities
 *
 * Company name normalization and entity-anchored query construction.
 *
 * Problem:
 *   Raw company names extracted from pitch decks often include legal suffixes
 *   ("Acme Corp, Inc."), TLD-style brand suffixes (".ai", ".io"), or trailing
 *   punctuation that pollutes search queries and break entity resolution.
 *
 *   Example: "DealDecisionAI, Inc." → Tavily searches for exact phrase with comma.
 *
 * This module provides:
 *   - normalizeCompanyName()  — strips noise, returns clean brand identifier
 *   - buildCompanyEntityQuery() — constructs the best single entity-anchored query
 *     variant suitable for each Tavily bucket purpose
 *
 * Pure function — no I/O.
 */

// ─── Legal / organisational suffix patterns ────────────────────────────────────

/**
 * Trailing legal entity suffixes commonly appended to company names in decks.
 *
 * Note: bare "Corp" (without period) is intentionally excluded because it commonly
 * appears as a brand component (e.g., "Acme Corp").  We strip "Corp." (with period)
 * and the full "Corporation" form, but not the abbreviated form without punctuation.
 */
const LEGAL_SUFFIX_RE =
	/[,\s]+(Inc\.?|Incorporated|LLC|L\.L\.C\.?|Ltd\.?|Limited|Corporation|LLP|L\.L\.P\.?|PLC|P\.L\.C\.?|AG|GmbH|S\.A\.?|Corp\.)\.?$/i;

/**
 * Brand-style TLD suffixes increasingly used as company identifiers.
 * Strip these so "Acme.ai" becomes "Acme".
 */
const TLD_SUFFIX_RE = /\.(ai|io|co|com|tech|app|xyz|so|vc|hq|us|net|org)\s*$/i;

// ─── normalizeCompanyName ─────────────────────────────────────────────────────

/**
 * Normalize a raw company name into a clean, search-safe brand identifier.
 *
 * Transformations applied:
 *   1. Trim surrounding whitespace
 *   2. Strip legal suffixes (Inc., LLC, Corp, Ltd, etc.)
 *   3. Strip TLD-style brand suffixes (.ai, .io, .co, etc.)
 *   4. Collapse runs of spaces / punctuation at boundaries
 *   5. Cap at 60 characters
 *
 * Examples:
 *   "Acme Corp, Inc."         → "Acme Corp"
 *   "DealDecisionAI, Inc."    → "DealDecisionAI"
 *   "FlowDash.ai"             → "FlowDash"
 *   "WorkflowAI LLC"          → "WorkflowAI"
 *   "  Stripe  "              → "Stripe"
 *
 * Returns the input unchanged if no normalization is applicable (safe fallback).
 */
export function normalizeCompanyName(raw: string): string {
	let name = raw.trim();

	// Strip legal suffix — single pass only to avoid over-stripping
	// (e.g. "Acme Corp, Inc." → "Acme Corp", not "Acme")
	const stripped = name.replace(LEGAL_SUFFIX_RE, "").trim();
	if (stripped.length > 0) {
		name = stripped;
	}

	// Strip TLD suffix
	name = name.replace(TLD_SUFFIX_RE, "").trim();

	// Remove trailing commas, periods, hyphens
	name = name.replace(/[,.\-_]+$/, "").trim();

	// Collapse internal double-spaces
	name = name.replace(/\s{2,}/g, " ");

	return name.slice(0, 60);
}

// ─── Query variant types ──────────────────────────────────────────────────────

/**
 * Purpose-specific query variants for each Tavily bucket.
 *
 * Each variant produces a search string optimised for a different diligence goal.
 * All variants use the normalised company name wrapped in quotes for entity anchoring.
 */
export type CompanyQueryVariant =
	| "footprint"   // company presence, funding profile, product pages
	| "funding"     // raise announcement, investor profile
	| "news"        // recent company news, launches, risks
	| "product"     // product description / demo / features
	| "founder"     // fallback founder query when no individual name extracted
	| "market";     // company-anchored market context (last resort)

// ─── buildCompanyEntityQuery ──────────────────────────────────────────────────

/**
 * Build a single entity-anchored Tavily query string for a given purpose.
 *
 * The company name is always quoted to enforce entity resolution.
 *
 * Examples (name = "WorkflowAI"):
 *   footprint → '"WorkflowAI" startup funding crunchbase'
 *   funding   → '"WorkflowAI" funding raise investment'
 *   news      → '"WorkflowAI" startup news launch announcement'
 *   product   → '"WorkflowAI" product platform features'
 *   founder   → '"WorkflowAI" founder CEO leadership'
 *   market    → '"WorkflowAI" market competitors industry'
 */
export function buildCompanyEntityQuery(
	name: string,
	variant: CompanyQueryVariant = "footprint"
): string {
	const q = `"${name}"`;

	switch (variant) {
		case "footprint":
			return `${q} startup funding crunchbase`;
		case "funding":
			return `${q} funding raise investment round`;
		case "news":
			return `${q} startup news launch announcement 2025`;
		case "product":
			return `${q} product platform features`;
		case "founder":
			return `${q} founder CEO leadership team`;
		case "market":
			return `${q} market competitors industry`;
		default:
			return `${q} company`;
	}
}

// ─── buildFounderEntityQuery ──────────────────────────────────────────────────

/**
 * Build an entity-anchored founder query when a name is known.
 *
 * Quotes the founder name for entity anchoring.  Optionally adds the company
 * name to disambiguate common names (e.g., "John Smith" matches thousands of
 * people; "John Smith" "WorkflowAI" narrows to the right individual).
 *
 * Examples:
 *   founderName="Jane Smith", company="WorkflowAI"
 *     → '"Jane Smith" "WorkflowAI" founder startup'
 *
 *   founderName="Jane Smith", company=null
 *     → '"Jane Smith" founder CEO startup entrepreneur'
 */
export function buildFounderEntityQuery(
	founderName: string,
	companyName: string | null
): string {
	const quoted = `"${founderName}"`;
	if (companyName) {
		return `${quoted} "${companyName}" founder startup`;
	}
	return `${quoted} founder CEO startup entrepreneur`;
}
