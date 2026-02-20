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
    apiGetDealGovernedOverlayPersisted: vi.fn(),
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

describe('DealWorkspace deterministic deal_summary_v1 lock', () => {
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

  test('does not concatenate deal_summary_v1 tiers into the top summary (structured_summary deal summary is the only source)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport, apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');

    const overlayHeroSentence = 'OVERLAY HERO SENTENCE — SHOULD NOT REPLACE DETERMINISTIC';

    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-canonical-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-canonical-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        deal_summary_v1: {
          version: 'deal_summary_v1',
          ready: true,
          reason: null,
          tiers: {
            hero: 'WebMax builds diligence tooling for investors.',
            overview: 'Targets mid-market PE firms. Raise: $2M (Seed).',
            deep: 'Business model: SaaS. Revenue: $1M ARR. Growth: 50%.',
          },
          one_liner: {
            text: 'WebMax builds diligence tooling for investors.',
            sources: [{ source_document_id: 'doc-prod', page_index: 11, slide_title: 'Product', snippet: 'WebMax builds diligence tooling…' }],
          },
          product: {
            text: 'WebMax builds diligence tooling for investors.',
            sources: [{ source_document_id: 'doc-prod', page_index: 11, slide_title: 'Product', snippet: 'WebMax builds diligence tooling…' }],
          },
          market: {
            text: 'Targets mid-market PE firms.',
            sources: [{ source_document_id: 'doc-mkt', page_index: 23, slide_title: 'Market / ICP', snippet: 'Targets mid-market PE…' }],
          },
          paragraphs: [
            {
              text: 'Targets mid-market PE firms. Raise: $2M (Seed).',
              sources: [
                { source_document_id: 'doc-mkt', page_index: 23, slide_title: 'Market / ICP', snippet: 'Targets mid-market PE…' },
                { source_document_id: 'doc-ask', page_index: 0, slide_title: 'The Ask: Raising $2M', snippet: 'The Ask: Raising $2M via SAFE' },
              ],
            },
            {
              text: 'Business model: SaaS. Revenue: $1M ARR. Growth: 50%.',
              sources: [{ source_document_id: 'doc-fin', page_index: 5, slide_title: 'Financials', snippet: '$1M ARR' }],
            },
          ],
          warnings: [],
        },
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        structured_summary: {
          raise: {
            value_json: { amount: { amount: 2000000 } },
            sources: [{ source_document_id: 'doc-ask', page_index: 0 }],
          },
          kpis: {
            raise: {
              value: '$2M',
              sources: [{ source_document_id: 'doc-ask', page_index: 0 }],
            },
          },
          product_summary_v1: {
            value: 'WebMax builds diligence tooling for investors.',
            sources: [{ source_document_id: 'doc-prod', page_index: 11, slide_title: 'Product', note_snippet: 'WebMax builds diligence tooling…' }],
          },
          market_summary_v1: {
            value: 'Targets mid-market PE firms.',
            sources: [{ source_document_id: 'doc-mkt', page_index: 23, slide_title: 'Market / ICP', note_snippet: 'Targets mid-market PE…' }],
          },
        },
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-canonical-1',
        input_hash: 'a'.repeat(64),
        created_at: new Date(0).toISOString(),
        llm_phase_mode: 'v1',
        summary_text: 'Overlay summary (degraded)',
        guard_degraded: true,
        overview_json: {
          phase1: {
            governed_ui_copy_v1: {
              hero_summary: overlayHeroSentence,
            },
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
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace('deal-canonical-1');

    const top = await screen.findByLabelText('Deal top summary');

    // Top section deal summary must NOT be synthesized from report.deal_summary_v1 tiers.
    // When structured_summary.deal_summary_v1.long_summary is absent, render blank (no degraded/unavailable copy).
    expect(within(top).queryByText(/Deterministic deal summary unavailable\./i)).toBeNull();
    expect(within(top).queryByText('WebMax builds diligence tooling for investors.')).toBeNull();
    expect(within(top).queryByText(/Targets mid-market PE firms\. Raise: \$2M/i)).toBeNull();
    expect(within(top).queryByText(/Business model: SaaS\. Revenue: \$1M ARR\. Growth: 50%\./i)).toBeNull();
    expect(within(top).queryByText(overlayHeroSentence)).toBeNull();

    const longSlot = top.querySelector('[data-slot="topSummary.dealSummary.long"]') as HTMLElement | null;
    expect(longSlot).not.toBeNull();
    expect((longSlot as HTMLElement).textContent?.trim() || '').toBe('');

    // Degraded overlay => deterministic panel defaults visible.
    const user = userEvent.setup();
    await screen.findByRole('button', { name: /Hide Deterministic \(Authoritative\)/i });

    // Deterministic Deal Summary card (overview) should show deterministic hero (even if overlay exists elsewhere).
    const detHeading = await screen.findByRole('heading', { name: 'Deal Summary', level: 2 });
    const detCard = detHeading.parentElement?.parentElement?.parentElement?.parentElement as HTMLElement | null;
    expect(detCard).not.toBeNull();
    expect(within(detCard as HTMLElement).getAllByText('WebMax builds diligence tooling for investors.').length).toBeGreaterThan(0);

    // Citations must include the ask slide (doc-ask · p1) and product slide (doc-prod · p12).
    await user.click(within(detCard as HTMLElement).getByRole('button', { name: /View citations/i }));
    expect(await within(detCard as HTMLElement).findByText(/doc-ask · p1/i)).toBeInTheDocument();
    expect(within(detCard as HTMLElement).getAllByText(/doc-prod · p12/i).length).toBeGreaterThan(0);
  });

  test('renders structured_summary deal summary: header shows one-liner only and body shows long summary', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport, apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');

    const shortOneLiner = 'SHORT ONE-LINER (structured_summary)';
    const longSummary = 'LONG SUMMARY (structured_summary) — should appear only in Deal Summary body.';

    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-ss-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-ss-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        recommendation: 'yes',
        deal_summary_v1: {
          version: 'deal_summary_v1',
          ready: true,
          reason: null,
          tiers: {
            hero: 'Fallback hero (should not be used when structured long exists).',
            overview: 'Fallback overview.',
            deep: 'Fallback deep.',
          },
          one_liner: { text: 'Fallback one-liner', sources: [] },
          product: { text: 'Product', sources: [] },
          market: { text: 'Market', sources: [] },
          paragraphs: [],
          warnings: [],
        },
        sections: [],
        structured_summary: {
          deal_summary_v1: {
            one_liner: shortOneLiner,
            long_summary: longSummary,
          },
          raise: {
            value_json: { amount: { amount: 2000000 } },
            sources: [{ source_document_id: 'doc-ask', page_index: 0 }],
          },
          kpis: {
            raise: { value: '$2M', sources: [{ source_document_id: 'doc-ask', page_index: 0 }] },
          },
          product_summary_v1: { value: 'Product', sources: [] },
          market_summary_v1: { value: 'Market', sources: [] },
        },
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
      },
    } as any);

    // Overlay should not be used for either short or long summaries when structured_summary values exist.
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-ss-1',
        input_hash: 'a'.repeat(64),
        created_at: new Date(0).toISOString(),
        llm_phase_mode: 'v1',
        summary_text: 'Overlay summary (should not be used)',
        guard_degraded: true,
        overview_json: {
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: 'OVERLAY ONE-LINER (should not show)',
                paragraphs: ['OVERLAY LONG (should not show)'],
              },
              strengths: [],
              risks: [],
              open_questions: [],
            },
            deal_overview_v2: {},
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace('deal-ss-1');

    const top = await screen.findByLabelText('Deal top summary');
    const scoreSummarySlot = screen.getByTestId('score-summary-slot');
    expect(scoreSummarySlot).not.toHaveTextContent(shortOneLiner);
    expect(scoreSummarySlot).not.toHaveTextContent(longSummary);

    const dealSummaryText = screen.getByTestId('deal-summary-text');
    expect(dealSummaryText).toHaveTextContent(shortOneLiner);
    expect(dealSummaryText).not.toHaveTextContent(longSummary);

    const longSlot = top.querySelector('[data-slot="topSummary.dealSummary.long"]') as HTMLElement | null;
    expect(longSlot).not.toBeNull();
    expect(longSlot as HTMLElement).toHaveTextContent(longSummary);
    expect(longSlot as HTMLElement).not.toHaveTextContent(shortOneLiner);
  });

  test('financial coverage guardrail: when historical revenue missing, revenue KPI shows — and overlay cannot inject a number', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport, apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');

    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-fin-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-fin-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 70,
        recommendation: 'yes',
        deal_summary_v1: {
          version: 'deal_summary_v1',
          ready: true,
          reason: null,
          tiers: {
            hero: 'Hero',
            overview: 'Overview',
            deep: 'Deep',
          },
          one_liner: { text: 'Hero', sources: [] },
          product: { text: 'Product', sources: [] },
          market: { text: 'Market', sources: [] },
          paragraphs: [],
          warnings: [],
        },
        financial_coverage_v1: {
          confidence: 'high',
          coverage: {
            historical_revenue_present: false,
            forecast_revenue_present: false,
            income_statement_present: false,
            burn_rate_present: false,
            runway_present: false,
            unit_economics_present: false,
          },
          evidence: {
            historical_revenue_present: { document_id: 'doc-fin', page_index: 0, snippet: 'No historical revenue found.' },
          },
          sources: [{ kind: 'deck', document_id: 'doc-fin' }],
          notes: [],
        },
        structured_summary: {
          raise: {
            value_json: { amount: { amount: 1000000 } },
            sources: [{ source_document_id: 'doc-ask', page_index: 0 }],
          },
          kpis: {
            raise: {
              value: '$1M',
              sources: [{ source_document_id: 'doc-ask', page_index: 0 }],
            },
            // Guardrail must hide this even if it exists.
            revenue: {
              value: { raw: '$123M' },
              sources: [{ source_document_id: 'doc-fin', page_index: 3, note_snippet: 'Revenue: $123M' }],
            },
          },
        },
        sections: [],
        metadata: {
          score_band_v2: { key: 'ok', label: 'OK', overall_score: 70, thresholds_version: 'v2' },
        },
      },
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-fin-1',
        input_hash: 'b'.repeat(64),
        created_at: new Date(0).toISOString(),
        llm_phase_mode: 'v1',
        summary_text: 'Overlay summary',
        guard_degraded: false,
        overview_json: {
          phase1: {
            deal_overview_v2: {
              revenue: '$999M',
            },
            deal_summary_v2: {
              summary: {
                one_liner: 'Overlay one liner',
                paragraphs: ['Overlay paragraph'],
              },
              strengths: [],
              risks: [],
              open_questions: [],
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace('deal-fin-1');

    // Overlay is present and should not display the injected revenue.
    await screen.findByText('Overlay (non-authoritative)');
    const overlayHeading = await screen.findByRole('heading', { name: 'Deal Summary', level: 2 });
    const overlayCard = overlayHeading.parentElement?.parentElement?.parentElement?.parentElement as HTMLElement | null;
    expect(overlayCard).not.toBeNull();
    expect(within(overlayCard as HTMLElement).queryByText('$999M')).toBeNull();
    expect(within(overlayCard as HTMLElement).queryByText('$123M')).toBeNull();

    const overlayRevenueLabel = within(overlayCard as HTMLElement).getByText('Revenue / ARR');
    const overlayRevenueTile = overlayRevenueLabel.parentElement as HTMLElement;
    expect(within(overlayRevenueTile).getByText('—')).toBeInTheDocument();

    // Deterministic panel should also show Revenue as missing.
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Show Deterministic \(Authoritative\)/i }));
    await screen.findByLabelText('Financial coverage');

    const headings = screen.getAllByRole('heading', { name: 'Deal Summary', level: 2 });
    expect(headings.length).toBeGreaterThanOrEqual(2);
    const detHeading = headings[headings.length - 1];
    const detCard = detHeading.parentElement?.parentElement?.parentElement?.parentElement as HTMLElement | null;
    expect(detCard).not.toBeNull();

    const detRevenueLabel = within(detCard as HTMLElement).getByText('Revenue / ARR');
    const detRevenueTile = detRevenueLabel.parentElement as HTMLElement;
    expect(within(detRevenueTile).getByText('—')).toBeInTheDocument();

    // Sanity: the injected values should not appear anywhere.
    expect(screen.queryByText('$999M')).toBeNull();
    expect(screen.queryByText('$123M')).toBeNull();
  });
});
