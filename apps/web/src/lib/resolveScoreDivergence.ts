/**
 * resolveScoreDivergence
 *
 * Pure utility — no side effects, no imports of UI code.
 *
 * Determines whether the workspace DIO verdict and the ORS orchestrator
 * decision diverge beyond thresholds that should be surfaced to the analyst.
 *
 * Divergence rules (Fix B — 2026-03-30 calibration):
 *   1. abs(workspaceScore - orsScore) > 20           — large numeric gap
 *   2. workspaceVerdict === HARD_PASS AND ors === CONSIDER|GO — opposite polarity (high risk)
 *   3. workspaceVerdict === FUND AND ors === NO_GO    — opposite polarity (high risk)
 *
 * Returns null when both inputs are absent or divergence is below thresholds.
 *
 * Important: this function does NOT change any score math.  It is purely an
 * analytical signal for display.  The canonical verdict (DIO) is unchanged.
 */

import type { WorkspaceVerdict } from './resolveWorkspaceVerdict';

export type OrsDecisionLabel = 'GO' | 'CONSIDER' | 'NO_GO';

export type ScoreDivergenceKind =
  | 'large_numeric_gap'   // |workspaceScore - orsScore| > 20
  | 'opposite_signals';   // HARD_PASS↔CONSIDER/GO or FUND↔NO_GO

export interface ScoreDivergenceResult {
  /** Whether any divergence condition is active. */
  isDiverging: boolean;
  /** Category of the divergence, if present. */
  kind: ScoreDivergenceKind | null;
  /** Numeric gap between workspace score and ORS score (positive = workspace above ORS). */
  scoreDelta: number | null;
  /** Workspace verdict at time of evaluation. */
  workspaceVerdict: WorkspaceVerdict | null;
  /** ORS decision label at time of evaluation. */
  orsDecision: OrsDecisionLabel | null;
}

const NULL_RESULT: ScoreDivergenceResult = {
  isDiverging: false,
  kind: null,
  scoreDelta: null,
  workspaceVerdict: null,
  orsDecision: null,
};

/**
 * Evaluate divergence between the workspace verdict/score and the ORS decision/score.
 *
 * @param workspaceScore   DIO overall_score (0-100). null when not yet computed.
 * @param workspaceVerdict Resolved WorkspaceVerdict. null when not yet computed.
 * @param orsScore         ORS overall_recommendation_score (0-100). null when report absent.
 * @param orsDecision      ORS decision.label. null when report absent.
 */
export function resolveScoreDivergence(
  workspaceScore: number | null,
  workspaceVerdict: WorkspaceVerdict | null,
  orsScore: number | null,
  orsDecision: OrsDecisionLabel | null,
): ScoreDivergenceResult {
  // Both sides must be present to evaluate divergence.
  if (workspaceVerdict == null || orsDecision == null) return NULL_RESULT;

  const scoreDelta =
    workspaceScore != null && orsScore != null
      ? workspaceScore - orsScore
      : null;

  // Rule 2: HARD_PASS (workspace) vs CONSIDER or GO (ORS) — opposite signals
  if (
    workspaceVerdict === 'HARD_PASS' &&
    (orsDecision === 'CONSIDER' || orsDecision === 'GO')
  ) {
    return {
      isDiverging: true,
      kind: 'opposite_signals',
      scoreDelta,
      workspaceVerdict,
      orsDecision,
    };
  }

  // Rule 3: FUND (workspace) vs NO_GO (ORS) — opposite signals
  if (workspaceVerdict === 'FUND' && orsDecision === 'NO_GO') {
    return {
      isDiverging: true,
      kind: 'opposite_signals',
      scoreDelta,
      workspaceVerdict,
      orsDecision,
    };
  }

  // Rule 1: large numeric gap (regardless of verdict polarity)
  if (scoreDelta != null && Math.abs(scoreDelta) > 20) {
    return {
      isDiverging: true,
      kind: 'large_numeric_gap',
      scoreDelta,
      workspaceVerdict,
      orsDecision,
    };
  }

  return NULL_RESULT;
}
