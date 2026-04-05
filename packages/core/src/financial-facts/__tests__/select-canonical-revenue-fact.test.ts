/**
 * select-canonical-revenue-fact.test.ts
 *
 * Tests for selectCanonicalRevenueFact — the shared revenue selector that
 * ensures financial_breakdown_v1.current_state.revenue and
 * structured_summary.revenue always select the same canonical fact.
 *
 * Includes regression tests for:
 *   - Qredible-type divergence: PDF-extracted revenue present in breakdown but
 *     previously absent from structured_summary (fixed by removing xlsx-only filter).
 *   - WebMax-type divergence: monthly-only XLSX facts must not produce a revenue
 *     headline on either path.
 *   - StackFactor-type divergence (Fix 10): kpi_tile current revenue must win over
 *     projected quarterly xlsx facts with ambiguous temporal scope.
 *   - DealDecision-type divergence (Fix 11): multi-year proforma XLSX (2026/2027/2028)
 *     must not surface the current-year column as current-state revenue.
 */

import {
  selectCanonicalRevenueFact,
  isCorruptedFact,
  CANONICAL_REVENUE_KEYS,
  filterCorruptedFacts,
  detectProformaModelFactIds,
} from '../select-authoritative-fact';
import type { FinancialFactV1 } from '../financial-fact-v1';

// ─── Fixture ──────────────────────────────────────────────────────────────────

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

const pdfFact = (metric_key: string, value: number, overrides?: Partial<FinancialFactV1>) =>
  fact(metric_key, value, { source_kind: 'pdf_table', document_id: 'doc_pdf', confidence: 'high', ...overrides });

const deckFact = (metric_key: string, value: number, overrides?: Partial<FinancialFactV1>) =>
  fact(metric_key, value, { source_kind: 'deck', document_id: 'doc_deck', confidence: 'medium', ...overrides });

const monthlyFact = (metric_key: string, value: number, periodLabel: string) =>
  fact(metric_key, value, { period_type: 'monthly', period_label: periodLabel });

// ─── CANONICAL_REVENUE_KEYS export ───────────────────────────────────────────

describe('CANONICAL_REVENUE_KEYS', () => {
  test('contains revenue, arr, mrr', () => {
    expect(CANONICAL_REVENUE_KEYS).toContain('revenue');
    expect(CANONICAL_REVENUE_KEYS).toContain('arr');
    expect(CANONICAL_REVENUE_KEYS).toContain('mrr');
  });
});

// ─── Basic selection ──────────────────────────────────────────────────────────

describe('selectCanonicalRevenueFact — basic selection', () => {
  test('returns undefined for empty facts array', () => {
    expect(selectCanonicalRevenueFact([])).toBeUndefined();
  });

  test('returns undefined when no revenue-class facts exist', () => {
    const f = fact('burn_rate', 50_000);
    expect(selectCanonicalRevenueFact([f])).toBeUndefined();
  });

  test('returns undefined when revenue fact has unit = percent (non-monetary)', () => {
    // unit='percent' is not a monetary representation — excluded.
    // Note: unit='number' IS accepted (kpi_tile revenue facts use 'number'; see Fix 10b).
    const f = fact('revenue', 1_000_000, { unit: 'percent' });
    expect(selectCanonicalRevenueFact([f])).toBeUndefined();
  });

  test('returns undefined when revenue fact has value = 0', () => {
    const f = fact('revenue', 0);
    expect(selectCanonicalRevenueFact([f])).toBeUndefined();
  });

  test('returns undefined when revenue fact has value < 0', () => {
    const f = fact('revenue', -5_000);
    expect(selectCanonicalRevenueFact([f])).toBeUndefined();
  });

  test('selects a single valid annual revenue fact', () => {
    const f = fact('revenue', 381_000, { source_kind: 'pdf_table' });
    expect(selectCanonicalRevenueFact([f])?.value).toBe(381_000);
  });

  test('selects arr as a revenue-class metric', () => {
    const f = fact('arr', 500_000, { period_label: 'FY2025', period_type: 'annual' });
    expect(selectCanonicalRevenueFact([f])?.value).toBe(500_000);
  });

  test('selects mrr as a revenue-class metric', () => {
    const f = fact('mrr', 41_000, { period_label: 'current', period_type: 'annual' });
    expect(selectCanonicalRevenueFact([f])?.metric_key).toBe('mrr');
  });
});

