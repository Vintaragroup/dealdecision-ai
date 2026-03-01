/**
 * DecisionOverlay.test.tsx
 *
 * Unit tests for DecisionOverlay — AI Analysis Tab exclusive.
 * Covers:
 *  1.  Loading/idle state shows skeleton
 *  2.  not_found state shows message + Regenerate CTA
 *  3.  error state shows error text
 *  4.  GO decision renders badge with data-decision="GO"
 *  5.  CONSIDER decision renders with amber badge
 *  6.  NO_GO decision renders with red badge
 *  7.  Driver bullets render using ONLY strings from rationale_bullets (no invented text)
 *  8.  Empty rationale_bullets → "Why this decision" section absent
 *  9.  missing_critical_terms triggers limitations callout with "not disclosed"
 * 10.  Weak coverage triggers limitations callout
 * 11.  No limitations shown when terms present and coverage is Strong
 * 12.  Verification requests rendered sorted by priority
 * 13.  Regenerate button calls apiRegenerateInvestorInsights
 * 14.  darkMode prop applies dark text classes (no black-on-black)
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import { DecisionOverlay } from '../components/workspace/analysis/DecisionOverlay';
import type { OrchestratorReportResponse } from '../lib/apiClient';

// ─── Mock useOrchestratorReport ───────────────────────────────────────────────

vi.mock('../hooks/useOrchestratorReport', () => ({
  useOrchestratorReport: vi.fn(),
}));

import { useOrchestratorReport } from '../hooks/useOrchestratorReport';
const mockUseOrchestrator = vi.mocked(useOrchestratorReport);

// ─── Mock apiRegenerateInvestorInsights ───────────────────────────────────────

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiRegenerateInvestorInsights: vi.fn(async () => ({ ok: true, deal_id: 'test-deal', enqueued: true })),
    apiGetOrchestratorReport: vi.fn(async () => new Promise<never>(() => {})),
  };
});

import { apiRegenerateInvestorInsights } from '../lib/apiClient';
const mockRegen = vi.mocked(apiRegenerateInvestorInsights);

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function makeResponse(
  label: 'GO' | 'CONSIDER' | 'NO_GO',
  opts: {
    rationale?: string[];
    missing_critical_terms?: string[];
    dci_band?: 'Strong' | 'Good' | 'Partial' | 'Weak';
    dci_score?: number;
    verifications?: Array<{ request: string; priority: 'P0' | 'P1' | 'P2'; why: string }>;
  } = {},
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
        raise_amount: '$2M',
        instrument: 'SAFE',
        valuation_pre: null,
        valuation_post: null,
        missing_critical_terms: opts.missing_critical_terms ?? [],
      },
      document_confidence: {
        score: opts.dci_score ?? 70,
        band: opts.dci_band ?? 'Good',
        notes: [],
      },
      scores: {
        overall_recommendation_score: 72,
        risk_severity_score: 30,
        market_score: { raw: 65, persisted: 65, missing_inputs: [] },
        financial_health_score: { status: 'ok', score: 68, is_proxy: false, missing_sections: [] },
      },
      decision: {
        label,
        confidence_band: 'Medium',
        rationale_bullets: opts.rationale ?? ['Strong early traction', 'Market validated'],
        thresholds_used: { stage: 'Seed', go_min_ors: 60, max_acceptable_risk: 45 },
      },
      segments: {
        risk_verification: {
          verification_requests: opts.verifications ?? [
            { request: 'Confirm ARR figure from financial statements', priority: 'P0', why: 'Revenue claim is unverified' },
            { request: 'Validate team credentials', priority: 'P1', why: 'Founder background not documented' },
          ],
          data_issues: {
            missing_critical_terms: opts.missing_critical_terms ?? [],
            coverage_pct: 72,
            gates_failed: 0,
          },
        },
      },
      diagnostics: { warnings: [], inputs_present: {} },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DecisionOverlay — loading states', () => {
  test('shows skeleton while loading', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'loading', data: null, error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('decision-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('decision-overlay-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('decision-overlay-badge')).toBeNull();
  });

  test('shows skeleton in idle state', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'idle', data: null, error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('decision-overlay-skeleton')).toBeInTheDocument();
  });

  test('shows not_found message and Regenerate button when dealId provided', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'not_found', data: null, error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal-id" />);
    const el = screen.getByTestId('decision-overlay-not-found');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('not yet available');
    expect(screen.getByTestId('regenerate-btn')).toBeInTheDocument();
  });

  test('not_found without dealId does not show Regenerate button', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'not_found', data: null, error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId={undefined} />);
    expect(screen.queryByTestId('regenerate-btn')).toBeNull();
    expect(screen.getByTestId('decision-overlay-not-found')).toBeInTheDocument();
  });

  test('shows error text when fetch fails', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'error', data: null, error: 'Network timeout', refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    const el = screen.getByTestId('decision-overlay-error');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('Network timeout');
  });
});

describe('DecisionOverlay — GO decision', () => {
  test('renders badge with data-decision="GO"', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('GO'), error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    const badge = screen.getByTestId('decision-overlay-badge');
    expect(badge.getAttribute('data-decision')).toBe('GO');
    expect(badge.textContent).toContain('GO');
  });

  test('shows ORS score', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('GO'), error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('decision-overlay-ors').textContent).toBe('72');
  });

  test('shows stage label', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('GO'), error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('decision-overlay-stage').textContent).toContain('Seed');
  });

  test('shows DCI score and band', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('GO', { dci_score: 76, dci_band: 'Good' }), error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    const dciEl = screen.getByTestId('decision-overlay-dci');
    expect(dciEl.textContent).toContain('76');
    expect(dciEl.textContent).toContain('Good');
  });
});

describe('DecisionOverlay — CONSIDER decision', () => {
  test('renders badge with data-decision="CONSIDER"', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('CONSIDER'), error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('decision-overlay-badge').getAttribute('data-decision')).toBe('CONSIDER');
  });
});

describe('DecisionOverlay — NO_GO decision', () => {
  test('renders badge with data-decision="NO_GO"', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('NO_GO'), error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('decision-overlay-badge').getAttribute('data-decision')).toBe('NO_GO');
  });
});

describe('DecisionOverlay — driver bullets', () => {
  test('driver bullets render ONLY the strings from rationale_bullets (no invented text)', () => {
    const bullets = ['Revenue growing 40% QoQ', 'Clear product-market fit signals'];
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO', { rationale: bullets }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    const items = screen.getAllByTestId('driver-bullet');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Revenue growing 40% QoQ');
    expect(items[1].textContent).toBe('Clear product-market fit signals');
  });

  test('caps at 6 driver bullets even if more are present', () => {
    const bullets = Array.from({ length: 10 }, (_, i) => `Bullet ${i + 1}`);
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO', { rationale: bullets }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getAllByTestId('driver-bullet')).toHaveLength(6);
  });

  test('empty rationale_bullets hides the "Why this decision" section', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', { rationale: [] }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.queryByText('Why this decision')).toBeNull();
    expect(screen.queryByTestId('driver-bullet')).toBeNull();
  });
});

describe('DecisionOverlay — data limitations callout', () => {
  test('shows limitations callout when missing_critical_terms present', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', { missing_critical_terms: ['valuation_cap', 'note_maturity'] }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    const callout = screen.getByTestId('limitations-callout');
    expect(callout).toBeInTheDocument();
    expect(callout.textContent).toContain('Not disclosed');
    expect(callout.textContent).toContain('valuation_cap');
    expect(callout.textContent).toContain('note_maturity');
  });

  test('shows limitations callout when coverage band is Weak', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('NO_GO', { dci_band: 'Weak', dci_score: 28 }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    const callout = screen.getByTestId('limitations-callout');
    expect(callout).toBeInTheDocument();
    expect(callout.textContent?.toLowerCase()).toContain('weak');
  });

  test('shows limitations callout when coverage band is Partial', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', { dci_band: 'Partial', dci_score: 45 }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.getByTestId('limitations-callout')).toBeInTheDocument();
  });

  test('does NOT show limitations callout when all terms present and coverage is Strong', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO', { missing_critical_terms: [], dci_band: 'Strong', dci_score: 88 }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.queryByTestId('limitations-callout')).toBeNull();
  });
});

describe('DecisionOverlay — verification requests', () => {
  test('renders verification items', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', {
        verifications: [
          { request: 'Verify ARR from statements', priority: 'P0', why: 'Revenue claim unverified' },
          { request: 'Confirm founder credentials', priority: 'P1', why: 'Undocumented' },
          { request: 'Review cap table', priority: 'P2', why: 'Not provided' },
        ],
      }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    const items = screen.getAllByTestId('verification-item');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0].textContent).toContain('Verify ARR from statements');
  });

  test('P0 items sorted before P1 and P2', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('CONSIDER', {
        verifications: [
          { request: 'Low priority item', priority: 'P2', why: 'Nice to have' },
          { request: 'Critical item', priority: 'P0', why: 'Must verify' },
          { request: 'High priority item', priority: 'P1', why: 'Important' },
        ],
      }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    const items = screen.getAllByTestId('verification-item');
    // First rendered item should be the P0
    expect(items[0].textContent).toContain('Critical item');
  });

  test('no verification section when verifications is empty', () => {
    mockUseOrchestrator.mockReturnValue({
      status: 'ready',
      data: makeResponse('GO', { verifications: [] }),
      error: null,
      refresh: vi.fn(),
    });
    render(<DecisionOverlay dealId="test-deal" />);
    expect(screen.queryByText('What to verify next')).toBeNull();
    expect(screen.queryByTestId('verification-item')).toBeNull();
  });
});

describe('DecisionOverlay — Regenerate CTA', () => {
  test('clicking Regenerate calls apiRegenerateInvestorInsights with the dealId', async () => {
    mockUseOrchestrator.mockReturnValue({ status: 'not_found', data: null, error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="deal-abc-123" />);
    const btn = screen.getByTestId('regenerate-btn');
    await userEvent.click(btn);
    await waitFor(() => expect(mockRegen).toHaveBeenCalledWith('deal-abc-123'));
  });

  test('shows success message after regenerate completes', async () => {
    mockUseOrchestrator.mockReturnValue({ status: 'not_found', data: null, error: null, refresh: vi.fn() });
    render(<DecisionOverlay dealId="deal-abc-123" />);
    const btn = screen.getByTestId('regenerate-btn');
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.queryByTestId('regenerate-btn')).toBeNull();
      expect(screen.getByText(/queued/i)).toBeInTheDocument();
    });
  });
});

describe('DecisionOverlay — darkMode', () => {
  test('darkMode=true applies dark text class on root (no black text on dark bg)', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('GO'), error: null, refresh: vi.fn() });
    const { container } = render(<DecisionOverlay dealId="test-deal" darkMode={true} />);
    const root = container.querySelector('[data-testid="decision-overlay"]');
    // Root should use a gray dark class, not text-black or text-gray-900
    expect(root?.className).not.toContain('text-gray-900');
    expect(root?.className).not.toContain('text-black');
    expect(root?.className).toContain('text-gray-200');
  });

  test('darkMode=false applies light text class', () => {
    mockUseOrchestrator.mockReturnValue({ status: 'ready', data: makeResponse('GO'), error: null, refresh: vi.fn() });
    const { container } = render(<DecisionOverlay dealId="test-deal" darkMode={false} />);
    const root = container.querySelector('[data-testid="decision-overlay"]');
    expect(root?.className).toContain('text-gray-800');
  });
});
