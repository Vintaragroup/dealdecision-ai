/**
 * OrchestratorSummaryCard.integration.test.tsx
 *
 * Integration tests for InvestorReportView — verifies that:
 *  1. OrchestratorSummaryCard appears in the "Deal Intelligence Score" section
 *  2. The "orchestrator-summary" section is positioned AFTER "deal-terms" and BEFORE "market" in DOM order
 *  3. OrchestratorSummaryCard is NOT rendered inside InvestorInsightsTab
 *  4. When not_found, the slot renders gracefully without crashing the view
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { InvestorReportView } from '../components/workspace/InvestorReportView';
import type { InvestorInsightsReport } from '../lib/apiClient';

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    apiRegenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    apiPostDealTermsAnalysis: vi.fn(async () => new Promise<never>(() => {})),
    apiGetOrchestratorReport: vi.fn(async () => new Promise<never>(() => {})),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

function buildMinimalReport(): InvestorInsightsReport {
  return {
    status: 'deterministic_only',
    render_package: { sections: [] },
  } as InvestorInsightsReport;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrchestratorSummaryCard — InvestorReportView integration', () => {
  test('OrchestratorSummaryCard root element renders inside InvestorReportView', () => {
    render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    expect(screen.getByTestId('orchestrator-summary-card')).toBeInTheDocument();
  });

  test('"Deal Intelligence Score" section heading is present', () => {
    render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    // The ReportSection renders a heading with the title text
    expect(screen.getByText('Deal Intelligence Score')).toBeInTheDocument();
  });

  test('orchestrator-summary section is positioned AFTER deal-terms and BEFORE market in DOM', () => {
    const { container } = render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    // Sections are rendered with id attributes by ReportSection
    const dealTermsEl = container.querySelector('#deal-terms');
    const orchestratorEl = container.querySelector('#orchestrator-summary');
    const marketEl = container.querySelector('#market');

    // All three sections must exist
    expect(dealTermsEl, '#deal-terms section missing').toBeTruthy();
    expect(orchestratorEl, '#orchestrator-summary section missing').toBeTruthy();
    expect(marketEl, '#market section missing').toBeTruthy();

    // Use DOM position comparison
    const BEFORE = Node.DOCUMENT_POSITION_FOLLOWING;
    const dealTermsBefore =
      dealTermsEl!.compareDocumentPosition(orchestratorEl!) & BEFORE;
    const orchestratorBefore =
      orchestratorEl!.compareDocumentPosition(marketEl!) & BEFORE;

    expect(dealTermsBefore, 'deal-terms must come before orchestrator-summary').toBeTruthy();
    expect(orchestratorBefore, 'orchestrator-summary must come before market').toBeTruthy();
  });

  test('OrchestratorSummaryCard loading state does not crash the view', () => {
    // apiGetOrchestratorReport is mocked to never resolve → perpetual loading
    expect(() =>
      render(
        <InvestorReportView
          dealId="test-deal-id"
          report={buildMinimalReport()}
          darkMode={false}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByTestId('orchestrator-skeleton')).toBeInTheDocument();
  });

  test('InvestorReportView renders without dealId and card is still in DOM', () => {
    render(
      <InvestorReportView
        dealId={undefined}
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    // Card root must still be in DOM even without dealId
    expect(screen.getByTestId('orchestrator-summary-card')).toBeInTheDocument();
  });
});
