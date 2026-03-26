import {
  buildFinancialBreakdownV1,
  buildUnderwritingReadinessV1,
} from '../financial-breakdown-v1.js';
import type { FinancialBreakdownV1 } from '../financial-breakdown-v1.js';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1.js';
import type { FinancialCoverageProfileV1 } from '../financial-coverage-profile.js';
import type { FinancialIntegrityV1 } from '../../types/financial-integrity-v1.js';

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

// ─── Case: Corrupted value rejection (year-header extraction artifacts) ───────

describe('buildFinancialBreakdownV1 — corrupted value rejection', () => {
  test('year-equals-value facts are not selected as current revenue', () => {
    const corrupted = fact('revenue', 2026, { period_label: 'FY2026', source_kind: 'xlsx', confidence: 'high' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [corrupted],
      financial_coverage_v1: xlsxCoverage(),
    });
    expect(bd.current_state.revenue).toBeUndefined();
  });

  test('clean fact is selected when corrupted fact co-exists', () => {
    const corrupted = fact('revenue', 2026, { period_label: 'FY2026', source_kind: 'xlsx', confidence: 'high' });
    const clean = fact('revenue', 3_337_000, { period_label: 'FY2026', source_kind: 'xlsx', confidence: 'medium' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [corrupted, clean],
      financial_coverage_v1: xlsxCoverage(),
    });
    expect(bd.current_state.revenue?.value).toBe(3_337_000);
  });

  test('multiple corrupted facts for different years are all rejected', () => {
    const c1 = fact('revenue', 2025, { period_label: '2025', source_kind: 'xlsx', confidence: 'high' });
    const c2 = fact('revenue', 2026, { period_label: 'FY2026', source_kind: 'xlsx', confidence: 'high' });
    const c3 = fact('revenue', 2027, { period_label: 'FY2027', source_kind: 'xlsx', confidence: 'high' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [c1, c2, c3],
      financial_coverage_v1: xlsxCoverage(),
    });
    expect(bd.current_state.revenue).toBeUndefined();
    expect(bd.has_current_state).toBe(false);
  });

  test('corrupted facts produce a corrupted_extraction_values risk flag', () => {
    const corrupted = fact('revenue', 2026, { period_label: 'FY2026', source_kind: 'xlsx', confidence: 'high' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [corrupted],
      financial_coverage_v1: xlsxCoverage(),
    });
    const codes = bd.risks.map(r => r.code);
    expect(codes).toContain('corrupted_extraction_values');
  });

  test('corrupted risk flag has medium severity', () => {
    const corrupted = fact('revenue', 2026, { period_label: 'FY2026' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [corrupted],
      financial_coverage_v1: xlsxCoverage(),
    });
    const risk = bd.risks.find(r => r.code === 'corrupted_extraction_values');
    expect(risk?.severity).toBe('medium');
  });

  test('no corrupted_extraction_values risk when all facts are clean', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 3_337_000)],
      financial_coverage_v1: xlsxCoverage(),
    });
    const codes = bd.risks.map(r => r.code);
    expect(codes).not.toContain('corrupted_extraction_values');
  });

  test('projected periods skip corrupted facts', () => {
    const futureYear = new Date().getFullYear() + 2;
    // Corrupted: value equals the year in the period_label
    const corrupted = fact('revenue', futureYear, { period_label: `FY${futureYear}`, source_kind: 'xlsx' });
    // Clean projected fact for same period
    const cleanProj = fact('revenue', 5_000_000, { period_label: `FY${futureYear}`, source_kind: 'xlsx' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [corrupted, cleanProj],
      financial_coverage_v1: xlsxCoverage({ forecast_revenue_present: true }),
    });
    // Only the clean projected fact should appear in projection periods
    const revenueValues = bd.projections.periods.map(p => p.revenue);
    expect(revenueValues).not.toContain(futureYear);
    expect(revenueValues).toContain(5_000_000);
  });
});

// ─── Case: Projected vs historical precedence ─────────────────────────────────

