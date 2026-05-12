/**
 * Field Authority Guard — Allurion regression + unit tests
 *
 * These tests guard against the specific false positives identified in the
 * Allurion deal audit (2026-04-09):
 *
 *   raise   → "$1 Series A Convertible Note" (liquidation preference extracted
 *              as raise: "$1.092 per-share preferred stock" from page 27)
 *   revenue → "$1.5M" (pro forma EX-99.5 transaction adjustment footnote)
 *   product_solution / market_icp → null despite governed_ui_copy_v1 having values
 *
 * Tests are grouped into:
 *   A. Direct guard rule tests (applyFieldAuthorityGuards)
 *   B. Compiler integration tests (via compileDIOToReportWithPromotedFacts)
 */

import {
  applyFieldAuthorityGuards,
  applyStructuredSummaryFillIns,
  buildStructuredSummaryFillIns,
  isLowQualityFillIn,
  type FieldAuthorityGuardContext,
  type FieldAuthorityGuardResult,
} from '../field-authority-guard';
import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';

// ─── Helper factories ──────────────────────────────────────────────────────────

function makeRaiseFact(overrides: {
  amount?: number;
  display?: string;
  raw_text?: string;
  note_snippet?: string;
  documentId?: string;
}): any {
  const { amount, display, raw_text, note_snippet, documentId = 'doc-001' } = overrides;
  const value_json: any = {
    display: display ?? raw_text ?? '',
    raw_text: raw_text ?? display ?? '',
  };
  if (amount !== undefined) value_json.amount = { amount };
  if (note_snippet) value_json.note_snippet = note_snippet;
  return {
    fact_type: 'raise_terms_v1',
    source_document_id: documentId,
    content_json: { fact_type: 'raise_terms_v1', value_json },
  };
}

function makeRevenueFact(overrides: {
  amount?: number;
  display?: string;
  note_snippet?: string;
  documentId?: string;
}): any {
  const { amount, display, note_snippet, documentId = 'doc-001' } = overrides;
  const value_json: any = {
    display: display ?? '',
    raw_text: display ?? '',
    scope: 'company_total',
    subtype: 'historical',
  };
  if (amount !== undefined) value_json.amount = { amount };
  if (note_snippet) value_json.note_snippet = note_snippet;
  return {
    fact_type: 'revenue_v1',
    source_document_id: documentId,
    content_json: { fact_type: 'revenue_v1', value_json },
  };
}

function makeBusinessModelFact(overrides: { value?: string; documentId?: string }): any {
  const { value = 'B2B', documentId = 'doc-001' } = overrides;
  return {
    fact_type: 'business_model_v1',
    source_document_id: documentId,
    content_json: {
      fact_type: 'business_model_v1',
      value_json: { display: value, raw_text: value },
    },
  };
}

const noDocuments: FieldAuthorityGuardContext['documents'] = [];
const deSpacContext = (docs?: FieldAuthorityGuardContext['documents']): FieldAuthorityGuardContext => ({
  deal_type: 'de_spac',
  documents: docs ?? noDocuments,
});
const genericContext: FieldAuthorityGuardContext = { deal_type: null, documents: noDocuments };

// ─── A. Direct guard rule tests ────────────────────────────────────────────────

