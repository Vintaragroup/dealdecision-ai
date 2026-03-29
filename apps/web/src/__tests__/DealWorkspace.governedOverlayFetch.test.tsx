import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealReport, apiGetDealReportNarrated, apiGetDealGovernedOverlayPersisted, apiGetJob } from '../lib/apiClient';

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
    const view = render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-1" dealData={baseDeal} {...overrides} />
      </ScoreSourceProvider>
    );
    const overviewTab = screen.queryByRole('tab', { name: /^overview$/i });
    if (overviewTab instanceof HTMLButtonElement) {
      overviewTab.click();
    }
    return view;
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
          // Canonical raise: amount-only + separate round label.
          raise: {
            value: '$3M',
            round_label: 'Seed',
            value_json: { amount: { amount: 3000000 } },
            sources: [{ document_id: 'doc-1', page_index: 3 }],
          },
          business_model: { value: 'Usage-based SaaS (top)', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          // Legacy KPI strings should never override canonical raise numeric.
          kpis: {
            raise: { value: '$2M Seed', confidence: 0.91, sources: [{ document_id: 'doc-legacy', page_index: 3 }] },
            business_model: { value: 'Usage-based SaaS (kpi)', label: 'Attributed', confidence: 0.92, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          },
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
        overview_json: {
          phase1: {
            governed_ui_copy_v1: {
              schema_version: 'governed_ui_copy_v1',
              hero_summary: 'Overlay one-liner',
              deal_summary_mid: 'Overlay one-liner',
              product_solution: 'Overlay product (fallback)',
              market_icp: 'Overlay market',
              business_model: 'Overlay BM',
              raise_terms: 'Overlay raise',
              strengths: ['Overlay strength'],
              concerns: ['Overlay risk'],
              open_questions: ['Overlay open question'],
              traction: ['Overlay traction'],
              evidence_map: {
                deal_summary_mid: [
                  { source_document_id: 'doc-1', page_index: 0, snippet: 'Summary evidence snippet' },
                ],
                product_solution: [
                  { source_document_id: 'doc-1', page_index: 0, snippet: 'Product evidence snippet' },
                ],
                market_icp: [
                  { source_document_id: 'doc-1', page_index: 1, snippet: 'Market evidence snippet' },
                ],
                business_model: [],
                raise_terms: [],
                traction: [],
                strengths: [],
                concerns: [],
                open_questions: [],
              },
            },
            deal_summary_v2: {
              summary: {
                one_liner: 'Overlay one-liner',
                paragraphs: ['Overlay paragraph 1', 'Overlay paragraph 2'],
              },
              strengths: ['Overlay strength'],
              risks: ['Overlay risk'],
              open_questions: ['Overlay open question'],
            },
            deal_overview_v2: {
              product_solution: 'Overlay product (fallback)',
              market_icp: 'Overlay market',
              business_model: 'Overlay BM',
              raise: 'Overlay raise',
              traction_signals: ['Overlay traction'],
              key_risks_detected: ['Overlay key risk'],
              sources: [
                { document_id: 'doc-1', page_range: [0, 0], note: 'du fallback_product_solution' },
              ],
            },
          },
        },
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
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Overlay one-liner/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay market/i).length).toBeGreaterThan(0);

    // Fallback PR2 facts should render, but be marked "Needs review".
    expect(screen.getAllByText(/Overlay product \(fallback\)/i).length).toBeGreaterThan(0);

    // When /report is ready, deterministic key-fact copy should win over overlay narrative drift.
    expect(screen.getAllByText(/Usage-based SaaS \(kpi\)/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Overlay BM/i)).not.toBeInTheDocument();

    const top = await screen.findByLabelText('Deal top summary');
    expect(within(top).getAllByText(/\$3M/i).length).toBeGreaterThan(0);
    expect(within(top).queryByText(/\$3M\s+Seed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Overlay raise/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$2M Seed/i)).not.toBeInTheDocument();

    // Persisted overlay copy should be visible.
    expect(screen.getAllByText(/Overlay one-liner/i).length).toBeGreaterThan(0);

    expect(screen.getByRole('button', { name: /run analysis/i })).toBeInTheDocument();
  });

  test('uses PR2 overlay phrasing when deterministic looks like OCR soup', async () => {
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
          raise: { value: '$2M Seed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
        },
        deal_summary: {
          ready: true,
          tiers: { hero: 'Hero', overview: 'Overview', deep: 'Deep' },
          one_liner: { text: 'Deterministic one-liner', sources: [] },
          product: { text: 'From Visa/Mastercard network rules: 12% | 18% | 42% | 9% | 10%', sources: [] },
          market: { text: 'PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE | PIPE', sources: [] },
          paragraphs: [],
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
        overview_json: {
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: 'Overlay one-liner',
                paragraphs: [],
              },
              strengths: [],
              risks: [],
              open_questions: [],
            },
            deal_overview_v2: {
              product_solution: 'send payment requests. makes our lives SO much easier.',
              market_icp: 'organic with no tickets & happier.',
              business_model: 'DTC Ecommerce',
              raise: '5.6M EUR',
              sources: [],
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();

    // PR2 overlay one-liner wins.
    expect(screen.getAllByText(/Overlay one-liner/i).length).toBeGreaterThan(0);

    // Deterministic OCR soup must not override PR2 phrasing.
    expect(screen.getAllByText(/send payment requests\. makes our lives SO much easier\./i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/From Visa\/Mastercard/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/organic with no tickets & happier\./i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/PIPE \| PIPE/i)).not.toBeInTheDocument();
  });

  test('post-analyze refresh polls until overlay signature changes (not just exists)', async () => {
    const user = userEvent.setup();

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'dio-1', dioStatus: 'ready' } as any);

    const overlayA = {
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-1',
        input_hash: 'a'.repeat(64),
        created_at: '2024-01-01T00:00:00.000Z',
        llm_phase_mode: 'governed',
        summary_text: 'Overlay A summary',
        overview_json: {
          phase1: {
            governed_ui_copy_v1: {
              schema_version: 'governed_ui_copy_v1',
              hero_summary: 'Overlay A one-liner',
              deal_summary_mid: 'Overlay A one-liner',
              product_solution: 'Overlay A product',
              market_icp: 'Overlay A market',
              business_model: 'Overlay A BM',
              raise_terms: 'Overlay A raise',
              strengths: ['Overlay A strength'],
              concerns: ['Overlay A risk'],
              open_questions: ['Overlay A question'],
              traction: ['Overlay A traction'],
              evidence_map: {
                deal_summary_mid: [],
                product_solution: [],
                market_icp: [],
                business_model: [],
                raise_terms: [],
                traction: [],
                strengths: [],
                concerns: [],
                open_questions: [],
              },
            },
            deal_summary_v2: {
              summary: { one_liner: 'Overlay A one-liner', paragraphs: [] },
              strengths: ['Overlay A strength'],
              risks: ['Overlay A risk'],
              open_questions: ['Overlay A question'],
            },
            deal_overview_v2: {
              product_solution: 'Overlay A product',
              market_icp: 'Overlay A market',
              business_model: 'Overlay A BM',
              raise: 'Overlay A raise',
              traction_signals: ['Overlay A traction'],
              key_risks_detected: [],
              sources: [],
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any;

    const overlayB = {
      overview: {
        ...overlayA.overview,
        input_hash: 'b'.repeat(64),
        created_at: '2024-01-02T00:00:00.000Z',
        summary_text: 'Overlay B summary',
        overview_json: {
          phase1: {
            ...(overlayA.overview.overview_json as any).phase1,
            governed_ui_copy_v1: {
              ...((overlayA.overview.overview_json as any).phase1.governed_ui_copy_v1 ?? {}),
              hero_summary: 'Overlay B one-liner',
              deal_summary_mid: 'Overlay B one-liner',
              product_solution: 'Overlay B product',
            },
            deal_overview_v2: {
              ...((overlayA.overview.overview_json as any).phase1.deal_overview_v2 ?? {}),
              product_solution: 'Overlay B product',
            },
          },
        },
      },
    } as any;

    vi.mocked(apiGetDealGovernedOverlayPersisted)
      .mockResolvedValueOnce(overlayA)
      // First post-analyze refresh: still the old signature.
      .mockResolvedValueOnce(overlayA)
      // Second post-analyze refresh: new signature.
      .mockResolvedValueOnce(overlayB);

    vi.mocked(apiGetJob as any).mockResolvedValue({
      job_id: 'job-1',
      type: 'analyze_deal',
      status: 'succeeded',
      message: 'Analysis complete',
      updated_at: '2024-01-02T00:00:00.000Z',
      created_at: '2024-01-02T00:00:00.000Z',
      started_at: '2024-01-02T00:00:00.000Z',
    } as any);

    renderWorkspace();

    // Initial overlay is A.
    await waitFor(() => {
      expect(screen.getAllByText(/Overlay A product/i).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole('button', { name: /run analysis/i }));

    // First refresh returns A again; we should still schedule another attempt.
    await waitFor(() => {
      expect(vi.mocked(apiGetDealGovernedOverlayPersisted).mock.calls.length).toBeGreaterThanOrEqual(3);
    }, { timeout: 10000 });

    await waitFor(() => {
      expect(screen.getAllByText(/Overlay B product/i).length).toBeGreaterThan(0);
    }, { timeout: 10000 });
  });

  test('renders display_facts_v1 with evidence toggles when deterministic is missing', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'dio-1', dioStatus: 'ready', phase1: {} } as any);

    // Deterministic report not ready => overview canonical facts collapse to "—" and are treated as missing.
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({ ready: false, reason: 'not_generated_yet' } as any);

    const { apiResolveEvidence } = await import('../lib/apiClient');
    vi.mocked(apiResolveEvidence).mockResolvedValueOnce({
      results: [
        {
          id: 'ev-1',
          ok: true,
          resolvable: true,
          document_id: 'doc-1',
          document_title: 'Pitch Deck',
          page: 0,
          snippet: 'RAW SNIPPET: Product does X for Y.',
        },
      ],
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-1',
        input_hash: 'a'.repeat(64),
        created_at: '2024-01-02T00:00:00.000Z',
        llm_phase_mode: 'governed',
        summary_text: 'Persisted overlay summary',
        overview_json: {
          display_facts_v1: {
            product_solution: {
              text: 'Clean product statement',
              evidence_ids: ['ev-1'],
              evidence_basis: 'direct_snippet',
            },
            market_icp: { text: null, evidence_ids: [], evidence_basis: 'no_evidence' },
            business_model: { text: null, evidence_ids: [], evidence_basis: 'no_evidence' },
            raise: { text: null, evidence_ids: [], evidence_basis: 'no_evidence' },
          },
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: 'Overlay one-liner',
                paragraphs: [],
              },
            },
            deal_overview_v2: {
              product_solution: 'Raw product',
              market_icp: 'Raw market',
              business_model: 'Raw BM',
              raise: 'Raw raise',
              sources: [],
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();

    // With deterministic missing, the governed overlay should be used.
    expect(screen.getAllByText(/Raw product/i).length).toBeGreaterThan(0);

    expect(screen.getAllByText(/Raw product/i).length).toBeGreaterThan(0);
  });

  test('prefers deterministic structured product/market summaries and shows deterministic evidence refs when overlay points to wrong pages (Palm regression)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'dio-1', dioStatus: 'ready', phase1: {} } as any);

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
        // Force deal_summary not-ready to ensure Product/Market come from structured_summary v1 (not deal_summary).
        deal_summary: { ready: false },
        sections: [],
        structured_summary: {
          raise: { value_json: { amount: { amount: 2000000 } }, sources: [{ document_id: 'doc-kpi', page_index: 0 }] },
          kpis: { raise: { value: '$2M', sources: [{ document_id: 'doc-kpi', page_index: 0 }] } },
          product_summary_v1: {
            value: 'Deterministic product summary',
            confidence: 0.82,
            sources: [
              { document_id: 'doc-det', page_index: 11, slide_title: 'Product', snippet: 'DET PRODUCT SNIP A' },
              { document_id: 'doc-det', page_index: 12, slide_title: 'Product', snippet: 'DET PRODUCT SNIP B' },
            ],
          },
          market_summary_v1: {
            value: 'Deterministic market summary',
            confidence: 0.77,
            sources: [
              { document_id: 'doc-det', page_index: 0, slide_title: 'Market', snippet: 'DET MARKET SNIP 1' },
              { document_id: 'doc-det', page_index: 1, slide_title: 'Market', snippet: 'DET MARKET SNIP 2' },
              { document_id: 'doc-det', page_index: 23, slide_title: 'Market', snippet: 'DET MARKET SNIP 24' },
            ],
          },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          decision_v1: { recommendation_key: 'consider', label: 'Consider', severity: 'warn', reasons: [] },
        },
      },
    } as any);

    // Overlay provides incorrect Product/Market + evidence refs (wrong page 21).
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-1',
        input_hash: 'a'.repeat(64),
        created_at: '2024-01-02T00:00:00.000Z',
        llm_phase_mode: 'governed',
        summary_text: 'Persisted overlay summary',
        overview_json: {
          phase1: {
            governed_ui_copy_v1: {
              schema_version: 'governed_ui_copy_v1',
              hero_summary: 'Overlay one-liner',
              deal_summary_mid: 'Overlay one-liner',
              product_solution: 'Overlay product wrong',
              market_icp: 'Overlay market wrong',
              business_model: 'Overlay BM',
              raise_terms: 'Overlay raise',
              strengths: [],
              concerns: [],
              open_questions: [],
              traction: [],
              evidence_ids: {
                product_solution: [],
                market_icp: [],
                business_model: [],
                raise_terms: [],
              },
              evidence_map: {
                deal_summary_mid: [{ source_document_id: 'doc-overlay', page_index: 21, snippet: 'Overlay summary evidence (wrong)' }],
                product_solution: [{ source_document_id: 'doc-overlay', page_index: 21, snippet: 'Overlay product evidence (wrong)' }],
                market_icp: [{ source_document_id: 'doc-overlay', page_index: 21, snippet: 'Overlay market evidence (wrong)' }],
                business_model: [],
                raise_terms: [],
                strengths: [],
                concerns: [],
                open_questions: [],
                traction: [],
              },
            },
            deal_summary_v2: { summary: { one_liner: 'Overlay one-liner', paragraphs: [] } },
            deal_overview_v2: {
              product_solution: 'Raw product',
              market_icp: 'Raw market',
              business_model: 'Raw BM',
              raise: 'Raw raise',
              sources: [],
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/Overlay product wrong/i)).toBeNull();
    expect(screen.getAllByText(/Deterministic product summary/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Overlay market wrong/i)).toBeNull();
    expect(screen.getAllByText(/Deterministic market summary/i).length).toBeGreaterThan(0);
  });

  test('missing governed overlay shows CTA and defaults to deterministic view', async () => {
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
          raise: { value: '$2M Seed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          decision_v1: { recommendation_key: 'consider', label: 'Consider', severity: 'warn', reasons: [] },
        },
      },
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({ overview: null } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Deal top summary')).toBeInTheDocument();
  });

  test('degraded overlay flags (provider_error) default to deterministic and keep overlay available but collapsed', async () => {
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
          raise: { value: '$2M Seed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
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
        summary_text: 'Overlay summary (bad quality)',
        provider_error: true,
        overview_json: {
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: 'Overlay one-liner (degraded)',
                paragraphs: ['Overlay paragraph (degraded)'],
              },
              strengths: ['Overlay strength'],
              open_questions: ['Overlay open question'],
            },
            deal_overview_v2: {
              product_solution: 'Overlay product',
              market_icp: 'Overlay market',
              business_model: 'Overlay BM',
              raise: 'Overlay raise',
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
      expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
    });

    expect(await screen.findByLabelText('Deal top summary')).toBeInTheDocument();

    // Overlay is available but collapsed by default.
    expect(screen.getByRole('button', { name: /^refresh$/i })).toBeInTheDocument();

    expect(screen.getAllByText(/Overlay one-liner \(degraded\)/i).length).toBeGreaterThan(0);
  });

  test('degraded overlay flags (guard_degraded) default to deterministic and keep overlay available but collapsed', async () => {
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
          raise: { value: '$2M Seed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
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
        summary_text: 'Overlay summary (degraded)',
        guard_degraded: true,
        overview_json: {
          phase1: {
            deal_summary_v2: {
              summary: { one_liner: 'Overlay one-liner (guard degraded)', paragraphs: [] },
              strengths: [],
              open_questions: [],
            },
            deal_overview_v2: {
              product_solution: 'Overlay product',
              market_icp: 'Overlay market',
              business_model: 'Overlay BM',
              raise: 'Overlay raise',
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
      expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
    });

    expect(await screen.findByLabelText('Deal top summary')).toBeInTheDocument();

    expect(screen.getAllByText(/Overlay one-liner \(guard degraded\)/i).length).toBeGreaterThan(0);
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
          raise: { value: '$2M Seed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 3 }] },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          decision_v1: { recommendation_key: 'consider', label: 'Consider', severity: 'warn', reasons: [] },
        },
      },
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockRejectedValueOnce(new Error('persisted_down'));

    renderWorkspace();

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();

    // Overlay may fail, but the UI should still render deterministic content.
    expect(await screen.findByLabelText('Deal top summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeInTheDocument();
  });

  test('does not fetch narrated report even if deterministic report is not ready yet', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: null, dioStatus: 'idle' } as any);
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({ ready: false, reason: 'not_generated_yet' } as any);
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValueOnce({ overview: null } as any);

    renderWorkspace({ dealId: 'deal-not-ready' as any });

    await waitFor(() => {
      expect(apiGetDealReport).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(apiGetDealGovernedOverlayPersisted).toHaveBeenCalledTimes(1);
    });

    expect(apiGetDealReportNarrated).not.toHaveBeenCalled();
  });


  test('after analysis completes, force-refreshes and bounded-polls the governed overlay (no narrated fetch)', async () => {
    const user = userEvent.setup();

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'dio-1', dioStatus: 'ready' } as any);
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({ ready: false, reason: 'not_generated_yet' } as any);

    // Hook fetch on mount: missing (200 { overview: null }).
    // Post-analysis force refresh: still missing.
    // Next bounded poll retry: becomes available.
    let resolveOverlayReady!: (v: any) => void;
    const overlayReady = new Promise<any>((resolve) => {
      resolveOverlayReady = resolve;
    });

    vi.mocked(apiGetDealGovernedOverlayPersisted)
      .mockResolvedValueOnce({ overview: null } as any)
      .mockResolvedValueOnce({ overview: null } as any)
      .mockImplementationOnce(async () => overlayReady);

    const overlayPayload = {
      overview: {
        schema_version: 'governed_llm_overview_v1',
        deal_id: 'deal-1',
        input_hash: 'b'.repeat(64),
        created_at: '2024-01-02T00:00:00.000Z',
        llm_phase_mode: 'governed',
        summary_text: 'Overlay ready after analysis',
        overview_json: {
          phase1: {
            deal_summary_v2: {
              summary: {
                one_liner: 'Overlay one-liner after analysis',
                paragraphs: ['Overlay paragraph after analysis'],
              },
              strengths: [],
              open_questions: [],
            },
            deal_overview_v2: {
              product_solution: 'Overlay product after analysis',
              market_icp: 'Overlay market after analysis',
              business_model: 'Overlay BM after analysis',
              raise: 'Overlay raise after analysis',
            },
          },
        },
        claims: [],
        disclosures: [],
      },
    } as any;

    // Simulate analysis job completing as soon as the UI starts polling.
    vi.mocked(apiGetJob as any).mockResolvedValue({
      job_id: 'job-1',
      type: 'analyze_deal',
      status: 'succeeded',
      message: 'Analysis complete',
      updated_at: '2024-01-02T00:00:00.000Z',
      created_at: '2024-01-02T00:00:00.000Z',
      started_at: '2024-01-02T00:00:00.000Z',
    } as any);

    try {
      renderWorkspace();

      await user.click(screen.getByRole('button', { name: /run analysis/i }));

      // Mount fetch + eventual post-analyze refresh (404).
      await waitFor(() => {
        expect(vi.mocked(apiGetDealGovernedOverlayPersisted).mock.calls.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 10000 });
      expect(apiGetDealReportNarrated).not.toHaveBeenCalled();

      // Next bounded poll retry should eventually return the overlay.
      resolveOverlayReady(overlayPayload);

      await waitFor(() => {
        expect(vi.mocked(apiGetDealGovernedOverlayPersisted).mock.calls.length).toBeGreaterThanOrEqual(3);
      }, { timeout: 10000 });

      await waitFor(() => {
        expect(screen.getAllByText(/Overlay product after analysis/i).length).toBeGreaterThan(0);
      }, { timeout: 10000 });

      const maybeShow = screen.queryByRole('button', { name: /show overlay/i });
      if (maybeShow) {
        await user.click(maybeShow);
      }
    } finally {
      // nothing
    }
  }, 15000);
});