describe('buildFinancialBreakdownV1 — projected vs historical precedence', () => {
  test('current-state revenue uses historical/current fact, not projected', () => {
    const current = fact('revenue', 800_000, { period_label: 'current', temporal_scope: 'current' });
    const projected = projFact('revenue', 5_000_000, new Date().getFullYear() + 1);
    const bd = buildFinancialBreakdownV1({
      financial_facts: [projected, current],
      financial_coverage_v1: xlsxCoverage({ historical_revenue_present: true, forecast_revenue_present: true }),
    });
    expect(bd.current_state.revenue?.value).toBe(800_000);
  });

  test('projection periods only contain future-year facts', () => {
    const futureYear = new Date().getFullYear() + 2;
    const current = fact('revenue', 800_000, { period_label: 'current' });
    const projected = fact('revenue', 5_000_000, { period_label: `FY${futureYear}`, temporal_scope: 'projected' });
    const bd = buildFinancialBreakdownV1({
      financial_facts: [current, projected],
      financial_coverage_v1: xlsxCoverage({ forecast_revenue_present: true }),
    });
    expect(bd.projections.periods.length).toBeGreaterThanOrEqual(1);
    const labels = bd.projections.periods.map(p => p.period_label);
    expect(labels).toContain(`FY${futureYear}`);
    expect(labels).not.toContain('current');
  });

  test('has_projections is false when only historical facts exist', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 800_000, { period_label: 'FY2024', temporal_scope: 'historical' })],
      financial_coverage_v1: xlsxCoverage(),
    });
    expect(bd.has_projections).toBe(false);
  });

  test('xlxs projected revenue wins over deck projected revenue for same period in projections', () => {
    const futureYear = new Date().getFullYear() + 1;
    const xlsxProj = fact('revenue', 3_000_000, {
      period_label: `FY${futureYear}`,
      source_kind: 'xlsx',
      temporal_scope: 'projected',
    });
    // Projection period collection uses per-period best-confidence selection (CONF_SCORES).
    // The xlsx fact should appear in the projection snapshot.
    const bd = buildFinancialBreakdownV1({
      financial_facts: [xlsxProj],
      financial_coverage_v1: xlsxCoverage({ forecast_revenue_present: true }),
    });
    const period = bd.projections.periods.find(p => p.period_label === `FY${futureYear}`);
    expect(period?.revenue).toBe(3_000_000);
  });
});

// ─── Tests: integrity FAIL propagation into readiness ─────────────────────────

