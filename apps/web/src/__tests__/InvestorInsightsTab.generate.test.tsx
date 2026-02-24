import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { InvestorInsightsTab } from '../components/workspace/InvestorInsightsTab';
import { apiGenerateInvestorInsights, apiGetInvestorInsights } from '../lib/apiClient';

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

const FAILED_REPORT = {
  status: 'failed',
  render_package: {
    sections: [
      {
        key: 'gate_state',
        title: 'Gate Evaluation',
        kind: 'gate_state',
        items: [{ gate: 'G0', passed: false, reason_code: 'NO_DOCUMENTS' }],
      },
      {
        key: 'summary',
        title: 'Summary',
        kind: 'message',
        body: 'Gates did not pass.',
      },
    ],
  },
} as any;

describe('InvestorInsightsTab – generate button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('clicking Generate Investor Insights calls apiGenerateInvestorInsights once with the deal id', async () => {
    render(<InvestorInsightsTab darkMode={false} dealId="deal-abc-123" />);

    const btn = await screen.findByRole('button', { name: /generate investor insights/i });
    expect(btn).toBeTruthy();

    await userEvent.click(btn);

    await waitFor(() => {
      expect(vi.mocked(apiGenerateInvestorInsights)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(apiGenerateInvestorInsights)).toHaveBeenCalledWith('deal-abc-123');
  });

  test('renders gate table when report status is failed with sections, no "Not generated yet" placeholder', async () => {
    vi.mocked(apiGetInvestorInsights).mockResolvedValue(FAILED_REPORT);

    render(<InvestorInsightsTab darkMode={false} dealId="deal-abc-123" />);

    // Gate row "G0" should be visible.
    await screen.findByText('G0');

    expect(screen.queryByText(/not generated yet/i)).toBeNull();
    // Failure banner visible without clicking generate.
    expect(screen.getByText(/generation failed \(see gates below\)/i)).toBeTruthy();
  });

  test('queued banner clears and failure banner shows when post-generate refresh returns failed', async () => {
    // First call (mount): not_started so Generate button is visible.
    // Second call (after generate → refresh): failed with sections.
    vi.mocked(apiGetInvestorInsights)
      .mockResolvedValueOnce({ status: 'not_started' } as any)
      .mockResolvedValue(FAILED_REPORT);
    vi.mocked(apiGenerateInvestorInsights).mockResolvedValue({ ok: true });

    render(<InvestorInsightsTab darkMode={false} dealId="deal-abc-123" />);

    const btn = await screen.findByRole('button', { name: /generate investor insights/i });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.queryByText(/generation queued/i)).toBeNull();
    });

    expect(screen.getByText(/generation failed \(see gates below\)/i)).toBeTruthy();
  });
});

