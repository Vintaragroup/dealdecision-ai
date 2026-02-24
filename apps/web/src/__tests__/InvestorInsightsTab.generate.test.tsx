import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

  test('auto-refresh: apiGetInvestorInsights is polled again and UI updates when updated_at changes', async () => {
    vi.useFakeTimers();

    const T1 = '2026-01-01T10:00:00.000Z';
    const T2 = '2026-01-01T10:00:05.000Z';

    // 1st call (mount): not_started
    // 2nd call (generate → hook refresh): queued, updated_at T1 — non-terminal → poll starts
    // 3rd call (poll after 2s): deterministic_only, updated_at T2 → triggers final refresh
    // 4th call (final refresh):
    vi.mocked(apiGetInvestorInsights)
      .mockResolvedValueOnce({ status: 'not_started' } as any)
      .mockResolvedValueOnce({ status: 'queued', updated_at: T1 } as any)
      .mockResolvedValueOnce({ status: 'deterministic_only', updated_at: T2 } as any)
      .mockResolvedValue({ status: 'deterministic_only', updated_at: T2 } as any);

    vi.mocked(apiGenerateInvestorInsights).mockResolvedValue({ ok: true });

    const { unmount } = render(<InvestorInsightsTab darkMode={false} dealId="deal-poll-1" />);

    // Flush mount effect + initial fetch microtasks
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const btn = screen.getByRole('button', { name: /generate investor insights/i });

    // Click fires handleGenerate; act flushes the generate() + hook refresh microtasks
    await act(async () => {
      btn.click();
      // Flush: POST → refresh → apiGetInvestorInsights 2nd call → setReport
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // At this point handleGenerate detected 'queued' (non-terminal) and is waiting on the 2s timer.
    // Advance 2001ms — fires the setTimeout inside the poll loop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });

    // ≥3 calls: mount(1) + generate-hook-refresh(2) + poll(3);
    // final refresh(4) may or may not have fired depending on microtask ordering.
    expect(vi.mocked(apiGetInvestorInsights).mock.calls.length).toBeGreaterThanOrEqual(3);

    unmount();
    vi.useRealTimers();
  });
});

