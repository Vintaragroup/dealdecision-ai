/**
 * Document Authority Tiers
 *
 * Canonical document family classification and authority ranking.
 * Used by:
 *   - field-authority-guard.ts  (blocking pre-filter)
 *   - field-candidate-selector.ts (positive selection ranking)
 *   - final-publish-guard.ts (output-phase validation)
 *
 * Authority ranks represent how trustworthy a document family is as a source
 * for a given field. Ranks are field-specific because a pitch deck is the best
 * source for business_model but only a moderate source for raise amounts.
 */

// ─── Document family type ──────────────────────────────────────────────────────

export type DocumentFamily =
  | 'operating_financials'    // EX-99.1 / audited operating company income statement
  | 'operating_mda'           // EX-99.2 / operating company MD&A
  | 'sec_8k_public'           // Form 8-K — merger close / financing announcement
  | 'pitch_deck'              // Investor deck / pitch materials
  | 'financial_pro_forma'     // EX-99.5 / pro forma combined statements (merger mechanics)
  | 'spac_financials'         // EX-99.3 / SPAC entity historical financial statements
  | 'spac_mda'                // EX-99.4 / SPAC entity management discussion
  | 'legal_exhibit'           // Merger agreement, legal exhibits
  | 'proxy_prospectus'        // Proxy statement, S-4 prospectus
  | 'registration_statement'  // S-1, S-4 registration statements
  | 'offering_memorandum'     // CRE / private-placement offering memorandum — investment vehicle docs
  | 'investment_memo'         // Internal investment committee memo — narrative, not structured data
  | 'unknown';                // Unclassified / insufficient metadata

// ─── Default (field-agnostic) authority rank ──────────────────────────────────

/**
 * Default authority rank for each document family.
 * Higher = more authoritative. Use field-specific overrides where appropriate.
 *
 * FORBIDDEN families (spac_financials, spac_mda, financial_pro_forma) have very
 * low ranks — they should not win competitive selection for any operating-company
 * field.
 */
export const DOCUMENT_AUTHORITY_RANK: Record<DocumentFamily, number> = {
  operating_financials: 100,    // Actual income statements — highest trust for financial facts
  sec_8k_public: 95,            // Public merger/financing announcement — highest trust for raise terms
  operating_mda: 80,            // Operating company narrative — good for BM, revenue context
  pitch_deck: 75,               // Investor deck — good for BM, product, market; moderate for raise
  registration_statement: 55,   // S-1/S-4 — useful but often boilerplate
  proxy_prospectus: 50,         // Proxy — useful for deal mechanics
  legal_exhibit: 45,            // legal text — limited for financial facts
  investment_memo: 42,          // Narrative memo — contextual, not structured data
  unknown: 40,                  // Unknown source — use with caution
  offering_memorandum: 30,      // CRE/private-placement OM — investment vehicle, not company ops
  financial_pro_forma: 20,      // Pro forma — merger mechanics only, NOT operating data
  spac_financials: 5,           // SPAC entity only — NOT operating company data
  spac_mda: 5,                  // SPAC entity only — NOT operating company data
};

// ─── Field-specific authority rank tables ─────────────────────────────────────

/**
 * For RAISE TERMS:
 *   - 8-K is the canonical source for de-SPAC / public financing
 *   - Deck Sources & Uses is acceptable for pre-IPO / startup
 *   - Operating financials note pages are NOT a preferred raise source
 *   - Pro forma / SPAC docs are FORBIDDEN
 */
export const RAISE_AUTHORITY_RANK: Record<DocumentFamily, number> = {
  sec_8k_public: 100,
  pitch_deck: 80,
  operating_mda: 65,
  operating_financials: 40,     // Financial notes often contain confusing preference tables
  registration_statement: 55,
  proxy_prospectus: 50,
  legal_exhibit: 35,
  investment_memo: 35,          // Memo may state investment size but not reliable for transaction terms
  unknown: 30,
  offering_memorandum: 25,      // OM investment targets are not closed-deal raise amounts
  financial_pro_forma: 5,
  spac_financials: 5,
  spac_mda: 5,
};

/**
 * For REVENUE:
 *   - Operating financials income statement is the canonical source
 *   - Operating MD&A is acceptable for revenue narrative
 *   - Pitch deck revenue is acceptable only when no actuals exist (projected)
 *   - Pro forma / SPAC docs are FORBIDDEN
 */
export const REVENUE_AUTHORITY_RANK: Record<DocumentFamily, number> = {
  operating_financials: 100,
  operating_mda: 85,
  sec_8k_public: 65,            // 8-K sometimes includes revenue highlights
  registration_statement: 60,
  proxy_prospectus: 55,
  pitch_deck: 50,               // Deck revenue is often projected / marketing
  legal_exhibit: 30,
  investment_memo: 30,          // Narrative revenue mentions in memos — low reliability
  unknown: 35,
  offering_memorandum: 20,      // OM projected NOI/revenue = proforma asset projection, not ops
  financial_pro_forma: 5,       // Pro forma revenue = merger adjustments, NOT operating
  spac_financials: 5,
  spac_mda: 5,
};

/**
 * For BUSINESS MODEL:
 *   - Pitch deck is the canonical source for business model framing
 *   - Operating MD&A is acceptable for channel/revenue structure
 *   - Financial statements are WEAK for business model (they show accounting, not model)
 *   - Pro forma / SPAC docs are FORBIDDEN
 */
