import {
  buildFinancialBreakdownV1,
  buildUnderwritingReadinessV1,
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
    fact_id: `factv1:deal1:${metric_key}:annual:current:${String(id).padStart(8, '0')}`,
    deal_id: 'deal1',
    document_id: 'doc_xlsx',
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

function deckFact(metric_key: string, value: number, overrides: Partial<FinancialFactV1> = {}): FinancialFactV1 {
  return fact(metric_key, value, { source_kind: 'deck', document_id: 'doc_deck', currency: 'USD', ...overrides });
}

function projFact(metric_key: string, value: number, year: number): FinancialFactV1 {
  return fact(metric_key, value, {
    period_label: `FY${year}`,
    period_type: 'annual',
    source_kind: 'xlsx',
  });
}

function makeCoverage(overrides: Partial<FinancialCoverageProfileV1> = {}): FinancialCoverageProfileV1 {
  return {
    confidence: 'low',
    sources: [{ kind: 'deck' }],
    coverage: {
      historical_revenue_present: false,
      forecast_revenue_present: false,
      income_statement_present: false,
      burn_rate_present: false,
      runway_present: false,
      unit_economics_present: false,
      balance_sheet_present: false,
      cash_flow_present: false,
    },
    evidence: {},
    ...overrides,
  };
}

function xlsxCoverage(coverageOverrides: Partial<FinancialCoverageProfileV1['coverage']> = {}): FinancialCoverageProfileV1 {
  return makeCoverage({
    confidence: 'medium',
    sources: [{ kind: 'xlsx', document_id: 'doc_xlsx' }],
    coverage: {
      historical_revenue_present: true,
      forecast_revenue_present: false,
      income_statement_present: false,
      burn_rate_present: false,
      runway_present: false,
      unit_economics_present: false,
      balance_sheet_present: false,
      cash_flow_present: false,
      ...coverageOverrides,
    },
  });
}

// ─── Tests: buildFinancialBreakdownV1 ─────────────────────────────────────────

describe('buildFinancialBreakdownV1', () => {

  // ── Case A: deck-only ────────────────────────────────────────────────────
  describe('deck-only deal (no financial facts)', () => {
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [],
        financial_coverage_v1: makeCoverage(),
      });
    });

    test('has_xlsx is false', () => {
      expect(bd.has_xlsx).toBe(false);
    });

    test('has_current_state is false', () => {
      expect(bd.has_current_state).toBe(false);
    });

    test('current_state.data_quality is missing', () => {
      expect(bd.current_state.data_quality).toBe('missing');
    });

    test('risks includes deck_only flag', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).toContain('deck_only');
    });

    test('risks deck_only is high severity', () => {
      const r = bd.risks.find(r => r.code === 'deck_only');
      expect(r?.severity).toBe('high');
    });

    test('risks also includes missing_burn_runway', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).toContain('missing_burn_runway');
    });

    test('has_cap_table is false', () => {
      expect(bd.has_cap_table).toBe(false);
    });

    test('narrative mentions pitch deck only', () => {
      expect(bd.narrative.toLowerCase()).toMatch(/pitch deck/);
    });

    test('projections.periods is empty', () => {
      expect(bd.projections.periods).toHaveLength(0);
    });

    test('expense_structure.headcount_by_function is empty', () => {
      expect(bd.expense_structure.headcount_by_function).toHaveLength(0);
    });
  });

  // ── Case B: deck + xlsx with current revenue ─────────────────────────────
  describe('deck + xlsx with current revenue', () => {
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [
          fact('revenue', 2_739_000),
          fact('ytd_revenue_recognized', 6_376_000),
          fact('ytd_cash_received', 7_120_000),
          fact('cash_received', 3_093_000),
          fact('direct_booked_revenue', 2_211_524),
          fact('total_headcount', 19, { unit: 'number', currency: undefined }),
          fact('r_d_headcount', 9.5, { unit: 'number', currency: undefined }),
          fact('sales_headcount', 3, { unit: 'number', currency: undefined }),
          fact('g_a_headcount', 2, { unit: 'number', currency: undefined }),
          fact('marketing_headcount', 1.5, { unit: 'number', currency: undefined }),
          fact('support_headcount', 3, { unit: 'number', currency: undefined }),
        ],
        financial_coverage_v1: xlsxCoverage(),
      });
    });

    test('has_xlsx is true', () => {
      expect(bd.has_xlsx).toBe(true);
    });

    test('current_state.revenue is populated', () => {
      expect(bd.current_state.revenue).toBeDefined();
      expect(bd.current_state.revenue?.value).toBe(2_739_000);
    });

    test('current_state.revenue.source_kind is xlsx', () => {
      expect(bd.current_state.revenue?.source_kind).toBe('xlsx');
    });

    test('revenue_breakdown.total_revenue is set', () => {
      expect(bd.revenue_breakdown.total_revenue?.value).toBe(2_739_000);
    });

    test('revenue_breakdown.bookings is set from cash_received', () => {
      expect(bd.revenue_breakdown.bookings?.value).toBe(3_093_000);
    });

    test('revenue_breakdown.ytd_recognized is set', () => {
      expect(bd.revenue_breakdown.ytd_recognized?.value).toBe(6_376_000);
    });

    test('revenue_breakdown.ytd_cash is set', () => {
      expect(bd.revenue_breakdown.ytd_cash?.value).toBe(7_120_000);
    });

    test('revenue_breakdown.direct_revenue is set', () => {
      expect(bd.revenue_breakdown.direct_revenue?.value).toBe(2_211_524);
    });

    test('expense_structure.total_headcount is 19', () => {
      expect(bd.expense_structure.total_headcount?.value).toBe(19);
    });

    test('expense_structure.headcount_by_function includes R&D', () => {
      const fnNames = bd.expense_structure.headcount_by_function.map(h => h.display_name);
      expect(fnNames).toContain('R&D / Engineering');
    });

    test('expense_structure.headcount_by_function R&D count is 9.5', () => {
      const rd = bd.expense_structure.headcount_by_function.find(h => h.display_name === 'R&D / Engineering');
      expect(rd?.count).toBe(9.5);
    });

    test('expense_structure.headcount_by_function includes Sales, Marketing, G&A, Support', () => {
      const fnNames = bd.expense_structure.headcount_by_function.map(h => h.display_name);
      expect(fnNames).toContain('Sales');
      expect(fnNames).toContain('Marketing');
      expect(fnNames).toContain('G&A');
      expect(fnNames).toContain('Support / CS');
    });

    test('expense_structure.summary mentions total headcount', () => {
      expect(bd.expense_structure.summary).toMatch(/19/);
    });

    test('burn_runway.confidence is not_available when no burn/runway facts', () => {
      expect(bd.burn_runway.confidence).toBe('not_available');
    });

    test('narrative includes xlsx reference', () => {
      expect(bd.narrative.toLowerCase()).toMatch(/spreadsheet|financial model/);
    });

    test('has_current_state is true', () => {
      expect(bd.has_current_state).toBe(true);
    });

    test('risks does NOT include deck_only', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).not.toContain('deck_only');
    });

    test('risks includes missing_burn_runway', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).toContain('missing_burn_runway');
    });

    test('revenue_breakdown.summary mentions multiple levels', () => {
      expect(bd.revenue_breakdown.summary.toLowerCase()).toMatch(/revenue|recognized|ytd/);
    });
  });

  // ── Case B+: deck + xlsx + burn/runway ───────────────────────────────────
  describe('deck + xlsx with burn and runway', () => {
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [
          fact('revenue', 2_000_000),
          fact('burn_rate', 150_000),
          fact('runway_months', 18, { unit: 'number', currency: undefined }),
        ],
        financial_coverage_v1: xlsxCoverage({
          burn_rate_present: true,
          runway_present: true,
        }),
      });
    });

    test('burn_runway.monthly_burn is set', () => {
      expect(bd.burn_runway.monthly_burn?.value).toBe(150_000);
    });

    test('burn_runway.runway_months is set', () => {
      expect(bd.burn_runway.runway_months?.value).toBe(18);
    });

    test('burn_runway.confidence is high when both burn and runway present', () => {
      expect(bd.burn_runway.confidence).toBe('high');
    });

    test('burn_runway.summary mentions both burn and runway', () => {
      expect(bd.burn_runway.summary).toMatch(/burn/i);
      expect(bd.burn_runway.summary).toMatch(/runway|months/i);
    });

    test('current_state.data_quality is complete', () => {
      expect(bd.current_state.data_quality).toBe('complete');
    });

    test('risks does NOT include missing_burn_runway', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).not.toContain('missing_burn_runway');
    });
  });

  // ── Case C: deck + xlsx + cap table ──────────────────────────────────────
  describe('deck + xlsx + cap table document', () => {
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [fact('revenue', 1_500_000)],
        financial_coverage_v1: xlsxCoverage(),
        documents: [
          { document_id: 'doc_captable', filename: 'SF CapTable 25FEB2026.xlsx', kind: 'excel' },
        ],
      });
    });

    test('has_cap_table is true', () => {
      expect(bd.has_cap_table).toBe(true);
    });

    test('cap_table_summary mentions cap table document', () => {
      expect(bd.cap_table_summary.toLowerCase()).toMatch(/cap table|document/);
    });

    test('risks does NOT include no_cap_table (has cap table doc)', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).not.toContain('no_cap_table');
    });
  });

  // ── Case D: projection-only model ────────────────────────────────────────
  describe('projection-only model (no current actuals)', () => {
    const NEXT_YEAR = new Date().getFullYear() + 1;
    const YEAR_AFTER = new Date().getFullYear() + 2;
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [
          projFact('revenue', 3_000_000, NEXT_YEAR),
          projFact('revenue', 6_000_000, YEAR_AFTER),
          projFact('ebitda', -500_000, NEXT_YEAR),
          projFact('ebitda', 1_200_000, YEAR_AFTER),
        ],
        financial_coverage_v1: xlsxCoverage({
          historical_revenue_present: false,
          forecast_revenue_present: true,
        }),
      });
    });

    test('has_projections is true', () => {
      expect(bd.has_projections).toBe(true);
    });

    test('has_current_state is false', () => {
      expect(bd.has_current_state).toBe(false);
    });

    test('projections.periods has 2 entries', () => {
      expect(bd.projections.periods).toHaveLength(2);
    });

    test('projections.periods are marked is_projected', () => {
      expect(bd.projections.periods.every(p => p.is_projected)).toBe(true);
    });

    test('projections shows revenue for each period', () => {
      const revenues = bd.projections.periods.map(p => p.revenue);
      expect(revenues).toContain(3_000_000);
      expect(revenues).toContain(6_000_000);
    });

    test('path_to_profitability_label mentions the EBITDA-positive period', () => {
      expect(bd.projections.path_to_profitability_label).toMatch(new RegExp(String(YEAR_AFTER)));
    });

    test('risks includes projection_only risk', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).toContain('projection_only');
    });

    test('projection_only risk is high severity', () => {
      const r = bd.risks.find(r => r.code === 'projection_only');
      expect(r?.severity).toBe('high');
    });

    test('current_state.revenue is undefined', () => {
      expect(bd.current_state.revenue).toBeUndefined();
    });
  });

  // ── Case E: missing burn/runway ───────────────────────────────────────────
  describe('revenue present but no burn/runway', () => {
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [fact('revenue', 5_000_000)],
        financial_coverage_v1: xlsxCoverage({
          burn_rate_present: false,
          runway_present: false,
        }),
      });
    });

    test('risks includes missing_burn_runway', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).toContain('missing_burn_runway');
    });

    test('burn_runway.confidence is not_available', () => {
      expect(bd.burn_runway.confidence).toBe('not_available');
    });

    test('burn_runway.summary explains unavailability', () => {
      expect(bd.burn_runway.summary.toLowerCase()).toMatch(/not available|unavailable/);
    });
  });

  // ── Case F: conflicting revenue (deck=$0 vs xlsx=$2.7M) ──────────────────
  describe('conflicting revenue signals (deck=0 vs xlsx=2.7M)', () => {
    let bd: FinancialBreakdownV1;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [fact('revenue', 2_739_000)],
        financial_coverage_v1: xlsxCoverage(),
        structured_summary: {
          revenue: {
            candidates: [
              // deck candidate that did NOT win selection
              {
                selected: false,
                amount: 0,
                currency: 'USD',
                sources: [{ kind: 'financial_health.metrics' }],
              },
            ],
          },
        },
      });
    });

    test('risks includes conflicting_revenue', () => {
      const codes = bd.risks.map(r => r.code);
      expect(codes).toContain('conflicting_revenue');
    });

    test('conflicting_revenue risk is medium severity', () => {
      const r = bd.risks.find(r => r.code === 'conflicting_revenue');
      expect(r?.severity).toBe('medium');
    });

    test('conflicting_revenue message mentions both figures', () => {
      const r = bd.risks.find(r => r.code === 'conflicting_revenue');
      expect(r?.message).toMatch(/\$0|\$2\.7M|financial model/);
    });
  });

  // ── Case G: ARR + projected CAGR assumption inference ────────────────────
  describe('projection model with multiple periods — CAGR inference', () => {
    let bd: FinancialBreakdownV1;
    const NEXT_YEAR = new Date().getFullYear() + 1;
    const YEAR3 = new Date().getFullYear() + 3;
    beforeEach(() => {
      bd = buildFinancialBreakdownV1({
        financial_facts: [
          fact('revenue', 2_000_000),
          fact('arr', 2_400_000),
          fact('mrr', 200_000),
          projFact('revenue', 4_000_000, NEXT_YEAR),
          projFact('revenue', 8_000_000, YEAR3),
        ],
        financial_coverage_v1: xlsxCoverage({ forecast_revenue_present: true }),
      });
    });

    test('assumptions_summary mentions implied CAGR', () => {
      expect(bd.assumptions_summary.toLowerCase()).toMatch(/cagr|growth/);
    });

    test('revenue_breakdown.arr is set', () => {
      expect(bd.revenue_breakdown.arr?.value).toBe(2_400_000);
    });

    test('revenue_breakdown.mrr is set', () => {
      expect(bd.revenue_breakdown.mrr?.value).toBe(200_000);
    });
  });

  // ── Fail-open: invalid input ─────────────────────────────────────────────
  describe('fail-open on invalid / null facts', () => {
    test('null financial_facts returns safe breakdown without throwing', () => {
      expect(() => buildFinancialBreakdownV1({
        financial_facts: null as any,
        financial_coverage_v1: makeCoverage(),
      })).not.toThrow();
    });

    test('undefined coverage returns safe breakdown without throwing', () => {
      expect(() => buildFinancialBreakdownV1({
        financial_facts: [],
        financial_coverage_v1: undefined as any,
      })).not.toThrow();
    });
  });
});

