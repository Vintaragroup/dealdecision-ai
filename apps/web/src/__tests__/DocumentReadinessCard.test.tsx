/**
 * DocumentReadinessCard.test.tsx
 *
 * Unit tests for DocumentReadinessCard — AI Analysis Tab exclusive.
 * Covers:
 *  1. Collapsed by default (no per-doc rows visible)
 *  2. Toggle expands and shows per-document table
 *  3. Shows blocked_reason and action pills when not ready
 *  4. Shows docs_fingerprint in monospace
 *  5. Dark mode uses non-black text classes (zinc-* tokens, no text-black)
 *
 * Also verifies that InvestorInsightsTab does NOT import DocumentReadinessCard.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { DocumentReadinessCard } from '../components/workspace/analysis/DocumentReadinessCard';

// ─── Mock apiGetDealReadiness ─────────────────────────────────────────────────

vi.mock('../lib/apiClient', () => ({
  apiGetDealReadiness: vi.fn(),
}));

import { apiGetDealReadiness } from '../lib/apiClient';
const mockGetReadiness = vi.mocked(apiGetDealReadiness);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A realistic not-ready readiness response with 2 documents */
function makeNotReadyResponse() {
  return {
    deal_id: 'test-deal',
    version: 'page_understanding_v1',
    ready: false,
    blocked_reason: 'missing_dpu',
    action: { type: 'enqueue_dpu_backfill', deal_id: 'test-deal', version: 'page_understanding_v1' },
    expected_pages_total: 40,
    dpu_rows_total: 12,
    missing_pages_total: 28,
    hard_missing_pages_total: 5,
    docs_fingerprint: 'abc123fp',
    latest_dpu_created_at: '2026-02-15T10:00:00Z',
    documents: [
      {
        document_id: 'doc-aaa',
        title: 'Pitch Deck Slide Deck',
        page_count: 25,
        dpu_rows: 8,
        missing_pages: [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25],
        hard_missing_pages: [3, 5, 7],
      },
      {
        document_id: 'doc-bbb',
        title: 'Financial Model',
        page_count: 15,
        dpu_rows: 4,
        missing_pages: [2, 4],
        hard_missing_pages: [],
      },
    ],
    poll_after_ms: 1500,
  };
}

/** A ready response with no blocked_reason */
function makeReadyResponse() {
  return {
    deal_id: 'test-deal-ready',
    version: 'page_understanding_v1',
    ready: true,
    blocked_reason: null,
    action: null,
    expected_pages_total: 30,
    dpu_rows_total: 30,
    missing_pages_total: 0,
    hard_missing_pages_total: 0,
    docs_fingerprint: 'finready99',
    latest_dpu_created_at: '2026-02-20T12:00:00Z',
    documents: [
      {
        document_id: 'doc-ccc',
        title: 'Ready Deck',
        page_count: 30,
        dpu_rows: 30,
        missing_pages: [],
        hard_missing_pages: [],
      },
    ],
    poll_after_ms: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('DocumentReadinessCard — collapsed by default', () => {
  test('1. collapsed by default: toggle button has aria-expanded=false, no doc rows visible', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal" />);

    // Wait for the fetch to resolve and card to render
    await waitFor(() => {
      expect(screen.getByTestId('readiness-toggle')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('readiness-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // Per-doc table must NOT be visible
    expect(screen.queryByTestId('readiness-doc-table')).toBeNull();
    expect(screen.queryByTestId('readiness-doc-row')).toBeNull();
  });

  test('1b. collapsed by default: summary section is visible without expanding', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-summary')).toBeInTheDocument();
    });

    // Expanded section must NOT be visible
    expect(screen.queryByTestId('readiness-expanded')).toBeNull();
  });
});

describe('DocumentReadinessCard — expand toggle', () => {
  test('2. clicking toggle expands and shows per-document table with both doc rows', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-toggle')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('readiness-toggle');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-doc-table')).toBeInTheDocument();
    });

    // aria-expanded should now be true
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Both doc rows should be present
    const rows = screen.getAllByTestId('readiness-doc-row');
    expect(rows.length).toBe(2);

    // Document titles should be rendered
    expect(screen.getByText('Pitch Deck Slide Deck')).toBeInTheDocument();
    expect(screen.getByText('Financial Model')).toBeInTheDocument();
  });

  test('2b. ready=true response also shows doc rows when expanded', async () => {
    mockGetReadiness.mockResolvedValue(makeReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal-ready" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-toggle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('readiness-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('readiness-doc-table')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('readiness-doc-row');
    expect(rows.length).toBe(1);
    expect(screen.getByText('Ready Deck')).toBeInTheDocument();
  });
});

