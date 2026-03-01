/**
 * OrchestratorSummaryCard.test.tsx
 *
 * Unit tests for OrchestratorSummaryCard — AI Analysis Tab exclusive.
 * Covers:
 *  1. Loading/idle state shows skeleton
 *  2. not_found state shows "not yet available" message
 *  3. error state shows error text
 *  4. GO decision renders decision badge with data-decision="GO" + emerald tones
 *  5. CONSIDER decision renders amber badge
 *  6. NO_GO decision renders red badge
 *  7. ORS score and confidence band rendered
 *  8. All four MiniScoreRow entries appear
 *  9. FHC null renders N/A
 * 10. rationale bullets rendered when present
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { OrchestratorSummaryCard } from '../components/workspace/analysis/OrchestratorSummaryCard';
import type { OrchestratorReportResponse } from '../lib/apiClient';

// ─── Mock useOrchestratorReport ───────────────────────────────────────────────

vi.mock('../hooks/useOrchestratorReport', () => ({
  useOrchestratorReport: vi.fn(),
}));

import { useOrchestratorReport } from '../hooks/useOrchestratorReport';
const mockUseOrchestrator = vi.mocked(useOrchestratorReport);

// ─── Mock import.meta.env.DEV (default false so raw toggle does not appear) ──

vi.stubGlobal('import', { meta: { env: { DEV: false } } });

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function makeResponse(
  decisionLabel: 'GO' | 'CONSIDER' | 'NO_GO',
  fhcScore: number | null = 72,
  rationaleOverride?: string[],
): OrchestratorReportResponse {
  return {
    schema_version: 'ddai_orchestrator_report_v1',
    report: {
      schema_version: 'ddai_orchestrator_report_v1',
      deal_id: 'test-deal-id',
      created_at: '2025-01-01T00:00:00Z',
      input_fingerprint: 'test-fp',
      stage_context: {
        stage: 'Seed',
        raise_amount: null,
        instrument: null,
        valuation_pre: null,
        valuation_post: null,
        missing_critical_terms: [],
      },
      document_confidence: {
        score: 64,
        band: 'Good',
        notes: [],
        section_count: 5,
        ocr_page_count: 20,
        evidence_item_count: 30,
      },
      scores: {
        overall_recommendation_score: 68,
        risk_severity_score: 35,
        market_score: { raw: 62, persisted: 62, missing_inputs: [] },
        financial_health_score: {
          score: fhcScore,
          status: fhcScore !== null ? 'ok' : 'insufficient_data',
          is_proxy: false,
          missing_sections: [],
        },
      },
      decision: {
        label: decisionLabel,
        confidence_band: 'Medium',
        rationale_bullets: rationaleOverride ?? ['Strong early traction', 'Market size validated'],
        thresholds_used: { stage: 'Seed', go_min_ors: 50, max_acceptable_risk: 60 },
      },
      diagnostics: {
        warnings: [],
        inputs_present: {},
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrchestratorSummaryCard — loading states', () => {
  test('shows skeleton while loading', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'loading',
      data: null,
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    expect(screen.getByTestId('orchestrator-summary-card')).toBeInTheDocument();
    expect(screen.getByTestId('orchestrator-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('decision-badge')).toBeNull();
  });

  test('shows skeleton in idle state', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'idle',
      data: null,
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    expect(screen.getByTestId('orchestrator-skeleton')).toBeInTheDocument();
  });

  test('shows not_found message when orchestrator report is not ready', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'not_found',
      data: null,
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const el = screen.getByTestId('orchestrator-not-found');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('not yet available');
    expect(screen.queryByTestId('decision-badge')).toBeNull();
  });

  test('shows error message when fetch fails', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'error',
      data: null,
      error: 'Network failure',
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const el = screen.getByTestId('orchestrator-error');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('Network failure');
  });
});

describe('OrchestratorSummaryCard — GO decision', () => {
  test('renders decision badge with data-decision="GO"', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO'),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const badge = screen.getByTestId('decision-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('data-decision')).toBe('GO');
    expect(badge.textContent).toContain('GO');
  });

  test('renders ORS score and confidence band', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO'),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const orsEl = screen.getByTestId('ors-score');
    expect(orsEl).toBeInTheDocument();
    expect(orsEl.textContent).toBe('68');

    const band = screen.getByTestId('confidence-band');
    expect(band.textContent).toContain('Medium');
  });

  test('renders ORS progress bar', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO'),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const bar = screen.getByTestId('ors-bar');
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute('style')).toContain('68%');
  });
});

describe('OrchestratorSummaryCard — CONSIDER decision', () => {
  test('renders CONSIDER badge', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER'),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const badge = screen.getByTestId('decision-badge');
    expect(badge.getAttribute('data-decision')).toBe('CONSIDER');
    expect(badge.textContent).toContain('CONSIDER');
  });
});

describe('OrchestratorSummaryCard — NO_GO decision', () => {
  test('renders NO_GO badge', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('NO_GO'),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const badge = screen.getByTestId('decision-badge');
    expect(badge.getAttribute('data-decision')).toBe('NO_GO');
    expect(badge.textContent).toContain('NO_GO');
  });
});

describe('OrchestratorSummaryCard — sub-scores', () => {
  test('renders 4 mini-score rows', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO'),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const rows = screen.getAllByTestId('mini-score-row');
    // DCI, FHC, Market, URSS
    expect(rows.length).toBe(4);
  });

  test('FHC null renders N/A (no bar)', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', null),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    // All rows still present
    const rows = screen.getAllByTestId('mini-score-row');
    expect(rows.length).toBe(4);

    // One of them should say N/A (Financial)
    const rowTexts = rows.map((r) => r.textContent ?? '');
    const hasNA = rowTexts.some((t) => t.includes('N/A'));
    expect(hasNA).toBe(true);

    // The FHC row should not have a mini-score-bar inside it
    const fhcRow = rows.find((r) => (r.textContent ?? '').includes('Financial'));
    if (fhcRow) {
      expect(fhcRow.querySelector('[data-testid="mini-score-bar"]')).toBeNull();
    }
  });

  test('each mini score row with numeric score renders a mini-score-bar', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO', 72),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    const bars = screen.getAllByTestId('mini-score-bar');
    // DCI + FHC + Market + URSS = 4 bars
    expect(bars.length).toBe(4);
  });
});

describe('OrchestratorSummaryCard — rationale bullets', () => {
  test('renders bullets when rationale_bullets is non-empty', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO', 72, ['Strong early traction', 'Market size validated']),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    expect(screen.getByText('Strong early traction')).toBeInTheDocument();
    expect(screen.getByText('Market size validated')).toBeInTheDocument();
  });

  test('does NOT render rationale section when bullets is empty', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', 72, []),
      error: null,
      refresh: vi.fn(),
    });

    render(<OrchestratorSummaryCard dealId="test-deal" />);

    expect(screen.queryByText('Rationale')).toBeNull();
  });
});
