/**
 * Field Authority Guard
 *
 * Deterministic pre-filter for promoted facts and post-build structured-summary
 * fill-ins. Runs before buildStructuredSummary to reject facts that are:
 *   - Sourced from forbidden document families (SPAC entity docs, pro forma adjustments)
 *   - Contaminated with known false-positive patterns:
 *       – Liquidation preferences surfaced as "raise"
 *       – Per-share prices surfaced as "raise amount"
 *       – Pro forma transaction adjustment footnotes surfaced as "revenue"
 *   - Implausible given deal type (tiny raise amount in de-SPAC / public company context)
 *
 * Does NOT call LLM, DB, or any external service.
 * Returns guarded facts + rejection log for provenance/debugging.
 *
 * Outputs:
 *   acceptedFacts    — pass these to buildStructuredSummary
 *   rejectedFacts    — full list with reasons for debugging
 *   guardLog         — per-fact decision log; attach to report.metadata
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardRejectionReason = {
  rule_id: string;
  description: string;
};

export type GuardAuthorityTier = 'preferred' | 'acceptable' | 'weak' | 'forbidden';

export type GuardDecision = {
  fact_type: string;
  fact_index: number;
  action: 'accept' | 'reject';
  reasons: GuardRejectionReason[];
  authority_tier: GuardAuthorityTier;
  source_document_id: string | null;
  source_page_index: number | null;
  document_family: string | null;
};

export type FieldAuthorityGuardContext = {
  /**
   * Deal type from business_archetype_v1.value or deal_overview_v2.deal_type.
   * Used for deal-type-specific rules (e.g. 'de_spac' blocks per-share raise values).
   */
  deal_type?: string | null;
  /**
   * Document metadata for family classification.
   * When provided, document filenames/kinds are used to strengthen authority logic.
   */
  documents?: Array<{
    document_id: string;
    kind?: string | null;
    filename?: string | null;
  }> | null;
  /**
   * DIO object — used to read deal_overview_v2.product_solution,
   * governed_ui_copy_v1.product_solution, etc. for null-fill logic.
   */
  dio?: any;
};

export type FieldAuthorityGuardResult = {
  /** Facts that passed all authority checks. Use these in buildStructuredSummary. */
  acceptedFacts: any[];
  /** Facts rejected with reasons. Never pass these to the compiler. */
  rejectedFacts: Array<{ fact: any; reasons: GuardRejectionReason[]; policy: string }>;
  /** Full per-fact decision log. Attach to report.metadata for provenance. */
  guardLog: GuardDecision[];
  /**
   * Structured summary fields that should be set after buildStructuredSummary runs,
   * filled from higher-authority sources (e.g. governed_ui_copy_v1) when the promoted
   * fact layer returned null.
   *
   * Keys match the relevant structured_summary sub-fields.
   */
  structuredSummaryFillIns: {
    product_summary_v1?: { value: string; sources: any[]; confidence: number; authority: string };
    market_summary_v1?: { value: string; sources: any[]; confidence: number; authority: string };
  };
};

// ─── Document family classification — shared with field-candidate-selector ────
// Imported from document-authority-tiers.ts; do NOT duplicate here.
import { classifyDocumentFamily } from './document-authority-tiers.js';

// ─── Value extraction helpers ─────────────────────────────────────────────────

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function getValueJson(fact: any): any {
  const cj = fact?.content_json;
  if (!cj || typeof cj !== 'object') return {};
  return (cj as any)?.value_json ?? (cj as any)?.valueJson ?? {};
}

function getFactType(fact: any): string {
  const root = fact?.fact_type;
  if (typeof root === 'string' && root.trim()) return root.trim();
  const nested = fact?.content_json?.fact_type;
  return typeof nested === 'string' ? nested.trim() : '';
}

function getSourceDocumentId(fact: any): string | null {
  const direct = fact?.source_document_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const prov = fact?.content_json?.provenance;
  const fromProv = prov?.source_document_id;
  if (typeof fromProv === 'string' && fromProv.trim()) return fromProv.trim();
  const fromMeta = fact?.meta?.document_id;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  return null;
}

