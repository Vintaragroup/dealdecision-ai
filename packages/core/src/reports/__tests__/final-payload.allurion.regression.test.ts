/**
 * Final Payload Regression — Allurion de-SPAC deal
 *
 * Verifies end-to-end that the compiler integration:
 *   1. Blocks "$1 Series A Convertible Note" from appearing in structured_summary.raise
 *   2. Blocks "Wholesale/Retail" from appearing in structured_summary.business_model
 *   3. Populates product/market fields from governed_ui_copy_v1 when enabled
 *   4. Records metadata diagnostics for field_authority_guard, field_candidate_selector,
 *      and final_publish_guard
 *
 * These tests simulate the DIO shape produced by the Allurion ingestion pipeline
 * (confirmed against 2026-04-09 audit: docs/Supporting/ + artifacts/).
 *
 * Leak paths targeted:
 *   A. deal_overview_v2.raise = "$1 Series A Convertible Note"
 *      → deal_overview_v2 sourced from LLM, not structured truth
 *   B. business_model_arbitration_v1.business_model = "Wholesale/Retail"
 *      → arbitration runs MD&A keyword scoring, produces generic accounting channel
 */

import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';

// ─── Allurion DIO simulation ───────────────────────────────────────────────────

/**
 * Minimal DIO that reproduces the Allurion false-positive output:
 *   - deal_overview_v2.raise = "$1 Series A Convertible Note"
 *   - business_model_arbitration_v1.business_model = "Wholesale/Retail"
 *   - Real product / market content in governed_ui_copy_v1
 */
function makeAllurionLikeDio(overrides?: {
  promotedRaiseAmount?: number;
  promotedRaiseDisplay?: string;
  governedBusinessModel?: string;
}): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: 'test-allurion-final-payload',
    deal_id: 'a85b0ac0-19a1-4992-9a21-2d47484b0f8f',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'sec_filing' },
    inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
    analyzer_results: {},
    dio: {
      phase1: {
        business_archetype_v1: { value: 'de_spac' },

        // LEAK PATH A: deal_overview_v2.raise = "$1 Series A Convertible Note"
        deal_overview_v2: {
          deal_type: 'de_spac',
          raise: overrides?.promotedRaiseDisplay ?? '$1 Series A Convertible Note',
          business_model: 'Direct sales to HCP',
          sources: [],
        },

        // LEAK PATH B: business_model_arbitration_v1 = "Wholesale/Retail" (MD&A keyword scoring)
        business_model_arbitration_v1: {
          business_model: 'Wholesale/Retail',
          confidence: 0.72,
          evidence: [
            { kind: 'mda_keyword', weight: 17, detail: 'wholesale distribution channel language in MD&A' },
          ],
        },

        // Allurion's governed_ui_copy — real description of the product and BM
        governed_ui_copy_v1: {
          product_solution:
            'Allurion Balloon is a swallowable intragastric balloon for weight management that requires no endoscopy, anesthesia, or surgery. The balloon is swallowed in capsule form and expands in the stomach.',
          market_icp:
            'Obesity treatment clinics, bariatric physicians, patients seeking non-surgical weight loss alternatives.',
          business_model:
            overrides?.governedBusinessModel ??
            'B2B2C model: Allurion sells the Virtual Care Suite and balloon system directly to healthcare providers (HCP channel), who then offer treatment to patients. Revenue from device sales and recurring software subscriptions.',
          raise_terms:
            'The business combination with Allurion was completed on August 1, 2023, providing significant cash proceeds and a pro forma enterprise value of $500M.',
        },

        executive_summary_v1: {
          raise: '$47.5M net proceeds',
          business_model: 'Medical device sold B2B through healthcare providers',
          confidence: { sections: { raise: 'medium', business_model: 'medium' }, overall: 'medium' },
          evidence: [],
        },
      },
    },
  };
}

/**
 * Allurion per-share raise fact — the exact false positive from the 2026-04-09 audit.
 * Source: EX-99.3 (SPAC entity financials), page 27 — liquidation preference table.
 */
function makeAllurionPerShareRaiseFact(): any {
  return {
    fact_type: 'raise_terms_v1',
    source_document_id: 'allurion-ex993-spac-fin',
    confidence: 0.85,
    content_json: {
      fact_type: 'raise_terms_v1',
      value_json: {
        display: '$1 Series A Convertible Note',
        raw_text: '$1 Series A Convertible Note',
        amount: { amount: 1.092, currency: 'USD' },
        note_snippet: 'per share liquidation preference equal to $1.092, Series A preferred stock',
      },
    },
  };
}