describe('buildUnderwritingReadinessV1 — integrity FAIL propagation', () => {
  function makeIntegrity(overrides: Partial<FinancialIntegrityV1> = {}): FinancialIntegrityV1 {
    return {
      computed_at: new Date().toISOString(),
      completeness_score: 80,
      missing_critical: [],
      missing_supplementary: [],
      flags: [],
      has_facts: true,
      ...overrides,
    };
  }

  const richCoverage = xlsxCoverage({
    historical_revenue_present: true,
    forecast_revenue_present: true,
    income_statement_present: true,
    burn_rate_present: true,
    runway_present: true,
  });

  test('integrity FAIL (critical severity, has_facts=true) blocks the +5 consistency bonus', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 2_000_000)],
      financial_coverage_v1: richCoverage,
      documents: [{ document_id: 'cap1', filename: 'CapTable.xlsx' }],
    });
    // Without integrity FAIL — should get the bonus
    const urClean = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      financial_integrity_v1: makeIntegrity({ flags: [] }),
    });

    // With integrity FAIL — should NOT get the bonus
    const urFail = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      financial_integrity_v1: makeIntegrity({
        flags: [{
          flag_key: 'cross_source_discrepancy:revenue',
          status: 'FAIL',
          severity: 'critical',
          message: 'Revenue from deck ($5M) vs XLSX ($2M) differs by >50%',
          fact_ids: [],
        }],
      }),
    });

    expect(urFail.score).toBeLessThan(urClean.score);
  });

  test('integrity FAIL pushes a reason mentioning discrepancy', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 2_000_000)],
      financial_coverage_v1: richCoverage,
    });
    const ur = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      financial_integrity_v1: makeIntegrity({
        flags: [{
          flag_key: 'cross_source_discrepancy:revenue',
          status: 'FAIL',
          severity: 'high',
          message: 'Revenue conflict between deck and XLSX',
          fact_ids: [],
        }],
      }),
    });
    const allReasons = ur.reasons.join(' ');
    expect(allReasons).toMatch(/discrepanc|integrity|conflict/i);
  });

  test('integrity FAIL with has_facts=false does NOT block the bonus (prevents empty-facts false positives)', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 2_000_000)],
      financial_coverage_v1: richCoverage,
      documents: [{ document_id: 'cap1', filename: 'CapTable.xlsx' }],
    });
    // has_facts=false simulates an empty/default integrity result (buildEmptyFinancialIntegrityV1)
    const urNoFacts = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      financial_integrity_v1: makeIntegrity({
        has_facts: false,
        flags: [{
          flag_key: 'cross_source_discrepancy:revenue',
          status: 'FAIL',
          severity: 'critical',
          message: 'Should be ignored when has_facts=false',
          fact_ids: [],
        }],
      }),
    });
    // Same setup but no integrity at all
    const urNoIntegrity = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
    });
    // Scores should be equal: has_facts=false makes the FAIL irrelevant
    expect(urNoFacts.score).toBe(urNoIntegrity.score);
  });

  test('WARN-severity integrity flags do NOT block the bonus', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 2_000_000)],
      financial_coverage_v1: richCoverage,
      documents: [{ document_id: 'cap1', filename: 'CapTable.xlsx' }],
    });
    const urWarn = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      financial_integrity_v1: makeIntegrity({
        flags: [{
          flag_key: 'period_alignment:revenue',
          status: 'WARN',
          severity: 'low',
          message: 'Minor period label inconsistency',
          fact_ids: [],
        }],
      }),
    });
    const urClean = buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      financial_integrity_v1: makeIntegrity({ flags: [] }),
    });
    // WARN should not reduce score
    expect(urWarn.score).toBe(urClean.score);
  });

  test('without financial_integrity_v1 (undefined), behavior is unchanged from pre-fix baseline', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 2_000_000)],
      financial_coverage_v1: richCoverage,
      documents: [{ document_id: 'cap1', filename: 'CapTable.xlsx' }],
    });
    expect(() => buildUnderwritingReadinessV1({
      financial_breakdown_v1: bd,
      financial_coverage_v1: richCoverage,
      // financial_integrity_v1 omitted
    })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Semantic surfacing — explicit vs derived vs projected
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 2 — Scenario 1: weak explicit burn + derived workbook proxy', () => {
  // Deck burn scores higher than derived (deck SRC_RANK=1 > unknown SRC_RANK=0)
  // so deck is selected as primary; derived is the alternative.
  function makeScenario1Facts(): FinancialFactV1[] {
    return [
      fact('burn_rate', 250_000, {
        source_kind: 'deck',
        confidence: 'low',
        period_label: 'FY2024',
      }),
      fact('burn_rate', 400_000, {
        source_kind: 'unknown',
        confidence: 'medium',
        is_derived: true,
        derivation_rule: 'burn_rate_from_total_expenses_run_rate',
        semantic_family: 'liquidity',
        semantic_role: 'derived',
        period_label: 'FY2024',
      }),
    ];
  }

  test('primary burn is the deck fact (deck outranks derived/unknown)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.monthly_burn?.source_kind).toBe('deck');
    expect(bd.burn_runway.monthly_burn?.value).toBe(250_000);
  });

  test('primary burn is_provisional = true (low-conf deck source)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.monthly_burn?.is_provisional).toBe(true);
  });

  test('alternative_burn_fact surfaces the derived workbook proxy', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact).toBeDefined();
    expect(bd.burn_runway.alternative_burn_fact?.is_derived).toBe(true);
    expect(bd.burn_runway.alternative_burn_fact?.derivation_rule).toBe('burn_rate_from_total_expenses_run_rate');
    expect(bd.burn_runway.alternative_burn_fact?.value).toBe(400_000);
  });

  test('alternative_burn_fact.is_provisional = true (derived implies provisional)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact?.is_provisional).toBe(true);
  });

  test('alternative_burn_fact carries semantic_family and semantic_role from FinancialFactV1', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.alternative_burn_fact?.semantic_family).toBe('liquidity');
    expect(bd.burn_runway.alternative_burn_fact?.semantic_role).toBe('derived');
  });

  test('primary burn selection_reason references the deck weakness and alternative', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.burn_runway.monthly_burn?.selection_reason).toBeTruthy();
    expect(bd.burn_runway.monthly_burn?.selection_reason).toMatch(/deck|proxy|alternative/i);
  });

  test('current_state.burn_rate mirrors the deck primary fact', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario1Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.burn_rate?.source_kind).toBe('deck');
    expect(bd.current_state.burn_rate?.is_provisional).toBe(true);
  });
});

