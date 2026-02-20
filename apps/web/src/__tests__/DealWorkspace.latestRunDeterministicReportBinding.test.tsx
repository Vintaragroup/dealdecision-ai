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
    apiGetDealReport: vi.fn(),
    apiGetDealReportNarrated: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealGovernedOverlayPersisted: vi.fn(async () => ({ overview: null } as any)),
    apiGetDealDeterministicUnderstanding: vi.fn(async () => null as any),
    apiPostDealDeterministicUnderstanding: vi.fn(async () => ({
      analysis_version: 'deterministic_understanding_v1',
      input_hash: 'test',
      created_at: new Date(0).toISOString(),
      patch: {
        analysis_version: 'deterministic_understanding_v1',
        created_at: new Date(0).toISOString(),
        input_hash: 'test',
        deal_id: 'deal-1',
        pages: {},
        documents: {},
      },
    } as any)),
    subscribeToEvents: vi.fn(() => () => undefined),
    apiResolveEvidence: vi.fn(async () => ({ results: [] } as any)),
    apiGetDealAnalysisDiagnostics: vi.fn(async () => ({ diagnostics: null } as any)),
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

describe('DealWorkspace latest-run deterministic report binding', () => {
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

  test('fetches /report/:version matching dioAnalysisVersion (header latest vN) and renders deterministic deal summary from that report', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v3.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
      dioRunCount: 3,
      dioAnalysisVersion: 3,
    } as any);

    const { apiGetDealReport, apiGetDealAnalysisDiagnostics } = await import('../lib/apiClient');

    vi.mocked(apiGetDealAnalysisDiagnostics).mockResolvedValue({
      diagnostics: {
        report_id: 'dio-v3',
        llm_phase_mode: 'governed',
        deterministic_coverage_ratio: 0.9,
        citation_integrity_percent: 99,
        hallucination_count: 0,
        numeric_claims_without_evidence: 0,
        semantic_drift_score: 0.01,
        provider_error_count: 0,
        model_output_truncated_count: 0,
        model_output_not_json_count: 0,
        guard_degraded_count: 0,
        created_at: new Date(0).toISOString(),
      } as any,
    } as any);

    const v1Placeholder = 'V1 SHOULD NOT BE USED';
    const v3Summary = 'V3 DETERMINISTIC LONG SUMMARY (expected)';

    vi.mocked(apiGetDealReport).mockImplementation(async (_dealId: string, opts?: { version?: number | null }) => {
      const v = opts?.version ?? null;
      if (v === 3) {
        return {
          ready: true,
          version: 3,
          artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-v3', analysis_version: 3, updated_at: '2024-01-02T00:00:00.000Z' },
          report: {
            dealId: 'deal-1',
            generatedAt: '2024-01-02T00:00:00.000Z',
            version: 3,
            overallScore: 80,
            recommendation: 'yes',
            sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
            structured_summary: {
              deal_summary_v1: {
                one_liner: 'short',
                long_summary: v3Summary,
              },
              kpis: {
                raise: { value: '$2M', sources: [] },
              },
              raise: { value_json: { amount: { amount: 2000000 } }, sources: [] },
            },
            metadata: {
              score_band_v2: { key: 'good', label: 'Good', overall_score: 80, thresholds_version: 'v2' },
            },
          },
        } as any;
      }

      // Any non-v3 response represents an older compiled report that is missing the structured long summary.
      return {
        ready: true,
        version: 1,
        artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-v1', analysis_version: 1, updated_at: '2024-01-01T00:00:00.000Z' },
        report: {
          dealId: 'deal-1',
          generatedAt: '2024-01-01T00:00:00.000Z',
          version: 1,
          overallScore: 50,
          recommendation: 'no',
          deal_summary: { ready: false, reason: 'missing' },
          sections: [{ id: 'executive-summary', title: 'Executive Summary', content: v1Placeholder, evidence_ids: [] }],
          structured_summary: {
            kpis: {
              raise: { value: '$1M', sources: [] },
            },
          },
          metadata: {},
        },
      } as any;
    });

    renderWorkspace('deal-1');

    const top = await screen.findByLabelText('Deal top summary');

    await waitFor(() => {
      expect(vi.mocked(apiGetDealReport)).toHaveBeenCalled();
      const calls = vi.mocked(apiGetDealReport).mock.calls;
      const hasV3 = calls.some((c) => c?.[0] === 'deal-1' && c?.[1]?.version === 3);
      expect(hasV3).toBe(true);
    });

    // Slot-anchored assertions: the deterministic bindings must render from the v3 report.
    const headerSubsummarySlot = document.querySelector('[data-slot="header.score.subsummary"]');
    expect(headerSubsummarySlot).toBeInTheDocument();
    expect(headerSubsummarySlot).toHaveTextContent('short');

    const longSummarySlot = document.querySelector('[data-slot="topSummary.dealSummary.long"]');
    expect(longSummarySlot).toBeInTheDocument();
    expect(longSummarySlot).toHaveTextContent(v3Summary);

    // Top summary should reflect the v3 structured long summary and must not show the degraded placeholder.
    await screen.findByText(v3Summary);
    expect(within(top).getByText(v3Summary)).toBeInTheDocument();
    expect(within(top).queryByText(/Deterministic deal summary unavailable\./i)).toBeNull();
    expect(within(top).queryByText(v1Placeholder)).toBeNull();

    // Diagnostics panel should make it obvious which report is bound.
    expect(screen.getAllByText('dio-v3').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Header latest: v3/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Loaded: v3/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/artifact\.dio_id:/i)).toBeInTheDocument();
  });
});