describe('DocumentReadinessCard — blocked_reason and action pills', () => {
  test('3. shows blocked_reason pill (warning) and action pill (info) when not ready', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-pill-blocked')).toBeInTheDocument();
    });

    const blockedPill = screen.getByTestId('readiness-pill-blocked');
    expect(blockedPill.textContent).toContain('missing_dpu');

    const actionPill = screen.getByTestId('readiness-pill-action');
    expect(actionPill.textContent).toContain('enqueue_dpu_backfill');
  });

  test('3b. shows Ready pill (success) and no blocked/action pills when ready', async () => {
    mockGetReadiness.mockResolvedValue(makeReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal-ready" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-pill-ready')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('readiness-pill-blocked')).toBeNull();
    expect(screen.queryByTestId('readiness-pill-action')).toBeNull();
  });
});

describe('DocumentReadinessCard — docs_fingerprint', () => {
  test('4. docs_fingerprint is shown in the summary section when present', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-summary')).toBeInTheDocument();
    });

    const summary = screen.getByTestId('readiness-summary');
    expect(summary.textContent).toContain('abc123fp');
  });

  test('4b. fingerprint cell uses font-mono styling', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    const { container } = render(<DocumentReadinessCard dealId="test-deal" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-summary')).toBeInTheDocument();
    });

    // Find the element containing the fingerprint and check it has font-mono
    const monoEls = container.querySelectorAll('.font-mono');
    const found = Array.from(monoEls).some((el) => el.textContent?.includes('abc123fp'));
    expect(found).toBe(true);
  });
});

describe('DocumentReadinessCard — dark mode text safety', () => {
  test('5. dark mode renders: uses zinc text classes, does NOT contain text-black', async () => {
    mockGetReadiness.mockResolvedValue(makeNotReadyResponse() as any);

    const { container } = render(<DocumentReadinessCard dealId="test-deal" darkMode={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-summary')).toBeInTheDocument();
    });

    // Collect all class names from all elements
    const allClasses = Array.from(container.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList))
      .join(' ');

    // Must include zinc dark classes
    expect(allClasses).toMatch(/text-zinc-/);

    // Must NOT include bare text-black which would be unreadable in dark mode
    expect(allClasses).not.toContain('text-black');
  });
});

// ─── Isolation check (no test runtime dependency, just FS read) ───────────────