// ─── Tests: buildUnderwritingReadinessV1 ─────────────────────────────────────

describe('buildUnderwritingReadinessV1', () => {
  const deckOnlyCoverage = makeCoverage();
  const richCoverage = xlsxCoverage({
    historical_revenue_present: true,
    forecast_revenue_present: true,
    income_statement_present: true,
    burn_rate_present: true,
    runway_present: true,
  });

  test('deck-only → status=insufficient, gaps includes deck_only', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [],
      financial_coverage_v1: deckOnlyCoverage,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: deckOnlyCoverage,
    });
    expect(ur.status).toBe('insufficient');
    expect(ur.gaps).toContain('deck_only');
  });

  test('deck-only → score < 40', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [],
      financial_coverage_v1: deckOnlyCoverage,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: deckOnlyCoverage,
    });
    expect(ur.score).toBeLessThan(40);
  });

  test('full xlsx with revenue + income stmt + burn + cap table → sufficient', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [
        fact('revenue', 2_000_000),
        fact('ebitda', -200_000),
        fact('burn_rate', 150_000),
        fact('runway_months', 18, { unit: 'number', currency: undefined }),
      ],
      financial_coverage_v1: richCoverage,
      documents: [{ document_id: 'cap1', filename: 'CapTable.xlsx' }],
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
    });
    expect(ur.status).toBe('sufficient');
    expect(ur.score).toBeGreaterThanOrEqual(75);
  });

  test('xlsx with revenue but no cap table, no income stmt, no burn → partially_sufficient', () => {
    const partialCov = xlsxCoverage({
      historical_revenue_present: true,
      forecast_revenue_present: true,
    });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [
        fact('revenue', 2_000_000),
        projFact('revenue', 4_000_000, new Date().getFullYear() + 1),
      ],
      financial_coverage_v1: partialCov,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: partialCov,
    });
    expect(ur.status).toBe('partially_sufficient');
    expect(ur.score).toBeGreaterThanOrEqual(40);
    expect(ur.score).toBeLessThan(75);
  });

  test('projection-only model → gaps includes projection_only', () => {
    const projOnly = xlsxCoverage({
      historical_revenue_present: false,
      forecast_revenue_present: true,
    });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [projFact('revenue', 5_000_000, new Date().getFullYear() + 1)],
      financial_coverage_v1: projOnly,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: projOnly,
    });
    expect(ur.gaps).toContain('projection_only');
  });

  test('missing income statement → gaps includes no_income_statement', () => {
    const cov = xlsxCoverage({ income_statement_present: false });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 1_000_000)],
      financial_coverage_v1: cov,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: cov,
    });
    expect(ur.gaps).toContain('no_income_statement');
    expect(ur.missing.some(m => /income statement|P&L/i.test(m))).toBe(true);
  });

  test('no cap table → gaps includes no_cap_table', () => {
    const cov = xlsxCoverage();
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 1_000_000)],
      financial_coverage_v1: cov,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: cov,
    });
    expect(ur.gaps).toContain('no_cap_table');
  });

  test('narrative is a non-empty string reflecting status', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [],
      financial_coverage_v1: deckOnlyCoverage,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: deckOnlyCoverage,
    });
    expect(typeof ur.narrative).toBe('string');
    expect(ur.narrative.length).toBeGreaterThan(20);
    expect(ur.narrative.toLowerCase()).toMatch(/insufficient|missing|financial/);
  });

  test('fail-open on broken input does not throw', () => {
    expect(() => buildUnderwritingReadinessV1({
      financial_breakdown_v1: undefined as any,
      financial_coverage_v1: undefined as any,
    })).not.toThrow();
  });
});
