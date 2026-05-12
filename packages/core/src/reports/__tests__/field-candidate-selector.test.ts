/**
 * Field Candidate Selector — unit tests
 *
 * Tests the positive-selection logic: given a set of accepted (post-guard) promoted
 * facts, the selector ranks them by document authority + field-specific content
 * signals, and returns one winner per targeted field type.
 */

import { selectBestCandidatesPerField } from '../field-candidate-selector';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(
  documentId: string,
  kind?: string,
  filename?: string,
): { document_id: string; kind?: string; filename?: string } {
  return { document_id: documentId, kind, filename };
}

function makeRaiseFact(
  override: {
    documentId?: string;
    amount?: number;
    display?: string;
    note_snippet?: string;
    confidence?: number;
  } = {},
): any {
  const vj: any = {
    display: override.display ?? '',
    raw_text: override.display ?? '',
  };
  if (override.amount !== undefined) vj.amount = { amount: override.amount };
  if (override.note_snippet) vj.note_snippet = override.note_snippet;
  return {
    fact_type: 'raise_terms_v1',
    source_document_id: override.documentId ?? 'doc-001',
    confidence: override.confidence ?? 0.8,
    content_json: { fact_type: 'raise_terms_v1', value_json: vj },
  };
}

function makeRevenueFact(
  override: {
    documentId?: string;
    amount?: number;
    display?: string;
    note_snippet?: string;
    confidence?: number;
  } = {},
): any {
  const vj: any = {
    display: override.display ?? '',
    raw_text: override.display ?? '',
    scope: 'company_total',
    subtype: 'historical',
  };
  if (override.amount !== undefined) vj.amount = { amount: override.amount };
  if (override.note_snippet) vj.note_snippet = override.note_snippet;
  return {
    fact_type: 'revenue_v1',
    source_document_id: override.documentId ?? 'doc-001',
    confidence: override.confidence ?? 0.8,
    content_json: { fact_type: 'revenue_v1', value_json: vj },
  };
}

function makeBusinessModelFact(
  override: { documentId?: string; display?: string; confidence?: number } = {},
): any {
  const vj = { display: override.display ?? 'B2B', raw_text: override.display ?? 'B2B' };
  return {
    fact_type: 'business_model_v1',
    source_document_id: override.documentId ?? 'doc-001',
    confidence: override.confidence ?? 0.8,
    content_json: { fact_type: 'business_model_v1', value_json: vj },
  };
}

// ─── selectBestCandidatesPerField: empty input ────────────────────────────────

describe('selectBestCandidatesPerField — empty input', () => {
  it('returns empty orderedFacts when input is empty', () => {
    const result = selectBestCandidatesPerField([], {});
    expect(result.orderedFacts).toHaveLength(0);
    expect(result.selectionLog).toHaveLength(0);
  });

  it('returns empty orderedFacts when input is null-like', () => {
    const result = selectBestCandidatesPerField(null as any, {});
    expect(result.orderedFacts).toHaveLength(0);
  });
});

// ─── Raise: authority ranking ─────────────────────────────────────────────────

