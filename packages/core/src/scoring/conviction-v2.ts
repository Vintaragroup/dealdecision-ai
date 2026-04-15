/**
 * conviction-v2.ts
 *
 * Phase 2: computes the ConvictionV2 artifact.
 *
 * Formula
 * ───────
 * URSS_scaled = min(100, URSS * 1.33)
 * CV = 0.50 * verdict_resistance
 *    + 0.30 * conviction_v1_score
 *    + 0.20 * (100 - URSS_scaled)
 *
 * Input defaults when null:
 *   verdict_resistance → 70   (neutral prior: not disproven, but unverified)
 *   conviction_v1_score → 50  (neutral, conservative)
 *   urss               → 0   (conservative: no readiness penalty assumed)
 *
 * Gate logic
 * ──────────
 * URSS ≥ 75 (hard pass override)  → hard_pass  (even if CV is high)
 * CV < 20                          → hard_pass
 * CV 20–44                         → capped     (effective ceiling: investigate)
 * CV ≥ 45                          → clear
 *
 * Note: "capped" means conviction is not strong enough to push a deal above INVESTIGATE
 * on its own; "hard_pass" means conviction actively recommends against advancing.
 */

import type { ConvictionGateResultV2, ConvictionLabelV2 } from '../models/scoring-v2-stubs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConvictionV2Input {
  /**
   * Verdict resistance score from challenge_pass.verdict_resistance_score (0–100).
   * Null when challenge_pass is absent — defaults to 100.
   */
  verdict_resistance_score: number | null;
  /**
   * Conviction score from conviction_v1.conviction_score_0_100 (0–100).
   * Null when conviction_v1 is absent — defaults to 50.
   */
  conviction_v1_score: number | null;
  /**
   * Underwriting readiness from underwriting_readiness_v1.score_0_100 (0–100).
   * Null when underwriting_readiness_v1 is absent — defaults to 0.
   */
  urss: number | null;
  // ── Passthrough narrative fields from conviction_v1 / challenge_pass ───────
  key_unknowns?: string[];
  top_positive_contributors?: Array<{
    key: string;
    label: string;
    score_delta_0_100: number | null;
  }>;
  top_negative_contributors?: Array<{
    key: string;
    label: string;
    score_delta_0_100: number | null;
  }>;
  opposing_case?: string | null;
}

export interface ConvictionGateV2 {
  result: ConvictionGateResultV2;
  reason: string;
  effective_verdict_ceiling: 'fund' | 'advance' | 'investigate' | null;
}

export interface ConvictionV2Result {
  score: number;
  verdict_resistance: number;       // effective value used (post-default)
  conviction_v1: number;            // effective value used (post-default)
  urss: number;                     // effective URSS used (post-default)
  urss_scaled: number;              // min(100, URSS * 1.33)
  gate: ConvictionGateV2;
  key_unknowns: string[];
  top_positive_contributors: Array<{
    key: string;
    label: string;
    score_delta_0_100: number | null;
  }>;
  top_negative_contributors: Array<{
    key: string;
    label: string;
    score_delta_0_100: number | null;
  }>;
  opposing_case: string | null;
  missing_signals: string[];
  /** true when challenge_pass provided a real verdict_resistance_score. */
  verdict_resistance_present: boolean;
  /** Conviction label derived from score. */
  label: ConvictionLabelV2 | null;
  /** Phase 2: always false. */
  stub: false;
  version: 'conviction_v2';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_VERDICT_RESISTANCE = 70; // neutral prior when challenge_pass is absent
const DEFAULT_CONVICTION_V1      = 50;
const DEFAULT_URSS               = 0;
const URSS_HARD_PASS_THRESHOLD   = 75;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function cvGate(cv: number, urssRaw: number): ConvictionGateV2 {
  // URSS hard-pass override
  if (urssRaw >= URSS_HARD_PASS_THRESHOLD) {
    return {
      result: 'hard_pass',
      reason: `Underwriting readiness too low (URSS=${urssRaw}) — hard pass override`,
      effective_verdict_ceiling: null,
    };
  }
  const s = Math.round(cv);
  if (s < 20) {
    return {
      result: 'hard_pass',
      reason: `Very low conviction (${s}) — cannot advance`,
      effective_verdict_ceiling: null,
    };
  }
  if (s < 45) {
    return {
      result: 'capped',
      reason: `Low conviction (${s}) — effective ceiling: INVESTIGATE`,
      effective_verdict_ceiling: 'investigate',
    };
  }
  return {
    result: 'clear',
    reason: `Conviction (${s}) — gate clear`,
    effective_verdict_ceiling: null,
  };
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeConvictionV2(input: ConvictionV2Input): ConvictionV2Result {
  const missingSignals: string[] = [];

  // Apply defaults with tracking
  const vrPresent =
    input.verdict_resistance_score !== null && Number.isFinite(input.verdict_resistance_score);
  const vr = vrPresent ? clamp(input.verdict_resistance_score!) : DEFAULT_VERDICT_RESISTANCE;
  if (!vrPresent) {
    missingSignals.push('verdict_resistance_score (challenge_pass) — defaulted to 70');
  }

  const cv1 =
    input.conviction_v1_score !== null && Number.isFinite(input.conviction_v1_score)
      ? clamp(input.conviction_v1_score)
      : DEFAULT_CONVICTION_V1;
  if (input.conviction_v1_score === null) {
    missingSignals.push('conviction_v1_score (conviction_v1) — defaulted to 50');
  }

  const urssRaw =
    input.urss !== null && Number.isFinite(input.urss)
      ? clamp(input.urss)
      : DEFAULT_URSS;
  if (input.urss === null) {
    missingSignals.push('urss (underwriting_readiness_v1) — defaulted to 0');
  }

  const urssScaled = round1(Math.min(100, urssRaw * 1.33));

  // CV formula:
  //   0.50 * verdict_resistance
  // + 0.30 * conviction_v1
  // + 0.20 * (100 - URSS_scaled)
  const rawCV = 0.50 * vr + 0.30 * cv1 + 0.20 * (100 - urssScaled);
  const score = round1(clamp(rawCV));

  const label: ConvictionLabelV2 =
    score >= 70 ? 'Strong Conviction'
    : score >= 45 ? 'Moderate Conviction'
    : score >= 20 ? 'Low Conviction'
    : 'Insufficient Conviction';

  return {
    score,
    verdict_resistance: vr,
    conviction_v1: cv1,
    urss: urssRaw,
    urss_scaled: urssScaled,
    gate: cvGate(score, urssRaw),
    key_unknowns: input.key_unknowns ?? [],
    top_positive_contributors: input.top_positive_contributors ?? [],
    top_negative_contributors: input.top_negative_contributors ?? [],
    opposing_case: input.opposing_case ?? null,
    missing_signals: missingSignals,
    verdict_resistance_present: vrPresent,
    label,
    stub: false,
    version: 'conviction_v2',
  };
}
