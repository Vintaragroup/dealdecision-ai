/**
 * InvestorInsightsTab.autoRerunBanner.test.tsx — PR32
 *
 * Verifies that InvestorInsightsTab renders the correct banner copy
 * depending on whether auto-rerun is in flight or the evidence gate is blocked.
 *
 *  1. Blocked + not running  → amber "Blocked by evidence gate" banner
 *  2. Blocked + running      → indigo "Auto-refreshing after OCR improvement" banner
 *                              (amber banner suppressed)
 *  3. Gate passed + running  → generic blue running banner (no auto-refresh copy)
 *  4. Gate passed + terminal → no evidence-gate banner at all
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { InvestorInsightsReport } from '../lib/apiClient';

// ── Mock the API so no real network calls happen ──────────────────────────────
vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights:      vi.fn(async () => ({ status: 'not_started' } as InvestorInsightsReport)),
    apiGenerateInvestorInsights:  vi.fn(async () => ({ ok: true })),
    apiRegenerateInvestorInsights: vi.fn(async () => ({ ok: true, deal_id: 'd1', enqueued: true })),
  };
});

// ── Import AFTER mock is set up ───────────────────────────────────────────────
import { apiGetInvestorInsights } from '../lib/apiClient';
import { InvestorInsightsTab } from '../components/workspace/InvestorInsightsTab';

const mockGet = vi.mocked(apiGetInvestorInsights);

function reportWith(partial: Partial<InvestorInsightsReport>): InvestorInsightsReport {
  return { status: 'deterministic_only', ...partial } as InvestorInsightsReport;
}

// Shared evidence-gate shapes
const GATE_FAILED = { passed: false, blocking_reason: 'EVIDENCE_GATE_LOW_COVERAGE', coverage_pct: 0.42, evidence_count: 3 };
const GATE_PASSED = { passed: true,  blocking_reason: null, coverage_pct: 0.72, evidence_count: 20 };

describe('InvestorInsightsTab — auto-rerun banners (PR32)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  // ── Test 1: blocked + no rerun ──────────────────────────────────────────────
  test('renders amber "Blocked by evidence gate" banner when deterministic_only + gate failed + not running', async () => {
    mockGet.mockResolvedValue(reportWith({
      status: 'deterministic_only',
      render_package: {
        evidence_gate: { ...GATE_FAILED, results: [], metrics: { docs_count: 1, expected_pages_total: 10, coverage_pct: 0.42, evidence_count: 3, hard_missing_pages_total: null } },
      },
      status_summary: {
        analysis_status: 'succeeded',
        report_status:   'deterministic_only',
        has_existing_render_package: true,
        blocking_reason: null,
        last_activity_at: null,
        evidence_gate: GATE_FAILED,
      },
    }));

    render(<InvestorInsightsTab darkMode={false} dealId="d1" />);

    // Amber blocked banner must be visible
    const banner = await screen.findByTestId('evidence-gate-blocked-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Blocked by evidence gate');
    expect(banner.textContent).toContain('OCR backfill will run automatically');

    // Auto-refresh banner must NOT be visible
    expect(screen.queryByTestId('auto-refresh-banner')).toBeNull();
  });

  // ── Test 2: blocked + rerun in flight ──────────────────────────────────────
  test('renders indigo auto-refresh banner and suppresses amber banner when running after gate failure', async () => {
    mockGet.mockResolvedValue(reportWith({
      status: 'deterministic_only',
      render_package: {
        evidence_gate: { ...GATE_FAILED, results: [], metrics: { docs_count: 1, expected_pages_total: 10, coverage_pct: 0.42, evidence_count: 3, hard_missing_pages_total: null } },
      },
      status_summary: {
        analysis_status: 'running',   // <── job is now in-flight
        report_status:   'deterministic_only',
        has_existing_render_package: true,
        blocking_reason: null,
        last_activity_at: new Date().toISOString(),
        evidence_gate: GATE_FAILED,
      },
    }));

    render(<InvestorInsightsTab darkMode={false} dealId="d1" />);

    // Indigo auto-refresh banner must be visible
    const banner = await screen.findByTestId('auto-refresh-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Auto-refreshing after OCR improvement');

    // Amber blocked banner must NOT be visible
    expect(screen.queryByTestId('evidence-gate-blocked-banner')).toBeNull();
  });

  // ── Test 3: gate passed + running → generic running banner only ────────────
  test('shows neither evidence-gate banner when gate passed, even while running', async () => {
    mockGet.mockResolvedValue(reportWith({
      status: 'running',
      render_package: {
        evidence_gate: { ...GATE_PASSED, results: [], metrics: { docs_count: 2, expected_pages_total: 20, coverage_pct: 0.72, evidence_count: 20, hard_missing_pages_total: null } },
      },
      status_summary: {
        analysis_status: 'running',
        report_status:   'running',
        has_existing_render_package: false,
        blocking_reason: null,
        last_activity_at: new Date().toISOString(),
        evidence_gate: GATE_PASSED,
      },
    }));

    render(<InvestorInsightsTab darkMode={false} dealId="d1" />);

    // Wait for the component to settle after the API call
    await screen.findByText(/investor insights/i);

    expect(screen.queryByTestId('evidence-gate-blocked-banner')).toBeNull();
    expect(screen.queryByTestId('auto-refresh-banner')).toBeNull();
  });

  // ── Test 4: gate passed + terminal → no gate banners ──────────────────────
  test('shows no evidence-gate banner when succeeded report with passed gate', async () => {
    mockGet.mockResolvedValue(reportWith({
      status: 'succeeded',
      render_package: {
        evidence_gate: { ...GATE_PASSED, results: [], metrics: { docs_count: 2, expected_pages_total: 20, coverage_pct: 0.72, evidence_count: 20, hard_missing_pages_total: null } },
      },
      status_summary: {
        analysis_status: 'succeeded',
        report_status:   'succeeded',
        has_existing_render_package: true,
        blocking_reason: null,
        last_activity_at: null,
        evidence_gate: GATE_PASSED,
      },
    }));

    render(<InvestorInsightsTab darkMode={false} dealId="d1" />);

    await screen.findByText(/investor insights/i);

    expect(screen.queryByTestId('evidence-gate-blocked-banner')).toBeNull();
    expect(screen.queryByTestId('auto-refresh-banner')).toBeNull();
  });
});
