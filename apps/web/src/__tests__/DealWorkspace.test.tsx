import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';
import { apiGetDeal, apiGetDealJobs, apiGetJob } from '../lib/apiClient';

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

  const renderWorkspace = (overrides?: Partial<React.ComponentProps<typeof DealWorkspace>>) => {
    return render(
      <ScoreSourceProvider>
        <DealWorkspace
          darkMode={false}
          dealId="deal-1"
          dealData={baseDeal}
          {...overrides}
        />
      </ScoreSourceProvider>
    );
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
        structured_summary: {
          raise: { value: '$2M Seed', confidence: 0.9, sources: [] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [] },
          revenue: { value: { raw: '$1.2M', currency: 'USD', period: 'ARR', amount: null }, confidence: 0.8, sources: [] },
          customers: { value: { count: 450, kind: 'customers', raw: null }, confidence: 0.7, sources: [] },
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

    await waitFor(() => {
      expect(screen.getAllByText(exec).length).toBeGreaterThan(0);
    });

    const top = screen.getByLabelText('Deal top summary');
    expect(within(top).getByRole('heading', { name: 'Executive Summary' })).toBeInTheDocument();

    // Gauge uses /report overallScore.
    expect(screen.getByRole('img', { name: /50 out of 100/i })).toBeInTheDocument();

    // Score band badge should render in the top section.
    expect(within(top).getAllByText(/Consider \(Caution\)/i).length).toBeGreaterThan(0);

    // Top summary uses executive-summary section content when canonical deal_summary_v1 is not ready.
    expect(within(top).getAllByText(exec).length).toBeGreaterThan(0);

    // Stage badge prefers report metadata context.stage.
    expect(screen.getByText(/Stage:\s*In diligence/i)).toBeInTheDocument();

    // One tile reflects report context as well.
    const dealTypeLabel = screen.getByText(/^Deal Type$/i);
    const dealTypeCard = dealTypeLabel.parentElement;
    expect(dealTypeCard).not.toBeNull();
    expect(within(dealTypeCard as HTMLElement).getByText(/Primary equity/i)).toBeInTheDocument();

    const raiseLabel = screen.getByText(/^Raise$/i);
    const raiseCard = raiseLabel.parentElement;
    expect(raiseCard).not.toBeNull();
    expect(within(raiseCard as HTMLElement).getByText(/\$2M Seed/i)).toBeInTheDocument();

    const revenueLabel = screen.getByText(/^Revenue$/i);
    const revenueCard = revenueLabel.parentElement;
    expect(revenueCard).not.toBeNull();
    expect(within(revenueCard as HTMLElement).getByText(/\$1\.2M/i)).toBeInTheDocument();

    const customersLabel = screen.getByText(/^Customers$/i);
    const customersCard = customersLabel.parentElement;
    expect(customersCard).not.toBeNull();
    expect(within(customersCard as HTMLElement).getByText(/450 customers/i)).toBeInTheDocument();

    // Overview tab should also prefer /report bindings (not stale dealFromApi fields).
    await userEvent.click(screen.getByRole('tab', { name: /^overview$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Raise\s*\/\s*Terms/i)).toBeInTheDocument();
    });

    const overviewRaiseLabel = screen.getByText(/Raise\s*\/\s*Terms/i);
    const overviewRaiseRow = overviewRaiseLabel.closest('div');
    expect(overviewRaiseRow).not.toBeNull();
    expect(within(overviewRaiseRow as HTMLElement).getByText(/\$2M Seed/i)).toBeInTheDocument();

    const overviewBusinessModelLabel = screen.getByText(/Business Model:\s*/i);
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
          revenue: { value: { raw: '$2.476M' }, sources: [] },
        },
        metadata: {
          score_explanation: {
            understanding_v1: {
              strengths: [{ text: 'Evidence-backed product definition' }],
              diligence_open_items: [
                { text: 'Confirm gross margin by channel (DTC vs wholesale).' },
                { text: 'Validate inventory/working capital needs by season.' },
                { text: 'Validate CAC and unit economics at scale.' },
                { text: 'Confirm multi-year financial tables and accounting basis.' },
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

    render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-rpt-understanding-1" dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

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
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          score_band_v2: { key: 'consider_caution', label: 'Consider (Caution)', overall_score: 50, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: null },
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-rpt-kpi-labels-1" dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

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
          revenue: {
            value: { raw: '$800k' },
            label: 'Annual',
            sources: [{ document_id: 'doc-1', page_index: 7, note_snippet: 'Email attributed revenue', meta: { scope: 'channel_attributed', year: 2024, period: 'annual' } }],
          },
          growth: { value: { raw: '—' }, sources: [] },
          customers: { value: { raw: '—' }, sources: [] },
        },
        metadata: {
          score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } },
          score_band_v2: { key: 'consider_caution', label: 'Consider (Caution)', overall_score: 50, thresholds_version: 'v2' },
          hard_pass_guardrail_v2: { triggered: false, reason: null, note: null, criteria_snapshot: null },
          decision_v1: { recommendation_key: 'consider', label: 'Consider (Caution)', severity: 'warn', reasons: ['band:consider_caution'] },
        },
      },
    } as any);

    render(
      <ScoreSourceProvider>
        <DealWorkspace darkMode={false} dealId="deal-rpt-kpi-labels-2" dealData={baseDeal} />
      </ScoreSourceProvider>,
    );

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
        structured_summary: {
          raise: { value: '$2M Seed', confidence: 0.9, sources: [] },
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [] },
          revenue: { value: { raw: '$1.2M', currency: 'USD', period: 'ARR', amount: null }, confidence: 0.8, sources: [] },
          customers: { value: { count: 450, kind: 'customers', raw: null }, confidence: 0.7, sources: [] },
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

  test('Business Model tile prefers synthesized business_model_summary when report.ready=true (shows Synthesized badge)', async () => {
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
          business_model: { value: 'Usage-based SaaS (promoted)', confidence: 0.9, sources: [] },
        },
        metadata: { score_explanation: { context: { stage: 'in_diligence', deal_type: 'Primary equity' } } },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-bm-synth-1' });

    const top = await screen.findByLabelText('Deal top summary');
    const businessModelLabel = within(top).getByText(/^Business Model$/i);
    const businessModelCard = businessModelLabel.parentElement;
    expect(businessModelCard).not.toBeNull();
    expect(within(businessModelCard as HTMLElement).getByText(/DTC \+ wholesale apparel/i)).toBeInTheDocument();
    expect(within(businessModelCard as HTMLElement).getByText(/^Synthesized$/i)).toBeInTheDocument();
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
          business_model: { value: 'Usage-based SaaS', confidence: 0.9, sources: [] },
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
      },
    } as any);

    renderWorkspace({ dealId: 'deal-can-1' });

    await waitFor(() => {
      expect(screen.getAllByText(/CANON HERO/i).length).toBeGreaterThan(0);
    });

    const top = screen.getByLabelText('Deal top summary');
    expect(within(top).getByRole('heading', { name: 'Deal Summary' })).toBeInTheDocument();
    expect(within(top).getByText(/CANON HERO \(top\)/i)).toBeInTheDocument();
    expect(within(top).queryByText(/LEGACY EXEC SUMMARY/i)).toBeNull();

    expect(screen.getAllByText('Canonical').length).toBeGreaterThan(0);
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

    // Deep tier appears only after expanding.
    await userEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getByText(/CANON DEEP PARA 1/i)).toBeInTheDocument();
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

  test('Top summary does not render literal \\n\\n sequences from executive summary content', async () => {
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
        dealId: 'deal-rpt-newlines-1',
        generatedAt: '2024-01-02T00:00:00.000Z',
        version: 1,
        overallScore: 50,
        recommendation: 'no',
        sections: [{ id: 'executive-summary', title: 'Executive Summary', content: exec, evidence_ids: [] }],
        metadata: { cycle_number: 1 },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-rpt-newlines-1' });

    const top = await screen.findByLabelText('Deal top summary');
    expect(top.textContent || '').not.toContain('\\n\\n');
    expect(within(top).getByText(/Overall Score: 50\/100/i)).toBeInTheDocument();
    expect(within(top).getByText(/Recommendation: PASS/i)).toBeInTheDocument();
  });

  test('AI Assistant button is gated without DIO in live mode', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: undefined,
      dioStatus: 'missing',
      lastAnalyzedAt: null,
    } as any);

    renderWorkspace({ dealId: 'deal-2' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI Assistant/i })).toBeDisabled();
    });
  });

  test('AI Assistant button enables when DIO exists', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({
      dioVersionId: 'v2.0.0',
      dioStatus: 'ready',
      lastAnalyzedAt: '2024-01-03T00:00:00.000Z',
    } as any);

    renderWorkspace({ dealId: 'deal-3' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI Assistant/i })).not.toBeDisabled();
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
      expect(screen.getByRole('button', { name: /AI Assistant/i })).not.toBeDisabled();
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
      expect(screen.getByRole('button', { name: /AI Assistant/i })).not.toBeDisabled();
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
});
