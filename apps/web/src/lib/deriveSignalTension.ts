/**
 * deriveSignalTension — Signal Tension v1
 *
 * Deterministic composition of existing payload signals into a single tension tier.
 * Pure utility — no React, no side effects, no new pipeline stage.
 *
 * All inputs are already present in the report payload and the view-model selector.
 * Call this from selectWorkspaceRedesignedShellProps, not from components.
 *
 * ── Classification rules ──────────────────────────────────────────────────────
 *
 * HIGH (any one trigger fires)
 *   - financial truth tier is 'conflicted'
 *   - canonical_decision_v2.conflict_detected is true
 *   - verdict resistance label is 'Fragile' or 'Very Fragile' while posture is advancing
 *   - missing_critical count ≥ 2 while posture is advancing
 *   - narrative contradiction count ≥ 2 (topics with status = 'conflicting' | 'mixed')
 *   - contradiction_index_0_1 > 0.50
 *
 * MODERATE (any one trigger fires, and no HIGH triggers fired)
 *   - financial truth tier is 'unverified'
 *   - missing_critical count === 1
 *   - coverage_ratio_0_1 < 0.40
 *   - narrative contradiction count === 1
 *   - verdict resistance score < 50 (not fragile, but below confidence threshold) while advancing
 *
 * LOW — default when none of the above fire
 *
 * Returns null when all inputs are absent (deal not yet analyzed).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalTensionLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface SignalTensionResult {
  level: SignalTensionLevel;
  /** Short display label: 'Low Tension' | 'Moderate Tension' | 'High Tension' */
  label: string;
  /** One-sentence investor-facing summary. */
  summary: string;
  /** 1–3 plain-English reason strings explaining what fired. */
  reasons: string[];
}

export interface SignalTensionInput {
  /** Tier from deriveFinancialTruthBadge — null when financial_truth_summary absent. */
  financialTruthTier: 'verified' | 'directional' | 'unverified' | 'conflicted' | null;
  /** canonical_decision_v2.conflict_detected */
  conflictDetected: boolean;
  /** challenge_pass.verdict_resistance_label */
  verdictResistanceLabel: string | null;
  /** challenge_pass.verdict_resistance_score (0–100) */
  verdictResistanceScore: number | null;
  /** conviction_v1.contradiction_index_0_1 (0–1) */
  contradictionIndex: number | null;
  /** financial_coverage_v1.coverage_ratio (0–1) */
  coverageRatio: number | null;
  /** financial_integrity_v1.missing_critical.length */
  missingCriticalCount: number;
  /** Count of narrative_contradiction_bundle topics with status = 'conflicting' | 'mixed' */
  narrativeContradictionCount: number;
  /** true when conviction posture is not PASS / HARD_PASS / null */
  postureIsAdvancing: boolean;
}

// ─── Copy constants ───────────────────────────────────────────────────────────

const LABEL: Record<SignalTensionLevel, string> = {
  HIGH:     'High Tension',
  MODERATE: 'Moderate Tension',
  LOW:      'Low Tension',
};

const SUMMARY: Record<SignalTensionLevel, string> = {
  HIGH:     'Multiple independent signals are in disagreement or lack the robustness the current assessment implies.',
  MODERATE: 'Some signals are weaker or less complete than the current conviction posture implies.',
  LOW:      'Core signals are broadly aligned with the current assessment.',
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Derives the Signal Tension tier from existing view-model inputs.
 * Returns null when all inputs are absent (deal not yet analyzed).
 */
export function deriveSignalTension(
  input: SignalTensionInput,
): SignalTensionResult | null {
  const {
    financialTruthTier,
    conflictDetected,
    verdictResistanceLabel,
    verdictResistanceScore,
    contradictionIndex,
    coverageRatio,
    missingCriticalCount,
    narrativeContradictionCount,
    postureIsAdvancing,
  } = input;

  // If all inputs are absent the deal has not been analyzed yet — render nothing.
  const hasAnyInput =
    financialTruthTier != null ||
    conflictDetected ||
    verdictResistanceLabel != null ||
    verdictResistanceScore != null ||
    contradictionIndex != null ||
    coverageRatio != null ||
    missingCriticalCount > 0 ||
    narrativeContradictionCount > 0;

  if (!hasAnyInput) return null;

  const reasons: string[] = [];
  let isHigh = false;
  let isModerate = false;

  // ── HIGH triggers ──────────────────────────────────────────────────────────

  if (financialTruthTier === 'conflicted') {
    isHigh = true;
    reasons.push('Financial sources disagree materially across documents.');
  }

  if (conflictDetected) {
    isHigh = true;
    reasons.push('Two independent scoring models yield contradictory verdicts.');
  }

  const vrIsFragile =
    verdictResistanceLabel === 'Fragile' || verdictResistanceLabel === 'Very Fragile';

  if (vrIsFragile && postureIsAdvancing) {
    isHigh = true;
    const label = verdictResistanceLabel?.toLowerCase() ?? 'fragile';
    reasons.push(`Verdict resistance is ${label} — the conclusion does not hold up under challenge.`);
  }

  if (missingCriticalCount >= 2 && postureIsAdvancing) {
    isHigh = true;
    reasons.push(`${missingCriticalCount} critical financial fields are missing while the deal is advancing.`);
  }

  if (narrativeContradictionCount >= 2) {
    isHigh = true;
    reasons.push(`${narrativeContradictionCount} narrative topics contain conflicting or mixed signals.`);
  }

  if (contradictionIndex != null && contradictionIndex > 0.5) {
    isHigh = true;
    reasons.push('Structural contradiction index exceeds the high-tension threshold (>0.50).');
  }

  // ── MODERATE triggers (only when no HIGH trigger fired) ───────────────────

  if (!isHigh) {
    if (financialTruthTier === 'unverified') {
      isModerate = true;
      reasons.push('Financial figures are unverified — independent confirmation is required.');
    }

    if (missingCriticalCount === 1) {
      isModerate = true;
      reasons.push('One critical financial field is missing from the deal package.');
    }

    if (coverageRatio != null && coverageRatio < 0.4) {
      isModerate = true;
      reasons.push('Evidence coverage is below 40% — the conviction posture rests on incomplete documentation.');
    }

    if (narrativeContradictionCount === 1) {
      isModerate = true;
      reasons.push('One narrative topic contains conflicting or mixed signals.');
    }

    if (
      postureIsAdvancing &&
      verdictResistanceScore != null &&
      !vrIsFragile &&
      verdictResistanceScore < 50
    ) {
      isModerate = true;
      reasons.push('Verdict robustness is below the confidence threshold relative to the current posture.');
    }
  }

  const level: SignalTensionLevel = isHigh ? 'HIGH' : isModerate ? 'MODERATE' : 'LOW';

  return {
    level,
    label:   LABEL[level],
    summary: SUMMARY[level],
    // Cap at 3 reasons to stay compact in the UI
    reasons: reasons.slice(0, 3),
  };
}