function getSourcePageIndex(fact: any): number | null {
  const prov = fact?.content_json?.provenance;
  const pi = prov?.page_index;
  if (typeof pi === 'number' && Number.isFinite(pi)) return pi;
  const mi = fact?.meta?.page_index;
  if (typeof mi === 'number' && Number.isFinite(mi)) return mi;
  return null;
}

function getDisplayOrRaw(vj: any): string {
  return asString(vj?.display) || asString(vj?.raw) || asString(vj?.raw_text) || '';
}

function getNoteSnippet(vj: any): string {
  return asString(vj?.note_snippet);
}

function getAmount(vj: any): number | null {
  const raw = vj?.amount?.amount;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  // Sometimes the amount is at the top level of value_json.
  const direct = vj?.amount;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  return null;
}

// ─── Guard policies ───────────────────────────────────────────────────────────

/**
 * POLICY: raise_terms_v1
 *
 * Preferred:  8-K / merger close docs, pitch deck Sources & Uses, financing summary
 * Acceptable: executive summary with dollar amount, confirmed term sheet language
 * Forbidden:  liquidation preferences, per-share prices, cap table rights,
 *             preferred stock original issue prices, warrant tables,
 *             historical convertible note balances used as current raise amount
 *             in a de-SPAC context.
 *
 * The most common false positives (confirmed against Allurion audit 2026-04-09):
 *   - Per-share preferred stock liquidation preference: "$1.092, $2.850, $3.563..."
 *     extracted adjacent to "Series A" → promoted as "$1 Series A Convertible Note"
 */
function guardRaiseTermsV1(
  fact: any,
  context: FieldAuthorityGuardContext,
): { reasons: GuardRejectionReason[]; tier: GuardAuthorityTier } {
  const vj = getValueJson(fact);
  const display = getDisplayOrRaw(vj);
  const noteSnippet = getNoteSnippet(vj);
  const amount = getAmount(vj);
  const docId = getSourceDocumentId(fact);
  const docFamily = classifyDocumentFamily(docId ?? '', context.documents);

  const reasons: GuardRejectionReason[] = [];

  // ── Forbidden text patterns ────────────────────────────────────────────────

  const checkText = `${display} ${noteSnippet}`.toLowerCase();

  if (/liquidation\s+preference/.test(checkText)) {
    reasons.push({
      rule_id: 'raise.liquidation_preference_text',
      description: 'Display or note contains "liquidation preference" — this is cap-table rights language, not a fundraise amount.',
    });
  }

  if (/\bper[- ]share\b/.test(checkText)) {
    reasons.push({
      rule_id: 'raise.per_share_text',
      description: 'Display or note contains "per share" indicating a per-share price, not a total raise amount.',
    });
  }

  if (/original\s+(issu|purchas)/i.test(checkText)) {
    reasons.push({
      rule_id: 'raise.original_issue_price_text',
      description: 'Display or note contains "original issue price" / "original purchase price" indicating preferred stock terms.',
    });
  }

  if (/preferred\s+stock.*\$\s*\d+\.\d{3,}/.test(checkText)) {
    reasons.push({
      rule_id: 'raise.preferred_stock_decimal_price',
      description: 'Display references a preferred stock price with 3+ decimal places, characteristic of a per-share cap table entry.',
    });
  }

  // ── Amount plausibility guards ─────────────────────────────────────────────

  if (amount !== null) {
    // Per-share format: amounts < $5,000 with 3+ decimal places in the raw text
    // or in the actual numeric value (e.g. 1.092 = $1.09 = per-share, not a total raise).
    const isPerShareFormat = !Number.isInteger(amount) && Math.round(amount * 1000) !== amount * 1000;
    const isTinyLikelyPerShare = amount < 5_000;

    if (isTinyLikelyPerShare && isPerShareFormat) {
      reasons.push({
        rule_id: 'raise.tiny_decimal_amount',
        description: `Amount "${amount}" is under $5,000 and has sub-cent precision, consistent with a per-share price, not a raise total.`,
      });
    }

    // In a de-SPAC context the raise is typically ≥$10M. A value below $1M in this
    // context is almost certainly a per-share or liquidation-preference extraction.
    const dealType = asString(context.deal_type).toLowerCase();
    const isDeSpac = dealType === 'de_spac' || dealType === 'despac';
    if (isDeSpac && amount < 1_000_000) {
      reasons.push({
        rule_id: 'raise.despac_tiny_amount',
        description: `Amount "${amount}" is under $1M in a de-SPAC deal. de-SPAC transactions always involve ≥$10M; this value is likely a per-share or accounting term.`,
      });
    }
  }

  // ── Forbidden source families ──────────────────────────────────────────────

  // Raise sourced from SPAC entity financials or pro forma is forbidden.
  if (docFamily === 'spac_financials' || docFamily === 'spac_mda') {
    reasons.push({
      rule_id: 'raise.forbidden_document_family_spac',
      description: `Source document (${docId ?? 'unknown'}) is classified as SPAC entity financials. Raise terms must not be sourced from the SPAC entity's historical statements.`,
    });
  }
  if (docFamily === 'financial_pro_forma') {
    reasons.push({
      rule_id: 'raise.forbidden_document_family_proforma',
      description: `Source document (${docId ?? 'unknown'}) is a pro forma combined statement. Use the 8-K or merger close document for authoritative raise terms.`,
    });
  }

  // Authority tier
  let tier: GuardAuthorityTier = 'acceptable';
  if (docFamily === 'pitch_deck') tier = 'preferred';
  if (docFamily === 'sec_8k_public') tier = 'preferred';
  if (docFamily === 'operating_financials') tier = 'weak'; // fin. notes, not a preferred raise source
  if (docFamily === 'financial_pro_forma' || docFamily === 'spac_financials' || docFamily === 'spac_mda') tier = 'forbidden';
  if (reasons.length > 0) tier = 'forbidden';

  return { reasons, tier };
}

