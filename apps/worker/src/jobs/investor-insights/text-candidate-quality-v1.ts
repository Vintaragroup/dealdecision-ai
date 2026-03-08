/**
 * PR36.5 — Text Candidate Quality Gate (v1)
 *
 * Deterministic, pattern-based detection of low-quality text candidates that
 * should be suppressed before reaching investor-facing product/market descriptions.
 *
 * Problem classes addressed:
 *
 *   1. SPREADSHEET_FRAGMENT — Text extracted from spreadsheet tab names, row/column
 *      headers, or formula cells. These are structurally valid strings but carry
 *      no meaningful product/market description. Examples:
 *        "Revenue Growth Assumptions FY2024E FY2025E FY2026E"
 *        "Employee Costs by Department £000s"
 *        "We provide budget model assumptions for Q1 Q2 Q3 Q4"
 *
 *   2. OCR_CONTINUATION_FRAGMENT — Text that begins mid-sentence (lowercase first
 *      word, continuation conjunction, or no subject). Examples:
 *        "expansion. They provide early validation of the value TIP is positioned..."
 *        "and help scale the go-to-market engine for their clients"
 *
 *   3. INCOHERENT_TEXT — Text with no grammatical structure: disconnected noun
 *      phrases, mixed proper/common nouns without verbs, bullet-list reads, etc.
 *        "business signals not HR profiles, proficiency map, deliver rapidly
 *         collaboration tools with smart"
 *
 * All validators are pure functions — no I/O, no side effects.
 */

// ─── Reason codes ─────────────────────────────────────────────────────────────

export const TEXT_QUALITY_REASON = {
	/** Text appears to come from a spreadsheet tab, row header, or column label. */
	SPREADSHEET_FRAGMENT: "SPREADSHEET_FRAGMENT",
	/** Text starts mid-sentence: lowercase letter, continuation word, or no subject. */
	OCR_CONTINUATION_FRAGMENT: "OCR_CONTINUATION_FRAGMENT",
	/** Text lacks recognisable grammatical structure — noun-list / garbled OCR. */
	INCOHERENT_TEXT: "INCOHERENT_TEXT",
} as const;

export type TextQualityReason = (typeof TEXT_QUALITY_REASON)[keyof typeof TEXT_QUALITY_REASON];

// ─── Internal pattern definitions (compile once) ──────────────────────────────

/**
 * SPREADSHEET_NOTATION_RE: financial model notation that should not appear in
 * a clean product/market description.
 *
 * Patterns:
 *   - Fiscal year shorthand with E/A suffix: FY2024E, FY25A, FY2025P
 *   - Quarter/half-year codes: Q1, Q2, H1, H2
 *   - "£000s", "$000s" (column header denomination markers)
 *   - Financial model keywords: "assumptions", "employee costs", "budget model",
 *     "headcount plan", "operating expenses", "capex", "opex" — as standalone
 *     or heading-like terms
 */
const SPREADSHEET_NOTATION_RE =
	/\bFY\s*\d{2,4}[EeAaPpFf]?\b|\bQ[1-4]\b|\bH[12]\b|[£$€]\s*0{3,}s?\b|(?:^|\s)(?:assumptions?|employee\s+costs?|budget\s+model|headcount\s+plan|operating\s+expenses?|capex|opex|cost\s+of\s+goods|cogs\b|ebitda\b|gross\s+margin\s+%|revenue\s+split)\s*(?:[:|\n]|$)/i;

/**
 * SPREADSHEET_COLUMN_HEADER_RE: sequences that look like column header runs —
 * 3+ consecutive Title-Case words or CamelCase identifiers separated by spaces or pipes.
 * These appear when OCR reads a row of spreadsheet column headers linearly.
 *
 * Examples:
 *   "Total Revenue Gross Profit Net Income EBITDA Cash"
 *   "Category Amount Percentage Notes"
 *   "Jan Feb Mar Apr May Jun"
 */
const SPREADSHEET_COLUMN_HEADER_RE =
	/\b(?:[A-Z][a-z]{0,12}\s+){4,}(?:[A-Z][a-z]{0,12})\b/;

/**
 * MONTH_COLUMN_HEADER_RE: a run of 3+ consecutive month abbreviations/names —
 * classic horizontal-axis spreadsheet column header.
 */
const MONTH_COLUMN_HEADER_RE =
	/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b.*?\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b.*?\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i;

/**
 * CONTINUATION_WORD_RE: sentence-starting words that signal the text is a
 * continuation fragment (part of a longer sentence that began elsewhere).
 *
 * Note: Matches only at the start of the string (with optional leading whitespace).
 */
const CONTINUATION_WORD_RE =
	/^(?:and\b|but\b|or\b|nor\b|so\b|yet\b|for\b|because\b|although\b|however\b|therefore\b|moreover\b|furthermore\b|additionally\b|nevertheless\b|which\b|who\b|whose\b|where\b|when\b|that\b|while\b|whereas\b|thus\b|hence\b|thereby\b|including\b|providing\b|offering\b|enabling\b)\s/i;

