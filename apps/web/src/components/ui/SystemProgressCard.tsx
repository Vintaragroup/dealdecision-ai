/**
 * SystemProgressCard — Approved DealDecisionAI system progress pattern.
 *
 * This is the canonical UI template for long-running AI/system tasks in DealDecisionAI:
 * re-run analysis, document extraction, report generation, evidence processing,
 * scoring refresh, and any future background jobs that need inline progress feedback.
 *
 * Design rules (do not change without design review):
 *   - Compact floating card, solid opaque dark background (#07090d in dark mode)
 *   - Premium border / deep shadow — uses inline styles to escape parent compositing layers
 *   - Visible progress bar driven by a smooth elapsed-time estimator (never coarse backend pct)
 *   - Stage-based institutional narration (no "AI is thinking" copy)
 *   - Running / success / failure share identical visual footprint (no layout shift on complete)
 */

import React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SystemProgressStatus = 'idle' | 'running' | 'success' | 'failed';

/**
 * Stage keys used to select institutional narration copy.
 * Extend this union when adding new pipeline task types.
 */
export type SystemProgressStageKey =
  | 'starting'
  | 'queueing'
  | 'documents'
  | 'extraction'
  | 'reconciliation'
  | 'scoring'
  | 'refresh'
  | 'complete'
  | 'failed';

export interface SystemProgressCardProps {
  /** Dark/light theme. Defaults to false (light). */
  darkMode?: boolean;
  /** Current status of the background task. */
  status: SystemProgressStatus;
  /**
   * Smooth 0–100 progress value.
   * Must be driven by an elapsed-time estimator in the consumer, NOT directly from a
   * coarse backend progressPct (which can jump to 40% immediately for "running" status).
   */
  progress: number;
  /**
   * The action verb for the running state, e.g. "Re-running", "Generating report",
   * "Extracting documents". Shown as the primary line label.
   */
  title: string;
  /**
   * Optional label for the success state primary line.
   * Defaults to "Complete".
   */
  successTitle?: string;
  /** Optional override for the stage label chip. Derived from progress if omitted. */
  stageLabel?: string;
  /** Optional override for the narration message. Derived from stage if omitted. */
  message?: string;
  /**
   * Positioning context.
   * - "header" (default): absolute-positioned below a header button (right-aligned).
   * - "inline": renders as a normal block-level element.
   */
  anchor?: 'header' | 'inline';
  /** Error message shown in the failed state. Falls back to generic failed copy. */
  errorMessage?: string;
  /** Optional dismiss callback. Not currently wired to a close button — reserved for future use. */
  onDismiss?: () => void;
}

// ─── Stage copy map ───────────────────────────────────────────────────────────

/**
 * Institutional narration for each pipeline stage.
 * Tone: evidence-driven, underwriting-focused, concise. No AI hype copy.
 */
export const SYSTEM_PROGRESS_STAGE_COPY: Record<
  SystemProgressStageKey,
  { label: string; message: string }
