/**
 * OrchestratorFullReportView.dpuBackfill.test.tsx
 *
 * Tests for the Gate 1 DPU backfill UI behaviour in OrchestratorFullReportView:
 *
 *  1. When apiRegenerateInvestorInsights returns { status: 'preparing_documents' },
 *     the component renders the "Preparing Documents" overlay.
 *  2. After poll_after_ms elapses, apiGetDealReadiness is called.
 *  3. When apiGetDealReadiness returns { ready: true }, the component:
 *       a. Calls apiRegenerateInvestorInsights again to actually trigger the job.
 *       b. Exits the preparing state and calls refreshInsights().
 *  4. The polling interval is cleared on unmount (no calls after unmount).
 */

import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

import { OrchestratorFullReportView } from '../components/workspace/OrchestratorFullReportView';
import type { InvestorInsightsReport, PageUnderstandingReadiness } from '../lib/apiClient';

// ─── Mock hooks ───────────────────────────────────────────────────────────────

vi.mock('../hooks/useInvestorInsights', () => ({
  useInvestorInsights: vi.fn(),
}));

vi.mock('../hooks/useOrchestratorReport', () => ({
  useOrchestratorReport: vi.fn(),
}));

import { useInvestorInsights } from '../hooks/useInvestorInsights';
import { useOrchestratorReport } from '../hooks/useOrchestratorReport';
const mockUseInsights = vi.mocked(useInvestorInsights);
const mockUseOrch = vi.mocked(useOrchestratorReport);

// ─── Mock apiClient — spread actual to preserve all other exports ─────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiRegenerateInvestorInsights: vi.fn(),
    apiGetDealReadiness: vi.fn(),
  };
});

import { apiRegenerateInvestorInsights, apiGetDealReadiness } from '../lib/apiClient';
const mockRegenerate = vi.mocked(apiRegenerateInvestorInsights);
const mockGetReadiness = vi.mocked(apiGetDealReadiness);

function makeReadiness(ready: boolean): PageUnderstandingReadiness {
  return {
    deal_id: DEAL_ID,
    version: 'page_understanding_v1',
    documents: [],
    expected_pages_total: 18,
    dpu_rows_total: ready ? 18 : 0,
    missing_pages_total: ready ? 0 : 18,
    ready,
  };
}

// ─── Mock heavy child components ──────────────────────────────────────────────

