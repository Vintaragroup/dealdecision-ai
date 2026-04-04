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
 */

import {
  selectCanonicalRevenueFact,
  CANONICAL_REVENUE_KEYS,
  filterCorruptedFacts,
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

  test('returns undefined when revenue fact has unit != currency', () => {
    const f = fact('revenue', 1_000_000, { unit: 'number' });
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
  // ── WebMax regression ──────────────────────────────────────────────────────
  // When all non-corrupted revenue candidates are monthly-granularity,
  // selectCanonicalRevenueFact must return undefined rather than selecting one
  // month's value as the annual current-revenue headline.
  test('[WebMax regression] all monthly revenue facts → returns undefined', () => {
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
