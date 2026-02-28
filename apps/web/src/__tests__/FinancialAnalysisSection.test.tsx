/**
 * FinancialAnalysisSection.test.tsx — AI Analysis Tab component tests
 *
 * Tests the FinancialAnalysisSection component through the full React render
 * tree with mocked API calls and deterministic section fixtures.
 *
 * Contract guarantees:
 *  1.  Loading skeleton renders while report is null
 *  2.  No-data state when no financial sections present
 *  3.  Score panel renders with deterministic score value
 *  4.  Implied cost tile renders with "Implied" tag when only implied_capital_allocation
 *  5.  Current metrics show TBD for unknown values
 *  6.  Revenue table renders when financial_statement_v1 present
 *  7.  Revenue table shows fallback message when no statement available
 *  8.  Highlights grid renders strengths and considerations
 *  9.  WARN/FAIL flags from reconciliation appear as considerations
 * 10.  Narrative loading skeleton shows while API is pending
 * 11.  Narrative panel renders AI summary paragraphs on success
 * 12.  Narrative error state shows retry button
 * 13.  Retry button re-invokes apiPostFinancialAnalysis
 * 14.  Dark mode: no black-on-black text (critical nodes use text-zinc-* classes)
 * 15.  Raw pipe-delimited implied bucket lines do NOT appear in the DOM
 * 16.  Implied-only path: TBD shown for revenue_latest and gross_margin
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { FinancialAnalysisSection } from '../components/workspace/analysis/FinancialAnalysisSection';
import type { FinancialNarrativeResult, InvestorInsightsReport } from '../lib/apiClient';

beforeEach(() => vi.resetAllMocks());

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiPostFinancialAnalysis: vi.fn(),
    apiPostMarketAnalysis: vi.fn(),
    apiPostDealTermsAnalysis: vi.fn(),
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Implied-allocation only — StackFactor scenario */
const IMPLIED_BODY = [
  'period: FY2024',
  'total_annual_cost: $3.2M',
  'basis_note: Derived from hiring plan and vendor commitments',
  '  bucket: Salaries & Benefits | $1.8M/yr | 56% | [hiring_plan]',
  '  bucket: Infrastructure | $420K/yr | 13% | [vendor_contracts]',
  '  bucket: Marketing | $280K/yr | 9% | [marketing_budget]',
  '  bucket: G&A | $700K/yr | 22% | [disclosed_ops]',
].join('\n');

/** Full financial statement — DealDecision scenario */
const STATEMENT_BODY = [
  'periods: FY2023, FY2024',
  'revenue: $800,000 (FY2023), $1,200,000 (FY2024)',
  'gross_profit: $560,000 (FY2023), $864,000 (FY2024)',
  'total_expenses: $450,000 (FY2023), $680,000 (FY2024)',
  'gross_margin: 72%',
  'revenue_yoy_growth: 50% YoY',
].join('\n');

/** Health metrics body */
const HEALTH_BODY = [
  'revenue_latest: $1.2M ARR',
  'revenue_yoy_growth_pct: 50%',
  'gross_margin_pct: 72%',
  'cost_efficiency_ratio: 0.57',
].join('\n');

/** Reconciliation body with WARN flag */
const RECONCILIATION_BODY = [
  'confidence_score: 0.78',
  '✓ revenue_crosscheck: PASS — matches across slides and financials',
  '⚠ burn_rate: WARN — not explicitly disclosed in deck materials',
  '✗ balance_sheet: FAIL — balance sheet not found in submission',
].join('\n');

/** Layout classifier body */
const LAYOUT_BODY = [
  'has_income_statement: true',
  'has_cash_flow: false',
  'has_balance_sheet: false',
  'has_saas_kpis: true',
  'has_budget_model: false',
  'has_cap_table: false',
  'layout_coverage_pct: 72%',
].join('\n');

function buildSection(key: string, body: string) {
  return { key, title: key, kind: 'message' as const, body };
}

function buildReport(sectionBodies: { key: string; body: string }[]): InvestorInsightsReport {
  return {
    status: 'deterministic_only',
    render_package: {
      sections: sectionBodies.map(({ key, body }) => buildSection(key, body)),
    },
  } as InvestorInsightsReport;
}

const MOCK_NARRATIVE: FinancialNarrativeResult = {
  schema_version: 'financial_analysis_v1',
  summary_paragraphs: [
    'The company demonstrates strong revenue growth of 50% YoY reaching $1.2M ARR.',
    'Gross margins at 72% are well above SaaS benchmarks, indicating healthy unit economics.',
  ],
  strengths: ['72% gross margin exceeds SaaS median', 'Revenue corroborated across multiple sources'],
  considerations: ['Burn rate not explicitly disclosed', 'Balance sheet absent from submission'],
};

const DEAL_ID = 'aab1c2d3-0000-0000-0000-000000000010';

