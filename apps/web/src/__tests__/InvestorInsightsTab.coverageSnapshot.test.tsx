/**
 * Tests for the coverage_snapshot section renderer in InvestorInsightsTab.
 *
 * Verifies that key/value rows are rendered as a 2-column table, and that a
 * warning banner appears when coverage_query_errors is not "none".
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

const COVERAGE_BODY_NO_ERRORS = [
  'docs_count: 3',
  'dpu_total: 5',
  'dpu_non_empty: 4',
  'structured_json_available: false',
  'overlay_available: true',
  'coverage_query_errors: none',
].join('\n');

const COVERAGE_BODY_WITH_ERRORS = [
  'docs_count: 2',
  'dpu_total: 0',
  'dpu_non_empty: 0',
  'structured_json_available: false',
  'overlay_available: false',
  'coverage_query_errors: dpu_counts',
].join('\n');

function makeReport(body: string) {
  return {
    status: 'deterministic_only',
    render_package: {
      sections: [
        {
          key: 'coverage_snapshot',
          title: 'Coverage Snapshot',
          kind: 'message',
          body,
        },
      ],
    },
  } as any;
}

describe('InvestorInsightsTab – coverage_snapshot section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders metric rows as a 2-column table', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(COVERAGE_BODY_NO_ERRORS));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-1" />);

    // Column headers
    await screen.findByText('Metric');
    screen.getByText('Value');

    // A few representative row labels (key → humanised label)
    screen.getByText('Docs Count');
    screen.getByText('Overlay Available');
    screen.getByText('Coverage Query Errors');
  });

  test('no warning banner when coverage_query_errors is "none"', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(COVERAGE_BODY_NO_ERRORS));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-2" />);

    await screen.findByText('Docs Count');

    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('warning banner is shown when coverage_query_errors is not "none"', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(COVERAGE_BODY_WITH_ERRORS));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-3" />);

    await screen.findByText('Docs Count');

    // The alert role and error value text should both be present.
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/dpu_counts/);
  });

  test('warning banner text includes the specific error value', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(COVERAGE_BODY_WITH_ERRORS));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-4" />);

    await screen.findByRole('alert');

    expect(screen.getByText(/coverage query errors detected/i)).toBeTruthy();
  });

  test('generic MessageSection is unchanged for non-coverage_snapshot message sections', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue({
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'analysis_status',
            title: 'Analysis Status',
            kind: 'message',
            body: 'Deterministic-only analysis complete.',
          },
        ],
      },
    } as any);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-5" />);

    await screen.findByText('Deterministic-only analysis complete.');
    // No table columns — this section is plain text
    expect(screen.queryByText('Metric')).toBeNull();
  });

  test('low-coverage amber banner shown when dpu_nonempty_pages / dpu_page_count < 0.6', async () => {
    const lowCoverageBody = [
      'docs_count: 2',
      'dpu_page_count: 10',
      'dpu_nonempty_pages: 3',   // 3/10 = 0.3 < 0.6
      'evidence_count: 0',
      'visuals_count: 0',
      'structured_json_available: false',
      'overlay_available: false',
      'coverage_query_errors: none',
    ].join('\n');

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(lowCoverageBody));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-lc" />);

    await screen.findByText('Docs Count');

    const banner = screen.getByTestId('low-coverage-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/low text coverage/i);
    expect(banner.textContent).toMatch(/3\/10/);
  });

  test('low-coverage banner NOT shown when ratio >= 0.6', async () => {
    const okBody = [
      'docs_count: 2',
      'dpu_page_count: 10',
      'dpu_nonempty_pages: 7',   // 7/10 = 0.7 >= 0.6
      'evidence_count: 0',
      'visuals_count: 0',
      'structured_json_available: false',
      'overlay_available: false',
      'coverage_query_errors: none',
    ].join('\n');

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(okBody));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-ok" />);

    await screen.findByText('Docs Count');

    expect(screen.queryByTestId('low-coverage-banner')).toBeNull();
  });

  test('low-coverage banner NOT shown when dpu_page_count is 0', async () => {
    const noPages = [
      'dpu_page_count: 0',
      'dpu_nonempty_pages: 0',
      'coverage_query_errors: none',
    ].join('\n');

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(makeReport(noPages));

    render(<InvestorInsightsTab darkMode={false} dealId="deal-cov-zero" />);

    await screen.findByText('Dpu Page Count');

    expect(screen.queryByTestId('low-coverage-banner')).toBeNull();
  });
});
