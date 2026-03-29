import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('DealWorkspace slot contract (stable anchors)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exposes stable, unique UI anchors', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    const exec = 'Executive summary from report payload.';

    // Reuse the same ready-report fixture shape used by DealWorkspace.test.tsx.
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-rpt-bind-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: exec, evidence_ids: [] }],
        deal_summary: {
          version: 'deal_summary_v1',
          ready: true,
          tiers: { hero: exec, overview: '', deep: '' },
          one_liner: { text: exec, sources: [] },
          paragraphs: [{ text: exec, sources: [] }],
        },
        structured_summary: {
          raise: {
            value: '$2M',
            round_label: 'Seed',
            value_json: { amount: { amount: 2000000 } },
            sources: [{ document_id: 'doc-1', page_index: 1 }],
          },
          kpis: {
            raise: { value: '$2M Seed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 1 }] },
            business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 1 }] },
            revenue: {
              value: { raw: '$1.2M', currency: 'USD', period: 'ARR', amount: null },
              confidence: 0.8,
              sources: [{ document_id: 'doc-1', page_index: 1 }],
            },
            customers: { value: { count: 450, kind: 'customers', raw: null }, confidence: 0.7, sources: [{ document_id: 'doc-1', page_index: 1 }] },
          },
        },
        metadata: {
          score_explanation: {
            context: {
              stage: 'in_diligence',
              deal_type: 'Primary equity',
            },
          },
          score_band_v2: { key: 'consider_caution', label: 'Consider (Caution)', overall_score: 50, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: null },
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    const { container } = renderWorkspace({ dealId: 'deal-rpt-bind-1' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /^overview$/i }));

    await screen.findByLabelText('Deal top summary');

    // Top section anchors in current (non-legacy) header implementation.
    const topSummarySections = container.querySelectorAll('section[aria-label="Deal top summary"]');
    expect(topSummarySections.length).toBe(1);
    expect(screen.getByTestId('radial-score-chart')).toBeInTheDocument();
    expect(screen.getByTestId('deal-summary-text')).toBeInTheDocument();
  });
});
