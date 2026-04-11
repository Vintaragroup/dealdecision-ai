/**
 * Final Publish Guard — unit tests
 *
 * Covers the output-phase null-enforcement rules for structured_summary fields.
 * Each test exercises applyFinalPublishGuard in isolation (pure function, no DB/LLM).
 */

import { applyFinalPublishGuard, type FinalPublishGuardContext } from '../final-publish-guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRaiseSummary(
  value: string | null,
  extra: {
    amount?: number;
    sources?: any[];
  } = {},
): any {
  return {
    value,
    value_json: extra.amount !== undefined ? { amount: { amount: extra.amount, currency: 'USD' } } : null,
    round_label: null,
    confidence: 0.9,
    sources: extra.sources ?? [],
  };
}

function makeBusinessModelSummary(
  value: string | null,
  extra: { sources?: any[] } = {},
): any {
  return {
    value,
    confidence: 0.8,
    sources: extra.sources ?? [],
  };
}

function makeRevenueSummary(value: string | null, sources: any[] = []): any {
  return {
    value: value ? { raw: value, formatted: value } : null,
    confidence: 0.8,
    sources,
  };
}

function makeDeSpacContext(
  overrides: {
    governed_ui_copy_v1?: any;
    deal_overview_v2?: any;
    claims?: any[];
  } = {},
): FinalPublishGuardContext {
  return {
    deal_type: 'de_spac',
    dio: {
      dio: {
        phase1: {
          business_archetype_v1: { value: 'de_spac' },
          governed_ui_copy_v1: overrides.governed_ui_copy_v1 ?? null,
          deal_overview_v2: overrides.deal_overview_v2 ?? null,
          claims: overrides.claims ?? [],
        },
      },
    },
  };
}

// ─── Raise guard: dollar-1 placeholder ───────────────────────────────────────

