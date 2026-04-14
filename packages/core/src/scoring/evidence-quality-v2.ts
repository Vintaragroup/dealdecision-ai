/**
 * evidence-quality-v2.ts
 *
 * Phase 2: computes the EvidenceQualityV2 artifact.
 *
 * Formula
 * ───────
 * EQ = 0.40 * dci_proxy
 *    + 0.35 * confidence_score_100
 *    + 0.15 * coverage_pct
 *    - penalties
 *
 * Where:
 *   dci_proxy            = confidence_score * 100   (document quality proxy;
 *                          true DCI lives in orchestrator only — wired in Phase 3)
 *   confidence_score_100 = confidence_score * 100   (score_explanation.totals.confidence_score × 100)
 *   coverage_pct         = coverage_ratio * 100     (score_explanation.totals.coverage_ratio × 100)
 *
 * NOTE on collapsed DCI/confidence:
 *   Both DCI and confidence_score currently map to the same signal
 *   (score_explanation.totals.confidence_score). The effective formula is therefore:
 *   EQ = 0.75 * (confidence×100) + 0.15 * (coverage×100) - penalties
 *   This is intentional for Phase 2 and documented here for future wiring.
 *
 * Penalties (applied before clamp):
 *   critical flag: −10 each
 *   error flag:    −5 each
 *   warn flag:     −2 each
 *
 * Result is clamped to [0, 100].
 *
 * Gate logic
 * ──────────
 * score ≥ 65     → clear
 * 40–64          → caution
 * 20–39          → capped  (effective verdict ceiling: investigate)
 * < 20 or null   → blocked (effective verdict ceiling: pass)
 */

import type { EvidenceQualityLabelV2, EvidenceGateResultV2 } from '../models/scoring-v2-stubs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvidenceQualityV2Input {
  /**
   * Raw confidence score from score_explanation.totals.confidence_score (0–1).
   * Used as both the DCI proxy and the confidence component.
   * Null when score_explanation is absent.
   */
  confidence_score_01: number | null;
  /**
   * Raw coverage ratio from score_explanation.totals.coverage_ratio (0–1).
   * Null treated as 0.
   */
  coverage_ratio: number | null;
  /** Number of critical-severity evaluation flags. Default 0. */
  flags_critical: number;
  /** Number of error-severity evaluation flags. Default 0. */
  flags_error: number;
  /** Number of warn-severity evaluation flags. Default 0. */
  flags_warn: number;
}

export interface EvidenceGateV2 {
  result: EvidenceGateResultV2;
  reason: string;
  effective_verdict_ceiling: 'fund' | 'advance' | 'investigate' | 'pass' | null;
}

export interface EvidenceQualityV2Result {
  score: number | null;
  label: EvidenceQualityLabelV2 | null;
  /** Raw DCI proxy used (0–100). Currently equals confidence_score_01 * 100. */
  dci: number | null;
  /** Raw confidence component used (0–100). */
  confidence_score: number | null;
  /** Raw coverage used (0–100). */
  coverage_pct: number | null;
  flag_counts: { critical: number; error: number; warn: number };
  gate: EvidenceGateV2;
  missing_signals: string[];
  /** Phase 2: always false. */
  stub: false;
  version: 'evidence_quality_v2';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function eqLabel(score: number | null): EvidenceQualityLabelV2 | null {
  if (score === null) return null;
  const s = Math.round(score);
  if (s >= 65) return 'Strong Evidence';
  if (s >= 40) return 'Adequate Evidence';
  if (s >= 20) return 'Thin Evidence';
  return 'Insufficient Evidence';
}

function eqGate(score: number | null): EvidenceGateV2 {
  if (score === null || score < 20) {
    return {
      result: 'blocked',
      reason: score === null ? 'No evidence score available' : 'Score below minimum threshold (< 20)',
      effective_verdict_ceiling: 'pass',
    };
  }
  const s = Math.round(score);
  if (s < 40) {
    return {
      result: 'capped',
      reason: `Thin evidence (${s}) — effective ceiling: INVESTIGATE`,
      effective_verdict_ceiling: 'investigate',
    };
  }
  if (s < 65) {
    return {
      result: 'caution',
      reason: `Adequate evidence (${s}) — proceed with caution`,
      effective_verdict_ceiling: null,
    };
  }
  return {
    result: 'clear',
    reason: `Strong evidence (${s}) — gate clear`,
    effective_verdict_ceiling: null,
  };
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeEvidenceQualityV2(input: EvidenceQualityV2Input): EvidenceQualityV2Result {
  const missingSignals: string[] = [];

  // Scale to 0–100
  let dciProxy: number | null = null;
  let confProxy: number | null = null;
  let covPct: number | null = null;

  if (input.confidence_score_01 !== null && Number.isFinite(input.confidence_score_01)) {
    const c100 = clamp(input.confidence_score_01 * 100);
    dciProxy = c100;   // DCI proxy (same source until Phase 3 wires true DCI)
    confProxy = c100;  // confidence component
  } else {
    missingSignals.push('confidence_score (score_explanation.totals.confidence_score)');
  }

  if (input.coverage_ratio !== null && Number.isFinite(input.coverage_ratio)) {
    covPct = clamp(input.coverage_ratio * 100);
  } else {
    missingSignals.push('coverage_ratio (score_explanation.totals.coverage_ratio)');
  }

  // Cannot compute score with no signal
  if (dciProxy === null && covPct === null) {
    return {
      score: null,
      label: null,
      dci: null,
      confidence_score: null,
      coverage_pct: null,
      flag_counts: { critical: input.flags_critical, error: input.flags_error, warn: input.flags_warn },
      gate: eqGate(null),
      missing_signals: missingSignals,
      stub: false,
      version: 'evidence_quality_v2',
    };
  }

  // Use neutral 50 for absent component
  const dci = dciProxy ?? 50;
  const conf = confProxy ?? 50;
  const cov = covPct ?? 0;

  // Raw score before penalties
  let rawScore = 0.40 * dci + 0.35 * conf + 0.15 * cov;

  // Penalties
  const criticalCount = Math.max(0, Math.round(input.flags_critical));
  const errorCount    = Math.max(0, Math.round(input.flags_error));
  const warnCount     = Math.max(0, Math.round(input.flags_warn));

  rawScore -= criticalCount * 10;
  rawScore -= errorCount    * 5;
  rawScore -= warnCount     * 2;

  const score = round1(clamp(rawScore));

  return {
    score,
    label: eqLabel(score),
    dci: dciProxy,
    confidence_score: confProxy,
    coverage_pct: covPct,
    flag_counts: { critical: criticalCount, error: errorCount, warn: warnCount },
    gate: eqGate(score),
    missing_signals: missingSignals,
    stub: false,
    version: 'evidence_quality_v2',
  };
}
