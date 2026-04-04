/**
 * select-authoritative-fact.test.ts
 *
 * Unit tests for the unified financial fact selector:
 * - isCorruptedFact: year-header corruption detection, non-finite guard
 * - selectAuthoritativeFact:
 *     - corrupted data rejection
 *     - projected vs historical precedence
 *     - cross-source conflict resolution (xlsx > deck)
 *     - cross-source reconciliation status ranking
 *     - selector consistency (same winner regardless of caller context)
 * - filterCorruptedFacts: batch corruption filter
 */

import {
  isCorruptedFact,
  selectAuthoritativeFact,
  filterCorruptedFacts,
  isProjectedFact,
  type SelectAuthoritativeFactOpts,
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

const deckFact = (metric_key: string, value: number, overrides?: Partial<FinancialFactV1>) =>
  fact(metric_key, value, { source_kind: 'deck', document_id: 'doc_deck', ...overrides });

const projFact = (metric_key: string, value: number, year: number) =>
  fact(metric_key, value, {
    period_label: `FY${year}`,
    period_type: 'annual',
    temporal_scope: 'projected',
  });

// ─── isCorruptedFact ──────────────────────────────────────────────────────────

describe('isCorruptedFact', () => {
  describe('year-equals-value guard', () => {
    test('value=2026 with period_label=FY2026 is corrupted', () => {
      const f = fact('revenue', 2026, { period_label: 'FY2026', unit: 'currency' });
      const result = isCorruptedFact(f);
      expect(result.corrupted).toBe(true);
      expect(result.reason).toBe('year_equals_value');
    });

    test('value=2025 with period_label=2025 is corrupted', () => {
      const f = fact('revenue', 2025, { period_label: '2025', unit: 'currency' });
      expect(isCorruptedFact(f).corrupted).toBe(true);
    });

    test('value=2024 with period_label=Q1 2024 is corrupted', () => {
      const f = fact('revenue', 2024, { period_label: 'Q1 2024', unit: 'number' });
      expect(isCorruptedFact(f).corrupted).toBe(true);
    });

    test('value=2026 with period_label=current is NOT corrupted (no year in label)', () => {
      const f = fact('other_metric', 2026, { period_label: 'current' });
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });

    test('value=3337000 with period_label=FY2026 is NOT corrupted (value != year)', () => {
      const f = fact('revenue', 3_337_000, { period_label: 'FY2026' });
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });

    test('value=2000 with period_label=FY2000 is corrupted (boundary)', () => {
      const f = fact('revenue', 2000, { period_label: 'FY2000' });
      expect(isCorruptedFact(f).corrupted).toBe(true);
    });

    test('value=2099 with period_label=FY2099 is corrupted (upper boundary)', () => {
      const f = fact('revenue', 2099, { period_label: 'FY2099' });
      expect(isCorruptedFact(f).corrupted).toBe(true);
    });

    test('value=1989 with period_label=1989 is NOT corrupted (below guard range)', () => {
      // Unlikely in practice; guard only applies to 1990-2100.
      const f = fact('revenue', 1989, { period_label: '1989' });
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });

    test('value=2027 with period_label=FY2026 is corrupted (year-integer-as-currency guard)', () => {
      // Guard 3: currency fact whose integer value is a different year than the period_label year.
      // This is the XLSX column-header-as-data-cell extraction artefact (year mismatch variant).
      const f = fact('revenue', 2027, { period_label: 'FY2026', unit: 'currency' });
      expect(isCorruptedFact(f).corrupted).toBe(true);
      expect(isCorruptedFact(f).reason).toBe('year_integer_as_currency');
    });

    test('value=2027 with unit=number is NOT corrupted (headcount=2027 is valid)', () => {
      // Guard 3 only fires for currency-unit facts. A headcount of 2027 is a valid integer.
      const f = fact('total_headcount', 2027, { period_label: 'FY2026', unit: 'number' });
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });

    test('value=2026.5 (non-integer) with period_label=FY2026 is NOT corrupted', () => {
      const f = fact('revenue', 2026.5, { period_label: 'FY2026' });
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });
  });

  describe('non-finite value guard', () => {
    test('NaN value is corrupted', () => {
      const f = fact('revenue', NaN);
      const result = isCorruptedFact(f);
      expect(result.corrupted).toBe(true);
      expect(result.reason).toBe('non_finite_value');
    });

    test('Infinity value is corrupted', () => {
      const f = fact('revenue', Infinity);
      expect(isCorruptedFact(f).corrupted).toBe(true);
    });

    test('-Infinity value is corrupted', () => {
      const f = fact('burn_rate', -Infinity);
      expect(isCorruptedFact(f).corrupted).toBe(true);
    });
  });

  describe('clean facts', () => {
    test('normal revenue fact is clean', () => {
      const f = fact('revenue', 2_739_000);
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });

    test('zero value is clean (zero revenue is valid: no income)', () => {
      const f = fact('revenue', 0);
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });

    test('negative burn_rate is clean', () => {
      const f = fact('burn_rate', -50_000);
      expect(isCorruptedFact(f).corrupted).toBe(false);
    });
  });

  // ── Guard 4 — column-index period label ─────────────────────────────────

  describe('column-index period label guard (Guard 4)', () => {
    test.each([
      ['col_M', 13715.34],
      ['col_A', 5000],
      ['col_Z', 9999],
      ['col_13', 7500],
      ['column_4', 1000],
    ] as const)('period_label=%s → corrupted with reason invalid_column_index_period', (label, value) => {
      const f = fact('revenue', value, { period_label: label, period_type: 'unknown' });
      expect(isCorruptedFact(f).corrupted).toBe(true);
      expect(isCorruptedFact(f).reason).toBe('invalid_column_index_period');
    });

    test('col_M fact is removed by filterCorruptedFacts', () => {
      const good = fact('revenue', 461_000, { period_label: '2026', period_type: 'annual' });
      const bad = fact('revenue', 13_715, { period_label: 'col_M', period_type: 'unknown' });
      expect(filterCorruptedFacts([good, bad])).toEqual([good]);
    });

    test('selectAuthoritativeFact never returns a col_M fact', () => {
      const colFact = fact('revenue', 13_715, { period_label: 'col_M', period_type: 'unknown' });
      expect(selectAuthoritativeFact('revenue', [colFact])).toBeUndefined();
    });

    test('col_M is rejected even when it is the only candidate', () => {
      const f = fact('revenue', 99_000, { period_label: 'col_M', period_type: 'unknown' });
      expect(selectAuthoritativeFact(['revenue', 'arr', 'mrr'], [f])).toBeUndefined();
    });

    // Negative: valid labels must NOT be flagged as column-index artefacts
    test.each([
      ['current', 500_000],
      ['FY2024', 1_000_000],
      ['2026', 3_337_000],
      ['TTM', 800_000],
      ['September', 8_000],
    ] as const)('valid period_label=%s is NOT flagged as column-index', (label, value) => {
      const f = fact('revenue', value, { period_label: label });
      expect(isCorruptedFact(f).reason).not.toBe('invalid_column_index_period');
    });
  });
});

// ─── selectAuthoritativeFact: corrupted data rejection ───────────────────────

describe('selectAuthoritativeFact — corrupted data rejection', () => {
  test('rejects year-header-corrupted fact when clean alternative exists', () => {
    const corrupted = fact('revenue', 2026, { period_label: 'FY2026', confidence: 'high', source_kind: 'xlsx' });
    const clean = fact('revenue', 3_337_000, { period_label: 'FY2026', confidence: 'medium', source_kind: 'xlsx' });
    const result = selectAuthoritativeFact('revenue', [corrupted, clean]);
    expect(result).toBeDefined();
    expect(result!.value).toBe(3_337_000);
  });

  test('returns undefined when all facts are corrupted', () => {
    const f1 = fact('revenue', 2026, { period_label: 'FY2026' });
    const f2 = fact('revenue', 2027, { period_label: 'FY2027' });
    const result = selectAuthoritativeFact('revenue', [f1, f2]);
    expect(result).toBeUndefined();
  });

  test('rejects NaN-valued fact and uses clean alternative', () => {
    const bad = fact('revenue', NaN, { confidence: 'high' });
    const good = fact('revenue', 1_000_000, { confidence: 'low' });
    expect(selectAuthoritativeFact('revenue', [bad, good])?.value).toBe(1_000_000);
  });

  test('returns undefined when array is empty', () => {
    expect(selectAuthoritativeFact('revenue', [])).toBeUndefined();
  });

  test('returns undefined when metric_key does not match any fact', () => {
    const f = fact('burn_rate', 50_000);
    expect(selectAuthoritativeFact('revenue', [f])).toBeUndefined();
  });
});

// ─── selectAuthoritativeFact: projected vs historical precedence ──────────────

describe('selectAuthoritativeFact — projected vs historical precedence', () => {
  test('prefers historical/current fact over projected when requireNonProjected', () => {
    const historical = fact('revenue', 500_000, { period_label: 'current', temporal_scope: 'current' });
    const projected = projFact('revenue', 5_000_000, 2028);
    const result = selectAuthoritativeFact('revenue', [projected, historical], { requireNonProjected: true });
    expect(result?.value).toBe(500_000);
  });

  test('prefers historical fact over projected even without explicit requireNonProjected', () => {
    // Historical fact should always outrank projected by temporal preference tier.
    const current = fact('revenue', 800_000, { period_label: 'current', temporal_scope: 'current', confidence: 'medium', source_kind: 'deck' });
    const projected = fact('revenue', 5_000_000, { period_label: 'FY2028', temporal_scope: 'projected', confidence: 'high', source_kind: 'xlsx' });
    const result = selectAuthoritativeFact('revenue', [projected, current]);
    // Historical wins despite lower confidence / lower source_kind score.
    expect(result?.value).toBe(800_000);
  });

  test('returns projected fact when requireProjected is set and no historical exists', () => {
    const projected = projFact('revenue', 5_000_000, 2028);
    const result = selectAuthoritativeFact('revenue', [projected], { requireProjected: true });
    expect(result?.value).toBe(5_000_000);
  });

  test('returns undefined when requireNonProjected and only projected facts exist', () => {
    const f = projFact('revenue', 5_000_000, 2028);
    expect(selectAuthoritativeFact('revenue', [f], { requireNonProjected: true })).toBeUndefined();
  });

  test('returns undefined when requireProjected and only historical facts exist', () => {
    const f = fact('revenue', 500_000);
    expect(selectAuthoritativeFact('revenue', [f], { requireProjected: true })).toBeUndefined();
  });

  test('future year in period_label is treated as projected even without temporal_scope', () => {
    const futureYear = new Date().getFullYear() + 2;
    const f = fact('revenue', 5_000_000, { period_label: `FY${futureYear}` });
    // Without requireNonProjected filter, it's included but ranked below a current-state fact.
    const current = fact('revenue', 100, { period_label: 'current' });
    const result = selectAuthoritativeFact('revenue', [f, current]);
    expect(result?.value).toBe(100);
  });

  test('year-corrupted projected fact is still rejected', () => {
    // value == year in period_label AND is a future year
    const futureYear = new Date().getFullYear() + 1;
    const corrupted = fact('revenue', futureYear, { period_label: `FY${futureYear}`, temporal_scope: 'projected' });
    const clean = fact('revenue', 200_000, { period_label: 'current', temporal_scope: 'current', confidence: 'low' });
    const result = selectAuthoritativeFact('revenue', [corrupted, clean]);
    expect(result?.value).toBe(200_000);
  });
});

// ─── selectAuthoritativeFact: source-kind priority (xlsx > deck) ──────────────

describe('selectAuthoritativeFact — source-kind hierarchy', () => {
  test('xlsx fact wins over deck fact of same metric and period', () => {
    const deck = deckFact('revenue', 1_000_000, { confidence: 'high' });
    const xlsx = fact('revenue', 2_739_000, { source_kind: 'xlsx', confidence: 'high' });
    expect(selectAuthoritativeFact('revenue', [deck, xlsx])?.source_kind).toBe('xlsx');
  });

  test('xlsx low confidence wins over deck high confidence', () => {
    const deck = deckFact('revenue', 1_000_000, { confidence: 'high' });
    const xlsx = fact('revenue', 2_739_000, { source_kind: 'xlsx', confidence: 'low' });
    expect(selectAuthoritativeFact('revenue', [deck, xlsx])?.source_kind).toBe('xlsx');
  });

  test('pdf_table ranks above deck but below xlsx', () => {
    const pdf = fact('revenue', 900_000, { source_kind: 'pdf_table', confidence: 'high' });
    const deck = deckFact('revenue', 1_000_000, { confidence: 'high' });
    const xlsx = fact('revenue', 800_000, { source_kind: 'xlsx', confidence: 'high' });
    // xlsx wins over all
    expect(selectAuthoritativeFact('revenue', [deck, pdf, xlsx])?.source_kind).toBe('xlsx');
    // pdf wins over deck
    expect(selectAuthoritativeFact('revenue', [deck, pdf])?.source_kind).toBe('pdf_table');
  });

  test('accepts array of metric keys and picks best from all', () => {
    const arrFact = fact('arr', 1_200_000, { source_kind: 'deck', confidence: 'high' });
    const revFact = fact('revenue', 2_000_000, { source_kind: 'xlsx', confidence: 'medium' });
    const result = selectAuthoritativeFact(['revenue', 'arr', 'mrr'], [arrFact, revFact]);
    // xlsx revenue wins over deck arr despite lower confidence
    expect(result?.metric_key).toBe('revenue');
    expect(result?.value).toBe(2_000_000);
  });
});

// ─── selectAuthoritativeFact: cross-source reconciliation ─────────────────────

describe('selectAuthoritativeFact — cross-source reconciliation status', () => {
  test('supported fact ranks above unresolved fact of same source kind', () => {
    const supported = fact('revenue', 2_000_000, { source_kind: 'xlsx', confidence: 'medium', cross_source_status: 'supported' });
    const unresolved = fact('revenue', 3_000_000, { source_kind: 'xlsx', confidence: 'high', cross_source_status: 'unresolved' });
    // supported + medium confidence vs unresolved + high confidence
    // supported bonus: +2 × 10 = +20 vs unresolved 0 — confidence diff: high=3 vs medium=2 → +4
    // net: supported wins (20 > 4)
    const result = selectAuthoritativeFact('revenue', [supported, unresolved]);
    expect(result?.cross_source_status).toBe('supported');
  });

  test('conflicting deck fact ranks below workbook_only xlsx fact', () => {
    const conflictDeck = deckFact('revenue', 500_000, { confidence: 'high', cross_source_status: 'conflicting' });
    const workbookOnly = fact('revenue', 2_739_000, { source_kind: 'xlsx', confidence: 'medium', cross_source_status: 'workbook_only' });
    // xlsx + workbook_only should beat deck + conflicting regardless of confidence
    const result = selectAuthoritativeFact('revenue', [conflictDeck, workbookOnly]);
    expect(result?.source_kind).toBe('xlsx');
    expect(result?.value).toBe(2_739_000);
  });

  test('fact without cross_source_status does not error', () => {
    const f = fact('revenue', 1_000_000, { cross_source_status: undefined });
    expect(() => selectAuthoritativeFact('revenue', [f])).not.toThrow();
    expect(selectAuthoritativeFact('revenue', [f])?.value).toBe(1_000_000);
  });
});

// ─── selectAuthoritativeFact: confidence tiebreaker ──────────────────────────

describe('selectAuthoritativeFact — confidence tiebreaker', () => {
  test('high confidence wins over medium, same source kind and scope', () => {
    const hi = fact('burn_rate', 50_000, { source_kind: 'xlsx', confidence: 'high' });
    const med = fact('burn_rate', 60_000, { source_kind: 'xlsx', confidence: 'medium' });
    expect(selectAuthoritativeFact('burn_rate', [med, hi])?.value).toBe(50_000);
  });

  test('medium confidence wins over low, same source kind', () => {
    const med = fact('cash', 400_000, { confidence: 'medium' });
    const low = fact('cash', 200_000, { confidence: 'low' });
    expect(selectAuthoritativeFact('cash', [low, med])?.confidence).toBe('medium');
  });
});

// ─── selectAuthoritativeFact: selector consistency ───────────────────────────

describe('selectAuthoritativeFact — selector consistency', () => {
  test('same winner regardless of input array order', () => {
    const a = fact('revenue', 2_739_000, { source_kind: 'xlsx', confidence: 'high' });
    const b = deckFact('revenue', 1_000_000, { confidence: 'high' });
    const c = fact('revenue', 500_000, { source_kind: 'xlsx', confidence: 'low' });

    const order1 = selectAuthoritativeFact('revenue', [a, b, c]);
    const order2 = selectAuthoritativeFact('revenue', [c, b, a]);
    const order3 = selectAuthoritativeFact('revenue', [b, c, a]);

    expect(order1?.fact_id).toBe(order2?.fact_id);
    expect(order1?.fact_id).toBe(order3?.fact_id);
  });

  test('financial_breakdown_v1 and structured_summary would resolve to same winner', () => {
    // Simulate the scenario where the breakdown and the structured summary
    // both pick from the same pool. They should agree.
    const xlsxRevenue = fact('revenue', 3_337_000, { source_kind: 'xlsx', period_label: 'FY2026', confidence: 'high' });
    const deckRevenue = deckFact('revenue', 3_000_000, { period_label: 'FY2026', confidence: 'high' });
    const yearCorrupted = fact('revenue', 2026, { period_label: 'FY2026', source_kind: 'xlsx', confidence: 'high' });

    const pool = [yearCorrupted, xlsxRevenue, deckRevenue];

    // Breakdown uses requireNonProjected for current_state.revenue
    const breakdownRevenue = selectAuthoritativeFact(['revenue', 'arr', 'mrr'], pool, { requireNonProjected: true });
    // structured_summary uses selectAuthoritativeFact on xlsx-filtered pool, requireNonProjected first
    const xlsxPool = pool.filter(f => f.source_kind === 'xlsx');
    const summaryRevenue = selectAuthoritativeFact(['revenue', 'arr', 'mrr'], xlsxPool, { requireNonProjected: true })
      ?? selectAuthoritativeFact(['revenue', 'arr', 'mrr'], xlsxPool);

    // Both should select the clean xlsx revenue, not deck and not year-corrupted
    expect(breakdownRevenue?.value).toBe(3_337_000);
    expect(summaryRevenue?.value).toBe(3_337_000);
    // They agree
    expect(breakdownRevenue?.fact_id).toBe(summaryRevenue?.fact_id);
  });
});

// ─── filterCorruptedFacts ─────────────────────────────────────────────────────

describe('filterCorruptedFacts', () => {
  test('removes year-equals-value corrupted facts', () => {
    const good = fact('revenue', 2_739_000);
    const bad = fact('revenue', 2026, { period_label: 'FY2026' });
    const result = filterCorruptedFacts([good, bad]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(2_739_000);
  });

  test('removes NaN facts', () => {
    const good = fact('burn_rate', 50_000);
    const bad = fact('burn_rate', NaN);
    const result = filterCorruptedFacts([good, bad]);
    expect(result).toHaveLength(1);
  });

  test('returns empty array when all facts are corrupted', () => {
    const f1 = fact('revenue', 2025, { period_label: '2025' });
    const f2 = fact('revenue', 2026, { period_label: 'FY2026' });
    expect(filterCorruptedFacts([f1, f2])).toHaveLength(0);
  });

  test('returns all facts when none are corrupted', () => {
    const facts = [
      fact('revenue', 500_000),
      fact('burn_rate', 30_000),
      fact('cash', 1_000_000),
    ];
    expect(filterCorruptedFacts(facts)).toHaveLength(3);
  });

  test('preserves fact references (no deep copies)', () => {
    const f = fact('revenue', 500_000);
    const result = filterCorruptedFacts([f]);
    expect(result[0]).toBe(f);
  });
});

// ─── isProjectedFact (re-exported from selector) ─────────────────────────────

describe('isProjectedFact', () => {
  test('fact with temporal_scope=projected is projected', () => {
    const f = fact('revenue', 5_000_000, { temporal_scope: 'projected' });
    expect(isProjectedFact(f)).toBe(true);
  });

  test('fact with temporal_scope=scenario is projected', () => {
    const f = fact('revenue', 5_000_000, { temporal_scope: 'scenario' });
    expect(isProjectedFact(f)).toBe(true);
  });

  test('fact with temporal_scope=target is projected', () => {
    const f = fact('revenue', 5_000_000, { temporal_scope: 'target' });
    expect(isProjectedFact(f)).toBe(true);
  });

  test('fact with future year in period_label is projected', () => {
    const futureYear = new Date().getFullYear() + 1;
    const f = fact('revenue', 5_000_000, { period_label: `FY${futureYear}` });
    expect(isProjectedFact(f)).toBe(true);
  });

  test('fact with current period_label is not projected', () => {
    const f = fact('revenue', 500_000, { period_label: 'current' });
    expect(isProjectedFact(f)).toBe(false);
  });

  test('fact with past year in period_label is not projected', () => {
    const f = fact('revenue', 500_000, { period_label: 'FY2023' });
    expect(isProjectedFact(f)).toBe(false);
  });

  test('ordinal Year N label ("Year 12") is projected even without temporal_scope', () => {
    const f = fact('burn_rate', 484_333, { period_label: 'Year 12' });
    expect(isProjectedFact(f)).toBe(true);
  });

  test('ordinal Year 1 label is projected', () => {
    const f = fact('burn_rate', 100_000, { period_label: 'Year 1' });
    expect(isProjectedFact(f)).toBe(true);
  });

  test('ordinal Year N labels are projected for n = 1..15', () => {
    for (const n of [1, 2, 3, 5, 8, 10, 12, 15]) {
      const f = fact('burn_rate', 100_000, { period_label: `Year ${n}` });
      expect(isProjectedFact(f)).toBe(true);
    }
  });

  test('"Year 12" burn_rate with no temporal_scope is filtered by requireNonProjected', () => {
    // Simulates the StackFactor orphan fact: burn_rate=484333, period_label="Year 12", no temporal_scope
    const orphanBurn = fact('burn_rate', 484_333, { period_label: 'Year 12', source_kind: 'unknown' });
    const historicalBurn = fact('burn_rate', 200_000, { period_label: 'FY2024', temporal_scope: 'historical' });
    const result = selectAuthoritativeFact(['burn_rate'], [orphanBurn, historicalBurn], { requireNonProjected: true });
    // Orphan Year 12 must be excluded; historical FY2024 must win
    expect(result?.value).toBe(200_000);
    expect(result?.period_label).toBe('FY2024');
  });

  test('non-Year-N labels like "Jan 2024" or "Q1 2024" are not projected', () => {
    const jan = fact('burn_rate', 100_000, { period_label: 'Jan 2024' });
    const q1  = fact('burn_rate', 100_000, { period_label: 'Q1 2024' });
    const fy  = fact('burn_rate', 100_000, { period_label: 'FY2024' });
    expect(isProjectedFact(jan)).toBe(false);
    expect(isProjectedFact(q1)).toBe(false);
    expect(isProjectedFact(fy)).toBe(false);
  });
});
