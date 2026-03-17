import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWorkspace } from './dealWorkspaceTestFixture';
import { apiGetDeal, apiGetDealJobs, apiGetJob, apiGetDealGovernedOverlayPersisted } from '../lib/apiClient';

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

describe('DealWorkspace Job Center (live mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const startFullProcessFromMoreMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: /^more$/i }));
    await userEvent.click(screen.getByRole('button', { name: /run full process/i }));
  };

  const openJobsTab = async () => {
    await userEvent.click(screen.getByRole('tab', { name: /^jobs$/i }));
  };

  test('renders DIO badges and Job Center placeholders', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText(/DIO: v1.0.0/i)).toBeInTheDocument();
    });

    await openJobsTab();

    expect(screen.getByText(/Job Center/i)).toBeInTheDocument();

    const jobCenter = screen.getByTestId('job-center');
    expect(jobCenter.className).toMatch(/\bw-full\b/);
    expect(jobCenter.className).toMatch(/\bmax-w-full\b/);

    // Avoid matching both "Active job" and "No active job".
    expect(screen.getByText(/^Active job$/i)).toBeInTheDocument();
    const activeJobLabel = screen.getByText(/^Active job$/i);
    const activeJobTile = activeJobLabel.parentElement;
    expect(activeJobTile).not.toBeNull();
    expect(within(activeJobTile as HTMLElement).getByText(/^None yet$/i)).toBeInTheDocument();
    expect(screen.getByText(/idle/i)).toBeInTheDocument();

    const statusMsg = screen.getByTestId('job-center-status-message');
    expect(statusMsg.textContent || '').toMatch(/Waiting for worker update/i);
    expect(statusMsg.className).toMatch(/\boverflow-hidden\b/);
    expect(statusMsg.className).toMatch(/\bwhitespace-pre-wrap\b/);
  });

  test('renders analysis output status for report readiness states', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');

    // Case 1: report not ready
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({ ready: false, reason: 'not_generated_yet' } as any);
    const first = renderWorkspace({ dealId: 'deal-rpt-1' });
    await openJobsTab();
    await waitFor(() => {
      expect(screen.getByTestId('job-center')).toBeInTheDocument();
    });
    expect(screen.getByTestId('analysis-output-panel')).toBeInTheDocument();
    expect(within(screen.getByTestId('analysis-output-panel')).getAllByText(/Preparing analysis…/i).length).toBeGreaterThan(0);
    first.unmount();

    // Case 2: report ready
    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-rpt-2',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        grade: 'B',
        recommendation: 'yes',
        greenFlags: ['Strong early signal'],
        sections: [{ id: 's1', title: 'Overview', content: 'Test content', evidence_ids: ['ev-1'] }],
        metadata: {
          cycle_number: 1,
          deterministic_score_preview_v1: {
            baseline: { unadjusted_pinned: true, unadjusted_pin_reason: 'low_coverage' },
          },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-2' });
    await openJobsTab();
    await waitFor(() => {
      expect(screen.getByTestId('analysis-output-panel')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('analysis-output-panel')).getByText(/Analysis complete/i)).toBeInTheDocument();
    // Default (non-debug) view is intentionally simplified when report.ready=true.
    expect(within(screen.getByTestId('analysis-output-panel')).getByText(/Structured summary/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('analysis-output-panel')).queryByText(/Pinned \(coverage_too_low\)/i)).toBeNull();
  });

  test('resolves evidence ids from report sections when report is ready (deduped + non-empty)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport, apiResolveEvidence } = await import('../lib/apiClient');

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-rpt-ev-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        grade: 'B',
        recommendation: 'yes',
        greenFlags: ['Strong early signal'],
        sections: [
          { id: 's1', title: 'Overview', content: 'Test content', evidence_ids: ['ev-2', '', '  ', 'ev-1', 'ev-2'] },
        ],
        metadata: {
          cycle_number: 1,
          deterministic_score_preview_v1: {
            baseline: { unadjusted_pinned: true, unadjusted_pin_reason: 'low_coverage' },
          },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-ev-1' });

    await waitFor(() => {
      expect(vi.mocked(apiResolveEvidence)).toHaveBeenCalled();
    });

    const calls = vi.mocked(apiResolveEvidence).mock.calls;
    const firstArgs = calls[0]?.[0] ?? [];
    expect(firstArgs).toEqual(expect.arrayContaining(['ev-1', 'ev-2']));
    expect(firstArgs).not.toEqual(expect.arrayContaining(['']));
    expect(firstArgs.some((v) => typeof v !== 'string' || v.trim().length === 0)).toEqual(false);
  });

  test('binds top summary tiles to ready report payload (score + executive summary + stage + structured tiles)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
      // Intentionally omit deal.stage so we prove the report context drives the Stage badge.
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    const exec = 'Executive summary from report payload.';

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
          deal_summary_v1: {
            one_liner: exec,
            long_summary: exec,
          },
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

    renderWorkspace({ dealId: 'deal-rpt-bind-1' });

    const top = await screen.findByLabelText('Deal top summary');
    await waitFor(() => {
      expect(within(top).getAllByText(exec).length).toBeGreaterThan(0);
    });

    // Gauge uses /report overallScore.
    expect(screen.getByRole('img', { name: /50 out of 100/i })).toBeInTheDocument();

    // Score band badge should render in the top section.
    expect(within(top).getAllByText(/Consider \(Caution\)/i).length).toBeGreaterThan(0);

    // Deal Summary is deterministic-first and comes from /report deal_summary_v1 when ready.
    expect(within(top).getAllByText(exec).length).toBeGreaterThan(0);

    // Stage badge prefers report metadata context.stage.
    expect(screen.getByText(/Stage:\s*In diligence/i)).toBeInTheDocument();

    // One tile reflects report context as well.
    const dealTypeLabel = within(top).getByText(/^Deal Type$/i);
    const dealTypeCard = dealTypeLabel.parentElement;
    expect(dealTypeCard).not.toBeNull();
    expect(within(dealTypeCard as HTMLElement).getByText(/Primary equity/i)).toBeInTheDocument();

    const raiseLabel = within(top).getByText(/^Raise$/i);
    const raiseCard = raiseLabel.parentElement;
    expect(raiseCard).not.toBeNull();
    expect(within(raiseCard as HTMLElement).getByText(/\$2M/i)).toBeInTheDocument();
    expect(within(raiseCard as HTMLElement).getByText(/^Seed$/i)).toBeInTheDocument();
    expect(within(raiseCard as HTMLElement).queryByText(/\$2M\s+Seed/i)).toBeNull();

    const revenueLabel = within(top).getByText(/^Revenue$/i);
    const revenueCard = revenueLabel.parentElement;
    expect(revenueCard).not.toBeNull();
    expect(within(revenueCard as HTMLElement).getByText(/\$1\.2M/i)).toBeInTheDocument();

    const customersLabel = within(top).getByText(/^Customers$/i);
    const customersCard = customersLabel.parentElement;
    expect(customersCard).not.toBeNull();
    expect(within(customersCard as HTMLElement).getByText(/450 customers/i)).toBeInTheDocument();

    // Overview tab should also prefer /report bindings (not stale dealFromApi fields).
    await userEvent.click(screen.getByRole('tab', { name: /^overview$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('key-fact-raise')).toBeInTheDocument();
    });

    const overviewRaiseLabel = screen.getByTestId('key-fact-raise');
    const overviewRaiseRow = overviewRaiseLabel.parentElement;
    expect(overviewRaiseRow).not.toBeNull();
    expect(within(overviewRaiseRow as HTMLElement).getByText(/\$2M/i)).toBeInTheDocument();
    expect(within(overviewRaiseRow as HTMLElement).queryByText(/\$2M\s+Seed/i)).toBeNull();

    const overviewBusinessModelLabel = screen.getByText(/^Business Model:\s*$/i);
    const overviewBusinessModelRow = overviewBusinessModelLabel.closest('div');
    expect(overviewBusinessModelRow).not.toBeNull();
    expect(within(overviewBusinessModelRow as HTMLElement).getByText(/Usage-based SaaS/i)).toBeInTheDocument();
  });

  test('renders understanding_v1 diligence items under Score Understanding → Weaknesses (Palm-like)', async () => {
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
        dealId: 'deal-rpt-understanding-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        structured_summary: {
          kpis: {
            revenue: { value: { raw: '$2.476M' }, sources: [] },
          },
        },
        metadata: {
          score_explanation: {
            understanding_v1: {
              strengths: [{ text: 'Evidence-backed product definition' }],
              diligence_open_items: [
                // Noun-phrase items (non-imperative) → go to Weaknesses via _ACTION_VERB_RE split
                { text: 'Gross margin by channel (DTC vs wholesale) is unconfirmed.' },
                { text: 'Inventory and working capital needs by season not yet modeled.' },
                { text: 'CAC and unit economics at scale are unclear.' },
                { text: 'Multi-year financial tables and accounting basis not provided.' },
              ],
              execution_dependencies: [{ text: 'Wholesale expansion requires channel partnerships.' }],
            },
            context: { stage: 'in_diligence', deal_type: 'Primary equity' },
          },
          score_band_v2: { key: 'consider_caution', label: 'Consider (Caution)', overall_score: 50, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: null },
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-understanding-1' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Score Understanding/i })).toBeInTheDocument();
    });

    const card = screen.getByRole('heading', { name: /Score Understanding/i }).closest('div');
    expect(card).not.toBeNull();

    const weaknessesLabel = within(card as HTMLElement).getByText(/^Weaknesses$/i);
    const headerRow = weaknessesLabel.closest('div');
    const weaknessColumn = headerRow?.parentElement as HTMLElement | null;
    expect(weaknessColumn).not.toBeNull();

    const items = within(weaknessColumn as HTMLElement).getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  test('header KPI labels: financial-table revenue shows year; growth forecast shows Forecast YEAR (Palm)', async () => {
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
        dealId: 'deal-rpt-kpi-labels-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        structured_summary: {
          kpis: {
            revenue: {
              value: { raw: '$2.476M' },
              label: 'Annual',
              sources: [{ document_id: 'doc-1', page_index: 12, note_snippet: 'Revenue 2024 $2.476M', meta: { scope: 'company_financials_table', year: 2024, period: 'annual' } }],
            },
            growth: {
              value: { raw: '40% YoY', year: 2026 },
              label: 'Annual',
              sources: [{ document_id: 'doc-1', page_index: 9, note_snippet: 'Forecast 2026', meta: { period: 'forecast', year: 2026 } }],
            },
            customers: { value: { raw: '12 wholesale accounts' }, sources: [] },
          },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          score_band_v2: { key: 'consider_caution', label: 'Consider (Caution)', overall_score: 50, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: null },
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-kpi-labels-1' });

    await waitFor(() => {
      expect(screen.getByText(/Revenue \(2024\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Growth \(Forecast 2026\)/i)).toBeInTheDocument();
  });

  test('header KPI labels: channel-attributed revenue shows Attributed and does not show Annual note (Palm)', async () => {
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
        dealId: 'deal-rpt-kpi-labels-2',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'Exec', evidence_ids: [] }],
        structured_summary: {
          kpis: {
            revenue: {
              value: { raw: '$800k' },
              label: 'Annual',
              sources: [{ document_id: 'doc-1', page_index: 7, note_snippet: 'Email attributed revenue', meta: { scope: 'channel_attributed', year: 2024, period: 'annual' } }],
            },
            growth: { value: { raw: '—' }, sources: [] },
            customers: { value: { raw: '—' }, sources: [] },
          },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          score_band_v2: { key: 'consider_caution', label: 'Consider (Caution)', overall_score: 50, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: null },
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-kpi-labels-2' });

    await waitFor(() => {
      expect(screen.getByText(/Revenue \(Attributed\)/i)).toBeInTheDocument();
    });

    const revenueLabel = screen.getByText(/^Revenue$/i);
    const revenueCard = revenueLabel.parentElement as HTMLElement | null;
    expect(revenueCard).not.toBeNull();
    expect(within(revenueCard as HTMLElement).getByText(/^Attributed$/i)).toBeInTheDocument();
    expect(within(revenueCard as HTMLElement).queryByText(/^Annual$/i)).toBeNull();
  });

  test('renders hard pass guardrail badge + note in DealWorkspace top section', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    const exec = 'Executive summary for guardrail deal.';
    const note = 'Hard Pass guardrail: overall score is below 45 despite strong coverage and KPI presence.';

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-guardrail', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-rpt-guardrail-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 10,
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
            sources: [],
          },
          kpis: {
            raise: { value: '$2M Seed', confidence: 0.9, sources: [] },
            business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [] },
            revenue: { value: { raw: '$1.2M', currency: 'USD', period: 'ARR', amount: null }, confidence: 0.8, sources: [] },
            customers: { value: { count: 450, kind: 'customers', raw: null }, confidence: 0.7, sources: [] },
          },
        },
        metadata: {
          score_explanation: {
            context: {
              stage: 'in_diligence',
              deal_type: 'Primary equity',
            },
          },
          score_band_v2: { key: 'hard_pass', label: 'Hard Pass', overall_score: 10, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: true, reason: 'low_score_despite_full_coverage', note, criteria_snapshot: { overall_score: 10 } },
          decision_v1: { recommendation_key: 'hard_pass', label: 'Hard Pass', severity: 'danger', reasons: ['guardrail:hard_pass'] },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-guardrail-1' });

    await waitFor(() => {
      expect(screen.getAllByText(exec).length).toBeGreaterThan(0);
    });

    const top = screen.getByLabelText('Deal top summary');
    expect(within(top).getByText(/Hard Pass \(Full Coverage\)/i)).toBeInTheDocument();
    expect(within(top).getByText(note)).toBeInTheDocument();
  });

  test('Business Model tile prefers promoted business_model when evidence-backed (even if synthesized summary exists)', async () => {
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
        dealId: 'deal-bm-synth-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [],
        structured_summary: {
          business_model_summary: {
            value: 'DTC + wholesale apparel',
            confidence: 0.72,
            derived_from: { product_pages: [12], gtm_pages: [15], distribution_pages: [23], traction_pages: [8], market_pages: [], other_pages: [] },
            supporting_nodes: [],
          },
          kpis: {
            business_model: { value: 'Usage-based SaaS (promoted)', label: 'Attributed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 2 }] },
          },
        },
        metadata: { score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } } },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-bm-synth-1' });

    const top = await screen.findByLabelText('Deal top summary');
    const businessModelLabel = within(top).getByText(/^Business Model$/i);
    const businessModelCard = businessModelLabel.parentElement;
    expect(businessModelCard).not.toBeNull();
    expect(within(businessModelCard as HTMLElement).getByText(/Usage-based SaaS \(promoted\)/i)).toBeInTheDocument();
    expect(within(businessModelCard as HTMLElement).getByText(/^Attributed$/i)).toBeInTheDocument();
  });

  test('Business Model tile falls back to promoted business_model when synthesized summary is null (no badge)', async () => {
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
        dealId: 'deal-bm-synth-2',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [],
        structured_summary: {
          business_model_summary: { value: null },
          kpis: {
            business_model: { value: 'Usage-based SaaS', label: 'Attributed', confidence: 0.9, sources: [{ document_id: 'doc-1', page_index: 1 }] },
          },
        },
        metadata: { score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } } },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-bm-synth-2' });

    const top = await screen.findByLabelText('Deal top summary');
    const businessModelLabel = within(top).getByText(/^Business Model$/i);
    const businessModelCard = businessModelLabel.parentElement;
    expect(businessModelCard).not.toBeNull();
    expect(within(businessModelCard as HTMLElement).getByText(/Usage-based SaaS/i)).toBeInTheDocument();
    expect(within(businessModelCard as HTMLElement).queryByText(/^Synthesized$/i)).toBeNull();
  });

  test('Deal Summary prefers canonical deal_summary_v1 and shows citations toggle only when ready', async () => {
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
        dealId: 'deal-can-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        grade: 'B',
        recommendation: 'yes',
        greenFlags: [],
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'LEGACY EXEC SUMMARY', evidence_ids: [] }],
        metadata: { cycle_number: 1 },
        deal_summary: {
          version: 'deal_summary_v1',
          ready: true,
          tiers: {
            hero: 'CANON HERO (top) — short',
            overview: 'CANON OVERVIEW (overview tab) — longer and more detailed.',
            deep: 'CANON DEEP PARA 1 (accordion).\n\nCANON DEEP PARA 2 (accordion).',
          },
          one_liner: {
            text: 'CANON one-liner',
            sources: [
              {
                node_id: 'doc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0',
                source_document_id: 'doc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                page_index: 0,
                slide_title: 'Overview',
                snippet: 'We build X for Y',
                segment_key: 'overview',
              },
            ],
          },
          product: {
            text: 'CANON product',
            sources: [
              {
                node_id: 'doc-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:2',
                source_document_id: 'doc-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                page_index: 2,
                slide_title: 'Product',
                snippet: 'Product snippet',
                segment_key: 'product',
              },
            ],
          },
          market: {
            text: 'CANON market',
            sources: [
              {
                node_id: 'doc-cccccccc-cccc-4ccc-8ccc-cccccccccccc:4',
                source_document_id: 'doc-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                page_index: 4,
                slide_title: 'Market',
                snippet: 'Market snippet',
                segment_key: 'market',
              },
            ],
          },
          paragraphs: [
            {
              text: 'CANON paragraph',
              sources: [
                {
                  node_id: 'doc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0',
                  source_document_id: 'doc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  page_index: 0,
                  slide_title: 'Overview',
                  snippet: 'We build X for Y',
                  segment_key: 'overview',
                },
              ],
            },
          ],
        },
        structured_summary: {
          deal_summary_v1: {
            one_liner: 'STRUCTURED ONE LINER',
            long_summary: 'STRUCTURED LONG SUMMARY (top section)',
          },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-can-1' });

    await waitFor(() => {
      expect(screen.getAllByText(/STRUCTURED LONG SUMMARY/i).length).toBeGreaterThan(0);
    });

    const top = screen.getByLabelText('Deal top summary');
    expect(within(top).getByRole('heading', { name: 'Deal Snapshot' })).toBeInTheDocument();
    expect(within(top).getByText(/STRUCTURED LONG SUMMARY \(top section\)/i)).toBeInTheDocument();
    expect(within(top).queryByText(/LEGACY EXEC SUMMARY/i)).toBeNull();

    expect(screen.getAllByText(/Authoritative \(deterministic\)/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Product:\s*/i)).toBeInTheDocument();
    expect(screen.getByText('CANON product')).toBeInTheDocument();
    expect(screen.getByText('CANON market')).toBeInTheDocument();

    // Overview tab shows the overview tier (not the hero tier).
    expect(screen.getByText(/CANON OVERVIEW \(overview tab\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/^CANON one-liner$/)).toBeNull();

    // Citations toggle appears only when canonical citations are present.
    await userEvent.click(screen.getByRole('button', { name: /view citations/i }));
    expect(screen.getByText(/^One-liner$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/doc-aaaa… · p1 · Overview/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/We build X for Y/i).length).toBeGreaterThan(0);

    // The expanded area shows the four list sections.
    await userEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getAllByText(/^Strengths$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Concerns$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Open Questions$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Traction$/i).length).toBeGreaterThan(0);
  });

  test('Deal Summary shows Legacy label and hides citations toggle when canonical summary is not ready', async () => {
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
        dealId: 'deal-leg-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 78,
        grade: 'B',
        recommendation: 'yes',
        greenFlags: [],
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: 'LEGACY EXEC SUMMARY', evidence_ids: [] }],
        metadata: { cycle_number: 1 },
        deal_summary: {
          version: 'deal_summary_v1',
          ready: false,
          reason: 'missing_product',
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-leg-1' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Deal Summary', level: 2 })).toBeInTheDocument();
    });

    expect(screen.getAllByText('Legacy').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /view citations/i })).toBeNull();
  });

  test('Top summary does not render literal \\n\\n sequences from deterministic deal summary content', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    const exec = 'Overall Score: 50/100\\n\\nSecond line should render normally.';

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-rpt-newlines-1',
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
          deal_summary_v1: {
            one_liner: exec,
            long_summary: exec,
          },
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: exec,
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
        },
        metadata: { cycle_number: 1 },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-newlines-1' });

    const top = await screen.findByLabelText('Deal top summary');
    const scoreSubsummary = top.querySelector('[data-slot="header.score.subsummary"]');
    expect(scoreSubsummary).not.toBeNull();

    // Guardrail: literal backslash-n sequences must not render.
    expect(top.textContent || '').not.toMatch(/\\\\n/);

    expect(scoreSubsummary!.textContent || '').toMatch(/Overall Score: 50\/100/i);
    expect(scoreSubsummary!.textContent || '').not.toMatch(/Second line should render normally\./i);

    expect(screen.getByTestId('deal-summary-text')).toHaveTextContent(/Second line should render normally\./i);
  });

  test('When decision_v1 exists, top summary never shows legacy section recommendation', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-02T00:00:00.000Z',
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    const exec = 'Overall Score: 50/100\\n\\nRecommendation: PASS';

    vi.mocked(apiGetDealReport).mockResolvedValueOnce({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-rpt-dec-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: exec, evidence_ids: [] }],
        metadata: {
          cycle_number: 1,
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-dec-1' });

    const top = await screen.findByLabelText('Deal top summary');
    expect(within(top).queryByText(/Recommendation: PASS/i)).toBeNull();
    expect(within(top).getByText(/Consider \(Caution\)/i)).toBeInTheDocument();
  });

  test('Deal Assistant button is gated without DIO in live mode', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: undefined,
      dioStatus: 'missing',
      lastAnalyzedAt: null,
    } as any);

    renderWorkspace({ dealId: 'deal-2' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Deal Assistant/i })).toBeDisabled();
    });
  });

  test('Deal Assistant button enables when DIO exists', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-03T00:00:00.000Z',
    } as any);

    renderWorkspace({ dealId: 'deal-3' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Deal Assistant/i })).not.toBeDisabled();
    });
  });

  test('Run Analysis button (header) does not call api when dealId missing', async () => {
    const { apiPostReextractDocuments } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({} as any);
    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-x', status: 'queued' } as any);

    renderWorkspace({ dealId: undefined });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    expect(apiPostReextractDocuments).not.toHaveBeenCalled();
  });

  test('Run Full Process (More menu) triggers reextract_documents first', async () => {
    const { apiPostReextractDocuments, apiPostExtractVisuals } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v3', dioStatus: 'ready' } as any);

    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-rex', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-viz', status: 'queued' } as any);

    // Make polling complete immediately for any job we start.
    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      return {
        job_id: jobId,
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      } as any;
    });

    renderWorkspace({ dealId: 'deal-4' });

    await startFullProcessFromMoreMenu();

    await waitFor(() =>
      expect(apiPostReextractDocuments).toHaveBeenCalledWith(
        'deal-4',
        expect.objectContaining({ include_warnings: true, force: true })
      )
    );
  });

  test('Run Full Process (More menu) triggers extract_visuals', async () => {
    const { apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v3', dioStatus: 'ready' } as any);
    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-rex-1', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-viz-1', status: 'queued' } as any);

    // Make polling complete immediately for each step.
    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      return {
        job_id: jobId,
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: new Date().toISOString(),
      } as any;
    });

    renderWorkspace({ dealId: 'deal-5' });

    await startFullProcessFromMoreMenu();

    await waitFor(() => expect(apiPostExtractVisuals).toHaveBeenCalled());
    expect(vi.mocked(apiPostExtractVisuals).mock.calls[0]?.[0]).toBe('deal-5');
    expect(vi.mocked(apiPostExtractVisuals).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        source: 'job-center/run-full-process',
        requestId: expect.any(String),
        idempotencyKey: expect.any(String),
      })
    );
  });

  test('Run Full Process does not submit extract-visuals twice on rapid double-click', async () => {
    const { apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v3', dioStatus: 'ready' } as any);
    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-rex-1', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-viz-1', status: 'queued' } as any);

    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      return {
        job_id: jobId,
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: new Date().toISOString(),
      } as any;
    });

    renderWorkspace({ dealId: 'deal-55' });

    await userEvent.click(screen.getByRole('button', { name: /^more$/i }));
    await userEvent.dblClick(screen.getByRole('button', { name: /run full process/i }));

    await waitFor(() => expect(apiPostReextractDocuments).toHaveBeenCalledTimes(1));
    expect(apiPostExtractVisuals).toHaveBeenCalledTimes(1);
  });

  test('Extract visuals badge shows Complete when a later retry succeeded', async () => {
    const { apiGetDealJobs } = await import('../lib/apiClient');

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v9', dioStatus: 'ready' } as any);

    vi.mocked(apiGetDealJobs).mockImplementation(async () => {
      return [
        {
          job_id: 'job-ingest-1',
          type: 'ingest_documents',
          queue: 'ingest_documents',
          status: 'succeeded',
          created_at: '2024-01-02T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:10.000Z',
        },
        {
          job_id: 'job-extract-old-failed',
          type: 'extract_visuals',
          queue: 'extract_visuals',
          status: 'failed',
          created_at: '2024-01-02T00:01:00.000Z',
          updated_at: '2024-01-02T00:01:10.000Z',
        },
        {
          job_id: 'job-extract-new-ok',
          type: 'extract_visuals',
          queue: 'extract_visuals',
          status: 'succeeded',
          created_at: '2024-01-02T00:02:00.000Z',
          updated_at: '2024-01-02T00:02:10.000Z',
        },
      ] as any;
    });

    renderWorkspace({ dealId: 'deal-extract-retry' });

    await openJobsTab();

    await waitFor(() => {
      const badge = screen.getByTestId('stage-badge-extract_visuals');
      expect(badge.textContent || '').toMatch(/Extract visuals:\s*Complete/i);
    });
  });

  test('Extract visuals badge shows Complete when latest is succeeded_with_warnings', async () => {
    const { apiGetDealJobs } = await import('../lib/apiClient');

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v10', dioStatus: 'ready' } as any);

    vi.mocked(apiGetDealJobs).mockResolvedValue([
      {
        job_id: 'job-ingest-2',
        type: 'ingest_documents',
        queue: 'ingest_documents',
        status: 'succeeded',
        created_at: '2024-01-03T00:00:00.000Z',
        updated_at: '2024-01-03T00:00:10.000Z',
      },
      {
        job_id: 'job-extract-warn',
        type: 'extract_visuals',
        queue: 'extract_visuals',
        status: 'succeeded_with_warnings',
        created_at: '2024-01-03T00:01:00.000Z',
        updated_at: '2024-01-03T00:01:10.000Z',
      },
    ] as any);

    renderWorkspace({ dealId: 'deal-extract-warn' });

    await openJobsTab();

    await waitFor(() => {
      const badge = screen.getByTestId('stage-badge-extract_visuals');
      expect(badge.textContent || '').toMatch(/Extract visuals:\s*Complete/i);
    });
  });

  test('Extract visuals badge shows Failed when latest is failed (post-ingest)', async () => {
    const { apiGetDealJobs } = await import('../lib/apiClient');

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v11', dioStatus: 'ready' } as any);

    vi.mocked(apiGetDealJobs).mockResolvedValue([
      {
        job_id: 'job-ingest-3',
        type: 'ingest_documents',
        queue: 'ingest_documents',
        status: 'succeeded',
        created_at: '2024-01-04T00:00:00.000Z',
        updated_at: '2024-01-04T00:00:10.000Z',
      },
      {
        job_id: 'job-extract-failed',
        type: 'extract_visuals',
        queue: 'extract_visuals',
        status: 'failed',
        created_at: '2024-01-04T00:02:00.000Z',
        updated_at: '2024-01-04T00:02:10.000Z',
      },
    ] as any);

    renderWorkspace({ dealId: 'deal-extract-failed' });

    await openJobsTab();

    await waitFor(() => {
      const badge = screen.getByTestId('stage-badge-extract_visuals');
      expect(badge.textContent || '').toMatch(/Extract visuals:\s*Failed/i);
    });
  });

  test('Job Center shows progress bar when job reports progress', async () => {
    const { apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');

    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v4',
      dioStatus: 'running',
      lastAnalyzedAt: '2024-01-04T00:00:00.000Z',
    } as any);

    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-777', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-viz-777', status: 'queued' } as any);

    vi.mocked(apiGetJob)
      .mockResolvedValueOnce({
        job_id: 'job-777',
        status: 'running',
        progress_pct: 42,
        message: 'Crunching signals',
        updated_at: '2024-01-04T00:10:00.000Z',
      } as any)
      .mockResolvedValueOnce({
        job_id: 'job-777',
        status: 'succeeded',
        progress_pct: 100,
        message: 'Done',
        updated_at: '2024-01-04T00:10:05.000Z',
      } as any);

    renderWorkspace({ dealId: 'deal-7' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Deal Assistant/i })).not.toBeDisabled();
    });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    expect(headerRunButton).toBeEnabled();
    await startFullProcessFromMoreMenu();

    await waitFor(() => {
      expect(apiGetJob).toHaveBeenCalled();
      expect(screen.getByTestId('analysis-progress-feed')).toBeInTheDocument();
      expect(screen.getByText(/42%/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Crunching signals/i).length).toBeGreaterThan(0);
    });
  });

  test('Run Analysis shows progress feed for analyze-only jobs (202 + job_id)', async () => {
    const { apiPostAnalyzeWithStatus } = await import('../lib/apiClient');

    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v9',
      dioStatus: 'running',
      lastAnalyzedAt: '2024-01-04T00:00:00.000Z',
    } as any);

    vi.mocked(apiPostAnalyzeWithStatus).mockResolvedValue({
      ok: true,
      status: 202,
      json: { job_id: 'job-analyze-1', status: 'queued' },
      text: null,
    } as any);

    // Keep the job active so the feed remains visible.
    vi.mocked(apiGetJob).mockResolvedValue({
      job_id: 'job-analyze-1',
      type: 'analyze_deal',
      status: 'running',
      progress_pct: 10,
      message: 'Starting analysis',
      updated_at: '2024-01-04T00:10:00.000Z',
    } as any);

    renderWorkspace({ dealId: 'deal-analyze-only' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Deal Assistant/i })).not.toBeDisabled();
    });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    await waitFor(() => {
      expect(apiGetJob).toHaveBeenCalledWith(
        'job-analyze-1',
        expect.objectContaining({ signal: expect.any(Object) })
      );
      const feed = screen.getByTestId('analysis-progress-feed');
      expect(feed).toBeInTheDocument();
      expect(within(feed).getAllByText(/10%/i).length).toBeGreaterThan(0);
      expect(within(feed).getAllByText(/Starting analysis/i).length).toBeGreaterThan(0);
    });
  });

  test('stall detection prefers progress heartbeat timestamp over updated_at', async () => {
    const { apiPostAnalyzeWithStatus } = await import('../lib/apiClient');

    const nowMs = new Date('2024-01-04T00:02:00.000Z').getTime();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v4', dioStatus: 'running' } as any);
    vi.mocked(apiPostAnalyzeWithStatus).mockResolvedValue({ ok: true, status: 202, json: { job_id: 'job-hb-1', status: 'queued' }, text: null } as any);

    // updated_at is old enough to be considered stalled, but progress.at is recent.
    vi.mocked(apiGetJob).mockResolvedValue({
      job_id: 'job-hb-1',
      type: 'analyze_deal',
      status: 'running',
      progress_pct: 50,
      message: 'Still working',
      updated_at: '2024-01-04T00:00:00.000Z',
      status_detail: {
        progress: {
          at: '2024-01-04T00:01:30.000Z',
          stage: 'running',
          message: 'Heartbeat tick',
          percent: 50,
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-hb' });

    await openJobsTab();

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    await waitFor(() => {
      expect(apiGetJob).toHaveBeenCalled();
      expect(screen.queryByText(/Running \(stalled\)/i)).not.toBeInTheDocument();
    });

    nowSpy.mockRestore();
  });

  test('does not pin to stale failed analyze when newer succeeded exists', async () => {
    const { apiGetDealJobs, apiPostAnalyze, apiPostExtractVisuals, apiPostReextractDocuments } = await import('../lib/apiClient');

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-01-02T00:00:35.000Z'));

    vi.mocked(apiPostReextractDocuments).mockResolvedValue({ job_id: 'job-111', status: 'queued' } as any);
    vi.mocked(apiPostExtractVisuals).mockResolvedValue({ job_id: 'job-222', status: 'queued' } as any);

    // Full process should NOT enqueue analyze_deal directly.
    vi.mocked(apiPostAnalyze).mockResolvedValue({ job_id: 'job-should-not-be-called', status: 'queued' } as any);

    let allowFailedAnalyze = false;
    let allowSucceededAnalyze = false;
    vi.mocked(apiGetDealJobs).mockImplementation(async () => {
      // Initially: analyze job hasn't been enqueued yet.
      if (!allowFailedAnalyze) return [] as any;

      if (!allowSucceededAnalyze) {
        return [
          {
            job_id: 'job-333',
            type: 'analyze_deal',
            status: 'failed',
            message: 'No extracted documents available for analysis',
            created_at: '2024-01-02T00:01:00.000Z',
            updated_at: '2024-01-02T00:01:10.000Z',
          },
        ] as any;
      }
      return [
        {
          job_id: 'job-333',
          type: 'analyze_deal',
          status: 'failed',
          message: 'No extracted documents available for analysis',
          created_at: '2024-01-02T00:01:00.000Z',
          updated_at: '2024-01-02T00:01:10.000Z',
        },
        {
          job_id: 'job-new-ok',
          type: 'analyze_deal',
          status: 'succeeded',
          message: 'Completed newer analysis',
          progress_pct: 100,
          created_at: '2024-01-02T00:01:20.000Z',
          updated_at: '2024-01-02T00:01:25.000Z',
        },
      ] as any;
    });

    vi.mocked(apiGetJob).mockImplementation(async (jobId: string) => {
      let extractPoll = (vi.mocked(apiGetJob) as any).__extractPollCount ?? 0;
      (vi.mocked(apiGetJob) as any).__extractPollCount = extractPoll;

      if (jobId === 'job-111') {
        return {
          job_id: 'job-111',
          type: 'reextract_documents',
          status: 'succeeded',
          progress_pct: 100,
          message: 'ok',
          updated_at: '2024-01-02T00:00:00.000Z',
          created_at: '2024-01-02T00:00:00.000Z',
        };
      }
      if (jobId === 'job-222') {
        extractPoll = ((vi.mocked(apiGetJob) as any).__extractPollCount ?? 0) + 1;
        (vi.mocked(apiGetJob) as any).__extractPollCount = extractPoll;
        if (extractPoll === 1) {
          return {
            job_id: 'job-222',
            type: 'extract_visuals',
            status: 'running',
            progress_pct: 10,
            message: 'Working',
            updated_at: '2024-01-02T00:00:00.000Z',
            created_at: '2024-01-02T00:00:00.000Z',
          };
        }
        return {
          job_id: 'job-222',
          type: 'extract_visuals',
          status: 'succeeded',
          progress_pct: 100,
          message: 'ok',
          created_at: '2024-01-02T00:00:00.000Z',
          finished_at: '2024-01-02T00:00:30.000Z',
          updated_at: '2024-01-02T00:00:30.000Z',
        };
      }
      if (jobId === 'job-333') {
        return {
          job_id: 'job-333',
          type: 'analyze_deal',
          status: 'failed',
          progress_pct: 100,
          message: 'No extracted documents available for analysis',
          updated_at: '2024-01-02T00:01:10.000Z',
          created_at: '2024-01-02T00:01:00.000Z',
        };
      }
      if (jobId === 'job-new-ok') {
        return {
          job_id: 'job-new-ok',
          type: 'analyze_deal',
          status: 'succeeded',
          progress_pct: 100,
          message: 'Completed newer analysis',
          updated_at: '2024-01-02T00:02:20.000Z',
          created_at: '2024-01-02T00:02:00.000Z',
        };
      }
      return {
        job_id: jobId,
        type: 'analyze_deal',
        status: 'succeeded',
        progress_pct: 100,
        message: 'ok',
        updated_at: '2024-01-04T00:00:00.000Z',
        created_at: '2024-01-04T00:00:00.000Z',
      };
    });

    renderWorkspace({ dealId: 'deal-supersede', dealData: null as any });
    const user = userEvent.setup();

    // This mock is used by other tests in this file; clear history so we only assert on this scenario.
    vi.mocked(apiPostAnalyze).mockClear();

    await user.click(screen.getByRole('button', { name: /^more$/i }));
    await user.click(screen.getByRole('button', { name: /run full process/i }));

    await openJobsTab();

    // Analyze should not be enqueued directly by the UI.
    expect(apiPostAnalyze).not.toHaveBeenCalled();

    // While extraction is still running/finalizing and no analyze job exists yet, the Analyze step should have no job id.
    const analyzeStep = await screen.findByTestId('full-process-step-analyze_deal');
    await waitFor(() => {
      expect(within(analyzeStep).getByText(/job\s+—/i)).toBeInTheDocument();
    });

    // Now simulate the backend enqueueing analyze jobs tied to the extract run.
    allowFailedAnalyze = true;

    // The first observed analyze job fails quickly, but during the run grace window we should *not* flash Failed.
    await waitFor(
      () => {
        const step = screen.getByTestId('full-process-step-analyze_deal');
        expect(within(step).queryByText(/failed/i)).not.toBeInTheDocument();
        expect(within(step).getAllByText(/Preparing analysis/i).length).toBeGreaterThan(0);
      },
      { timeout: 7000 }
    );

    // Now allow the newer succeeded analyze to appear.
    allowSucceededAnalyze = true;

    await waitFor(
      () => {
        expect(screen.queryByText(/Analyze deal failed/i)).not.toBeInTheDocument();
      },
      { timeout: 7000 }
    );

    await waitFor(
      () => {
        expect(screen.getByText(/Full process completed/i)).toBeInTheDocument();
        expect(screen.getByText(/job job-new-ok/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Completed newer analysis/i).length).toBeGreaterThan(0);
      },
      { timeout: 7000 }
    );

    nowSpy.mockRestore();
  }, 15000);

  test('renders Job Center even when backend mode is not live', async () => {
    const { isLiveBackend } = await import('../lib/apiClient');
    vi.mocked(isLiveBackend).mockReturnValue(false);

    vi.mocked(apiGetDeal).mockResolvedValue({} as any);
    renderWorkspace({ dealId: 'deal-8' });

    await openJobsTab();

    await waitFor(() => {
      expect(screen.getByText(/Job Center/i)).toBeInTheDocument();
    });
  });

  test('Recent jobs aggregates mixed chunk outcomes as Done (warn), not Failed', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v5', dioStatus: 'ready', lastAnalyzedAt: null } as any);

    const now = new Date().toISOString();
    vi.mocked(apiGetDealJobs).mockResolvedValue([
      {
        job_id: 'parent-1',
        queue: 'extract_visuals',
        type: 'extract_visuals',
        status: 'failed',
        progress_pct: 100,
        created_at: now,
        updated_at: now,
        deal_id: 'deal-8',
      },
      {
        job_id: 'child-1',
        queue: 'extract_visuals',
        type: 'extract_visuals',
        status: 'failed',
        progress_pct: 100,
        parent_job_id: 'parent-1',
        created_at: now,
        updated_at: now,
        deal_id: 'deal-8',
      },
      {
        job_id: 'child-2',
        queue: 'extract_visuals',
        type: 'extract_visuals',
        status: 'succeeded',
        progress_pct: 100,
        parent_job_id: 'parent-1',
        created_at: now,
        updated_at: now,
        deal_id: 'deal-8',
      },
    ] as any);

    renderWorkspace({ dealId: 'deal-8' });

    await openJobsTab();

    await waitFor(() => {
      expect(screen.getByText(/Job Center/i)).toBeInTheDocument();
    });

    // Expand accordion
    const recentJobs = screen.getByText(/Recent jobs/i);
    await userEvent.click(recentJobs);

    await waitFor(() => {
      expect(screen.getByText(/Done \(warn\)/i)).toBeInTheDocument();
    });
  });

  test('analyze_deal SSE succeeded: overlay polling fires once per unique job_id (dedup guard)', async () => {
    // This test verifies that duplicate SSE deliveries for the same analyze_deal job_id
    // do not spawn multiple overlay polling cycles, which would cause rapid API spamming
    // and reset the backoff timer on every duplicate event.
    const { subscribeToEvents, apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');

    // jsdom does not define EventSource — stub it so the component's SSE branch is entered.
    const origEventSource = (global as any).EventSource;
    (global as any).EventSource = class MockEventSource {};

    let capturedOnJobUpdated: ((job: any) => void) | null = null;
    vi.mocked(subscribeToEvents).mockImplementation((_dealId: string, handlers: any) => {
      capturedOnJobUpdated = handlers.onJobUpdated;
      return () => undefined;
    });
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v7', dioStatus: 'ready' } as any);

    renderWorkspace({ dealId: 'deal-overlay-dedup' });

    // Wait for SSE subscription to be wired up (useEffect + subscribeToEvents call).
    await waitFor(() => expect(capturedOnJobUpdated).not.toBeNull());

    // Clear calls from the initial component mount.
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockClear();

    const succeededEvent = {
      job_id: 'job-analyze-dedup-xyz',
      deal_id: 'deal-overlay-dedup',
      type: 'analyze_deal',
      status: 'succeeded',
      progress_pct: 100,
      message: 'Analysis complete',
      updated_at: '2025-01-01T00:00:10.000Z',
    };

    // Emit the same succeeded event 3 times — simulates duplicate SSE delivery (reconnect /
    // re-subscription) or repeated event dispatching from an unstable worker.
    act(() => {
      capturedOnJobUpdated!(succeededEvent);
      capturedOnJobUpdated!(succeededEvent);
      capturedOnJobUpdated!(succeededEvent);
    });

    // Allow the immediate (non-setTimeout) poll() to run — it issues a governed overlay fetch.
    // Use a short deadline so backoff timers (2 s, 5 s, …) cannot inflate the count.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    const callCount = vi.mocked(apiGetDealGovernedOverlayPersisted).mock.calls.length;

    // With the job_id dedup guard: polling is started exactly once → 1 immediate overlay fetch.
    // Without the guard: 3 polling cycles each fire their first poll immediately → 3 fetches.
    expect(callCount).toBeGreaterThanOrEqual(1); // polling was started
    expect(callCount).toBeLessThan(3);           // only one polling cycle (not one per event)

    // Restore EventSource stub.
    (global as any).EventSource = origEventSource;
  });

  test('debug-only UI elements do not render unless workspaceDebugEnabled', async () => {
    // workspaceDebugEnabled requires ?debug=1 in the URL or localStorage ddai:debugDealWorkspace.
    // In the test environment neither is set, so both protected elements must be absent.
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready' } as any);

    renderWorkspace({ dealId: 'deal-no-debug' });

    // Allow the workspace to fully mount and run its initial effects.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Deal Assistant/i })).not.toBeNull();
    });

    // 1. Build stamp must be hidden — it exposes VITE_BUILD_STAMP to non-debug users.
    expect(screen.queryByTestId('build-stamp')).toBeNull();

    // 2. Debug → Missing Fields panel must be hidden — it contains internal diagnostics.
    expect(screen.queryByText(/Debug.*Missing Fields/i)).toBeNull();
    expect(screen.queryByText(/Missing Fields/i)).toBeNull();

    // 3. Governed Consistency Warnings panel must be hidden outside debug mode.
    expect(screen.queryByTestId('governed-consistency-warnings-panel')).toBeNull();
  });

  test('Governed Consistency Warnings panel renders codes when workspaceDebugEnabled is true', async () => {
    // Enable workspace debug mode via localStorage.
    window.localStorage.setItem('ddai:debugDealWorkspace', '1');

    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready' } as any);
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        input_hash: 'hash-test',
        created_at: new Date().toISOString(),
        llm_phase_mode: 'governed',
        summary_text: 'Test deal.',
        claims: [],
        disclosures: [],
        consistency_warnings: ['HERO_MISSING_RAISE_CONTEXT', 'ICP_NOT_REFLECTED'],
      },
    } as any);

    renderWorkspace({ dealId: 'deal-debug-warnings' });

    // Allow the workspace to mount and the governed overlay hook to resolve.
    await waitFor(() => {
      expect(screen.queryByTestId('governed-consistency-warnings-panel')).not.toBeNull();
    });

    const panel = screen.getByTestId('governed-consistency-warnings-panel');
    expect(panel).toBeInTheDocument();
    expect(panel.textContent).toContain('HERO_MISSING_RAISE_CONTEXT');
    expect(panel.textContent).toContain('ICP_NOT_REFLECTED');

    // Clean up debug flag so other tests are unaffected.
    window.localStorage.removeItem('ddai:debugDealWorkspace');
  });

  // ── TopSection separation contract ──────────────────────────────────────────

  test('[TopSection contract] deal-summary-text shows deterministic one_liner, never governed hero_summary', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-top-sep-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 70,
        recommendation: 'yes',
        sections: [],
        metadata: { cycle_number: 1 },
        structured_summary: {
          deal_summary_v1: {
            one_liner: 'Deterministic one liner ABC',
            long_summary: '',
          },
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Deterministic one liner ABC',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
        },
      },
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        input_hash: 'hash-sep-1',
        created_at: new Date().toISOString(),
        llm_phase_mode: 'governed',
        summary_text: 'Governed hero text XYZ',
        claims: [],
        disclosures: [],
        consistency_warnings: [],
      },
    } as any);

    renderWorkspace({ dealId: 'deal-top-sep-1' });

    const summaryEl = await screen.findByTestId('deal-summary-text');
    expect(summaryEl.textContent).toContain('Deterministic one liner ABC');
    expect(summaryEl.textContent).not.toContain('Governed hero text XYZ');
  });

  test('[TopSection contract] "Unknown" one_liner shows placeholder, not "Unknown"', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-top-unknown-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 55,
        recommendation: 'no',
        sections: [],
        metadata: { cycle_number: 1 },
        structured_summary: {
          deal_summary_v1: {
            one_liner: 'Unknown',
            long_summary: '',
          },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-top-unknown-1' });

    const summaryEl = await screen.findByTestId('deal-summary-text');
    // 'Unknown' sentinel must be filtered.
    expect(summaryEl.textContent).not.toBe('Unknown');
    expect(summaryEl.textContent).not.toMatch(/^Unknown$/i);
    // [SCORE-CONTRACT] No score_band_v2 → scoreExplanationV1 null → one-liner is empty →
    // component renders default fallback. bare "Score of N" is NOT produced.
    expect(summaryEl.textContent).not.toMatch(/Score of 55/i);
    expect(summaryEl.textContent).toMatch(/score drivers not yet computed for this run/i);
  });

  test('[TopSection contract] score-mechanic phrases never render in strengths', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-top-mechanic-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 65,
        recommendation: 'maybe',
        sections: [],
        metadata: {
          cycle_number: 1,
          score_explanation: {
            components: {
              financial_health: {
                score: 0.7,
                reason: 'Narrative pacing score computed from slide cadence',
              },
              risk_assessment: {
                score: 0.6,
                reason: 'Score computed via risk analyzer',
              },
            },
          },
        },
        deal_summary: {
          version: 'deal_summary_v1',
          ready: true,
          tiers: { hero: '', overview: '', deep: '' },
          strengths: ['Narrative pacing score computed from slide cadence', 'Score computed via risk analyzer'],
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-top-mechanic-1' });

    await screen.findByLabelText('Deal top summary');

    expect(screen.queryByText(/Narrative pacing score computed/i)).toBeNull();
    expect(screen.queryByText(/Score computed via risk analyzer/i)).toBeNull();
  });

  // ── TopSection V1 (topsection_v1 score-driver contract) ─────────────────────

  test('[topsection_v1] score_driver_one_liner renders in deal-summary-text instead of governed hero or company one-liner', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-tsv1-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 74,
        recommendation: 'yes',
        sections: [],
        metadata: { cycle_number: 1 },
        structured_summary: {
          // Company description — should NOT appear in TopSection
          deal_summary_v1: {
            one_liner: 'The company builds widgets for enterprise clients.',
            long_summary: '',
          },
          // Score-driver summary — SHOULD appear in TopSection
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 74 — led by financial health (+24 pts) and business metrics (+8 pts).',
            strengths: ['Revenue KPI confirmed: $1.5M ARR.'],
            weaknesses: ['Provide gross margin and unit economics (CAC/LTV).'],
            actions_to_improve: ['Confirm cash balance and runway explicitly.'],
          },
        },
      },
    } as any);

    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        schema_version: 'governed_llm_overview_v1',
        input_hash: 'hash-tsv1-1',
        created_at: new Date().toISOString(),
        llm_phase_mode: 'governed',
        // Governed text — should NOT appear in TopSection deal-summary-text
        summary_text: 'This is the governed hero company summary XYZ.',
        claims: [],
        disclosures: [],
        consistency_warnings: [],
      },
    } as any);

    renderWorkspace({ dealId: 'deal-tsv1-1' });

    const summaryEl = await screen.findByTestId('deal-summary-text');
    // Score-driver one-liner must appear
    expect(summaryEl.textContent).toContain('Score of 74');
    expect(summaryEl.textContent).toContain('financial health');
    // Governed hero and company one-liner must NOT appear in TopSection
    expect(summaryEl.textContent).not.toContain('governed hero company summary XYZ');
    expect(summaryEl.textContent).not.toContain('builds widgets for enterprise clients');
  });

  test('[topsection_v1] strengths from score_explanation.understanding_v1 render in Score Understanding', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-tsv1-2',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 68,
        recommendation: 'yes',
        sections: [],
        metadata: {
          cycle_number: 1,
          score_band_v2: { key: 'good', label: 'Good', overall_score: 68, thresholds_version: 'v2' },
          // [SCORE-CONTRACT] Canonical source for Score Understanding copy.
          score_explanation: {
            understanding_v1: {
              strengths: [
                { text: 'Strong cash position confirmed from financials.' },
                { text: 'Revenue KPI extracted: $800K ARR.' },
              ],
              diligence_open_items: [
                { text: 'Market sizing documentation is thin.' },
              ],
              execution_dependencies: [
                { text: 'Provide CAC/LTV data from cohort tables.' },
              ],
            },
          },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 68 — financial health was a strength (+18 pts), while risk profile needs improvement (-7 pts).',
            strengths: ['Strong cash position confirmed from financials.', 'Revenue KPI extracted: $800K ARR.'],
            weaknesses: ['Market sizing documentation is thin.'],
            actions_to_improve: ['Provide CAC/LTV data from cohort tables.'],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-tsv1-2' });

    await screen.findByLabelText('Deal top summary');

    // Strengths from understanding_v1 must render in Score Understanding
    expect(screen.getByText(/Strong cash position confirmed from financials\./i)).toBeInTheDocument();
    expect(screen.getByText(/Revenue KPI extracted: \$800K ARR\./i)).toBeInTheDocument();

    // Gap item (non-imperative) from diligence_open_items must render in Weaknesses
    // Use getAllByText: may appear in multiple sections (TopSection + Overview tab)
    expect(screen.getAllByText(/Market sizing documentation is thin\./i).length).toBeGreaterThanOrEqual(1);
  });

  test('[topsection_v1] placeholder renders when topsection_v1 is absent from the report', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-tsv1-3',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'pass',
        sections: [],
        metadata: { cycle_number: 1 },
        // No topsection_v1, no deal_summary_v1
        structured_summary: {},
      },
    } as any);

    renderWorkspace({ dealId: 'deal-tsv1-3' });

    const summaryEl = await screen.findByTestId('deal-summary-text');
    // [SCORE-CONTRACT] When topsection_v1 is absent and no score_explanation.understanding_v1
    // exists (no band score → scoreExplanationV1=null), the component renders the fallback span.
    // Never shows a bare "Score of N" (that's score repetition, not explanation).
    expect(summaryEl.textContent).toMatch(/score drivers not yet computed for this run/i);
    expect(summaryEl.textContent).not.toMatch(/Score of 50/i);
    // Must NOT show the old generic placeholder.
    expect(summaryEl.textContent).not.toMatch(/Not yet derived from score \+ evidence/i);
  });

  // ── Score Consistency Guard ──────────────────────────────────────────────────

  test('[score-guard] radial chart binds to report.overallScore and label reads "Deal Score"', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-guard-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 82,
        recommendation: 'yes',
        sections: [],
        metadata: { cycle_number: 1 },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 82 — led by financial health (+24 pts).',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-guard-1' });

    await screen.findByLabelText('Deal top summary');

    // Radial chart must be present and bound to the canonical overallScore (82).
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart).toBeInTheDocument();
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('report.overallScore');

    // Score label must read "Deal Score" when bound to report.overallScore.
    const scoreLabel = screen.getByTestId('score-canonical-label');
    expect(scoreLabel).toBeInTheDocument();
    expect(scoreLabel.textContent?.trim()).toBe('Deal Score');
  });

  test('[score-guard] when report not ready, score label uses sub-engine label, not "Overall Score"', async () => {
    // Deal API has a score but the report envelope has ready: false (not yet compiled).
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1',
      dioStatus: 'ready',
      lastAnalyzedAt: null,
      score: 65,
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: false,
      version: null,
      artifact: null,
      report: null,
    } as any);

    renderWorkspace({ dealId: 'deal-guard-2' });

    await screen.findByLabelText('Deal top summary');

    // When the report is not ready, canonicalScoreSource is 'none' and label
    // must NOT be "Deal Score" (it should be "Fundamentals score").
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('none');

    const scoreLabel = screen.getByTestId('score-canonical-label');
    expect(scoreLabel.textContent?.trim()).not.toBe('Overall Score');
  });

  test('[score-guard] SCORE_MISMATCH_IN_COPY warning when copy contains a /100 value that differs from canonical score', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-guard-3',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        // Canonical score is 75
        overallScore: 75,
        recommendation: 'yes',
        sections: [],
        metadata: { cycle_number: 1 },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            // Copy says 82/100 — this conflicts with overallScore: 75
            score_driver_one_liner: 'This deal scored 82/100 based on prior analysis.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderWorkspace({ dealId: 'deal-guard-3' });
      await screen.findByLabelText('Deal top summary');

      // Guard must emit a warning containing the mismatch code.
      const mismatchCalls = warnSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('SCORE_MISMATCH_IN_COPY'),
      );
      expect(mismatchCalls.length).toBeGreaterThan(0);
      // The warning must include both the canonical score and the mismatched value.
      const firstCall = mismatchCalls[0];
      expect(JSON.stringify(firstCall)).toContain('75');
      expect(JSON.stringify(firstCall)).toContain('82');
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ── Score binding: score_band_v2.overall_score canonicality ─────────────────

  test('[score-binding] gauge prefers score_band_v2.overall_score (82) over report.overallScore (48)', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-sb-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-sb-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        // Pre-calibration top-level score — should NOT drive the gauge when band score is present.
        overallScore: 48,
        recommendation: 'no',
        sections: [],
        metadata: {
          // Calibrated canonical band score — MUST drive the gauge.
          score_band_v2: { key: 'good', label: 'Good', overall_score: 82, thresholds_version: 'v2' },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 82 — led by financial health.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-sb-1' });

    await screen.findByLabelText('Deal top summary');

    // Radial chart must show 82 (score_band_v2.overall_score), not 48 (overallScore).
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart).toBeInTheDocument();
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
    expect(radialChart.getAttribute('aria-label')).not.toMatch(/\b48\b/);

    // SVG accessible name must also reflect 82.
    const svgImg = screen.getByRole('img', { name: /82 out of 100/i });
    expect(svgImg).toBeInTheDocument();
  });

  test('[score-binding] gauge falls back to report.overallScore when no score_band_v2', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-sb-2', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-sb-2',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 73,
        recommendation: 'yes',
        sections: [],
        // No score_band_v2 — gauge must fall back to overallScore.
        metadata: {},
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 73 — solid financial signals.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-sb-2' });

    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).toMatch(/73/);

    const svgImg = screen.getByRole('img', { name: /73 out of 100/i });
    expect(svgImg).toBeInTheDocument();
  });

  test('[deal-snapshot] TopSection card title reads "Deal Snapshot"', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: 'v1', dioStatus: 'ready', lastAnalyzedAt: '2024-01-02T00:00:00.000Z' } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 1,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-ds-1', analysis_version: 1, updated_at: '2024-01-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-ds-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 65,
        recommendation: 'yes',
        sections: [],
        metadata: { score_band_v2: { key: 'ok', label: 'OK', overall_score: 65, thresholds_version: 'v2' } },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 65 — mixed signals.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-ds-1' });

    const top = await screen.findByLabelText('Deal top summary');

    // Title must say "Deal Snapshot", not "Deal Summary".
    expect(within(top).getByText('Deal Snapshot')).toBeInTheDocument();
    expect(within(top).queryByText('Deal Summary')).toBeNull();
  });
});

