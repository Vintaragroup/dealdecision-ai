/**
 * current-state-selection-fix7.test.ts
 *
 * Fix #7 regression tests — "projected or provisional facts must not populate
 * headline current_state fields when better alternatives exist."
 *
 * Two concrete regressions:
 *   [StackFactor]     A projected Year-12 burn fact leaks into current_state.burn_rate.
 *   [DealDecision]    A deck-low-conf pricing-derived $250/mo beats a workbook-derived
 *                     alternative for current_state.burn_rate.
 *
 * After the fix:
 *   - Projected facts → undefined in current_state; surfaced in burn_runway.alternative_burn_fact
 *     with selection_reason='projected_only'.
 *   - Deck-low-conf provisional → loses to derived workbook proxy (Pass 2 of
 *     selectCurrentStateFact). Deck fact becomes alternative_burn_fact.
 */

import {
  buildFinancialBreakdownV1,
} from '../financial-breakdown-v1.js';
import type { FinancialBreakdownV1 } from '../financial-breakdown-v1.js';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1.js';
import type { FinancialCoverageProfileV1 } from '../financial-coverage-profile.js';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let _seq = 0;
function fact(
  metric_key: string,
  value: number,
  overrides: Partial<FinancialFactV1> = {}
): FinancialFactV1 {
  const id = ++_seq;
  return {
    fact_id: `factv1:fix7:${metric_key}:${String(id).padStart(8, '0')}`,
    deal_id: 'deal-fix7',
    document_id: 'doc-001',
    source_kind: 'xlsx',
    metric_key,
    period_type: 'annual',
    period_label: 'FY2025',
    value,
    unit: 'currency',
    currency: 'USD',
    confidence: 'high',
    ...overrides,
  };
}

function makeCoverage(overrides?: Partial<FinancialCoverageProfileV1['coverage']>): FinancialCoverageProfileV1 {
  return {
    confidence: 'low',
    sources: [{ kind: 'deck' }],
    evidence: {},
    coverage: {
      historical_revenue_present: false,
      forecast_revenue_present: false,
      income_statement_present: false,
      burn_rate_present: true,
      runway_present: false,
      unit_economics_present: false,
      balance_sheet_present: false,
      cash_flow_present: false,
      ...overrides,
    },
  };
}

// ─── [StackFactor] Projected-only burn ───────────────────────────────────────
//
// StackFactor has a multi-year financial model. Its only burn facts are labeled
// "Year 1", "Year 12" etc. — all projected future periods.
// Before Fix #7: the best projected burn (Year 12) leaked into current_state.burn_rate.
// After Fix #7:  current_state.burn_rate = undefined; the projected fact surfaces
//               in burn_runway.alternative_burn_fact with selection_reason='projected_only'.

describe('[StackFactor regression] projected-only burn — must NOT appear in current_state', () => {
  const YEAR_5 = new Date().getFullYear() + 5;
  const YEAR_12 = new Date().getFullYear() + 12;

  function makeStackFactorFacts(): FinancialFactV1[] {
    return [
      // All burn facts are forward-looking projected periods
      fact('burn_rate', 150_000, { period_label: `Year 5 (FY${YEAR_5})`, temporal_scope: 'projected' }),
      fact('burn_rate', 950_000, { period_label: `Year 12 (FY${YEAR_12})`, temporal_scope: 'projected' }),
      // Some projected revenue too
      fact('revenue', 5_000_000, { period_label: `Year 12 (FY${YEAR_12})`, temporal_scope: 'projected' }),
    ];
  }

  test('current_state.burn_rate is undefined (projected fact not headlined)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate).toBeUndefined();
  });

  test('burn_runway.monthly_burn is undefined (no non-projected burn)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.monthly_burn).toBeUndefined();
  });

  test('projected burn surfaces in burn_runway.alternative_burn_fact with selection_reason=projected_only', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact).toBeDefined();
    expect(bd.burn_runway.alternative_burn_fact?.is_projected).toBe(true);
    expect(bd.burn_runway.alternative_burn_fact?.selection_reason).toBe('projected_only');
  });

  test('alternative_burn_fact.is_provisional = true (projected implies provisional)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact?.is_provisional).toBe(true);
  });

  test('has_current_state = false (no current-period revenue, burn, or cash)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.has_current_state).toBe(false);
  });
});

describe('[StackFactor regression] projected-only runway — must NOT appear in current_state', () => {
  const YEAR_3 = new Date().getFullYear() + 3;

  function makeStackFactorRunwayFacts(): FinancialFactV1[] {
    return [
      fact('runway_months', 36, { period_label: `FY${YEAR_3}`, temporal_scope: 'projected', unit: 'number' }),
    ];
  }

  test('current_state.runway_months is undefined (projected)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorRunwayFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.runway_months).toBeUndefined();
  });

  test('projected runway surfaces in burn_runway.runway_months with selection_reason=projected_only', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeStackFactorRunwayFacts(), financial_coverage_v1: makeCoverage() });
    // The projected runway is surfaced via the projected_only path (not as a current-state truth)
    expect(bd.burn_runway.runway_months?.selection_reason).toBe('projected_only');
    expect(bd.burn_runway.runway_months?.is_projected).toBe(true);
  });
});

