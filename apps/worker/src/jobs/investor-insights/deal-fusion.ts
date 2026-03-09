/**
 * Deal-Level Canonical Fact Fusion
 *
 * Computes deal-level canonical facts by reconciling DPU pages across ALL documents
 * for a deal. Each fused fact carries full provenance: evidence_ref,
 * source_document_id, and a confidence score.
 *
 * Confidence tiers:
 *   1.0 — Corroborated: same normalised value found in 2+ distinct documents
 *   0.8 — Single-source: found in exactly 1 document
 *   0.5 — Conflicted: 2+ documents disagree on the normalised value
 *
 * When values conflict the field is still fused (longest value wins as a
 * representative) but a FusedConflict entry is emitted and confidence is capped
 * at 0.5.
 *
 * History: when a previous run's value is superseded (normalised value changed),
 * the old entry is archived in FusedFact.history with reason
 * "superseded_by_new_run".
 *
 * This module is intentionally self-contained — it duplicates the subset of
 * pattern constants it needs rather than importing private symbols from
 * processor.ts.
 */

import type { RenderPackage } from "../../contracts/investor-insights/schemas";
import { isCandidateTaintedByFundAumContext } from "./resolve-raise-amount";
import {
	type TemporalScope,
	classifyTemporalScope,
	extractYearFromLabel,
	isProjectedScope,
	temporalScopeLabel,
} from "@dealdecision/core";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FusedFactHistoryEntry {
	/** Raw (presentation-safe) value that was replaced. */
	value: string;
	confidence: number;
	evidence_ref: string;
	source_document_id: string;
	/** ISO timestamp of the run that replaced this entry. */
	replaced_at: string;
	/** Machine reason code, e.g. "superseded_by_new_run". */
	reason: string;
}

export interface FusedFact {
	field: string;
	category: string;
	/** Presentation-safe extracted value (e.g. "$1.5MM", "Seed"). */
	value: string;
	/** 0.5 | 0.8 | 1.0 */
	confidence: number;
	/** e.g. "dpu:doc:ab12cd34:page:3" */
	evidence_ref: string;
	/** UUID of the document that produced the winning match. */
	source_document_id: string;
	/** ISO timestamp of the run that produced this entry. */
	updated_at: string;
	/** Ordered history of prior values for this field (most-recent first). */
	history: FusedFactHistoryEntry[];
	/**
	 * Temporal scope of this fused fact.
	 *
	 * Populated for traction_signal and market_claims fields where temporal
	 * context can be reliably detected from the matching text snippet.
	 *
	 * "projected" or "scenario" means the fact MUST NOT be presented as the
	 * company's current performance without an explicit scope qualifier.
	 *
	 * undefined = temporal classification was not applicable for this field.
	 */
	temporal_scope?: TemporalScope;
	/**
	 * Semantic role of this fused fact — maps to the DealFactTypeV1 taxonomy.
	 *
	 * Provides an explicit typed role alongside the string field name so that
	 * downstream consumers can use typed comparisons instead of string matching.
	 */
	semantic_role?: string;
	/**
	 * Scenario label when this fact originates from a named scenario column in a
	 * financial model (e.g. "Base", "Upside", "Downside", "Bear", "Bull").
	 *
	 * Undefined for actuals and non-scenario extractions.
	 * Always set when temporal_scope = "scenario".
	 */
	scenario?: string;
}

export interface FusedConflict {
	field: string;
	candidates: Array<{
		value: string;
		normalized: string;
		evidence_ref: string;
		source_document_id: string;
	}>;
	capped_confidence: number;
}

export interface FusionResult {
	facts: FusedFact[];
	conflicts: FusedConflict[];
	fusion_timestamp: string;
	/** Number of distinct document_ids that contributed at least one DPU page. */
	doc_count: number;
}

// ─── Internal narrow interfaces (avoid coupling to processor.ts internals) ────

interface DpuPageLike {
	document_id: string;
	page_index: number;
	text: string;
}

