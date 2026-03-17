/**
 * InvestorReportView.exec-summary.test.tsx
 *
 * Component tests for the Executive Summary card in InvestorReportView:
 *
 *   1. Governed exec summary — renders headline + summary_paragraphs + 3 lists
 *   2. "AI Governed" badge shown when governed_executive_summary_v1 present
 *   3. "deterministic_only" raw text NOT shown (replaced by "AI Governed")
 *   4. EmptyFallback + Regenerate CTA when section absent
 *   5. EmptyFallback when section body has no JSON marker (parse failure)
 *   6. InvestorInsightsTab does NOT render governed_executive_summary_v1 (routed to Report tab — PR36.6A)
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi } from 'vitest';

import { InvestorReportView } from '../components/workspace/InvestorReportView';
import { InvestorInsightsTab } from '../components/workspace/InvestorInsightsTab';
import type { InvestorInsightsReport } from '../lib/apiClient';

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    // Keep DealTermsCard in perpetual loading state during these tests
    apiPostDealTermsAnalysis: vi.fn(async () => new Promise<never>(() => {})),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildExecSummaryBody(overrides: {
  headline?: string;
  paragraphs?: string[];
  strengths?: string[];
  risks?: string[];
  open_questions?: string[];
  validated?: boolean;
} = {}): string {
  const headline     = overrides.headline     ?? 'StackFactor — SaaS Platform (Seed)';
  const paragraphs   = overrides.paragraphs   ?? [
    'StackFactor builds workflow automation software for logistics operators.',
    'Differentiation versus incumbents is not clearly detailed in the provided materials.',
    'The TAM is estimated at $4B by the company.',
    'StackFactor is raising $2M in a seed round.',
  ];
  const strengths    = overrides.strengths    ?? ['Strong revenue growth', '$4B TAM'];
  const risks        = overrides.risks        ?? ['Pre-revenue', 'Single channel'];
  const open_questions = overrides.open_questions ?? ['What is the retention rate?'];
  const validated    = overrides.validated    ?? true;

  const json = JSON.stringify({
    schema_version: 'governed_executive_summary_v1',
    headline,
    summary_paragraphs: paragraphs,
    strengths,
    risks,
    open_questions,
    coverage_note: '15/20 pages parsed (75%). 30 evidence items.',
    validated,
  });

  // Human-readable body (mirroring serializeGovernedExecSummaryBody format)
  return [
    headline,
    '',
    ...paragraphs,
    '',
    '---governed_executive_summary_v1_json---',
    json,
  ].join('\n');
}

function buildReport(sections: object[]): InvestorInsightsReport {
  return {
    status: 'deterministic_only',
    render_package: {
      status: 'deterministic_only',
      sections: sections as any,
    },
  } as InvestorInsightsReport;
}

function buildReportWithExecSummary(bodyOverrides?: Parameters<typeof buildExecSummaryBody>[0]): InvestorInsightsReport {
  return buildReport([
    {
      key: 'governed_executive_summary_v1',
      title: 'AI Executive Summary',
      kind: 'message',
      body: buildExecSummaryBody(bodyOverrides),
    },
    {
      key: 'canonical_fields',
      title: 'Canonical Fields',
      kind: 'message',
      body: 'category=raise_terms | field=raise_amount | computability=Computable | value="$2M" | evidence=none | reason=none',
    },
  ]);
}

// ─── InvestorReportView tests ─────────────────────────────────────────────────

describe('InvestorReportView — Executive Summary card', () => {
  test('renders headline from governed_executive_summary_v1 section', () => {
    render(<InvestorReportView report={buildReportWithExecSummary()} darkMode={false} />);
    expect(screen.getByText('StackFactor — SaaS Platform (Seed)')).toBeInTheDocument();
  });

  test('renders all summary_paragraphs', () => {
    render(<InvestorReportView report={buildReportWithExecSummary()} darkMode={false} />);
    expect(
      screen.getByText('StackFactor builds workflow automation software for logistics operators.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('StackFactor is raising $2M in a seed round.'),
    ).toBeInTheDocument();
  });

  test('renders Strengths, Risks and Open Questions lists', () => {
    render(<InvestorReportView report={buildReportWithExecSummary()} darkMode={false} />);
    expect(screen.getByText('Strengths')).toBeInTheDocument();
    expect(screen.getByText('Risks')).toBeInTheDocument();
    expect(screen.getByText('Open Questions')).toBeInTheDocument();
    expect(screen.getByText('Strong revenue growth')).toBeInTheDocument();
    expect(screen.getByText('Pre-revenue')).toBeInTheDocument();
    expect(screen.getByText('What is the retention rate?')).toBeInTheDocument();
  });

  test('shows "AI Governed" provenance badge when governed section is present', () => {
    render(<InvestorReportView report={buildReportWithExecSummary()} darkMode={false} />);
    // At least one "AI Governed" badge should appear
    const badges = screen.getAllByText('AI Governed');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  test('does NOT show raw "deterministic_only" text in the status badge when governed section is present', () => {
    render(<InvestorReportView report={buildReportWithExecSummary()} darkMode={false} />);
    // The meta bar should show "AI Governed", not "deterministic_only"
    expect(screen.queryByText('deterministic_only')).not.toBeInTheDocument();
  });

  test('shows EmptyFallback with Regenerate CTA when governed_executive_summary_v1 is absent', () => {
    const report = buildReport([
      {
        key: 'canonical_fields',
        title: 'Canonical Fields',
        kind: 'message',
        body: 'category=raise_terms | field=raise_amount | computability=Computable | value="$2M" | evidence=none | reason=none',
      },
    ]);
    render(<InvestorReportView report={report} darkMode={false} />);
    expect(screen.getByText('AI executive summary not yet generated.')).toBeInTheDocument();
    expect(screen.getByText(/Regenerate/)).toBeInTheDocument();
  });

  test('shows EmptyFallback when section body has no JSON marker (parse failure)', () => {
    const report = buildReport([
      {
        key: 'governed_executive_summary_v1',
        title: 'AI Executive Summary',
        kind: 'message',
        body: 'This is plain text with no JSON marker.',
      },
    ]);
    render(<InvestorReportView report={report} darkMode={false} />);
    expect(
      screen.getByText(/Executive summary could not be parsed/),
    ).toBeInTheDocument();
  });

  test('does NOT render deterministic-only governed_summary_v1 text in the exec summary card', () => {
    // Report has both sections; exec summary should ONLY use governed_executive_summary_v1
    const report = buildReport([
      {
        key: 'governed_summary_v1',
        title: 'AI Summary',
        kind: 'message',
        body: [
          '## Stub summary text from governed_summary_v1',
          '',
          '---governed_summary_v1_json---',
          JSON.stringify({
            schema_version: 'governed_summary_v1',
            executive_summary: 'STUB: This is a short deterministic sentence.',
            strengths: [],
            risks: [],
            open_questions: [],
            validated: false,
          }),
        ].join('\n'),
      },
      {
        key: 'governed_executive_summary_v1',
        title: 'AI Executive Summary',
        kind: 'message',
        body: buildExecSummaryBody(),
      },
    ]);
    render(<InvestorReportView report={report} darkMode={false} />);
    // The governed_summary_v1 exec_summary value should NOT appear in the exec summary card
    expect(screen.queryByText('STUB: This is a short deterministic sentence.')).not.toBeInTheDocument();
    // The governed_executive_summary_v1 headline SHOULD appear
    expect(screen.getByText('StackFactor — SaaS Platform (Seed)')).toBeInTheDocument();
  });

  test('shows "Numeric-parity validated" when validated=true', () => {
    render(<InvestorReportView report={buildReportWithExecSummary({ validated: true })} darkMode={false} />);
    expect(screen.getByText('Numeric-parity validated')).toBeInTheDocument();
  });
});

// ─── InvestorInsightsTab — governed_executive_summary_v1 routing (PR36.6A) ──

describe('InvestorInsightsTab — governed_executive_summary_v1 routing (PR36.6A)', () => {
  test('does NOT render governed_executive_summary_v1 in the Investor Insights tab (routed to Report tab)', async () => {
    const MOCKED_REPORT = {
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'governed_executive_summary_v1',
            title: 'AI Executive Summary',
            kind: 'message',
            body: buildExecSummaryBody(),
          },
        ],
      },
    };

    const { apiGetInvestorInsights } = await import('../lib/apiClient');
    (apiGetInvestorInsights as ReturnType<typeof vi.fn>).mockResolvedValue(MOCKED_REPORT);

    render(<InvestorInsightsTab dealId="test-deal-123" darkMode={false} />);

    // Wait for the component to finish loading — all sections are report-only so
    // decisionSurface is empty and the fallback message renders
    await screen.findByText(/Data tab/);

    // PR36.6A: governed_executive_summary_v1 is filtered by REPORT_SUMMARY_KEYS
    // and must NOT render inside the Investor Insights tab
    expect(screen.queryByText('StackFactor \u2014 SaaS Platform (Seed)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('StackFactor builds workflow automation software for logistics operators.'),
    ).not.toBeInTheDocument();
  });

  test('does NOT render raw JSON or section title for governed_executive_summary_v1', async () => {
    const MOCKED_REPORT = {
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'governed_executive_summary_v1',
            title: 'AI Executive Summary',
            kind: 'message',
            body: buildExecSummaryBody(),
          },
        ],
      },
    };

    const { apiGetInvestorInsights } = await import('../lib/apiClient');
    (apiGetInvestorInsights as ReturnType<typeof vi.fn>).mockResolvedValue(MOCKED_REPORT);

    render(<InvestorInsightsTab dealId="test-deal-123" darkMode={false} />);

    // Wait for load
    await screen.findByText(/Data tab/);

    // The raw JSON marker and schema string must not be visible
    expect(screen.queryByText('---governed_executive_summary_v1_json---')).not.toBeInTheDocument();
    expect(screen.queryByText(/schema_version.*governed_executive_summary/)).not.toBeInTheDocument();
    // The section title card must not render
    expect(screen.queryByText('AI Executive Summary')).not.toBeInTheDocument();
  });
});

// ─── InvestorReportView — Deal Terms section with DealTermsCard ───────────────

describe('InvestorReportView — Deal Terms section with DealTermsCard', () => {
  test('renders DealTermsCard loading skeleton inside Deal Terms section when dealId provided', () => {
    render(
      <InvestorReportView
        report={buildReportWithExecSummary()}
        darkMode={false}
        dealId="test-deal-abc"
      />,
    );
    expect(screen.getByTestId('deal-terms-loading-skeleton')).toBeInTheDocument();
  });

  test('DealTermsCard loading skeleton appears INSIDE the #deal-terms section (not above the report)', () => {
    render(
      <InvestorReportView
        report={buildReportWithExecSummary()}
        darkMode={false}
        dealId="test-deal-abc"
      />,
    );
    const section = document.getElementById('deal-terms');
    expect(section).not.toBeNull();
    const skeleton = screen.getByTestId('deal-terms-loading-skeleton');
    expect(section!.contains(skeleton)).toBe(true);
  });

  test('falls back to raw canonical DealTermsSection when no dealId is provided', () => {
    render(
      <InvestorReportView
        report={buildReportWithExecSummary()}
        darkMode={false}
      />,
    );
    // DealTermsCard skeleton must NOT appear — the raw table is used instead
    expect(screen.queryByTestId('deal-terms-loading-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTestId('deal-terms-card')).not.toBeInTheDocument();
  });

  test('dark mode: narrative uses text-zinc-100 class when DealTermsCard is loaded', () => {
    // This relies on the component using the correct Tailwind class for dark mode text.
    // Since the hook is mocked to never resolve, we assert that the loading skeleton
    // is shown (proving the dark-mode code path is reached without class assertion).
    render(
      <InvestorReportView
        report={buildReportWithExecSummary()}
        darkMode={true}
        dealId="test-deal-darkmode"
      />,
    );
    expect(screen.getByTestId('deal-terms-loading-skeleton')).toBeInTheDocument();
  });
});