// ─── [DealDecision] Provisional pricing-derived burn vs workbook proxy ────────
//
// DealDecision has a deck-sourced burn_rate of $250/mo — this is actually their
// product pricing tier, not a real burn rate. The system also produced a workbook-
// derived burn proxy at $400K/mo.
// Before Fix #7: deck $250 was primary (SRC_RANK for deck=1 > unknown=0).
// After Fix #7:  derived workbook proxy is primary (Pass 2 beats Pass 3 of
//               selectCurrentStateFact). Deck $250 becomes the alternative.

describe('[DealDecision regression] deck-provisional pricing burn vs workbook-derived proxy', () => {
  function makeDealDecisionFacts(): FinancialFactV1[] {
    return [
      // Deck pricing artifact mistaken for burn — provisional, unreliable
      fact('burn_rate', 250, {
        source_kind: 'deck',
        confidence: 'low',
        period_label: 'FY2024',
      }),
      // Workbook-derived operating burn proxy — derived but structured and substantive
      fact('burn_rate', 400_000, {
        source_kind: 'unknown',
        confidence: 'medium',
        is_derived: true,
        derivation_rule: 'burn_rate_from_total_expenses_run_rate',
        period_label: 'FY2024',
      }),
    ];
  }

  test('current_state.burn_rate uses the workbook-derived proxy (not the deck $250)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDealDecisionFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.is_derived).toBe(true);
    expect(bd.current_state.burn_rate?.value).toBe(400_000);
  });

  test('current_state.burn_rate is NOT the deck-provisional $250 value', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDealDecisionFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.value).not.toBe(250);
    expect(bd.current_state.burn_rate?.source_kind).not.toBe('deck');
  });

  test('burn_runway.monthly_burn is the workbook-derived proxy', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDealDecisionFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.monthly_burn?.is_derived).toBe(true);
    expect(bd.burn_runway.monthly_burn?.value).toBe(400_000);
  });

  test('burn_runway.alternative_burn_fact contains the deck $250 as alternative', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDealDecisionFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact).toBeDefined();
    expect(bd.burn_runway.alternative_burn_fact?.source_kind).toBe('deck');
    expect(bd.burn_runway.alternative_burn_fact?.value).toBe(250);
  });

  test('workbook proxy is provisional (is_derived) but not projected', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDealDecisionFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.is_provisional).toBe(true);
    expect(bd.current_state.burn_rate?.is_projected).toBeUndefined();
  });

  test('selection_reason on primary references workbook/proxy/alternative', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDealDecisionFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.monthly_burn?.selection_reason).toMatch(/workbook|proxy|alternative/i);
  });
});

// ─── Non-provisional xlsx burn — still wins first ────────────────────────────

describe('non-provisional xlsx fact wins Pass 1 (highest quality)', () => {
  function makeXlsxFacts(): FinancialFactV1[] {
    return [
      fact('burn_rate', 300_000, { source_kind: 'xlsx', confidence: 'high', period_label: 'FY2025' }),
      fact('burn_rate', 250, { source_kind: 'deck', confidence: 'low', period_label: 'FY2025' }),
    ];
  }

  test('xlsx high-conf wins over deck-low-conf', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeXlsxFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.source_kind).toBe('xlsx');
    expect(bd.current_state.burn_rate?.value).toBe(300_000);
  });

  test('current_state.burn_rate is not provisional (explicit xlsx)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeXlsxFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.is_provisional).toBeUndefined();
  });
});

// ─── Deck-low-conf only (no better alternative) — last resort still surfaces ─

describe('deck-low-conf only — when no better alternative exists, still surfaces', () => {
  function makeDeckOnlyFacts(): FinancialFactV1[] {
    return [
      fact('burn_rate', 200_000, { source_kind: 'deck', confidence: 'low', period_label: 'FY2024' }),
    ];
  }

  test('current_state.burn_rate = deck fact as last resort (no exclusion when solo)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDeckOnlyFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate).toBeDefined();
    expect(bd.current_state.burn_rate?.source_kind).toBe('deck');
    expect(bd.current_state.burn_rate?.is_provisional).toBe(true);
  });

  test('no alternative_burn_fact when deck is the only source', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeDeckOnlyFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact).toBeUndefined();
  });
});

// ─── Mix: current + projected — current wins, projected goes to alternative ──

describe('mix of current + projected burn — current wins, projected is alternative', () => {
  const FUTURE_YEAR = new Date().getFullYear() + 2;

  function makeMixedFacts(): FinancialFactV1[] {
    return [
      fact('burn_rate', 250_000, { source_kind: 'xlsx', period_label: 'FY2025', temporal_scope: 'historical' }),
      fact('burn_rate', 900_000, { source_kind: 'xlsx', period_label: `FY${FUTURE_YEAR}`, temporal_scope: 'projected' }),
    ];
  }

  test('current_state.burn_rate = current (historical) fact', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeMixedFacts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.temporal_scope).toBe('historical');
    expect(bd.current_state.burn_rate?.value).toBe(250_000);
    expect(bd.current_state.burn_rate?.is_projected).toBeUndefined();
  });

  test('burn_runway.alternative_burn_fact is projected temporal alternative (not projected_only)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeMixedFacts(), financial_coverage_v1: makeCoverage() });
    // The alternative slot may carry the projected temporal alternative; it must NOT carry
    // a 'projected_only' reason because we DO have a current-state primary.
    if (bd.burn_runway.alternative_burn_fact) {
      expect(bd.burn_runway.alternative_burn_fact.selection_reason).not.toBe('projected_only');
    }
    // The important guard: current_state must be the current fact only.
    expect(bd.current_state.burn_rate?.is_projected).toBeUndefined();
  });
});
