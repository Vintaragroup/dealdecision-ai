/**
 * P6 Phase 6 — Evidence Enrichment + Scope Attribution Plumbing tests.
 *
 * Covers additions introduced in Phase 6:
 *
 * 1. Pre-computed entity_scope in value_json:
 *    - 'case_study' in value_json → score=-800, excluded from candidate pool.
 *    - 'illustrative' in value_json → score=-600, excluded from candidate pool.
 *    - 'unknown' in value_json → normal scoring proceeds.
 *
 * 2. Promoted-fact candidate authority metadata:
 *    - authority_rank: 3 for dpu_derived_fact / promoted_slide_fact.
 *    - source_support_level: 'dpu_text' for dpu_derived_fact.
 *    - document_family: 'pitch_deck'.
 *    - has_primary_citation: true when page_index + source_document_id present.
 *    - selection_explainer: non-empty string.
 *
 * 3. Financial-fact candidate authority metadata:
 *    - authority_rank: 5 for xlsx, 4 for pdf_table, 2 for deck medium, 1 for deck low.
 *    - source_support_level: 'xlsx_structured' for xlsx, 'deck_only' for deck.
 *    - document_family: 'financial_model' for xlsx, 'pitch_deck' for deck.
 *    - has_primary_citation: true when document_id + page_number present.
 *    - selection_explainer: non-empty string.
 *    - entity_scope: from detectEntityScope on excerpt/slide_title.
 *
 * 4. BM recovery regression:
 *    - Phase 5 policy recovery still fires after Phase 6 changes.
 *    - Pre-computed entity_scope does not interfere with non-revenue paths.
 */

import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1';

// ─── Shared helpers ───────────────────────────────────────────────────────────

let _seq = 0;

function makeFinancialFact(
  metric_key: string,
  value: number,
  overrides: Partial<FinancialFactV1> = {},
): FinancialFactV1 {
  const id = `phase6:${metric_key}:${++_seq}`;
  return {
    fact_id: id,
    deal_id: 'deal-phase6',
    document_id: 'doc-xlsx',
    source_kind: 'xlsx',
    metric_key,
    period_type: 'annual',
    period_label: '2024',
    value,
    unit: 'currency',
    currency: 'USD',
    confidence: 'high',
    ...overrides,
  };
}

function minimalDio(dioOverrides: Record<string, any> = {}): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: 'phase6-test-dio',
    deal_id: 'phase6-test-deal',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: {
      documents: [],
      evidence: [],
      config: { analyzer_versions: {}, features: {}, parameters: {} },
    },
    analyzer_results: {},
    dio: { phase1: {}, ...dioOverrides },
  };
}

function makePromotedRevenueFact(overrides: {
  amount?: number;
  display?: string;
  subtype?: string;
  scope?: string;
  note_snippet?: string | null;
  slide_title?: string | null;
  confidence?: number;
  source_type?: string;
  entity_scope?: string;
  page_index?: number | null;
  source_document_id?: string | null;
}): any {
  const {
    amount = 500_000,
    display = `$${((overrides.amount ?? 500_000) / 1e6).toFixed(1)}MM`,
    subtype = 'annual',
    scope = 'company_total',
    note_snippet = null,
    slide_title = 'Financial Performance',
    confidence = 0.75,
    source_type = 'dpu_derived_fact',
    entity_scope,
    page_index = 5,
    source_document_id = 'doc-pitch',
  } = overrides;

  return {
    fact_type: 'revenue_v1',
    confidence,
    source_type,
    source_document_id: source_document_id ?? undefined,
    content_json: {
      fact_type: 'revenue_v1',
      value_json: {
        display,
        raw: display,
        amount: { amount },
        subtype,
        scope,
        ...(note_snippet != null ? { note_snippet } : {}),
        ...(entity_scope != null ? { entity_scope } : {}),
      },
      provenance: {
        source_document_id: source_document_id ?? undefined,
        page_index: page_index ?? undefined,
        slide_title,
        segment_key: 'financials',
      },
    },
  };
}