/**
 * POLICY: revenue_v1
 *
 * Preferred:  Operating income statement / financial_facts from operating financials
 * Acceptable: Operating MD&A referencing actual period revenue with clear attribution
 * Forbidden:  Pro forma transaction adjustment footnotes, financing fee expenses,
 *             adjustment journal entries, SPAC entity revenue lines,
 *             fair value changes or debt accounting entries labelled as revenue.
 *
 * The most common false positive (confirmed against Allurion audit 2026-04-09):
 *   - Pro forma EX-99.5 footnote about "transaction adjustment to record the expense
 *     related to the cash settlement of the prepayment and final payment fees"
 *     extracted and promoted as $1.5M revenue.
 */
function guardRevenueV1(
  fact: any,
  context: FieldAuthorityGuardContext,
): { reasons: GuardRejectionReason[]; tier: GuardAuthorityTier } {
  const vj = getValueJson(fact);
  const display = getDisplayOrRaw(vj);
  const noteSnippet = getNoteSnippet(vj);
  const docId = getSourceDocumentId(fact);
  const docFamily = classifyDocumentFamily(docId ?? '', context.documents);

  const reasons: GuardRejectionReason[] = [];
  const checkText = `${display} ${noteSnippet}`.toLowerCase();

  // ── Forbidden text patterns in note/display ────────────────────────────────

  if (/transaction\s+adjustment/.test(checkText)) {
    reasons.push({
      rule_id: 'revenue.transaction_adjustment_text',
      description: 'Note or display contains "transaction adjustment" — this is a pro forma accounting entry, not operating revenue.',
    });
  }

  if (/adjustment\s+to\s+record/.test(checkText)) {
    reasons.push({
      rule_id: 'revenue.adjustment_journal_entry',
      description: 'Note or display contains "adjustment to record" indicating a journal entry, not a revenue line.',
    });
  }

  if (/pro[\s-]forma\s+adjustment/.test(checkText)) {
    reasons.push({
      rule_id: 'revenue.proforma_adjustment_text',
      description: 'Note or display contains "pro forma adjustment" — pro forma adjustments are not operating revenue.',
    });
  }

  if (/prepayment.*fee|settlement.*fee|final\s+payment\s+fee/.test(checkText)) {
    reasons.push({
      rule_id: 'revenue.financing_fee_text',
      description: 'Note or display references prepayment or settlement fees — this is a financing cost, not operating revenue.',
    });
  }

  if (/\bfair\s+value\s+change/.test(checkText) || /changes?\s+in\s+fair\s+value/.test(checkText)) {
    reasons.push({
      rule_id: 'revenue.fair_value_change',
      description: 'Note or display references "fair value change" — this is a non-cash accounting item, not operating revenue.',
    });
  }

  // ── Forbidden source families ──────────────────────────────────────────────

  if (docFamily === 'spac_financials' || docFamily === 'spac_mda') {
    reasons.push({
      rule_id: 'revenue.forbidden_document_family_spac',
      description: `Source document (${docId ?? 'unknown'}) classified as SPAC entity financials. Revenue must come from the operating company's statements.`,
    });
  }
  if (docFamily === 'financial_pro_forma') {
    reasons.push({
      rule_id: 'revenue.forbidden_document_family_proforma',
      description: `Source document (${docId ?? 'unknown'}) is a pro forma combined statement. Pro forma adjustments are not operating revenue.`,
    });
  }

  // Authority tier
  let tier: GuardAuthorityTier = 'acceptable';
  if (reasons.length > 0) tier = 'forbidden';

  return { reasons, tier };
}