vi.mock('../components/workspace/analysis/DecisionOverlay', () => ({
  DecisionOverlay: () => <div data-testid="mock-decision-overlay" />,
}));
vi.mock('../components/workspace/DealTermsCard', () => ({
  DealTermsCard: () => <div data-testid="mock-deal-terms-card" />,
}));
vi.mock('../components/workspace/MarketAnalysisCard', () => ({
  MarketAnalysisCard: () => <div data-testid="mock-market-analysis-card" />,
}));
vi.mock('../components/workspace/analysis/FinancialAnalysisSection', () => ({
  FinancialAnalysisSection: () => <div data-testid="mock-financial-analysis" />,
}));
vi.mock('../components/workspace/analysis/RiskVerificationSection', () => ({
  RiskVerificationSection: () => <div data-testid="mock-risk-verification" />,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEAL_ID = 'dpu-test-deal-00000000-0000-0000-0000';

function makeReadyInsightReport(): InvestorInsightsReport {
  return {
    status: 'ready',
    render_package: {
      sections: [
        {
          key: 'governed_executive_summary_v1',
          kind: 'governed_executive_summary_v1',
          title: 'Executive Summary',
          body:
            '---governed_executive_summary_v1_json---\n' +
            JSON.stringify({
              schema_version: 'governed_executive_summary_v1',
              headline: 'TestCo — DPU Backfill Test',
              summary_paragraphs: ['Test paragraph.'],
              strengths: ['Good team'],
              risks: ['Market risk'],
              open_questions: [],
              coverage_note: '90%',
              validated: true,
            }),
        },
      ],
    },
  };
}

function seedReady(refreshFn = vi.fn()) {
  mockUseInsights.mockReturnValue({
    status: 'ready',
    report: makeReadyInsightReport(),
    error: null,
    generate: vi.fn(),
    refresh: refreshFn,
  });
  mockUseOrch.mockReturnValue({
    status: 'ready',
    data: null,
    error: null,
    refresh: vi.fn(),
  });
}

/** Click the Regenerate button and flush async micro-tasks */
async function clickRegenerateAndFlush() {
  const regenerateBtn = screen.getByRole('button', { name: /regenerate/i });
  await act(async () => {
    fireEvent.click(regenerateBtn);
    // Flush micro-task queue so the resolved promise lands
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrchestratorFullReportView — Gate 1 DPU preparing_documents state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fake only setInterval/clearInterval so the polling clock is under test
    // control. Leaving setTimeout real ensures React's scheduler and waitFor's
    // internal polling continue to work normally.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('1. Clicking Regenerate with preparing_documents response renders the preparing overlay', async () => {
    mockRegenerate.mockResolvedValue({
      status: 'preparing_documents',
      blocked_reason: 'missing_dpu',
      action: 'enqueue_dpu_backfill',
      poll_after_ms: 1500,
      docs_fingerprint: `${DEAL_ID}::18::0::18`,
      expected_pages_total: 18,
      dpu_rows_total: 0,
      missing_pages_total: 18,
    });

    seedReady();
    render(<OrchestratorFullReportView dealId={DEAL_ID} />);

    // Starts in normal ready state
    expect(screen.queryByTestId('preparing-documents-state')).toBeNull();

    await clickRegenerateAndFlush();

    // Preparing overlay should now be visible
    expect(screen.getByTestId('preparing-documents-state')).toBeTruthy();
    expect(screen.getByText(/Preparing Documents/i)).toBeTruthy();
    expect(screen.getByText(/Building document understanding/i)).toBeTruthy();
  });

  test('2. After poll_after_ms, apiGetDealReadiness is called', async () => {
    mockRegenerate.mockResolvedValue({
      status: 'preparing_documents',
      blocked_reason: 'missing_dpu',
      action: 'enqueue_dpu_backfill',
      poll_after_ms: 1000,
      docs_fingerprint: `${DEAL_ID}::18::0::18`,
    });
    mockGetReadiness.mockResolvedValue(makeReadiness(false));

    seedReady();
    render(<OrchestratorFullReportView dealId={DEAL_ID} />);
    await clickRegenerateAndFlush();

    expect(screen.getByTestId('preparing-documents-state')).toBeTruthy();

    // Advance clock past poll_after_ms, then flush async work inside setInterval callback
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockGetReadiness).toHaveBeenCalledWith(DEAL_ID, 'page_understanding_v1');
    });
  });

  test('3. When readiness returns ready, regenerate is called again and overlay clears', async () => {
    const refreshFn = vi.fn();

    mockRegenerate
      .mockResolvedValueOnce({
        status: 'preparing_documents',
        blocked_reason: 'missing_dpu',
        action: 'enqueue_dpu_backfill',
        poll_after_ms: 500,
        docs_fingerprint: `${DEAL_ID}::18::0::18`,
      })
      .mockResolvedValueOnce({ ok: true, deal_id: DEAL_ID, enqueued: true });

    mockGetReadiness.mockResolvedValue(makeReadiness(true));

    seedReady(refreshFn);
    render(<OrchestratorFullReportView dealId={DEAL_ID} />);
    await clickRegenerateAndFlush();

    expect(screen.getByTestId('preparing-documents-state')).toBeTruthy();

    // Advance clock past poll interval and flush all async work
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockGetReadiness).toHaveBeenCalledWith(DEAL_ID, 'page_understanding_v1');
      expect(mockRegenerate).toHaveBeenCalledTimes(2);
      expect(refreshFn).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('preparing-documents-state')).toBeNull();
    });
  });

  test('4. Polling interval is cleared on unmount (no calls after unmount)', async () => {
    mockRegenerate.mockResolvedValue({
      status: 'preparing_documents',
      blocked_reason: 'missing_dpu',
      action: 'enqueue_dpu_backfill',
      poll_after_ms: 500,
      docs_fingerprint: `${DEAL_ID}::18::0::18`,
    });
    mockGetReadiness.mockResolvedValue(makeReadiness(false));

    seedReady();
    const { unmount } = render(<OrchestratorFullReportView dealId={DEAL_ID} />);
    await clickRegenerateAndFlush();

    // Advance one poll cycle
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockGetReadiness).toHaveBeenCalled());
    const callCountBeforeUnmount = mockGetReadiness.mock.calls.length;

    act(() => { unmount(); });

    // Advance further — must NOT trigger more readiness calls
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(mockGetReadiness.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});
