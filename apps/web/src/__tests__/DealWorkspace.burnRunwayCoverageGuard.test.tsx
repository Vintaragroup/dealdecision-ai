import { render, screen, within } from '@testing-library/react';
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
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
    apiGetDealReport: vi.fn(),
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

const renderWorkspace = (dealId: string) => {
  return render(
    <ScoreSourceProvider>
      <DealWorkspace darkMode={false} dealId={dealId} dealData={baseDeal} />
    </ScoreSourceProvider>,
  );
};

describe('DealWorkspace burn/runway coverage guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('Case A: if coverage says burn/runway not present, tiles render — even if structured_summary has values', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-burn-a', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-burn-a',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        financial_coverage_v1: {
          coverage: {
            burn_rate_present: false,
            runway_present: false,
          },
          evidence: {
            burn_rate_present: { document_id: 'doc-cov', page_index: 0, snippet: 'no burn evidence' },
            runway_present: { document_id: 'doc-cov', page_index: 0, snippet: 'no runway evidence' },
          },
        },
        structured_summary: {
          raise: { value_json: { amount: { amount: 2000000 } } },
          kpis: {
            burn_rate: { value: { monthly_usd: 125000, raw: '$125k/mo' }, sources: [{ document_id: 'doc-overlayish', page_index: 9 }] },
            runway_months: { value: { months: 18, raw: '18 months' }, sources: [{ document_id: 'doc-overlayish', page_index: 9 }] },
          },
        },
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    renderWorkspace('deal-burn-a');

    const top = await screen.findByLabelText('Deal top summary');

    const burnLabel = within(top).getByText(/^Burn$/i);
    const burnCard = burnLabel.parentElement;
    expect(burnCard).not.toBeNull();
    expect(within(burnCard as HTMLElement).getByText('—')).toBeInTheDocument();

    const runwayLabel = within(top).getByText(/^Runway$/i);
    const runwayCard = runwayLabel.parentElement;
    expect(runwayCard).not.toBeNull();
    expect(within(runwayCard as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  test('Case B: if burn coverage is present but numeric missing, tile shows — and panel shows Present (no value)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-burn-b', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-burn-b',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        financial_coverage_v1: {
          coverage: {
            burn_rate_present: true,
            runway_present: false,
          },
          evidence: {
            burn_rate_present: { document_id: 'doc-burn', page_index: 3, snippet: 'Burn evidence exists but value not numeric' },
          },
        },
        structured_summary: {
          raise: { value_json: { amount: { amount: 2000000 } } },
          kpis: {
            // Intentionally omit burn_rate numeric value.
            burn_rate: { value: { raw: 'Burn is discussed' }, sources: [{ document_id: 'doc-burn', page_index: 3 }] },
          },
        },
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    renderWorkspace('deal-burn-b');

    const top = await screen.findByLabelText('Deal top summary');
    const burnLabel = within(top).getByText(/^Burn$/i);
    const burnCard = burnLabel.parentElement;
    expect(burnCard).not.toBeNull();
    expect(within(burnCard as HTMLElement).getByText('—')).toBeInTheDocument();

    const cov = await screen.findByLabelText('Financial coverage');
    const burnPresentLabel = within(cov).getByText(/Burn present/i);
    const burnRow = burnPresentLabel.parentElement;
    expect(burnRow).not.toBeNull();
    expect(within(burnRow as HTMLElement).getByText(/Present \(no value\)/i)).toBeInTheDocument();
  });

  test('Case C: if runway coverage is present and numeric exists, runway tile shows months and panel evidence is deterministic', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport, apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-burn-c',
        input_hash: 'a'.repeat(64),
        created_at: new Date(0).toISOString(),
        llm_phase_mode: 'v1',
        summary_text: 'Overlay summary',
        guard_degraded: false,
        overview_json: {
          phase1: {
            deal_overview_v2: {
              runway: 'OVERLAY RUNWAY SHOULD NOT BE USED',
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-burn-c', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-burn-c',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        financial_coverage_v1: {
          coverage: {
            burn_rate_present: false,
            runway_present: true,
          },
          evidence: {
            runway_present: { document_id: 'doc-runway', page_index: 0, snippet: 'Runway: 18 months' },
          },
        },
        structured_summary: {
          raise: { value_json: { amount: { amount: 2000000 } } },
          kpis: {
            runway_months: { value: { months: 18 }, sources: [{ document_id: 'doc-runway', page_index: 0 }] },
          },
        },
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    renderWorkspace('deal-burn-c');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Show Deterministic \(Authoritative\)/i }));

    const top = await screen.findByLabelText('Deal top summary');
    const runwayLabel = within(top).getByText(/^Runway$/i);
    const runwayCard = runwayLabel.parentElement;
    expect(runwayCard).not.toBeNull();
    expect(within(runwayCard as HTMLElement).getByText(/^18\s*mo$/i)).toBeInTheDocument();

    const cov = await screen.findByLabelText('Financial coverage');
    expect(within(cov).getByText(/^Runway present$/i)).toBeInTheDocument();

    // Evidence snippet rendered in the deterministic FinancialCoveragePanel.
    expect(within(cov).getByText(/Runway: 18 months/i)).toBeInTheDocument();

    // Guard: overlay copy should not appear inside deterministic coverage panel.
    expect(within(cov).queryByText(/OVERLAY RUNWAY SHOULD NOT BE USED/i)).toBeNull();
  });
});
