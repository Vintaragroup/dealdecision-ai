/**
 * InsightsDataPanel.test.tsx — PR33
 *
 * Tests for the InsightsDataPanel component that renders data/diagnostic
 * sections from the investor-insights payload inside the Data tab.
 *
 * Coverage:
 *   1. Loading state — Loader2 spinner rendered
 *   2. Error state   — error message rendered
 *   3. Empty state   — not_started report or no sections → empty-state rendered
 *   4. No data sections — report has sections but all are decision-surface keys → fallback
 *   5. Group 1 (Extracted Canonical Facts) — insight_slots + canonical_fields rendered
 *   6. Group 2 (Conflicts & Uncertainty)   — completeness + conflicts rendered
 *   7. Group 3 (Coverage & Extraction)     — coverage_snapshot + normDiff rendered
 *   8. Partial presence — missing sections show AbsentSection notices
 *   9. All three groups present             — correct group headings all visible
 *  10. NormalizationDiff shown as collapsible details
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UseInsightsStatusSummaryResult } from '../hooks/useInvestorInsightsStatusSummary';
import type { InvestorInsightsReport } from '../lib/apiClient';

// ── Mock useInvestorInsightsStatusSummary ─────────────────────────────────────

vi.mock('../hooks/useInvestorInsightsStatusSummary', () => ({
  useInvestorInsightsStatusSummary: vi.fn(),
}));

import { useInvestorInsightsStatusSummary } from '../hooks/useInvestorInsightsStatusSummary';
import { InsightsDataPanel } from '../components/workspace/InsightsDataPanel';

const mockUseHook = vi.mocked(useInvestorInsightsStatusSummary);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hookResult(
  overrides: Partial<UseInsightsStatusSummaryResult>
): UseInsightsStatusSummaryResult {
  return {
    status: 'ready',
    report: null,
    error: null,
    refresh: vi.fn(),
    generate: vi.fn(),
    isRunning: false,
    isStalled: false,
    intervalMs: null,
    ...overrides,
  } as UseInsightsStatusSummaryResult;
}

function makeReport(
  sections: Array<{ key: string; title?: string; kind?: string; body?: string; items?: unknown[] }>,
  reportStatus = 'deterministic_only'
): InvestorInsightsReport {
  return {
    status: reportStatus,
    render_package: { sections },
  } as unknown as InvestorInsightsReport;
}

// ── Section bodies for fixtures ──────────────────────────────────────────────

const INSIGHT_SLOTS_BODY = [
  'raise_amount: Computable | value="$2M" | evidence=dpu:doc:abc:page:1 | reason=none',
  'raise_round: NotComputable | value=none | evidence=none | reason=NO_EVIDENCE',
].join('\n');

const CANONICAL_FIELDS_BODY = [
  'category=raise_terms | field=raise_amount | computability=Computable | value="$2M Pre-Seed" | evidence=dpu:doc:abc:page:1 | reason=none',
  'category=market_claims | field=tam_value | computability=NotComputable | value=none | evidence=none | reason=NO_TAM',
].join('\n');

const COMPLETENESS_BODY = [
  'raise_terms: Present',
  'valuation_terms: Missing',
  'market_claims: Conflicting',
].join('\n');

const CONFLICTS_BODY = [
  'field=raise_amount | value_a="$2M" | evidence_a=dpu:doc:abc:page:1 | value_b="$3M" | evidence_b=dpu:doc:xyz:page:5',
].join('\n');

const COVERAGE_BODY = [
  'dpu_page_count: 20',
  'dpu_nonempty_pages: 18',
  'coverage_query_errors: none',
].join('\n');

const NORM_DIFF_BODY = [
  'total_events: 3',
  'affected_pages: 2',
  'page=1 | ref=dpu:doc:abc:page:1 | events=2 | rules=rule_A,rule_B | raw=foo | norm=bar',
].join('\n');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InsightsDataPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  // ── 1. Loading state ────────────────────────────────────────────────────────

  test('renders loading spinner when status is loading', () => {
    mockUseHook.mockReturnValue(hookResult({ status: 'loading', report: null }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const el = screen.getByTestId('insights-data-panel-loading');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Loading extracted data');
  });

  // ── 2. Error state ──────────────────────────────────────────────────────────

  test('renders error message when status is error', () => {
    mockUseHook.mockReturnValue(hookResult({ status: 'error', report: null, error: 'Network timeout' }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const el = screen.getByTestId('insights-data-panel-error');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Failed to load insights data');
    expect(el.textContent).toContain('Network timeout');
  });

  test('renders error without details when error string is null', () => {
    mockUseHook.mockReturnValue(hookResult({ status: 'error', report: null, error: null }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const el = screen.getByTestId('insights-data-panel-error');
    expect(el.textContent).toContain('Failed to load insights data');
  });

  // ── 3. Empty / not-started state ───────────────────────────────────────────

  test('renders empty state when report is null', () => {
    mockUseHook.mockReturnValue(hookResult({ status: 'ready', report: null }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const el = screen.getByTestId('insights-data-panel-empty');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('No extracted data yet');
  });

  test('renders empty state when report status is not_started', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([], 'not_started'),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    expect(screen.getByTestId('insights-data-panel-empty')).toBeTruthy();
  });

  test('renders empty state when sections array is empty', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    expect(screen.getByTestId('insights-data-panel-empty')).toBeTruthy();
  });

  // ── 4. No data sections (all are decision-surface keys) ─────────────────────

  test('renders no-data-sections fallback when report only has governed_executive_summary_v1', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'governed_executive_summary_v1', title: 'Executive Summary', kind: 'message', body: '' },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    expect(screen.getByTestId('insights-data-panel-no-data-sections')).toBeTruthy();
  });

  // ── 5. Group 1: Extracted Canonical Facts ──────────────────────────────────

  test('renders Group 1 heading and insight_slots content', async () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'insight_slots', title: 'Insight Slots', kind: 'message', body: INSIGHT_SLOTS_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Extracted Canonical Facts');
    // InsightSlotsSection renders slot labels
    expect(panel.textContent).toContain('Raise Amount');
  });

  test('renders canonical_fields content', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'canonical_fields', title: 'Canonical Fields', kind: 'message', body: CANONICAL_FIELDS_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Extracted Canonical Facts');
    expect(panel.textContent).toContain('Raise Amount');
  });

  // ── 6. Group 2: Conflicts & Uncertainty ────────────────────────────────────

  test('renders Group 2 heading and completeness content', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'completeness_summary', title: 'Completeness Summary', kind: 'message', body: COMPLETENESS_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Conflicts & Uncertainty');
    expect(panel.textContent).toContain('Raise Terms');
  });

  test('renders conflicts warning banner and field data', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'conflicts', title: 'Conflicts', kind: 'message', body: CONFLICTS_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Conflicts & Uncertainty');
    expect(panel.textContent).toContain('Conflicting values were detected');
    expect(panel.textContent).toContain('Raise Amount');
  });

  // ── 7. Group 3: Coverage & Extraction ──────────────────────────────────────

  test('renders Group 3 heading and coverage_snapshot content', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'coverage_snapshot', title: 'Coverage Snapshot', kind: 'message', body: COVERAGE_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Coverage & Extraction');
    expect(panel.textContent).toContain('Dpu Page Count');
  });

  test('renders normalization diff as a collapsible details element', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'debug.normalization_diff', title: 'Normalization Diff', kind: 'message', body: NORM_DIFF_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Coverage & Extraction');
    // details element is collapsible — the summary text should contain the label
    const details = panel.querySelector('details');
    expect(details).toBeTruthy();
  });

  // ── 8. Partial presence — absent sections show notices ─────────────────────

  test('shows AbsentSection notice when canonical_fields is missing but insight_slots present', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'insight_slots', title: 'Insight Slots', kind: 'message', body: INSIGHT_SLOTS_BODY },
        // no canonical_fields
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Canonical Fields');
    expect(panel.textContent).toContain('not present in this report');
  });

  test('shows AbsentSection notice when conflicts is missing but completeness present', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'completeness_summary', title: 'Completeness', kind: 'message', body: COMPLETENESS_BODY },
        // no conflicts
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Conflicts');
    expect(panel.textContent).toContain('not present in this report');
  });

  // ── 9. All three groups present ────────────────────────────────────────────

  test('renders all three group headings when all data sections present', () => {
    mockUseHook.mockReturnValue(hookResult({
      status: 'ready',
      report: makeReport([
        { key: 'insight_slots', title: 'Insight Slots', kind: 'message', body: INSIGHT_SLOTS_BODY },
        { key: 'canonical_fields', title: 'Canonical Fields', kind: 'message', body: CANONICAL_FIELDS_BODY },
        { key: 'completeness_summary', title: 'Completeness', kind: 'message', body: COMPLETENESS_BODY },
        { key: 'conflicts', title: 'Conflicts', kind: 'message', body: CONFLICTS_BODY },
        { key: 'coverage_snapshot', title: 'Coverage', kind: 'message', body: COVERAGE_BODY },
        { key: 'debug.normalization_diff', title: 'Norm Diff', kind: 'message', body: NORM_DIFF_BODY },
      ]),
    }));

    render(<InsightsDataPanel dealId="deal-1" darkMode={false} />);

    const panel = screen.getByTestId('insights-data-panel');
    expect(panel.textContent).toContain('Extracted Canonical Facts');
    expect(panel.textContent).toContain('Conflicts & Uncertainty');
    expect(panel.textContent).toContain('Coverage & Extraction');
  });

  test('passes dealId to hook', () => {
    mockUseHook.mockReturnValue(hookResult({ status: 'ready', report: null }));
    render(<InsightsDataPanel dealId="deal-xyz-789" darkMode={false} />);
    expect(mockUseHook).toHaveBeenCalledWith('deal-xyz-789');
  });

  // ── 10. darkMode prop applied ──────────────────────────────────────────────

  test('renders in dark mode without error', () => {
    mockUseHook.mockReturnValue(hookResult({ status: 'loading', report: null }));
    render(<InsightsDataPanel dealId="deal-1" darkMode={true} />);
    expect(screen.getByTestId('insights-data-panel-loading')).toBeTruthy();
  });
});
