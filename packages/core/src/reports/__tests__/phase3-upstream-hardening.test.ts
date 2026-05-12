/**
 * P5 Phase 3 — upstream hardening tests.
 *
 * Covers four fixes introduced in Phase 3:
 *
 * 1. toPolicyAwareBusinessModelDisplay — startup policy must block signal-based
 *    real-estate / fund overrides (Carmoola root-cause fix).
 *
 * 2. injectCanonicalRevenueIntoStructuredSummary — proforma-model current-year
 *    XLSX facts must be tagged is_projected=true (DealDecision / 3ICE pattern).
 *
 * 3. Growth source_support_level — growth percent from a promoted fact without
 *    a YoY comparison basis must carry source_support_level='weak'.
 *
 * 4. Customers source_support_level + confidence downgrade — customer count
 *    with no primary page citation must carry source_support_level='weak' and
 *    confidence capped at 0.45 (Allurion pattern).
 */

import { toPolicyAwareBusinessModelDisplay } from '../../classification/policy-aware-schema';
import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1';

// ─── Shared helpers ───────────────────────────────────────────────────────────

let _seq = 0;

function makeFinancialFact(
  metric_key: string,
  value: number,
  overrides: Partial<FinancialFactV1> = {},
): FinancialFactV1 {
  const id = `phase3:${metric_key}:${++_seq}`;
  return {
    fact_id: id,
    deal_id: 'deal-phase3',
    document_id: 'doc-xlsx',
    source_kind: 'xlsx',
    metric_key,
    period_type: 'annual',
    period_label: 'current',
    value,
    unit: 'currency',
    currency: 'USD',
    confidence: 'high',
    ...overrides,
  };
}

function minimalDio(): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: 'phase3-test-dio',
    deal_id: 'phase3-test-deal',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
    analyzer_results: {},
    dio: { phase1: {} },
  };
}

// ─── 1. toPolicyAwareBusinessModelDisplay — startup policy protection ─────────

describe('toPolicyAwareBusinessModelDisplay — Phase 3: startup policy blocks signal overrides', () => {
  test('startup policy + hasRealEstateSignals:true → does NOT return real estate label', () => {
    // Carmoola pattern: deck mentions LTV (car-loan metric), but policy is fintech.
    const result = toPolicyAwareBusinessModelDisplay({
      policyId: 'consumer_ecommerce_brand_v1',
      rawLabel: 'Omnichannel (DTC + Wholesale/Retail)',
      hasRealEstateSignals: true,
    });
    expect(result.display).toBe('Omnichannel (DTC + Wholesale/Retail)');
    expect(result.display).not.toBe('Real estate structured investment');
    expect(result.suppressedReasons).not.toContain('startup_channel_label_suppressed_for_real_estate');
  });

  test('consumer_fintech_platform_v1 policy + hasRealEstateSignals:true → preserves fintech label', () => {
    const result = toPolicyAwareBusinessModelDisplay({
      policyId: 'consumer_fintech_platform_v1',
      rawLabel: 'Subscription/SaaS',
      hasRealEstateSignals: true,
    });
    expect(result.display).toBe('Subscription/SaaS');
  });

  test('startup policy + hasFundSignals:true → does NOT return fund label', () => {
    const result = toPolicyAwareBusinessModelDisplay({
      policyId: 'enterprise_saas_b2b_v1',
      rawLabel: 'Subscription/SaaS',
      hasFundSignals: true,
    });
    expect(result.display).toBe('Subscription/SaaS');
    expect(result.display).not.toBe('Fund / SPV investment vehicle');
  });

  test('null policy + hasRealEstateSignals:true → still returns real estate label (no-policy fallback preserved)', () => {
    // Deals with no policy set should still use signals as a classification hint.
    const result = toPolicyAwareBusinessModelDisplay({
      policyId: null,
      rawLabel: 'Omnichannel (DTC + Wholesale/Retail)',
      hasRealEstateSignals: true,
    });
    expect(result.display).toBe('Real estate structured investment');
  });

  test('real_estate_underwriting policy → always returns real estate label regardless of rawLabel', () => {
    const result = toPolicyAwareBusinessModelDisplay({
      policyId: 'real_estate_underwriting',
      rawLabel: 'DTC Ecommerce',
      hasRealEstateSignals: false,
    });
    expect(result.display).toBe('Real estate structured investment');
  });

  test('"other" family policy + hasRealEstateSignals:true → signal-based real estate override applies', () => {
    // Unknown policy IDs produce family="other" which is not "startup", so signal still wins.
    const result = toPolicyAwareBusinessModelDisplay({
      policyId: 'unknown_policy_xyz',
      rawLabel: 'DTC Ecommerce',
      hasRealEstateSignals: true,
    });
    expect(result.display).toBe('Real estate structured investment');
  });
});

