/**
 * DealTermsCard.integration.test.tsx — Phase 3 E2E integration tests
 *
 * Proves the following integration properties end-to-end through the full
 * React render tree:
 *
 *  1. The card shows the governed LLM narrative — NOT raw canonical pipe rows
 *  2. The "AI Governed" badge is always visible
 *  3. The raw canonical inspector is HIDDEN by default (privacy guard)
 *  4. Clicking "View Details" reveals — and "Hide Details" hides — the raw table
 *  5. Pipe-delimited canonical rows (category=X | field=Y | ...) never appear
 *     in the default DOM snapshot
 *  6. Missing terms callout links directly to disclosed / undisclosed canonical
 *     field derivation
 *  7. The hook passes the precise canonical_fields from the report to the API
 *  8. The hook does NOT call the API when ALL canonical fields are null (no_data)
 *  9. The card renders correctly in both light and dark mode
 * 10. The card does not render if called with an InvestorInsightsReport that
 *     has no canonical_fields section
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { DealTermsCard } from '../components/workspace/DealTermsCard';
import type { DealTermsAnalysisResult, InvestorInsightsReport } from '../lib/apiClient';

// Reset mocks before every test
beforeEach(() => vi.clearAllMocks());

// ─── Mock API client ───────────────────────────────────────────────────────────
//
// We mock apiPostDealTermsAnalysis to control the LLM output and assert that
// it is called with the correct canonical_fields derived from the report.

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiPostDealTermsAnalysis: vi.fn(),
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
    apiRegenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

// ─── Fixture data ──────────────────────────────────────────────────────────────

/** Raw pipe-delimited canonical fields body (what the deterministic pipeline writes). */
const CANONICAL_FIELDS_BODY = [
  'category=raise_terms | field=raise_amount | computability=Computable | value="$1.5M" | evidence=none | reason=none',
  'category=raise_terms | field=raise_round | computability=Computable | value="Pre-Seed" | evidence=none | reason=none',
  'category=raise_terms | field=raise_instrument | computability=Computable | value="SAFE" | evidence=none | reason=none',
  'category=raise_terms | field=raise_cap | computability=Computable | value="$8M" | evidence=none | reason=none',
  'category=raise_terms | field=raise_discount | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=note_interest_rate | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=note_maturity | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=valuation_pre | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=valuation_post | computability=NotComputable | value=none | evidence=none | reason=none',
  'category=raise_terms | field=valuation_safe_cap | computability=Computable | value="$8M" | evidence=none | reason=none',
].join('\n');

function buildReport(
  options: { canonicalBody?: string; omitCanonical?: boolean } = {},
): InvestorInsightsReport {
  const sections = options.omitCanonical
    ? []
    : [
        {
          key: 'canonical_fields',
          title: 'Canonical Fields',
          kind: 'message' as const,
          body: options.canonicalBody ?? CANONICAL_FIELDS_BODY,
        },
      ];
  return {
    status: 'deterministic_only',
    render_package: { sections },
  } as InvestorInsightsReport;
}

/** The governed LLM narrative that is distinct from raw pipe text. */
const GOVERNED_NARRATIVE =
  'The company is raising $1.5M in a pre-seed SAFE at an $8M valuation cap. ' +
  'The structure is straightforward with no discount rate disclosed. ' +
  'No interest rate or maturity terms are disclosed, limiting downside protection.';

const MOCK_LLM_RESULT: DealTermsAnalysisResult = {
  structure_summary: GOVERNED_NARRATIVE,
  structure_assessment: {
    simplicity: 'High',
    dilution_visibility: 'High',
    valuation_clarity: 'High',
    downside_protection: 'Low',
  },
  missing_terms: ['Discount rate', 'Note interest rate', 'Note maturity'],
};

// ─── Helper: render and wait for LLM data ─────────────────────────────────────

async function renderAndWait(
  dealId = 'adb2a1cf-0000-0000-0000-000000000001',
  report = buildReport(),
  darkMode = false,
) {
  const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
  (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MOCK_LLM_RESULT);

  render(<DealTermsCard dealId={dealId} report={report} darkMode={darkMode} />);
  await screen.findByTestId('deal-terms-card');
  return { apiPostDealTermsAnalysis };
}

// ─── 1. Governed LLM narrative is shown — NOT raw pipe text ──────────────────

