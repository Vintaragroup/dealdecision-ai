import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isAnalyst: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetDeal: vi.fn(),
    apiPostAnalyze: vi.fn(),
    apiPostAnalyzeWithStatus: vi.fn(),
    apiPostReextractDocuments: vi.fn(),
    apiPostExtractVisuals: vi.fn(),
    apiGetDealReadiness: vi.fn(),
    apiGetDealJobs: vi.fn(async () => []),
    apiGetJob: vi.fn(),
    isLiveBackend: vi.fn(() => true),
    // Non-critical: keep these as no-ops unless a test asserts on them.
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
    apiGetDealReport: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
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

describe('DealWorkspace raise display (canonical)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWorkspace = (dealId: string) => {
    return render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId={dealId} dealData={baseDeal} />
      </ScoreSourceProvider>,
    );
  };

  test('shows amount-only from structured_summary.raise.value_json.amount.amount and renders round_label separately (no concatenation)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-raise-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-raise-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        structured_summary: {
          raise: {
            value: '$2M',
            round_label: 'Pre-Seed',
            value_json: { amount: { amount: 2000000 } },
            sources: [{ document_id: 'doc-1', page_index: 1 }],
          },
          // Intentionally include legacy/overlay-friendly strings to ensure they do not override canonical amount.
          kpis: {
            raise: { value: '$2M Pre-Seed', confidence: 0.9, sources: [{ document_id: 'doc-legacy', page_index: 1 }] },
            revenue: { value: { raw: '$1.2M' }, sources: [] },
            customers: { value: { count: 450, kind: 'customers', raw: null }, sources: [] },
            growth: { value: { raw: '50% YoY' }, sources: [] },
            business_model: { value: 'SaaS', sources: [] },
          },
        },
        metadata: {
          score_explanation: {
            context: {
              stage: 'in_diligence',
              // Another drift source: should never be used when canonical numeric is present.
              raise: 'Pre-Seed $2M',
            },
          },
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    renderWorkspace('deal-raise-1');

    const top = await screen.findByLabelText('Deal top summary');
    const raiseLabel = within(top).getByText(/^Raise$/i);
    const raiseCard = raiseLabel.parentElement;
    expect(raiseCard).not.toBeNull();

    expect(within(raiseCard as HTMLElement).getByText(/^\$2M$/i)).toBeInTheDocument();
    expect(within(raiseCard as HTMLElement).getByText(/^Pre-Seed$/i)).toBeInTheDocument();
    expect(within(raiseCard as HTMLElement).queryByText(/\$2M\s*Pre-Seed/i)).toBeNull();

    // Sanity check: overview still loads.
    await userEvent.click(screen.getByRole('tab', { name: /^overview$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('key-fact-raise')).toBeInTheDocument();
    });
  });
});
