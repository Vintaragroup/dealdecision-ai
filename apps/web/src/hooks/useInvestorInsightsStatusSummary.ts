/**
 * useInvestorInsightsStatusSummary
 *
 * Extends useInvestorInsights with automatic background polling so the UI
 * never gets stuck showing a stale "running / queued / stalled" state.
 *
 * Polling rules
 * ─────────────
 * • analysis_status === 'running' OR report_status === 'running'
 *   → poll every 2 s (fast: detect job completion as soon as possible)
 *
 * • Both sides are terminal (succeeded/failed/deterministic_only/ready)
 *   → no polling (stable state; manual Refresh button is sufficient)
 *
 * • Both sides are not_started
 *   → no polling (nothing in flight; user must trigger analysis)
 *
 * • Any other combination (queued, partial, mixed)
 *   → poll every 15 s (slow background heartbeat)
 *
 * Additional guards
 * ─────────────────
 * • Polling is suspended when `document.hidden` is true and resumes (with an
 *   immediate refresh) when the tab becomes visible again.
 * • Polling stops completely when `dealId` is null / undefined.
 * • All intervals are cleared on component unmount.
 *
 * Stall detection
 * ───────────────
 * `isStalled` is true when either side reports 'running' but
 * `status_summary.last_activity_at` has not advanced in > 10 minutes,
 * suggesting the BullMQ worker may have crashed or the Postgres row is stuck.
 */

import { useEffect, useRef } from 'react';
import { useInvestorInsights, type UseInvestorInsightsResult } from './useInvestorInsights';
import type { InvestorInsightsReport } from '../lib/apiClient';

// ─── Constants ────────────────────────────────────────────────────────────────

export const INSIGHTS_POLLING_FAST_MS  = 2_000;
export const INSIGHTS_POLLING_SLOW_MS  = 15_000;
const         STALL_THRESHOLD_MS        = 10 * 60 * 1_000; // 10 minutes

const TERMINAL_ANALYSIS = new Set<string>(['succeeded', 'failed']);
const TERMINAL_REPORT   = new Set<string>(['deterministic_only', 'ready', 'succeeded', 'failed']);

// ─── Types ───────────────────────────────────────────────────────────────────

export type InsightsPollingOpts = {
  /** Override fast-poll interval (default: 2 s). */
  runningIntervalMs?: number;
  /** Override slow-poll interval (default: 15 s). */
  idleIntervalMs?: number;
};

export type UseInsightsStatusSummaryResult = UseInvestorInsightsResult & {
  /**
   * true when analysis_status === 'running' OR report_status === 'running'
   * in the status_summary returned by the API.
   */
  isRunning: boolean;
  /**
   * true when isRunning is true AND last_activity_at has not advanced in
   * more than 10 minutes — suggests a stuck worker or stale DB row.
   */
  isStalled: boolean;
  /**
   * The active polling interval in milliseconds, or null when no polling
   * is in progress (terminal / not_started / tab hidden / no dealId).
   */
  intervalMs: number | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pure function — determines the appropriate polling interval given the current
 * status_summary values.  Null means "no polling required".
 */
export function resolveInsightsPollingInterval(
  report:  InvestorInsightsReport | null,
  dealId:  string | undefined,
  fastMs:  number,
  slowMs:  number,
): number | null {
  if (!dealId) return null;

  const ss = report?.status_summary;
  if (!ss) return null; // no status payload yet; base hook handles initial load

  const a = ss.analysis_status;
  const r = ss.report_status;

  // Fast poll: either side actively running
  if (a === 'running' || r === 'running') return fastMs;

  // Terminal: no more automatic state changes expected
  if (TERMINAL_ANALYSIS.has(a) && TERMINAL_REPORT.has(r)) return null;

  // True not_started: nothing in flight yet
  if (a === 'not_started' && r === 'not_started') return null;

  // Everything else (queued, partial, mixed) — slow background heartbeat
  return slowMs;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useInvestorInsightsStatusSummary(
  dealId: string | undefined,
  opts?: InsightsPollingOpts,
): UseInsightsStatusSummaryResult {
  const fastMs = opts?.runningIntervalMs ?? INSIGHTS_POLLING_FAST_MS;
  const slowMs = opts?.idleIntervalMs    ?? INSIGHTS_POLLING_SLOW_MS;

  // ── Base data hook ────────────────────────────────────────────────────────
  const base = useInvestorInsights(dealId);
  const { report, refresh } = base;

  // ── Refs ─────────────────────────────────────────────────────────────────
  const mountedRef   = useRef(true);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep refresh stable in the interval callback without adding it as a dep.
  const refreshRef   = useRef(refresh);
  refreshRef.current = refresh;

  // ── Computed interval ────────────────────────────────────────────────────
  const intervalMs = resolveInsightsPollingInterval(report, dealId, fastMs, slowMs);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // ── Polling effect ───────────────────────────────────────────────────────
  // Restarts whenever dealId or the resolved interval changes.
  useEffect(() => {
    // Clear any existing timer first.
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!dealId || intervalMs === null) return;

    const startPolling = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (document.hidden) return; // tab not visible; skip until visibilitychange
      intervalRef.current = setInterval(() => {
        if (!mountedRef.current || document.hidden) return;
        void refreshRef.current();
      }, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden — pause polling to avoid wasting requests.
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Tab visible again — refresh immediately then restart polling.
        void refreshRef.current();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [dealId, intervalMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived fields ───────────────────────────────────────────────────────
  const ss = report?.status_summary;
  const isRunning =
    ss?.analysis_status === 'running' || ss?.report_status === 'running';

  const lastActivityAt = ss?.last_activity_at;
  const isStalled =
    isRunning &&
    typeof lastActivityAt === 'string' &&
    lastActivityAt.length > 0 &&
    Date.now() - Date.parse(lastActivityAt) > STALL_THRESHOLD_MS;

  return {
    ...base,
    isRunning,
    isStalled: Boolean(isStalled),
    intervalMs,
  };
}