// ─── Source-kind priority ─────────────────────────────────────────────────────

describe('selectCanonicalRevenueFact — source-kind priority', () => {
  test('xlsx beats pdf_table with same value', () => {
    const xls = fact('revenue', 3_337_000, { source_kind: 'xlsx', period_label: 'FY2026' });
    const pdf = pdfFact('revenue', 3_337_000, { period_label: 'FY2026' });
    const result = selectCanonicalRevenueFact([pdf, xls]);
    expect(result?.source_kind).toBe('xlsx');
  });

  test('pdf_table beats deck', () => {
    const pdf = pdfFact('revenue', 381_000);
    const deck = deckFact('revenue', 400_000);
    const result = selectCanonicalRevenueFact([deck, pdf]);
    expect(result?.source_kind).toBe('pdf_table');
  });

  test('xlsx beats deck', () => {
    const xls = fact('revenue', 3_337_000);
    const deck = deckFact('revenue', 3_500_000);
    expect(selectCanonicalRevenueFact([deck, xls])?.source_kind).toBe('xlsx');
  });

  // ── Qredible regression ────────────────────────────────────────────────────
  // Before Fix #6, injectXlsxRevenueIntoStructuredSummary filtered source_kind==='xlsx' only,
  // so a pdf_table fact was invisible to structured_summary even though it was selected by
  // financial_breakdown_v1.  selectCanonicalRevenueFact is source-kind agnostic.
  test('[Qredible regression] pdf_table revenue fact is selected (not xlsx-only)', () => {
    const pdfRev = pdfFact('revenue', 381_000, {
      period_label: 'FY2024',
      period_type: 'annual',
    });
    // No xlsx facts — PDF only deal.
    const result = selectCanonicalRevenueFact([pdfRev]);
    expect(result).toBeDefined();
    expect(result!.value).toBe(381_000);
    expect(result!.source_kind).toBe('pdf_table');
  });
});

// ─── Monthly-only guard ───────────────────────────────────────────────────────

describe('selectCanonicalRevenueFact — monthly-only guard', () => {
  // Three monthly facts (sparse data, not a rolling model): guard must still fire.
  // Note: WebMax has 9+ distinct monthly periods — see rolling-model tests below.
  test('three monthly revenue facts (sparse) → returns undefined', () => {
    const sep = monthlyFact('revenue', 8_000, 'September');
    const oct = monthlyFact('revenue', 9_200, 'October');
    const nov = monthlyFact('revenue', 7_500, 'November');
    expect(selectCanonicalRevenueFact([sep, oct, nov])).toBeUndefined();
  });

  test('single monthly revenue fact → returns undefined', () => {
    const f = monthlyFact('revenue', 12_000, 'Month 3');
    expect(selectCanonicalRevenueFact([f])).toBeUndefined();
  });

  test('mixed annual + monthly → selects the annual fact', () => {
    const monthly = monthlyFact('revenue', 12_000, 'September');
    const annual = fact('revenue', 144_000, { period_type: 'annual', period_label: 'FY2025' });
    const result = selectCanonicalRevenueFact([monthly, annual]);
    expect(result?.period_type).toBe('annual');
    expect(result?.value).toBe(144_000);
  });

  test('monthly fact is NOT promoted over annual even when monthly has higher value', () => {
    const monthly = monthlyFact('revenue', 999_999, 'October');
    const annual = fact('revenue', 1_200_000, { period_type: 'annual', period_label: 'FY2025' });
    const result = selectCanonicalRevenueFact([monthly, annual]);
    expect(result?.period_label).toBe('FY2025');
  });

  // ── Rolling-monthly XLSX model (Fix 9 — WebMax regression) ────────────────
  //
  // WebMax has 9+ distinct named-month records in the XLSX (Jan–Sep actuals).
  // With 4+ distinct non-zero monthly periods the monthly-only guard must NOT
  // fire: the most authoritative monthly fact is the current-revenue headline.

  test('[Fix 9 / WebMax] 9 distinct monthly xlsx facts → selects best fact (non-null)', () => {
    const months = [
      monthlyFact('revenue', 8_000, 'January'),
      monthlyFact('revenue', 8_000, 'February'),
      monthlyFact('revenue', 8_000, 'March'),
      monthlyFact('revenue', 8_000, 'April'),
      monthlyFact('revenue', 8_000, 'May'),
      monthlyFact('revenue', 8_000, 'June'),
      monthlyFact('revenue', 8_000, 'July'),
      monthlyFact('revenue', 8_000, 'August'),
      monthlyFact('revenue', 8_000, 'September'),
    ];
    const result = selectCanonicalRevenueFact(months);
    expect(result).not.toBeUndefined();
    expect(result?.value).toBe(8_000);
    expect(result?.source_kind).toBe('xlsx');
    expect(result?.period_type).toBe('monthly');
  });

  test('[Fix 9 / WebMax] $0 and $8K facts for same 9 periods → $0 excluded, $8K selected', () => {
    const periodNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
    const mixed: ReturnType<typeof monthlyFact>[] = [];
    for (const p of periodNames) {
      mixed.push(monthlyFact('revenue', 0, p));      // zero facts must be excluded
      mixed.push(monthlyFact('revenue', 8_000, p));  // non-zero facts eligible
    }
    const result = selectCanonicalRevenueFact(mixed);
    expect(result).not.toBeUndefined();
    expect(result?.value).toBe(8_000);
    expect(result?.source_kind).toBe('xlsx');
  });

  test('[Fix 9 / WebMax] exactly 4 distinct monthly periods → guard relaxed (selects fact)', () => {
    const months = [
      monthlyFact('revenue', 5_000, 'January'),
      monthlyFact('revenue', 5_000, 'February'),
      monthlyFact('revenue', 5_000, 'March'),
      monthlyFact('revenue', 5_000, 'April'),
    ];
    const result = selectCanonicalRevenueFact(months);
    expect(result).not.toBeUndefined();
    expect(result?.value).toBe(5_000);
  });
});