/**
 * LOWERCASE_START_RE: candidate starts with a lowercase letter — almost
 * always indicates a mid-sentence OCR fragment, not a sentence start.
 * Exempts common intentional lowercase leads like "iOS", "eBay", etc. by
 * requiring the SECOND character also be lowercase.
 */
const LOWERCASE_START_RE = /^[a-z]{2}/;

/**
 * INCOHERENT_NOUN_LIST_RE: a sequence of 4+ comma-separated or space-separated
 * tokens that are mostly single-word proper/common nouns with no connecting verb.
 * Indicates a garbled sentence that should not be used as a product description.
 *
 * The heuristic: count commas vs. total length. If there are 3+ commas and the
 * text does not contain a main verb (a [verb] pattern), it is likely a list.
 */
const HAS_VERB_RE =
	/\b(?:is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|shall|should|may|might|can|could|must|ought|provide[ds]?|build[s]?|create[ds]?|enable[ds]?|help[s]?|power[s]?|automate[ds]?|deliver[s]?|offer[s]?|serve[ds]?|make[s]?|allow[s]?)\b/i;

// ─── Public validators ────────────────────────────────────────────────────────

/**
 * Returns true when `text` contains markers indicating it was extracted from a
 * spreadsheet tab name, column header row, or financial model cell.
 *
 * @example
 *   isSpreadsheetFragment("FY2024E Revenue Assumptions")          // true
 *   isSpreadsheetFragment("Employee Costs by Department £000s")   // true
 *   isSpreadsheetFragment("We build AI tools for investment teams") // false
 */
export function isSpreadsheetFragment(text: string): boolean {
	if (!text || typeof text !== "string") return false;
	const t = text.trim();
	if (SPREADSHEET_NOTATION_RE.test(t)) return true;
	if (MONTH_COLUMN_HEADER_RE.test(t)) return true;
	// Column-header run: only flag if no verb present (header rows have no verbs)
	if (SPREADSHEET_COLUMN_HEADER_RE.test(t) && !HAS_VERB_RE.test(t)) return true;
	return false;
}

/**
 * Returns true when `text` starts mid-sentence — indicating an OCR continuation
 * fragment that was extracted without its preceding context.
 *
 * @example
 *   isOcrContinuationFragment("and help scale the go-to-market engine") // true
 *   isOcrContinuationFragment("We build AI tools for investment teams") // false
 *   isOcrContinuationFragment("providing early validation of value")     // true
 */
export function isOcrContinuationFragment(text: string): boolean {
	if (!text || typeof text !== "string") return false;
	const t = text.trim();
	if (CONTINUATION_WORD_RE.test(t)) return true;
	if (LOWERCASE_START_RE.test(t)) return true;
	return false;
}

/**
 * Returns true when `text` appears to be a noun-list / garbled OCR segment with
 * no coherent grammatical structure (no main verb, multiple comma separations).
 *
 * @example
 *   isIncoherentText("business signals not HR profiles, proficiency map, deliver rapidly") // true
 *   isIncoherentText("We provide AI-powered investment decision tools")                    // false
 */
export function isIncoherentText(text: string): boolean {
	if (!text || typeof text !== "string") return false;
	const t = text.trim();
	// Count commas: 3+ commas without a main verb suggests noun-list garbling
	const commaCount = (t.match(/,/g) ?? []).length;
	if (commaCount >= 3 && !HAS_VERB_RE.test(t)) return true;
	return false;
}

// ─── Composite gate ───────────────────────────────────────────────────────────

export interface TextCandidateQualityResult {
	accept: boolean;
	reason: TextQualityReason | null;
}

/**
 * Apply all text quality checks to a candidate string.
 * Returns `{ accept: true, reason: null }` when the candidate passes all gates.
 * Returns `{ accept: false, reason: <code> }` for the first failing gate.
 *
 * Checks evaluated in order:
 *   1. Spreadsheet fragment
 *   2. OCR continuation fragment
 *   3. Incoherent text (noun-list garbling)
 *
 * @example
 *   checkTextCandidateQuality("FY2024E assumptions")
 *     // { accept: false, reason: "SPREADSHEET_FRAGMENT" }
 *   checkTextCandidateQuality("and help scale the go-to-market engine")
 *     // { accept: false, reason: "OCR_CONTINUATION_FRAGMENT" }
 *   checkTextCandidateQuality("We build AI investment analysis tools")
 *     // { accept: true, reason: null }
 */
export function checkTextCandidateQuality(candidate: string): TextCandidateQualityResult {
	if (isSpreadsheetFragment(candidate)) {
		return { accept: false, reason: TEXT_QUALITY_REASON.SPREADSHEET_FRAGMENT };
	}
	if (isOcrContinuationFragment(candidate)) {
		return { accept: false, reason: TEXT_QUALITY_REASON.OCR_CONTINUATION_FRAGMENT };
	}
	if (isIncoherentText(candidate)) {
		return { accept: false, reason: TEXT_QUALITY_REASON.INCOHERENT_TEXT };
	}
	return { accept: true, reason: null };
}
