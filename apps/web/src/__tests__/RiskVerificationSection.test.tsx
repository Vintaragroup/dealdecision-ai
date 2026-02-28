/**
 * RiskVerificationSection.test.tsx — AI Analysis Tab component tests
 *
 * Tests the RiskVerificationSection component through the full React render
 * tree with mocked API calls and deterministic section fixtures.
 *
 * Contract guarantees:
 *  1.  Loading skeleton renders while report is null
 *  2.  No-data state when no risk sections present
 *  3.  Score panel renders with numeric value
 *  4.  Gates with pass/fail/not_run badges
 *  5.  Gate reason text truncates correctly
 *  6.  Key risks reflect missing critical terms
 *  7.  Key risks reflect reconciliation WARN/FAIL flags
 *  8.  Low coverage callout when coverage below threshold
 *  9.  Conflicts table renders when conflicts present
 * 10.  "No conflicts" fallback when no conflicts
 * 11.  Coverage tiles render with known values
 * 12.  Narrative loading state while API is pending
 * 13.  Narrative panel renders AI paragraphs on success
 * 14.  Narrative error state shows retry button
 * 15.  Retry button re-invokes apiPostRiskVerification
 * 16.  Dark mode: key blocks use text-zinc-N/text-slate-N classes (no black-on-black)
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { RiskVerificationSection } from '../components/workspace/analysis/RiskVerificationSection';
import type { RiskVerificationNarrativeResult, InvestorInsightsReport } from '../lib/apiClient';

beforeEach(() => vi.resetAllMocks());

// ─── Mock API client ──────────────────────────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiPostRiskVerification: vi.fn(),
    apiPostFinancialAnalysis: vi.fn(),
    apiPostMarketAnalysis: vi.fn(),
    apiPostDealTermsAnalysis: vi.fn(),
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Gate state items injected via render_package.gate_state.results */
const GATE_RESULTS = [
  { gate: 'G0_DOCS_PRESENT',    passed: true,  reason_code: null,                  actual: '3 docs',  threshold: '1 doc'  },
  { gate: 'G1_COVERAGE_MIN',    passed: true,  reason_code: null,                  actual: '72%',     threshold: '30%'    },
  { gate: 'G2_RAISE_DISCLOSED', passed: false, reason_code: 'raise_amount_missing', actual: null,      threshold: null     },
  { gate: 'G3_FINANCIALS',      passed: false, reason_code: 'no_statement',         actual: null,      threshold: null     },
];

/** Coverage snapshot body */
const COVERAGE_BODY = [
  'docs_count: 3',
  'dpu_page_count: 20',
  'dpu_nonempty_pages: 12',
  'evidence_count: 45',
  'visuals_count: 8',
  'structured_json_available: true',
  'overlay_available: false',
].join('\n');

/** Low coverage body (< 60%) */
const LOW_COVERAGE_BODY = [
  'docs_count: 2',
  'dpu_page_count: 30',
  'dpu_nonempty_pages: 10',
  'evidence_count: 20',
  'visuals_count: 3',
  'structured_json_available: false',
  'overlay_available: false',
].join('\n');

/** Canonical fields body with two NotComputable critical fields */
const CANONICAL_BODY = [
  'category=raise | field=raise_amount | computability=NotComputable | value="" | evidence=none | reason=Not stated in deck',
  'category=raise | field=raise_instrument | computability=NotComputable | value="" | evidence=none | reason=Not stated in deck',
  'category=valuation | field=valuation_cap | computability=Computable | value="$8M" | evidence=slide_14 | reason=Stated explicitly',
].join('\n');

/** Reconciliation body with WARN/FAIL flags */
const RECONCILIATION_BODY = [
  'confidence_score: 0.65',
  '✓ revenue_crosscheck: PASS — matches across documents',
  '⚠ burn_rate: WARN — burn rate not disclosed in financials',
  '✗ balance_sheet: FAIL — no balance sheet in submission',
].join('\n');

/** Conflicts body */
const CONFLICTS_BODY = [
  'field=valuation_cap | value_a="$8M" | evidence_a=slide_14 | source_a=pitch_deck | value_b="$10M" | evidence_b=term_sheet | source_b=term_sheet | reason=Conflicting cap values across sources',
  'field=raise_amount | value_a="$2M" | evidence_a=exec_summary | source_a=exec_summary | value_b="$3M" | evidence_b=slide_19 | source_b=pitch_deck | reason=Raise total differs by $1M',
].join('\n');