describe('Phase 2 — Scenario 2: current vs projected gross margin', () => {
  // A historical FY2024 gross margin vs a projected FY2028 gross margin.
  // The current (non-projected) wins primary; projected becomes alternative.
  function makeScenario2Facts(): FinancialFactV1[] {
    return [
      fact('gross_margin', 9.5, {
        source_kind: 'xlsx',
        unit: 'percent',
        confidence: 'high',
        period_label: 'FY2024',
        temporal_scope: 'historical',
      }),
      fact('gross_margin', 64.8, {
        source_kind: 'xlsx',
        unit: 'percent',
        confidence: 'medium',
        period_label: 'FY2028',
        // FY2028 is detected as projected by isProjectedFact (year > current year)
      }),
    ];
  }

  function buildS2() {
    return buildFinancialBreakdownV1({
      financial_facts: makeScenario2Facts(),
      financial_coverage_v1: xlsxCoverage({ income_statement_present: true }),
    });
  }

  test('gross_margin_pct is the historical current-period value', () => {
    const bd = buildS2();
    expect(bd.current_state.gross_margin_pct?.value).toBeCloseTo(9.5, 1);
    expect(bd.current_state.gross_margin_pct?.period_label).toBe('FY2024');
  });

  test('primary gross_margin_pct is NOT flagged as projected', () => {
    const bd = buildS2();
    expect(bd.current_state.gross_margin_pct?.is_projected).toBeFalsy();
  });

  test('alternative_gross_margin_fact surfaces the projected value', () => {
    const bd = buildS2();
    expect(bd.current_state.alternative_gross_margin_fact).toBeDefined();
    expect(bd.current_state.alternative_gross_margin_fact?.value).toBeCloseTo(64.8, 1);
    expect(bd.current_state.alternative_gross_margin_fact?.period_label).toBe('FY2028');
  });

  test('alternative_gross_margin_fact.is_projected = true', () => {
    const bd = buildS2();
    expect(bd.current_state.alternative_gross_margin_fact?.is_projected).toBe(true);
  });

  test('alternative_gross_margin_fact.is_provisional = true (projected implies provisional)', () => {
    const bd = buildS2();
    expect(bd.current_state.alternative_gross_margin_fact?.is_provisional).toBe(true);
  });

  test('alternative gross_margin selection_reason references temporal distinction', () => {
    const bd = buildS2();
    expect(bd.current_state.alternative_gross_margin_fact?.selection_reason).toBeTruthy();
    expect(bd.current_state.alternative_gross_margin_fact?.selection_reason).toMatch(
      /projected|period|comparable/i,
    );
  });

  test('temporal_scope passes through on primary (historical)', () => {
    const bd = buildS2();
    expect(bd.current_state.gross_margin_pct?.temporal_scope).toBe('historical');
  });
});

