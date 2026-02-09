import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealReport, apiGetDealReportNarrated } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isAnalyst: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetDeal: vi.fn(),
    apiGetDealReport: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealReportNarrated: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealJobs: vi.fn(async () => []),
    apiGetJob: vi.fn(async () => ({ job_id: 'job-1', status: 'queued' } as any)),
    apiPostAnalyze: vi.fn(async () => ({ job_id: 'job-1', status: 'queued' } as any)),
    apiPostAnalyzeWithStatus: vi.fn(async () => ({ ok: true, status: 202, json: { job_id: 'job-1', status: 'queued' }, text: null } as any)),
    apiGetDealReadiness: vi.fn(async () => ({ ready: true } as any)),
    isLiveBackend: vi.fn(() => true),
    subscribeToEvents: vi.fn(() => () => undefined),
    apiResolveEvidence: vi.fn(async () => ({ results: [] } as any)),
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
  };
});

const baseDeal = {
  id: 'deal-1',
  name: 'Demo Deal',
} as any;

describe('DealWorkspace governed overlay fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWorkspace = (overrides?: Partial<React.ComponentProps<typeof DealWorkspace>>) => {
    return render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-1" dealData={baseDeal} {...overrides} />
      </ScoreSourceProvider>
    );
  };

  test('does not fetch narrated report on mount; fetches only after user opens interpretation panel', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'dio-1', dioStatus: 'ready' } as any);

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [],
        structured_summary: {
          raise: { value: '$2M Seed', confidence: 0.9, sources: [] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [] },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          decision_v1: { recommendation_key: 'consider', label: 'Consider', severity: 'warn', reasons: [] },
        },
      },
    } as any);

    vi.mocked(apiGetDealReportNarrated).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        metadata: {},
        llm_overview_v1: {
          version: 'llm_overview_v1',
          investment_analysis_overview: 'Interpretation text',
        },
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();

    // Ensure deterministic report is rendered/bound before requesting interpretation.
    await waitFor(() => {
      expect(screen.getAllByText(/\$2M Seed/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Usage-based SaaS/i).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByRole('button', { name: /show interpretation/i }));

    await waitFor(() => {
      expect(apiGetDealReportNarrated).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Generating interpretation…|Interpretation text|Interpretation unavailable/i)).toBeInTheDocument();
  });

  test('does not fetch narrated report if deterministic report is not ready yet', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: null, dioStatus: 'idle' } as any);
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({ ready: false, reason: 'not_generated_yet' } as any);

    renderWorkspace({ dealId: 'deal-not-ready' as any });

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByRole('button', { name: /show interpretation/i }));

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
  });
});
