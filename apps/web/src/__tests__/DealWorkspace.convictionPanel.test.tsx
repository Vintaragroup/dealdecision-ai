import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealReport } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isAnalyst: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetDeal: vi.fn(),
    apiGetDealReport: vi.fn(),
    apiPostAnalyze: vi.fn(),
    apiPostAnalyzeWithStatus: vi.fn(),
    apiPostReextractDocuments: vi.fn(),
    apiPostExtractVisuals: vi.fn(),
    apiGetDealReadiness: vi.fn(),
    apiGetDealJobs: vi.fn(async () => []),
    apiGetJob: vi.fn(),
    isLiveBackend: vi.fn(() => true),
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
    apiGetDealReportNarrated: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealGovernedOverlayPersisted: vi.fn(async () => ({ overview: null } as any)),
    apiGetDealDeterministicUnderstanding: vi.fn(async () => null as any),
    apiPostDealDeterministicUnderstanding: vi.fn(async () => ({
      analysis_version: 'deterministic_understanding_v1',
      input_hash: 'test',
      created_at: new Date(0).toISOString(),
      patch: { analysis_version: 'deterministic_understanding_v1', created_at: new Date(0).toISOString(), input_hash: 'test', deal_id: 'deal-1', pages: {}, documents: {} },
    } as any)),
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

const convictionFixture = (dealId: string, score: number, policy: string) => ({
  schema_version: 'conviction_v1',
  selected_policy_id: policy,
  conviction_score_0_100: score,
  conviction_band: score >= 65 ? 'medium' : 'low',
  recommendation_posture: score >= 60 ? 'further_diligence' : 'do_not_invest',
  confidence_0_1: 0.72,
  coverage_ratio_0_1: 0.63,
  contradiction_index_0_1: 0.18,
  top_positive_contributors: [
    { key: 'financial_truth', label: 'Financial Truth', score_delta_0_100: 12 },
    { key: 'traction_validation', label: 'Traction Validation', score_delta_0_100: 9 },
  ],
  top_negative_contributors: [
    { key: 'risk_dependencies', label: 'Risk Dependencies', score_delta_0_100: -8 },
  ],
  unknowns: [{ code: 'unknown_external_corroboration', text: 'External corroboration is currently unknown.', evidence_refs: [] }],
  contradictions: [{ text: 'Forecast growth exceeds cited history.', severity: 'medium', evidence_refs: [] }],
  required_next_checks: [{ text: 'Provide customer cohort retention data.', expected_direction: 'clarify', evidence_refs: [] }],
  lineage: { generated_at: new Date(0).toISOString(), mapping_version: 'phase2_deterministic_v1', source_artifacts: [] },
  _deal_id_for_test: dealId,
});

function reportEnvelope(dealId: string, score: number, policy: string): any {
  const conviction = convictionFixture(dealId, score, policy);
  return {
    ready: true,
    version: 1,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-${dealId}`, analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2024-01-02T00:00:00.000Z',
      version: 1,
      overallScore: score,
      recommendation: 'yes',
      conviction_v1: conviction,
      sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
      structured_summary: {
        kpis: {
          raise: { value: '$2M', sources: [] },
        },
      },
      metadata: {
        score_band_v2: { key: 'good', label: 'Good', overall_score: score, thresholds_version: 'v2' },
      },
    },
  };
}

describe('DealWorkspace conviction panel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);
  });

  test('renders conviction panel sections from API conviction_v1 payload only', async () => {
    vi.mocked(apiGetDealReport).mockResolvedValue(reportEnvelope('deal-1', 66, 'operating_startup_revenue_v1'));

    render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-1" dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

    const panel = await screen.findByTestId('conviction-panel');

    expect(within(panel).getByText('Conviction Summary')).toBeInTheDocument();
    expect(within(panel).getByText('66')).toBeInTheDocument();
    expect(within(panel).getByText('medium')).toBeInTheDocument();
    expect(within(panel).getByText('further_diligence')).toBeInTheDocument();
    expect(within(panel).getByText('72%')).toBeInTheDocument();
    expect(within(panel).getByText('63%')).toBeInTheDocument();

    expect(within(panel).getByText('Why This Score')).toBeInTheDocument();
    expect(within(panel).getByText('What Needs to Be Proven')).toBeInTheDocument();
    expect(within(panel).getByText('Risk / Contradictions')).toBeInTheDocument();

    expect(within(panel).getByText(/External corroboration is currently unknown/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Provide customer cohort retention data/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Forecast growth exceeds cited history/i)).toBeInTheDocument();
  });

  test('conviction panel remains report-driven across deal switching and tab changes', async () => {
    vi.mocked(apiGetDealReport).mockImplementation(async (dealId: string) => {
      if (dealId === 'deal-A') return reportEnvelope('deal-A', 61, 'real_estate_underwriting');
      if (dealId === 'deal-B') return reportEnvelope('deal-B', 44, 'execution_ready_v1');
      return reportEnvelope('deal-default', 50, 'operating_startup_revenue_v1');
    });

    const rendered = render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-A" dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

    await waitFor(() => {
      const panel = screen.getByTestId('conviction-panel');
      expect(within(panel).getByText('61')).toBeInTheDocument();
      expect(within(panel).getByText('real_estate_underwriting')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /documents/i }));
    fireEvent.click(screen.getByRole('tab', { name: /overview/i }));

    await waitFor(() => {
      const panel = screen.getByTestId('conviction-panel');
      expect(within(panel).getByText('61')).toBeInTheDocument();
    });

    rendered.rerender(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-B" dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

    await waitFor(() => {
      const panel = screen.getByTestId('conviction-panel');
      expect(within(panel).getByText('44')).toBeInTheDocument();
      expect(within(panel).getByText('execution_ready_v1')).toBeInTheDocument();
      expect(within(panel).queryByText('61')).toBeNull();
    });
  });
});
