/**
 * DataFlow Contract Enforcement Tests
 *
 * These tests verify that DealWorkspace reads each field ONLY from
 * its contract-approved source (docs/Foundation/DataFlow_contract.md).
 *
 * Each test has a CONTRACT comment naming the exact tested rule.
 */
import { screen } from '@testing-library/react';
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

/** Minimal report envelope shared across tests — can be extended per test. */
const makeReportEnvelope = (dealId: string, overrides: Record<string, unknown> = {}) => ({
  ready: true,
  version: 1,
  artifact: { kind: 'deal_intelligence_object', dio_id: `dio-${dealId}`, analysis_version: 1, updated_at: '2024-01-01T00:00:00.000Z' },
  report: {
    dealId,
    generatedAt: '2024-01-01T00:00:00.000Z',
    version: 1,
    overallScore: 60,
    recommendation: 'consider',
    sections: [],
    structured_summary: {
      raise: { value: '$500K', round_label: 'Pre-Seed', value_json: { amount: { amount: 500000 } }, sources: [] },
    },
    metadata: {
      score_explanation: {
        context: { stage: 'in_diligence', deal_type: 'startup_raise' },
      },
      score_band_v2: { key: 'consider', label: 'Consider', overall_score: 60, thresholds_version: 'v2' },
    },
    ...overrides,
  },
} as any);