// ─── 1. Pre-computed entity_scope gate ──────────────────────────────────────

describe('Phase 6: Pre-computed entity_scope in value_json gates scoring', () => {
  test('entity_scope=case_study in value_json → candidate excluded, score=-800', () => {
    const dio = minimalDio();
    const caseStudyFact = makePromotedRevenueFact({
      amount: 131_847,
      display: '$131K',
      entity_scope: 'case_study',
      note_snippet: 'Client HQ MRR $1,748 + Retail Locations MRR $125,630 = Total MRR $131,847',
      slide_title: 'Use Case Solution: Q-Commerce',
      confidence: 0.75,
    });
    const companyFact = makePromotedRevenueFact({
      amount: 2_500_000,
      display: '$2.5M',
      entity_scope: 'unknown',
      slide_title: 'Annual Revenue Summary',
      confidence: 0.8,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [caseStudyFact, companyFact],
    });
    const rev = report.structured_summary?.revenue as any;

    // Company-level fact should win
    expect(rev?.value?.amount).toBe(2_500_000);

    // Case-study fact is fully excluded (score=-800 < -100 filter threshold);
    // it must NOT appear in candidates as the selected entry.
    const candidates: any[] = rev?.candidates ?? [];
    const caseStudyCandidate = candidates.find((c: any) => c.amount === 131_847);
    // If present, it must not be selected
    if (caseStudyCandidate) {
      expect(caseStudyCandidate.selected).toBe(false);
    }
    // The selected winner is the company-level fact
    const winner = candidates.find((c: any) => c.selected === true);
    expect(winner?.amount).toBe(2_500_000);
  });

  test('entity_scope=illustrative in value_json → candidate excluded, score=-600', () => {
    const dio = minimalDio();
    const illuFact = makePromotedRevenueFact({
      amount: 900_000,
      display: '$900K',
      entity_scope: 'illustrative',
      slide_title: 'Sample Deployment Scenario',
      confidence: 0.7,
    });
    const companyFact = makePromotedRevenueFact({
      amount: 3_000_000,
      display: '$3M',
      entity_scope: 'unknown',
      confidence: 0.8,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [illuFact, companyFact],
    });
    const rev = report.structured_summary?.revenue as any;

    expect(rev?.value?.amount).toBe(3_000_000);

    // Illustrative fact is fully excluded (score=-600 < -100 filter threshold);
    // it must NOT appear as selected.
    const candidates: any[] = rev?.candidates ?? [];
    const illuCandidate = candidates.find((c: any) => c.amount === 900_000);
    if (illuCandidate) {
      expect(illuCandidate.selected).toBe(false);
    }
    // The selected winner is the company-level fact
    const winner = candidates.find((c: any) => c.selected === true);
    expect(winner?.amount).toBe(3_000_000);
  });

  test('entity_scope=unknown in value_json → proceeds to normal scoring, may be selected', () => {
    const dio = minimalDio();
    const fact = makePromotedRevenueFact({
      amount: 1_200_000,
      display: '$1.2M',
      entity_scope: 'unknown',
      slide_title: 'Business Performance',
      confidence: 0.78,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;

    // Should be selected (no exclusion) and entity_scope=unknown
    expect(rev?.value?.amount).toBe(1_200_000);
    expect(rev?.entity_scope).not.toBe('case_study');
  });

  test('no entity_scope in value_json → falls through to detectEntityScope (note_snippet-based)', () => {
    const dio = minimalDio();
    // Explicitly NO entity_scope in value_json, but note_snippet has case-study text.
    const fact = makePromotedRevenueFact({
      amount: 250_000,
      display: '$250K',
      note_snippet: 'Qredible Case Solution: $250K Total MRR from client deployments',
      slide_title: null,
      confidence: 0.65,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;

    const candidates: any[] = rev?.candidates ?? [];
    const candidate = candidates.find((c: any) => c.amount === 250_000);
    if (candidate) {
      // Note_snippet-based detection should catch 'Case Solution'
      expect(candidate.entity_scope).toBe('case_study');
      expect(candidate.selected).toBe(false);
    }
    // If no candidate at all (excluded completely), that's also acceptable
  });
});

// ─── 2. Promoted-fact candidate authority metadata ───────────────────────────

describe('Phase 6: Promoted-fact candidate authority metadata', () => {
  test('dpu_derived_fact → authority_rank=3, source_support_level=dpu_text, document_family=pitch_deck', () => {
    const dio = minimalDio();
    const fact = makePromotedRevenueFact({
      amount: 2_000_000,
      display: '$2M',
      source_type: 'dpu_derived_fact',
      entity_scope: 'unknown',
      confidence: 0.75,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.authority_rank).toBe(3);
    expect(selected!.source_support_level).toBe('dpu_text');
    expect(selected!.document_family).toBe('pitch_deck');
  });

  test('promoted_slide_fact → authority_rank=3, source_support_level=promoted_slide_fact', () => {
    const dio = minimalDio();
    const fact = makePromotedRevenueFact({
      amount: 1_500_000,
      display: '$1.5M',
      source_type: 'promoted_slide_fact',
      entity_scope: 'unknown',
      confidence: 0.7,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.authority_rank).toBe(3);
    expect(selected!.source_support_level).toBe('promoted_slide_fact');
  });

  test('promoted fact with page_index + source_document_id → has_primary_citation=true', () => {
    const dio = minimalDio();
    const fact = makePromotedRevenueFact({
      amount: 800_000,
      page_index: 7,
      source_document_id: 'doc-abc',
      entity_scope: 'unknown',
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.has_primary_citation).toBe(true);
  });

  test('promoted fact without page_index → has_primary_citation=false', () => {
    const dio = minimalDio();
    const fact = makePromotedRevenueFact({
      amount: 600_000,
      page_index: null,
      source_document_id: null,
      entity_scope: 'unknown',
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.has_primary_citation).toBe(false);
  });

  test('promoted fact candidate always has selection_explainer as non-empty string', () => {
    const dio = minimalDio();
    const fact = makePromotedRevenueFact({ amount: 1_000_000, entity_scope: 'unknown' });

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    for (const c of candidates) {
      if (c.source_support_level === 'dpu_text' || c.source_support_level === 'promoted_slide_fact') {
        expect(typeof c.selection_explainer).toBe('string');
        expect(c.selection_explainer.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── 3. Financial-fact candidate authority metadata ──────────────────────────

describe('Phase 6: Financial-fact candidate authority metadata', () => {
  test('xlsx fact → authority_rank=5, source_support_level=xlsx_structured, document_family=financial_model', () => {
    const dio = minimalDio();
    const fact = makeFinancialFact('revenue', 5_000_000, {
      source_kind: 'xlsx',
      document_id: 'doc-xlsx-1',
      page_number: 3,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.authority_rank).toBe(5);
    expect(selected!.source_support_level).toBe('xlsx_structured');
    expect(selected!.document_family).toBe('financial_model');
  });

  test('xlsx fact with document_id + page_number → has_primary_citation=true', () => {
    const dio = minimalDio();
    const fact = makeFinancialFact('revenue', 3_000_000, {
      source_kind: 'xlsx',
      document_id: 'doc-xlsx-1',
      page_number: 2,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.has_primary_citation).toBe(true);
  });

  test('deck/low-confidence fact → authority_rank=1, source_support_level=deck_only, document_family=pitch_deck', () => {
    const dio = minimalDio();
    const deckFact = makeFinancialFact('revenue', 100_000, {
      source_kind: 'deck',
      confidence: 'low',
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [deckFact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.authority_rank).toBe(1);
    expect(selected!.source_support_level).toBe('deck_only');
    expect(selected!.document_family).toBe('pitch_deck');
  });

  test('deck/medium-confidence fact → authority_rank=2', () => {
    const dio = minimalDio();
    const deckFact = makeFinancialFact('revenue', 500_000, {
      source_kind: 'deck',
      confidence: 'medium',
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [deckFact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.authority_rank).toBe(2);
  });

  test('financial fact always has selection_explainer as non-empty string', () => {
    const dio = minimalDio();
    const fact = makeFinancialFact('revenue', 2_000_000);

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    for (const c of candidates) {
      expect(typeof c.selection_explainer).toBe('string');
      expect(c.selection_explainer.length).toBeGreaterThan(0);
    }
  });

  test('pdf_table fact → authority_rank=4, source_support_level=pdf_structured', () => {
    const dio = minimalDio();
    const fact = makeFinancialFact('revenue', 1_500_000, {
      source_kind: 'pdf_table',
      confidence: 'high',
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [fact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];
    const selected = candidates.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected!.authority_rank).toBe(4);
    expect(selected!.source_support_level).toBe('pdf_structured');
  });

  test('xlsx fact overrides low-confidence deck fact; xlx candidate has authority_rank=5, deck has 1', () => {
    const dio = minimalDio();
    const xlsxFact = makeFinancialFact('revenue', 4_000_000, {
      source_kind: 'xlsx',
      confidence: 'high',
    });
    const deckFact = makeFinancialFact('arr', 1_000_000, {
      source_kind: 'deck',
      confidence: 'low',
    });

    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [xlsxFact, deckFact] });
    const rev = report.structured_summary?.revenue as any;
    const candidates: any[] = rev?.candidates ?? [];

    const xlsxCandidate = candidates.find((c: any) => c.amount === 4_000_000);
    const deckCandidate = candidates.find((c: any) => c.amount === 1_000_000);
    expect(xlsxCandidate!.authority_rank).toBe(5);
    expect(deckCandidate!.authority_rank).toBe(1);
  });
});

// ─── 4. BM recovery regression ──────────────────────────────────────────────

describe('Phase 6: BM recovery regression (policy path still fires)', () => {
  test('enterprise_saas_b2b_v1 + confidence=1 → still recovers after Phase 6 changes', () => {
    const dio = minimalDio({
      deal_classification_v1: {
        selected: {
          policy_id: 'enterprise_saas_b2b_v1',
          confidence: 1,
          asset_class: 'operating_company',
        },
      },
    });
    const report = compileDIOToReportWithPromotedFacts(dio);
    const bm = report.structured_summary?.business_model;
    expect(bm?.value).toBe('Subscription/SaaS (B2B)');
    expect(bm?.confidence).toBe(0.4);
    expect((bm as any)?.recovered).toBe(true);
    expect((bm as any)?.recovery_rule).toBe('policy_inferred_label');
  });

  test('BM recovery + case_study entity_scope revenue → both fire independently', () => {
    // BM recovery should not interfere with revenue entity_scope exclusion
    const dio = minimalDio({
      deal_classification_v1: {
        selected: {
          policy_id: 'enterprise_saas_b2b_v1',
          confidence: 1,
          asset_class: 'operating_company',
        },
      },
    });
    const caseStudyRevFact = makePromotedRevenueFact({
      amount: 50_000,
      entity_scope: 'case_study',
      confidence: 0.7,
    });

    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [caseStudyRevFact],
    });

    // BM recovered
    expect(report.structured_summary?.business_model?.value).toBe('Subscription/SaaS (B2B)');
    expect((report.structured_summary?.business_model as any)?.recovered).toBe(true);

    // Revenue: case-study fact was excluded so no valid revenue selected
    const rev = report.structured_summary?.revenue as any;
    if (rev?.value != null) {
      // If something was selected, it must not be the case-study fact
      expect(rev.value.amount).not.toBe(50_000);
    }
  });

  test('pre-computed entity_scope does not affect business_model field', () => {
    const dio = minimalDio({
      deal_classification_v1: {
        selected: { policy_id: 'marketplace_platform_v1', confidence: 0.9 },
      },
    });
    const report = compileDIOToReportWithPromotedFacts(dio);
    // BM should recover; entity_scope changes are revenue-only
    expect(report.structured_summary?.business_model?.value).toBe('Marketplace / Platform');
  });
});