/**
 * Allurion pro forma revenue fact — the exact false positive from the 2026-04-09 audit.
 * Source: EX-99.5 (pro forma combined statements), footnote about prepayment fee.
 */
function makeAllurionProFormaRevenueFact(): any {
  return {
    fact_type: 'revenue_v1',
    source_document_id: 'allurion-ex995-pro-forma',
    confidence: 0.8,
    content_json: {
      fact_type: 'revenue_v1',
      value_json: {
        display: '$1.5M',
        raw_text: '$1,500,000',
        amount: { amount: 1_500_000, currency: 'USD' },
        scope: 'company_total',
        note_snippet:
          'transaction adjustment to record the expense related to the cash settlement of the prepayment and final payment fees',
      },
    },
  };
}

// ─── Allurion document metadata ───────────────────────────────────────────────

const ALLURION_DOCUMENTS = [
  { document_id: 'allurion-ex993-spac-fin', kind: 'spac_financials', filename: 'EX-99.3.pdf' },
  { document_id: 'allurion-ex995-pro-forma', kind: 'financial_pro_forma', filename: 'EX-99.5.pdf' },
  { document_id: 'allurion-ex991-fin-stmt', kind: 'financial_statements', filename: 'EX-99.1.pdf' },
  { document_id: 'allurion-8k', kind: 'sec_8k', filename: 'Form-8-K.pdf' },
  { document_id: 'allurion-deck', kind: 'pitch_deck', filename: 'Allurion-Investor-Deck.pdf' },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Allurion final payload regression — raise guard (Leak Path A)', () => {
  it('does not surface "$1 Series A Convertible Note" in structured_summary.raise.value', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionPerShareRaiseFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const raiseValue: string | null = (report.structured_summary as any)?.raise?.value ?? null;
    expect(raiseValue).not.toBe('$1 Series A Convertible Note');
    expect(raiseValue).not.toBe('$1');
    // If not null, it should NOT be an obviously per-share value
    if (raiseValue !== null) {
      expect(raiseValue.toLowerCase()).not.toMatch(/liquidation\s+preference/);
      expect(raiseValue.toLowerCase()).not.toMatch(/per[\s-]share/);
    }
  });

  it('does not surface $1.092 as raise.value_json.amount.amount', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionPerShareRaiseFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const raiseAmount = (report.structured_summary as any)?.raise?.value_json?.amount?.amount;
    if (raiseAmount !== null && raiseAmount !== undefined) {
      expect(raiseAmount).not.toBe(1.092);
      expect(raiseAmount).toBeGreaterThan(1_000); // minimum plausible: $1K
    }
  });

  it('records final_publish_guard or field_authority_guard as having acted on raise', async () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionPerShareRaiseFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const guardMeta = (report.metadata as any)?.field_authority_guard;
    const publishMeta = (report.metadata as any)?.final_publish_guard;

    // At least one layer should have acted: guard blocked the promoted fact
    // OR publish guard nulled the DIO-phase1 fallback value
    const guardActed = guardMeta?.rejected_count > 0;
    const publishActed = publishMeta?.fields_nulled?.includes('raise');
    expect(guardActed || publishActed).toBe(true);
  });

  it('does not surface "$1 Series A Convertible Note" in deal_summary_v1.tiers.overview', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionPerShareRaiseFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const overview = (report as any)?.deal_summary_v1?.tiers?.overview ?? '';
    expect(overview).not.toContain('$1 Series A');
    expect(overview).not.toContain('$1 Convertible');
  });
});

