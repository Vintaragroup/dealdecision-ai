/**
 * Field Candidate Selector
 *
 * Positive-selection layer that runs AFTER the field-authority guard.
 * Given a set of accepted promoted facts, it ranks them by:
 *   1. Document authority tier (field-specific ranks)
 *   2. Positive content signals (preferred text patterns for each field)
 *   3. Confidence as a secondary tiebreaker (NOT the primary selector)
 *
 * For each target field type, the selector:
 *   - Scores every candidate
 *   - Selects the highest-scoring winner
 *   - Demotes (removes) all other candidates of that type
 *   - Records provenance: why the winner won, why others lost
 *
 * Returns:
 *   `orderedFacts`    — promoted facts with one winner per field type placed
 *                       first; weaker same-type candidates are dropped.
 *                       Non-targeted field types (market_size, valuation, etc.)
 *                       pass through untouched.
 *   `selectionLog`    — full per-field selection record (wire to report metadata)
 *
 * Pure function — no DB, no LLM, no side effects.
 */

import {
  classifyDocumentFamily,
  getAuthorityRank,
  type DocumentFamily,
  type DocumentMeta,
} from './document-authority-tiers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CandidateAnnotation = {
  fact_index: number;
  document_family: DocumentFamily;
  authority_rank: number;
  positive_signals: string[];
  penalty_signals: string[];
  final_score: number;
  confidence: number;
  source_document_id: string | null;
  source_page_index: number | null;
  selection_rationale: string | null;
};

export type FieldSelectionRecord = {
  field: 'raise_terms_v1' | 'revenue_v1' | 'business_model_v1';
  candidates: CandidateAnnotation[];
  winner_index: number | null;
  winner_rationale: string | null;
  rejected_indices: number[];
  rejected_reasons: string[];
};

export type FieldCandidateSelectorContext = {
  deal_type?: string | null;
  documents?: DocumentMeta[] | null;
};