describe('1 — Governed LLM narrative vs raw pipe text', () => {
  test('governed narrative text is visible in the rendered card', async () => {
    await renderAndWait();
    const narrative = screen.getByTestId('deal-terms-narrative');
    expect(narrative.textContent).toContain('raising $1.5M in a pre-seed SAFE');
  });

  test('raw pipe-delimited canonical rows are NOT visible by default', async () => {
    await renderAndWait();
    // The pipe-delimited format "field=X | computability=Y" must not appear in the DOM
    const fullText = document.body.textContent ?? '';
    expect(fullText).not.toMatch(/category=raise_terms\s*\|/);
    expect(fullText).not.toMatch(/computability=Computable/);
    expect(fullText).not.toMatch(/computability=NotComputable/);
    // The raw canonical_fields body string must not leak into the default view
    expect(fullText).not.toContain('category=raise_terms | field=raise_amount');
  });

  test('raw table is absent from DOM until "View Details" is clicked', async () => {
    await renderAndWait();
    expect(screen.queryByTestId('deal-terms-raw-table')).not.toBeInTheDocument();
  });
});

// ─── 2. AI Governed badge ─────────────────────────────────────────────────────

describe('2 — AI Governed badge is visible', () => {
  test('AI Governed badge appears in the ready state', async () => {
    await renderAndWait();
    expect(screen.getByText('AI Governed')).toBeInTheDocument();
  });

  test('AI Governed badge appears in the loading state', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<DealTermsCard dealId="test" report={buildReport()} darkMode={false} />);
    // Skeleton shown — badge still present during loading
    expect(screen.getByLabelText('Loading deal terms analysis')).toBeInTheDocument();
    expect(screen.getByText('AI Governed')).toBeInTheDocument();
  });
});

// ─── 3. "View Details" toggle is collapsed by default ─────────────────────────

describe('3 — Details toggle: collapsed by default', () => {
  test('raw table is not present before "View Details" is clicked', async () => {
    await renderAndWait();
    expect(screen.queryByTestId('deal-terms-raw-table')).not.toBeInTheDocument();
  });

  test('"View Details" button is visible', async () => {
    await renderAndWait();
    expect(screen.getByTestId('deal-terms-details-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('deal-terms-details-toggle').textContent).toMatch(/View Details/i);
  });
});

// ─── 4. "View Details" reveals the raw canonical inspector ────────────────────

describe('4 — View Details / Hide Details toggle', () => {
  test('clicking "View Details" reveals the raw table', async () => {
    await renderAndWait();
    const toggle = screen.getByTestId('deal-terms-details-toggle');
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByTestId('deal-terms-raw-table')).toBeInTheDocument();
    });
  });

  test('toggle label changes to "Hide Details" when expanded', async () => {
    await renderAndWait();
    const toggle = screen.getByTestId('deal-terms-details-toggle');
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(toggle.textContent).toMatch(/Hide Details/i);
    });
  });

  test('clicking "Hide Details" collapses the raw table again', async () => {
    await renderAndWait();
    const toggle = screen.getByTestId('deal-terms-details-toggle');

    // Expand
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('deal-terms-raw-table')).toBeInTheDocument());

    // Collapse
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByTestId('deal-terms-raw-table')).not.toBeInTheDocument(),
    );
    expect(toggle.textContent).toMatch(/View Details/i);
  });
});

// ─── 5. Pipe-delimited rows never appear in default DOM snapshot ───────────────

describe('5 — No pipe-delimited text in default DOM', () => {
  test('pipe-format "category=X | field=Y" is absent in default view', async () => {
    await renderAndWait();
    const bodyText = document.body.textContent ?? '';
    // No raw pipe-delimited field notation should appear
    expect(bodyText).not.toMatch(/\|\s*field=/);
    expect(bodyText).not.toMatch(/\|\s*computability=/);
    expect(bodyText).not.toMatch(/\|\s*evidence=/);
  });

  test('governed narrative text is distinct from deterministic canonical body', async () => {
    await renderAndWait();
    const narrative = screen.getByTestId('deal-terms-narrative');
    // Narrative must be the LLM text, not a transcript of the pipe rows
    expect(narrative.textContent).not.toContain('category=raise_terms');
    expect(narrative.textContent).not.toContain('computability=');
  });
});

// ─── 6. Missing terms callout ─────────────────────────────────────────────────

describe('6 — Missing terms callout', () => {
  test('missing terms callout appears when missing_terms is non-empty', async () => {
    await renderAndWait();
    expect(screen.getByTestId('deal-terms-missing')).toBeInTheDocument();
  });

  test('missing terms callout lists the returned undisclosed term names', async () => {
    await renderAndWait();
    const callout = screen.getByTestId('deal-terms-missing');
    expect(callout.textContent).toContain('Discount rate');
  });

  test('missing terms callout is absent when missing_terms is empty', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...MOCK_LLM_RESULT,
      missing_terms: [],
    });

    render(<DealTermsCard dealId="test" report={buildReport()} darkMode={false} />);
    await screen.findByTestId('deal-terms-card');

    expect(screen.queryByTestId('deal-terms-missing')).not.toBeInTheDocument();
  });
});