> = {
  starting: {
    label: 'Initializing analysis',
    message: 'Preparing the underwriting workspace for a fresh review.',
  },
  queueing: {
    label: 'Queueing analysis job',
    message: 'Scheduling the evidence extraction pipeline.',
  },
  documents: {
    label: 'Processing documents',
    message: 'Reviewing uploaded source materials and deal context.',
  },
  extraction: {
    label: 'Extracting evidence',
    message: 'Identifying financial, market, team, and transaction signals.',
  },
  reconciliation: {
    label: 'Reconciling signals',
    message: 'Cross-checking deal claims against extracted supporting evidence.',
  },
  scoring: {
    label: 'Updating recommendation',
    message: 'Recalculating conviction, readiness, and evidence confidence.',
  },
  refresh: {
    label: 'Refreshing workspace',
    message: 'Updating diagnostics and the investment decision view.',
  },
  complete: {
    label: 'Analysis updated',
    message: 'Workspace refreshed with the latest underwriting view.',
  },
  failed: {
    label: 'Analysis failed',
    message: 'Previous analysis remains available. You can retry the rerun.',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a smooth 0–99 progress value to a stage key.
 * Designed to align with the elapsed-time progress estimator bands.
 */
export function stageKeyFromProgress(pct: number): SystemProgressStageKey {
  if (pct < 12) return 'starting';
  if (pct < 22) return 'queueing';
  if (pct < 38) return 'documents';
  if (pct < 54) return 'extraction';
  if (pct < 68) return 'reconciliation';
  if (pct < 82) return 'scoring';
  return 'refresh';
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SystemProgressCard
 *
 * Compact floating status card for long-running system tasks.
 * See module JSDoc for design rules and usage context.
 */
export function SystemProgressCard({
  darkMode = false,
  status,
  progress,
  title,
  successTitle = 'Complete',
  stageLabel: stageLabelProp,
  message: messageProp,
  anchor = 'header',
  errorMessage,
}: SystemProgressCardProps) {
  const isRunning = status === 'running';
  const isSuccess = status === 'success';
  const isFailure = status === 'failed';

  // Clamp progress; success always shows full bar, failure freezes where it stopped.
  const pct = isSuccess ? 100 : Math.max(4, Math.min(99, progress));

  // Derive stage copy unless caller provides overrides.
  const stageKey: SystemProgressStageKey = isSuccess
    ? 'complete'
    : isFailure
      ? 'failed'
      : stageKeyFromProgress(pct);
  const stageCopy = SYSTEM_PROGRESS_STAGE_COPY[stageKey];
  const stageLabel = stageLabelProp ?? stageCopy.label;
  const stageMessage = messageProp ?? stageCopy.message;

  // Color tokens — same set for running / success / failure.
  const activeTone = isFailure
    ? (darkMode ? 'text-rose-300' : 'text-rose-700')
    : isSuccess
      ? (darkMode ? 'text-emerald-300' : 'text-emerald-700')
      : (darkMode ? 'text-blue-300' : 'text-blue-600');
  const barColor = isFailure ? 'bg-rose-400' : isSuccess ? 'bg-emerald-400' : 'bg-blue-400';
  const headingCls = darkMode ? 'text-gray-100' : 'text-gray-900';
  const mutedCls = darkMode ? 'text-gray-400' : 'text-gray-500';
  const trackCls = darkMode ? 'bg-white/15' : 'bg-gray-100';

  // Inline style: bypasses Tailwind JIT uncertainty and parent compositing layers.
  // The sticky header uses backdrop-blur-xl which creates a compositing context that
  // can bleed through child bg classes — inline backgroundColor is authoritative.
  const cardBg = darkMode ? '#07090d' : '#ffffff';
  const cardBorderColor = darkMode ? 'rgba(255,255,255,0.10)' : '#e5e7eb';

  const card = (
    <div
      className="relative overflow-hidden rounded-xl border px-4 py-3"
      style={{
        backgroundColor: cardBg,
        borderColor: cardBorderColor,
        boxShadow: '0 18px 50px rgba(0,0,0,0.85)',
        isolation: 'isolate',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        opacity: 1,
      }}
    >
      {/* ── Status line — identical structure in all states ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isSuccess ? (
            <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${activeTone}`} />
          ) : isFailure ? (
            <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${activeTone}`} />
          ) : (
            <Loader2 className={`w-3.5 h-3.5 shrink-0 animate-spin ${activeTone}`} />
          )}

          {/* Primary title — fixed width, never truncates */}
          <span className={`text-xs font-semibold shrink-0 ${headingCls}`}>
            {isSuccess ? successTitle : isFailure ? 'Analysis failed' : title}
          </span>

          {/* Stage chip — shown on running + success to keep layout stable */}
          {!isFailure && (
            <>
              <span className={`shrink-0 text-xs ${mutedCls}`}>·</span>
              <span className={`text-xs truncate min-w-0 ${mutedCls}`}>{stageLabel}</span>
            </>
          )}
        </div>

        <span className={`shrink-0 text-xs tabular-nums font-medium ${activeTone}`}>{pct}%</span>
      </div>

      {/* ── Progress bar — always rendered, same height in all states ── */}
      <div className={`mt-2.5 h-1.5 w-full overflow-hidden rounded-full ${trackCls}`}>
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${pct}%`, transition: 'width 700ms ease-out' }}
        />
      </div>

      {/* ── Stage narration — institutional, underwriting-focused ── */}
      <p className={`mt-2 text-[11px] leading-snug ${mutedCls}`}>
        {isFailure ? (errorMessage || stageMessage) : stageMessage}
      </p>
    </div>
  );

  if (anchor === 'inline') {
    return (
      <div className="w-full" data-testid="system-progress-card" aria-live="polite">
        {card}
      </div>
    );
  }

  // "header" anchor: absolute-positioned below a relatively-positioned button container.
  return (
    <div
      className="absolute right-0 top-full mt-2 z-50 w-[340px]"
      data-testid="system-progress-card"
      aria-live="polite"
    >
      {card}
    </div>
  );
}