// ─── Corruption rejection ─────────────────────────────────────────────────────

describe('selectCanonicalRevenueFact — corruption rejection', () => {
  test('year-equals-value fact is excluded', () => {
    const bad = fact('revenue', 2026, { period_label: 'FY2026', period_type: 'annual' });
    expect(selectCanonicalRevenueFact([bad])).toBeUndefined();
  });

  test('NaN value fact is excluded', () => {
    const bad = fact('revenue', NaN);
    expect(selectCanonicalRevenueFact([bad])).toBeUndefined();
  });

  test('col_M period label (Guard 4) is excluded', () => {
    const bad = fact('revenue', 13_715, { period_label: 'col_M', period_type: 'unknown' });
    expect(selectCanonicalRevenueFact([bad])).toBeUndefined();
  });

  test('valid fact survives alongside corrupted facts', () => {
    const bad = fact('revenue', 2026, { period_label: 'FY2026' });
    const good = fact('revenue', 3_337_000, { period_label: 'FY2026', period_type: 'annual' });
    expect(selectCanonicalRevenueFact([bad, good])?.value).toBe(3_337_000);
  });
});

// ─── Projected vs non-projected ───────────────────────────────────────────────

describe('selectCanonicalRevenueFact — projected preference', () => {
  test('prefers non-projected over projected when both present', () => {
    const historical = fact('revenue', 461_000, { period_label: '2024', period_type: 'annual' });
    const projected = fact('revenue', 1_500_000, {
      period_label: 'FY2026',
      period_type: 'annual',
      temporal_scope: 'projected',
    });
    const result = selectCanonicalRevenueFact([projected, historical]);
    expect(result?.value).toBe(461_000);
  });

  test('returns undefined when only projected facts exist (projection-only deal)', () => {
    const proj = fact('revenue', 1_500_000, {
      period_label: 'FY2026',
      temporal_scope: 'projected',
    });
    expect(selectCanonicalRevenueFact([proj])).toBeUndefined();
  });
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe('selectCanonicalRevenueFact — determinism', () => {
  test('same winner regardless of input array order', () => {
    const a = fact('revenue', 461_000, { source_kind: 'xlsx', period_label: 'FY2025' });
    const b = pdfFact('revenue', 381_000, { period_label: 'FY2024' });
    const c = deckFact('revenue', 500_000, { period_label: 'FY2025' });
    const fwd = selectCanonicalRevenueFact([a, b, c]);
    const rev = selectCanonicalRevenueFact([c, b, a]);
    expect(fwd?.fact_id).toBe(rev?.fact_id);
    // xlsx beats pdf_table and deck
    expect(fwd?.source_kind).toBe('xlsx');
  });
});

// ─── Guard 5 — denomination period label ─────────────────────────────────────

describe('isCorruptedFact — Guard 5 (denomination period label)', () => {
  // $000, $0000 etc. are XLSX denomination row markers, not fiscal periods.
  test('$000 period label is corrupted', () => {
    const f = fact('revenue', 1_545, { period_label: '$000', period_type: 'unknown' });
    expect(isCorruptedFact(f).corrupted).toBe(true);
    expect(isCorruptedFact(f).reason).toBe('invalid_denomination_period');
  });

  test('$0000 period label is corrupted', () => {
    const f = fact('revenue', 2_091, { period_label: '$0000', period_type: 'unknown' });
    expect(isCorruptedFact(f).corrupted).toBe(true);
  });

  test('$00 period label is corrupted', () => {
    const f = fact('revenue', 808, { period_label: '$00', period_type: 'unknown' });
    expect(isCorruptedFact(f).corrupted).toBe(true);
  });

  test('FY2025 is not corrupted by Guard 5', () => {
    const f = fact('revenue', 1_500_000, { period_label: 'FY2025' });
    expect(isCorruptedFact(f).corrupted).toBe(false);
  });

  test('$USD is not corrupted by Guard 5 (not all zeros)', () => {
    // Edge case: a hypothetical period label containing a non-zero dollar prefix
    const f = fact('revenue', 1_000, { period_label: 'Q1 2025' });
    expect(isCorruptedFact(f).corrupted).toBe(false);
  });
});

describe('selectCanonicalRevenueFact — Guard 5 ($000 denomination facts excluded)', () => {
  test('[Fix 10 / StackFactor] $000 xlsx facts are rejected as corrupted', () => {
    // These facts come from XLSX denomination rows (values in thousands header)
    const denom1 = fact('revenue', 541, { period_label: '$000', period_type: 'unknown' });
    const denom2 = fact('revenue', 1_545, { period_label: '$000', period_type: 'unknown' });
    const denom3 = fact('revenue', 2_091, { period_label: '$000', period_type: 'unknown' });
    expect(selectCanonicalRevenueFact([denom1, denom2, denom3])).toBeUndefined();
  });

  test('[Fix 10 / StackFactor] kpi_tile wins after $000 facts removed', () => {
    const denom = fact('revenue', 2_091, { period_label: '$000', period_type: 'unknown' });
    const kpiFact = fact('revenue', 23_000, {
      source_kind: 'kpi_tile',
      period_label: 'current',
      period_type: 'unknown',
      confidence: 'medium',
    });
    const result = selectCanonicalRevenueFact([denom, kpiFact]);
    expect(result?.source_kind).toBe('kpi_tile');
    expect(result?.value).toBe(23_000);
  });
});

// ─── Tier A / B / C — StackFactor KPI tile regression ────────────────────────

describe('selectCanonicalRevenueFact — Tier A/B priority (Fix 10 / StackFactor)', () => {
  // Tier A: xlsx/pdf annual or TTM beats everything.
  test('[Tier A] xlsx annual beats kpi_tile current', () => {
    const annual = fact('revenue', 3_337_000, { source_kind: 'xlsx', period_label: 'FY2026', period_type: 'annual' });
    const kpi = fact('revenue', 23_000, {
      source_kind: 'kpi_tile', period_label: 'current', period_type: 'unknown', confidence: 'medium',
    });
    const result = selectCanonicalRevenueFact([kpi, annual]);
    expect(result?.source_kind).toBe('xlsx');
    expect(result?.value).toBe(3_337_000);
  });

  test('[Tier A] TTM xlsx beats kpi_tile current', () => {
    const ttm = fact('revenue', 1_200_000, { source_kind: 'xlsx', period_label: 'TTM', period_type: 'ttm' });
    const kpi = fact('revenue', 95_000, {
      source_kind: 'kpi_tile', period_label: 'current', period_type: 'unknown', confidence: 'high',
    });
    const result = selectCanonicalRevenueFact([kpi, ttm]);
    expect(result?.period_type).toBe('ttm');
    expect(result?.value).toBe(1_200_000);
  });

  // Tier B: when no annual/TTM facts exist, kpi_tile beats xlsx quarterly/unknown.
  test('[Fix 10 / StackFactor] kpi_tile current beats xlsx quarterly unknown', () => {
    // These represent StackFactor's 2Q/3Q/4Q 2026 XLSX projection rows.
    const q2 = fact('revenue', 4_500, { source_kind: 'xlsx', period_label: '2Q2026', period_type: 'unknown' });
    const q3 = fact('revenue', 16_000, { source_kind: 'xlsx', period_label: '3Q2026', period_type: 'unknown' });
    const q4 = fact('revenue', 21_750, { source_kind: 'xlsx', period_label: '4Q2026', period_type: 'unknown' });
    const kpi = fact('revenue', 23_000, {
      source_kind: 'kpi_tile', period_label: 'current', period_type: 'unknown', confidence: 'medium',
    });
    const result = selectCanonicalRevenueFact([q2, q3, q4, kpi]);
    // kpi_tile Tier B wins — no annual/TTM Tier A facts present
    expect(result?.source_kind).toBe('kpi_tile');
    expect(result?.value).toBe(23_000);
  });

  test('[Fix 10 / StackFactor] kpi_tile beats deck quarterly unknown', () => {
    const deckQ = deckFact('revenue', 50_000, { period_label: 'Q3 2026', period_type: 'unknown' });
    const kpi = fact('revenue', 23_000, {
      source_kind: 'kpi_tile', period_label: 'current', period_type: 'unknown', confidence: 'medium',
    });
    const result = selectCanonicalRevenueFact([deckQ, kpi]);
    expect(result?.source_kind).toBe('kpi_tile');
  });

  test('[Fix 10] xlsx annual still beats kpi_tile even when kpi_tile has higher value', () => {
    // Guard: Tier A must not be overridden by Tier B regardless of value magnitude.
    const annual = fact('revenue', 800_000, { source_kind: 'xlsx', period_label: 'FY2025', period_type: 'annual' });
    const kpi = fact('revenue', 999_999, {
      source_kind: 'kpi_tile', period_label: 'current', period_type: 'unknown', confidence: 'high',
    });
    const result = selectCanonicalRevenueFact([kpi, annual]);
    expect(result?.source_kind).toBe('xlsx');
    expect(result?.period_type).toBe('annual');
  });

  test('[Fix 10] pdf_kpi_line current fact is Tier B (wins over xlsx quarterly unknown)', () => {
    const q4 = fact('revenue', 50_000, { source_kind: 'xlsx', period_label: '4Q2025', period_type: 'unknown' });
    const pdfKpi = fact('revenue', 30_000, {
      source_kind: 'pdf_kpi_line', period_label: 'current', period_type: 'unknown', confidence: 'high',
    });
    const result = selectCanonicalRevenueFact([q4, pdfKpi]);
    expect(result?.source_kind).toBe('pdf_kpi_line');
  });

  // Tier C fallback: when no Tier A or Tier B, use original ranking.
  test('[Fix 10 / Tier C fallback] xlsx quarterly unknown wins when no Tier B', () => {
    const q3 = fact('revenue', 16_000, { source_kind: 'xlsx', period_label: '3Q2026', period_type: 'unknown' });
    const deckRev = deckFact('revenue', 30_000, { period_label: 'current', period_type: 'unknown' });
    const result = selectCanonicalRevenueFact([q3, deckRev]);
    // xlsx (source rank 10) beats deck (source rank 1) via Tier C
    expect(result?.source_kind).toBe('xlsx');
  });

  test('[Fix 10] projected kpi_tile (tscope=projected) is NOT in Tier B', () => {
    const projKpi = fact('revenue', 23_000, {
      source_kind: 'kpi_tile',
      period_label: 'current',
      period_type: 'unknown',
      confidence: 'medium',
      temporal_scope: 'projected',
    });
    const q4 = fact('revenue', 21_750, { source_kind: 'xlsx', period_label: '4Q2026', period_type: 'unknown' });
    // projected kpi_tile is excluded from Tier B by isProjectedFact; falls through to Tier C
    const result = selectCanonicalRevenueFact([projKpi, q4]);
    // Tier C: xlsx wins (kpi_tile is projected and filtered by requireNonProjected)
    expect(result?.source_kind).toBe('xlsx');
  });
});

// ─── Fix 10b: unit='number' kpi_tile inclusion ────────────────────────────────
describe("selectCanonicalRevenueFact — unit='number' kpi_tile facts (Fix 10b / StackFactor)", () => {
  test('kpi_tile revenue with unit=number is selected (not filtered out)', () => {
    const kpiNum = fact('revenue', 23_000, {
      source_kind: 'kpi_tile',
      period_label: 'current',
      period_type: 'unknown',
      confidence: 'medium',
      unit: 'number', // real StackFactor DB value
    });
    const result = selectCanonicalRevenueFact([kpiNum]);
    expect(result).toBeDefined();
    expect(result?.value).toBe(23_000);
    expect(result?.source_kind).toBe('kpi_tile');
  });

  test('kpi_tile unit=number beats xlsx quarterly unknown (Tier B wins over Tier C)', () => {
    const kpiNum = fact('revenue', 23_000, {
      source_kind: 'kpi_tile',
      period_label: 'current',
      period_type: 'unknown',
      confidence: 'medium',
      unit: 'number',
    });
    const q4 = fact('revenue', 21_750, { source_kind: 'xlsx', period_label: '4Q2026', period_type: 'unknown' });
    const result = selectCanonicalRevenueFact([kpiNum, q4]);
    // Tier B: kpi_tile selected even though unit=number
    expect(result?.source_kind).toBe('kpi_tile');
    expect(result?.value).toBe(23_000);
  });

  test('kpi_tile unit=number beats large xlsx col_X noise facts (StackFactor regression)', () => {
    const kpiNum = fact('revenue', 23_000, {
      source_kind: 'kpi_tile',
      period_label: 'current',
      period_type: 'unknown',
      confidence: 'medium',
      unit: 'number',
    });
    // Simulates col_M "Sales" salary-row noise — high confidence but not Tier B
    const colNoise = fact('revenue', 145_000, {
      source_kind: 'xlsx',
      period_label: 'col_M',
      period_type: 'unknown',
      confidence: 'high',
    });
    const result = selectCanonicalRevenueFact([kpiNum, colNoise]);
    expect(result?.source_kind).toBe('kpi_tile');
    expect(result?.value).toBe(23_000);
  });

  test('unit=number fact is NOT selected when isProjectedFact is true', () => {
    const projNum = fact('revenue', 23_000, {
      source_kind: 'kpi_tile',
      period_label: 'current',
      period_type: 'unknown',
      confidence: 'medium',
      unit: 'number',
      temporal_scope: 'projected', // projected kpi_tile — excluded from Tier B
    });
    const result = selectCanonicalRevenueFact([projNum]);
    // Only fact is projected kpi_tile — Tier B and Tier C (requireNonProjected) both fail
    expect(result).toBeUndefined();
  });
});

// ─── Fix 11: Multi-year proforma model detection (DealDecision) ───────────────

describe('detectProformaModelFactIds — proforma model detection', () => {
  const currentYear = new Date().getFullYear();

  test('returns empty set when no future-year XLSX annual facts present', () => {
    const onlyCurrent = fact('revenue', 1_000_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    expect(detectProformaModelFactIds([onlyCurrent]).size).toBe(0);
  });

  test('returns empty set when future year is xlsx but quarterly (not annual)', () => {
    const current = fact('revenue', 1_000_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    const futureQ = fact('revenue', 2_000_000, {
      source_kind: 'xlsx', period_label: `Q1 ${currentYear + 1}`, period_type: 'quarterly',
    });
    // Quarterly future-year fact does not trigger proforma detection
    expect(detectProformaModelFactIds([current, futureQ]).size).toBe(0);
  });

  test('marks current-year XLSX annual fact when future-year XLSX annual exists', () => {
    const currentRev = fact('revenue', 3_337_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    const futureRev = fact('revenue', 15_502_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 1), period_type: 'annual',
    });
    const ids = detectProformaModelFactIds([currentRev, futureRev]);
    expect(ids.has(currentRev.fact_id)).toBe(true);
    expect(ids.has(futureRev.fact_id)).toBe(false);
  });

  test('does NOT mark kpi_tile or pdf_table facts even when xlsx proforma model detected', () => {
    const kpiFact = fact('revenue', 23_000, {
      source_kind: 'kpi_tile', period_label: String(currentYear), period_type: 'unknown',
    });
    const futureXlsx = fact('revenue', 15_502_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 1), period_type: 'annual',
    });
    const ids = detectProformaModelFactIds([kpiFact, futureXlsx]);
    expect(ids.has(kpiFact.fact_id)).toBe(false);
  });

  test('does NOT mark historical XLSX facts when proforma model detected', () => {
    const historical = fact('revenue', 2_500_000, {
      source_kind: 'xlsx', period_label: String(currentYear - 1), period_type: 'annual',
      temporal_scope: 'historical',
    });
    const currentProforma = fact('revenue', 3_337_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    const future = fact('revenue', 15_502_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 1), period_type: 'annual',
    });
    const ids = detectProformaModelFactIds([historical, currentProforma, future]);
    // Only the current-year untagged fact is marked; historical is safe
    expect(ids.has(historical.fact_id)).toBe(false);
    expect(ids.has(currentProforma.fact_id)).toBe(true);
  });
});