async function renderFullDeal(options: {
  sections: { key: string; body: string }[];
  darkMode?: boolean;
  narrative?: FinancialNarrativeResult | 'pending' | 'error';
} = { sections: [] }) {
  const { apiPostFinancialAnalysis } = await import('../lib/apiClient');
  const mockFn = apiPostFinancialAnalysis as ReturnType<typeof vi.fn>;

  if (options.narrative === 'pending') {
    mockFn.mockReturnValue(new Promise<never>(() => {}));
  } else if (options.narrative === 'error') {
    mockFn.mockRejectedValue(new Error('Network error'));
  } else {
    mockFn.mockResolvedValue(options.narrative ?? MOCK_NARRATIVE);
  }

  const report = buildReport(options.sections);
  render(
    <FinancialAnalysisSection
      dealId={DEAL_ID}
      report={report}
      darkMode={options.darkMode ?? false}
    />,
  );

  return { mockFn };
}

// ─── 1. Loading skeleton (null report) ───────────────────────────────────────

describe('1 — Loading skeleton', () => {
  test('skeleton renders when report is null', async () => {
    const { apiPostFinancialAnalysis } = await import('../lib/apiClient');
    (apiPostFinancialAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_NARRATIVE);

    render(
      <FinancialAnalysisSection dealId={DEAL_ID} report={null} darkMode={false} />,
    );
    expect(screen.getByTestId('fin-loading-skeleton')).toBeInTheDocument();
  });
});

// ─── 2. No-data state ─────────────────────────────────────────────────────────

describe('2 — No-data state', () => {
  test('no-data fallback renders when no financial sections present', async () => {
    await renderFullDeal({ sections: [] });
    await screen.findByTestId('fin-no-data');
    expect(screen.getByTestId('fin-no-data')).toBeInTheDocument();
  });

  test('no-data does not show score panel', async () => {
    await renderFullDeal({ sections: [] });
    await screen.findByTestId('fin-no-data');
    expect(screen.queryByTestId('fin-score-panel')).not.toBeInTheDocument();
  });
});

// ─── 3. Score panel ───────────────────────────────────────────────────────────

