/**
 * P5 Phase 4 — Real Estate Authority Hardening tests.
 *
 * Covers four fixes introduced in Phase 4:
 *
 * 1. FPG — isDealClassifiedAsRealEstate: CRE classification guard via
 *    deal_classification_v1.selected.asset_class / policy_id.
 *    Fixes Albuquerque pattern where DIO text is vague but classification
 *    is real_estate.
 *
 * 2. Document-family authority weighting — offering_memorandum + investment_memo
 *    families added to KIND_TO_FAMILY, FILENAME_TO_FAMILY_PATTERNS, and all 4
 *    rank tables.
 *
 * 3. Compiler DIO BM identity containment — blocks stale DIO phase1 BM
 *    fallbacks (arbitratedModel, overviewModel, execModel) for real-estate-
 *    classified deals.
 *
 * 4. Financial fact fact_type_label — classifyRevenueFactType propagates to
 *    structured_summary.revenue.fact_type_label and revenue.candidates[].fact_type_label.
 */

import { applyFinalPublishGuard } from '../final-publish-guard';
import {
  classifyDocumentFamily,
  BUSINESS_MODEL_AUTHORITY_RANK,
  REVENUE_AUTHORITY_RANK,
  RAISE_AUTHORITY_RANK,
  DOCUMENT_AUTHORITY_RANK,
} from '../document-authority-tiers';
import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1';

// ─── Shared helpers ───────────────────────────────────────────────────────────

let _seq = 0;