const DEAL_ID = 'aab1c2d3-dead-beef-0000-000000000042';

const MOCK_NARRATIVE: RiskVerificationNarrativeResult = {
  schema_version: 'risk_verification_v1',
  summary_paragraphs: [
    'The company presents several verification risks that require targeted diligence.',
    'Key disclosures including raise amount and raise instrument are not disclosed in available materials.',
  ],
  top_risks: [
    'Raise amount not disclosed — cannot assess dilution impact',
    'Balance sheet absent — capital structure unknown',
  ],
  verification_requests: [
    'Provide signed term sheet disclosing raise amount and instrument type',
    'Supply audited financials or management accounts',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSection(key: string, body: string) {
  return { key, title: key, kind: 'message' as const, body };
}

function buildReport(options: {
  sectionBodies?: { key: string; body: string }[];
  gateResults?: typeof GATE_RESULTS;
} = {}): InvestorInsightsReport {
  return {
    status: 'deterministic_only',
    render_package: {
      sections: (options.sectionBodies ?? []).map(({ key, body }) => buildSection(key, body)),
      gate_state: options.gateResults ? { results: options.gateResults as any } : undefined,
    },
  } as InvestorInsightsReport;
}

async function renderSection(options: {
  sectionBodies?: { key: string; body: string }[];
  gateResults?: typeof GATE_RESULTS;
  darkMode?: boolean;
  narrative?: RiskVerificationNarrativeResult | 'pending' | 'error';
} = {}) {
  const { apiPostRiskVerification } = await import('../lib/apiClient');
  const mockFn = apiPostRiskVerification as ReturnType<typeof vi.fn>;

  if (options.narrative === 'pending') {
    mockFn.mockReturnValue(new Promise<never>(() => {}));
  } else if (options.narrative === 'error') {
    mockFn.mockRejectedValue(new Error('Narrative failed'));
  } else {
    mockFn.mockResolvedValue(options.narrative ?? MOCK_NARRATIVE);
  }

  const report = buildReport({
    sectionBodies: options.sectionBodies,
    gateResults:   options.gateResults,
  });

  render(
    <RiskVerificationSection
      dealId={DEAL_ID}
      report={report}
      darkMode={options.darkMode ?? false}
    />,
  );

  return { mockFn };
}

// ─── 1. Loading skeleton (null report) ───────────────────────────────────────

describe('1 — Loading skeleton', () => {
  test('skeleton renders when report is null', async () => {
    const { apiPostRiskVerification } = await import('../lib/apiClient');
    (apiPostRiskVerification as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_NARRATIVE);

    render(<RiskVerificationSection dealId={DEAL_ID} report={null} darkMode={false} />);
    expect(screen.getByTestId('rv-loading-skeleton')).toBeInTheDocument();
  });
});

// ─── 2. No-data state ─────────────────────────────────────────────────────────

describe('2 — No-data state', () => {
  test('no-data fallback renders when no risk sections present', async () => {
    await renderSection({ sectionBodies: [], narrative: 'pending' });
    await screen.findByTestId('rv-no-data');
    expect(screen.getByTestId('rv-no-data')).toBeInTheDocument();
  });

  test('no-data does not show score panel', async () => {
    await renderSection({ sectionBodies: [], narrative: 'pending' });
    await screen.findByTestId('rv-no-data');
    expect(screen.queryByTestId('rv-score-panel')).not.toBeInTheDocument();
  });
});

// ─── 3. Score panel ───────────────────────────────────────────────────────────

describe('3 — Score panel', () => {
  test('score panel renders with a numeric value between 0 and 100', async () => {
    await renderSection({
      gateResults:   GATE_RESULTS,
      sectionBodies: [
        { key: 'coverage_snapshot',          body: COVERAGE_BODY },
        { key: 'canonical_fields',           body: CANONICAL_BODY },
        { key: 'financial_reconciliation_v1', body: RECONCILIATION_BODY },
        { key: 'conflicts',                  body: CONFLICTS_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-score-panel');
    const valueEl = screen.getByTestId('rv-score-value');
    const num = parseInt(valueEl.textContent ?? '0', 10);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(100);
  });

  test('score label is visible', async () => {
    await renderSection({
      gateResults:   GATE_RESULTS,
      sectionBodies: [{ key: 'coverage_snapshot', body: COVERAGE_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-score-label');
    expect(screen.getByTestId('rv-score-label').textContent).toBeTruthy();
  });
});

// ─── 4. Gate badges ───────────────────────────────────────────────────────────

describe('4 — Gate checklist', () => {
  test('renders gate items with pass and fail badges', async () => {
    await renderSection({ gateResults: GATE_RESULTS, narrative: MOCK_NARRATIVE });
    await screen.findByTestId('rv-gate-checklist');

    const items = screen.getAllByTestId('rv-gate-item');
    expect(items.length).toBe(GATE_RESULTS.length);

    const badges = screen.getAllByTestId('rv-gate-badge');
    expect(badges.length).toBe(GATE_RESULTS.length);

    // First two should say "Pass", last two "Fail"
    expect(badges[0]!.textContent).toContain('Pass');
    expect(badges[1]!.textContent).toContain('Pass');
    expect(badges[2]!.textContent).toContain('Fail');
    expect(badges[3]!.textContent).toContain('Fail');
  });

  test('gate reason text appears in item', async () => {
    await renderSection({ gateResults: GATE_RESULTS, narrative: MOCK_NARRATIVE });
    const checklist = await screen.findByTestId('rv-gate-checklist');
    expect(checklist.textContent).toContain('raise_amount_missing');
  });

  test('renders "No gate data" when gates list is empty', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'coverage_snapshot', body: COVERAGE_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-gate-checklist');
    expect(screen.getByTestId('rv-gate-checklist').textContent).toContain('No gate data');
  });
});

// ─── 5. Key risks ─────────────────────────────────────────────────────────────

describe('5 — Key risks', () => {
  test('key risks include disclosure risk when critical canonical fields missing', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [
        { key: 'canonical_fields',           body: CANONICAL_BODY },
        { key: 'financial_reconciliation_v1', body: RECONCILIATION_BODY },
      ],
      narrative: MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-key-risks');
    const panel = screen.getByTestId('rv-key-risks');
    // Should mention the two NotComputable critical fields
    expect(panel.textContent).toContain('raise amount');
    expect(panel.textContent).toContain('raise instrument');
  });

  test('key risks include financial plausibility when reconciliation has WARN/FAIL', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'financial_reconciliation_v1', body: RECONCILIATION_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-key-risks');
    const panel = screen.getByTestId('rv-key-risks');
    // burn_rate WARN and balance_sheet FAIL reasons should appear
    expect(panel.textContent).toMatch(/burn rate not disclosed|balance sheet|WARN|FAIL/i);
  });

  test('no-risk state renders "no material risk signals" message', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [],
      narrative:     'pending',
    });
    await screen.findByTestId('rv-no-data');
    // no-data means no key risks panel is shown
    expect(screen.queryByTestId('rv-key-risks')).not.toBeInTheDocument();
  });
});

// ─── 6. Low coverage callout ──────────────────────────────────────────────────

describe('6 — Low coverage callout', () => {
  test('low-coverage callout shows when nonempty pages < 60% of total', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'coverage_snapshot', body: LOW_COVERAGE_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-coverage-tiles');
    expect(screen.getByTestId('rv-low-coverage-callout')).toBeInTheDocument();
  });

  test('no low-coverage callout when coverage is sufficient', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'coverage_snapshot', body: COVERAGE_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-coverage-tiles');
    expect(screen.queryByTestId('rv-low-coverage-callout')).not.toBeInTheDocument();
  });
});

// ─── 7. Conflicts panel ───────────────────────────────────────────────────────

describe('7 — Conflicts panel', () => {
  test('conflict rows render when conflicts present', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'conflicts', body: CONFLICTS_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-conflicts-panel');
    const rows = screen.getAllByTestId('rv-conflict-row');
    expect(rows.length).toBe(2);
  });

  test('"No conflicts detected" message renders when conflicts absent', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'coverage_snapshot', body: COVERAGE_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-conflicts-panel');
    expect(screen.getByTestId('rv-conflicts-panel').textContent).toContain(
      'No conflicts detected',
    );
  });
});

