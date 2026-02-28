/**
 * MarketAnalysisCard.test.tsx — AI Analysis Tab component tests
 *
 * Tests the MarketAnalysisCard component end-to-end through the full
 * React render tree using mocked API calls.
 *
 * Contract guarantees:
 *  1.  Loading skeleton renders whilst hook is pending
 *  2.  KPIs (tailwind, launch_plan, priority_markets) render after data resolves
 *  3.  Strengths items render in the bullets section
 *  4.  Concerns items render in the bullets section
 *  5.  AI insight body text renders inside its panel
 *  6.  Score bar renders with correct value
 *  7.  Dark mode: ai_insight uses text-zinc-100 class
 *  8.  Dark mode: KPI value uses text-zinc-100 class (not text-gray-200 / black-on-black)
 *  9.  priority_markets "Not disclosed" when only TAM present
 * 10.  Regenerate button triggers a re-call to apiPostMarketAnalysis
 * 11.  Raw pipe-delimited canonical rows do NOT appear in the default DOM
 * 12.  no_data state message appears when all market fields are null
 * 13.  Error state shows retry button and error message
 * 14.  Retry button re-invokes the API call
 * 15.  Standalone mode (embedded=false) renders "Market Analysis" h3 heading
 * 16.  Embedded mode (embedded=true) renders no h3 heading
 * 17.  Missing inputs toggle reveals the missing signals list
 * 18.  Strengths column and Concerns column both appear in the bullets section
 */
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { MarketAnalysisCard } from '../components/workspace/MarketAnalysisCard';
import type { MarketAnalysisResult, InvestorInsightsReport } from '../lib/apiClient';

beforeEach(() => vi.resetAllMocks());

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiPostMarketAnalysis: vi.fn(),
    apiPostDealTermsAnalysis: vi.fn(),
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CANONICAL_BODY = [
  'category=market | field=tam | computability=Computable | value="$5B" | evidence=none | reason=none',
  'category=market | field=sam | computability=Computable | value="$500M" | evidence=none | reason=none',
  'category=market | field=som | computability=Computable | value="$50M" | evidence=none | reason=none',
  'category=growth | field=growth_rate | computability=Computable | value="25% YoY" | evidence=none | reason=none',
  'category=customer | field=customer_count | computability=Computable | value="42 agencies" | evidence=none | reason=none',
  'category=market | field=market_geography | computability=Computable | value="North America" | evidence=none | reason=none',
].join('\n');

const TAM_ONLY_BODY =
  'category=market | field=tam | computability=Computable | value="$5B" | evidence=none | reason=none';

function buildReport(body = CANONICAL_BODY, omit = false): InvestorInsightsReport {
  return {
    status: 'deterministic_only',
    render_package: {
      sections: omit
        ? []
        : [{ key: 'canonical_fields', title: 'Canonical Fields', kind: 'message', body }],
    },
  } as InvestorInsightsReport;
}

const MOCK_RESULT: MarketAnalysisResult = {
  schema_version: 'market_analysis_v1',
  score: 72,
  kpis: {
    tailwind: 'Strong — 25% YoY sector growth',
    launch_plan: 'ICP defined — SMB marketing teams',
    priority_markets: 'US / SMB segment',
  },
  strengths: [
    'Clear TAM/SAM/SOM sizing at $5B / $500M / $50M',
    '25% YoY growth signals expanding market',
  ],
  concerns: [
    'Competitive landscape includes well-funded incumbents',
    'SOM capture depends on differentiation not yet detailed',
  ],
  ai_insight:
    'Materials indicate a $500M SAM within a $5B TAM for the North American market. ' +
    'Growth rate of 25% YoY and early traction of 42 agency customers supports entry viability.',
  missing_inputs: ['Pricing model', 'ICP detail'],
};

async function renderAndWait(
  dealId = 'adb2a1cf-0000-0000-0000-000000000099',
  report = buildReport(),
  darkMode = false,
  embedded = false,
) {
  const { apiPostMarketAnalysis } = await import('../lib/apiClient');
  (apiPostMarketAnalysis as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_RESULT);

  render(
    <MarketAnalysisCard
      dealId={dealId}
      report={report}
      darkMode={darkMode}
      embedded={embedded}
    />,
  );
  await screen.findByTestId('market-analysis-card');
  return { apiPostMarketAnalysis: apiPostMarketAnalysis as ReturnType<typeof vi.fn> };
}

// ─── 1. Loading skeleton ──────────────────────────────────────────────────────

describe('1 — Loading skeleton', () => {
  test('loading skeleton is shown while API is pending', async () => {
    const { apiPostMarketAnalysis } = await import('../lib/apiClient');
    (apiPostMarketAnalysis as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<never>(() => {}),
    );

    render(
      <MarketAnalysisCard dealId="test-deal-1" report={buildReport()} darkMode={false} embedded />,
    );
    expect(screen.getByTestId('market-loading-skeleton')).toBeInTheDocument();
  });
});