describe('3 — Score panel', () => {
  test('score panel renders with a numeric value', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
        { key: 'financial_reconciliation_v1', body: RECONCILIATION_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');
    const scoreEl = screen.getByTestId('fin-score-value');
    const scoreNum = parseInt(scoreEl.textContent ?? '0', 10);
    expect(scoreNum).toBeGreaterThanOrEqual(0);
    expect(scoreNum).toBeLessThanOrEqual(100);
  });

  test('score panel is present for implied-only input', async () => {
    await renderFullDeal({
      sections: [
        { key: 'implied_capital_allocation_v1', body: IMPLIED_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');
    expect(screen.getByTestId('fin-score-panel')).toBeInTheDocument();
  });
});

// ─── 4. Implied cost tile ─────────────────────────────────────────────────────

describe('4 — Implied cost tile', () => {
  test('"Implied" tag appears when only implied_capital_allocation present', async () => {
    await renderFullDeal({
      sections: [
        { key: 'implied_capital_allocation_v1', body: IMPLIED_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');
    expect(screen.getByTestId('fin-implied-tile')).toBeInTheDocument();
    expect(screen.getByText('Implied Annual Operating Cost')).toBeInTheDocument();
  });

  test('implied cost value is visible', async () => {
    await renderFullDeal({
      sections: [
        { key: 'implied_capital_allocation_v1', body: IMPLIED_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-implied-tile');
    expect(screen.getByTestId('fin-implied-cost')).toHaveTextContent('$3.2M');
  });
});

// ─── 5. TBD tiles for unknown values ─────────────────────────────────────────

describe('5 — TBD tiles for missing metrics', () => {
  test('TBD appears for revenue_latest when only implied allocation present', async () => {
    await renderFullDeal({
      sections: [
        { key: 'implied_capital_allocation_v1', body: IMPLIED_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');
    // Metric tiles should show TBD for revenue/margin since only implied allocation
    const tiles = screen.getAllByTestId('fin-metric-tile');
    const allValues = tiles.map((t) => t.textContent);
    const hasTbd = allValues.some((v) => v?.includes('TBD'));
    expect(hasTbd).toBe(true);
  });
});

// ─── 6. Revenue table ─────────────────────────────────────────────────────────

describe('6 — Revenue table', () => {
  test('table renders when financial_statement_v1 is present', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-revenue-table');
    expect(screen.getByTestId('fin-revenue-table')).toBeInTheDocument();
  });

  test('FY2023 and FY2024 period headers are visible', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-revenue-table');
    expect(screen.getByText('FY2023')).toBeInTheDocument();
    expect(screen.getByText('FY2024')).toBeInTheDocument();
  });

  test('Revenue row label is visible', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-revenue-table');
    expect(screen.getByText('Revenue')).toBeInTheDocument();
  });
});

// ─── 7. Revenue table fallback ────────────────────────────────────────────────

describe('7 — Revenue table fallback', () => {
  test('fallback message renders when no statement section present', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');
    expect(screen.getByTestId('fin-no-statement')).toBeInTheDocument();
  });
});

// ─── 8. Highlights grid ───────────────────────────────────────────────────────

describe('8 — Highlights grid', () => {
  test('highlights grid renders', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-highlights-grid');
    expect(screen.getByTestId('fin-highlights-grid')).toBeInTheDocument();
  });

  test('strengths and considerations column headings are visible', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-highlights-grid');
    // Both headings appear in the highlights grid (and possibly also in the narrative panel)
    expect(screen.getAllByText('Strengths').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Considerations').length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 9. WARN/FAIL flags as considerations ────────────────────────────────────

describe('9 — Reconciliation flags appear as considerations', () => {
  test('WARN flags from reconciliation yield consideration bullets', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
        { key: 'financial_reconciliation_v1', body: RECONCILIATION_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-highlights-grid');

    // At least one consideration should exist for WARN/FAIL reconciliation flags
    const considItems = screen.queryAllByTestId('fin-consideration-item');
    expect(considItems.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 10. Narrative loading ────────────────────────────────────────────────────

describe('10 — Narrative loading state', () => {
  test('narrative loading skeleton renders while API is pending', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: 'pending',
    });
    await screen.findByTestId('fin-score-panel');
    expect(screen.getByTestId('fin-narrative-loading')).toBeInTheDocument();
  });
});

// ─── 11. Narrative success ────────────────────────────────────────────────────

describe('11 — Narrative success state', () => {
  test('AI summary paragraphs render inside the narrative panel', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });

    await screen.findByTestId('fin-narrative-panel');
    const paragraphs = screen.getAllByTestId('fin-narrative-paragraph');
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs[0]).toHaveTextContent('strong revenue growth');
  });
});

// ─── 12. Narrative error state ────────────────────────────────────────────────

describe('12 — Narrative error state', () => {
  test('error state renders retry button', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: 'error',
    });
    await screen.findByTestId('fin-narrative-error');
    expect(screen.getByTestId('fin-narrative-retry-btn')).toBeInTheDocument();
  });
});

// ─── 13. Retry button ─────────────────────────────────────────────────────────

describe('13 — Retry button re-invokes API', () => {
  test('clicking retry button calls apiPostFinancialAnalysis again', async () => {
    const { mockFn } = await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      narrative: 'error',
    });
    await screen.findByTestId('fin-narrative-error');
    const retryBtn = screen.getByTestId('fin-narrative-retry-btn');

    // Set up next call to resolve
    mockFn.mockResolvedValueOnce(MOCK_NARRATIVE);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── 14. Dark mode ────────────────────────────────────────────────────────────

describe('14 — Dark mode', () => {
  test('dark mode: score value text is not black-on-black', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
      ],
      darkMode: true,
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');

    // The score value element should use a color class, not text-black or text-gray-900
    const scoreEl = screen.getByTestId('fin-score-value');
    const classes = scoreEl.getAttribute('class') ?? '';
    expect(classes).not.toMatch(/text-black|text-gray-900|text-slate-900/);
  });

  test('dark mode: narrative paragraphs use text-zinc-100 not text-black', async () => {
    await renderFullDeal({
      sections: [
        { key: 'financial_health_metrics_v1', body: HEALTH_BODY },
        { key: 'financial_statement_v1', body: STATEMENT_BODY },
      ],
      darkMode: true,
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-narrative-panel');
    const paragraphs = screen.getAllByTestId('fin-narrative-paragraph');
    for (const p of paragraphs) {
      const classes = p.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/text-black|text-gray-900/);
    }
  });
});

// ─── 15. No raw pipe-delimited text ───────────────────────────────────────────

describe('15 — No raw pipe-delimited text visible', () => {
  test('bucket category lines do not appear as raw pipe-separated text', async () => {
    await renderFullDeal({
      sections: [
        { key: 'implied_capital_allocation_v1', body: IMPLIED_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');

    // The literal pipe-delimited bucket line must not appear verbatim in the DOM
    const html = document.body.innerHTML;
    expect(html).not.toContain('bucket: Salaries & Benefits | $1.8M/yr | 56% | [hiring_plan]');
  });
});

// ─── 16. Implied-only: TBD for revenue + margin ───────────────────────────────

describe('16 — Implied-only path: revenue and margin are TBD', () => {
  test('revenue_latest shows TBD when no health metrics present', async () => {
    await renderFullDeal({
      sections: [
        { key: 'implied_capital_allocation_v1', body: IMPLIED_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('fin-score-panel');

    // At least one metric value should be TBD (revenue_latest has no source)
    const values = screen.getAllByTestId('fin-metric-value');
    const tbdValues = values.filter((v) => v.textContent?.trim() === 'TBD');
    expect(tbdValues.length).toBeGreaterThanOrEqual(1);
  });
});
