/**
 * ScoreDivergenceBanner
 *
 * Displays a minimal, non-disruptive analyst-level indicator when the workspace
 * DIO verdict and the ORS orchestrator decision diverge beyond calibrated thresholds.
 *
 * SCOPE: AI Analysis tab only (AnalysisTab.tsx). Do not render in Overview, export, or
 * investor-facing views.
 *
 * Design rules:
 * - Amber-toned — signals "review needed", not a hard error.
 * - Single-line compact bar — does not disrupt main content layout.
 * - Does NOT change or restate either score. It only links the two tracks.
 * - No tooltip, no expanded state, no drill-down (keep it non-disruptive).
 */

import { AlertTriangle } from 'lucide-react';
import type { ScoreDivergenceResult } from '../../../lib/resolveScoreDivergence';

interface ScoreDivergenceBannerProps {
  divergence: ScoreDivergenceResult;
  darkMode?: boolean;
}

function buildMessage(divergence: ScoreDivergenceResult): string {
  const { kind, workspaceVerdict, orsDecision, scoreDelta } = divergence;

  if (kind === 'opposite_signals') {
    const ws = workspaceVerdict ?? '—';
    const ors = orsDecision ?? '—';
    return `Signals diverge — workspace: ${ws} · orchestrator: ${ors}. Review both tracks before deciding.`;
  }

  // large_numeric_gap
  if (scoreDelta != null) {
    const absDelta = Math.abs(scoreDelta);
    const direction = scoreDelta > 0 ? 'above' : 'below';
    return `Signals diverge — workspace score is ${absDelta}pts ${direction} orchestrator track. Review both tracks before deciding.`;
  }

  return 'Signals diverge — workspace and orchestrator tracks differ. Review both before deciding.';
}

export function ScoreDivergenceBanner({
  divergence,
  darkMode = false,
}: ScoreDivergenceBannerProps) {
  if (!divergence.isDiverging) return null;

  const message = buildMessage(divergence);

  return (
    <div
      role="status"
      aria-label="Score divergence indicator"
      data-testid="score-divergence-banner"
      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${
        darkMode
          ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
          : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}
    >
      <AlertTriangle
        className={`w-3.5 h-3.5 shrink-0 ${darkMode ? 'text-amber-400' : 'text-amber-500'}`}
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}