// ─── 2. KPIs render after data resolves ──────────────────────────────────────

describe('2 — KPI tiles', () => {
  test('tailwind KPI value is visible', async () => {
    await renderAndWait();
    expect(screen.getByText('Strong — 25% YoY sector growth')).toBeInTheDocument();
  });

  test('launch_plan KPI value is visible', async () => {
    await renderAndWait();
    expect(screen.getByText('ICP defined — SMB marketing teams')).toBeInTheDocument();
  });

  test('priority_markets KPI value is visible', async () => {
    await renderAndWait();
    expect(screen.getByText('US / SMB segment')).toBeInTheDocument();
  });

  test('all three KPI tile labels render', async () => {
    await renderAndWait();
    expect(screen.getByText('Market Tailwind')).toBeInTheDocument();
    expect(screen.getByText('Launch Plan')).toBeInTheDocument();
    expect(screen.getByText('Priority Markets')).toBeInTheDocument();
  });
});

// ─── 3 & 4. Strengths and concerns ───────────────────────────────────────────

describe('3 & 4 — Strengths and Concerns bullet columns', () => {
  test('strengths items render', async () => {
    await renderAndWait();
    const strengthItems = screen.getAllByTestId('market-strength-item');
    expect(strengthItems.length).toBeGreaterThanOrEqual(1);
    expect(strengthItems[0]).toHaveTextContent('Clear TAM/SAM/SOM sizing');
  });

  test('concerns items render', async () => {
    await renderAndWait();
    const concernItems = screen.getAllByTestId('market-concern-item');
    expect(concernItems.length).toBeGreaterThanOrEqual(1);
    expect(concernItems[0]).toHaveTextContent('Competitive landscape');
  });

  test('strengths and concerns columns both appear in bullets section', async () => {
    await renderAndWait();
    const bulletsSection = screen.getByTestId('market-bullets-section');
    expect(within(bulletsSection).getByText('Strengths')).toBeInTheDocument();
    expect(within(bulletsSection).getByText('Concerns')).toBeInTheDocument();
  });
});

// ─── 5. AI Insight ────────────────────────────────────────────────────────────

describe('5 — AI Insight panel', () => {
  test('AI insight text is rendered inside the insight panel', async () => {
    await renderAndWait();
    const insightPanel = screen.getByTestId('market-ai-insight');
    expect(insightPanel).toBeInTheDocument();
    const insightText = screen.getByTestId('market-ai-insight-text');
    expect(insightText).toHaveTextContent('Materials indicate a $500M SAM');
  });
});

// ─── 6. Score bar ─────────────────────────────────────────────────────────────

describe('6 — Score bar', () => {
  test('score bar renders with score value', async () => {
    await renderAndWait();
    const scoreBar = screen.getByTestId('market-score-bar');
    expect(scoreBar).toBeInTheDocument();
    expect(scoreBar).toHaveTextContent('72/100');
  });
});

// ─── 7 & 8. Dark mode readable text ──────────────────────────────────────────

describe('7 & 8 — Dark mode text classes (no black-on-black)', () => {
  test('AI insight text has text-zinc-100 class in dark mode', async () => {
    await renderAndWait('test-deal-dark', buildReport(), true);
    const insightText = screen.getByTestId('market-ai-insight-text');
    expect(insightText.className).toContain('text-zinc-100');
    expect(insightText.className).not.toContain('text-gray-800');
    expect(insightText.className).not.toContain('text-black');
  });

  test('KPI values have text-zinc-100 class in dark mode', async () => {
    await renderAndWait('test-deal-dark2', buildReport(), true);
    const kpiValues = screen.getAllByTestId('market-kpi-value');
    // The non-missing KPI values should have text-zinc-100
    const nonMissingValues = kpiValues.filter(
      (el) => !el.className.includes('text-zinc-500'),
    );
    expect(nonMissingValues.length).toBeGreaterThan(0);
    nonMissingValues.forEach((el) => {
      expect(el.className).toContain('text-zinc-100');
    });
  });
});

// ─── 9. "Not disclosed" when data is missing ─────────────────────────────────

describe('9 — Missing inputs / Not disclosed', () => {
  test('priority_markets shows "Not disclosed" when only TAM present', async () => {
    const { apiPostMarketAnalysis } = await import('../lib/apiClient');
    (apiPostMarketAnalysis as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...MOCK_RESULT,
      kpis: {
        tailwind: 'Insufficient data — TAM only',
        launch_plan: 'Pre-launch',
        priority_markets: 'Not disclosed',
      },
      score: 18,
      missing_inputs: ['SAM', 'SOM', 'Growth Rate'],
    });

    render(
      <MarketAnalysisCard
        dealId="test-deal-tam-only"
        report={buildReport(TAM_ONLY_BODY)}
        darkMode={false}
      />,
    );
    await screen.findByTestId('market-analysis-card');
    expect(screen.getByText('Not disclosed')).toBeInTheDocument();
  });
});

