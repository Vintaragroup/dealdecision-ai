/**
 * Tests for the insight_slots section renderer in InvestorInsightsTab.
 *
 * Verifies that slot rows are parsed from the body text and rendered as a
 * table with correct slot names and status badges.
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

// Report with a mix of Computable and NotComputable slot rows.
const INSIGHT_SLOTS_BODY = [
  'raise_terms: Computable | value="$2M SAFE" | evidence=dpu:doc:a1b2c3d4:page:3 | reason=none',
  'market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION',
].join('\n');

const REPORT_WITH_SLOTS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'insight_slots',
        title: 'Insight Slots',
        kind: 'message',
        body: INSIGHT_SLOTS_BODY,
      },
    ],
  },
} as any;

describe('InvestorInsightsTab – insight_slots section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders both slot names from the body text', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-test-1" />);

    // Both human-readable slot labels should appear in the table.
    await screen.findByText('Raise Terms');
    screen.getByText('Market Claims');
  });

  test('Computable badge appears for the Computable slot', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-test-1" />);

    await screen.findByText('Raise Terms');

    // At least one "Computable" badge should be visible.
    expect(screen.getAllByText('Computable').length).toBeGreaterThanOrEqual(1);
  });

  test('NotComputable badge and reason code appear for the NotComputable slot', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-test-1" />);

    await screen.findByText('Market Claims');

    expect(screen.getByText('NotComputable')).toBeTruthy();
    expect(screen.getByText('NO_MARKET_CLAIM_MENTION')).toBeTruthy();
  });

  test('evidence ref is rendered as monospace pill for Computable slot', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-test-1" />);

    await screen.findByText('Raise Terms');

    expect(screen.getByText('dpu:doc:a1b2c3d4:page:3')).toBeTruthy();
  });

  test('value is displayed with quotes stripped for Computable slot', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-test-1" />);

    await screen.findByText('Raise Terms');

    // Surrounding quotes should be stripped: "$2M SAFE" → $2M SAFE
    expect(screen.getByText('$2M SAFE')).toBeTruthy();
  });

  test('value containing "/" (sanitized from "|") is rendered fully — pipe-in-value regression', async () => {
    // Guard against the bug where a "|" inside the value (e.g. from Excel structured text
    // "Retention ratio | 60.00%") fractures the pipe-delimited line and the value is truncated.
    // The worker sanitizes "|" → "/" before persisting, so the body uses "/".
    const reportWithPipeValue = {
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'insight_slots',
            title: 'Insight Slots',
            kind: 'message',
            body: 'traction_signal: Computable | value="Retention ratio / 60.00%" | evidence=dpu:doc:58595eb2:page:1 | reason=none',
          },
        ],
      },
    } as any;

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(reportWithPipeValue);
    render(<InvestorInsightsTab darkMode={false} dealId="deal-test-pipe" />);

    await screen.findByText('Traction Signal');
    // Full value must appear (not truncated at the slash)
    expect(screen.getByText('Retention ratio / 60.00%')).toBeTruthy();
    // Evidence ref must also survive
    expect(screen.getByText('dpu:doc:58595eb2:page:1')).toBeTruthy();
  });
});