describe('applyFinalPublishGuard — raise: $1 placeholder', () => {
  it('nulls "$1 Series A Convertible Note"', () => {
    const summary = {
      raise: makeRaiseSummary('$1 Series A Convertible Note', { amount: 1.092, sources: [] }),
    };
    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(summary.raise.value).toBeNull();
    expect(result.fields_nulled).toContain('raise');

    const log = result.log.find((e) => e.field === 'raise');
    expect(log?.action).toBe('nulled');
    expect(log?.original_value).toBe('$1 Series A Convertible Note');
  });

  it('nulls "$1 Preferred Stock"', () => {
    const summary = { raise: makeRaiseSummary('$1 Preferred Stock') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('nulls "$1 Convertible Note"', () => {
    const summary = { raise: makeRaiseSummary('$1 Convertible Note') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('does NOT null "$10M Series A" (legitimate)', () => {
    const summary = { raise: makeRaiseSummary('$10M Series A', { amount: 10_000_000 }) };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBe('$10M Series A');
  });

  it('does NOT null "$120M gross proceeds" (legitimate)', () => {
    const summary = { raise: makeRaiseSummary('$120M gross proceeds', { amount: 120_000_000 }) };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBe('$120M gross proceeds');
  });
});

// ─── Raise guard: per-share / liquidation preference patterns ─────────────────

describe('applyFinalPublishGuard — raise: per-share and liquidation preference', () => {
  it('nulls value containing "liquidation preference"', () => {
    const summary = {
      raise: makeRaiseSummary('Liquidation preference of $1.092 per share'),
    };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('nulls value matching "per share"', () => {
    const summary = { raise: makeRaiseSummary('$1.092 per share') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('nulls value matching "per-share" (hyphenated)', () => {
    const summary = { raise: makeRaiseSummary('$2.50 per-share original issue price') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('does NOT null "$25M Series B" (no per-share / liq pref)', () => {
    const summary = { raise: makeRaiseSummary('$25M Series B') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBe('$25M Series B');
  });
});

// ─── Raise guard: de-SPAC tiny amount ────────────────────────────────────────

describe('applyFinalPublishGuard — raise: de-SPAC tiny amount', () => {
  it('nulls de-SPAC raise of $1 (< $100K) sourced from phase1-only (no doc citation)', () => {
    const summary = {
      raise: makeRaiseSummary('$1', {
        amount: 1,
        sources: [{ kind: 'phase1.deal_overview_v2' }], // phase1 only
      }),
    };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('does NOT null de-SPAC raise of $50M even if sourced from phase1', () => {
    const summary = {
      raise: makeRaiseSummary('$50M', {
        amount: 50_000_000,
        sources: [{ kind: 'phase1.deal_overview_v2' }],
      }),
    };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBe('$50M');
  });

  it('preserves nulled_by and null_rule on nulled raise', () => {
    const summary = {
      raise: makeRaiseSummary('$1 Series A Convertible Note', { amount: 1 }),
    };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.nulled_by).toBe('final_publish_guard');
    expect(summary.raise.null_rule).toBeTruthy();
  });
});

// ─── Business model guard: generic wholesale + medtech mismatch ───────────────

describe('applyFinalPublishGuard — business_model: wholesale/medtech mismatch', () => {
  it('replaces "Wholesale/Retail" with governed_ui_copy when medtech product signals present', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }], // no pitch_deck
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: {
        business_model: 'B2B model selling medical devices directly to healthcare providers and clinics',
        product_solution: 'Intragastric balloon for bariatric procedure — surgical medical device',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.original_value).toBe('Wholesale/Retail');
    expect(summary.business_model.value).toContain('medical devices');
    expect(result.fields_replaced).toContain('business_model');
  });

  it('nulls "Wholesale/Retail" when medtech context present but no governed_ui_copy', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      deal_overview_v2: {
        product_solution: 'Medical device for clinical procedures in hospital settings',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('nulled');
    expect(summary.business_model.value).toBeNull();
    expect(result.fields_nulled).toContain('business_model');
  });

  it('keeps "Wholesale/Retail" when no medtech and no tech product signals present', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: {
        product_solution: 'Physical goods distribution for consumer apparel through brick-and-mortar retail stores',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('kept');
    expect(summary.business_model.value).toBe('Wholesale/Retail');
  });

  it('keeps value when source includes a pitch_deck document', () => {
    const documents = [{ document_id: 'doc-deck', kind: 'pitch_deck' }];
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale distribution channel', {
        sources: [{ kind: 'promoted_fact', document_id: 'doc-deck' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: {
        product_solution: 'Medical device for clinical use',
      },
    });

    const result = applyFinalPublishGuard(summary, context, documents);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('kept');
    expect(summary.business_model.value).toBe('Wholesale distribution channel');
  });

  it('replaces pitch-deck Wholesale/Retail under tech/platform mismatch without explicit wholesale context', () => {
    const documents = [{ document_id: 'doc-deck', kind: 'pitch_deck' }];
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'promoted_fact', document_id: 'doc-deck' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: {
        business_model: null,
        product_solution: 'Consumer fintech platform marketplace with platform fees and automated underwriting',
      },
      deal_overview_v2: {
        product_solution: 'Two-sided financial services platform for consumers and lenders',
      },
    });

    const result = applyFinalPublishGuard(summary, context, documents);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(summary.business_model.value).toBe('Marketplace / platform');
    expect(result.fields_replaced).toContain('business_model');
  });

  it('does not modify strong B2B2C value', () => {
    const summary = {
      business_model: makeBusinessModelSummary('B2B2C — sold through HCP channel to patients', {
        sources: [{ kind: 'promoted_fact', document_id: 'doc-deck' }],
      }),
    };

    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('kept');
    expect(summary.business_model.value).toContain('B2B2C');
  });
});

// ─── Revenue guard: pro_forma defense-in-depth ───────────────────────────────

describe('applyFinalPublishGuard — revenue: pro_forma defense', () => {
  it('nulls revenue if source marks doc_family as financial_pro_forma', () => {
    const summary = {
      revenue: makeRevenueSummary('$1.5M', [
        { kind: 'promoted_fact', doc_family: 'financial_pro_forma', document_id: 'doc-proforma' },
      ]),
    };

    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(summary.revenue.value).toBeNull();
    expect(result.fields_nulled).toContain('revenue');
  });

  it('nulls revenue if source kind contains "pro_forma"', () => {
    const summary = {
      revenue: makeRevenueSummary('$1.5M', [
        { kind: 'financial_pro_forma.extraction', document_id: 'doc-proforma' },
      ]),
    };

    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(summary.revenue.value).toBeNull();
    expect(result.fields_nulled).toContain('revenue');
  });

  it('keeps revenue from operating_financials source', () => {
    const summary = {
      revenue: makeRevenueSummary('$5M', [
        { kind: 'promoted_fact', doc_family: 'operating_financials', document_id: 'doc-fin' },
      ]),
    };

    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    const log = result.log.find((e) => e.field === 'revenue');
    expect(log?.action).toBe('kept');
    expect(summary.revenue.value).not.toBeNull();
  });
});

// ─── Guard log completeness ───────────────────────────────────────────────────

describe('applyFinalPublishGuard — log completeness', () => {
  it('always logs an entry for raise even when kept', () => {
    const summary = { raise: makeRaiseSummary('$50M Series B', { amount: 50_000_000 }) };
    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    const raiseLog = result.log.find((e) => e.field === 'raise');
    expect(raiseLog).toBeDefined();
    expect(raiseLog?.action).toBe('kept');
  });

  it('fields_nulled and fields_replaced are empty when everything is kept', () => {
    const summary = {
      raise: makeRaiseSummary('$50M', { amount: 50_000_000 }),
    };
    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(result.fields_nulled).toHaveLength(0);
    expect(result.fields_replaced).toHaveLength(0);
  });

  it('handles missing raise field gracefully', () => {
    const summary = {};
    expect(() => applyFinalPublishGuard(summary, makeDeSpacContext())).not.toThrow();
  });

  it('handles null context.dio gracefully', () => {
    const summary = { raise: makeRaiseSummary('$50M') };
    expect(() =>
      applyFinalPublishGuard(summary, { deal_type: 'de_spac', dio: null }),
    ).not.toThrow();
  });
});

// ─── P1: Business model guard: wholesale/tech-platform mismatch ───────────────

describe('applyFinalPublishGuard — business_model: wholesale/tech-platform mismatch (P1)', () => {
  function makeTechContext(productSolution: string, govBM?: string): FinalPublishGuardContext {
    return makeDeSpacContext({
      governed_ui_copy_v1: {
        product_solution: productSolution,
        ...(govBM ? { business_model: govBM } : {}),
      },
    });
  }

  it('replaces "Wholesale/Retail" with marketplace/platform fallback when SaaS signals present and no governed_ui_copy', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeTechContext('SaaS compliance platform for financial services firms');

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toBe('Marketplace / platform');
    expect(result.fields_replaced).toContain('business_model');
  });

  it('replaces "Wholesale/Retail" with governed_ui_copy when software/AI signals present', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeTechContext(
      'AI-powered workflow automation platform for enterprise teams',
      'B2B SaaS subscription model licensing to mid-market and enterprise customers',
    );

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toContain('SaaS subscription');
    expect(result.fields_replaced).toContain('business_model');
  });

  it('keeps "Wholesale/Retail" for truly physical goods distribution (no tech/medtech)', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeTechContext('Consumer packaged goods distributed via traditional grocery and beverage retail');

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('kept');
    expect(summary.business_model.value).toBe('Wholesale/Retail');
  });

  it('uses tech mismatch rule for API/marketplace context', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeTechContext('API marketplace connecting data providers with analytics buyers');

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
  });
});

// ─── P5: BM guard: slide-title fallback (StackFactor pattern) ────────────────

describe('applyFinalPublishGuard — business_model: BM source slide-title fallback (P5)', () => {
  it('fires tech mismatch when productSolution is null but BM source slide_title contains platform context', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [
          {
            kind: 'promoted_fact',
            segment: 'distribution',
            slide_title: 'THE ASK $2.5M Pre-Seed Round — USE OF FUNDS 50% Engineering MVP development, core platform, and Al capabilities',
          },
        ],
      }),
    };
    // No product_solution in DIO — forces slide_title fallback
    const context = makeDeSpacContext({ governed_ui_copy_v1: null, deal_overview_v2: null });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toBe('Marketplace / platform');
    expect(result.fields_replaced).toContain('business_model');
  });

  it('does not preserve BM when only source is distribution-segment (even if source doc filename contains "deck")', () => {
    // This covers the StackFactor pattern: source_document_id points to "Investor-Deck.pdf"
    // but the extraction came from a distribution/use-of-funds slide — not an explicit BM statement.
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [
          {
            kind: 'promoted_fact',
            segment_key: 'distribution',
            source_document_id: 'doc-abc-123',
          },
        ],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: null,
      deal_overview_v2: {
        problem_context: 'SaaS compliance platform for enterprise DevSecOps and GRC workflows',
      },
    });
    // Provide documents with a "deck" filename — guard should NOT be blocked
    const documents = [{ document_id: 'doc-abc-123', kind: 'other', filename: 'Investor-Deck-Q1.pdf' }];

    const result = applyFinalPublishGuard(summary, context, documents as any);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toBe('Marketplace / platform');
  });

  it('fires tech mismatch when deal_overview_v2.problem_context has SaaS signals', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: null,
      deal_overview_v2: {
        product_solution: null,
        problem_context: 'DevSecOps teams lack automated compliance monitoring software for GRC workflows',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toBe('Marketplace / platform');
  });

  it('fires tech mismatch when deal_overview_v2.market_icp has digital platform signals', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: null,
      deal_overview_v2: {
        product_solution: null,
        market_icp: 'Mid-market SaaS companies and cloud-native enterprises',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toBe('Marketplace / platform');
  });

  it('fires tech mismatch from phase1 claim text even when product_solution is missing', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'promoted_fact', document_id: 'doc-deck' }],
      }),
    };
    const documents = [{ document_id: 'doc-deck', kind: 'pitch_deck' }];
    const context = makeDeSpacContext({
      governed_ui_copy_v1: { business_model: null, product_solution: null },
      deal_overview_v2: null,
      claims: [
        {
          text: 'Dropables developed a unique platform for artists and labels with secondary marketplace royalties.',
          evidence: [
            {
              snippet: 'NFT platform allows artists and labels to monetize through each transaction on the marketplace.',
            },
          ],
        },
      ],
    });

    const result = applyFinalPublishGuard(summary, context, documents as any);
    const log = result.log.find((e) => e.field === 'business_model');

    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('business_model.generic_wholesale_tech_mismatch');
    expect(summary.business_model.value).toBe('Marketplace / platform');
  });
});