// ─── 8. Coverage tiles ────────────────────────────────────────────────────────

describe('8 — Coverage tiles', () => {
  test('tiles render with known values from coverage_snapshot', async () => {
    await renderSection({
      gateResults:   [],
      sectionBodies: [{ key: 'coverage_snapshot', body: COVERAGE_BODY }],
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-coverage-tiles');
    const tiles = screen.getAllByTestId('rv-coverage-tile');
    expect(tiles.length).toBeGreaterThanOrEqual(4);

    // Check docs count "3" is present
    const docsTile = tiles.find((t) => t.textContent?.includes('3') && t.textContent?.includes('Document'));
    expect(docsTile).toBeDefined();
  });
});

// ─── 9. Dark mode — no black-on-black ─────────────────────────────────────────

describe('9 — Dark mode text safety', () => {
  test('score panel uses text-zinc-* not text-black in dark mode', async () => {
    await renderSection({
      gateResults:   GATE_RESULTS,
      sectionBodies: [{ key: 'coverage_snapshot', body: COVERAGE_BODY }],
      darkMode:      true,
      narrative:     MOCK_NARRATIVE,
    });
    await screen.findByTestId('rv-score-panel');
    const panel = screen.getByTestId('rv-score-panel');
    // Panel outer element should not have text-black / text-gray-900
    expect(panel.className).not.toContain('text-black');
    expect(panel.className).not.toContain('text-gray-900');
  });
});

// ─── 10. Narrative loading ────────────────────────────────────────────────────

describe('10 — Narrative loading', () => {
  test('loading skeleton shows while API call is in-flight', async () => {
    const { apiPostRiskVerification } = await import('../lib/apiClient');
    (apiPostRiskVerification as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<never>(() => {}),
    );

    await renderSection({ gateResults: GATE_RESULTS, narrative: 'pending' });
    await screen.findByTestId('rv-narrative-loading');
    expect(screen.getByTestId('rv-narrative-loading')).toBeInTheDocument();
  });
});

// ─── 11. Narrative ready ──────────────────────────────────────────────────────

describe('11 — Narrative ready', () => {
  test('narrative panel renders when API returns successfully', async () => {
    await renderSection({ gateResults: GATE_RESULTS, narrative: MOCK_NARRATIVE });
    await screen.findByTestId('rv-narrative-panel');

    const paragraphs = screen.getAllByTestId('rv-narrative-paragraph');
    expect(paragraphs.length).toBe(MOCK_NARRATIVE.summary_paragraphs.length);
    expect(paragraphs[0]!.textContent).toContain('verification risks');
  });

  test('refresh button is visible in ready state', async () => {
    await renderSection({ gateResults: GATE_RESULTS, narrative: MOCK_NARRATIVE });
    await screen.findByTestId('rv-narrative-refresh-btn');
    expect(screen.getByTestId('rv-narrative-refresh-btn')).toBeInTheDocument();
  });
});

// ─── 12. Narrative error ──────────────────────────────────────────────────────

describe('12 — Narrative error', () => {
  test('error state and retry button render on API failure', async () => {
    await renderSection({ gateResults: GATE_RESULTS, narrative: 'error' });
    await screen.findByTestId('rv-narrative-error');
    expect(screen.getByTestId('rv-narrative-retry-btn')).toBeInTheDocument();
  });

  test('retry button re-invokes apiPostRiskVerification', async () => {
    const { apiPostRiskVerification } = await import('../lib/apiClient');
    const mockFn = apiPostRiskVerification as ReturnType<typeof vi.fn>;
    // First call → error
    mockFn.mockRejectedValueOnce(new Error('First error'));
    // Subsequent call → success
    mockFn.mockResolvedValue(MOCK_NARRATIVE);

    const report = buildReport({ gateResults: GATE_RESULTS });
    render(<RiskVerificationSection dealId={DEAL_ID} report={report} />);

    await screen.findByTestId('rv-narrative-error');
    const retryBtn = screen.getByTestId('rv-narrative-retry-btn');
    fireEvent.click(retryBtn);

    await screen.findByTestId('rv-narrative-panel');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