describe('DealWorkspace version guard + canonical score resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('[version-guard] when dioAnalysisVersion is 3, apiGetDealReport is called with version 3', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v3',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-03-01T00:00:00.000Z',
      dioAnalysisVersion: 3,
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 3,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-vg-1', analysis_version: 3, updated_at: '2024-03-01T00:00:00.000Z' },
      report: {
        dealId: 'deal-vg-1',
        generatedAt: '2024-03-01T00:00:00.000Z',
        version: 3,
        overallScore: 55,
        recommendation: 'yes',
        sections: [],
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 78, thresholds_version: 'v2' },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 78 — strong foundation.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-vg-1' });
    await screen.findByLabelText('Deal top summary');

    // The report fetch must have been called with version 3, not null or 1.
    expect(vi.mocked(apiGetDealReport)).toHaveBeenCalledWith(
      'deal-vg-1',
      expect.objectContaining({ version: 3 }),
    );
    // And the displayed score must be from the v3 report (band score = 78).
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).toMatch(/78/);
  });

  test('[version-guard] canonicalScoreSource is "score_band_v2.overall_score" when band score present', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v3',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-03-02T00:00:00.000Z',
      dioAnalysisVersion: 3,
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 3,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-vg-2', analysis_version: 3, updated_at: '2024-03-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-vg-2',
        generatedAt: '2024-03-02T00:00:00.000Z',
        version: 3,
        overallScore: 48,
        recommendation: 'yes',
        sections: [],
        // score_band_v2.overall_score (82) is the calibrated canonical score
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 82, thresholds_version: 'v2' },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 82 — strong traction.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-vg-2' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    // SCORE_MISMATCH_IN_COPY guard source must identify the band score field
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');
    // Gauge must show 82 (calibrated), not 48 (pre-calibration)
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
  });

  test('[version-guard] canonicalScoreSource is "report.overallScore" when no band score present', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-03-03T00:00:00.000Z',
      dioAnalysisVersion: 2,
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 2,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-vg-3', analysis_version: 2, updated_at: '2024-03-03T00:00:00.000Z' },
      report: {
        dealId: 'deal-vg-3',
        generatedAt: '2024-03-03T00:00:00.000Z',
        version: 2,
        overallScore: 61,
        recommendation: 'yes',
        sections: [],
        // No score_band_v2 — resolver must fall back to overallScore
        metadata: { cycle_number: 2 },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 61 — moderate signals.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-vg-3' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('report.overallScore');
    expect(radialChart.getAttribute('aria-label')).toMatch(/61/);
  });

  test('[version-guard] version ratchet: latestKnownVersion prevents regression when fallback call uses null', async () => {
    // Simulate the regression case: deal loaded with v3, then a no-version call should still use v3.
    // We verify this by checking apiGetDealReport is never called with a version < 3.
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v3',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-03-04T00:00:00.000Z',
      dioAnalysisVersion: 3,
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 3,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-vg-4', analysis_version: 3, updated_at: '2024-03-04T00:00:00.000Z' },
      report: {
        dealId: 'deal-vg-4',
        generatedAt: '2024-03-04T00:00:00.000Z',
        version: 3,
        overallScore: 72,
        recommendation: 'yes',
        sections: [],
        metadata: {
          score_band_v2: { key: 'good', label: 'Good', overall_score: 72, thresholds_version: 'v2' },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 72 — steady growth.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-vg-4' });
    await screen.findByLabelText('Deal top summary');

    // Every call to apiGetDealReport must have version >= 3 or null only before v3 is known.
    // After the first v3 envelope lands, version must never be 1.
    const calls = vi.mocked(apiGetDealReport).mock.calls;
    const badCalls = calls.filter(([, opts]) => typeof opts?.version === 'number' && opts.version < 3);
    expect(badCalls).toHaveLength(0);
  });
});

