/**
 * Tests for the debug.normalization_diff section renderer in InvestorInsightsTab.
 *
 * Verifies:
 *   1. Table headers rendered (Page, Ref, Events, Raw → Normalized)
 *   2. Page entry rows parsed and rendered
 *   3. EvidencePill renders the ref
 *   4. Raw / norm preview labels visible
 *   5. Stat badges (total_events, affected_pages) shown
 *   6. EmptyFallback when body has no page= entries
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { InvestorInsightsTab } from '../components/workspace/InvestorInsightsTab';
import { apiGetInvestorInsights } from '../lib/apiClient';

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

// ── Test bodies ───────────────────────────────────────────────────────────────

const DIFF_BODY_SINGLE = [
  '(dev-only) Omitted in production.',
  'total_events: 3',
  'affected_pages: 1',
  'page=3 | ref=dpu:doc:a1b2c3d4:page:3 | events=3 | rules=money_symbol_S_to_$ | raw=Raise: S4M seed round | norm=Raise: $4M seed round',
].join('\n');

const DIFF_BODY_MULTI = [
  '(dev-only) Omitted in production.',
  'total_events: 5',
  'affected_pages: 2',
  'page=7 | ref=dpu:doc:b2c3d4e5:page:7 | events=3 | rules=money_symbol_S_to_$,magnitude_mm_to_m | raw=Raise S1MM seed | norm=Raise $1M seed',
  'page=2 | ref=dpu:doc:c3d4e5f6:page:2 | events=2 | rules=money_symbol_S_to_$ | raw=Invest S500K | norm=Invest $500K',
].join('\n');

const DIFF_BODY_NO_ENTRIES = [
  '(dev-only) Omitted in production.',
  'total_events: 0',
  'affected_pages: 0',
].join('\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(body: string) {
  return {
    status: 'deterministic_only',
    render_package: {
      sections: [
        {
          key: 'debug.normalization_diff',
          title: 'Debug — OCR Normalization Diff',
          kind: 'message',
          body,
        },
      ],
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InvestorInsightsTab – debug.normalization_diff section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders table headers: Page, Ref, Events, Raw → Normalized', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-1" />);

    await screen.findByText('Page');
    screen.getByText('Ref');
    screen.getByText('Events');
    screen.getByText(/Raw.*Normalized/);
  });

  test('renders stat badges for total_events and affected_pages', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-2" />);

    await screen.findByText(/total.?events/i);
    screen.getByText(/affected.?pages/i);
  });

  test('page index appears in table row', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-3" />);

    // Page index "3" may appear more than once (also as events count); use getAllByText
    await screen.findByText('Page');
    const threes = screen.getAllByText('3');
    expect(threes.length).toBeGreaterThanOrEqual(1);
  });

  test('EvidencePill renders the ref string', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-4" />);

    // EvidencePill typically renders the ref truncated or fully; check partial match
    await screen.findByText(/a1b2c3d4/);
  });

  test('raw and norm preview labels visible', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-5" />);

    await screen.findByText(/raw:/i);
    screen.getByText(/norm:/i);
  });

  test('raw preview text contains original OCR garbage token', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-6" />);

    // The raw preview for the single page contains "S4M"
    await screen.findByText(/S4M/);
  });

  test('norm preview text contains corrected $4M token', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-7" />);

    await screen.findByText(/\$4M/);
  });

  test('multi-page body renders both page entries', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_MULTI));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-8" />);

    await screen.findByText('Page');
    // Both page indexes should be visible; numbers may appear multiple times
    expect(screen.getAllByText('7').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  test('events count appears for each entry', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_MULTI));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-9" />);

    await screen.findByText('Page');
    // Event counts from the two rows: 3 and 2
    const threes = screen.getAllByText('3');
    const twos = screen.getAllByText('2');
    expect(threes.length).toBeGreaterThanOrEqual(1);
    expect(twos.length).toBeGreaterThanOrEqual(1);
  });

  test('empty-state fallback shown when no page= entries exist', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_NO_ENTRIES));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-10" />);

    await screen.findByText(/no normalization diff data available/i);
    expect(screen.queryByText('Page')).toBeNull(); // table should not render
  });

  test('dark mode does not crash the component', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={true} dealId="deal-normdiff-11" />);

    await screen.findByText('Page');
  });

  test('section title rendered', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(DIFF_BODY_SINGLE));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-normdiff-12" />);

    await screen.findByText('Debug — OCR Normalization Diff');
  });
});
