/**
 * useInvestorInsightsStatusSummary.test.ts
 *
 * Tests for the polling hook that adds automatic background refresh to the
 * investor insights data, ensuring the UI never gets stuck in a stale
 * 'running' or 'stalled' state.
 *
 * Coverage:
 *  1. resolveInsightsPollingInterval — pure function unit tests
 *  2. Hook: intervalMs exposed correctly from status_summary
 *  3. Hook: isRunning derived from status_summary
 *  4. Hook: isStalled derived from last_activity_at
 *  5. Hook: polling calls refresh on each tick (fake timers)
 *  6. Hook: no polling when intervalMs is null (terminal / not_started)
 *  7. Hook: polling stops when document.hidden; resumes on visibilitychange
 *  8. Hook: no polling when dealId is undefined
 *  9. Hook: interval restarts when status changes from running → terminal
 */

import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// ── Mock useInvestorInsights ──────────────────────────────────────────────────
vi.mock('../hooks/useInvestorInsights', () => ({
  useInvestorInsights: vi.fn(),
}));

import { useInvestorInsights } from '../hooks/useInvestorInsights';
import {
  useInvestorInsightsStatusSummary,
  resolveInsightsPollingInterval,
  INSIGHTS_POLLING_FAST_MS,
  INSIGHTS_POLLING_SLOW_MS,
} from '../hooks/useInvestorInsightsStatusSummary';
import type { InvestorInsightsReport } from '../lib/apiClient';

const mockUseInsights = vi.mocked(useInvestorInsights);

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReport(overrides?: Partial<InvestorInsightsReport>): InvestorInsightsReport {
  return { status: 'not_started', ...overrides };
}

function makeReportWithSummary(
  analysisStatus: string,
  reportStatus: string,
  lastActivityAt?: string | null,
): InvestorInsightsReport {
  return makeReport({
    status: reportStatus,
    status_summary: {
      analysis_status: analysisStatus as any,
      report_status: reportStatus as any,
      has_existing_render_package: false,
      blocking_reason: null,
      last_activity_at: lastActivityAt ?? null,
      evidence_gate: null,
    },
  });
}

type MockRefresh = ReturnType<typeof vi.fn>;

function makeMockInsightsResult(report: InvestorInsightsReport | null, refresh?: MockRefresh) {
  const mockRefresh = refresh ?? vi.fn().mockResolvedValue(null);
  return {
    status: report ? 'ready' : 'loading',
    report,
    error: null,
    refresh: mockRefresh,
    generate: vi.fn().mockResolvedValue(null),
  } as any;
}

// ── Test 1: resolveInsightsPollingInterval pure function ─────────────────────

