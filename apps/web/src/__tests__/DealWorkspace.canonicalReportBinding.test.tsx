import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('DealWorkspace canonical report binding', () => {
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

  test('binds Raise KPI to compiled report kpis.raise.value and does not allow overlay to replace missing deterministic deal summary', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport, apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-canonical-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-canonical-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        // deterministic summary is missing / not-ready → should render blank (not overlay, no degraded copy)
        deal_summary: { ready: false },
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        structured_summary: {
          raise: {
            value_json: { amount: { amount: 2000000 } },
            sources: [{ document_id: 'doc-1', page_index: 1 }],
          },
          kpis: {
            raise: {
              value: '$2M',
              sources: [{ document_id: 'doc-kpi', page_index: 1 }],
            },
          },
        },
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    const overlayHeroSentence = 'OVERLAY HERO SENTENCE — SHOULD NOT BE PRIMARY';
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({
      overview: {
        created_at: new Date(0).toISOString(),
        llm_phase_mode: 'v1',
        overview_json: JSON.stringify({
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: overlayHeroSentence,
                paragraphs: [overlayHeroSentence],
              },
              strengths: [],
              risks: [],
              open_questions: [],
            },
            deal_overview_v2: {},
          },
        }),
      },
    } as any);

    renderWorkspace('deal-canonical-1');

    const top = await screen.findByLabelText('Deal top summary');

    await waitFor(() => {
      const raiseLabel = within(top).getByText(/^Raise$/i);
      const raiseCard = raiseLabel.parentElement;
      expect(raiseCard).not.toBeNull();
      expect(within(raiseCard as HTMLElement).getByText('$2M')).toBeInTheDocument();
    });

    // Raise is sourced from the compiled report (KPI block) and never rendered as "—".
    const raiseLabel = within(top).getByText(/^Raise$/i);
    const raiseCard = raiseLabel.parentElement;
    expect(raiseCard).not.toBeNull();
    expect(within(raiseCard as HTMLElement).getByText('$2M')).toBeInTheDocument();

    // Primary Deal Summary must not render overlay hero sentence when deterministic summary is missing.
    expect(within(top).queryByText(overlayHeroSentence)).toBeNull();
    expect(within(top).queryByText(/Deterministic deal summary unavailable\./i)).toBeNull();
    expect(within(top).queryByText(/Deterministic \(degraded\)/i)).toBeNull();

    // Current header exposes a single summary mirror for top-level assertions.
    const summaryMirror = screen.getByTestId('deal-summary-text');
    expect(summaryMirror).toBeInTheDocument();
    expect(summaryMirror).not.toHaveTextContent(overlayHeroSentence);
  });
});