interface EvidenceSnippetLike {
	id: string;
	claim_text: string | null;
	claim_text_norm: string | null;
}

// ─── Pattern building blocks (self-contained copy of processor.ts privates) ───

const CURRENCY = String.raw`(?:\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)`;
const AMOUNT = String.raw`\d{1,3}(?:[,\d]{0,3})*(?:\.\d+)?`;
const SUFFIX = String.raw`(?:\s*(?:MM|BB|[KMBTkmbt]|thousand|million|billion|trillion)\b)?`;
const MONEY_FRAGMENT = String.raw`${CURRENCY}\s*${AMOUNT}${SUFFIX}`;

/**
 * Wildcard span that refuses to cross another currency token or a newline.
 * Used in patterns that allow free text between a money token and a keyword.
 */
const _NO_CUR = `[^$€£\\n]`;

const RAISE_ANCHOR = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;

/**
 * raise_amount — full multi-form pattern (Forms A–H).
 * @see processor.ts RAISE_AMOUNT_PATTERN for authoritative annotation.
 */
const RAISE_AMOUNT_PATTERN = new RegExp(
	// Form A: raise/seek/fund verb then money
	`${RAISE_ANCHOR}\\s+${MONEY_FRAGMENT}` +
	// Form B: money then raise-word within ~40 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	// Form C: label-first — capital raise / round size / ticket size
	`|\\b(?:capital\\s+raise|round\\s+size|ticket\\s+size|proceeds|allocation)\\b${_NO_CUR}{0,40}?${MONEY_FRAGMENT}` +
	// Form D: money immediately before a round-type keyword
	`|${MONEY_FRAGMENT}\\s+(?:seed|series\\s+[a-cA-C]|pre[-\\s]seed|bridge)\\s*(?:round|raise|funding)?` +
	// Form E: money first, then past-tense funding phrase
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,60}?\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b` +
	// Form F: past-tense funding phrase first, then money
	`|\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b${_NO_CUR}{0,60}?${MONEY_FRAGMENT}` +
	// Form G: raise-anchor + colon + optional article + money
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}` +
	// Form H: slide-layout label prefix + raise + money
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

const RAISE_ROUND_PATTERN = /\b(seed|series\s+[a-cA-C]|pre[-\s]seed|bridge|angel)\b/i;

const RAISE_INSTRUMENT_PATTERN =
	/\b(SAFE|convertible\s+note|priced\s+round|equity(?:\s+round)?|common(?:\s+(?:stock|equity|shares?))?|preferred(?:\s+(?:stock|equity|shares?))?)\b/i;

const RAISE_CAP_PATTERN =
	/(?:valuation\s+)?cap\s+(?:of\s+)?\$[\d,.]+\s*[BMKbmk]?|\bSAFE\s+cap\s+\$[\d,.]+\s*[BMKbmk]?/i;

const RAISE_DISCOUNT_PATTERN = /\b(\d+)%\s+discount\b/i;