// ─── 10. Regenerate triggers API call ────────────────────────────────────────

describe('10 — Regenerate button', () => {
  test('clicking refresh button calls apiPostMarketAnalysis again', async () => {
    const { apiPostMarketAnalysis } = await renderAndWait();
    const callsBefore = apiPostMarketAnalysis.mock.calls.length;

    (apiPostMarketAnalysis as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_RESULT);
    const refreshBtn = screen.getByTestId('market-refresh-btn');
    await userEvent.click(refreshBtn);

    await waitFor(() => {
      expect(apiPostMarketAnalysis.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

// ─── 11. No raw pipe rows ─────────────────────────────────────────────────────

describe('11 — No raw pipe-delimited canonical rows', () => {
  test('raw pipe canonical rows are not shown in the default DOM', async () => {
    await renderAndWait();
    expect(screen.queryByText(/category=market/)).not.toBeInTheDocument();
    expect(screen.queryByText(/category=growth/)).not.toBeInTheDocument();
    expect(screen.queryByText(/computability=Computable/)).not.toBeInTheDocument();
  });
});

// ─── 12. No-data state ────────────────────────────────────────────────────────

describe('12 — No-data state', () => {
  test('no-data message shown when all market fields are null', async () => {
    const { apiPostMarketAnalysis } = await import('../lib/apiClient');
    // Hook will hit no_data path — API should NOT be called
    render(
      <MarketAnalysisCard
        dealId="test-deal-nodata"
        report={buildReport('', true)}   // omit canonical section entirely
        darkMode={false}
      />,
    );
    await screen.findByTestId('market-no-data');
    expect(screen.getByTestId('market-no-data')).toHaveTextContent(
      'No market signals found',
    );
    // API must NOT have been called for no_data
    expect(apiPostMarketAnalysis).not.toHaveBeenCalled();
  });
});

// ─── 13 & 14. Error state + retry ────────────────────────────────────────────

describe('13 & 14 — Error state and retry', () => {
  test('error state shows retry button and error message', async () => {
    const { apiPostMarketAnalysis } = await import('../lib/apiClient');
    (apiPostMarketAnalysis as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('LLM service unavailable'),
    );

    render(
      <MarketAnalysisCard dealId="test-deal-err" report={buildReport()} darkMode={false} />,
    );
    await screen.findByTestId('market-retry-btn');
    expect(screen.getByTestId('market-retry-btn')).toBeInTheDocument();
    expect(screen.getByText(/LLM service unavailable/)).toBeInTheDocument();
  });

  test('retry button re-invokes the API', async () => {
    const { apiPostMarketAnalysis } = await import('../lib/apiClient');
    (apiPostMarketAnalysis as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce(MOCK_RESULT);

    render(
      <MarketAnalysisCard dealId="test-deal-retry" report={buildReport()} darkMode={false} />,
    );
    await screen.findByTestId('market-retry-btn');

    fireEvent.click(screen.getByTestId('market-retry-btn'));
    await screen.findByTestId('market-analysis-card');
    expect(apiPostMarketAnalysis).toHaveBeenCalledTimes(2);
  });
});

// ─── 15 & 16. Standalone vs embedded heading ──────────────────────────────────

describe('15 & 16 — Standalone vs embedded mode headings', () => {
  test('standalone mode (embedded=false) renders "Market Analysis" h3 heading', async () => {
    await renderAndWait('test-deal-sa', buildReport(), false, false);
    const heading = screen.queryByRole('heading', { name: /Market Analysis/i });
    expect(heading).toBeInTheDocument();
  });

  test('embedded mode (embedded=true) does not render h3 heading', async () => {
    await renderAndWait('test-deal-emb', buildReport(), false, true);
    const heading = screen.queryByRole('heading', { name: /Market Analysis/i });
    expect(heading).not.toBeInTheDocument();
  });
});

// ─── 17. Missing inputs toggle ────────────────────────────────────────────────

describe('17 — Missing inputs disclosure toggle', () => {
  test('clicking the toggle reveals missing signal labels', async () => {
    await renderAndWait();
    const toggle = screen.getByTestId('market-missing-toggle');
    expect(toggle).toBeInTheDocument();

    await userEvent.click(toggle);
    const missingPanel = await screen.findByTestId('market-missing-inputs');
    expect(missingPanel).toBeInTheDocument();
    // MOCK_RESULT has missing_inputs: ['Pricing model', 'ICP detail']
    expect(missingPanel).toHaveTextContent('Pricing model');
    expect(missingPanel).toHaveTextContent('ICP detail');
  });
});

// ─── 18. "AI Governed" badge always visible ───────────────────────────────────

describe('18 — AI Governed badge', () => {
  test('"AI Governed" badge rendered on the market card', async () => {
    await renderAndWait();
    const badges = screen.getAllByText('AI Governed');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});