// ─── P5: BM guard: CRE context mismatch (Albuquerque pattern) ────────────────

describe('applyFinalPublishGuard — business_model: CRE context mismatch (P5)', () => {
  it('nulls wholesale term when deal_overview_v2.summary has real estate context', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Omnichannel (DTC + Wholesale/Retail)', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: null,
      deal_overview_v2: {
        product_solution: null,
        summary: 'Build-to-suit single-tenant healthcare facility. 20-year net lease with investment-grade tenant.',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('nulled');
    expect(log?.rule).toBe('business_model.real_estate_context_mismatch');
    expect(summary.business_model.value).toBeNull();
    expect(result.fields_nulled).toContain('business_model');
  });

  it('nulls wholesale term when governed_ui_copy.company_overview references real estate', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: {
        company_overview: 'Albuquerque CRE Partners — commercial real estate investment vehicle targeting NNN leases.',
      },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('nulled');
    expect(log?.rule).toBe('business_model.real_estate_context_mismatch');
    expect(summary.business_model.value).toBeNull();
  });

  it('keeps wholesale term when no real estate context present', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    // No CRE signals anywhere
    const context = makeDeSpacContext({
      governed_ui_copy_v1: { product_solution: 'Consumer packaged goods sold via grocery retailers' },
    });

    const result = applyFinalPublishGuard(summary, context);

    const log = result.log.find((e) => e.field === 'business_model');
    expect(log?.action).toBe('kept');
    expect(log?.rule).toBe('business_model.no_product_context');
    expect(summary.business_model.value).toBe('Wholesale/Retail');
  });

  it('nulled CRE BM sets nulled_by to final_publish_guard', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      deal_overview_v2: {
        summary: 'Commercial real estate cap rate investment targeting institutional tenants',
      },
    });

    applyFinalPublishGuard(summary, context);

    expect(summary.business_model.nulled_by).toBe('final_publish_guard');
    expect(summary.business_model.value).toBeNull();
  });
});