const VALUATION_PRE_PATTERN =
	/pre[-\s]money\s+(?:valuation\s+)?(?:of\s+|is\s+|at\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

const VALUATION_POST_PATTERN = new RegExp(
	`post[-\\s]money\\s+(?:valuation\\s+)?(?:of\\s+|is\\s+|at\\s+)?${MONEY_FRAGMENT}` +
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,30}?\\bvaluation\\b` +
	`|\\bvaluation\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

const VALUATION_SAFE_CAP_PATTERN =
	/safe\s+cap\s+(?:of\s+|is\s+|at\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

const USE_OF_FUNDS_BUCKET_PATTERN =
	/(?:use\s+of\s+(?:funds|proceeds)|allocation\s+of\s+proceeds|proceeds\s+will\s+be\s+used)\b[^.]{0,200}/i;

const TAM_VALUE_PATTERN =
	/(?:\bTAM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bTAM\b)/i;

const SAM_VALUE_PATTERN =
	/(?:\bSAM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bSAM\b)/i;

const SOM_VALUE_PATTERN =
	/(?:\bSOM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bSOM\b)/i;

const MRR_VALUE_PATTERN = /\bMRR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

const ARR_VALUE_PATTERN = /\bARR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

// Updated to match plural "revenues" and allow pipe-separated columns from XLSX DPU
const REVENUE_VALUE_PATTERN =
	/(?:annual\s+revenues?|quarterly\s+revenues?|total\s+revenues?|gross\s+revenues?)[^$\n]{0,50}?\$[\d,.]+\s*[BMKbmk]?/i;

const GROWTH_RATE_PATTERN =
	/(?:growing|growth(?:\s+rate)?(?:\s+of)?)\s+\d+%|\b\d+%\s+(?:month\s+over\s+month|MoM\b|YoY\b|year\s+over\s+year|annually)/i;

const CUSTOMER_COUNT_PATTERN = /\b(\d[\d,]+)\s+(?:customers?|active\s+users?|clients?)\b/i;

/**
 * deck_has_use_of_funds_buckets: detects a "use of funds" heading followed by
 * allocation-category bucket labels within 300 chars — does NOT require dollar
 * amounts, so it fires even when a slide shows only percentage splits or bare labels.
 */
const DECK_USE_OF_FUNDS_BUCKETS_PATTERN = new RegExp(
	`(?:use\\s+of\\s+(?:funds|proceeds|capital)|allocation\\s+of\\s+(?:funds|proceeds)|` +
	`capital\\s+allocation|funds\\s+will\\s+be\\s+(?:used|deployed|allocated))` +
	`[\\s\\S]{0,300}?` +
	`(?:\\bengineering\\b|\\bmarketing\\b|\\bproduct\\b|\\bsales\\b|\\boperations\\b|` +
	`\\bhiring\\b|\\br&d\\b|\\bresearch\\b|\\bdevelopment\\b|` +
	`\\btechnology\\b|\\bgo-to-market\\b|\\bcustomer\\s+(?:success|acquisition)\\b|` +
	`\\binfrastructure\\b|\\blegal\\b|\\bfinance\\b)`,
	"i"
);

/**
 * Expanded taint regex for raise_amount matching.  Now applied to BOTH money-first
 * and ambiguous-verb-first matches (see isFusionRaiseTainted).
 *
 * Additions over the previous version:
 *   - total revenues?  — "total revenue of $11B" / "total revenues $5B"
 *   - revenue size     — "revenue size of the market"
 */
const FUSION_MARKET_TAINT_RE =
	// Note: plain "market" uses (?<!-)market(?!\w) — a negative lookbehind for hyphen
	// so that "go-to-market" (preceded by '-') does NOT trigger a taint.
	// Only uncompounded uses like "Tax Software Market $11B" will match.
	/\b(?:TAM|SAM|SOM|total\s+addressable\s+market|serviceable\s+addressable\s+market|serviceable\s+obtainable\s+market|addressable\s+market|market\s+size|market\s+opportunity|market\s+cap(?:italization)?|industry|sector|gap|opportunit|total\s+revenues?|revenue\s+size)\b|(?<!-)market(?!\w)/i;

const FUSION_TAM_TAINT_WINDOW = 200;

/**
 * FUSION_STRONG_RAISE_VERB_PREFIX_RE: mirrors processor.ts STRONG_RAISE_VERB_PREFIX_RE.
 * Only these verb starters are unconditionally exempt from the market-taint check.
 * "invest..." is NOT included — "investment opportunity of $11B" is a market claim.
 */
const FUSION_STRONG_RAISE_VERB_PREFIX_RE = /^(?:rais|seek|fund(?:ed|ing)?|financ|offer(?:ing)?)/i;

/**
 * Returns true when a RAISE_AMOUNT_PATTERN match should be rejected because the
 * surrounding text suggests a market-size claim rather than an investment ask.
 *
 * FIX (raise_amount pollution): The old code unconditionally exempted ALL verb-first
 * matches from the taint check.  "investment opportunity of $11B Tax Software Market"
 * was exempted because the match started with "investment" (a letter).  We now only
 * exempt strong, unambiguous raise-verb starters (rais.../seek.../fund.../financ.../offer...).
 * "invest..." falls through to the taint check since it is ambiguous.
 */
function isFusionRaiseTainted(
	text: string,
	matchIndex: number,
	matchLength: number,
): boolean {
	// Strong raise-verb starters are unambiguous — exempt from taint check.
	const matchStart = text.slice(matchIndex, matchIndex + 8);
	if (FUSION_STRONG_RAISE_VERB_PREFIX_RE.test(matchStart)) return false;
	// All other starts (money-first, or "invest*"/"allocation"/"proceed*") —
	// check the context window for market-size language.
	const start = Math.max(0, matchIndex - FUSION_TAM_TAINT_WINDOW);
	const end = Math.min(text.length, matchIndex + matchLength + FUSION_TAM_TAINT_WINDOW);
	return FUSION_MARKET_TAINT_RE.test(text.slice(start, end));
}

// ─── Field registry ───────────────────────────────────────────────────────────

interface FieldDef {
	field: string;
	category: string;
	pattern: RegExp;
	/**
	 * Semantic role mapped to the DealFactTypeV1 taxonomy.
	 * Carried through to FusedFact.semantic_role.
	 */
	semantic_role?: string;
	/**
	 * When true, temporal scope classification is run on the matched text
	 * window for this field. Applies to traction metrics and market claims
	 * where projected vs. historical scope matters for investment decisions.
	 */
	classify_temporal?: boolean;
}

const FUSION_FIELDS: FieldDef[] = [
	{ field: "raise_amount",         category: "raise_terms",      semantic_role: "raise_amount",   classify_temporal: false, pattern: RAISE_AMOUNT_PATTERN },
	{ field: "raise_round",          category: "raise_terms",      semantic_role: "round_stage",    classify_temporal: false, pattern: RAISE_ROUND_PATTERN },
	{ field: "raise_instrument",     category: "raise_terms",      semantic_role: "round_stage",    classify_temporal: false, pattern: RAISE_INSTRUMENT_PATTERN },
	{ field: "raise_cap",            category: "raise_terms",      semantic_role: "valuation",      classify_temporal: false, pattern: RAISE_CAP_PATTERN },
	{ field: "raise_discount",       category: "raise_terms",      semantic_role: "raise_amount",   classify_temporal: false, pattern: RAISE_DISCOUNT_PATTERN },
	{ field: "valuation_pre",        category: "valuation_terms",  semantic_role: "valuation",      classify_temporal: false, pattern: VALUATION_PRE_PATTERN },
	{ field: "valuation_post",       category: "valuation_terms",  semantic_role: "valuation",      classify_temporal: false, pattern: VALUATION_POST_PATTERN },
	{ field: "valuation_safe_cap",   category: "valuation_terms",  semantic_role: "valuation",      classify_temporal: false, pattern: VALUATION_SAFE_CAP_PATTERN },
	{ field: "use_of_funds_buckets",          category: "use_of_funds",     semantic_role: "use_of_funds",   classify_temporal: false, pattern: USE_OF_FUNDS_BUCKET_PATTERN },
	{ field: "deck_has_use_of_funds_buckets", category: "use_of_funds",     semantic_role: "use_of_funds",   classify_temporal: false, pattern: DECK_USE_OF_FUNDS_BUCKETS_PATTERN },
	{ field: "tam_value",            category: "market_claims",    semantic_role: "tam",            classify_temporal: true,  pattern: TAM_VALUE_PATTERN },
	{ field: "sam_value",            category: "market_claims",    semantic_role: "sam",            classify_temporal: true,  pattern: SAM_VALUE_PATTERN },
	{ field: "som_value",            category: "market_claims",    semantic_role: "som",            classify_temporal: true,  pattern: SOM_VALUE_PATTERN },
	{ field: "mrr_value",            category: "traction_signal",  semantic_role: "mrr",            classify_temporal: true,  pattern: MRR_VALUE_PATTERN },
	{ field: "arr_value",            category: "traction_signal",  semantic_role: "arr",            classify_temporal: true,  pattern: ARR_VALUE_PATTERN },
	{ field: "revenue_value",        category: "traction_signal",  semantic_role: "revenue",        classify_temporal: true,  pattern: REVENUE_VALUE_PATTERN },
	{ field: "growth_rate",          category: "traction_signal",  semantic_role: "traction_metric", classify_temporal: false, pattern: GROWTH_RATE_PATTERN },
	{ field: "customer_count",       category: "traction_signal",  semantic_role: "traction_metric", classify_temporal: false, pattern: CUSTOMER_COUNT_PATTERN },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Canonical DPU evidence reference string. */
function dpuEvidenceRef(documentId: string, pageIndex: number): string {
	return `dpu:doc:${documentId.replace(/-/g, "").slice(0, 8)}:page:${pageIndex}`;
}

/**
 * Normalise a currency+amount token for conflict deduplication.
 * Mirrors processor.ts normalizeAmountForConflict exactly.
 */
export function normalizeForConflict(s: string): string {
	const m = /(?:[€£$]|EUR|USD|GBP)\s*[\d,]+(?:\.\d+)?(?:\s*(?:MM|BB|[BMKbmkTt]|million|billion|thousand|trillion))?/i.exec(s);
	if (!m) return s.trim().toLowerCase().slice(0, 30);
	return m[0]
		.replace(/\s/g, "")
		.toLowerCase()
		.replace(/^eur/, "€")
		.replace(/^usd/, "$")
		.replace(/^gbp/, "£")
		.replace(/mm$/, "m")
		.replace(/bb$/, "b")
		.replace(/million$/, "m")
		.replace(/billion$/, "b")
		.replace(/thousand$/, "k")
		.replace(/trillion$/, "t");
}

/** Fields where the value should be a clean money token. */
const AMOUNT_FIELDS_SET = new Set([
	"raise_amount", "raise_cap",
	"valuation_post", "valuation_pre", "valuation_safe_cap",
	"tam_value", "sam_value", "som_value",
	"mrr_value", "arr_value", "revenue_value",
]);

const MONEY_RE = new RegExp(MONEY_FRAGMENT, "i");

function extractFirstMoney(snippet: string): string | null {
	const m = MONEY_RE.exec(snippet);
	return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** Return a clean, presentation-safe value string for a canonical field. */
function cleanValue(field: string, snippet: string): string {
	const base = snippet.replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").trim();
	if (AMOUNT_FIELDS_SET.has(field)) {
		return extractFirstMoney(base) ?? base;
	}
	if (field === "growth_rate") {
		const m = /\b\d+(?:\.\d+)?%(?:\s*(?:YoY|MoM|month[-\s]over[-\s]month|year[-\s]over[-\s]year|annually))?/i.exec(base);
		return m ? m[0].trim() : base;
	}
	if (field === "customer_count") {
		const m = /\b(\d[\d,]*)\+?(?:\s*(?:customers?|active\s+users?|clients?))?\b/.exec(base);
		return m ? m[0].trim() : base;
	}
	return base;
}

/**
 * Returns true when a FusedFact should be blocked from promotion to
 * "current company performance" surfaces (overview headline, governed summary
 * key metrics) because its temporal scope indicates forward-looking data.
 *
 * Safe to call when temporal_scope is undefined — returns false (not blocked).
 *
 * Blocked scopes: "projected", "scenario", "target"
 * Allowed scopes: "historical", "current", "unknown", undefined
 */
export function isProjectedFusedFact(fact: FusedFact): boolean {
	if (!fact.temporal_scope) return false;
	return isProjectedScope(fact.temporal_scope);
}

// ─── Per-document matching ────────────────────────────────────────────────────

interface DocMatch {
	document_id: string;
	value: string;
	normalized: string;
	evidence_ref: string;
	/**
	 * Context window (up to 400 chars) surrounding the match, used for
	 * temporal scope classification. Includes text before and after the match.
	 */
	context_window: string;
}

/**
 * Scan sorted pages for a single document and return the first regex match.
 * Pages must already be ordered by page_index ascending (processor.ts guarantees
 * ORDER BY document_id ASC, page_index ASC).
 */
function findFirstMatchInDoc(
	docPages: DpuPageLike[],
	field: string,
	pattern: RegExp
): DocMatch | null {
	for (const page of docPages) {
		const m = pattern.exec(page.text ?? "");
		if (!m) continue;
		// Guard: skip money-first raise_amount matches whose context contains
		// market-size language ("$11B market", "$8B TAM — investment opportunity").
		if (field === "raise_amount" && isFusionRaiseTainted(page.text ?? "", m.index, m[0].length)) continue;
		// PR26 guard: skip raise_amount matches on pages that contain fund-management /
		// AUM language ("$100M Alternatives Fund", "AUM", "LP commitment", etc.).
		// Mirrors the PR24 guard in resolve-raise-amount.ts and promote-slide-facts.ts.
		if (field === "raise_amount" && isCandidateTaintedByFundAumContext(page.text ?? "")) continue;
		const snippet = m[0].slice(0, 120);
		// Capture a 400-char context window for temporal scope classification
		const ctxStart = Math.max(0, m.index - 150);
		const ctxEnd = Math.min((page.text ?? "").length, m.index + m[0].length + 150);
		const context_window = (page.text ?? "").slice(ctxStart, ctxEnd);
		return {
			document_id: page.document_id,
			value: cleanValue(field, snippet),
			normalized: normalizeForConflict(snippet),
			evidence_ref: dpuEvidenceRef(page.document_id, page.page_index),
			context_window,
		};
	}
	return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute deal-level fused canonical facts from DPU pages across all documents.
 *
 * @param pages             All DpuPage rows for the deal (multiple document_ids OK).
 * @param _evidenceSnippets Evidence snippets — reserved for future evidence-only fallback.
 * @param previousFacts     Fused facts from the most-recent prior run (for history).
 * @param nowStr            Injectable ISO timestamp (for deterministic tests).
 */
export function fuseDealCanonicalFacts(
	pages: DpuPageLike[],
	_evidenceSnippets: EvidenceSnippetLike[],
	previousFacts: FusedFact[] = [],
	nowStr?: string
): FusionResult {
	const now = nowStr ?? new Date().toISOString();

	// Group pages by document_id (preserve original order within each group)
	const byDoc = new Map<string, DpuPageLike[]>();
	for (const page of pages) {
		const bucket = byDoc.get(page.document_id);
		if (bucket) {
			bucket.push(page);
		} else {
			byDoc.set(page.document_id, [page]);
		}
	}

	const docCount = byDoc.size;
	const facts: FusedFact[] = [];
	const conflicts: FusedConflict[] = [];

	// Build previous-fact index keyed by field name
	const prevByField = new Map<string, FusedFact>();
	for (const pf of previousFacts) {
		prevByField.set(pf.field, pf);
	}

	for (const fieldDef of FUSION_FIELDS) {
		const { field, category, pattern, semantic_role, classify_temporal } = fieldDef;

		// Collect the first match found in each document
		const docMatches: DocMatch[] = [];
		for (const [, docPages] of byDoc) {
			const match = findFirstMatchInDoc(docPages, field, pattern);
			if (match) docMatches.push(match);
		}

		if (docMatches.length === 0) {
			// No evidence anywhere — field not fused for this run
			continue;
		}

		// Deduplicate by normalised value to detect cross-document conflicts
		const distinctNorms = new Map<string, DocMatch>();
		for (const dm of docMatches) {
			if (!distinctNorms.has(dm.normalized)) {
				distinctNorms.set(dm.normalized, dm);
			}
		}

		let winner: DocMatch;
		let confidence: number;

		if (distinctNorms.size === 1) {
			// All documents agree (or only one document matched)
			winner = docMatches[0]!;
			confidence = docMatches.length >= 2 ? 1.0 : 0.8;
		} else {
			// Cross-document conflict: pick the candidate with the longest raw value
			// as the representative winner; cap confidence at 0.5
			winner = docMatches.reduce((a, b) => (b.value.length > a.value.length ? b : a));
			confidence = 0.5;
			conflicts.push({
				field,
				candidates: docMatches.map((dm) => ({
					value: dm.value,
					normalized: dm.normalized,
					evidence_ref: dm.evidence_ref,
					source_document_id: dm.document_id,
				})),
				capped_confidence: 0.5,
			});
		}

		// History tracking: archive the previous value if the normalised form changed
		const prev = prevByField.get(field);
		const history: FusedFactHistoryEntry[] = prev ? [...prev.history] : [];

		if (prev && normalizeForConflict(prev.value) !== normalizeForConflict(winner.value)) {
			history.unshift({
				value: prev.value,
				confidence: prev.confidence,
				evidence_ref: prev.evidence_ref,
				source_document_id: prev.source_document_id,
				replaced_at: now,
				reason: "superseded_by_new_run",
			});
		}

		// Temporal scope classification (only for fields where it matters)
		let temporal_scope: TemporalScope | undefined;
		if (classify_temporal) {
			const year = extractYearFromLabel(winner.value);
			temporal_scope = classifyTemporalScope(year, winner.context_window);
		}

		facts.push({
			field,
			category,
			value: winner.value,
			confidence,
			evidence_ref: winner.evidence_ref,
			source_document_id: winner.document_id,
			updated_at: now,
			history,
			temporal_scope,
			semantic_role,
		});
	}

	return { facts, conflicts, fusion_timestamp: now, doc_count: docCount };
}

/**
 * Build a render-package section from a FusionResult.
 * Always included (even when no facts are fused) so the UI can surface
 * "no cross-document evidence found" rather than a missing section.
 */
export function buildDealFusionSection(
	result: FusionResult
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`fusion_timestamp=${result.fusion_timestamp}`,
		`doc_count=${result.doc_count}`,
		`facts_fused=${result.facts.length}`,
		`conflicts=${result.conflicts.length}`,
	];

	if (result.facts.length > 0) {
		lines.push("--- fused facts ---");
		for (const f of result.facts) {
			const scopePart = f.temporal_scope ? ` | scope=${f.temporal_scope}` : "";
			const rolePart  = f.semantic_role  ? ` | role=${f.semantic_role}`   : "";
			const projectedFlag = f.temporal_scope && isProjectedScope(f.temporal_scope)
				? " [PROJECTED — not current actuals]"
				: "";
			lines.push(
				`field=${f.field} | category=${f.category} | confidence=${f.confidence.toFixed(1)} | value="${f.value}"${scopePart}${rolePart} | evidence=${f.evidence_ref} | doc=${f.source_document_id.slice(0, 8)}${projectedFlag}`
			);
		}
	}

	if (result.conflicts.length > 0) {
		lines.push("--- conflicts ---");
		for (const c of result.conflicts) {
			const cands = c.candidates
				.map((cd) => `"${cd.value}"@${cd.source_document_id.slice(0, 8)}`)
				.join(" vs ");
			lines.push(
				`field=${c.field} | capped_confidence=${c.capped_confidence.toFixed(1)} | candidates=${cands}`
			);
		}
	}

	return {
		key: "deal_fusion",
		title: "Deal-Level Canonical Fact Fusion",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Deal fusion data unavailable.",
	};
}