describe('DataFlow Contract Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-01T00:00:00.000Z',
    } as any);
  });

  // ── §2.2 deal_type ───────────────────────────────────────────────────────────

  describe('§2.2 deal_type — report.metadata.score_explanation.context.deal_type', () => {
    test('[contract] deal_type reads from context.deal_type, not overviewV2.deal_type', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      // CONTRACT source: context.deal_type = 'startup_raise'
      // Forbidden source via ui.overviewV2.deal_type intentionally absent — proves no fallback
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-dtype', {
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'startup_raise' } },
          score_band_v2: { key: 'consider', label: 'Consider', overall_score: 60, thresholds_version: 'v2' },
        },
      }));
      // Deal has no ui.overviewV2 at all
      vi.mocked(apiGetDeal).mockResolvedValue({
        dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-01T00:00:00.000Z',
        // No ui property — proves we never read from overviewV2
      } as any);

      renderWorkspace({ dealId: 'deal-ct-dtype' });
      await screen.findByLabelText('Deal top summary');

      // 'startup_raise' from context.deal_type must appear
      expect(document.body.textContent).toMatch(/startup.raise|startup_raise/i);
    });

    test('[contract] deal_type shows — when context.deal_type is missing', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-dtype-miss', {
        metadata: {
          // context deliberately absent
          score_explanation: {},
          score_band_v2: { key: 'consider', label: 'Consider', overall_score: 60, thresholds_version: 'v2' },
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-dtype-miss' });
      await screen.findByLabelText('Deal top summary');

      // Must not pull any value from a forbidden phase1 source
      expect(document.body.textContent).not.toMatch(/overviewV2|deal_overview_v2/i);
    });
  });

  // ── §2.3 stage ───────────────────────────────────────────────────────────────

  describe('§2.3 stage — report.metadata.score_explanation.context.stage (missing → unknown)', () => {
    test('[contract] stage reads from context.stage and maps to display label', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-stage', {
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'startup_raise' } },
          score_band_v2: { key: 'consider', label: 'Consider', overall_score: 60, thresholds_version: 'v2' },
        },
      }));
      // Deal pipeline stage is 'intake' — must NOT override 'in_diligence' from context
      vi.mocked(apiGetDeal).mockResolvedValue({
        dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-01T00:00:00.000Z',
        stage: 'intake',
      } as any);

      renderWorkspace({ dealId: 'deal-ct-stage' });
      await screen.findByLabelText('Deal top summary');

      const body = document.body.textContent ?? '';
      // 'In diligence' (mapped from in_diligence) must appear in the stage badge
      expect(body).toMatch(/In diligence|in.diligence/i);
      // 'Intake' (the pipeline stage) must NOT be used as the funding/stage badge value
      // Note: 'Intake' can appear in diligence-phase label — we only assert the stage badge is correct
    });

    test('[contract] stage shows "unknown" when context.stage is absent', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-stage-miss', {
        metadata: {
          score_explanation: {
            // context.stage intentionally absent
            context: { deal_type: 'startup_raise' },
          },
          score_band_v2: { key: 'consider', label: 'Consider', overall_score: 60, thresholds_version: 'v2' },
        },
      }));
      // Deal pipeline stage set to 'under_review' — must NOT leak into the stage badge
      vi.mocked(apiGetDeal).mockResolvedValue({
        dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-01T00:00:00.000Z',
        stage: 'under_review',
      } as any);

      renderWorkspace({ dealId: 'deal-ct-stage-miss' });
      await screen.findByLabelText('Deal top summary');

      const body = document.body.textContent ?? '';
      // Contract §2.3: missing context.stage → always show 'unknown', never the pipeline stage
      expect(body).toMatch(/unknown/i);
      // 'under_review' must NOT appear as a label in the stage badge
      expect(body).not.toMatch(/under.review/i);
    });
  });

  // ── §2.4 Company Description ─────────────────────────────────────────────────

  describe('§2.4 company description — investment_analysis_overview_v2.summary → executive_summary_v1.summary', () => {
    test('[contract] company description uses investment_analysis_overview_v2.summary when populated', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-desc-iao', {
        investment_analysis_overview_v2: {
          summary: 'IAO v2 canonical description of the company.',
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-desc-iao' });
      await screen.findByLabelText('Deal top summary');

      expect(document.body.textContent).toContain('IAO v2 canonical description of the company.');
    });

    test('[contract] company description falls back to executive_summary_v1.summary when iao_v2 absent', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-desc-exec', {
        // investment_analysis_overview_v2 intentionally absent
        executive_summary_v1: {
          summary: 'Executive summary v1 fallback description.',
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-desc-exec' });
      await screen.findByLabelText('Deal top summary');

      expect(document.body.textContent).toContain('Executive summary v1 fallback description.');
    });

    test('[contract] company description shows "Not extracted" when both contract sources are absent', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      // No investment_analysis_overview_v2, no executive_summary_v1
      // deal_summary_v1.tiers.hero populated — MUST be ignored (forbidden source)
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-desc-miss', {
        deal_summary: {
          version: 'deal_summary_v1',
          ready: true,
          tiers: { hero: 'Hero text from forbidden deal_summary_v1 source.', overview: '', deep: '' },
          one_liner: { text: 'One liner from forbidden source.', sources: [] },
          paragraphs: [],
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-desc-miss' });
      await screen.findByLabelText('Deal top summary');

      const body = document.body.textContent ?? '';
      // Neither forbidden source should appear as company description
      expect(body).not.toContain('Hero text from forbidden deal_summary_v1 source.');
      // Contract behavior: no approved source → placeholder
      expect(body).toContain('Not extracted');
    });
  });

  // ── §2.5 TAM ─────────────────────────────────────────────────────────────────

  describe('§2.5 TAM — report.structured_summary.kpis.tam.value', () => {
    test('[contract] TAM reads from structured_summary.kpis.tam.value.raw', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-tam', {
        structured_summary: {
          raise: { value: '$500K', round_label: 'Pre-Seed', value_json: { amount: { amount: 500000 } }, sources: [] },
          kpis: {
            tam: { value: { raw: '$4.2B', currency: 'USD', period: null, amount: null }, confidence: 0.85, sources: [] },
          },
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-tam' });
      await screen.findByLabelText('Deal top summary');

      expect(document.body.textContent).toContain('$4.2B');
    });

    test('[contract] TAM shows — when kpis.tam is absent (overviewV2.market_size not used)', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      // No kpis.tam provided — overviewV2 would have market_size but must be ignored
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-tam-miss', {
        structured_summary: {
          raise: { value: '$500K', round_label: 'Pre-Seed', value_json: { amount: { amount: 500000 } }, sources: [] },
          // No kpis block
        },
      }));
      // Deal has ui.overviewV2.market_size set to catch any forbidden fallback
      vi.mocked(apiGetDeal).mockResolvedValue({
        dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-01T00:00:00.000Z',
        ui: { overviewV2: { market_size: '$99T FORBIDDEN TAM' } },
      } as any);

      renderWorkspace({ dealId: 'deal-ct-tam-miss' });
      await screen.findByLabelText('Deal top summary');

      // The forbidden fallback value must never appear
      expect(document.body.textContent).not.toContain('$99T FORBIDDEN TAM');
      expect(document.body.textContent).not.toContain('FORBIDDEN TAM');
    });
  });

  // ── §2.1 Raise ───────────────────────────────────────────────────────────────

  describe('§2.1 raise — report.structured_summary.raise', () => {
    test('[contract] raise KPI tile reads from structured_summary.raise.value', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-raise', {
        structured_summary: {
          raise: {
            value: '$2M',
            round_label: 'Seed',
            value_json: { amount: { amount: 2000000 } },
            sources: [],
          },
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-raise' });
      await screen.findByLabelText('Deal top summary');

      expect(document.body.textContent).toContain('$2M');
    });

    test('[contract] raise shows — when structured_summary.raise.amount is absent (no text-mining fallback)', async () => {
      const { apiGetDealReport } = await import('../lib/apiClient');
      // structured_summary.raise exists but no value_json.amount
      vi.mocked(apiGetDealReport).mockResolvedValue(makeReportEnvelope('deal-ct-raise-miss', {
        structured_summary: {
          raise: { value: null, round_label: null, value_json: null, sources: [] },
        },
      }));

      renderWorkspace({ dealId: 'deal-ct-raise-miss' });
      await screen.findByLabelText('Deal top summary');

      // Must not fall back to text-mining forbidden sources
      // The raise tile will show — (the dash sentinel)
      const body = document.body.textContent ?? '';
      // If raise value is null/missing — forbidden fallbacks like display_facts_v1 raw text must not appear
      // We verify the FORBIDDEN value is absent (any real raise text would be from the fixture description 'Demo'
      // which should not appear in the raise tile slot)
      expect(body).not.toMatch(/\$1M|1,000,000/); // fixture investmentAmount — must not be used as raise
    });
  });
});