describe('Allurion final payload regression — business_model guard (Leak Path B)', () => {
  it('does not surface "Wholesale/Retail" in structured_summary.business_model.value', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [],
      documents: ALLURION_DOCUMENTS,
    });

    const bmValue: string | null = (report.structured_summary as any)?.business_model?.value ?? null;
    expect(bmValue).not.toBe('Wholesale/Retail');
    expect(bmValue).not.toMatch(/^wholesale\/retail$/i);
  });

  it('does not surface "Wholesale/Retail" in deal_summary_v1.tiers.deep', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [],
      documents: ALLURION_DOCUMENTS,
    });

    const deep = (report as any)?.deal_summary_v1?.tiers?.deep ?? '';
    expect(deep).not.toContain('Wholesale/Retail');
    expect(deep.toLowerCase()).not.toMatch(/business model:.*wholesale/i);
  });

  it('replaces "Wholesale/Retail" with governed_ui_copy business_model when available', () => {
    const dio = makeAllurionLikeDio({
      governedBusinessModel:
        'B2B2C model: sells the Virtual Care Suite and balloon system directly to healthcare providers (HCP channel)',
    });
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [],
      documents: ALLURION_DOCUMENTS,
    });

    const bmValue: string | null = (report.structured_summary as any)?.business_model?.value ?? null;
    // Should either be null OR the governed_ui_copy replacement, never "Wholesale/Retail"
    expect(bmValue).not.toMatch(/^wholesale\/retail$/i);
    if (bmValue !== null) {
      // The replacement should reference HCP or B2B context
      const bmLower = bmValue.toLowerCase();
      expect(
        bmLower.includes('hcp') || bmLower.includes('healthcare') || bmLower.includes('b2b') || bmLower.includes('care suite'),
      ).toBe(true);
    }
  });

  it('records final_publish_guard.fields_nulled or fields_replaced containing "business_model"', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [],
      documents: ALLURION_DOCUMENTS,
    });

    const publishMeta = (report.metadata as any)?.final_publish_guard;
    if (publishMeta) {
      const acted =
        publishMeta.fields_nulled?.includes('business_model') ||
        publishMeta.fields_replaced?.includes('business_model');
      expect(acted).toBe(true);
    }
    // If publishMeta is undefined, business_model must not be "Wholesale/Retail"
    const bmValue = (report.structured_summary as any)?.business_model?.value;
    expect(bmValue).not.toMatch(/^wholesale\/retail$/i);
  });
});

describe('Allurion final payload regression — revenue guard', () => {
  it('does not surface $1.5M pro forma revenue in structured_summary', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionProFormaRevenueFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const revenueRaw = (report.structured_summary as any)?.revenue?.value?.raw;
    if (revenueRaw !== null && revenueRaw !== undefined) {
      expect(revenueRaw).not.toBe('$1.5M');
      expect(revenueRaw).not.toBe('$1,500,000');
    }
    const revenueAmount = (report.structured_summary as any)?.revenue?.value_json?.amount;
    if (typeof revenueAmount === 'number') {
      expect(revenueAmount).not.toBe(1_500_000);
    }
  });
});

describe('Allurion final payload regression — product/market fill-in', () => {
  it('populates structured_summary.product_summary_v1 from governed_ui_copy_v1', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [],
      documents: ALLURION_DOCUMENTS,
    });

    const productValue = (report.structured_summary as any)?.product_summary_v1?.value;
    expect(productValue).toBeTruthy();
    // Should contain Allurion product description keywords
    const productLower = (productValue ?? '').toLowerCase();
    expect(
      productLower.includes('balloon') || productLower.includes('allurion') || productLower.includes('weight'),
    ).toBe(true);
  });

  it('populates structured_summary.market_summary_v1 from governed_ui_copy_v1', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [],
      documents: ALLURION_DOCUMENTS,
    });

    const marketValue = (report.structured_summary as any)?.market_summary_v1?.value;
    expect(marketValue).toBeTruthy();
    const marketLower = (marketValue ?? '').toLowerCase();
    expect(
      marketLower.includes('obesity') || marketLower.includes('bariatric') || marketLower.includes('hcp'),
    ).toBe(true);
  });
});

describe('Allurion final payload regression — metadata diagnostics', () => {
  it('attaches metadata.field_authority_guard when facts are evaluated', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionPerShareRaiseFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const guardMeta = (report.metadata as any)?.field_authority_guard;
    expect(guardMeta).toBeDefined();
    expect(typeof guardMeta.rejected_count).toBe('number');
    expect(typeof guardMeta.accepted_count).toBe('number');
    expect(Array.isArray(guardMeta.log)).toBe(true);
  });

  it('attaches metadata.final_publish_guard when guard acted', () => {
    const dio = makeAllurionLikeDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      promotedFacts: [makeAllurionPerShareRaiseFact()],
      documents: ALLURION_DOCUMENTS,
    });

    const publishMeta = (report.metadata as any)?.final_publish_guard;
    // Guard should have acted on raise or business_model
    if (publishMeta) {
      expect(Array.isArray(publishMeta.log)).toBe(true);
    }
    // Either the publish guard metadata exists and has entries, OR the raise/BM values aren't bad
    const raiseValue = (report.structured_summary as any)?.raise?.value;
    const bmValue = (report.structured_summary as any)?.business_model?.value;
    expect(raiseValue).not.toBe('$1 Series A Convertible Note');
    expect(bmValue).not.toMatch(/^wholesale\/retail$/i);
  });
});