describe('DocumentReadinessCard — stale-but-complete (dpu_stale + missing=0)', () => {
  /**
   * Reproduces the case: missing_pages_total=0 (coverage looks complete in the UI)
   * but blocked_reason="dpu_stale" (the DPU is stale vs the current document fingerprint).
   * Before the fix the UI would show "Ready: Yes" and hide the stale state.
   */
  function makeStaleCompleteResponse() {
    return {
      deal_id: 'test-deal-stale',
      version: 'page_understanding_v1',
      ready: false,
      blocked_reason: 'dpu_stale',
      action: { type: 'enqueue_dpu_backfill', deal_id: 'test-deal-stale', version: 'page_understanding_v1' },
      expected_pages_total: 30,
      dpu_rows_total: 30,
      missing_pages_total: 0,       // ← coverage appears complete
      hard_missing_pages_total: 0,
      docs_fingerprint: 'stale-fp-xyz',
      latest_dpu_created_at: '2026-01-01T00:00:00Z',
      documents: [
        {
          document_id: 'doc-stale',
          title: 'Stale Deck',
          page_count: 30,
          dpu_rows: 30,
          missing_pages: [],
          hard_missing_pages: [],
        },
      ],
      poll_after_ms: 2000,
    };
  }

  test('Coverage label shows "Complete" when missing_pages_total=0', async () => {
    mockGetReadiness.mockResolvedValue(makeStaleCompleteResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal-stale" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-coverage-label')).toBeInTheDocument();
    });

    expect(screen.getByTestId('readiness-coverage-label').textContent).toBe('Complete');
  });

  test('Freshness label shows "Stale" when blocked_reason=dpu_stale', async () => {
    mockGetReadiness.mockResolvedValue(makeStaleCompleteResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal-stale" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-freshness-label')).toBeInTheDocument();
    });

    expect(screen.getByTestId('readiness-freshness-label').textContent).toBe('Stale');
  });

  test('Stale-complete warning message is visible without expanding', async () => {
    mockGetReadiness.mockResolvedValue(makeStaleCompleteResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal-stale" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-stale-complete-warning')).toBeInTheDocument();
    });

    const warning = screen.getByTestId('readiness-stale-complete-warning');
    expect(warning.textContent).toContain('Coverage complete');
    expect(warning.textContent).toContain('DPU is stale');
    expect(warning.textContent).toContain('backfill required');
  });

  test('Stale-complete warning is NOT shown when missing_pages > 0 (only stale, not complete)', async () => {
    const partialStale = {
      ...makeStaleCompleteResponse(),
      missing_pages_total: 5,  // some pages missing — stale AND incomplete, warning should NOT fire
    };
    mockGetReadiness.mockResolvedValue(partialStale as any);

    render(<DocumentReadinessCard dealId="test-deal-stale" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-freshness-label')).toBeInTheDocument();
    });

    // Warning should not appear — different message path (just "Incomplete")
    expect(screen.queryByTestId('readiness-stale-complete-warning')).toBeNull();
  });

  test('Ready=true response shows Coverage=Complete and Freshness=Fresh (no stale warning)', async () => {
    mockGetReadiness.mockResolvedValue(makeReadyResponse() as any);

    render(<DocumentReadinessCard dealId="test-deal-ready" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-coverage-label')).toBeInTheDocument();
    });

    expect(screen.getByTestId('readiness-coverage-label').textContent).toBe('Complete');
    expect(screen.getByTestId('readiness-freshness-label').textContent).toBe('Fresh');
    expect(screen.queryByTestId('readiness-stale-complete-warning')).toBeNull();
  });

  test('Stale reason MetaRow shows stale_diagnostics.stale_reason when dpu_stale and diagnostics present', async () => {
    const responseWithDiagnostics = {
      ...makeStaleCompleteResponse(),
      stale_diagnostics: {
        stale_reason: 'fingerprint_mismatch',
        dpu_fingerprint: 'dpu-fp-old-123',
        docs_fingerprint: 'docs-fp-new-456',
        latest_dpu_created_at: '2026-01-01T00:00:00Z',
        newest_doc_modified_at: null,
        per_doc: [],
      },
    };
    mockGetReadiness.mockResolvedValue(responseWithDiagnostics as any);

    render(<DocumentReadinessCard dealId="test-deal-stale" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-stale-reason-label')).toBeInTheDocument();
    });

    expect(screen.getByTestId('readiness-stale-reason-label').textContent).toBe('fingerprint_mismatch');
  });

  test('Expanding card shows Freshness Diagnostics section when dpu_stale', async () => {
    const responseWithDiagnostics = {
      ...makeStaleCompleteResponse(),
      stale_diagnostics: {
        stale_reason: 'timestamp_old',
        dpu_fingerprint: 'dpu-fp-001',
        docs_fingerprint: 'docs-fp-001',
        latest_dpu_created_at: '2026-01-01T00:00:00Z',
        newest_doc_modified_at: null,
        per_doc: [],
      },
    };
    mockGetReadiness.mockResolvedValue(responseWithDiagnostics as any);

    render(<DocumentReadinessCard dealId="test-deal-stale" />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-toggle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('readiness-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('readiness-freshness-section')).toBeInTheDocument();
    });

    // Reprocess note must be visible
    expect(screen.getByTestId('readiness-freshness-reprocess-note')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-freshness-reprocess-note').textContent).toContain(
      'DPU complete but stale'
    );
    expect(screen.getByTestId('readiness-freshness-reprocess-note').textContent).toContain(
      'reprocessing required'
    );
  });

  test('Freshness section: dark mode uses amber/zinc (no text-black)', async () => {
    const responseWithDiagnostics = {
      ...makeStaleCompleteResponse(),
      stale_diagnostics: {
        stale_reason: 'timestamp_old',
        dpu_fingerprint: 'dpu-fp-001',
        docs_fingerprint: null,
        latest_dpu_created_at: null,
        newest_doc_modified_at: null,
        per_doc: [],
      },
    };
    mockGetReadiness.mockResolvedValue(responseWithDiagnostics as any);

    const { container } = render(<DocumentReadinessCard dealId="test-deal-stale" darkMode={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('readiness-toggle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('readiness-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('readiness-freshness-section')).toBeInTheDocument();
    });

    const allClasses = Array.from(container.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList))
      .join(' ');

    expect(allClasses).not.toContain('text-black');
    expect(allClasses).toMatch(/text-zinc-|text-amber-/);
  });
});

// ─── Isolation check (no test runtime dependency, just FS read) ───────────────

describe('DocumentReadinessCard — scope isolation', () => {
  test('InvestorInsightsTab.tsx does NOT import DocumentReadinessCard', () => {
    const tabPath = resolve(
      __dirname,
      '../components/workspace/InvestorInsightsTab.tsx'
    );
    if (!existsSync(tabPath)) return;
    const src = readFileSync(tabPath, 'utf-8');
    expect(src).not.toContain('DocumentReadinessCard');
  });
});