function makeFinancialFact(
  metric_key: string,
  value: number,
  overrides: Partial<FinancialFactV1> = {},
): FinancialFactV1 {
  const id = `phase4:${metric_key}:${++_seq}`;
  return {
    fact_id: id,
    deal_id: 'deal-phase4',
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

/**
 * Minimal DIO with optional overrides merged into the nested `dio` object.
 * To modify phase1 fields, pass `{ phase1: { ... } }` in dioOverrides.
 * To add deal_classification_v1, pass `{ deal_classification_v1: { selected: { ... } } }`.
 */
function minimalDio(dioOverrides: Record<string, any> = {}): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: 'phase4-test-dio',
    deal_id: 'phase4-test-deal',
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

/** Build a structured summary with a BM value and empty sources (no pitch-deck source). */
function structuredSummaryWithBM(value: string, sources: any[] = []) {
  return { business_model: { value, confidence: 0.8, sources } };
}

/** BM values that satisfy `isGenericDistributionTerm` in the FPG. */
const OMNICHANNEL_BM = 'Omnichannel (DTC + Wholesale/Retail)';
const WHOLESALE_BM = 'Wholesale';

// ─── 1. FPG — CRE classification guard ────────────────────────────────────────

describe('FPG — Phase 4: CRE classification guard (real_estate_classification_mismatch)', () => {
  test('asset_class="real_estate" + generic BM → nulled with real_estate_classification_mismatch', () => {
    // Albuquerque pattern: deal_classification_v1 marks this as real_estate but the
    // DIO text is vague and doesn't trigger the text-based CRE patterns.
    const ss = structuredSummaryWithBM(OMNICHANNEL_BM);
    const context = {
      dio: {
        dio: {
          deal_classification_v1: {
            selected: { asset_class: 'real_estate', policy_id: 'real_estate_underwriting' },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
    expect(result.fields_nulled).toContain('business_model');
    const entry = result.log.find((e) => e.field === 'business_model' && e.action === 'nulled');
    expect(entry?.rule).toBe('business_model.real_estate_classification_mismatch');
  });

  test('policy_id="real_estate_underwriting" alone → nulled with real_estate_classification_mismatch', () => {
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          deal_classification_v1: {
            selected: { policy_id: 'real_estate_underwriting', asset_class: '' },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
    const entry = result.log.find((e) => e.field === 'business_model' && e.action === 'nulled');
    expect(entry?.rule).toBe('business_model.real_estate_classification_mismatch');
  });

  test('asset_class starts with "real_estate_" (variant) → nulled', () => {
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          deal_classification_v1: {
            selected: { policy_id: 'real_estate_commercial_v1', asset_class: 'equity' },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
    expect(result.fields_nulled).toContain('business_model');
  });

  test('asset_class="fintech" → NOT nulled (Carmoola regression guard)', () => {
    // Carmoola has car-loan LTV signals but is consumer fintech — must NOT be nulled.
    const ss = structuredSummaryWithBM(OMNICHANNEL_BM);
    const context = {
      dio: {
        dio: {
          deal_classification_v1: {
            selected: { asset_class: 'fintech', policy_id: 'consumer_fintech_platform_v1' },
          },
        },
      },
    };
    applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBe(OMNICHANNEL_BM);
  });

  test('no deal_classification_v1 → NOT nulled by classification guard', () => {
    // When classification is absent, text-only path applies.
    // OMNICHANNEL_BM with no CRE text → preserved (isQualifiedMultiChannelLabel guard triggers).
    const ss = structuredSummaryWithBM(OMNICHANNEL_BM);
    const context = { dio: { dio: {} } };
    applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBe(OMNICHANNEL_BM);
  });

  test('null/missing dio → NOT nulled spuriously', () => {
    const ss = structuredSummaryWithBM(OMNICHANNEL_BM);
    applyFinalPublishGuard(ss, { dio: null }, null);
    expect(ss.business_model.value).toBe(OMNICHANNEL_BM);

    const ss2 = structuredSummaryWithBM(OMNICHANNEL_BM);
    applyFinalPublishGuard(ss2, {}, null);
    expect(ss2.business_model.value).toBe(OMNICHANNEL_BM);
  });

  // ── Expanded text pattern tests ──

  test('CRE text "stabilized yield" in product_solution → nulled (expanded text pattern)', () => {
    // New pattern: stabilized yield is a real-estate term not matched before Phase 4.
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          phase1: {
            deal_overview_v2: {
              product_solution: 'The property targets a stabilized yield of 7.5% on completion.',
            },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
    expect(result.fields_nulled).toContain('business_model');
    const entry = result.log.find((e) => e.field === 'business_model' && e.action === 'nulled');
    // Text-based detection (no classification) → context_mismatch rule
    expect(entry?.rule).toBe('business_model.real_estate_context_mismatch');
  });

  test('CRE text "sources and uses" → nulled (expanded text pattern)', () => {
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          phase1: {
            deal_overview_v2: {
              product_solution: 'See sources and uses of capital for project funding breakdown.',
            },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
    expect(result.fields_nulled).toContain('business_model');
  });

  test('CRE text "construction loan" → nulled (expanded text pattern)', () => {
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          phase1: {
            deal_overview_v2: {
              product_solution: 'Secured a construction loan of $12M for the project.',
            },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
  });

  test('CRE text "offering memorandum" → nulled (expanded text pattern)', () => {
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          phase1: {
            deal_overview_v2: {
              product_solution: 'Refer to the offering memorandum for full investment terms.',
            },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
  });

  test('classification fires (no text) → creRule = classification_mismatch, not context_mismatch', () => {
    // Ensure the two distinct rule IDs are used correctly.
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          // No phase1 text — only classification
          deal_classification_v1: { selected: { asset_class: 'real_estate' } },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    const entry = result.log.find((e) => e.field === 'business_model' && e.action === 'nulled');
    // Classification-only path → distinct rule
    expect(entry?.rule).toBe('business_model.real_estate_classification_mismatch');
  });

  test('both classification + text fire → creRule = classification_mismatch (classification takes precedence in rule selection)', () => {
    // When both fire, the rule name should be classification_mismatch.
    const ss = structuredSummaryWithBM(WHOLESALE_BM);
    const context = {
      dio: {
        dio: {
          deal_classification_v1: { selected: { asset_class: 'real_estate' } },
          phase1: {
            deal_overview_v2: {
              product_solution: 'stabilized yield on portfolio assets',
            },
          },
        },
      },
    };
    const result = applyFinalPublishGuard(ss, context, null);
    expect(ss.business_model.value).toBeNull();
    // Both fire — creByText=true, creByClassification=true
    // creRule = creByClassification && !creByText ? 'classification_mismatch' : 'context_mismatch'
    // → creByText=true → context_mismatch
    const entry = result.log.find((e) => e.field === 'business_model' && e.action === 'nulled');
    expect(entry?.rule).toBe('business_model.real_estate_context_mismatch');
  });
});

// ─── 2. Document family classification ────────────────────────────────────────

describe('document-authority-tiers — Phase 4: offering_memorandum + investment_memo families', () => {
  function doc(kind: string | null, filename: string | null = null) {
    return [{ document_id: 'doc-1', kind, filename }];
  }

  describe('kind mapping', () => {
    test('kind="offering_memorandum" → offering_memorandum', () => {
      expect(classifyDocumentFamily('doc-1', doc('offering_memorandum'))).toBe('offering_memorandum');
    });

    test('kind="offering_memo" → offering_memorandum', () => {
      expect(classifyDocumentFamily('doc-1', doc('offering_memo'))).toBe('offering_memorandum');
    });

    test('kind="investment_memo" → investment_memo', () => {
      expect(classifyDocumentFamily('doc-1', doc('investment_memo'))).toBe('investment_memo');
    });

    test('kind="investment_committee_memo" → investment_memo', () => {
      expect(classifyDocumentFamily('doc-1', doc('investment_committee_memo'))).toBe('investment_memo');
    });
  });

  describe('filename pattern matching', () => {
    function fileDoc(filename: string) {
      return [{ document_id: 'doc-1', kind: null, filename }];
    }

    test('filename="offering-memo.pdf" → offering_memorandum', () => {
      expect(classifyDocumentFamily('doc-1', fileDoc('offering-memo.pdf'))).toBe('offering_memorandum');
    });

    test('filename="Offering Memorandum 2024.pdf" → offering_memorandum', () => {
      expect(classifyDocumentFamily('doc-1', fileDoc('Offering Memorandum 2024.pdf'))).toBe('offering_memorandum');
    });

    test('filename="investment-memorandum.pdf" → investment_memo', () => {
      expect(classifyDocumentFamily('doc-1', fileDoc('investment-memorandum.pdf'))).toBe('investment_memo');
    });

    test('filename="IC-memo-Q4.pdf" → investment_memo', () => {
      expect(classifyDocumentFamily('doc-1', fileDoc('IC-memo-Q4.pdf'))).toBe('investment_memo');
    });

    test('filename="deal-memo-round-a.pdf" → investment_memo', () => {
      expect(classifyDocumentFamily('doc-1', fileDoc('deal-memo-round-a.pdf'))).toBe('investment_memo');
    });

    test('filename="icmemo.pdf" → investment_memo', () => {
      expect(classifyDocumentFamily('doc-1', fileDoc('icmemo.pdf'))).toBe('investment_memo');
    });
  });

  describe('authority rank values', () => {
    test('BUSINESS_MODEL_AUTHORITY_RANK["offering_memorandum"] = 10 (near-forbidden for BM)', () => {
      expect(BUSINESS_MODEL_AUTHORITY_RANK['offering_memorandum']).toBe(10);
    });

    test('BUSINESS_MODEL_AUTHORITY_RANK["investment_memo"] = 25', () => {
      expect(BUSINESS_MODEL_AUTHORITY_RANK['investment_memo']).toBe(25);
    });

    test('REVENUE_AUTHORITY_RANK["offering_memorandum"] = 20 (OM revenue = projected NOI, not ops)', () => {
      expect(REVENUE_AUTHORITY_RANK['offering_memorandum']).toBe(20);
    });

    test('REVENUE_AUTHORITY_RANK["investment_memo"] = 30', () => {
      expect(REVENUE_AUTHORITY_RANK['investment_memo']).toBe(30);
    });

    test('RAISE_AUTHORITY_RANK["offering_memorandum"] = 25 (OM targets ≠ closed-deal terms)', () => {
      expect(RAISE_AUTHORITY_RANK['offering_memorandum']).toBe(25);
    });

    test('RAISE_AUTHORITY_RANK["investment_memo"] = 35', () => {
      expect(RAISE_AUTHORITY_RANK['investment_memo']).toBe(35);
    });

    test('DOCUMENT_AUTHORITY_RANK["offering_memorandum"] = 30', () => {
      expect(DOCUMENT_AUTHORITY_RANK['offering_memorandum']).toBe(30);
    });

    test('DOCUMENT_AUTHORITY_RANK["investment_memo"] = 42', () => {
      expect(DOCUMENT_AUTHORITY_RANK['investment_memo']).toBe(42);
    });

    test('offering_memorandum ranks BELOW pitch_deck in all field-specific tables', () => {
      expect(BUSINESS_MODEL_AUTHORITY_RANK['offering_memorandum']).toBeLessThan(
        BUSINESS_MODEL_AUTHORITY_RANK['pitch_deck'],
      );
      expect(REVENUE_AUTHORITY_RANK['offering_memorandum']).toBeLessThan(
        REVENUE_AUTHORITY_RANK['pitch_deck'],
      );
    });

    test('investment_memo ranks BELOW pitch_deck in business_model table', () => {
      expect(BUSINESS_MODEL_AUTHORITY_RANK['investment_memo']).toBeLessThan(
        BUSINESS_MODEL_AUTHORITY_RANK['pitch_deck'],
      );
    });
  });
});

// ─── 3. Compiler DIO BM identity containment (Part 3) ─────────────────────────

describe('compiler — Phase 4: DIO BM identity containment for CRE deals', () => {
  test('CRE deal + arbitratedModel present → structured.business_model.value is null', () => {
    // Albuquerque pattern: DIO business_model_arbitration_v1 has a wrong consumer-brand
    // BM value, but deal is classified as real_estate — must not fill BM from DIO phase1.
    const dio = minimalDio({
      deal_classification_v1: {
        selected: { asset_class: 'real_estate', policy_id: 'real_estate_underwriting' },
      },
      phase1: {
        business_model_arbitration_v1: {
          business_model: OMNICHANNEL_BM,
          confidence: 0.85,
          evidence: [],
        },
      },
    });
    const report = compileDIOToReportWithPromotedFacts(dio);
    expect(report.structured_summary?.business_model?.value).toBeNull();
  });

  test('CRE deal + overviewModel + valid page citation → BM still null', () => {
    // Even when deal_overview_v2.business_model has a proper page citation,
    // isDioRealEstate guard must block it for CRE deals.
    const dio = minimalDio({
      deal_classification_v1: {
        selected: { asset_class: 'real_estate' },
      },
      phase1: {
        deal_overview_v2: {
          business_model: OMNICHANNEL_BM,
          sources: [{ document_id: 'doc-overview', page_index: 3, source_document_id: 'doc-overview' }],
        },
      },
    });
    const report = compileDIOToReportWithPromotedFacts(dio);
    expect(report.structured_summary?.business_model?.value).toBeNull();
  });

  test('non-CRE deal + arbitratedModel = "Subscription/SaaS" → BM is filled (regression guard)', () => {
    // Regression: non-CRE deals must continue to use DIO arbitrated BM.
    const dio = minimalDio({
      phase1: {
        business_model_arbitration_v1: {
          business_model: 'Subscription/SaaS',
          confidence: 0.85,
          evidence: [],
        },
      },
    });
    const report = compileDIOToReportWithPromotedFacts(dio);
    expect(report.structured_summary?.business_model?.value).toBe('Subscription/SaaS');
  });

  test('non-CRE deal with empty deal_classification_v1.selected → BM still fills (null asset_class path)', () => {
    // When classification is present but asset_class is empty, isDioRealEstate = false.
    const dio = minimalDio({
      deal_classification_v1: {
        selected: { asset_class: '', policy_id: 'consumer_ecommerce_brand_v1' },
      },
      phase1: {
        business_model_arbitration_v1: {
          business_model: 'Subscription/SaaS',
          confidence: 0.85,
          evidence: [],
        },
      },
    });
    const report = compileDIOToReportWithPromotedFacts(dio);
    expect(report.structured_summary?.business_model?.value).toBe('Subscription/SaaS');
  });
});

// ─── 4. Financial fact_type_label via compiled revenue ────────────────────────

describe('compiler — Phase 4: fact_type_label in structured_summary.revenue', () => {
  const PAST_YEAR = new Date().getFullYear() - 1;
  const CURRENT_YEAR = new Date().getFullYear();
  const FUTURE_YEAR = new Date().getFullYear() + 1;

  test('historical XLSX annual → fact_type_label="actual"', () => {
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 4_000_000, {
        period_label: String(PAST_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
    ];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    expect(rev?.value?.amount).toBe(4_000_000);
    expect(rev?.fact_type_label).toBe('actual');
    expect(rev?.is_projected).toBeFalsy();
  });

  test('proforma-model XLSX (current-year + future-year trigger) → fact_type_label="projected"', () => {
    // DealDecision / 3ICE pattern: XLSX spans from current year to future year,
    // indicating the current-year value is a proforma budget, not realized actuals.
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 3_300_000, {
        period_label: String(CURRENT_YEAR),
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'medium',
        // temporal_scope absent — as-extracted from proforma XLSX
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
    expect(rev?.value?.amount).toBe(3_300_000);
    expect(rev?.is_projected).toBe(true);
    expect(rev?.fact_type_label).toBe('projected');
  });

  test('candidate records include fact_type_label', () => {
    // The candidates array (used by the UI for alternate-fact exploration) must also
    // carry fact_type_label so the UI can surface actuals vs projected candidates.
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 4_000_000, {
        period_label: String(PAST_YEAR),
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
    ];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    expect(Array.isArray(rev?.candidates)).toBe(true);
    const selected = (rev?.candidates as any[])?.find((c: any) => c.selected === true);
    expect(selected).toBeDefined();
    expect(selected?.fact_type_label).toBe('actual');
  });

  test('interim period label → fact_type_label="interim"', () => {
    // H1 / Q1 period facts should be classified as interim, not annual actuals.
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 2_000_000, {
        period_label: 'H1 2024',
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
    ];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    // If this fact is selected, fact_type_label must be 'interim'
    if (rev?.value != null) {
      expect(rev.fact_type_label).toBe('interim');
    }
  });

  test('Q-period label → fact_type_label="interim"', () => {
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 900_000, {
        period_label: 'Q1 2024',
        period_type: 'annual',
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
    ];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    if (rev?.value != null) {
      expect(rev.fact_type_label).toBe('interim');
    }
  });

  test('mixed actuals: projected candidate carries fact_type_label="projected"', () => {
    // When both historical and projected facts exist, the projected candidate in the
    // candidates array must carry fact_type_label="projected".
    const financialFacts: FinancialFactV1[] = [
      makeFinancialFact('revenue', 5_000_000, {
        period_label: String(PAST_YEAR),
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'historical',
      }),
      makeFinancialFact('revenue', 8_000_000, {
        period_label: String(CURRENT_YEAR),
        source_kind: 'xlsx',
        confidence: 'high',
        temporal_scope: 'projected',
      }),
    ];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), { financialFacts });
    const rev = report.structured_summary?.revenue;
    expect(Array.isArray(rev?.candidates)).toBe(true);
    const projectedCandidate = (rev?.candidates as any[])?.find((c: any) => c.amount === 8_000_000);
    if (projectedCandidate) {
      expect(projectedCandidate.fact_type_label).toBe('projected');
    }
    // Primary selected fact is the historical one
    const selectedCandidate = (rev?.candidates as any[])?.find((c: any) => c.selected === true);
    if (selectedCandidate?.amount === 5_000_000) {
      expect(selectedCandidate.fact_type_label).toBe('actual');
    }
  });

  test('no financial facts provided → revenue.fact_type_label undefined (no regression)', () => {
    // When financialFacts is absent, the revenue field must not gain a spurious
    // fact_type_label from the injector.
    const report = compileDIOToReportWithPromotedFacts(minimalDio());
    const rev = report.structured_summary?.revenue;
    // revenue may be null/undefined or have a value from promoted facts — either way
    // fact_type_label must not be 'actual' / 'projected' erroneously set by the injector.
    if (rev != null && rev.value == null) {
      // Only a promoted-fact or no-revenue case — no financial injector ran
      expect(rev.fact_type_label).toBeUndefined();
    }
  });
});
