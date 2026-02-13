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
    return render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-1" dealData={baseDeal} {...overrides} />
      </ScoreSourceProvider>
    );
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
        summary_text: 'Persisted overlay summary',
        overview_json: {
          phase1: {
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
    expect(screen.getAllByText(/Needs review/i).length).toBeGreaterThan(0);

    // Deterministic evidence-backed facts win over overlay facts.
    expect(screen.getAllByText(/Usage-based SaaS/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Overlay BM/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/\$2M Seed/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Overlay raise/i)).not.toBeInTheDocument();

    // Provenance chips: market from overlay, raise from deterministic, product suppressed.
    expect(screen.getAllByText(/Governed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Authoritative \(deterministic\)/i).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getAllByText(/Summary/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay paragraph 1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay paragraph 2/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Strengths/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay strength/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Risks/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay risk/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Open Questions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay open question/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Traction Signals/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay traction/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overlay key risk/i).length).toBeGreaterThan(0);

    // Deterministic blocks are behind a drawer toggle.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Show Deterministic \(Authoritative\)/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Show Deterministic \(Authoritative\)/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hide Deterministic \(Authoritative\)/i })).toBeInTheDocument();
    });
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
    const productFact = screen.getByTestId('key-fact-product');
    expect(within(productFact).getAllByText(/send payment requests\. makes our lives SO much easier\./i).length).toBeGreaterThan(0);
    expect(within(productFact).queryByText(/From Visa\/Mastercard/i)).not.toBeInTheDocument();

    const marketFact = screen.getByTestId('key-fact-market');
    expect(within(marketFact).getAllByText(/organic with no tickets & happier\./i).length).toBeGreaterThan(0);
    expect(within(marketFact).queryByText(/PIPE \| PIPE/i)).not.toBeInTheDocument();
  });

  test('renders display_facts_v1 with evidence popovers when deterministic is missing', async () => {
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

    // Evidence popover triggers should render for the governed fact.
    expect(screen.getAllByRole('button', { name: /view sources/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /view raw deterministic snippet/i }).length).toBeGreaterThan(0);

    // Open sources popover and validate resolved snippet content renders.
    await userEvent.click(screen.getAllByRole('button', { name: /view sources/i })[0]);
    expect(screen.getAllByText(/Pitch Deck/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/RAW SNIPPET: Product does X for Y\./i).length).toBeGreaterThan(0);
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
    expect(screen.getByText(/Run analysis to generate governed overlay\./i)).toBeInTheDocument();

    // Deterministic defaults open when overlay is missing.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hide Deterministic \(Authoritative\)/i })).toBeInTheDocument();
    });
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

    // Degraded overlay: deterministic defaults visible.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hide Deterministic \(Authoritative\)/i })).toBeInTheDocument();
    });

    // Overlay is available but collapsed by default.
    expect(screen.getByText(/Overview \(governed overlay\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Governed overlay is degraded — deterministic output is shown by default\./i)).toBeInTheDocument();
    expect(screen.getByText(/provider_error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh overlay/i })).toBeInTheDocument();

    // Collapsed => overlay one-liner isn't visible until expanded.
    expect(screen.queryByText(/Overlay one-liner \(degraded\)/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show governed overlay/i }));
    expect(screen.getByText(/Overlay one-liner \(degraded\)/i)).toBeInTheDocument();
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hide Deterministic \(Authoritative\)/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/guard_degraded/i)).toBeInTheDocument();
    expect(screen.queryByText(/Overlay one-liner \(guard degraded\)/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show governed overlay/i }));
    expect(screen.getByText(/Overlay one-liner \(guard degraded\)/i)).toBeInTheDocument();
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hide Deterministic \(Authoritative\)/i })).toBeInTheDocument();
    });

    // Overlay may fail, but the UI should still render deterministic content.
    expect(screen.getAllByText(/Governed overlay/i).length).toBeGreaterThan(0);
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

      // While bounded polling is active and overlay is missing, show the status text.
      await waitFor(() => {
        expect(screen.getByText(/Overlay still processing… refreshing automatically\./i)).toBeInTheDocument();
      }, { timeout: 10000 });

      // Next bounded poll retry should eventually return the overlay.
      resolveOverlayReady(overlayPayload);

      await waitFor(() => {
        expect(vi.mocked(apiGetDealGovernedOverlayPersisted).mock.calls.length).toBeGreaterThanOrEqual(3);
      }, { timeout: 10000 });

      await waitFor(() => {
        expect(screen.getByText(/Overview \(governed overlay\)/i)).toBeInTheDocument();
      }, { timeout: 10000 });

      const maybeShow = screen.queryByRole('button', { name: /show governed overlay/i });
      if (maybeShow) {
        await user.click(maybeShow);
      }

      await waitFor(() => {
        expect(screen.queryByText(/Overlay still processing… refreshing automatically\./i)).not.toBeInTheDocument();
      }, { timeout: 10000 });
    } finally {
      // nothing
    }
  }, 15000);
});