export const BUSINESS_MODEL_AUTHORITY_RANK: Record<DocumentFamily, number> = {
  pitch_deck: 100,
  operating_mda: 80,
  sec_8k_public: 60,
  registration_statement: 55,
  proxy_prospectus: 50,
  legal_exhibit: 30,
  investment_memo: 25,          // Investment memos describe deal structure, not company BM
  operating_financials: 25,     // Financial statements describe accounting, not business model
  unknown: 35,
  offering_memorandum: 10,      // OMs describe investment vehicle terms, never company BM
  financial_pro_forma: 5,
  spac_financials: 5,
  spac_mda: 5,
};

// ─── Classification tables ─────────────────────────────────────────────────────

/** Maps document `kind` field values to DocumentFamily. */
export const KIND_TO_FAMILY: Record<string, DocumentFamily> = {
  pitch_deck: 'pitch_deck',
  investor_deck: 'pitch_deck',
  sec_8k: 'sec_8k_public',
  form_8k: 'sec_8k_public',
  financial_statements: 'operating_financials',
  financial_statements_interim: 'operating_financials',
  financial_mda: 'operating_mda',
  financial_pro_forma: 'financial_pro_forma',
  spac_financials: 'spac_financials',
  spac_mda: 'spac_mda',
  proxy: 'proxy_prospectus',
  prospectus: 'proxy_prospectus',
  registration_statement: 'registration_statement',
  legal_exhibit: 'legal_exhibit',
  offering_memorandum: 'offering_memorandum',
  offering_memo: 'offering_memorandum',
  investment_memo: 'investment_memo',
  investment_committee_memo: 'investment_memo',
};

/** Filename patterns → DocumentFamily, in priority order. */
export const FILENAME_TO_FAMILY_PATTERNS: Array<[RegExp, DocumentFamily]> = [
  [/\bdeck\b|investor[\s_-]deck|pitch[\s_-]deck/i, 'pitch_deck'],
  [/8[\s_-]k\b|form[\s_-]8k|form8k/i, 'sec_8k_public'],
  [/ex[\s_-]99[\s_-]?\.?1\b|exhibit[\s_-]99[\s_-]?\.?1\b|ex991/i, 'operating_financials'],
  [/ex[\s_-]99[\s_-]?\.?2\b|ex992/i, 'operating_mda'],
  [/ex[\s_-]99[\s_-]?\.?3\b|ex993/i, 'spac_financials'],
  [/ex[\s_-]99[\s_-]?\.?4\b|ex994/i, 'spac_mda'],
  [/ex[\s_-]99[\s_-]?\.?5\b|ex995/i, 'financial_pro_forma'],
  [/pro[\s_-]?forma/i, 'financial_pro_forma'],
  [/offering[\s_-]memo(?:randum)?/i, 'offering_memorandum'],
  [/investment[\s_-]memo(?:randum)?/i, 'investment_memo'],
  [/ic[\s_-]?memo|deal[\s_-]memo/i, 'investment_memo'],
  [/s[\s_-]?[14]\b/i, 'registration_statement'],
  [/proxy|prospectus/i, 'proxy_prospectus'],
  [/merger\s+agreement|exhibit[\s_-]?[ab]/i, 'legal_exhibit'],
];

// ─── Document metadata type ────────────────────────────────────────────────────

export type DocumentMeta = {
  document_id: string;
  kind?: string | null;
  filename?: string | null;
};

// ─── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify a document into a DocumentFamily using:
 *   1. document.kind (if in KIND_TO_FAMILY map)
 *   2. document.filename patterns
 *   3. Falls back to 'unknown'
 *
 * @param documentId  The document ID to look up.
 * @param documents   Array of document metadata objects from the DB or DIO.
 */
export function classifyDocumentFamily(
  documentId: string,
  documents: DocumentMeta[] | null | undefined,
): DocumentFamily {
  if (!Array.isArray(documents) || !documentId) return 'unknown';
  const doc = documents.find((d) => d.document_id === documentId);
  if (!doc) return 'unknown';

  // Kind takes precedence when known.
  const kind = (doc.kind ?? '').toLowerCase().trim();
  if (kind && KIND_TO_FAMILY[kind]) return KIND_TO_FAMILY[kind];

  // Fall back to filename pattern matching.
  const filename = (doc.filename ?? '').toLowerCase();
  if (filename) {
    for (const [pattern, family] of FILENAME_TO_FAMILY_PATTERNS) {
      if (pattern.test(filename)) return family;
    }
  }

  return 'unknown';
}

/**
 * Get the authority rank for a document family in the context of a specific field.
 *
 * @param family  The classified document family.
 * @param field   The target field: 'raise' | 'revenue' | 'business_model' | 'general'
 */
export function getAuthorityRank(
  family: DocumentFamily,
  field: 'raise' | 'revenue' | 'business_model' | 'general',
): number {
  switch (field) {
    case 'raise': return RAISE_AUTHORITY_RANK[family] ?? RAISE_AUTHORITY_RANK.unknown;
    case 'revenue': return REVENUE_AUTHORITY_RANK[family] ?? REVENUE_AUTHORITY_RANK.unknown;
    case 'business_model': return BUSINESS_MODEL_AUTHORITY_RANK[family] ?? BUSINESS_MODEL_AUTHORITY_RANK.unknown;
    default: return DOCUMENT_AUTHORITY_RANK[family] ?? DOCUMENT_AUTHORITY_RANK.unknown;
  }
}

/**
 * Returns true if this document family is forbidden for a given field type.
 * Forbidden families should be rejected at the guard level.
 */
export function isForbiddenFamily(family: DocumentFamily, _field?: string): boolean {
  return family === 'spac_financials' || family === 'spac_mda' || family === 'financial_pro_forma';
}
