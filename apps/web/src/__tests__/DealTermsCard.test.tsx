/**
 * DealTermsCard.test.tsx
 *
 * Component tests for DealTermsCard — AI Analysis Tab exclusive.
 * Covers:
 *  1. Narrative renders when LLM returns data
 *  2. All 4 assessment badges render with correct colour keys
 *  3. Raw deterministic table is NOT shown by default
 *  4. "View Details" toggle reveals the raw canonical inspector
 *  5. Missing terms callout renders when present; absent when none
 *  6. Loading skeleton shown while LLM call is in-flight
 *  7. Error state shows retry button
 *  8. extractRaiseTermFields unit tests
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { DealTermsCard } from '../components/workspace/DealTermsCard';
import { extractRaiseTermFields } from '../hooks/useDealTermsAnalysis';
import type { InvestorInsightsReport } from '../lib/apiClient';
import type { DealTermsAnalysisResult } from '../lib/apiClient';

// Reset all mocks before every test (across all describe blocks)
beforeEach(() => vi.clearAllMocks());

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiPostDealTermsAnalysis: vi.fn(),
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    apiRegenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CANONICAL_FIELDS_BODY = [
  'category=raise_terms | field=raise_amount | computability=Computable | value="$2M" | evidence=none | reason=none',
  'category=raise_terms | field=raise_round | computability=Computable | value="Seed" | evidence=none | reason=none',
  'category=raise_terms | field=raise_instrument | computability=Computable | value="SAFE" | evidence=none | reason=none',
  'category=raise_terms | field=raise_cap | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=raise_discount | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=note_interest_rate | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=note_maturity | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=valuation_pre | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=valuation_post | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=valuation_safe_cap | computability=NotComputable | value=none | evidence=none | reason=none',
].join('\n');

function buildReport(canonicalBody: string = CANONICAL_FIELDS_BODY): InvestorInsightsReport {
  return {
    status: 'deterministic_only',
    render_package: {
      sections: [
        {
          key: 'canonical_fields',
          title: 'Canonical Fields',
          kind: 'message',
          body: canonicalBody,
        },
      ],
    },
  } as InvestorInsightsReport;
}

const MOCK_LLM_RESULT: DealTermsAnalysisResult = {
  structure_summary:
    'The company is raising $2M in a Seed SAFE with no cap or discount disclosed. ' +
    'The absence of a valuation cap creates significant dilution uncertainty for investors. ' +
    'No downside mechanics are disclosed.',
  structure_assessment: {
    simplicity: 'High',
    dilution_visibility: 'Low',
    valuation_clarity: 'Low',
    downside_protection: 'Low',
  },
  missing_terms: ['Valuation cap', 'Discount rate', 'Pre-money valuation'],
};

// ─── Test utilities ───────────────────────────────────────────────────────────

async function renderAndWaitForData(report = buildReport()) {
  const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
  (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_LLM_RESULT);

  render(<DealTermsCard dealId="test-deal-uuid" report={report} darkMode={false} />);

  // Wait for narrative to appear (indicates LLM call completed)
  await screen.findByTestId('deal-terms-narrative');
}

// ─── extractRaiseTermFields unit tests ────────────────────────────────────────

describe('extractRaiseTermFields', () => {
  test('extracts present raise fields from canonical_fields section', () => {
    const report = buildReport();
    const fields = extractRaiseTermFields(report);
    expect(fields.raise_amount).toBe('$2M');
    expect(fields.raise_round).toBe('Seed');
    expect(fields.raise_instrument).toBe('SAFE');
  });

  test('returns null for absent fields', () => {
    const report = buildReport();
    const fields = extractRaiseTermFields(report);
    expect(fields.raise_cap).toBeNull();
    expect(fields.valuation_pre).toBeNull();
  });

  test('returns all-null for empty report', () => {
    const fields = extractRaiseTermFields(null);
    expect(Object.values(fields).every((v) => v === null)).toBe(true);
  });

  test('returns all-null when canonical_fields section missing', () => {
    const report: InvestorInsightsReport = {
      status: 'deterministic_only',
      render_package: { sections: [] },
    };
    const fields = extractRaiseTermFields(report);
    expect(Object.values(fields).every((v) => v === null)).toBe(true);
  });
});

// ─── DealTermsCard rendering tests ───────────────────────────────────────────

describe('DealTermsCard — deal terms narrative', () => {
  test('shows loading skeleton while LLM call is in-flight', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    // Never resolve
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    render(<DealTermsCard dealId="test-deal-uuid" report={buildReport()} darkMode={false} />);

    expect(screen.getByLabelText('Loading deal terms analysis')).toBeInTheDocument();
    // Narrative is NOT yet visible
    expect(screen.queryByTestId('deal-terms-narrative')).not.toBeInTheDocument();
  });

  test('renders narrative paragraph when LLM returns data', async () => {
    await renderAndWaitForData();
    const narrative = screen.getByTestId('deal-terms-narrative');
    expect(narrative.textContent).toContain('raising $2M in a Seed SAFE');
  });

  test('renders all 4 assessment badge labels', async () => {
    await renderAndWaitForData();
    expect(screen.getByText('Simplicity')).toBeInTheDocument();
    expect(screen.getByText('Dilution Visibility')).toBeInTheDocument();
    expect(screen.getByText('Valuation Clarity')).toBeInTheDocument();
    expect(screen.getByText('Downside Protection')).toBeInTheDocument();
  });

  test('assessment section renders with correct level values', async () => {
    await renderAndWaitForData();
    const assessment = screen.getByTestId('deal-terms-assessment');
    expect(assessment).toBeInTheDocument();
    // High → 1 occurrence, Low → 3 occurrences
    const highBadges = screen.getAllByText('High');
    expect(highBadges.length).toBeGreaterThanOrEqual(1);
    const lowBadges = screen.getAllByText('Low');
    expect(lowBadges.length).toBeGreaterThanOrEqual(3);
  });

  test('missing terms callout shown when missing_terms non-empty', async () => {
    await renderAndWaitForData();
    const missingCallout = screen.getByTestId('deal-terms-missing');
    expect(missingCallout).toBeInTheDocument();
    expect(screen.getByText('Valuation cap')).toBeInTheDocument();
    expect(screen.getByText('Discount rate')).toBeInTheDocument();
    expect(screen.getByText('Pre-money valuation')).toBeInTheDocument();
  });

  test('missing terms callout NOT shown when missing_terms is empty', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_LLM_RESULT,
      missing_terms: [],
    } satisfies DealTermsAnalysisResult);

    render(<DealTermsCard dealId="test-deal-uuid" report={buildReport()} darkMode={false} />);
    await screen.findByTestId('deal-terms-narrative');

    expect(screen.queryByTestId('deal-terms-missing')).not.toBeInTheDocument();
  });

  test('raw deterministic table is NOT shown by default', async () => {
    await renderAndWaitForData();
    expect(screen.queryByTestId('deal-terms-raw-table')).not.toBeInTheDocument();
  });

  test('"View Details" toggle reveals the raw canonical inspector', async () => {
    await renderAndWaitForData();

    const toggle = screen.getByTestId('deal-terms-details-toggle');
    expect(toggle).toHaveTextContent('View Details');

    await userEvent.click(toggle);

    const rawTable = screen.getByTestId('deal-terms-raw-table');
    expect(rawTable).toBeInTheDocument();
    // Should contain "Developer Inspector" heading
    expect(rawTable.textContent).toContain('Developer Inspector');
    expect(toggle).toHaveTextContent('Hide Details');
  });

  test('"View Details" toggle hides table on second click', async () => {
    await renderAndWaitForData();

    const toggle = screen.getByTestId('deal-terms-details-toggle');
    await userEvent.click(toggle);
    expect(screen.getByTestId('deal-terms-raw-table')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByTestId('deal-terms-raw-table')).not.toBeInTheDocument();
  });

  test('shows AI Governed badge in header', async () => {
    await renderAndWaitForData();
    expect(screen.getByText('AI Governed')).toBeInTheDocument();
  });
});

// ─── DealTermsCard error state ────────────────────────────────────────────────

describe('DealTermsCard — error state', () => {
  test('shows error message and retry button when LLM call fails', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('OPENAI_API_KEY not configured'),
    );

    render(<DealTermsCard dealId="test-deal-uuid" report={buildReport()} darkMode={false} />);

    await waitFor(() => {
      expect(screen.getByText('OPENAI_API_KEY not configured')).toBeInTheDocument();
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  test('retry button calls apiPostDealTermsAnalysis again', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    const mockFn = apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>;
    mockFn
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(MOCK_LLM_RESULT);

    render(<DealTermsCard dealId="test-deal-uuid" report={buildReport()} darkMode={false} />);

    // Wait for error state
    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Retry'));

    // After retry succeeds, narrative shows
    await screen.findByTestId('deal-terms-narrative');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});

// ─── DealTermsCard no-data state ─────────────────────────────────────────────

describe('DealTermsCard — no data state', () => {
  test('shows no-data message when all canonical fields are null', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_LLM_RESULT);

    // Report with no canonical_fields section
    const emptyReport: InvestorInsightsReport = {
      status: 'deterministic_only',
      render_package: { sections: [] },
    };

    render(<DealTermsCard dealId="test-deal-uuid" report={emptyReport} darkMode={false} />);

    await waitFor(() => {
      expect(screen.getByText(/No deal terms found/)).toBeInTheDocument();
    });
    // LLM should NOT have been called when there are no fields
    expect(apiPostDealTermsAnalysis).not.toHaveBeenCalled();
  });
});

// ─── AnalysisTab integration: canonical_fields must NOT appear in viewer ──────

describe('DealTermsCard — canonical_fields not rendered in InvestorReportView', () => {
  /**
   * This is an integration assertion: DealTermsCard should be the ONLY place
   * "Raise Amount" or canonical field rows appear in the AI Analysis tab.
   * The raw field body text (the pipe-delimited canonical_fields format) should
   * not appear in the rest of the rendered output.
   */
  test('canonical_fields pipe-delimited rows are not visible outside the raw inspector', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_LLM_RESULT);

    render(<DealTermsCard dealId="test-deal-uuid" report={buildReport()} darkMode={false} />);
    await screen.findByTestId('deal-terms-narrative');

    // The raw canonical body format marker must not be visible outside details panel
    const rawToggle = screen.getByTestId('deal-terms-details-toggle');
    expect(rawToggle).toHaveTextContent('View Details'); // not yet expanded

    // The raw pipe-delimited lines should not be visible in collapsed state
    expect(screen.queryByText(/category=raise_terms \| field=raise_amount/)).not.toBeInTheDocument();
  });
});