describe('selectBestCandidatesPerField — raise authority ranking', () => {
  it('prefers sec_8k_public raise over operating_financials raise', () => {
    const docs = [
      makeDoc('doc-8k', 'sec_8k'),
      makeDoc('doc-fin', 'financial_statements'),
    ];
    const facts = [
      makeRaiseFact({ documentId: 'doc-fin', amount: 45_000_000, display: '$45M', confidence: 0.95 }),
      makeRaiseFact({ documentId: 'doc-8k', amount: 50_000_000, display: '$50M gross proceeds', confidence: 0.7 }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    // Winner should be the 8-K fact
    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-8k');
  });

  it('prefers raise with "gross proceeds" signal over same-authority raise without', () => {
    const docs = [
      makeDoc('doc-8k-a', 'sec_8k'),
      makeDoc('doc-8k-b', 'sec_8k'),
    ];
    const facts = [
      makeRaiseFact({ documentId: 'doc-8k-a', amount: 50_000_000, display: '$50M' }),
      makeRaiseFact({ documentId: 'doc-8k-b', amount: 50_000_000, display: '$50M gross proceeds from PIPE' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-8k-b');
  });

  it('penalises raise with "liquidation preference" text', () => {
    const docs = [
      makeDoc('doc-deck', 'pitch_deck'),
      makeDoc('doc-fin', 'financial_statements'),
    ];
    const facts = [
      makeRaiseFact({
        documentId: 'doc-fin',
        amount: 1.092,
        display: '$1.092 per share',
        note_snippet: 'liquidation preference $1.092',
      }),
      makeRaiseFact({ documentId: 'doc-deck', amount: 45_000_000, display: '$45M Series A' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    // Liquidation preference fact should not win
    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-deck');
  });

  it('produces one raise winner even when multiple raise facts are provided', () => {
    const docs = [makeDoc('doc-a', 'pitch_deck'), makeDoc('doc-b', 'sec_8k')];
    const facts = [
      makeRaiseFact({ documentId: 'doc-a', amount: 30_000_000, display: '$30M' }),
      makeRaiseFact({ documentId: 'doc-b', amount: 45_000_000, display: '$45M merger close' }),
      makeRaiseFact({ documentId: 'doc-a', amount: 20_000_000, display: '$20M note' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    // Only one raise fact should be in orderedFacts (the winner; others dropped)
    const raiseFacts = result.orderedFacts.filter((f: any) => f.fact_type === 'raise_terms_v1');
    expect(raiseFacts).toHaveLength(1);
  });
});

// ─── Revenue: authority ranking ───────────────────────────────────────────────

describe('selectBestCandidatesPerField — revenue authority ranking', () => {
  it('prefers operating_financials revenue over pitch_deck revenue', () => {
    const docs = [
      makeDoc('doc-fin', 'financial_statements'),
      makeDoc('doc-deck', 'pitch_deck'),
    ];
    const facts = [
      makeRevenueFact({ documentId: 'doc-deck', amount: 5_000_000, display: 'Projected $5M revenue', confidence: 0.95 }),
      makeRevenueFact({ documentId: 'doc-fin', amount: 3_200_000, display: '$3.2M Net revenue H1 2023', confidence: 0.7 }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-fin');
  });

  it('penalises revenue with "pro forma adjustment" text', () => {
    const docs = [
      makeDoc('doc-fin', 'financial_statements'),
      makeDoc('doc-proforma', 'financial_pro_forma'),
    ];
    const facts = [
      makeRevenueFact({
        documentId: 'doc-proforma',
        amount: 1_500_000,
        display: '$1.5M',
        note_snippet: 'transaction adjustment to record the expense related to the prepayment fee',
      }),
      makeRevenueFact({ documentId: 'doc-fin', amount: 4_000_000, display: '$4M net revenue for six months ended' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-fin');
  });

  it('gives bonus for income statement context signals', () => {
    const docs = [
      makeDoc('doc-a', 'financial_statements'),
      makeDoc('doc-b', 'financial_statements'),
    ];
    const facts = [
      makeRevenueFact({ documentId: 'doc-a', amount: 3_000_000, display: '$3M revenue' }),
      makeRevenueFact({ documentId: 'doc-b', amount: 3_000_000, display: '$3M from income statement H1 2023' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-b');
  });
});

// ─── Business model: authority ranking ───────────────────────────────────────

describe('selectBestCandidatesPerField — business_model authority ranking', () => {
  it('prefers pitch_deck business_model over operating_financials', () => {
    const docs = [
      makeDoc('doc-deck', 'pitch_deck'),
      makeDoc('doc-fin', 'financial_statements'),
    ];
    const facts = [
      makeBusinessModelFact({ documentId: 'doc-fin', display: 'Wholesale/Retail distribution', confidence: 0.9 }),
      makeBusinessModelFact({ documentId: 'doc-deck', display: 'B2B→HCP channel', confidence: 0.7 }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-deck');
  });

  it('gives large bonus for B2B2C signal', () => {
    const docs = [
      makeDoc('doc-a', 'pitch_deck'),
      makeDoc('doc-b', 'pitch_deck'),
    ];
    const facts = [
      makeBusinessModelFact({ documentId: 'doc-a', display: 'Direct sales model' }),
      makeBusinessModelFact({ documentId: 'doc-b', display: 'B2B2C through HCP channel' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-b');
  });

  it('gives bonus for medtech HCP signals over generic wholesale text', () => {
    const docs = [
      makeDoc('doc-mda', 'financial_mda'),
      makeDoc('doc-deck', 'pitch_deck'),
    ];
    const facts = [
      makeBusinessModelFact({ documentId: 'doc-mda', display: 'Wholesale channels', confidence: 0.9 }),
      makeBusinessModelFact({ documentId: 'doc-deck', display: 'Virtual Care Suite sold directly to healthcare providers', confidence: 0.6 }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const winnerDocId = result.orderedFacts[0]?.source_document_id;
    expect(winnerDocId).toBe('doc-deck');
  });
});

// ─── Non-targeted fields: pass-through ───────────────────────────────────────

describe('selectBestCandidatesPerField — non-targeted field pass-through', () => {
  it('passes through market_size facts untouched', () => {
    const marketSizeFact = {
      fact_type: 'market_size_v1',
      source_document_id: 'doc-001',
      content_json: { fact_type: 'market_size_v1', value_json: { display: '$5B TAM' } },
    };

    const result = selectBestCandidatesPerField([marketSizeFact], {});

    expect(result.orderedFacts).toHaveLength(1);
    expect(result.orderedFacts[0].fact_type).toBe('market_size_v1');
  });

  it('does not include non-targeted facts in selectionLog', () => {
    const marketSizeFact = {
      fact_type: 'market_size_v1',
      source_document_id: 'doc-001',
      content_json: { fact_type: 'market_size_v1', value_json: {} },
    };

    const result = selectBestCandidatesPerField([marketSizeFact], {});

    expect(result.selectionLog).toHaveLength(0);
  });

  it('preserves raise winner AND passes through non-targeted facts', () => {
    const docs = [makeDoc('doc-8k', 'sec_8k')];
    const raise = makeRaiseFact({ documentId: 'doc-8k', amount: 45_000_000, display: '$45M' });
    const marketSize = {
      fact_type: 'market_size_v1',
      source_document_id: 'doc-8k',
      content_json: { value_json: { display: '$5B' } },
    };

    const result = selectBestCandidatesPerField([raise, marketSize], { documents: docs });

    expect(result.orderedFacts).toHaveLength(2);
    // raise winner first
    expect(result.orderedFacts[0].fact_type).toBe('raise_terms_v1');
    // market_size passes through
    expect(result.orderedFacts[1].fact_type).toBe('market_size_v1');
  });
});

// ─── Selection log ────────────────────────────────────────────────────────────

describe('selectBestCandidatesPerField — selection log', () => {
  it('records a selectionLog entry with winner_rationale', () => {
    const docs = [makeDoc('doc-8k', 'sec_8k')];
    const fact = makeRaiseFact({ documentId: 'doc-8k', amount: 50_000_000, display: '$50M gross proceeds' });

    const result = selectBestCandidatesPerField([fact], { documents: docs });

    expect(result.selectionLog).toHaveLength(1);
    const log = result.selectionLog[0];
    expect(log.field).toBe('raise_terms_v1');
    expect(log.winner_index).toBe(0);
    expect(log.winner_rationale).toBeTruthy();
    expect(log.rejected_indices).toHaveLength(0);
  });

  it('records rejected candidates when there are multiple', () => {
    const docs = [makeDoc('doc-8k', 'sec_8k'), makeDoc('doc-fin', 'financial_statements')];
    const facts = [
      makeRaiseFact({ documentId: 'doc-fin', amount: 1_000_000, display: '$1M note' }),
      makeRaiseFact({ documentId: 'doc-8k', amount: 45_000_000, display: '$45M gross proceeds' }),
    ];

    const result = selectBestCandidatesPerField(facts, { documents: docs });

    const log = result.selectionLog.find((l) => l.field === 'raise_terms_v1');
    expect(log?.rejected_indices).toHaveLength(1);
    expect(log?.rejected_reasons[0]).toContain('score');
  });

  it('exposes winnersByField for the winning fact', () => {
    const docs = [makeDoc('doc-deck', 'pitch_deck')];
    const fact = makeBusinessModelFact({ documentId: 'doc-deck', display: 'B2B SaaS' });

    const result = selectBestCandidatesPerField([fact], { documents: docs });

    expect(result.winnersByField.business_model_v1).toBe(fact);
  });
});