// ─── 7. Hook passes correct canonical_fields to the API ─────────────────────

describe('7 — Correct canonical_fields passed to API', () => {
  test('apiPostDealTermsAnalysis is called with dealId and extracted fields', async () => {
    const { apiPostDealTermsAnalysis } = await renderAndWait('adb2a1cf-0000-0000-0000-000000000001');

    expect(apiPostDealTermsAnalysis).toHaveBeenCalledOnce();
    const [calledDealId, calledFields] = (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mock.calls[0]!;

    expect(calledDealId).toBe('adb2a1cf-0000-0000-0000-000000000001');
    // Confirmed disclosed values
    expect(calledFields.raise_amount).toBe('$1.5M');
    expect(calledFields.raise_cap).toBe('$8M');
    expect(calledFields.raise_instrument).toBe('SAFE');
    // Confirmed null values
    expect(calledFields.raise_discount).toBeNull();
    expect(calledFields.note_interest_rate).toBeNull();
  });

  test('canonical_fields keys are the correct 10 raise-term field names', async () => {
    const { apiPostDealTermsAnalysis } = await renderAndWait();

    const [, calledFields] = (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const EXPECTED_KEYS = [
      'raise_amount', 'raise_round', 'raise_instrument', 'raise_cap',
      'raise_discount', 'note_interest_rate', 'note_maturity',
      'valuation_pre', 'valuation_post', 'valuation_safe_cap',
    ];
    for (const key of EXPECTED_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(calledFields, key), `Missing key: ${key}`).toBe(true);
    }
    // No extra keys beyond the 10 expected
    expect(Object.keys(calledFields)).toHaveLength(EXPECTED_KEYS.length);
  });
});

// ─── 8. No API call when all canonical fields are null ────────────────────────

describe('8 — no_data state when all canonical fields are null', () => {
  test('does not call apiPostDealTermsAnalysis when all fields are null', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    // No canonical fields at all
    render(
      <DealTermsCard
        dealId="test"
        report={buildReport({ canonicalBody: '' })}
        darkMode={false}
      />,
    );

    // Give the hook time to potentially fire the API call
    await new Promise((r) => setTimeout(r, 80));
    expect(apiPostDealTermsAnalysis).not.toHaveBeenCalled();
  });

  test('shows no-data message when all canonical fields are null', async () => {
    render(
      <DealTermsCard
        dealId="test"
        report={buildReport({ canonicalBody: '' })}
        darkMode={false}
      />,
    );
    // Wait for status to resolve to no_data
    await waitFor(() => {
      expect(screen.queryByTestId('deal-terms-card')).not.toBeInTheDocument();
    });
    expect(document.body.textContent).toContain('No deal terms found');
  });

  test('shows no-data message when canonical_fields section is absent', async () => {
    render(
      <DealTermsCard
        dealId="test"
        report={buildReport({ omitCanonical: true })}
        darkMode={false}
      />,
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain('No deal terms found');
    });
  });
});

// ─── 9. Light and dark mode rendering ────────────────────────────────────────

describe('9 — Light and dark mode', () => {
  test('renders correctly in light mode', async () => {
    await renderAndWait('test', buildReport(), false);
    const card = screen.getByTestId('deal-terms-card');
    expect(card).toBeInTheDocument();
    // Light mode has bg-white class somewhere in the card chain
    expect(card.className).toMatch(/bg-white/);
  });

  test('renders correctly in dark mode', async () => {
    await renderAndWait('test', buildReport(), true);
    const card = screen.getByTestId('deal-terms-card');
    expect(card).toBeInTheDocument();
    // Dark mode has bg-[#0f1117] class
    expect(card.className).toMatch(/bg-\[#0f1117\]/);
  });
});

// ─── 10. Error state retry ────────────────────────────────────────────────────

describe('10 — Error state and retry', () => {
  test('shows error message and Retry button when API call fails', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('LLM service unavailable'),
    );

    render(<DealTermsCard dealId="test" report={buildReport()} darkMode={false} />);

    await waitFor(() => {
      expect(screen.getByText(/LLM service unavailable/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  test('clicking Retry re-calls the API', async () => {
    const { apiPostDealTermsAnalysis } = await import('../lib/apiClient');
    (apiPostDealTermsAnalysis as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(MOCK_LLM_RESULT);

    render(<DealTermsCard dealId="test" report={buildReport()} darkMode={false} />);
    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Retry'));

    // After retry succeeds, narrative should appear
    await screen.findByTestId('deal-terms-card');
    expect(screen.getByTestId('deal-terms-narrative')).toBeInTheDocument();
    expect(apiPostDealTermsAnalysis).toHaveBeenCalledTimes(2);
  });
});