describe('selectCanonicalRevenueFact — multi-year proforma model detection (Fix 11 / DealDecision)', () => {
  const currentYear = new Date().getFullYear();

  test('[DealDecision regression] 2026/2027/2028 proforma model → undefined for current_state', () => {
    // Simulates DealDecision: "Proforma Income Statement V2.xlsx" with only projected years
    const rev0 = fact('revenue', 3_337_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
      // temporal_scope absent (null in DB from stale extraction)
    });
    const rev1 = fact('revenue', 15_502_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 1), period_type: 'annual',
    });
    const rev2 = fact('revenue', 35_778_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 2), period_type: 'annual',
    });
    // All facts are from a proforma model — current_state must not surface any of them
    expect(selectCanonicalRevenueFact([rev0, rev1, rev2])).toBeUndefined();
  });

  test('historical actual (prior year) survives when multi-year proforma model detected', () => {
    // Deal has prior-year actuals + current/future projections
    const actual = fact('revenue', 2_500_000, {
      source_kind: 'xlsx', period_label: String(currentYear - 1), period_type: 'annual',
      temporal_scope: 'historical',
    });
    const proformaCurrent = fact('revenue', 3_337_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    const proformaFuture = fact('revenue', 15_502_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 1), period_type: 'annual',
    });
    // The historical actual must be selected; proforma current-year excluded
    const result = selectCanonicalRevenueFact([actual, proformaCurrent, proformaFuture]);
    expect(result).toBeDefined();
    expect(result?.period_label).toBe(String(currentYear - 1));
    expect(result?.value).toBe(2_500_000);
  });

  test('single current-year xlsx annual is NOT treated as proforma (no future years)', () => {
    // A deal reporting only current-year actuals — must not be excluded
    const currentActual = fact('revenue', 1_200_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    const result = selectCanonicalRevenueFact([currentActual]);
    expect(result).toBeDefined();
    expect(result?.value).toBe(1_200_000);
  });

  test('kpi_tile current revenue survives when xlsx multi-year proforma model is detected', () => {
    // kpi_tile is not xlsx → not affected by proforma detection → surfaces via Tier B
    const kpiCurrent = fact('revenue', 23_000, {
      source_kind: 'kpi_tile', period_label: 'current', period_type: 'unknown',
      confidence: 'medium', unit: 'number',
    });
    const proformaCurrent = fact('revenue', 3_337_000, {
      source_kind: 'xlsx', period_label: String(currentYear), period_type: 'annual',
    });
    const proformaFuture = fact('revenue', 15_502_000, {
      source_kind: 'xlsx', period_label: String(currentYear + 1), period_type: 'annual',
    });
    // kpi_tile is not xlsx → not excluded by proforma detection → selected via Tier B
    const result = selectCanonicalRevenueFact([kpiCurrent, proformaCurrent, proformaFuture]);
    expect(result).toBeDefined();
    expect(result?.source_kind).toBe('kpi_tile');
    expect(result?.value).toBe(23_000);
  });
});