export type FieldCandidateSelectorResult = {
  /** Promoted facts with winners placed first per field type; weaker same-type candidates dropped. */
  orderedFacts: any[];
  /** Full per-field selection log. */
  selectionLog: FieldSelectionRecord[];
  /** Map of field_type → winner fact (for reference). */
  winnersByField: Record<string, any>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFactType(fact: any): string {
  const root = fact?.fact_type;
  if (typeof root === 'string' && root.trim()) return root.trim();
  return String(fact?.content_json?.fact_type ?? '').trim();
}

function getValueJson(fact: any): any {
  const cj = fact?.content_json;
  if (!cj || typeof cj !== 'object') return {};
  return (cj as any)?.value_json ?? (cj as any)?.valueJson ?? {};
}

function getSourceDocumentId(fact: any): string | null {
  const d = fact?.source_document_id;
  if (typeof d === 'string' && d.trim()) return d.trim();
  const p = fact?.content_json?.provenance?.source_document_id;
  if (typeof p === 'string' && p.trim()) return p.trim();
  const m = fact?.meta?.document_id;
  if (typeof m === 'string' && m.trim()) return m.trim();
  return null;
}

function getSourcePageIndex(fact: any): number | null {
  const pi = fact?.content_json?.provenance?.page_index ?? fact?.meta?.page_index;
  return typeof pi === 'number' && Number.isFinite(pi) ? pi : null;
}

function getAmount(vj: any): number | null {
  const a = vj?.amount?.amount;
  if (typeof a === 'number' && Number.isFinite(a)) return a;
  const d = vj?.amount;
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  return null;
}

function getConf(fact: any): number {
  const c = fact?.confidence;
  return typeof c === 'number' && Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5;
}

function getCheckText(fact: any): string {
  const vj = getValueJson(fact);
  const display = String(vj?.display ?? vj?.raw_text ?? vj?.raw ?? '');
  const note = String(vj?.note_snippet ?? vj?.note ?? '');
  const slidetitle = String(fact?.content_json?.provenance?.slide_title ?? '');
  return `${display} ${note} ${slidetitle}`.toLowerCase();
}

// ─── Raise scoring ────────────────────────────────────────────────────────────

/**
 * Score a raise_terms_v1 candidate.
 *
 * Strong positive signals (transaction-level evidence):
 *   - "gross proceeds", "PIPE", "sources and uses", "sources & uses"
 *   - "business combination", "merger consideration", "closing"
 *   - "financing commitment", "debt facility", "term loan", "RIF"
 *   - "$__M" amounts ≥ $5M (round, institutional amounts)
 *
 * Penalty signals (non-transaction evidence):
 *   - "liquidation preference", "per share", "original issue price"
 *   - Very small decimal amounts (< $5K) — per-share pricing
 */
function scoreRaiseCandidate(
  fact: any,
  docFamily: DocumentFamily,
  dealType: string | null,
): { score: number; positiveSignals: string[]; penaltySignals: string[] } {
  const vj = getValueJson(fact);
  const text = getCheckText(fact);
  const amount = getAmount(vj);
  const authorityRank = getAuthorityRank(docFamily, 'raise');
  const conf = getConf(fact);

  const positiveSignals: string[] = [];
  const penaltySignals: string[] = [];

  let score = authorityRank;

  // Positive text signals
  if (/gross\s+proceeds/.test(text)) { score += 25; positiveSignals.push('gross_proceeds'); }
  if (/\bpipe\b/.test(text)) { score += 20; positiveSignals.push('pipe'); }
  if (/sources?\s*(&|and)\s*uses?/.test(text)) { score += 20; positiveSignals.push('sources_and_uses'); }
  if (/business\s+combination|merger\s+consideration/.test(text)) { score += 15; positiveSignals.push('business_combination'); }
  if (/\bclosing\b.*\$|\$.*\bclosing\b/.test(text)) { score += 12; positiveSignals.push('closing_amount'); }
  if (/\bterm\s+loan\b|\bdebt\s+facility\b|\bRIF\b/.test(text)) { score += 10; positiveSignals.push('debt_facility'); }
  if (/revenue\s+interest\s+financ/.test(text)) { score += 10; positiveSignals.push('revenue_interest_financing'); }
  if (/non[\s-]?redeeming/.test(text)) { score += 8; positiveSignals.push('non_redeeming_spac'); }

  // Amount plausibility
  if (amount !== null) {
    if (amount >= 1_000_000) { score += 30; positiveSignals.push('institutional_amount'); }
    if (amount >= 10_000_000) { score += 20; positiveSignals.push('large_transaction_amount'); }
  }

  // Penalty signals
  if (/liquidation\s+preference/.test(text)) { score -= 100; penaltySignals.push('liquidation_preference'); }
  if (/\bper[- ]share\b/.test(text)) { score -= 80; penaltySignals.push('per_share'); }
  if (/original\s+(issu|purchas)/.test(text)) { score -= 80; penaltySignals.push('original_issue_price'); }
  if (amount !== null && amount < 5_000) { score -= 80; penaltySignals.push('tiny_subunit_amount'); }

  // de-SPAC plausibility: raise should be ≥ $10M
  const isDeSpac = String(dealType ?? '').toLowerCase().replace(/[-_]/g, '') === 'despac';
  if (isDeSpac && amount !== null && amount < 1_000_000) {
    score -= 80;
    penaltySignals.push('despac_implausible_raise');
  }

  // Confidence as secondary factor (max 5 points)
  score += conf * 5;

  return { score, positiveSignals, penaltySignals };
}

// ─── Revenue scoring ──────────────────────────────────────────────────────────

/**
 * Score a revenue_v1 candidate.
 *
 * Strong positive signals (operating company revenue):
 *   - Sourced from operating_financials — large authority bonus
 *   - "revenue", "net revenue", "total revenue" in income statement context
 *   - Specific year reference (historical > projected)
 *   - "H1", "H2", "first half", "six months ended"
 *
 * Penalty signals:
 *   - "forecast", "projected", "estimated", "target" → projected revenue
 *   - "transaction adjustment", "adjustment to record" → accounting entry
 *   - "pro forma" → not operating
 */
function scoreRevenueCandidate(
  fact: any,
  docFamily: DocumentFamily,
): { score: number; positiveSignals: string[]; penaltySignals: string[] } {
  const vj = getValueJson(fact);
  const text = getCheckText(fact);
  const amount = getAmount(vj);
  const authorityRank = getAuthorityRank(docFamily, 'revenue');
  const conf = getConf(fact);

  const positiveSignals: string[] = [];
  const penaltySignals: string[] = [];

  let score = authorityRank;

  // Positive signals
  if (docFamily === 'operating_financials') { score += 40; positiveSignals.push('operating_financials_source'); }
  if (/\bnet\s+revenue\b|\btotal\s+revenue\b/.test(text)) { score += 15; positiveSignals.push('explicit_revenue_label'); }
  if (/\bH[12]\b|first\s+half|second\s+half|six\s+months\s+ended/.test(text)) { score += 12; positiveSignals.push('interim_period'); }
  if (/\b(201\d|202\d)\b/.test(text)) { score += 8; positiveSignals.push('year_referenced'); }
  if (/income\s+statement|statement\s+of\s+operations/.test(text)) { score += 15; positiveSignals.push('income_statement_context'); }
  if (amount !== null && amount >= 1_000_000) { score += 10; positiveSignals.push('material_amount'); }
  if (amount !== null && amount >= 10_000_000) { score += 15; positiveSignals.push('large_operating_amount'); }

  // Penalty signals
  if (/\bforecast(ed)?\b|\bproject(ed|ion)?\b|\bestimate[ds]?\b|\btarget(ed)?\b/.test(text)) {
    score -= 25; penaltySignals.push('projected_not_actual');
  }
  if (/transaction\s+adjustment|adjustment\s+to\s+record/.test(text)) {
    score -= 100; penaltySignals.push('accounting_adjustment');
  }
  if (/pro[\s-]?forma/.test(text)) {
    score -= 80; penaltySignals.push('pro_forma');
  }
  if (/prepayment.*fee|settlement.*fee|final\s+payment\s+fee/.test(text)) {
    score -= 90; penaltySignals.push('financing_fee');
  }

  // Confidence as secondary factor
  score += conf * 5;

  return { score, positiveSignals, penaltySignals };
}

// ─── Business model scoring ───────────────────────────────────────────────────

/**
 * Score a business_model_v1 candidate.
 *
 * Strong positive signals (specific channel/model language):
 *   - "B2B2C", "B2B", "B2C", "DTC", "direct-to-consumer"
 *   - "HCP", "healthcare provider", "physician", "clinician"
 *   - "medical device", "procedure", "therapeutic"
 *   - "Virtual Care Suite", "VCS", "SaaS", "subscription"
 *   - "Marketplace", "platform", "commission"
 *
 * Penalty signals (generic distribution terms from financial docs):
 *   - "wholesale" / "retail" alone without B2B framing
 *   - "accounts receivable", "trade receivable", "inventory" sourced from financials
 *   - Any fact with source from operating_financials for BM field (accounting, not model)
 */
function scoreBusinessModelCandidate(
  fact: any,
  docFamily: DocumentFamily,
): { score: number; positiveSignals: string[]; penaltySignals: string[] } {
  const text = getCheckText(fact);
  const authorityRank = getAuthorityRank(docFamily, 'business_model');
  const conf = getConf(fact);

  const positiveSignals: string[] = [];
  const penaltySignals: string[] = [];

  let score = authorityRank;

  // Positive signals — specific model language
  if (/\bB2B2C\b/i.test(text)) { score += 50; positiveSignals.push('B2B2C'); }
  if (/\bB2B\b/i.test(text)) { score += 30; positiveSignals.push('B2B'); }
  if (/\bHCP\b|healthcare\s+provider|medical\s+provider|clinical/i.test(text)) { score += 30; positiveSignals.push('HCP_channel'); }
  if (/\bDTC\b|direct[\s-]to[\s-]consumer/i.test(text)) { score += 25; positiveSignals.push('DTC'); }
  if (/\bSaaS\b|subscription|recurring\s+revenue|virtual\s+care/i.test(text)) { score += 20; positiveSignals.push('SaaS_recurring'); }
  if (/\bmarketplace\b|platform\s+fee|\bcommission\b|take[\s-]rate/i.test(text)) { score += 15; positiveSignals.push('marketplace'); }
  if (/medical\s+device|therapeutic|procedure[\s-]?less/i.test(text)) { score += 15; positiveSignals.push('medtech_context'); }
  if (/physician|doctor|hospital|bariatric|clinic/i.test(text)) { score += 10; positiveSignals.push('medical_profession'); }
  if (/\bVCS\b|Virtual\s+Care\s+Suite/i.test(text)) { score += 15; positiveSignals.push('VCS'); }

  // Pitch deck strongly preferred for business model framing
  if (docFamily === 'pitch_deck') { score += 30; positiveSignals.push('pitch_deck_source'); }

  // Penalty signals — generic/accounting language
  if (/\bwholesale\b/i.test(text) && !/\bB2B/i.test(text) && !/HCP|healthcare|medical/i.test(text)) {
    score -= 20; penaltySignals.push('generic_wholesale');
  }
  if (/\bretail\b/i.test(text) && docFamily !== 'pitch_deck') {
    score -= 15; penaltySignals.push('generic_retail_non_deck');
  }
  if (docFamily === 'operating_financials') {
    score -= 30; penaltySignals.push('financial_statement_source');
  }

  // Confidence as secondary factor
  score += conf * 5;

  return { score, positiveSignals, penaltySignals };
}

// ─── Selector core ────────────────────────────────────────────────────────────

const TARGETED_FIELDS = new Set(['raise_terms_v1', 'revenue_v1', 'business_model_v1']);

/**
 * Score a fact for a given field using the appropriate scoring function.
 */
function scoreFact(
  fact: any,
  fieldType: string,
  docFamily: DocumentFamily,
  context: FieldCandidateSelectorContext,
): { score: number; positiveSignals: string[]; penaltySignals: string[] } {
  switch (fieldType) {
    case 'raise_terms_v1':
      return scoreRaiseCandidate(fact, docFamily, context.deal_type ?? null);
    case 'revenue_v1':
      return scoreRevenueCandidate(fact, docFamily);
    case 'business_model_v1':
      return scoreBusinessModelCandidate(fact, docFamily);
    default:
      return { score: 50, positiveSignals: [], penaltySignals: [] };
  }
}

/**
 * Select the best candidate fact per targeted field type.
 *
 * @param facts    Accepted (post-guard) promoted facts.
 * @param context  Deal type and document metadata for authority scoring.
 */
export function selectBestCandidatesPerField(
  facts: any[],
  context: FieldCandidateSelectorContext,
): FieldCandidateSelectorResult {
  const inputFacts = Array.isArray(facts) ? facts : [];
  const docs = context.documents ?? null;

  // Group facts by field type
  const byField: Record<string, Array<{ fact: any; index: number }>> = {};
  const nonTargeted: Array<{ fact: any; originalIndex: number }> = [];

  for (let i = 0; i < inputFacts.length; i++) {
    const fact = inputFacts[i];
    const ft = getFactType(fact);
    if (TARGETED_FIELDS.has(ft)) {
      if (!byField[ft]) byField[ft] = [];
      byField[ft].push({ fact, index: i });
    } else {
      nonTargeted.push({ fact, originalIndex: i });
    }
  }

  const selectionLog: FieldSelectionRecord[] = [];
  const winnersByField: Record<string, any> = {};
  const winnerFacts: any[] = [];

  for (const fieldType of Object.keys(byField) as Array<keyof typeof byField>) {
    const group = byField[fieldType];

    const annotated: Array<CandidateAnnotation & { fact: any }> = group.map(({ fact, index }) => {
      const docId = getSourceDocumentId(fact);
      const docFamily = classifyDocumentFamily(docId ?? '', docs);
      const { score, positiveSignals, penaltySignals } = scoreFact(fact, fieldType, docFamily, context);
      const conf = getConf(fact);
      return {
        fact,
        fact_index: index,
        document_family: docFamily,
        authority_rank: getAuthorityRank(docFamily, fieldType as 'raise' | 'revenue' | 'business_model' | 'general'),
        positive_signals: positiveSignals,
        penalty_signals: penaltySignals,
        final_score: score,
        confidence: conf,
        source_document_id: getSourceDocumentId(fact),
        source_page_index: getSourcePageIndex(fact),
        selection_rationale: null,
      };
    });

    // Sort descending by score, then confidence as tiebreaker
    const sorted = annotated.slice().sort((a, b) =>
      b.final_score - a.final_score || b.confidence - a.confidence
    );

    const winner = sorted[0] ?? null;
    const rejected = sorted.slice(1);

    if (winner) {
      winner.selection_rationale = [
        `authority:${winner.document_family}(${winner.authority_rank})`,
        winner.positive_signals.length > 0 ? `signals:[${winner.positive_signals.join(',')}]` : null,
        `score:${winner.final_score.toFixed(1)}`,
      ].filter(Boolean).join(' ');

      winnerFacts.push(winner.fact);
      winnersByField[fieldType] = winner.fact;
    }

    const candidateAnnotations: CandidateAnnotation[] = sorted.map((a) => ({
      fact_index: a.fact_index,
      document_family: a.document_family,
      authority_rank: a.authority_rank,
      positive_signals: a.positive_signals,
      penalty_signals: a.penalty_signals,
      final_score: a.final_score,
      confidence: a.confidence,
      source_document_id: a.source_document_id,
      source_page_index: a.source_page_index,
      selection_rationale: a.selection_rationale,
    }));

    const rejectedReasons = rejected.map((r) =>
      `[${r.document_family}] score:${r.final_score.toFixed(1)} < winner:${winner?.final_score.toFixed(1)}` +
      (r.penalty_signals.length > 0 ? ` penalties:[${r.penalty_signals.join(',')}]` : '')
    );

    selectionLog.push({
      field: fieldType as FieldSelectionRecord['field'],
      candidates: candidateAnnotations,
      winner_index: winner?.fact_index ?? null,
      winner_rationale: winner?.selection_rationale ?? null,
      rejected_indices: rejected.map((r) => r.fact_index),
      rejected_reasons: rejectedReasons,
    });
  }

  // Build final ordered facts: winners first (per field type), then non-targeted passthrough
  const orderedFacts: any[] = [
    ...winnerFacts,
    ...nonTargeted.map((n) => n.fact),
  ];

  return { orderedFacts, selectionLog, winnersByField };
}
