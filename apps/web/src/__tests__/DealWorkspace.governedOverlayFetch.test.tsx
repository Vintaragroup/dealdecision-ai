import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealReport, apiGetDealReportNarrated, apiGetDealGovernedOverlayPersisted } from '../lib/apiClient';

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
    apiGetDealGovernedOverlayPersisted: vi.fn(async () => ({ overview: null } as any)),
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

  test('prefers persisted overlay when available (no narrated fetch)', async () => {
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

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-1',
        input_hash: 'a'.repeat(64),
        created_at: '2024-01-02T00:00:00.000Z',
        llm_phase_mode: 'governed',
        summary_text: 'Persisted overlay summary',
        claims: [
          {
            claim_type: 'kpi',
            label: 'Revenue',
            value_string: '$1M ARR',
            value_number: null,
            unit: null,
            confidence: 0.8,
            evidence_refs: [{ document_id: 'doc-1', page_index: 3 }],
          },
        ],
        disclosures: [{ code: 'test', message: 'Disclosure message' }],
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
    expect(apiGetDealGovernedOverlayPersisted).not.toHaveBeenCalled();

    // Ensure deterministic report is rendered/bound before requesting interpretation.
    await waitFor(() => {
      expect(screen.getAllByText(/\$2M Seed/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Usage-based SaaS/i).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByRole('button', { name: /show interpretation/i }));

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
    expect(screen.getByText(/Persisted overlay summary/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1M ARR/i)).toBeInTheDocument();
  });

  test('falls back to narrated overlay when persisted is null', async () => {
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

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({ overview: null } as any);

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
          investment_analysis_overview: 'Narrated interpretation text',
        },
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/\$2M Seed/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Usage-based SaaS/i).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByRole('button', { name: /show interpretation/i }));

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
      expect(apiGetDealReportNarrated).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/Narrated interpretation text/i)).toBeInTheDocument();
  });

  test('overlay failures do not break deterministic rendering', async () => {
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

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockRejectedValueOnce(new Error('persisted_down'));
    vi.mocked(apiGetDealReportNarrated).mockRejectedValueOnce(new Error('narrated_down'));

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText(/\$2M Seed/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Usage-based SaaS/i).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByRole('button', { name: /show interpretation/i }));

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/No overlay generated/i)).toBeInTheDocument();
  });

  test('does not fetch narrated report if deterministic report is not ready yet', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: null, dioStatus: 'idle' } as any);
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({ ready: false, reason: 'not_generated_yet' } as any);

    renderWorkspace({ dealId: 'deal-not-ready' as any });

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByRole('button', { name: /show interpretation/i }));

    expect(apiGetDealGovernedOverlayPersisted).not.toHaveBeenCalled();
    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
  });
});