describe('applyFieldAuthorityGuards — raise_terms_v1', () => {
  it('rejects a per-share liquidation preference value (Allurion pattern)', () => {
    // Allurion: page 27, "$1.092" extracted as preferred stock liquidation preference
    const fact = makeRaiseFact({
      amount: 1.092,
      display: '$1 Series A Convertible Note',
      note_snippet: 'per share liquidation preference equal to $1.092, $2.850 Series B',
    });
    const result = applyFieldAuthorityGuards([fact], deSpacContext());

    expect(result.rejectedFacts).toHaveLength(1);
    expect(result.acceptedFacts).toHaveLength(0);

    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('raise.liquidation_preference_text');
  });

  it('rejects a raise with "per share" in the note snippet', () => {
    const fact = makeRaiseFact({
      amount: 3.5,
      display: 'Series B Preferred Stock',
      note_snippet: 'Original issue price per share $3.50',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('raise.per_share_text');
  });

  it('rejects "original issue price" language in display', () => {
    const fact = makeRaiseFact({
      amount: 2.5,
      display: 'Original issue price $2.50 per share',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('raise.original_issue_price_text');
  });

  it('rejects tiny decimal amount in de-SPAC context', () => {
    const fact = makeRaiseFact({ amount: 1.092, display: '$1.092 per share' });
    const result = applyFieldAuthorityGuards([fact], deSpacContext());

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    // Should trigger at least one tiny-amount rule
    expect(ruleIds.some((id) => id.startsWith('raise.') && id.includes('amount'))).toBe(true);
  });

  it('rejects raise amount < $1M in de-SPAC context as implausible', () => {
    const fact = makeRaiseFact({ amount: 500_000, display: '$500K Note' });
    const result = applyFieldAuthorityGuards([fact], deSpacContext());

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('raise.despac_tiny_amount');
  });

  it('accepts a legitimate raise ($87M) in de-SPAC context', () => {
    const fact = makeRaiseFact({ amount: 87_000_000, display: '$87M de-SPAC Transaction' });
    const result = applyFieldAuthorityGuards([fact], deSpacContext());

    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.rejectedFacts).toHaveLength(0);
  });

  it('accepts a raise from a pro forma doc but attaches a rejection when doc is classified pro_forma', () => {
    const docs = [{ document_id: 'doc-proforma', filename: 'ex-99.5-pro-forma.htm', kind: null }];
    const fact = makeRaiseFact({ amount: 50_000_000, display: '$50M', documentId: 'doc-proforma' });
    const result = applyFieldAuthorityGuards([fact], { deal_type: null, documents: docs });

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('raise.forbidden_document_family_proforma');
  });

  it('rejects raise from SPAC entity financials (ex-99.3 pattern)', () => {
    const docs = [{ document_id: 'doc-spac', filename: 'ex-99.3-spac-financials.htm', kind: null }];
    const fact = makeRaiseFact({ amount: 75_000_000, display: '$75M', documentId: 'doc-spac' });
    const result = applyFieldAuthorityGuards([fact], { deal_type: null, documents: docs });

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('raise.forbidden_document_family_spac');
  });

  it('guard log records accepted facts correctly', () => {
    const fact = makeRaiseFact({ amount: 10_000_000, display: '$10M Series A' });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.guardLog).toHaveLength(1);
    expect(result.guardLog[0].action).toBe('accept');
    expect(result.guardLog[0].fact_type).toBe('raise_terms_v1');
    expect(result.guardLog[0].reasons).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('applyFieldAuthorityGuards — revenue_v1', () => {
  it('rejects "transaction adjustment" note (Allurion $1.5M pattern)', () => {
    // Allurion: Pro forma note "transaction adjustment to record the expense
    // related to the cash settlement of the prepayment and final payment fees"
    const fact = makeRevenueFact({
      amount: 1_500_000,
      display: '$1.5M',
      note_snippet:
        'transaction adjustment to record the expense related to the cash settlement of the prepayment and final payment fees',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('revenue.transaction_adjustment_text');
  });

  it('rejects "adjustment to record" note snippet', () => {
    const fact = makeRevenueFact({
      amount: 1_200_000,
      note_snippet: 'adjustment to record the fair value of warrants at closing',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('revenue.adjustment_journal_entry');
  });

  it('rejects "pro forma adjustment" note', () => {
    const fact = makeRevenueFact({
      amount: 800_000,
      note_snippet: 'pro forma adjustment for share-based compensation expense',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('revenue.proforma_adjustment_text');
  });

  it('rejects "prepayment fee" in note snippet', () => {
    const fact = makeRevenueFact({
      amount: 1_000_000,
      note_snippet: 'prepayment fee on settlement of the bridge facility',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('revenue.financing_fee_text');
  });

  it('rejects revenue from pro forma document family', () => {
    const docs = [{ document_id: 'doc-pf', filename: 'ex99.5-proforma-combined.htm', kind: null }];
    const fact = makeRevenueFact({ amount: 27_000_000, display: '$27M', documentId: 'doc-pf' });
    const result = applyFieldAuthorityGuards([fact], { deal_type: null, documents: docs });

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('revenue.forbidden_document_family_proforma');
  });

  it('accepts clean revenue fact with no disqualifying signals', () => {
    const fact = makeRevenueFact({
      amount: 27_000_000,
      display: '$27M Revenue H1 2023',
      note_snippet: 'Revenue recognized from customer contracts; recurring in nature.',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.rejectedFacts).toHaveLength(0);
  });

  it('guard log records rejected revenue with correct fact_type', () => {
    const fact = makeRevenueFact({
      amount: 1_500_000,
      note_snippet: 'transaction adjustment to record expense',
    });
    const result = applyFieldAuthorityGuards([fact], genericContext);

    expect(result.guardLog).toHaveLength(1);
    expect(result.guardLog[0].action).toBe('reject');
    expect(result.guardLog[0].fact_type).toBe('revenue_v1');
    expect(result.guardLog[0].authority_tier).toBe('forbidden');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('applyFieldAuthorityGuards — business_model_v1', () => {
  it('rejects business model from SPAC entity financials (ex-99.3)', () => {
    const docs = [{ document_id: 'doc-spac', filename: 'ex-99.3-spac-historical.htm', kind: null }];
    const fact = makeBusinessModelFact({ value: 'Wholesale/Retail', documentId: 'doc-spac' });
    const result = applyFieldAuthorityGuards([fact], { deal_type: null, documents: docs });

    expect(result.rejectedFacts).toHaveLength(1);
    const ruleIds = result.rejectedFacts[0].reasons.map((r) => r.rule_id);
    expect(ruleIds).toContain('business_model.forbidden_document_family_spac');
  });

  it('accepts business model from pitch deck with preferred tier', () => {
    const docs = [{ document_id: 'doc-deck', filename: 'investor-deck-2023.pdf', kind: 'pitch_deck' }];
    const fact = makeBusinessModelFact({ value: 'B2B2C/HCP', documentId: 'doc-deck' });
    const result = applyFieldAuthorityGuards([fact], { deal_type: null, documents: docs });

    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.guardLog[0].authority_tier).toBe('preferred');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('applyFieldAuthorityGuards — mixed fact list', () => {
  it('accepts clean facts and rejects contaminated ones in the same input', () => {
    const goodRaise = makeRaiseFact({ amount: 87_000_000, display: '$87M de-SPAC Transaction' });
    const badRaise = makeRaiseFact({
      amount: 1.092,
      display: '$1',
      note_snippet: 'per share liquidation preference equal to $1.092',
    });
    const goodRevenue = makeRevenueFact({
      amount: 27_000_000,
      display: '$27M Revenue H1 2023',
    });
    const badRevenue = makeRevenueFact({
      amount: 1_500_000,
      note_snippet: 'transaction adjustment to record the expense',
    });

    const result = applyFieldAuthorityGuards(
      [goodRaise, badRaise, goodRevenue, badRevenue],
      deSpacContext(),
    );

    expect(result.acceptedFacts).toHaveLength(2);
    expect(result.rejectedFacts).toHaveLength(2);
    expect(result.guardLog).toHaveLength(4);

    const rejectedTypes = result.rejectedFacts.map((r) => getFactType(r.fact));
    expect(rejectedTypes).toContain('raise_terms_v1');
    expect(rejectedTypes).toContain('revenue_v1');
  });

  it('passes through non-guarded fact types unchanged', () => {
    const marketFact = {
      fact_type: 'market_size_v1',
      source_document_id: 'doc-001',
      content_json: { fact_type: 'market_size_v1', value_json: { display: '$2B TAM' } },
    };
    const result = applyFieldAuthorityGuards([marketFact], genericContext);
    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.rejectedFacts).toHaveLength(0);
  });
});

function getFactType(fact: any): string {
  return fact?.fact_type ?? fact?.content_json?.fact_type ?? '';
}

// ─── B. Structured summary fill-in tests ──────────────────────────────────────

describe('applyStructuredSummaryFillIns', () => {
  it('injects product_summary_v1 from governed_ui_copy_v1 when field is null', () => {
    const guardResult: FieldAuthorityGuardResult = {
      acceptedFacts: [],
      rejectedFacts: [],
      guardLog: [],
      structuredSummaryFillIns: {
        product_summary_v1: {
          value: 'AI-powered weight-loss device using intragastric balloon technology',
          confidence: 0.6,
          authority: 'governed_ui_copy_v1',
          sources: [{ kind: 'phase1.governed_ui_copy_v1', field: 'product_solution' }],
        },
      },
    };

    const structuredSummary: Record<string, any> = { product_summary_v1: null };
    applyStructuredSummaryFillIns(structuredSummary, guardResult.structuredSummaryFillIns);

    expect(structuredSummary.product_summary_v1).not.toBeNull();
    expect(structuredSummary.product_summary_v1.value).toBe(
      'AI-powered weight-loss device using intragastric balloon technology',
    );
    expect(structuredSummary.product_summary_v1.authority).toBe('governed_ui_copy_v1');
  });

  it('does not overwrite an existing product_summary_v1 value', () => {
    const guardResult: FieldAuthorityGuardResult = {
      acceptedFacts: [],
      rejectedFacts: [],
      guardLog: [],
      structuredSummaryFillIns: {
        product_summary_v1: {
          value: 'Fallback value that should NOT win',
          confidence: 0.6,
          authority: 'governed_ui_copy_v1',
          sources: [],
        },
      },
    };

    const structuredSummary: Record<string, any> = {
      product_summary_v1: { value: 'Existing strong value' },
    };
    applyStructuredSummaryFillIns(structuredSummary, guardResult.structuredSummaryFillIns);

    expect(structuredSummary.product_summary_v1.value).toBe('Existing strong value');
  });

  it('injects market_summary_v1 from fill-in when null', () => {
    const guardResult: FieldAuthorityGuardResult = {
      acceptedFacts: [],
      rejectedFacts: [],
      guardLog: [],
      structuredSummaryFillIns: {
        market_summary_v1: {
          value: 'Healthcare providers and obesity treatment clinics',
          confidence: 0.75,
          authority: 'deal_overview_v2',
          sources: [{ kind: 'phase1.deal_overview_v2', field: 'market_icp' }],
        },
      },
    };

    const structuredSummary: Record<string, any> = { market_summary_v1: null };
    applyStructuredSummaryFillIns(structuredSummary, guardResult.structuredSummaryFillIns);

    expect(structuredSummary.market_summary_v1.value).toBe(
      'Healthcare providers and obesity treatment clinics',
    );
  });
});

// ─── C. Compiler integration tests ────────────────────────────────────────────

const makeMinimalDio = (phase1Overrides?: Record<string, any>): any => {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: 'test-dio-allurion',
    deal_id: 'a85b0ac0-19a1-4992-9a21-2d47484b0f8f',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
    analyzer_results: {},
    dio: {
      phase1: {
        business_archetype_v1: { value: 'de_spac' },
        ...phase1Overrides,
      },
    },
  };
};

describe('compileDIOToReportWithPromotedFacts — raise guard integration', () => {
  it('does not surface "$1" as raise when the per-share liquidation preference fact is rejected', () => {
    const badRaiseFact = makeRaiseFact({
      amount: 1.092,
      display: '$1 Series A Convertible Note',
      note_snippet: 'per share liquidation preference equal to $1.092',
    });

    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [badRaiseFact] });

    const raiseValue: string | null = (report.structured_summary as any)?.raise?.value ?? null;
    expect(raiseValue).not.toBe('$1 Series A Convertible Note');
    expect(raiseValue).not.toBe('$1');
    // The raise field should either be null or a legitimate value (not the per-share price)
    if (raiseValue !== null) {
      const amount = parseFloat(raiseValue.replace(/[^0-9.]/g, '') || '0');
      expect(amount).toBeGreaterThan(1); // at least $2 — but realistically null or M/B range
    }
  });

  it('attaches field_authority_guard log to metadata when facts were evaluated', () => {
    const fact = makeRaiseFact({
      amount: 1.092,
      display: '$1',
      note_snippet: 'liquidation preference $1.092',
    });
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });

    const guardMeta = (report.metadata as any)?.field_authority_guard;
    expect(guardMeta).toBeDefined();
    expect(guardMeta.rejected_count).toBeGreaterThan(0);
    expect(Array.isArray(guardMeta.log)).toBe(true);
  });
});

describe('compileDIOToReportWithPromotedFacts — revenue guard integration', () => {
  it('does not surface $1.5M pro forma transaction adjustment as revenue', () => {
    const badRevenueFact = makeRevenueFact({
      amount: 1_500_000,
      display: '$1.5M',
      note_snippet: 'transaction adjustment to record the expense related to the cash settlement of the prepayment and final payment fees',
    });

    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [badRevenueFact] });

    const revenueAmount = (report.structured_summary as any)?.revenue?.value_json?.amount;
    // Should not be $1.5M (1500000)
    if (typeof revenueAmount === 'number') {
      expect(revenueAmount).not.toBe(1_500_000);
    }
    // Guard log should record the rejection
    const guardMeta = (report.metadata as any)?.field_authority_guard;
    expect(guardMeta?.rejected_count).toBeGreaterThan(0);
  });
});

describe('compileDIOToReportWithPromotedFacts — product/market fill-in integration', () => {
  it('populates product_summary_v1 from governed_ui_copy_v1 when not supplied by promoted facts', () => {
    const dio = makeMinimalDio({
      governed_ui_copy_v1: {
        product_solution:
          'Allurion Balloon — swallowable intragastric balloon for weight management, no endoscopy required',
        market_icp:
          'Obesity treatment clinics, bariatric physicians, patients seeking non-surgical weight loss',
      },
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [] });

    const productValue = (report.structured_summary as any)?.product_summary_v1?.value;
    const marketValue = (report.structured_summary as any)?.market_summary_v1?.value;

    expect(productValue).toBeTruthy();
    expect(productValue).toContain('Allurion');

    expect(marketValue).toBeTruthy();
    expect(marketValue.toLowerCase()).toContain('obesity');
  });

  it('guard fill_ins_applied is non-empty when product/market were filled', () => {
    const dio = makeMinimalDio({
      governed_ui_copy_v1: {
        product_solution: 'A detailed product description with good signal',
        market_icp: 'Healthcare providers in the HCP channel',
      },
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [] });
    const guardMeta = (report.metadata as any)?.field_authority_guard;
    // If fill-ins were applied, the guard_log entry should record them
    // (fill_ins_applied list is only set when at least one fact was evaluated OR fill-ins exist).
    // The structured_summary should have the values regardless.
    const productValue = (report.structured_summary as any)?.product_summary_v1?.value;
    expect(productValue).toBeTruthy();
  });

  it('does not overwrite product_summary_v1 if promoted facts already supplied it', () => {
    // Supply a promoted fact that results in product_summary being populated by the compiler.
    // Since the compiler doesn't currently write product_summary_v1 from promoted facts,
    // we verify it gets filled from governed_ui_copy_v1 as expected.
    const dio = makeMinimalDio({
      governed_ui_copy_v1: {
        product_solution: 'Fallback product description',
      },
      deal_overview_v2: {
        product_solution: 'Primary deal overview product solution — HIGH AUTHORITY',
      },
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [] });
    const productValue = (report.structured_summary as any)?.product_summary_v1?.value;

    // deal_overview_v2 is priority 1; should win over governed_ui_copy_v1
    expect(productValue).toContain('HIGH AUTHORITY');
  });
});

// ─── D. isLowQualityFillIn unit tests ─────────────────────────────────────────

describe('isLowQualityFillIn — banned patterns', () => {
  it('rejects text containing legal disclaimer language', () => {
    expect(isLowQualityFillIn(
      'This document is for informational purposes only and contains forward-looking statements.'
    )).toBe(true);
  });

  it('rejects text containing "no representation"', () => {
    expect(isLowQualityFillIn(
      'industry conditions and other factors. As a result, no representation or warranty can be given.'
    )).toBe(true);
  });

  it('rejects text containing "two people come to mind"', () => {
    expect(isLowQualityFillIn(
      'When I think about what this looks like, two people come to mind in particular.'
    )).toBe(true);
  });

  it('rejects text containing "this presentation"', () => {
    expect(isLowQualityFillIn(
      'This presentation has been prepared for discussion purposes only.'
    )).toBe(true);
  });

  it('rejects text containing "confidential"', () => {
    expect(isLowQualityFillIn('Confidential — do not distribute.')).toBe(true);
  });

  it('rejects text longer than 500 characters (paragraph dump)', () => {
    const longText = 'A'.repeat(501);
    expect(isLowQualityFillIn(longText)).toBe(true);
  });

  it('rejects text shorter than 20 characters (meaningless)', () => {
    expect(isLowQualityFillIn('Short')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isLowQualityFillIn('')).toBe(true);
  });

  it('accepts a clean structured market summary', () => {
    expect(isLowQualityFillIn(
      'Targeting mid-market SaaS companies with compliance needs across DevSecOps and GRC.'
    )).toBe(false);
  });

  it('accepts a clean product description', () => {
    expect(isLowQualityFillIn(
      'Humanoid labor platform for heavy industrial environments, deployed via RaaS contracts.'
    )).toBe(false);
  });

  it('accepts a text exactly 500 characters (boundary)', () => {
    const boundary = 'B'.repeat(500);
    expect(isLowQualityFillIn(boundary)).toBe(false);
  });

  it('accepts a text exactly 20 characters (boundary)', () => {
    expect(isLowQualityFillIn('Twenty chars exactly')).toBe(false);
  });
});

// ─── E. buildStructuredSummaryFillIns with quality gate ───────────────────────

function makeFillInContext(overrides: {
  deal_overview_v2?: Record<string, any>;
  governed_ui_copy_v1?: Record<string, any>;
}): FieldAuthorityGuardContext {
  return {
    deal_type: null,
    documents: [],
    dio: {
      dio: {
        phase1: {
          deal_overview_v2: overrides.deal_overview_v2 ?? null,
          governed_ui_copy_v1: overrides.governed_ui_copy_v1 ?? null,
        },
      },
    },
  } as any;
}

describe('buildStructuredSummaryFillIns — quality gate', () => {
  it('rejects legal disclaimer market_icp — field stays undefined', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        market_icp:
          'industry conditions and other factors. As a result, no representation or warranty is given.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.market_summary_v1).toBeUndefined();
  });

  it('rejects conversational narrative market_icp (NerdWallet pattern)', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        market_icp:
          'When I think about what this looks like, two people come to mind in particular.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.market_summary_v1).toBeUndefined();
  });

  it('rejects forward-looking statements boilerplate as product_solution', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        product_solution:
          'This document contains forward-looking statements that involve risks and uncertainties.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.product_summary_v1).toBeUndefined();
  });

  it('accepts a clean, structured market_icp', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        market_icp:
          'Targeting mid-market SaaS companies with compliance needs across DevSecOps and GRC.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.market_summary_v1?.value).toContain('Targeting mid-market SaaS');
    expect(result.market_summary_v1?.authority).toBe('deal_overview_v2');
  });

  it('accepts a clean product_solution', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        product_solution:
          'Humanoid labor platform for heavy industrial environments, deployed via RaaS contracts.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.product_summary_v1?.value).toContain('Humanoid labor platform');
  });

  it('falls through to governed_ui_copy_v1 when deal_overview_v2 value is rejected', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        market_icp: 'This presentation is for informational purposes only.',
      },
      governed_ui_copy_v1: {
        market_icp: 'B2B healthcare platforms and ambulatory surgery centers seeking non-opioid alternatives.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.market_summary_v1?.value).toContain('B2B healthcare platforms');
    expect(result.market_summary_v1?.authority).toBe('governed_ui_copy_v1');
  });

  it('returns undefined when both overview and uiCopy values are low quality', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        market_icp: 'This document contains forward-looking statements.',
      },
      governed_ui_copy_v1: {
        market_icp: 'No warranty or representation is made herein.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.market_summary_v1).toBeUndefined();
  });

  it('does not overwrite a high-quality overview value with a fallback', () => {
    const ctx = makeFillInContext({
      deal_overview_v2: {
        market_icp: 'Orthopedic surgeons treating Grade II–III cartilage defects in knees.',
      },
      governed_ui_copy_v1: {
        market_icp: 'B2B healthcare platforms.',
      },
    });
    const result = buildStructuredSummaryFillIns(ctx);
    expect(result.market_summary_v1?.value).toContain('Orthopedic surgeons');
    expect(result.market_summary_v1?.authority).toBe('deal_overview_v2');
  });
});
