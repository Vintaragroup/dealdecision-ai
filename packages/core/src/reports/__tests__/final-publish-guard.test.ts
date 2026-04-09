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

  it('keeps "Wholesale/Retail" when no medtech product signals present', () => {
    const summary = {
      business_model: makeBusinessModelSummary('Wholesale/Retail', {
        sources: [{ kind: 'phase1.business_model_arbitration_v1' }],
      }),
    };
    const context = makeDeSpacContext({
      governed_ui_copy_v1: {
        product_solution: 'Software analytics platform for enterprise data teams',
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
