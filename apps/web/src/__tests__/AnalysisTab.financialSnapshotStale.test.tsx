/**
 * AnalysisTab.financialSnapshotStale.test.tsx
 *
 * Tests the stale snapshot warning banner in FinancialBreakdownPanel.
 * Renders AnalysisTab directly (not through DealWorkspace) with minimal mocking.
 *
 * Contract guarantees:
 *  1. Banner renders when financialSnapshotStale=true and breakdown/readiness present
 *  2. Banner is absent when financialSnapshotStale=false
 *  3. Banner is absent when financialSnapshotStale=true but no breakdown/readiness (panel hidden)
 *  4. Banner has role="alert" for accessibility
 *  5. No false positive: non-stale deal with data shows no banner
 */
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

import { AnalysisTab } from '../components/workspace/AnalysisTab';
import type { DealFormData } from '../components/Modal_Legacy/NewDealModal';
import type { FinancialBreakdownV1Like, UnderwritingReadinessV1Like } from '../lib/selectors/selectAuthoritativeFinancialBreakdownV1';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../hooks/useOrchestratorReport', () => ({
  useOrchestratorReport: () => ({ status: 'not_started', data: null, refresh: vi.fn() }),
}));

vi.mock('../components/deals/analysis/AnalysisSnapshotDashboard', () => ({
  AnalysisSnapshotDashboard: ({ children }: any) => <div data-testid="snapshot-dashboard">{children}</div>,
}));

vi.mock('../components/deals/analysis/mergeSnapshotWithOrchestrator', () => ({
  mergeSnapshotWithOrchestrator: (_a: any, b: any) => b ?? _a,
}));

vi.mock('../components/deals/analysis/ReportViewConfigModal', () => ({
  ReportViewConfigModal: () => null,
  DEFAULT_REPORT_VIEW_CONFIG: { visibleSections: [] },
}));

vi.mock('../components/reports/ProfessionalReportGenerator', () => ({
  ProfessionalReportGenerator: () => null,
}));

vi.mock('../components/workspace/OrchestratorFullReportView', () => ({
  OrchestratorFullReportView: () => null,
}));

vi.mock('../components/deals/analysis/ReportGeneratorPreviewSplit', () => ({
  ReportGeneratorPreviewSplit: () => null,
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const minimalDealData: DealFormData = {
  name: 'Test Deal',
  companyName: 'Acme Corp',
} as DealFormData;

const minimalBreakdown: FinancialBreakdownV1Like = {
  has_xlsx: false,
  has_current_state: false,
  has_projections: false,
  has_cap_table: false,
  has_cap_table_data: false,
  risks: [{ severity: 'high', code: 'deck_only', message: 'Deck only' }],
} as FinancialBreakdownV1Like;

const minimalReadiness: UnderwritingReadinessV1Like = {
  status: 'insufficient',
  score: 5,
  reasons: [],
  missing: ['Spreadsheet financial model (XLSX)'],
  gaps: ['deck_only'],
  narrative: 'Insufficient financial package.',
} as UnderwritingReadinessV1Like;

// ─── Timer helpers ────────────────────────────────────────────────────────────

// AnalysisTab's runAnalysis() has a 2-second setTimeout before analysis resolves.
// We use fake timers to advance past it without real wall-clock delay.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function renderAndWaitForAnalysis(props: {
  financialBreakdownV1?: FinancialBreakdownV1Like | null;
  underwritingReadinessV1?: UnderwritingReadinessV1Like | null;
  financialSnapshotStale?: boolean;
}) {
  render(
    <AnalysisTab
      darkMode={false}
      dealData={minimalDealData}
      dealId="test-deal-id"
      financialBreakdownV1={props.financialBreakdownV1}
      underwritingReadinessV1={props.underwritingReadinessV1}
      financialSnapshotStale={props.financialSnapshotStale}
    />
  );
  // Advance past the 2-second simulated analysis timeout + flush React updates.
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FinancialBreakdownPanel stale snapshot banner', () => {
  test('renders stale banner when financialSnapshotStale=true and panel is visible', async () => {
    await renderAndWaitForAnalysis({
      financialBreakdownV1: minimalBreakdown,
      underwritingReadinessV1: minimalReadiness,
      financialSnapshotStale: true,
    });
    const banner = screen.getByTestId('financial-snapshot-stale-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Financial snapshot may be outdated');
    expect(banner.textContent).toContain('Re-run analysis to refresh');
  });

  test('does not render stale banner when financialSnapshotStale=false', async () => {
    await renderAndWaitForAnalysis({
      financialBreakdownV1: minimalBreakdown,
      underwritingReadinessV1: minimalReadiness,
      financialSnapshotStale: false,
    });
    // Panel should exist
    expect(screen.getByTestId('financial-breakdown-panel')).toBeTruthy();
    // Banner should not exist
    expect(screen.queryByTestId('financial-snapshot-stale-banner')).toBeNull();
  });

  test('does not render stale banner when financialSnapshotStale is omitted (default false)', async () => {
    await renderAndWaitForAnalysis({
      financialBreakdownV1: minimalBreakdown,
      underwritingReadinessV1: null,
    });
    expect(screen.getByTestId('financial-breakdown-panel')).toBeTruthy();
    expect(screen.queryByTestId('financial-snapshot-stale-banner')).toBeNull();
  });

  test('panel is not rendered (no stale banner) when both breakdown and readiness are null', async () => {
    await renderAndWaitForAnalysis({
      financialBreakdownV1: null,
      underwritingReadinessV1: null,
      financialSnapshotStale: true,
    });
    expect(screen.queryByTestId('financial-breakdown-panel')).toBeNull();
    expect(screen.queryByTestId('financial-snapshot-stale-banner')).toBeNull();
  });

  test('stale banner renders when only readiness is present (no breakdown)', async () => {
    await renderAndWaitForAnalysis({
      financialBreakdownV1: null,
      underwritingReadinessV1: minimalReadiness,
      financialSnapshotStale: true,
    });
    expect(screen.getByTestId('financial-snapshot-stale-banner')).toBeTruthy();
  });
});