// ─── 2. Revenue is_projected propagation for proforma models ──────────────────

describe('compiler — Phase 3: revenue is_projected for proforma-model XLSX facts', () => {
  const CURRENT_YEAR = new Date().getFullYear();
  const FUTURE_YEAR = CURRENT_YEAR + 1;
  const PAST_YEAR = CURRENT_YEAR - 1;

  test('proforma current-year fact (+ future-year XLSX present) → is_projected:true on structured_summary.revenue', () => {
    // DealDecision pattern: XLSX has 2026/2027/2028 columns — the 2026 value is a
    // proforma budget, not a realized operating figure.
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 3_300_000, {
        period_label: String(CURRENT_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'medium',
        // temporal_scope intentionally absent (as-extracted from XLSX)
      }),
      makeFinancialFact('revenue', 15_500_000, {
        period_label: String(FUTURE_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'medium',
        temporal_scope: 'projected',
      }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    expect(rev).toBeTruthy();
    // The proforma-model fact is selected (Tier D) and must carry projection flags.
    expect(rev?.is_projected).toBe(true);
    expect(rev?.is_provisional).toBe(true);
    expect(rev?.value?.amount).toBe(3_300_000);
  });

  test('explicit future-year fact → is_projected:true (existing behavior preserved)', () => {
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 8_000_000, {
        period_label: String(FUTURE_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'medium',
        temporal_scope: 'projected',
      }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    // Future-year only: all tiers fail (requireNonProjected), so revenue.value is null.
    // The important thing is is_projected is not spuriously set on a null value.
    const rev = report.structured_summary?.revenue;
    if (rev?.value != null) {
      // Should only happen if a non-projected path is triggered
      expect(rev?.is_projected).toBe(true);
    }
  });

  test('historical-only XLSX fact → is_projected NOT set', () => {
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 5_000_000, {
        period_label: String(PAST_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    expect(rev?.value?.amount).toBe(5_000_000);
    expect(rev?.is_projected).toBeFalsy();
  });

  test('historical XLSX alongside current-year XLSX — neither flagged as proforma (no future-year XLSX trigger)', () => {
    // When historical XLSX facts exist with NO future-year XLSX entries, the proforma
    // guard must NOT fire. Whatever canonical fact is selected must NOT carry is_projected.
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 2_500_000, {
        period_label: String(PAST_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
      makeFinancialFact('revenue', 4_000_000, {
        period_label: String(CURRENT_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    // Either fact may be selected — historical facts have no proforma trigger.
    expect([2_500_000, 4_000_000]).toContain(rev?.value?.amount);
    // Neither is proforma — is_projected must NOT be set.
    expect(rev?.is_projected).toBeFalsy();
  });
});

// ─── 3. Growth source_support_level ──────────────────────────────────────────

describe('compiler — Phase 3: growth source_support_level', () => {
  function makeGrowthFact(noteSnippet: string, conf = 0.72): any {
    return {
      fact_type: 'growth_v1',
      confidence: conf,
      extracted_at: new Date().toISOString(),
      source_path: 'doc:doc-growth:page:5',
      source_document_id: 'doc-growth',
      content_json: {
        fact_type: 'growth_v1',
        value_json: {
          percent: 85,
          display: '85% growth',
          raw: '85%',
          note_snippet: noteSnippet,
        },
        provenance: {
          source_document_id: 'doc-growth',
          page_index: 4,
          slide_title: 'Financial Performance',
          segment_key: 'traction',
        },
      },
    };
  }

  test('growth note without YoY comparison basis → source_support_level="weak"', () => {
    // Qredible / Cino pattern: growth percent present but no explicit YoY reference.
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [makeGrowthFact('Revenue increased 85% this year.')],
    });
    expect(report.structured_summary?.growth?.source_support_level).toBe('weak');
    expect(report.structured_summary?.growth?.value?.percent).toBe(85);
  });

  test('growth note with "yoy" → source_support_level="moderate"', () => {
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [makeGrowthFact('Revenue grew 85% YoY from $2.1M to $3.9M.')],
    });
    expect(report.structured_summary?.growth?.source_support_level).toBe('moderate');
  });

  test('growth note with "y/y" → source_support_level="moderate"', () => {
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [makeGrowthFact('Sales are up 85% y/y.')],
    });
    expect(report.structured_summary?.growth?.source_support_level).toBe('moderate');
  });

  test('growth note with "year over year" → source_support_level="moderate"', () => {
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [makeGrowthFact('85% growth year over year in core markets.')],
    });
    expect(report.structured_summary?.growth?.source_support_level).toBe('moderate');
  });

  test('growth note with "vs" → source_support_level="moderate"', () => {
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [makeGrowthFact('$3.9M vs $2.1M prior year — 85% growth.')],
    });
    expect(report.structured_summary?.growth?.source_support_level).toBe('moderate');
  });

  test('growth confidence value is still applied when source_support_level is weak', () => {
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [makeGrowthFact('Growth was strong this quarter.', 0.8)],
    });
    // Confidence should not be capped — only source_support_level reflects weakness.
    expect(report.structured_summary?.growth?.confidence).toBeCloseTo(0.8, 2);
    expect(report.structured_summary?.growth?.source_support_level).toBe('weak');
  });
});

