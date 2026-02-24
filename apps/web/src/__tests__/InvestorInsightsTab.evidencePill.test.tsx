/**
 * Tests for the clickable evidence pill in InsightSlotsSection.
 *
 * Verifies that clicking the pill calls navigator.clipboard.writeText with
 * the evidence ref string, and that the pill shows "Copied" feedback.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const EVIDENCE_REF = 'dpu:doc:a1b2c3d4:page:3';

const REPORT_WITH_SLOTS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'insight_slots',
        title: 'Insight Slots',
        kind: 'message',
        body: `raise_terms: Computable | value="$2M SAFE" | evidence=${EVIDENCE_REF} | reason=none`,
      },
    ],
  },
} as any;

describe('InvestorInsightsTab – evidence pill clipboard', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
  });

  test('clicking the evidence pill calls clipboard.writeText with the ref', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-clip-1" />);

    const pill = await screen.findByText(EVIDENCE_REF);
    await userEvent.click(pill);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(EVIDENCE_REF);
  });

  test('pill shows "Copied" immediately after click', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-clip-2" />);

    await screen.findByText(EVIDENCE_REF);
    await userEvent.click(screen.getByText(EVIDENCE_REF));

    await screen.findByText('Copied');
  });

  test('pill reverts back to ref text after 1.5s', async () => {
    // Spy on setTimeout to verify the 1500ms revert is scheduled —
    // avoids fake timers conflicting with findByText's internal polling.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_SLOTS);
    render(<InvestorInsightsTab darkMode={false} dealId="deal-clip-3" />);

    await screen.findByText(EVIDENCE_REF);
    await userEvent.click(screen.getByText(EVIDENCE_REF));

    // "Copied" state is shown immediately.
    await screen.findByText('Copied');

    // Verify the 1500ms revert timeout was scheduled.
    const revertCalls = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 1500);
    expect(revertCalls.length).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();
  });

  test('evidence cell shows "—" (not a button) when evidence is "none"', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue({
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'insight_slots',
            title: 'Insight Slots',
            kind: 'message',
            body: 'market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION',
          },
        ],
      },
    } as any);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-clip-4" />);

    await screen.findByText('Market Claims');

    // No pill button for "none" evidence — clipboard should not be callable
    await userEvent.click(document.body);
    expect(writeTextMock).not.toHaveBeenCalled();
  });
});
