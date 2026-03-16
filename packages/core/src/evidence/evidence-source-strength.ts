/**
 * Evidence Source Strength — Phase 1 of the Evidence Weighting System.
 *
 * Defines a canonical ranking of evidence source quality for canonical field
 * extraction.  Downstream consumers use this to prefer stronger sources over
 * weaker ones when multiple candidates exist for the same field.
 *
 * Relationship to EvidenceConfidenceLevel:
 *   - EvidenceSourceStrength describes the *type* of evidence (how reliable is
 *     the source channel?).
 *   - EvidenceConfidenceLevel describes the *outcome* of the full confidence
 *     evaluation (was the value verified, conflicting, etc.?).
 *   - Source strength is an input signal that feeds the confidence evaluator.
 *
 * Ranking (highest to lowest):
 *   XLSX_STRUCTURED       — Structured financial model (Excel / Google Sheets)
 *   DEDICATED_KPI_PAGE    — Labelled KPI or financial summary slide/page
 *   EXECUTIVE_SUMMARY     — Executive summary section with curated metrics
 *   FULL_PAGE_TEXT        — Full pitch deck or document page (substantial text)
 *   EVIDENCE_SNIPPET      — Short extracted evidence clip (< 200 chars)
 *   SINGLE_SHORT_PHRASE   — Very short isolated mention (< 40 chars)
 *   CONTEXT_TAINTED       — Match rejected by context guard (competitor/market)
 */

// ── Strength enum ─────────────────────────────────────────────────────────────

export const EvidenceSourceStrength = {
	/** Structured financial model — highest reliability. */
	XLSX_STRUCTURED: 6,
	/** Dedicated KPI or financial summary page — purpose-built for the metric. */
	DEDICATED_KPI_PAGE: 5,
	/** Executive summary section — curated, authoritative context. */
	EXECUTIVE_SUMMARY: 4,
	/** Full page text — rich context, but metric may be incidental. */
	FULL_PAGE_TEXT: 3,
	/** Short evidence snippet — limited surrounding context. */
	EVIDENCE_SNIPPET: 2,
	/** Very short isolated phrase — low context, high false-positive risk. */
	SINGLE_SHORT_PHRASE: 1,
	/** Rejected by context guard — competitor or market context detected. */
	CONTEXT_TAINTED: 0,
} as const;

export type EvidenceSourceStrength =
	(typeof EvidenceSourceStrength)[keyof typeof EvidenceSourceStrength];

// ── Helper: classify source strength from extraction metadata ─────────────────

/**
 * Regex for detecting dedicated KPI / financial summary slide headings.
 * Fires on lexical markers that typically appear in the heading/title area
 * of purpose-built metric slides.
 */
const KPI_HEADING_RE =
	/\b(?:KPI|key\s+metrics?|traction|financial\s+summary|financial\s+highlights?|revenue\s+summary|P&L|income\s+statement|balance\s+sheet|financials?)\b/i;

/**
 * Regex for detecting executive summary section markers.
 */
const EXEC_SUMMARY_RE =
	/\b(?:executive\s+summary|company\s+overview|investment\s+summary|deal\s+overview|business\s+summary|company\s+snapshot)\b/i;

/**
 * Classify the strength of a text-based evidence source.
 *
 * @param sourceKind - Source channel label ("xlsx", "deck", "derived", "unknown", etc.)
 * @param pageText   - Full text of the evidence page (empty string for snippets).
 * @param snippetLen - Length of the matched snippet in characters.
 * @returns EvidenceSourceStrength rank for use in candidate selection.
 *
 * @example
 * ```ts
 * classifySourceStrength("xlsx", "", 0)   // → XLSX_STRUCTURED (6)
 * classifySourceStrength("deck", longPage, 60) // → DEDICATED_KPI_PAGE (5) if KPI heading
 * classifySourceStrength("deck", "", 30)  // → SINGLE_SHORT_PHRASE (1)
 * ```
 */
export function classifySourceStrength(
	sourceKind: string,
	pageText: string,
	snippetLen: number,
): EvidenceSourceStrength {
	if (sourceKind === "xlsx" || sourceKind === "pdf_table") {
		return EvidenceSourceStrength.XLSX_STRUCTURED;
	}
	if (!pageText || pageText.length === 0) {
		// No page text available — treat as snippet
		return snippetLen < 40
			? EvidenceSourceStrength.SINGLE_SHORT_PHRASE
			: EvidenceSourceStrength.EVIDENCE_SNIPPET;
	}
	if (KPI_HEADING_RE.test(pageText)) {
		return EvidenceSourceStrength.DEDICATED_KPI_PAGE;
	}
	if (EXEC_SUMMARY_RE.test(pageText)) {
		return EvidenceSourceStrength.EXECUTIVE_SUMMARY;
	}
	if (pageText.length >= 200) {
		return EvidenceSourceStrength.FULL_PAGE_TEXT;
	}
	if (snippetLen < 40) {
		return EvidenceSourceStrength.SINGLE_SHORT_PHRASE;
	}
	return EvidenceSourceStrength.EVIDENCE_SNIPPET;
}

/**
 * True when the source strength indicates the evidence should not be promoted
 * to the governed narrative (tainted by competitor/market context).
 */
export function isSourceTainted(strength: EvidenceSourceStrength): boolean {
	return strength === EvidenceSourceStrength.CONTEXT_TAINTED;
}

/**
 * True when the source is at least as reliable as a full-page text reference.
 * Used to gate whether a field can reach STRONG_EVIDENCE without corroboration.
 */
export function isStrongSource(strength: EvidenceSourceStrength): boolean {
	return strength >= EvidenceSourceStrength.FULL_PAGE_TEXT;
}
