import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { apiGetDeal, apiGetJob } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isFounder: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', () => {
  const apiGetDeal = vi.fn();
  const apiPostAnalyze = vi.fn();
  const apiGetJob = vi.fn();
  return {
    isLiveBackend: () => true,
    apiGetDeal,
    apiPostAnalyze,
    apiGetJob,
  };
});

const baseDeal = {
  id: 'deal-1',
  name: 'Demo Deal',
  company: 'Demo Co',
  type: 'series-a',
  stage: 'Series A',
  investmentAmount: 1000000,
  industry: 'SaaS',
  targetMarket: 'Enterprise',
  fundingAmount: '$1M',
  revenue: '$0',
  customers: '0',
  teamSize: '5',
  description: 'Demo',
  estimatedSavings: { money: 1000, hours: 10 },
} as const;

describe('DealWorkspace Job Center (live mode)', () => {
  const renderWorkspace = (overrides?: Partial<React.ComponentProps<typeof DealWorkspace>>) => {
    return render(
      <DealWorkspace
        darkMode={false}
        dealId="deal-1"
        dealData={baseDeal}
        {...overrides}
      />
    );
  };

  test('renders DIO badges and Job Center placeholders', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText(/DIO: v1.0.0/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Job Center/i)).toBeInTheDocument();
    expect(screen.getByText(/Active job/i)).toBeInTheDocument();
    expect(screen.getByText(/None yet/i)).toBeInTheDocument();
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for worker update/i)).toBeInTheDocument();
  });

  test('AI Assistant button is gated without DIO in live mode', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: undefined,
      dioStatus: 'missing',
      lastAnalyzedAt: null,
    } as any);

    renderWorkspace({ dealId: 'deal-2' });

    // Wait for fetch to settle
    await waitFor(() => {
      expect(screen.getByText(/DIO: Not generated/i)).toBeInTheDocument();
    });

    const aiButton = screen.getByRole('button', { name: /AI Assistant/i });
    expect(aiButton).toBeDisabled();
  });

  test('AI Assistant button enables when DIO exists', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-03T00:00:00.000Z',
    } as any);

    renderWorkspace({ dealId: 'deal-3' });

    await waitFor(() => {
      expect(screen.getByText(/DIO: v2.0.0/i)).toBeInTheDocument();
    });

    const aiButton = screen.getByRole('button', { name: /AI Assistant/i });
    expect(aiButton).not.toBeDisabled();
  });

  test('Run Analysis button (header) does not call api when dealId missing', async () => {
    const { apiPostAnalyze } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({} as any);
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-x', status: 'queued' } as any);

    renderWorkspace({ dealId: undefined });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    expect(apiPostAnalyze).not.toHaveBeenCalled();
  });

  test('Run Analysis triggers apiPostAnalyze and shows loading state', async () => {
    const { apiPostAnalyze } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v3', dioStatus: 'ready' } as any);
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-99', status: 'queued' } as any);

    renderWorkspace({ dealId: 'deal-4' });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    expect(headerRunButton).toBeEnabled();

    await userEvent.click(headerRunButton);

    await waitFor(() => expect(apiPostAnalyze).toHaveBeenCalledWith('deal-4'));
  });

  test('Job Center shows progress bar when job reports progress', async () => {
    const { apiPostAnalyze } = await import('../lib/apiClient');

    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v4',
      dioStatus: 'running',
      lastAnalyzedAt: '2024-01-04T00:00:00.000Z',
    } as any);

    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-777', status: 'queued' } as any);

    vi.mocked(apiGetJob)
      .mockResolvedValueOnce({
        job_id: 'job-777',
        status: 'running',
        progress_pct: 42,
        message: 'Crunching signals',
        updated_at: '2024-01-04T00:10:00.000Z',
      } as any)
      .mockResolvedValueOnce({
        job_id: 'job-777',
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: '2024-01-04T00:10:05.000Z',
      } as any);

    renderWorkspace({ dealId: 'deal-7' });

    await waitFor(() => {
      expect(screen.getByText(/DIO: v4/i)).toBeInTheDocument();
    });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    await waitFor(() => {
      expect(apiGetJob).toHaveBeenCalled();
      expect(screen.getByText(/42% complete/i)).toBeInTheDocument();
      expect(screen.getByText(/Crunching signals/i)).toBeInTheDocument();
    });
  });
});