// ─── P2: Raise guard: prose contamination ────────────────────────────────────

describe('applyFinalPublishGuard — raise: prose contamination (P2)', () => {
  it('replaces long narrative raise value with formatted amount when value_json.amount available', () => {
    const longProse =
      'Probility is seeking $4M in a Growth round to expand the platform into new markets and hire additional staff';
    const summary = {
      raise: {
        value: longProse,
        value_json: { amount: { amount: 4_000_000, currency: 'USD' } },
        round_label: 'Growth',
        confidence: 0.7,
        sources: [],
      },
    };

    const result = applyFinalPublishGuard(summary, makeDeSpacContext());

    const log = result.log.find((e) => e.field === 'raise');
    expect(log?.action).toBe('replaced');
    expect(log?.rule).toBe('raise.prose_contaminated');
    expect(log?.original_value).toBe(longProse);
    expect(summary.raise.value).toBe('$4M (Growth)');
    expect(result.fields_replaced).toContain('raise');
  });

  it('formats without round label when round_label is absent', () => {
    const longProse =
      'The company is raising up to seven million dollars to fund product development and expand its go-to-market efforts';
    const summary = {
      raise: {
        value: longProse,
        value_json: { amount: { amount: 7_000_000, currency: 'USD' } },
        round_label: null,
        confidence: 0.6,
        sources: [],
      },
    };

    applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(summary.raise.value).toBe('$7M');
  });

  it('does NOT replace short formatted raise value like "$4M Growth"', () => {
    const summary = {
      raise: makeRaiseSummary('$4M Growth', { amount: 4_000_000 }),
    };

    applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(summary.raise.value).toBe('$4M Growth');
  });

  it('does NOT replace when value_json.amount is below $100K', () => {
    const longProse = 'This company is seeking a small bridge round to cover operating expenses for the next quarter';
    const summary = {
      raise: {
        value: longProse,
        value_json: { amount: { amount: 50_000, currency: 'USD' } },
        round_label: null,
        confidence: 0.5,
        // Give a real doc source so de-SPAC tiny-amount rule does not also fire
        sources: [{ kind: 'promoted_fact', document_id: 'doc-financials' }],
      },
    };

    applyFinalPublishGuard(summary, makeDeSpacContext());

    // Below $100K threshold — prose contamination rule should not replace
    expect(summary.raise.value).toBe(longProse);
  });

  it('does NOT replace when no value_json.amount is present', () => {
    const longProse =
      'Seeking investment to expand the business into new geographic markets over the next two years';
    const summary = {
      raise: {
        value: longProse,
        value_json: null,
        round_label: null,
        confidence: 0.5,
        sources: [],
      },
    };

    applyFinalPublishGuard(summary, makeDeSpacContext());

    // No structured amount → cannot replace, keep original
    expect(summary.raise.value).toBe(longProse);
  });

  it('replaced raise preserves replaced_by and replace_rule provenance', () => {
    const longProse =
      'The startup is raising a $2.5M pre-seed round to build out its core infrastructure and expand to three new cities';
    const summary = {
      raise: {
        value: longProse,
        value_json: { amount: { amount: 2_500_000, currency: 'USD' } },
        round_label: 'Pre-Seed',
        confidence: 0.65,
        sources: [],
      },
    };

    applyFinalPublishGuard(summary, makeDeSpacContext());

    expect(summary.raise.replaced_by).toBe('final_publish_guard');
    expect(summary.raise.replace_rule).toBe('raise.prose_contaminated');
    expect(summary.raise.value).toBe('$2.5M (Pre-Seed)');
  });
});