/**
 * POLICY: business_model_v1
 *
 * Preferred:  Explicit business model slides from pitch deck, operating narrative
 * Acceptable: Operating MD&A with explicit channel/model description
 * Weak:       Revenue-recognition or distribution language from MD&A (generic)
 * Forbidden:  SPAC entity financial statements, pro forma combined documents,
 *             balance sheet accounting policy notes.
 */
function guardBusinessModelV1(
  fact: any,
  context: FieldAuthorityGuardContext,
): { reasons: GuardRejectionReason[]; tier: GuardAuthorityTier } {
  const docId = getSourceDocumentId(fact);
  const docFamily = classifyDocumentFamily(docId ?? '', context.documents);

  const reasons: GuardRejectionReason[] = [];

  // Forbidden source families for business model.
  if (docFamily === 'spac_financials' || docFamily === 'spac_mda') {
    reasons.push({
      rule_id: 'business_model.forbidden_document_family_spac',
      description: `Source document (${docId ?? 'unknown'}) is SPAC entity financials — business model must be sourced from the operating company.`,
    });
  }
  if (docFamily === 'financial_pro_forma') {
    reasons.push({
      rule_id: 'business_model.forbidden_document_family_proforma',
      description: `Source document (${docId ?? 'unknown'}) is a pro forma combined statement — not a valid source for business model classification.`,
    });
  }

  // Authority tier
  let tier: GuardAuthorityTier = 'acceptable';
  if (docFamily === 'pitch_deck') tier = 'preferred';
  if (docFamily === 'operating_mda') tier = 'acceptable';
  if (docFamily === 'operating_financials') tier = 'weak';
  if (docFamily === 'financial_pro_forma' || docFamily === 'spac_financials' || docFamily === 'spac_mda') tier = 'forbidden';
  if (reasons.length > 0) tier = 'forbidden';

  return { reasons, tier };
}

// ─── Structured summary fill-in logic ────────────────────────────────────────

/**
 * Build fill-in candidates for product_summary_v1 and market_summary_v1 from
 * higher-authority sources when promoted facts did not supply them.
 *
 * Source priority:
 *   1. deal_overview_v2.product_solution / .market_icp  (structured extraction)
 *   2. governed_ui_copy_v1.product_solution / .market_icp  (LLM synthesis)
 *
 * These are only used when the compiled structured_summary has null values.
 */
