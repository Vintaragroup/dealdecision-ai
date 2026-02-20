import { screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWorkspace } from './dealWorkspaceTestFixture';
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

describe('DealWorkspace top summary uses structured_summary deal_summary_v1 only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders structured_summary.long_summary and does not concatenate deal_summary_v1 tiers', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');

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
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        deal_summary_v1: {
          version: 'deal_summary_v1',
          ready: true,
          tiers: {
            hero: 'TIER HERO (should not render in top summary)',
            overview: 'TIER OVERVIEW (should not render in top summary)',
            deep: 'TIER DEEP (should not render in top summary)',
          },
          one_liner: { text: 'TIER ONE LINER', sources: [] },
          paragraphs: [],
        },
        structured_summary: {
          deal_summary_v1: {
            one_liner: 'STRUCTURED ONE LINER',
            long_summary: 'STRUCTURED LONG SUMMARY\n\nSecond paragraph.',
          },
          kpis: {},
        },
        metadata: {
          score_band_v2: { key: 'consider', label: 'Consider', overall_score: 50, thresholds_version: 'v2' },
          decision_v1: { recommendation_key: 'consider', label: 'Consider', severity: 'warn', reasons: ['band:consider'] },
          score_explanation: { context: { deal_type: 'Primary equity' } },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-1' });

    const top = await screen.findByLabelText('Deal top summary');

    // Wait for async report wiring.
    await screen.findByText('STRUCTURED LONG SUMMARY');

    expect(within(top).getByText('STRUCTURED ONE LINER')).toBeInTheDocument();
    expect(within(top).getByText('STRUCTURED LONG SUMMARY')).toBeInTheDocument();
    expect(within(top).getByText('Second paragraph.')).toBeInTheDocument();

    expect(within(top).queryByText(/TIER HERO/)).toBeNull();
    expect(within(top).queryByText(/TIER OVERVIEW/)).toBeNull();
    expect(within(top).queryByText(/TIER DEEP/)).toBeNull();
  });
});
