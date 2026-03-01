/**
 * OrchestratorFullReportView.test.tsx
 *
 * Unit tests for OrchestratorFullReportView — AI Analysis composition component.
 * Covers:
 *  1.  Loading/idle state shows loading UI
 *  2.  Error state shows error message + Retry button
 *  3.  Not-started state shows generate CTA
 *  4.  Ready state: all 7 sections are rendered
 *  5.  Ready state: sections appear in the correct DOM order
 *  6.  Ready state: executive summary content is rendered
 *  7.  Ready state: evidence appendix shows document coverage data
 *  8.  Evidence appendix: missing deal terms rendered when present
 *  9.  Evidence appendix: verification assessment rendered when present
 * 10.  Evidence appendix: financial health notes rendered for insufficient data
 * 11.  Header shows company name from dealName prop
 * 12.  darkMode prop propagates (no black-on-black)
 * 13.  InvestorInsightsTab does NOT import OrchestratorFullReportView (static guard)
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { OrchestratorFullReportView } from '../components/workspace/OrchestratorFullReportView';
import type { InvestorInsightsReport, OrchestratorReportResponse } from '../lib/apiClient';

// ─── Mock useInvestorInsights ─────────────────────────────────────────────────

vi.mock('../hooks/useInvestorInsights', () => ({
  useInvestorInsights: vi.fn(),
}));

import { useInvestorInsights } from '../hooks/useInvestorInsights';
const mockUseInsights = vi.mocked(useInvestorInsights);

// ─── Mock useOrchestratorReport ───────────────────────────────────────────────

vi.mock('../hooks/useOrchestratorReport', () => ({
  useOrchestratorReport: vi.fn(),
}));

import { useOrchestratorReport } from '../hooks/useOrchestratorReport';
const mockUseOrch = vi.mocked(useOrchestratorReport);

// ─── Mock heavy child components (stubs — prevent internal API calls) ─────────

vi.mock('../components/workspace/analysis/DecisionOverlay', () => ({
  DecisionOverlay: ({ dealId }: { dealId?: string }) => (
    <div data-testid="mock-decision-overlay" data-deal-id={dealId ?? ''} />
  ),
}));

vi.mock('../components/workspace/DealTermsCard', () => ({
  DealTermsCard: ({ dealId }: { dealId: string }) => (
    <div data-testid="mock-deal-terms-card" data-deal-id={dealId} />
  ),
}));

vi.mock('../components/workspace/MarketAnalysisCard', () => ({
  MarketAnalysisCard: ({ dealId }: { dealId: string }) => (
    <div data-testid="mock-market-analysis-card" data-deal-id={dealId} />
  ),
}));

vi.mock('../components/workspace/analysis/FinancialAnalysisSection', () => ({
  FinancialAnalysisSection: ({ dealId }: { dealId?: string }) => (
    <div data-testid="mock-financial-analysis" data-deal-id={dealId ?? ''} />
  ),
}));

vi.mock('../components/workspace/analysis/RiskVerificationSection', () => ({
  RiskVerificationSection: ({ dealId }: { dealId?: string }) => (
    <div data-testid="mock-risk-verification" data-deal-id={dealId ?? ''} />
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EXEC_SUMMARY_BODY =
  '---governed_executive_summary_v1_json---\n' +
  JSON.stringify({
    schema_version: 'governed_executive_summary_v1',
    headline: 'TestCo — Strong Seed Opportunity',
    summary_paragraphs: ['Compelling founding team with proven exit.', 'Early traction validated.'],
    strengths: ['Strong team', 'Clear TAM'],
    risks: ['Competitive market', 'Early stage'],
    open_questions: ['What is the CAC strategy?'],
    coverage_note: 'Document coverage: 82%',
    validated: true,
  });

function makeInsightReport(
  opts: { status?: string; withExecSummary?: boolean } = {},
): InvestorInsightsReport {
  const sections = opts.withExecSummary !== false
    ? [{ key: 'governed_executive_summary_v1', kind: 'governed_executive_summary_v1', title: 'Executive Summary', body: EXEC_SUMMARY_BODY }]
    : [];
  return {
    status: opts.status ?? 'ready',
    render_package: { sections },
  };
}

function makeOrchResponse(
  opts: {
    missing_terms?: string[];
    dci_band?: 'Strong' | 'Good' | 'Partial' | 'Weak';
    dci_score?: number;
    gates_failed?: number;
    is_proxy?: boolean;
    financial_status?: 'ok' | 'insufficient_data';
    missing_sections?: string[];
    inputs?: Record<string, number>;
  } = {},
): OrchestratorReportResponse {
  return {
    schema_version: 'ddai_orchestrator_report_v1',
    report: {
      schema_version: 'ddai_orchestrator_report_v1',
      deal_id: 'deal-test-123',
      created_at: '2025-01-01T00:00:00Z',
      input_fingerprint: 'fp-test',
      stage_context: {
        stage: 'Seed',
        raise_amount: '$2M',
        instrument: 'SAFE',
        valuation_pre: null,
        valuation_post: null,
        missing_critical_terms: opts.missing_terms ?? [],
      },
      document_confidence: {
        score: opts.dci_score ?? 72,
        band: opts.dci_band ?? 'Good',
        notes: ['Document processed successfully.'],
        section_count: 12,
        ocr_page_count: 18,
        evidence_item_count: 45,
        inputs: opts.inputs
          ? {
              text_coverage_pct: opts.inputs.text_coverage_pct,
              layout_coverage_pct: opts.inputs.layout_coverage_pct,
              dpu_integrity_score: opts.inputs.dpu_integrity_score,
              expected_pages_total: opts.inputs.expected_pages_total,
              missing_pages_total: opts.inputs.missing_pages_total,
            }
          : undefined,
      },
      scores: {
        overall_recommendation_score: 70,
        risk_severity_score: 28,
        market_score: { raw: 65, persisted: 65, missing_inputs: [] },
        financial_health_score: {
          status: opts.financial_status ?? 'ok',
          score: 68,
          is_proxy: opts.is_proxy ?? false,
          missing_sections: opts.missing_sections ?? [],
        },
      },
      decision: {
        label: 'GO',
        confidence_band: 'Medium',
        rationale_bullets: ['Strong traction'],
        thresholds_used: { stage: 'Seed', go_min_ors: 60, max_acceptable_risk: 45 },
      },
      segments: {
        risk_verification: {
          verification_requests: [],
          data_issues: {
            missing_critical_terms: opts.missing_terms ?? [],
            coverage_pct: 78,
            gates_failed: opts.gates_failed ?? 0,
          },
        },
      },
      diagnostics: { warnings: [], inputs_present: {} },
    },
  };
}

function seedInsightsReady() {
  mockUseInsights.mockReturnValue({
    status: 'ready',
    report: makeInsightReport(),
    error: null,
    generate: vi.fn(),
    refresh: vi.fn(),
  });
}

function seedOrchReady(opts: Parameters<typeof makeOrchResponse>[0] = {}) {
  mockUseOrch.mockReturnValue({
    status: 'ready',
    data: makeOrchResponse(opts),
    error: null,
    refresh: vi.fn(),
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: both hooks return loading to avoid accidental ready renders
  mockUseInsights.mockReturnValue({ status: 'idle', report: null, error: null, generate: vi.fn(), refresh: vi.fn() });
  mockUseOrch.mockReturnValue({ status: 'idle', data: null, error: null, refresh: vi.fn() });
});

// ─── Tests: loading state ─────────────────────────────────────────────────────

describe('OrchestratorFullReportView — loading state', () => {
  test('shows loading UI when insights status is idle', () => {
    mockUseInsights.mockReturnValue({ status: 'idle', report: null, error: null, generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('orchestrator-full-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('orchestrator-full-report')).toBeNull();
  });

  test('shows loading UI when insights status is loading', () => {
    mockUseInsights.mockReturnValue({ status: 'loading', report: null, error: null, generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('orchestrator-full-loading')).toBeInTheDocument();
  });

  test('loading text is visible', () => {
    mockUseInsights.mockReturnValue({ status: 'loading', report: null, error: null, generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText(/Loading Investor Report/i)).toBeInTheDocument();
  });
});

// ─── Tests: error state ───────────────────────────────────────────────────────

describe('OrchestratorFullReportView — error state', () => {
  test('shows error UI when insights status is error', () => {
    mockUseInsights.mockReturnValue({ status: 'error', report: null, error: 'Network timeout', generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('orchestrator-full-error')).toBeInTheDocument();
    expect(screen.queryByTestId('orchestrator-full-loading')).toBeNull();
  });

  test('displays error message text', () => {
    mockUseInsights.mockReturnValue({ status: 'error', report: null, error: 'Network timeout', generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  test('shows Retry button in error state', () => {
    mockUseInsights.mockReturnValue({ status: 'error', report: null, error: 'Oops', generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});

// ─── Tests: not-started state ─────────────────────────────────────────────────

describe('OrchestratorFullReportView — not started state', () => {
  test('shows not-started UI when report status is not_started', () => {
    mockUseInsights.mockReturnValue({
      status: 'ready',
      report: makeInsightReport({ status: 'not_started' }),
      error: null,
      generate: vi.fn(),
      refresh: vi.fn(),
    });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('orchestrator-full-not-started')).toBeInTheDocument();
    expect(screen.queryByTestId('orchestrator-full-report')).toBeNull();
  });

  test('shows generate report CTA in not-started state', () => {
    mockUseInsights.mockReturnValue({
      status: 'ready',
      report: { status: 'not_started' },
      error: null,
      generate: vi.fn(),
      refresh: vi.fn(),
    });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Generate Report')).toBeInTheDocument();
  });

  test('shows not-started UI when report is null', () => {
    mockUseInsights.mockReturnValue({ status: 'ready', report: null, error: null, generate: vi.fn(), refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('orchestrator-full-not-started')).toBeInTheDocument();
  });
});

// ─── Tests: ready state — sections ───────────────────────────────────────────

describe('OrchestratorFullReportView — ready state: sections', () => {
  beforeEach(() => {
    seedInsightsReady();
    seedOrchReady();
  });

  test('renders the main report container', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('orchestrator-full-report')).toBeInTheDocument();
  });

  test('renders section: decision-overlay', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('decision-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('mock-decision-overlay')).toBeInTheDocument();
  });

  test('renders section: executive-summary', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('executive-summary')).toBeInTheDocument();
  });

  test('renders section: deal-terms', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('deal-terms')).toBeInTheDocument();
    expect(screen.getByTestId('mock-deal-terms-card')).toBeInTheDocument();
  });

  test('renders section: market-analysis', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('market-analysis')).toBeInTheDocument();
    expect(screen.getByTestId('mock-market-analysis-card')).toBeInTheDocument();
  });

  test('renders section: financial-analysis', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('financial-analysis')).toBeInTheDocument();
    expect(screen.getByTestId('mock-financial-analysis')).toBeInTheDocument();
  });

  test('renders section: risk-verification', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('risk-verification')).toBeInTheDocument();
    expect(screen.getByTestId('mock-risk-verification')).toBeInTheDocument();
  });

  test('renders section: evidence-appendix', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('evidence-appendix')).toBeInTheDocument();
  });

  test('all 7 sections are present', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const expectedIds = [
      'decision-overlay',
      'executive-summary',
      'deal-terms',
      'market-analysis',
      'financial-analysis',
      'risk-verification',
      'evidence-appendix',
    ];
    for (const id of expectedIds) {
      expect(document.getElementById(id), `section#${id} must be present`).toBeInTheDocument();
    }
  });

  test('sections appear in correct DOM order', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const sections = Array.from(document.querySelectorAll('section[id]')).map((s) => s.id);
    const expectedOrder = [
      'decision-overlay',
      'executive-summary',
      'deal-terms',
      'market-analysis',
      'financial-analysis',
      'risk-verification',
      'evidence-appendix',
    ];
    // Extract only the 7 expected IDs in document order
    const filtered = sections.filter((id) => expectedOrder.includes(id));
    expect(filtered).toEqual(expectedOrder);
  });
});

// ─── Tests: header ────────────────────────────────────────────────────────────

describe('OrchestratorFullReportView — header', () => {
  beforeEach(() => {
    seedInsightsReady();
    seedOrchReady();
  });

  test('shows dealName in header subtitle', () => {
    render(<OrchestratorFullReportView dealId="deal-123" dealName="Acme Corp" />);
    expect(screen.getByText(/Investor report for Acme Corp/i)).toBeInTheDocument();
  });

  test('falls back to "this deal" when dealName is not provided', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText(/Investor report for this deal/i)).toBeInTheDocument();
  });

  test('shows Refresh button', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  test('shows Regenerate button', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
  });
});

// ─── Tests: executive summary content ────────────────────────────────────────

describe('OrchestratorFullReportView — executive summary content', () => {
  beforeEach(() => {
    mockUseInsights.mockReturnValue({
      status: 'ready',
      report: makeInsightReport({ withExecSummary: true }),
      error: null,
      generate: vi.fn(),
      refresh: vi.fn(),
    });
    seedOrchReady();
  });

  test('renders headline text from exec summary section', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('TestCo — Strong Seed Opportunity')).toBeInTheDocument();
  });

  test('renders strengths', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Strong team')).toBeInTheDocument();
    expect(screen.getByText('Clear TAM')).toBeInTheDocument();
  });

  test('renders risks', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('Competitive market')).toBeInTheDocument();
  });

  test('renders open questions', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('What is the CAC strategy?')).toBeInTheDocument();
  });

  test('shows AI Governed badge', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText('AI Governed')).toBeInTheDocument();
  });

  test('shows validated badge when validated=true', () => {
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText(/numeric-parity validated/i)).toBeInTheDocument();
  });

  test('shows empty fallback when no exec summary section', () => {
    mockUseInsights.mockReturnValue({
      status: 'ready',
      report: makeInsightReport({ withExecSummary: false }),
      error: null,
      generate: vi.fn(),
      refresh: vi.fn(),
    });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText(/Executive summary not available/i)).toBeInTheDocument();
  });
});

// ─── Tests: evidence appendix ─────────────────────────────────────────────────

describe('OrchestratorFullReportView — evidence appendix', () => {
  beforeEach(() => {
    seedInsightsReady();
  });

  test('shows document coverage card with score and band', () => {
    seedOrchReady({ dci_score: 74, dci_band: 'Good' });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const card = screen.getByTestId('evidence-doc-coverage');
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain('74');
    expect(card.textContent).toContain('Good');
  });

  test('shows section_count and ocr_page_count when present', () => {
    seedOrchReady();
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const card = screen.getByTestId('evidence-doc-coverage');
    expect(card.textContent).toContain('12'); // section_count
    expect(card.textContent).toContain('18'); // ocr_page_count
  });

  test('shows text and layout coverage when inputs present', () => {
    seedOrchReady({ inputs: { text_coverage_pct: 0.87, layout_coverage_pct: 0.75 } });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const card = screen.getByTestId('evidence-doc-coverage');
    expect(card.textContent).toContain('87%');
    expect(card.textContent).toContain('75%');
  });

  test('missing deal terms card appears when there are missing terms', () => {
    seedOrchReady({ missing_terms: ['pre_money_valuation', 'board_seats'] });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const card = screen.getByTestId('evidence-missing-terms');
    expect(card.textContent).toContain('pre_money_valuation');
    expect(card.textContent).toContain('board_seats');
  });

  test('missing deal terms card is absent when no missing terms', () => {
    seedOrchReady({ missing_terms: [] });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.queryByTestId('evidence-missing-terms')).toBeNull();
  });

  test('verification assessment card renders gates_failed count', () => {
    seedOrchReady({ gates_failed: 2 });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const card = screen.getByTestId('evidence-verification');
    expect(card.textContent).toContain('2');
  });

  test('financial health notes shown for proxy score', () => {
    seedOrchReady({ is_proxy: true });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('evidence-financial-health')).toBeInTheDocument();
    expect(screen.getByText(/proxy estimate/i)).toBeInTheDocument();
  });

  test('financial health notes shown for insufficient_data status', () => {
    seedOrchReady({ financial_status: 'insufficient_data' });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByTestId('evidence-financial-health')).toBeInTheDocument();
  });

  test('financial health notes shown when missing sections present', () => {
    seedOrchReady({ missing_sections: ['income_statement', 'balance_sheet'] });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    const card = screen.getByTestId('evidence-financial-health');
    expect(card.textContent).toContain('income_statement');
    expect(card.textContent).toContain('balance_sheet');
  });

  test('financial health card absent when data is clean', () => {
    seedOrchReady({ is_proxy: false, financial_status: 'ok', missing_sections: [] });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.queryByTestId('evidence-financial-health')).toBeNull();
  });

  test('shows loading placeholder when orch status is loading', () => {
    mockUseOrch.mockReturnValue({ status: 'loading', data: null, error: null, refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(document.getElementById('evidence-appendix')).toBeInTheDocument();
    expect(screen.getByText(/Loading evidence data/i)).toBeInTheDocument();
  });

  test('shows not-available fallback when orch status is not_found', () => {
    mockUseOrch.mockReturnValue({ status: 'not_found', data: null, error: null, refresh: vi.fn() });
    render(<OrchestratorFullReportView dealId="deal-123" />);
    expect(screen.getByText(/Orchestrator report not available/i)).toBeInTheDocument();
  });
});

// ─── Tests: darkMode ─────────────────────────────────────────────────────────

describe('OrchestratorFullReportView — darkMode', () => {
  test('darkMode: loading text is visible (no black-on-black)', () => {
    mockUseInsights.mockReturnValue({ status: 'loading', report: null, error: null, generate: vi.fn(), refresh: vi.fn() });
    const { container } = render(<OrchestratorFullReportView dealId="deal-123" darkMode />);
    const heading = container.querySelector('h3');
    expect(heading).not.toBeNull();
    // Must not have black text in dark mode
    expect(heading!.className).not.toContain('text-gray-900');
    // Must have explicit dark mode color
    expect(heading!.className).toContain('text-white');
  });

  test('darkMode: ready state header uses white text', () => {
    seedInsightsReady();
    seedOrchReady();
    const { container } = render(
      <OrchestratorFullReportView dealId="deal-123" darkMode dealName="Acme" />,
    );
    const heading = container.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading!.className).toContain('text-white');
    expect(heading!.className).not.toContain('text-gray-900');
  });
});

// ─── Tests: dealId passed through ────────────────────────────────────────────

describe('OrchestratorFullReportView — dealId prop handling', () => {
  beforeEach(() => {
    seedInsightsReady();
    seedOrchReady();
  });

  test('passess dealId to mock DecisionOverlay', () => {
    render(<OrchestratorFullReportView dealId="deal-abc" />);
    expect(screen.getByTestId('mock-decision-overlay').getAttribute('data-deal-id')).toBe('deal-abc');
  });

  test('passes dealId to mock DealTermsCard', () => {
    render(<OrchestratorFullReportView dealId="deal-abc" />);
    expect(screen.getByTestId('mock-deal-terms-card').getAttribute('data-deal-id')).toBe('deal-abc');
  });

  test('passes dealId to mock MarketAnalysisCard', () => {
    render(<OrchestratorFullReportView dealId="deal-abc" />);
    expect(screen.getByTestId('mock-market-analysis-card').getAttribute('data-deal-id')).toBe('deal-abc');
  });
});

// ─── Static guard: InvestorInsightsTab isolation ──────────────────────────────

describe('OrchestratorFullReportView — static isolation guard', () => {
  test('InvestorInsightsTab.tsx does NOT import OrchestratorFullReportView', () => {
    const webRoot = resolve(__dirname, '../..');
    const tabPath = resolve(webRoot, 'src/components/workspace/InvestorInsightsTab.tsx');
    if (!existsSync(tabPath)) return;
    const src = readFileSync(tabPath, 'utf-8');
    expect(src).not.toContain('OrchestratorFullReportView');
  });

  test('InvestorReportView.tsx does NOT import OrchestratorFullReportView', () => {
    const webRoot = resolve(__dirname, '../..');
    const viewPath = resolve(webRoot, 'src/components/workspace/InvestorReportView.tsx');
    if (!existsSync(viewPath)) return;
    const src = readFileSync(viewPath, 'utf-8');
    expect(src).not.toContain('OrchestratorFullReportView');
  });
});
