/**
 * DecisionOverlay.integration.test.tsx
 *
 * Integration tests for InvestorReportView — verifies that:
 *  1. DecisionOverlay renders inside InvestorReportView
 *  2. The "decision-overlay" section is positioned BEFORE "exec-summary" in DOM order
 *  3. OrchestratorSummaryCard position is unchanged (AFTER deal-terms, BEFORE market)
 *  4. Both decision-overlay and orchestrator-summary-card are present simultaneously
 *  5. Loading state (apiGetOrchestratorReport never resolves) does not crash the view
 *  6. dealId=undefined renders without crashing
 *  7. InvestorInsightsTab does NOT import DecisionOverlay (static source check)
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

import { InvestorReportView } from '../components/workspace/InvestorReportView';
import type { InvestorInsightsReport } from '../lib/apiClient';

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    apiRegenerateInvestorInsights: vi.fn(async () => ({ ok: true, deal_id: 'test-deal-id', enqueued: true })),
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

const WEB_ROOT = resolve(__dirname, '../..');

function readWebFile(relativePath: string): string {
  const abs = resolve(WEB_ROOT, 'src', relativePath);
  return existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DecisionOverlay — InvestorReportView integration', () => {
  test('DecisionOverlay root element renders inside InvestorReportView', () => {
    render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    expect(screen.getByTestId('decision-overlay')).toBeInTheDocument();
  });

  test('decision-overlay section is positioned BEFORE exec-summary in DOM', () => {
    const { container } = render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    const decisionEl = container.querySelector('#decision-overlay');
    const execSummaryEl = container.querySelector('#exec-summary');

    expect(decisionEl, '#decision-overlay section missing').toBeTruthy();
    expect(execSummaryEl, '#exec-summary section missing').toBeTruthy();

    // decision-overlay should PRECEDE exec-summary in DOM order
    const BEFORE = Node.DOCUMENT_POSITION_FOLLOWING;
    const decisionBeforeExec =
      decisionEl!.compareDocumentPosition(execSummaryEl!) & BEFORE;

    expect(decisionBeforeExec, 'decision-overlay must come before exec-summary').toBeTruthy();
  });

  test('orchestrator-summary section ordering is unchanged (after deal-terms, before market)', () => {
    const { container } = render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    const dealTermsEl = container.querySelector('#deal-terms');
    const orchestratorEl = container.querySelector('#orchestrator-summary');
    const marketEl = container.querySelector('#market');

    expect(dealTermsEl, '#deal-terms section missing').toBeTruthy();
    expect(orchestratorEl, '#orchestrator-summary section missing').toBeTruthy();
    expect(marketEl, '#market section missing').toBeTruthy();

    const BEFORE = Node.DOCUMENT_POSITION_FOLLOWING;
    const dealTermsBefore =
      dealTermsEl!.compareDocumentPosition(orchestratorEl!) & BEFORE;
    const orchestratorBefore =
      orchestratorEl!.compareDocumentPosition(marketEl!) & BEFORE;

    expect(dealTermsBefore, 'deal-terms must come before orchestrator-summary').toBeTruthy();
    expect(orchestratorBefore, 'orchestrator-summary must come before market').toBeTruthy();
  });

  test('both decision-overlay and orchestrator-summary-card are present simultaneously', () => {
    render(
      <InvestorReportView
        dealId="test-deal-id"
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    expect(screen.getByTestId('decision-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('orchestrator-summary-card')).toBeInTheDocument();
  });

  test('DecisionOverlay loading state does not crash InvestorReportView', () => {
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

    expect(screen.getByTestId('decision-overlay-skeleton')).toBeInTheDocument();
  });

  test('InvestorReportView renders without dealId and DecisionOverlay is still in DOM', () => {
    render(
      <InvestorReportView
        dealId={undefined}
        report={buildMinimalReport()}
        darkMode={false}
      />,
    );

    // The overlay should still render (in loading/skeleton state when no dealId)
    expect(screen.getByTestId('decision-overlay')).toBeInTheDocument();
  });
});

// ─── Static source isolation checks ──────────────────────────────────────────

describe('DecisionOverlay — static import isolation', () => {
  test('InvestorInsightsTab.tsx does NOT import DecisionOverlay', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('DecisionOverlay');
    expect(src).not.toContain('useOrchestratorReport');
  });

  test('InvestorReportView.tsx imports DecisionOverlay (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain('DecisionOverlay');
  });

  test('InvestorReportView.tsx renders decision-overlay section above exec-summary in source order', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    const decisionIdx = src.indexOf('id="decision-overlay"');
    const execSummaryIdx = src.indexOf('id="exec-summary"');

    expect(decisionIdx, 'decision-overlay id not found in InvestorReportView.tsx').toBeGreaterThan(-1);
    expect(execSummaryIdx, 'exec-summary id not found in InvestorReportView.tsx').toBeGreaterThan(-1);
    expect(decisionIdx, 'decision-overlay must appear before exec-summary in source').toBeLessThan(execSummaryIdx);
  });
});