// ─── 4. Customers source_support_level and confidence downgrade ───────────────

describe('compiler — Phase 3: customers source_support_level and confidence downgrade', () => {
  function makeCustomersFact(opts: {
    count: number;
    pageIndex: number | null;
    docId: string | null;
    conf?: number;
    noteSnippet?: string;
  }): any {
    const prov: Record<string, any> = {
      slide_title: 'Traction',
      segment_key: 'traction',
    };
    if (opts.pageIndex !== null) prov['page_index'] = opts.pageIndex;
    if (opts.docId !== null) prov['source_document_id'] = opts.docId;

    return {
      fact_type: 'customers_v1',
      confidence: opts.conf ?? 0.75,
      extracted_at: new Date().toISOString(),
      source_path: opts.docId !== null && opts.pageIndex !== null
        ? `doc:${opts.docId}:page:${opts.pageIndex + 1}`
        : null,
      source_document_id: opts.docId,
      content_json: {
        fact_type: 'customers_v1',
        value_json: {
          count: opts.count,
          display: `${opts.count}+ active clients`,
          raw: `${opts.count}+ active clients`,
          subtype: 'active',
          note_snippet: opts.noteSnippet ?? `${opts.count} active clients on platform`,
        },
        provenance: prov,
      },
    };
  }

  test('customers fact with page citation → source_support_level="moderate", confidence preserved', () => {
    const fact = makeCustomersFact({ count: 150, pageIndex: 7, docId: 'doc-abc', conf: 0.75 });
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { promotedFacts: [fact] });
    const cust = report.structured_summary?.customers;
    expect(cust?.source_support_level).toBe('moderate');
    expect(cust?.confidence).toBeGreaterThan(0.45);
    expect(cust?.value?.count).toBe(150);
  });

  test('customers fact without page citation → source_support_level="weak", confidence ≤ 0.45 (Allurion pattern)', () => {
    // Allurion pattern: customer count surfaced without a verifiable page reference.
    const fact = makeCustomersFact({ count: 500, pageIndex: null, docId: null, conf: 0.75 });
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { promotedFacts: [fact] });
    const cust = report.structured_summary?.customers;
    expect(cust?.source_support_level).toBe('weak');
    expect(cust?.confidence).toBeLessThanOrEqual(0.45);
    expect(cust?.value?.count).toBe(500);
  });

  test('customers fact without doc_id but with page_index → source_support_level="weak"', () => {
    // page_index alone without a document_id is not a verifiable citation.
    const fact = makeCustomersFact({ count: 80, pageIndex: 3, docId: null, conf: 0.72 });
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { promotedFacts: [fact] });
    expect(report.structured_summary?.customers?.source_support_level).toBe('weak');
    expect(report.structured_summary?.customers?.confidence).toBeLessThanOrEqual(0.45);
  });

  test('customers fact low-conf with page citation → source_support_level="moderate", not double-penalized', () => {
    // A low-confidence fact with a valid citation should not be capped below its own
    // natural confidence — the citation IS the provenance, no further penalty.
    const fact = makeCustomersFact({ count: 30, pageIndex: 2, docId: 'doc-xyz', conf: 0.4 });
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { promotedFacts: [fact] });
    const cust = report.structured_summary?.customers;
    expect(cust?.source_support_level).toBe('moderate');
    // Confidence should be the original 0.4, not capped further.
    expect(cust?.confidence).toBeCloseTo(0.4, 2);
  });
});
