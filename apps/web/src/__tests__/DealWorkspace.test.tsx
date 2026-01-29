import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealJobs, apiGetJob } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isAnalyst: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetDeal: vi.fn(),
    apiPostAnalyze: vi.fn(),
    apiPostReextractDocuments: vi.fn(),
    apiPostExtractVisuals: vi.fn(),
    apiGetDealJobs: vi.fn(async () => []),
    apiGetJob: vi.fn(),
    isLiveBackend: vi.fn(() => true),
    // Non-critical: keep these as no-ops unless a test asserts on them.
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
    apiGetDealReport: vi.fn(async () => null as any),
    subscribeToEvents: vi.fn(() => () => undefined),
    apiResolveEvidence: vi.fn(async () => ({ results: [] } as any)),
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWorkspace = (overrides?: Partial<React.ComponentProps<typeof DealWorkspace>>) => {
    return render(
      <ScoreSourceProvider>
        <DealWorkspace
          darkMode={false}
          dealId="deal-1"
          dealData={baseDeal}
          {...overrides}
        />
      </ScoreSourceProvider>
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

    const jobCenter = screen.getByTestId('job-center');
    expect(jobCenter.className).toMatch(/\bw-full\b/);
    expect(jobCenter.className).toMatch(/\bmax-w-full\b/);

    // Avoid matching both "Active job" and "No active job".
    expect(screen.getByText(/^Active job$/i)).toBeInTheDocument();
    expect(screen.getByText(/None yet/i)).toBeInTheDocument();
    expect(screen.getByText(/idle/i)).toBeInTheDocument();

    const statusMsg = screen.getByTestId('job-center-status-message');
    expect(statusMsg.textContent || '').toMatch(/Waiting for worker update/i);
    expect(statusMsg.className).toMatch(/\boverflow-hidden\b/);
    expect(statusMsg.className).toMatch(/\bwhitespace-pre-wrap\b/);
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

  test('Extract visuals button triggers apiPostExtractVisuals', async () => {
    const { apiPostAnalyze, apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v3', dioStatus: 'ready' } as any);
    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-rex-1', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-viz-1', status: 'queued' } as any);
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-an-1', status: 'queued' } as any);

    // Make polling complete immediately for each step.
    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      return {
        job_id: jobId,
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: new Date().toISOString(),
      } as any;
    });

    renderWorkspace({ dealId: 'deal-5' });

    const runFullProcessButton = screen.getByRole('button', { name: /Run full process/i });
    await userEvent.click(runFullProcessButton);

    await waitFor(() => expect(apiPostExtractVisuals).toHaveBeenCalled());
    expect(vi.mocked(apiPostExtractVisuals).mock.calls[0]?.[0]).toBe('deal-5');
    expect(vi.mocked(apiPostExtractVisuals).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        source: 'job-center/run-full-process',
        requestId: expect.any(String),
        idempotencyKey: expect.any(String),
      })
    );
  });

  test('Run full process does not submit extract-visuals twice on rapid double-click', async () => {
    const { apiPostAnalyze, apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v3', dioStatus: 'ready' } as any);
    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-rex-1', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-viz-1', status: 'queued' } as any);
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-an-1', status: 'queued' } as any);

    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      return {
        job_id: jobId,
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: new Date().toISOString(),
      } as any;
    });

    renderWorkspace({ dealId: 'deal-55' });

    const runFullProcessButton = screen.getByRole('button', { name: /Run full process/i });
    await userEvent.dblClick(runFullProcessButton);

    await waitFor(() => expect(apiPostReextractDocuments).toHaveBeenCalledTimes(1));
    expect(apiPostExtractVisuals).toHaveBeenCalledTimes(1);
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
      expect(screen.getByText(/^Currently processing:/i)).toBeInTheDocument();
      // Message can appear in multiple UI locations.
      expect(screen.getAllByText(/^Crunching signals$/i).length).toBeGreaterThan(0);
    });
  });

  test('stall detection prefers progress heartbeat timestamp over updated_at', async () => {
    const { apiPostAnalyze } = await import('../lib/apiClient');

    const nowMs = new Date('2024-01-04T00:02:00.000Z').getTime();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v4', dioStatus: 'running' } as any);
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-hb-1', status: 'queued' } as any);

    // updated_at is old enough to be considered stalled, but progress.at is recent.
    vi.mocked(apiGetJob).mockResolvedValue({
      job_id: 'job-hb-1',
      type: 'analyze_deal',
      status: 'running',
      progress_pct: 50,
      message: 'Still working',
      updated_at: '2024-01-04T00:00:00.000Z',
      status_detail: {
        progress: {
          at: '2024-01-04T00:01:30.000Z',
          stage: 'running',
          message: 'Heartbeat tick',
          percent: 50,
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-hb' });

    await waitFor(() => {
      expect(screen.getByText(/Job Center/i)).toBeInTheDocument();
    });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    await waitFor(() => {
      expect(apiGetJob).toHaveBeenCalled();
      expect(screen.queryByText(/Running \(stalled\)/i)).not.toBeInTheDocument();
    });

    nowSpy.mockRestore();
  });

  test('does not pin to stale failed analyze when newer succeeded exists', async () => {
    const { apiGetDealJobs, apiPostAnalyze, apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-01-02T00:00:35.000Z'));

    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-111', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-222', status: 'queued' } as any);

    // Full process should NOT enqueue analyze_deal directly.
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-should-not-be-called', status: 'queued' } as any);

    let allowFailedAnalyze = false;
    let allowSucceededAnalyze = false;
    vi.mocked(apiGetDealJobs).mockImplementation(async () => {
      // Initially: analyze job hasn't been enqueued yet.
      if (!allowFailedAnalyze) return [] as any;

      if (!allowSucceededAnalyze) {
        return [
          {
            job_id: 'job-333',
            type: 'analyze_deal',
            status: 'failed',
            message: 'No extracted documents available for analysis',
            created_at: '2024-01-02T00:01:00.000Z',
            updated_at: '2024-01-02T00:01:10.000Z',
          },
        ] as any;
      }
      return [
        {
          job_id: 'job-333',
          type: 'analyze_deal',
          status: 'failed',
          message: 'No extracted documents available for analysis',
          created_at: '2024-01-02T00:01:00.000Z',
          updated_at: '2024-01-02T00:01:10.000Z',
        },
        {
          job_id: 'job-new-ok',
          type: 'analyze_deal',
          status: 'succeeded',
          message: 'Completed newer analysis',
          progress_pct: 100,
          created_at: '2024-01-02T00:01:20.000Z',
          updated_at: '2024-01-02T00:01:25.000Z',
        },
      ] as any;
    });

    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      let extractPoll = (vi.mocked(apiGetJob) as any).__extractPollCount ?? 0;
      (vi.mocked(apiGetJob) as any).__extractPollCount = extractPoll;

      if (jobId === 'job-111') {
        return {
          job_id: 'job-111',
          type: 'reextract_documents',
          status: 'succeeded',
          progress_pct: 100,
          message: 'ok',
          updated_at: '2024-01-02T00:00:00.000Z',
          created_at: '2024-01-02T00:00:00.000Z',
        };
      }
      if (jobId === 'job-222') {
        extractPoll = ((vi.mocked(apiGetJob) as any).__extractPollCount ?? 0) + 1;
        (vi.mocked(apiGetJob) as any).__extractPollCount = extractPoll;
        if (extractPoll === 1) {
          return {
            job_id: 'job-222',
            type: 'extract_visuals',
            status: 'running',
            progress_pct: 10,
            message: 'Working',
            updated_at: '2024-01-02T00:00:00.000Z',
            created_at: '2024-01-02T00:00:00.000Z',
          };
        }
        return {
          job_id: 'job-222',
          type: 'extract_visuals',
          status: 'succeeded',
          progress_pct: 100,
          message: 'ok',
          created_at: '2024-01-02T00:00:00.000Z',
          finished_at: '2024-01-02T00:00:30.000Z',
          updated_at: '2024-01-02T00:00:30.000Z',
        };
      }
      if (jobId === 'job-333') {
        return {
          job_id: 'job-333',
          type: 'analyze_deal',
          status: 'failed',
          progress_pct: 100,
          message: 'No extracted documents available for analysis',
          updated_at: '2024-01-02T00:01:10.000Z',
          created_at: '2024-01-02T00:01:00.000Z',
        };
      }
      if (jobId === 'job-new-ok') {
        return {
          job_id: 'job-new-ok',
          type: 'analyze_deal',
          status: 'succeeded',
          progress_pct: 100,
          message: 'Completed newer analysis',
          updated_at: '2024-01-02T00:02:20.000Z',
          created_at: '2024-01-02T00:02:00.000Z',
        };
      }
      return {
        job_id: jobId,
        type: 'analyze_deal',
        status: 'succeeded',
        progress_pct: 100,
        message: 'ok',
        updated_at: '2024-01-04T00:00:00.000Z',
        created_at: '2024-01-04T00:00:00.000Z',
      };
    });

    renderWorkspace({ dealId: 'deal-supersede', dealData: null as any });
    const user = userEvent.setup();

    // This mock is used by other tests in this file; clear history so we only assert on this scenario.
    vi.mocked(apiPostAnalyze).mockClear();

    await user.click(screen.getByRole('button', { name: /run full process/i }));

    // Analyze should not be enqueued directly by the UI.
    expect(apiPostAnalyze).not.toHaveBeenCalled();

    // While extraction is still running/finalizing and no analyze job exists yet, the Analyze step should have no job id.
    const analyzeStep = await screen.findByTestId('full-process-step-analyze_deal');
    await waitFor(() => {
      expect(within(analyzeStep).getByText(/job\s+—/i)).toBeInTheDocument();
    });

    // Now simulate the backend enqueueing analyze jobs tied to the extract run.
    allowFailedAnalyze = true;

    // The first observed analyze job fails quickly, but during the run grace window we should *not* flash Failed.
    await waitFor(
      () => {
        const step = screen.getByTestId('full-process-step-analyze_deal');
        expect(within(step).queryByText(/failed/i)).not.toBeInTheDocument();
        expect(within(step).getAllByText(/Preparing analysis/i).length).toBeGreaterThan(0);
      },
      { timeout: 7000 }
    );

    // Now allow the newer succeeded analyze to appear.
    allowSucceededAnalyze = true;

    await waitFor(
      () => {
        expect(screen.queryByText(/Analyze deal failed/i)).not.toBeInTheDocument();
      },
      { timeout: 7000 }
    );

    await waitFor(
      () => {
        expect(screen.getByText(/Full process completed/i)).toBeInTheDocument();
        expect(screen.getByText(/job job-new-ok/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Completed newer analysis/i).length).toBeGreaterThan(0);
      },
      { timeout: 7000 }
    );

    nowSpy.mockRestore();
  }, 15000);

  test('renders Job Center even when backend mode is not live', async () => {
    const { isLiveBackend } = await import('../lib/apiClient');
    vi.mocked(isLiveBackend).mockReturnValue(false);

    vi.mocked(apiGetDeal).mockResolvedValue({} as any);
    renderWorkspace({ dealId: 'deal-8' });

    await waitFor(() => {
      expect(screen.getByText(/Job Center/i)).toBeInTheDocument();
    });
  });

  test('Recent jobs aggregates mixed chunk outcomes as Done (warn), not Failed', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v5', dioStatus: 'ready', lastAnalyzedAt: null } as any);

    const now = new Date().toISOString();
    vi.mocked(apiGetDealJobs).mockResolvedValue([
      {
        job_id: 'parent-1',
        queue: 'extract_visuals',
        type: 'extract_visuals',
        status: 'failed',
        progress_pct: 100,
        created_at: now,
        updated_at: now,
        deal_id: 'deal-8',
      },
      {
        job_id: 'child-1',
        queue: 'extract_visuals',
        type: 'extract_visuals',
        status: 'failed',
        progress_pct: 100,
        parent_job_id: 'parent-1',
        created_at: now,
        updated_at: now,
        deal_id: 'deal-8',
      },
      {
        job_id: 'child-2',
        queue: 'extract_visuals',
        type: 'extract_visuals',
        status: 'succeeded',
        progress_pct: 100,
        parent_job_id: 'parent-1',
        created_at: now,
        updated_at: now,
        deal_id: 'deal-8',
      },
    ] as any);

    renderWorkspace({ dealId: 'deal-8' });

    await waitFor(() => {
      expect(screen.getByText(/Job Center/i)).toBeInTheDocument();
    });

    // Expand accordion
    const recentJobs = screen.getByText(/Recent jobs/i);
    await userEvent.click(recentJobs);

    await waitFor(() => {
      expect(screen.getByText(/Done \(warn\)/i)).toBeInTheDocument();
    });
  });
});