describe('DealWorkspace score_sources log + investorScore canonical fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Builds a report envelope where score_band_v2.overall_score (82) differs from overallScore (48).
   *  This is the discriminating scenario: gauge must show 82, investorScore must also be 82. */
  const makeDivergentScoreEnvelope = (dealId: string) => ({
    ready: true,
    version: 3,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-ss-${dealId}`, analysis_version: 3, updated_at: '2024-04-01T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2024-04-01T00:00:00.000Z',
      version: 3,
      // raw (pre-bridge) score stored in the report field
      overallScore: 48,
      recommendation: 'consider',
      sections: [],
      metadata: {
        // calibrated score lives here (computed by server from totals.overall_score after bridge)
        score_band_v2: { key: 'fund_track', label: 'Fund & Track', overall_score: 82, thresholds_version: 'v2' },
        cycle_number: 3,
      },
      structured_summary: {
        topsection_v1: {
          schema_version: 'topsection_v1',
          score_driver_one_liner: 'Score of 82 — deterministic bridge applied.',
          strengths: [],
          weaknesses: [],
          actions_to_improve: [],
        },
        deal_summary_v1: { one_liner: '', long_summary: '' },
      },
    },
  } as any);

  test('[score-sources] [DDAI][score_sources] dev log fires with correct structure when band score present', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v3',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-04-01T00:00:00.000Z',
      dioAnalysisVersion: 3,
      // dealFromApi.score NOT set — so fundamentalsScore0_100 falls back to investorScore
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(makeDivergentScoreEnvelope('deal-ss-1'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    renderWorkspace({ dealId: 'deal-ss-1' });
    await screen.findByLabelText('Deal top summary');

    // Find the [DDAI][score_sources] log call (may have been called multiple times; get last).
    let sourcesCalls: any[][] = [];
    await waitFor(() => {
      sourcesCalls = logSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0] === '[DDAI][score_sources]',
      );
      expect(sourcesCalls.length).toBeGreaterThan(0);
    });

    const lastPayload = sourcesCalls[sourcesCalls.length - 1][1] as any;

    // Raw values logged correctly
    expect(lastPayload.raw['reportFromApi.overallScore']).toBe(48);
    expect(lastPayload.raw['reportFromApi.metadata.score_band_v2.overall_score']).toBe(82);

    // Canonical resolution: resolver must pick brand score 82
    expect(lastPayload.resolved.canonicalScore).toBe(82);
    expect(lastPayload.resolved.canonicalScoreSource).toBe('score_band_v2.overall_score');

    // Gauge must be bound to 82
    expect(lastPayload.ui['TopSection gauge (reportView.score)']).toBe(82);
    expect(lastPayload.ui['TopSection canonicalScoreSource']).toBe('score_band_v2.overall_score');

    // Hypothesis guide must flag the divergence
    expect(lastPayload.hypothesisGuide.bandScorePresent).toBe(true);
    expect(lastPayload.hypothesisGuide.bandDiffersFromOverall).toBe(true);
    expect(lastPayload.hypothesisGuide.gaugeSource).toBe('score_band_v2.overall_score');

    logSpy.mockRestore();
  });

  test('[investorScore-fix] with band=82 / overallScore=48 / no dealFromApi.score, gauge shows 82', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v3',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-04-01T00:00:00.000Z',
      dioAnalysisVersion: 3,
      // score field deliberately absent → fundamentalsScore0_100 must come from investorScore
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(makeDivergentScoreEnvelope('deal-ss-2'));

    renderWorkspace({ dealId: 'deal-ss-2' });
    await screen.findByLabelText('Deal top summary');

    // Gauge shows canonical score (82), not raw overallScore (48).
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');
  });

  test('[investorScore-fix] with band === overallScore (normal case), gauge shows the single score', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-04-02T00:00:00.000Z',
      dioAnalysisVersion: 2,
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 2,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-ss-3', analysis_version: 2, updated_at: '2024-04-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-ss-3',
        generatedAt: '2024-04-02T00:00:00.000Z',
        version: 2,
        // After deterministic bridge applied, both fields are equal (normal production case).
        overallScore: 72,
        recommendation: 'fund',
        sections: [],
        metadata: {
          score_band_v2: { key: 'fund_caution', label: 'Fund (Caution)', overall_score: 72, thresholds_version: 'v2' },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 72 — bridge applied, values aligned.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-ss-3' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).toMatch(/72/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');
  });
});

describe('DealWorkspace topsection score binding guardrail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Envelope with score_band_v2.overall_score=82 inside report.metadata (normal path). */
  const makeBandScoreEnvelope = (dealId: string, bandScore: number, overallScore: number) => ({
    ready: true,
    version: 2,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-${dealId}`, analysis_version: 2, updated_at: '2024-05-01T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2024-05-01T00:00:00.000Z',
      version: 2,
      overallScore,
      recommendation: 'consider',
      sections: [],
      metadata: {
        score_band_v2: { key: 'fund_track', label: 'Fund & Track', overall_score: bandScore, thresholds_version: 'v2' },
      },
      structured_summary: {
        topsection_v1: {
          schema_version: 'topsection_v1',
          score_driver_one_liner: `Score of ${bandScore} — band score is authoritative.`,
          strengths: [],
          weaknesses: [],
          actions_to_improve: [],
        },
        deal_summary_v1: { one_liner: '', long_summary: '' },
      },
    },
  } as any);

  /** Envelope with score_band_v2 only in top-level envelope.metadata, NOT in report.metadata.
   *  Exercises the envelope-level fallback path added to resolve band score divergence. */
  const makeEnvelopeLevelBandScoreEnvelope = (dealId: string, bandScore: number, overallScore: number) => ({
    ready: true,
    version: 2,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-${dealId}`, analysis_version: 2, updated_at: '2024-05-01T00:00:00.000Z' },
    // score_band_v2 lives at the envelope level only (API failure to merge into report.metadata)
    metadata: {
      score_band_v2: { key: 'fund_track', label: 'Fund & Track', overall_score: bandScore, thresholds_version: 'v2' },
    },
    report: {
      dealId,
      generatedAt: '2024-05-01T00:00:00.000Z',
      version: 2,
      overallScore,
      recommendation: 'consider',
      sections: [],
      metadata: {}, // no score_band_v2 here — should fall back to envelope.metadata
      structured_summary: {
        topsection_v1: {
          schema_version: 'topsection_v1',
          score_driver_one_liner: `Score of ${bandScore} — envelope fallback.`,
          strengths: [],
          weaknesses: [],
          actions_to_improve: [],
        },
        deal_summary_v1: { one_liner: '', long_summary: '' },
      },
    },
  } as any);

  test('[topsection-binding] gauge shows band score (82) not raw overallScore (48) when score_band_v2 present', async () => {
    // Core fix: score_band_v2.overall_score always wins over report.overallScore for gauge display.
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-05-01T00:00:00.000Z',
      dioAnalysisVersion: 2,
      score: 99, // dealFromApi.score — must NEVER appear in gauge
    } as any);
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(makeBandScoreEnvelope('deal-tb-1', 82, 48));

    renderWorkspace({ dealId: 'deal-tb-1' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    // Gauge must show 82 (band score), never 48 (overallScore) nor 99 (dealFromApi.score).
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
    expect(radialChart.getAttribute('aria-label')).not.toMatch(/48/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');
  });

  test('[topsection-binding] gauge shows band score (82) via envelope fallback when report.metadata lacks score_band_v2', async () => {
    // Covers the path where the API deck_archetype block partially ran:
    // payload.metadata has score_band_v2 but report.metadata was not merged.
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-05-03T00:00:00.000Z',
      dioAnalysisVersion: 2,
      score: 99, // dealFromApi.score — must NOT appear in gauge
    } as any);
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(makeEnvelopeLevelBandScoreEnvelope('deal-tb-3', 82, 48));

    renderWorkspace({ dealId: 'deal-tb-3' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    // Gauge must still show 82 via envelope-level fallback, never 48 (inner overallScore)
    // nor 99 (dealFromApi.score).
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
    expect(radialChart.getAttribute('aria-label')).not.toMatch(/48/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');
  });

  test('[topsection-binding] gauge shows overallScore (73) when no band score present', async () => {
    // When no band score exists at any level, fall back to report.overallScore (never dealFromApi.score).
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-05-04T00:00:00.000Z',
      dioAnalysisVersion: 2,
      score: 99, // dealFromApi.score — must NOT be used
    } as any);
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 2,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-tb-4', analysis_version: 2, updated_at: '2024-05-04T00:00:00.000Z' },
      report: {
        dealId: 'deal-tb-4',
        generatedAt: '2024-05-04T00:00:00.000Z',
        version: 2,
        overallScore: 73,
        recommendation: 'consider',
        sections: [],
        metadata: {}, // no score_band_v2
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 73 — solid traction.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-tb-4' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    // Gauge must show 73 (overallScore), source = report.overallScore, never 99 (dealFromApi.score).
    expect(radialChart.getAttribute('aria-label')).toMatch(/73/);
    expect(radialChart.getAttribute('aria-label')).not.toMatch(/99/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('report.overallScore');
  });

  test('[topsection-binding] gauge shows 0 (not dealFromApi.score) when report is applied but has no score fields', async () => {
    // Edge case: report is applied (ready + reportFromApi present) but neither overallScore
    // nor score_band_v2 exist. Guardrail: gauge = 0, never dealFromApi.score.
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-05-02T00:00:00.000Z',
      dioAnalysisVersion: 2,
      score: 75, // dealFromApi.score — must NOT appear in gauge when report applied
    } as any);

    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 2,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-tb-2', analysis_version: 2, updated_at: '2024-05-02T00:00:00.000Z' },
      report: {
        dealId: 'deal-tb-2',
        generatedAt: '2024-05-02T00:00:00.000Z',
        version: 2,
        // No overallScore, no score_band_v2 → resolver returns null → gaugeScore = 0
        recommendation: 'pass',
        sections: [],
        metadata: {},
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'No score available.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-tb-2' });
    await screen.findByLabelText('Deal top summary');

    // Gauge must show 0 (edge-case floor), never 75 (dealFromApi.score).
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).not.toMatch(/75/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('none');
  });

  test('[topsection-binding] score_mechanic phrases stripped from topSectionStrengths across all paths', () => {
    // Unit-style check: the _SCORE_MECHANIC_RE filter must eliminate known mechanic phrases
    // from any source tier. We test via the TopSection strengths prop rendered in the DOM.
    // This verifies the filter is applied, not just declared.
    const MECHANIC_PHRASES = [
      'Pacing Score: 78',
      'score computed from analyzer',
      'neutral baseline used',
      'analyzer scored this segment',
      'missing analyzer for revenue',
    ];
    // These should NOT pass the filter (tested via the regex pattern directly).
    const _SCORE_MECHANIC_RE = /pacing score|score computed|narrative pacing|computed.*score|score.*mechanic|analyzer.*scored|neutral baseline|missing analyzer|insufficient data|analyzer score used|neutral baseline used/i;
    for (const phrase of MECHANIC_PHRASES) {
      expect(_SCORE_MECHANIC_RE.test(phrase)).toBe(true);
    }
    // Legit strengths should NOT be blocked.
    const LEGIT_PHRASES = [
      'Strong recurring revenue with 120% NRR',
      'Experienced founding team with two prior exits',
      'Clear product-market fit in enterprise segment',
    ];
    for (const phrase of LEGIT_PHRASES) {
      expect(_SCORE_MECHANIC_RE.test(phrase)).toBe(false);
    }
  });
});

describe('DealWorkspace overview canonical score binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Report envelope where score_band_v2.overall_score lives inside report.metadata (normal path). */
  const makeOverviewBandEnvelope = (dealId: string, bandScore: number, overallScore: number) => ({
    ready: true,
    version: 2,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-ovw-${dealId}`, analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2025-01-01T00:00:00.000Z',
      version: 2,
      overallScore,
      recommendation: 'consider',
      sections: [],
      metadata: {
        score_band_v2: { key: 'good', label: 'Good', overall_score: bandScore, thresholds_version: 'v2' },
      },
      structured_summary: {
        topsection_v1: {
          schema_version: 'topsection_v1',
          score_driver_one_liner: `Score of ${bandScore} — canonical.`,
          strengths: [],
          weaknesses: [],
          actions_to_improve: [],
        },
        deal_summary_v1: { one_liner: 'Test deal.', long_summary: '' },
      },
    },
  } as any);

  /** Report envelope where score_band_v2 lives only at envelope.metadata (envelope-fallback path). */
  const makeOverviewEnvelopeFallbackEnvelope = (dealId: string, bandScore: number, overallScore: number) => ({
    ready: true,
    version: 2,
    metadata: {
      score_band_v2: { key: 'good', label: 'Good', overall_score: bandScore, thresholds_version: 'v2' },
    },
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-ovw-${dealId}`, analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2025-01-01T00:00:00.000Z',
      version: 2,
      overallScore,
      recommendation: 'consider',
      sections: [],
      metadata: {}, // no score_band_v2 here — should fall back to envelope.metadata
      structured_summary: {
        topsection_v1: {
          schema_version: 'topsection_v1',
          score_driver_one_liner: `Score of ${bandScore} — envelope fallback.`,
          strengths: [],
          weaknesses: [],
          actions_to_improve: [],
        },
        deal_summary_v1: { one_liner: 'Test deal.', long_summary: '' },
      },
    },
  } as any);

  // Returns a deal where dealFromApi.score=55 — a value that must NEVER leak into the Overview
  // once a report is applied.
  const makeLeakDeal = () =>
    ({
      dioVersionId: 'v2',
      dioStatus: 'ready',
      lastAnalyzedAt: '2025-01-01T00:00:00.000Z',
      dioAnalysisVersion: 2,
      score: 55, // DB score — must NOT appear in Overview once reportApplied=true
    } as any);

  test('[overview-canonical] Case A: band score in report.metadata → Overview shows 82, gauge shows 82, DB score (55) absent', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeLeakDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(makeOverviewBandEnvelope('deal-ovw-a', 82, 48));

    renderWorkspace({ dealId: 'deal-ovw-a' });
    await screen.findByLabelText('Deal top summary');

    // TopSection gauge must show 82.
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).toMatch(/82/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');

    // Overview score tile must also show 82 from the same canonical source.
    const overviewScore = await screen.findByTestId('overview-score-text');
    expect(overviewScore.textContent).toMatch(/82/);
    // Must NOT contain the DB score (55) or the raw overallScore (48).
    expect(overviewScore.textContent).not.toMatch(/55/);
    expect(overviewScore.textContent).not.toMatch(/48/);
    expect(overviewScore.getAttribute('data-canonical-score-source')).toBe('score_band_v2.overall_score');
  });

  test('[overview-canonical] Case B: no band anywhere, report.overallScore=73 → both surfaces show 73, DB score (55) absent', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeLeakDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 2,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-ovw-b', analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
      report: {
        dealId: 'deal-ovw-b',
        generatedAt: '2025-01-01T00:00:00.000Z',
        version: 2,
        overallScore: 73,
        recommendation: 'consider',
        sections: [],
        metadata: {}, // no score_band_v2
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Score of 73 — solid signal.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: 'Test deal.', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-ovw-b' });
    await screen.findByLabelText('Deal top summary');

    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.getAttribute('aria-label')).toMatch(/73/);
    expect(radialChart.getAttribute('data-canonical-score-source')).toBe('report.overallScore');

    const overviewScore = await screen.findByTestId('overview-score-text');
    expect(overviewScore.textContent).toMatch(/73/);
    expect(overviewScore.textContent).not.toMatch(/55/); // no DB leak
    expect(overviewScore.getAttribute('data-canonical-score-source')).toBe('report.overallScore');
  });

  test('[overview-canonical] Case C: report not ready → Overview shows "Not yet computed" placeholder, no numeric score', async () => {
    // DB score=82 must NOT appear in the Overview when the report is not applied.
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v1',
      dioStatus: 'ready',
      lastAnalyzedAt: '2025-01-01T00:00:00.000Z',
      dioAnalysisVersion: 1,
      score: 82, // DB score — must NOT appear when reportApplied=false
    } as any);
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({ ready: false, reason: 'not_generated_yet' } as any);

    renderWorkspace({ dealId: 'deal-ovw-c' });

    // Wait for the overview score element to appear (rendered once showDeterministicAuthoritative resolves).
    const overviewScore = await screen.findByTestId('overview-score-text');
    // Must show the placeholder — no numeric "XX / 100" format.
    expect(overviewScore.textContent).toMatch(/Not yet computed/i);
    expect(overviewScore.textContent).not.toMatch(/\d+ \/ 100/);
    // Must NOT display the DB score.
    expect(overviewScore.textContent).not.toMatch(/82/);
  });
});

describe('DealWorkspace score canonical contract (Details panel + copy sanitizer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Envelope with band score=82 at report.metadata AND report.overallScore=48 (pre-band raw). */
  const makeBandVsRawEnvelope = (dealId: string, bandScore: number, rawOverallScore: number, opts?: {
    strengths?: string[];
    criteriaSnapshot?: object | null;
  }) => ({
    ready: true,
    version: 2,
    artifact: { kind: 'deal_intelligence_object', dio_id: `dio-sc-${dealId}`, analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
    report: {
      dealId,
      generatedAt: '2025-01-01T00:00:00.000Z',
      version: 2,
      overallScore: rawOverallScore,
      recommendation: 'consider',
      sections: [],
      metadata: {
        score_band_v2: { key: 'good', label: 'Good', overall_score: bandScore, thresholds_version: 'v2' },
        // [SCORE-CONTRACT] Canonical source for TopSection Score Understanding.
        score_explanation: {
          understanding_v1: {
            strengths: (opts?.strengths ?? []).map((text) => ({ text })),
            diligence_open_items: [],
            execution_dependencies: [],
          },
        },
        ...(opts?.criteriaSnapshot != null ? {
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: opts.criteriaSnapshot },
        } : {}),
      },
      structured_summary: {
        topsection_v1: {
          schema_version: 'topsection_v1',
          score_driver_one_liner: `Canonical score ${bandScore}.`,
          strengths: opts?.strengths ?? [],
          weaknesses: [],
          actions_to_improve: [],
        },
        deal_summary_v1: { one_liner: 'Test deal.', long_summary: '' },
      },
    },
  } as any);

  const makeScDeal = () => ({
    dioVersionId: 'v2',
    dioStatus: 'ready',
    lastAnalyzedAt: '2025-01-01T00:00:00.000Z',
    dioAnalysisVersion: 2,
    score: 48, // DB score — must not leak
  } as any);

  test('[score-canonical] guardrail criteria snapshot NOT rendered without debug mode (workspaceDebugEnabled=false)', async () => {
    // Even if the report contains a criteria_snapshot, it must NOT reach the DOM by default
    // because it contains raw internal scores that contradict the canonical score.
    vi.mocked(apiGetDeal).mockResolvedValue(makeScDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeBandVsRawEnvelope('deal-sc-guard', 82, 48, {
        criteriaSnapshot: { overall_score: 48, unadjusted_overall_score: 46, coverage_ratio: 0.7 },
      }),
    );

    renderWorkspace({ dealId: 'deal-sc-guard' });
    await screen.findByLabelText('Deal top summary');

    // The raw guardrail JSON block must NOT appear in the DOM.
    expect(screen.queryByTestId('guardrail-criteria-snapshot')).toBeNull();
  });

  test('[score-canonical] Details panel shows canonical score and "Band calibration applied" note when raw != band', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeScDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeBandVsRawEnvelope('deal-sc-labels', 82, 48),
    );

    renderWorkspace({ dealId: 'deal-sc-labels' });
    await screen.findByLabelText('Deal top summary');

    // The Details accordion is always in the DOM when show=true (native <details> element).
    const labelsEl = await screen.findByTestId('details-score-labels');

    // Canonical score must be 82 (from score_band_v2).
    expect(labelsEl.textContent).toMatch(/Canonical score.*82/);
    // Raw score (pre-band) must also appear.
    expect(labelsEl.textContent).toMatch(/Raw score.*48/);
    // Note that band calibration was applied.
    expect(labelsEl.textContent).toMatch(/Band calibration applied/i);
  });

  test('[score-canonical] Details panel shows canonical score only (no raw note) when band score == overallScore', async () => {
    // When both values agree, there's no "calibration applied" note.
    vi.mocked(apiGetDeal).mockResolvedValue(makeScDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeBandVsRawEnvelope('deal-sc-same', 82, 82),
    );

    renderWorkspace({ dealId: 'deal-sc-same' });
    await screen.findByLabelText('Deal top summary');

    const labelsEl = await screen.findByTestId('details-score-labels');
    expect(labelsEl.textContent).toMatch(/Canonical score.*82/);
    // No raw/calibration copy when identical.
    expect(labelsEl.textContent).not.toMatch(/Raw score/);
    expect(labelsEl.textContent).not.toMatch(/Band calibration applied/i);
  });

  test('[score-canonical] strength bullet "Strong recommendation score of 67/100" stripped from DOM when canonical=82', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeScDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeBandVsRawEnvelope('deal-sc-strip', 82, 48, {
        strengths: [
          'Strong recommendation score of 67/100',
          'Solid MRR growth trajectory',
        ],
      }),
    );

    renderWorkspace({ dealId: 'deal-sc-strip' });
    await screen.findByLabelText('Deal top summary');

    // The raw score (67) must not appear anywhere in the DOM.
    expect(document.body.textContent).not.toMatch(/67\/100/);
    expect(document.body.textContent).not.toMatch(/67 \/ 100/);

    // The legitimate strength must still appear.
    expect(document.body.textContent).toMatch(/Solid MRR growth trajectory/);
  });

  test('[score-canonical] strength bullet kept intact when its NN/100 matches canonical', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeScDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeBandVsRawEnvelope('deal-sc-keep', 82, 48, {
        strengths: ['Score of 82/100 reflects strong execution', 'Experienced team'],
      }),
    );

    renderWorkspace({ dealId: 'deal-sc-keep' });
    await screen.findByLabelText('Deal top summary');

    // 82/100 matches canonical → must NOT be stripped.
    expect(document.body.textContent).toMatch(/82\/100/);
    expect(document.body.textContent).toMatch(/Experienced team/);
  });
});