function buildStructuredSummaryFillIns(
  context: FieldAuthorityGuardContext,
): FieldAuthorityGuardResult['structuredSummaryFillIns'] {
  const out: FieldAuthorityGuardResult['structuredSummaryFillIns'] = {};
  const phase1 = context.dio?.dio?.phase1;
  if (!phase1) return out;

  const overview = phase1?.deal_overview_v2;
  const uiCopy = phase1?.governed_ui_copy_v1;

  // Product fill-in
  const productFromOverview = asString(overview?.product_solution) || null;
  const productFromUiCopy = asString(uiCopy?.product_solution) || null;
  const bestProduct = productFromOverview ?? productFromUiCopy ?? null;
  if (bestProduct && bestProduct.length > 10) {
    const authority = productFromOverview ? 'deal_overview_v2' : 'governed_ui_copy_v1';
    out.product_summary_v1 = {
      value: bestProduct,
      confidence: productFromOverview ? 0.75 : 0.6,
      authority,
      sources: [{ kind: `phase1.${authority}`, field: 'product_solution' }],
    };
  }

  // Market fill-in
  const marketFromOverview = asString(overview?.market_icp) || null;
  const marketFromUiCopy = asString(uiCopy?.market_icp) || null;
  const bestMarket = marketFromOverview ?? marketFromUiCopy ?? null;
  if (bestMarket && bestMarket.length > 10) {
    const authority = marketFromOverview ? 'deal_overview_v2' : 'governed_ui_copy_v1';
    out.market_summary_v1 = {
      value: bestMarket,
      confidence: marketFromOverview ? 0.75 : 0.6,
      authority,
      sources: [{ kind: `phase1.${authority}`, field: 'market_icp' }],
    };
  }

  return out;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Apply deterministic field authority policies to a set of promoted facts.
 *
 * Returns:
 *   - acceptedFacts: facts that passed all policies
 *   - rejectedFacts: facts that failed, with reasons
 *   - guardLog: full per-fact decision log
 *   - structuredSummaryFillIns: derived product/market values from DIO when
 *       promoted facts don't supply them
 *
 * @param facts         Raw promoted facts from the database.
 * @param context       Deal-type and document metadata for policy evaluation.
 */
export function applyFieldAuthorityGuards(
  facts: any[],
  context: FieldAuthorityGuardContext,
): FieldAuthorityGuardResult {
  const acceptedFacts: any[] = [];
  const rejectedFacts: FieldAuthorityGuardResult['rejectedFacts'] = [];
  const guardLog: GuardDecision[] = [];

  const inputFacts = Array.isArray(facts) ? facts : [];

  for (let i = 0; i < inputFacts.length; i++) {
    const fact = inputFacts[i];
    const factType = getFactType(fact);
    const docId = getSourceDocumentId(fact);
    const pageIndex = getSourcePageIndex(fact);
    const docFamily = classifyDocumentFamily(docId ?? '', context.documents);

    let reasons: GuardRejectionReason[] = [];
    let tier: GuardAuthorityTier = 'acceptable';

    if (factType === 'raise_terms_v1') {
      const result = guardRaiseTermsV1(fact, context);
      reasons = result.reasons;
      tier = result.tier;
    } else if (factType === 'revenue_v1') {
      const result = guardRevenueV1(fact, context);
      reasons = result.reasons;
      tier = result.tier;
    } else if (factType === 'business_model_v1') {
      const result = guardBusinessModelV1(fact, context);
      reasons = result.reasons;
      tier = result.tier;
    }

    const action: 'accept' | 'reject' = reasons.length > 0 ? 'reject' : 'accept';

    guardLog.push({
      fact_type: factType,
      fact_index: i,
      action,
      reasons,
      authority_tier: tier,
      source_document_id: docId,
      source_page_index: pageIndex,
      document_family: docFamily === 'unknown' ? null : docFamily,
    });

    if (action === 'accept') {
      acceptedFacts.push(fact);
    } else {
      rejectedFacts.push({
        fact,
        reasons,
        policy: `field_authority:${factType}`,
      });
    }
  }

  const structuredSummaryFillIns = buildStructuredSummaryFillIns(context);

  return { acceptedFacts, rejectedFacts, guardLog, structuredSummaryFillIns };
}

/**
 * Apply fill-in values to a structured summary object in-place.
 *
 * Called AFTER buildStructuredSummary to populate product_summary_v1 and
 * market_summary_v1 when those fields are null but higher-authority sources
 * (governed_ui_copy_v1, deal_overview_v2) have values.
 */
export function applyStructuredSummaryFillIns(
  structuredSummary: Record<string, any>,
  fillIns: FieldAuthorityGuardResult['structuredSummaryFillIns'],
): void {
  if (fillIns.product_summary_v1 && !structuredSummary.product_summary_v1?.value) {
    structuredSummary.product_summary_v1 = fillIns.product_summary_v1;
  }
  if (fillIns.market_summary_v1 && !structuredSummary.market_summary_v1?.value) {
    structuredSummary.market_summary_v1 = fillIns.market_summary_v1;
  }
}