describe('resolveInsightsPollingInterval', () => {
  test('returns null when dealId is undefined', () => {
    const report = makeReportWithSummary('not_started', 'not_started');
    expect(resolveInsightsPollingInterval(report, undefined, 2000, 15000)).toBeNull();
  });

  test('returns null when report is null (no status_summary yet)', () => {
    expect(resolveInsightsPollingInterval(null, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns null when status_summary is absent', () => {
    const report = makeReport({ status: 'not_started' }); // no status_summary
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns fastMs when analysis_status is running', () => {
    const report = makeReportWithSummary('running', 'not_started');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBe(2000);
  });

  test('returns fastMs when report_status is running', () => {
    const report = makeReportWithSummary('not_started', 'running');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBe(2000);
  });

  test('returns fastMs when both sides are running', () => {
    const report = makeReportWithSummary('running', 'running');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBe(2000);
  });

  test('returns null when both sides are terminal (succeeded + succeeded)', () => {
    const report = makeReportWithSummary('succeeded', 'succeeded');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns null when both sides are terminal (succeeded + deterministic_only)', () => {
    const report = makeReportWithSummary('succeeded', 'deterministic_only');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns null when both sides are terminal (failed + failed)', () => {
    const report = makeReportWithSummary('failed', 'failed');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns null when both not_started', () => {
    const report = makeReportWithSummary('not_started', 'not_started');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns slowMs for mixed non-terminal non-running state', () => {
    // analysis succeeded but report not_started — unusual but possible
    const report = makeReportWithSummary('succeeded', 'not_started');
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBe(15000);
  });

  test('respects custom fastMs and slowMs', () => {
    const running = makeReportWithSummary('running', 'not_started');
    expect(resolveInsightsPollingInterval(running, 'deal-1', 500, 30000)).toBe(500);

    const mixed = makeReportWithSummary('succeeded', 'not_started');
    expect(resolveInsightsPollingInterval(mixed, 'deal-1', 500, 30000)).toBe(30000);
  });

  // ── is_first_pass_result: keeps polling even when both sides terminal ────

  test('returns fastMs when is_first_pass_result=true even if both terminal', () => {
    const base = makeReportWithSummary('succeeded', 'succeeded');
    const report: InvestorInsightsReport = {
      ...base,
      status_summary: { ...base.status_summary!, is_first_pass_result: true },
    };
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBe(2000);
  });

  test('returns null when is_first_pass_result=false and both terminal', () => {
    const base = makeReportWithSummary('succeeded', 'succeeded');
    const report: InvestorInsightsReport = {
      ...base,
      status_summary: { ...base.status_summary!, is_first_pass_result: false },
    };
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBeNull();
  });

  test('returns fastMs when is_first_pass_result=true and analysis running', () => {
    const base = makeReportWithSummary('running', 'not_started');
    const report: InvestorInsightsReport = {
      ...base,
      status_summary: { ...base.status_summary!, is_first_pass_result: true },
    };
    // analysis_status running already causes fast polling; is_first_pass_result doesn't break it
    expect(resolveInsightsPollingInterval(report, 'deal-1', 2000, 15000)).toBe(2000);
  });
});

// ── Test 2–9: Hook behaviour ─────────────────────────────────────────────────

describe('useInvestorInsightsStatusSummary hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure document.hidden is false (visible tab) for most tests.
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── intervalMs exposed correctly ────────────────────────────────────────

  test('exposes intervalMs = FAST when running', () => {
    const report = makeReportWithSummary('running', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));

    const { result } = renderHook(() =>
      useInvestorInsightsStatusSummary('deal-1'),
    );

    expect(result.current.intervalMs).toBe(INSIGHTS_POLLING_FAST_MS);
  });

  test('exposes intervalMs = null when both terminal', () => {
    const report = makeReportWithSummary('succeeded', 'deterministic_only');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));

    const { result } = renderHook(() =>
      useInvestorInsightsStatusSummary('deal-1'),
    );

    expect(result.current.intervalMs).toBeNull();
  });

  test('exposes intervalMs = SLOW for mixed state', () => {
    const report = makeReportWithSummary('succeeded', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));

    const { result } = renderHook(() =>
      useInvestorInsightsStatusSummary('deal-1'),
    );

    expect(result.current.intervalMs).toBe(INSIGHTS_POLLING_SLOW_MS);
  });

  test('exposes intervalMs = FAST when both terminal but is_first_pass_result=true', () => {
    const base = makeReportWithSummary('succeeded', 'succeeded');
    const report: InvestorInsightsReport = {
      ...base,
      status_summary: { ...base.status_summary!, is_first_pass_result: true },
    };
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));

    const { result } = renderHook(() =>
      useInvestorInsightsStatusSummary('deal-1'),
    );

    expect(result.current.intervalMs).toBe(INSIGHTS_POLLING_FAST_MS);
  });

  // ── isRunning derived field ──────────────────────────────────────────────

  test('isRunning is true when analysis_status = running', () => {
    const report = makeReportWithSummary('running', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isRunning).toBe(true);
  });

  test('isRunning is true when report_status = running', () => {
    const report = makeReportWithSummary('not_started', 'running');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isRunning).toBe(true);
  });

  test('isRunning is false when both terminal', () => {
    const report = makeReportWithSummary('succeeded', 'succeeded');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isRunning).toBe(false);
  });

  test('isRunning is false when report is null', () => {
    mockUseInsights.mockReturnValue(makeMockInsightsResult(null));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isRunning).toBe(false);
  });

  // ── isStalled derived field ──────────────────────────────────────────────

  test('isStalled is true when running and last_activity_at > 10 minutes ago', () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const report = makeReportWithSummary('running', 'running', elevenMinutesAgo);
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isStalled).toBe(true);
  });

  test('isStalled is false when running but last_activity_at is recent', () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const report = makeReportWithSummary('running', 'running', oneMinuteAgo);
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isStalled).toBe(false);
  });

  test('isStalled is false when NOT running (terminal state)', () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const report = makeReportWithSummary('succeeded', 'succeeded', elevenMinutesAgo);
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isStalled).toBe(false);
  });

  test('isStalled is false when last_activity_at is null', () => {
    const report = makeReportWithSummary('running', 'running', null);
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report));
    const { result } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));
    expect(result.current.isStalled).toBe(false);
  });

  // ── Polling: refresh called on each tick ────────────────────────────────

  test('calls refresh on each fast-poll tick when running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    const mockRefresh = vi.fn().mockResolvedValue(null);
    const report = makeReportWithSummary('running', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report, mockRefresh));

    renderHook(() => useInvestorInsightsStatusSummary('deal-1'));

    // Advance two full fast-poll intervals
    await act(async () => {
      vi.advanceTimersByTime(INSIGHTS_POLLING_FAST_MS * 2);
    });

    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  test('does NOT call refresh when intervalMs is null (terminal)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    const mockRefresh = vi.fn().mockResolvedValue(null);
    const report = makeReportWithSummary('succeeded', 'succeeded');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report, mockRefresh));

    renderHook(() => useInvestorInsightsStatusSummary('deal-1'));

    await act(async () => {
      // Advance well past any interval
      vi.advanceTimersByTime(60_000);
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // ── No polling when dealId is undefined ─────────────────────────────────

  test('does not start polling when dealId is undefined', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    const mockRefresh = vi.fn().mockResolvedValue(null);
    mockUseInsights.mockReturnValue(makeMockInsightsResult(null, mockRefresh));

    renderHook(() => useInvestorInsightsStatusSummary(undefined));

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // ── Polling pauses on document.hidden ───────────────────────────────────

  test('does not start polling when document.hidden is true', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    // Mark tab as hidden before rendering
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });

    const mockRefresh = vi.fn().mockResolvedValue(null);
    const report = makeReportWithSummary('running', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report, mockRefresh));

    renderHook(() => useInvestorInsightsStatusSummary('deal-1'));

    await act(async () => {
      vi.advanceTimersByTime(INSIGHTS_POLLING_FAST_MS * 3);
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test('resumes polling when tab becomes visible (visibilitychange)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    // Start hidden
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });

    const mockRefresh = vi.fn().mockResolvedValue(null);
    const report = makeReportWithSummary('running', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report, mockRefresh));

    renderHook(() => useInvestorInsightsStatusSummary('deal-1'));

    // Still hidden — no calls
    await act(async () => { vi.advanceTimersByTime(INSIGHTS_POLLING_FAST_MS); });
    expect(mockRefresh).not.toHaveBeenCalled();

    // Tab becomes visible — fire visibilitychange
    await act(async () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Immediate refresh should fire on visibility restore
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Advance one interval — polling should have resumed
    await act(async () => { vi.advanceTimersByTime(INSIGHTS_POLLING_FAST_MS); });
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  // ── Interval clears on unmount ───────────────────────────────────────────

  test('clears interval on unmount (no calls after unmount)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    const mockRefresh = vi.fn().mockResolvedValue(null);
    const report = makeReportWithSummary('running', 'not_started');
    mockUseInsights.mockReturnValue(makeMockInsightsResult(report, mockRefresh));

    const { unmount } = renderHook(() => useInvestorInsightsStatusSummary('deal-1'));

    // Fire one tick before unmount
    await act(async () => { vi.advanceTimersByTime(INSIGHTS_POLLING_FAST_MS); });
    const callsBeforeUnmount = mockRefresh.mock.calls.length;

    // Unmount
    unmount();

    // Advance again — no further calls after unmount
    await act(async () => { vi.advanceTimersByTime(INSIGHTS_POLLING_FAST_MS * 5); });
    expect(mockRefresh.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