describe('Phase 2 — Scenario 3: strong explicit xlsx metric — no spurious alternative', () => {
  test('revenue from xlsx is not marked is_provisional', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 5_000_000, { source_kind: 'xlsx', confidence: 'high' })],
      financial_coverage_v1: xlsxCoverage({ historical_revenue_present: true }),
    });
    expect(bd.current_state.revenue?.source_kind).toBe('xlsx');
    expect(bd.current_state.revenue?.is_provisional).toBeFalsy();
    expect(bd.current_state.revenue?.is_derived).toBeFalsy();
  });

  test('no alternative_burn_fact when single strong xlsx burn exists', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('burn_rate', 300_000, { source_kind: 'xlsx', confidence: 'high' })],
      financial_coverage_v1: xlsxCoverage({ burn_rate_present: true }),
    });
    expect(bd.burn_runway.alternative_burn_fact).toBeUndefined();
  });

  test('burn selection_reason is falsy when primary burn is strong', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('burn_rate', 300_000, { source_kind: 'xlsx', confidence: 'high' })],
      financial_coverage_v1: xlsxCoverage({ burn_rate_present: true }),
    });
    expect(bd.burn_runway.monthly_burn?.selection_reason).toBeFalsy();
  });

  test('no alternative_gross_margin_fact when only one current-period GM exists', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [
        fact('gross_margin', 55, { source_kind: 'xlsx', confidence: 'high', unit: 'percent', temporal_scope: 'historical', period_label: 'FY2024' }),
      ],
      financial_coverage_v1: xlsxCoverage({ income_statement_present: true }),
    });
    expect(bd.current_state.alternative_gross_margin_fact).toBeUndefined();
  });

  test('temporal_scope is preserved on the primary metric', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 5_000_000, { source_kind: 'xlsx', confidence: 'high', temporal_scope: 'historical' })],
      financial_coverage_v1: xlsxCoverage({ historical_revenue_present: true }),
    });
    expect(bd.current_state.revenue?.temporal_scope).toBe('historical');
  });
});

describe('Phase 2 — Scenario 4: derived-only gross margin (no explicit fact)', () => {
  function makeScenario4Facts(): FinancialFactV1[] {
    return [
      fact('gross_margin', 60, {
        source_kind: 'unknown',
        unit: 'percent',
        confidence: 'medium',
        is_derived: true,
        derivation_rule: 'gross_margin_from_gross_profit_and_revenue',
        semantic_family: 'profitability',
        semantic_role: 'derived',
      }),
    ];
  }

  test('surfaces the derived gross_margin_pct', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct).toBeDefined();
    expect(bd.current_state.gross_margin_pct?.value).toBeCloseTo(60, 1);
  });

  test('derived gross_margin.is_derived = true', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct?.is_derived).toBe(true);
  });

  test('derived gross_margin.is_provisional = true', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct?.is_provisional).toBe(true);
  });

  test('derivation_rule is passed through correctly', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct?.derivation_rule).toBe('gross_margin_from_gross_profit_and_revenue');
  });

  test('semantic_family is passed through as profitability', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct?.semantic_family).toBe('profitability');
  });

  test('semantic_role is passed through as derived', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct?.semantic_role).toBe('derived');
  });

  test('source_kind is preserved as unknown (derived convention)', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.gross_margin_pct?.source_kind).toBe('unknown');
  });

  test('no alternative_gross_margin_fact when only one derived candidate exists', () => {
    const bd = buildFinancialBreakdownV1({ financial_facts: makeScenario4Facts(), financial_coverage_v1: makeCoverage() });
    expect(bd.current_state.alternative_gross_margin_fact).toBeUndefined();
  });
});

describe('Phase 2 — Backward compatibility: existing FinancialMetricPoint fields still present', () => {
  test('all original FinancialMetricPoint fields remain on an xlsx fact', () => {
    const bd = buildFinancialBreakdownV1({
      financial_facts: [fact('revenue', 1_000_000, { source_kind: 'xlsx', confidence: 'high', unit: 'currency', currency: 'USD', period_label: 'FY2024' })],
      financial_coverage_v1: xlsxCoverage(),
    });
    const rev = bd.current_state.revenue;
    expect(rev).toBeDefined();
    expect(typeof rev?.value).toBe('number');
    expect(typeof rev?.unit).toBe('string');
    expect(typeof rev?.period_label).toBe('string');
    expect(typeof rev?.confidence).toBe('string');
    expect(typeof rev?.source_kind).toBe('string');
  });
});
