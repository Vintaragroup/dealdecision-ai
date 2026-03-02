import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AIDealAssistant } from '../AIDealAssistant';
import { apiChatDeal, apiRegenerateInvestorInsights } from '../../../lib/apiClient';

// JSDOM does not implement scrollIntoView — silence it globally for this suite.
Element.prototype.scrollIntoView = () => undefined;

vi.mock('../../../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/apiClient')>();
  return {
    ...actual,
    apiChatDeal: vi.fn(),
    apiRegenerateInvestorInsights: vi.fn(),
    isLiveBackend: vi.fn(() => true),
  };
});

const baseDeal = {
  id: 'deal-1',
  name: 'Demo Deal',
  company: 'AcmeCorp',
  type: 'series-a',
  stage: 'Series A',
  investmentAmount: 1_000_000,
  industry: 'SaaS',
  targetMarket: 'Enterprise',
  fundingAmount: '$1M',
  revenue: '$0',
  customers: '0',
  teamSize: '5',
  description: 'Demo',
  estimatedSavings: { money: 1000, hours: 10 },
} as const;

const renderAssistant = (props?: Partial<React.ComponentProps<typeof AIDealAssistant>>) => {
  return render(
    <AIDealAssistant
      darkMode={false}
      isOpen={true}
      onClose={vi.fn()}
      dealData={baseDeal}
      dealId="deal-1"
      dioVersionId="v1"
      {...props}
    />,
  );
};

describe('AIDealAssistant — suggested action callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sendMessageAndWaitForAction = async (actionType: string, actionLabel: string) => {
    vi.mocked(apiChatDeal).mockResolvedValueOnce({
      message: 'Here is what I found.',
      confidence: 'high',
      suggested_actions: [{ type: actionType as any }],
    } as any);

    const input = screen.getByPlaceholderText(/ask ai anything about this deal/i);
    await userEvent.type(input, 'show me the report');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: new RegExp(actionLabel, 'i') })).toBeInTheDocument();
    });

    return screen.getByRole('button', { name: new RegExp(actionLabel, 'i') });
  };

  test('OPEN_FULL_REPORT button calls onOpenFullReport when provided', async () => {
    const onOpenFullReport = vi.fn();
    renderAssistant({ onOpenFullReport });

    const btn = await sendMessageAndWaitForAction('OPEN_FULL_REPORT', 'View Full Report');
    await userEvent.click(btn);

    expect(onOpenFullReport).toHaveBeenCalledOnce();
  });

  test('OPEN_FULL_REPORT button is a no-op (does not throw) when onOpenFullReport is absent', async () => {
    renderAssistant({ onOpenFullReport: undefined });

    const btn = await sendMessageAndWaitForAction('OPEN_FULL_REPORT', 'View Full Report');
    await expect(userEvent.click(btn)).resolves.not.toThrow();
  });

  test('EXPORT_PDF button calls onOpenExportPdf when provided', async () => {
    const onOpenExportPdf = vi.fn();
    renderAssistant({ onOpenExportPdf });

    const btn = await sendMessageAndWaitForAction('EXPORT_PDF', 'Export PDF');
    await userEvent.click(btn);

    expect(onOpenExportPdf).toHaveBeenCalledOnce();
  });

  test('EXPORT_PDF button is a no-op (does not throw) when onOpenExportPdf is absent', async () => {
    renderAssistant({ onOpenExportPdf: undefined });

    const btn = await sendMessageAndWaitForAction('EXPORT_PDF', 'Export PDF');
    await expect(userEvent.click(btn)).resolves.not.toThrow();
  });

  test('onOpenFullReport is not called for unrelated action types', async () => {
    const onOpenFullReport = vi.fn();
    vi.mocked(apiChatDeal).mockResolvedValueOnce({
      message: 'Regenerating.',
      confidence: 'medium',
      suggested_actions: [{ type: 'REGENERATE_INSIGHTS' }],
    } as any);
    vi.mocked(apiRegenerateInvestorInsights).mockResolvedValue(undefined as any);

    renderAssistant({ onOpenFullReport });

    const input = screen.getByPlaceholderText(/ask ai anything about this deal/i);
    await userEvent.type(input, 'regenerate');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /regenerate insights/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /regenerate insights/i }));
    expect(onOpenFullReport).not.toHaveBeenCalled();
  });
});
