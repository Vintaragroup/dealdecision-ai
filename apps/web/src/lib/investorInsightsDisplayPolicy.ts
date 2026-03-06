/**
 * investorInsightsDisplayPolicy — pure UI state derivation (PR32).
 *
 * Derives display-layer state from raw InvestorInsightsReport fields so that
 * InvestorInsightsTab renders accurate, non-misleading status copy during and
 * after the PR31 auto-rerun lifecycle.
 *
 * Guaranteed pure: no React, no imports, no side effects.  Easy to unit-test.
 *
 * Key lifecycle scenarios:
 *
 *  A. deterministic_only + gate failed + NOT running
 *     → blocked banner (amber)
 *     → "Blocked by evidence gate — insufficient coverage"
 *     → "OCR backfill will run automatically to improve coverage."
 *
 *  B. deterministic_only + gate failed + IS running
 *     → evidenceGateBannerMode = 'auto_refreshing'
 *     → background running label overridden to "Auto-refreshing after OCR improvement…"
 *     → amber blocked banner suppressed
 *
 *  C. running + stale_dpu flag
 *     → shouldSuppressHardStaleDpu = true (caller shows "Refreshing…" rather than "Stale")
 *
 *  D. report succeeded/complete
 *     → shouldShowRunAnalysisCta = false (no spurious CTA shown)
 *
 *  E. latest report replaced by newer report after auto-rerun
 *     → handled by existing polling infrastructure; no extra logic required here
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Controls which variant (if any) of the evidence gate banner is shown.
 *
 * 'hidden'         — gate passed or report is not deterministic_only; no banner.
 * 'blocked'        — gate failed AND nothing is running; show amber blocked banner.
 * 'auto_refreshing'— gate was failed but a job is now in-flight; show blue refresh banner.
 */
export type EvidenceGateBannerMode = 'hidden' | 'blocked' | 'auto_refreshing';

export type InsightsDisplayInput = {
  /**
   * Prefer report.status_summary.report_status when available (canonical);
   * fall back to report.status for older API responses.
   */
  reportStatus: string | null;

  /**
   * Prefer report.status_summary.evidence_gate when available;
   * fall back to report.render_package.evidence_gate.
   */
  evidenceGate: { passed: boolean; blocking_reason?: string | null } | null;

  /**
   * True when analysis_status === 'running' OR report_status === 'running'
   * in the status_summary (same as hook's isRunning).
   */
  isRunning: boolean;

  /**
   * True when the DPU readiness endpoint returned blocked_reason === 'dpu_stale'.
   * Optional — defaults to false.  Used to derive shouldSuppressHardStaleDpu.
   */
  isStaleDpu?: boolean;
};

export type InsightsDisplayState = {
  /** True when reportStatus === 'deterministic_only' AND evidenceGate.passed === false. */
  isBlockedByEvidenceGate: boolean;

  /**
   * True when a job is in-flight AND the prior report was blocked by the evidence gate.
   * Covers both manual reruns on a blocked report and auto-reruns from OCR improvement.
   * The heuristic is accurate: if something is running AND the previous result was
   * evidence-gate blocked, the running job will re-evaluate the gate on completion.
   */
  isAutoRerunInFlight: boolean;

  /**
   * Semantic alias for isAutoRerunInFlight — use at call sites that specifically
   * want to surface the "refreshing after OCR" narrative.
   */
  isRefreshingAfterOcr: boolean;

  /**
   * True when an investor_insights job is running AND isStaleDpu is true.
   * When true: the caller should show "Refreshing analysis…" rather than the
   * hard amber "Stale" label — the staleness is being addressed.
   */
  shouldSuppressHardStaleDpu: boolean;

  /**
   * True when the "Run Analysis" / "Generate Insights" CTA should be visible.
   *
   * Hidden when:
   *  - a job is already running (would create a duplicate enqueue)
   *  - the latest report already succeeded (no need to rerun)
   */
  shouldShowRunAnalysisCta: boolean;

  /**
   * Controls which variant of the evidence gate banner to render in the UI.
   * See EvidenceGateBannerMode doc above.
   */
  evidenceGateBannerMode: EvidenceGateBannerMode;

  /**
   * Human-readable report status label — avoids exposing raw enum strings
   * (e.g. 'deterministic_only') directly in the UI.
   */
  reportStatusLabel: string;

  /**
   * Copy for the blue "background analysis running" banner.
   * When isAutoRerunInFlight the text is more specific about OCR origin.
   */
  backgroundRunningLabel: string;
};

// ─── Label maps ───────────────────────────────────────────────────────────────

const REPORT_STATUS_LABELS: Record<string, string> = {
  not_started:       'Not started',
  running:           'Running',
  queued:            'Queued',
  deterministic_only:'Deterministic only',
  complete:          'Complete',
  succeeded:         'Complete',
  failed:            'Failed',
  quarantined:       'Quarantined',
};

// ─── Pure derivation ──────────────────────────────────────────────────────────

export function deriveInsightsDisplayState(input: InsightsDisplayInput): InsightsDisplayState {
  const { reportStatus, evidenceGate, isRunning, isStaleDpu = false } = input;

  // ── Core boolean derivations ────────────────────────────────────────────────
  const isBlockedByEvidenceGate =
    reportStatus === 'deterministic_only' &&
    evidenceGate != null &&
    evidenceGate.passed === false;

  // Running AND previously blocked → the running job is a rerun on a gated report.
  const isAutoRerunInFlight    = isRunning && isBlockedByEvidenceGate;
  const isRefreshingAfterOcr   = isAutoRerunInFlight;

  const shouldSuppressHardStaleDpu = isRunning && isStaleDpu;

  // CTA is shown when there is no active job and the latest result is not a success.
  const isTerminalSuccess =
    reportStatus === 'complete' || reportStatus === 'succeeded';
  const shouldShowRunAnalysisCta =
    !isRunning && !isTerminalSuccess &&
    (reportStatus === null ||
      reportStatus === 'not_started' ||
      reportStatus === 'failed'      ||
      reportStatus === 'quarantined');

  // ── Banner mode ─────────────────────────────────────────────────────────────
  let evidenceGateBannerMode: EvidenceGateBannerMode = 'hidden';
  if (isBlockedByEvidenceGate) {
    evidenceGateBannerMode = isAutoRerunInFlight ? 'auto_refreshing' : 'blocked';
  }

  // ── Labels ──────────────────────────────────────────────────────────────────
  const reportStatusLabel =
    REPORT_STATUS_LABELS[reportStatus ?? ''] ?? (reportStatus ?? 'Unknown');

  const backgroundRunningLabel = isAutoRerunInFlight
    ? 'Auto-refreshing after OCR improvement — checking for updates…'
    : 'Analysis running — checking for updates…';

  return {
    isBlockedByEvidenceGate,
    isAutoRerunInFlight,
    isRefreshingAfterOcr,
    shouldSuppressHardStaleDpu,
    shouldShowRunAnalysisCta,
    evidenceGateBannerMode,
    reportStatusLabel,
    backgroundRunningLabel,
  };
}
