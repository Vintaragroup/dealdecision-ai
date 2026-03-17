/**
 * InvestorInsightsTab.reportSummaryRouting.test.tsx
 *
 * PR36.6A — Report-summary routing verification.
 *
 * Asserts that sections listed in REPORT_SUMMARY_KEYS are excluded from the
 * Investor Insights decision surface and that genuine investor-facing sections
 * (e.g. llm_interpretation_v1) continue to render normally.
 *
 * Covered scenarios:
 *   1. governed_executive_summary_v1 does NOT render in InvestorInsightsTab
 *   2. governed_summary_v1 does NOT render in InvestorInsightsTab
 *   3. llm_interpretation_v1 DOES render in InvestorInsightsTab (not excluded)
 *   4. Mixed report: only non-report-summary sections surface in InvestorInsightsTab
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi } from 'vitest';

import { InvestorInsightsTab } from '../components/workspace/InvestorInsightsTab';

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    apiPostDealTermsAnalysis: vi.fn(async () => new Promise<never>(() => {})),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildGovernedSummaryV1Body(
  execSummary = 'STUB deterministic investment summary sentence.',
): string {
  return [
    '## AI Investment Summary',
    '',
    '---governed_summary_v1_json---',
    JSON.stringify({
      schema_version: 'governed_summary_v1',
      executive_summary: execSummary,
      strengths: ['Stub strength A'],
      risks: ['Stub risk B'],
      open_questions: ['Stub question C?'],
      validated: false,
    }),
  ].join('\n');
}

function buildGovernedExecSummaryV1Body(headline = 'STUB Headline — Exec Summary'): string {
  return [
    headline,
    '',
    '---governed_executive_summary_v1_json---',
    JSON.stringify({
      schema_version: 'governed_executive_summary_v1',
      headline,
      summary_paragraphs: ['STUB paragraph one.'],
      strengths: ['Stub exec strength'],
      risks: ['Stub exec risk'],
      open_questions: [],
      coverage_note: '',
      validated: false,
    }),
  ].join('\n');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InvestorInsightsTab — REPORT_SUMMARY_KEYS routing (PR36.6A)', () => {
  test('governed_executive_summary_v1 does NOT render in the Investor Insights tab', async () => {
    const { apiGetInvestorInsights } = await import('../lib/apiClient');
    (apiGetInvestorInsights as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'governed_executive_summary_v1',
            title: 'AI Executive Summary',
            kind: 'message',
            body: buildGovernedExecSummaryV1Body(),
          },
        ],
      },
    });

    render(<InvestorInsightsTab dealId="deal-routing-test" darkMode={false} />);

    // decisionSurface is empty — the fallback message renders after load
    await screen.findByText(/Data tab/);

    // Section title and parsed headline must NOT appear
    expect(screen.queryByText('AI Executive Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('STUB Headline — Exec Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('STUB paragraph one.')).not.toBeInTheDocument();
  });

  test('governed_summary_v1 does NOT render in the Investor Insights tab', async () => {
    const { apiGetInvestorInsights } = await import('../lib/apiClient');
    (apiGetInvestorInsights as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'governed_summary_v1',
            title: 'AI Investment Summary',
            kind: 'message',
            body: buildGovernedSummaryV1Body(),
          },
        ],
      },
    });

    render(<InvestorInsightsTab dealId="deal-routing-test-2" darkMode={false} />);

    // decisionSurface is empty — fallback renders
    await screen.findByText(/Data tab/);

    // Section title and parsed content must NOT appear
    expect(screen.queryByText('AI Investment Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('STUB deterministic investment summary sentence.')).not.toBeInTheDocument();
    expect(screen.queryByText('Stub strength A')).not.toBeInTheDocument();
  });

  test('llm_interpretation_v1 DOES render in the Investor Insights tab', async () => {
    const { apiGetInvestorInsights } = await import('../lib/apiClient');
    (apiGetInvestorInsights as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'llm_interpretation_v1',
            title: 'AI Interpretation',
            kind: 'message',
            body: 'STUB: LLM interpretation narrative for this deal.',
          },
        ],
      },
    });

    render(<InvestorInsightsTab dealId="deal-routing-test-3" darkMode={false} />);

    // Section title should appear — llm_interpretation_v1 is NOT in REPORT_SUMMARY_KEYS
    const title = await screen.findByText('AI Interpretation');
    expect(title).toBeInTheDocument();
  });

  test('mixed report: only non-report-summary sections surface in InvestorInsightsTab', async () => {
    const { apiGetInvestorInsights } = await import('../lib/apiClient');
    (apiGetInvestorInsights as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'deterministic_only',
      render_package: {
        sections: [
          {
            key: 'governed_executive_summary_v1',
            title: 'AI Executive Summary',
            kind: 'message',
            body: buildGovernedExecSummaryV1Body(),
          },
          {
            key: 'governed_summary_v1',
            title: 'AI Investment Summary',
            kind: 'message',
            body: buildGovernedSummaryV1Body(),
          },
          {
            key: 'llm_interpretation_v1',
            title: 'AI Interpretation',
            kind: 'message',
            body: 'STUB: LLM interpretation text visible in Investor Insights.',
          },
        ],
      },
    });

    render(<InvestorInsightsTab dealId="deal-routing-test-4" darkMode={false} />);

    // llm_interpretation_v1 renders
    const interpTitle = await screen.findByText('AI Interpretation');
    expect(interpTitle).toBeInTheDocument();

    // Report-summary sections must NOT render
    expect(screen.queryByText('AI Executive Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('AI Investment Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('STUB Headline — Exec Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('STUB deterministic investment summary sentence.')).not.toBeInTheDocument();
  });
});