// ─── P4: Raise guard: unknown sentinel ───────────────────────────────────────

describe('applyFinalPublishGuard — raise: unknown sentinel (P4)', () => {
  it('nulls "Unknown" sentinel raise value', () => {
    const summary = { raise: makeRaiseSummary('Unknown') };
    const result = applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
    const log = result.log.find((e: any) => e.field === 'raise');
    expect(log?.rule).toBe('raise.unknown_sentinel');
    expect(result.fields_nulled).toContain('raise');
  });

  it('nulls "UNKNOWN" (case-insensitive)', () => {
    const summary = { raise: makeRaiseSummary('UNKNOWN') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('nulls "unknown" (lowercase)', () => {
    const summary = { raise: makeRaiseSummary('unknown') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBeNull();
  });

  it('does NOT null a real raise value that contains the word unknown', () => {
    // Edge case — value starts with a dollar sign, not just the bare word
    const summary = { raise: makeRaiseSummary('$5M (Pre-Seed)') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.value).toBe('$5M (Pre-Seed)');
  });

  it('nulled raise sets nulled_by to final_publish_guard', () => {
    const summary = { raise: makeRaiseSummary('Unknown') };
    applyFinalPublishGuard(summary, makeDeSpacContext());
    expect(summary.raise.nulled_by).toBe('final_publish_guard');
    expect(summary.raise.null_rule).toBe('raise.unknown_sentinel');
  });
});
