/**
 * Venture Lens V1 — conviction scoring layer on top of VC Scoring V2.
 *
 * Answers "Would a VC lean in?" by evaluating five venture dimensions:
 * Team · Market · Product · Traction · Upside
 *
 * Architecture:
 *   - Purely additive — never modifies V2 formulas or fields.
 *   - Takes `VCScoringV2Inputs` (same signals V2 used) plus the computed `VCScoringV2` result.
 *   - Produces an adjustment (−10 to +10) on top of `vc_composite_score`.
 *   - Applies posture upgrade/downgrade rules on top of `investment_posture`.
 *
 * ⚠️  Team fallback notice:
 *   `dimension_scores.team` is null in the current orchestrator pipeline (render package
 *   does not supply dimension scores). When null, team defaults to 50 (neutral). This is a
 *   TEMPORARY fallback — not a true team quality evaluation. The team dimension will
 *   activate when upstream enrichment provides dimension scores.
 *
 * Pure function. No LLM calls. No side effects. Safe in useMemo or tests.
 */

import type { VCScoringV2, VCScoringV2Inputs } from './vc-scoring-v2';
import type { InvestmentPosture } from './vc-scoring-v2';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ConvictionLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface VentureLensBreakdown {
  team: number;
  market: number;
  product: number;
  traction: number;
  upside: number;
}

export interface VentureLensV1 {
  /** Weighted composite of the five venture dimensions (0–100). */
  venture_score: number;
  /** VC conviction interpretation of the venture score. */
  conviction_level: ConvictionLevel;
  /** Score adjustment applied to vc_composite_score (−10 to +10). */
  adjustment: number;
  /** clamp(vc_composite_score + adjustment, 0, 100) — the blended final score. */
  final_investment_score: number;
  /** V2 posture with upgrade/downgrade overrides applied. */
  final_posture: InvestmentPosture;
  /** Human-readable explanation of drivers and overrides. */
  reasons: string[];
  /** Per-dimension scores. */
  breakdown: VentureLensBreakdown;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function r(v: number): number {
  return Math.round(v);
}

// Posture order used for downgrade logic (weakest → strongest).
const POSTURE_ORDER: InvestmentPosture[] = [
  'PASS',
  'MONITOR',
  'INVESTIGATE',
  'HIGH_PRIORITY_DILIGENCE',
  'INVESTABLE',
];

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute the Venture Lens V1 conviction score.
 *
 * @param inputs - The same VCScoringV2Inputs used to compute `v2`.
 * @param v2 - The already-computed VCScoringV2 result (used for product fallback and posture base).
 *
 * @example
 * const v2 = computeVCScoringV2(inputs);
 * const lens = computeVentureLensV1(inputs, v2);
 * // lens.final_posture — posture after conviction adjustment
 */
export function computeVentureLensV1(
  inputs: VCScoringV2Inputs,
  v2: VCScoringV2
): VentureLensV1 {
  const reasons: string[] = [];

  // ── Team (0–100) ─────────────────────────────────────────────────────────
  // Base: dimension score when available; 50 (neutral) when null.
  // NOTE: dimension_scores.team is null in the current orchestrator pipeline.
  // Defaulting to 50 is a temporary neutral fallback, not a true team evaluation.
  let team = inputs.dimension_scores.team ?? 50;
  const codes = inputs.team_penalty_codes;

  if (codes.includes('no_founder')) {
    team = clamp(team - 30, 0, 100);
    reasons.push('No founder identified — team score penalized (−30).');
  } else if (codes.includes('solo_founder')) {
    team = clamp(team - 10, 0, 100);
    reasons.push('Solo founder — single point of failure (−10).');
  }
  if (codes.includes('no_technical_lead')) {
    team = clamp(team - 8, 0, 100);
    reasons.push('No technical lead identified (−8).');
  }
  if (codes.includes('no_gtm_lead')) {
    team = clamp(team - 8, 0, 100);
    reasons.push('No GTM lead identified (−8).');
  }
  if (codes.includes('no_domain_experience')) {
    team = clamp(team - 5, 0, 100);
    reasons.push('Domain experience not confirmed (−5).');
  }
  // prior_exit_present: not available in current pipeline — wired for future enrichment.
  // When upstream supplies this signal: team = clamp(team + 20, 0, 100);

  team = r(clamp(team, 0, 100));

  if (codes.length === 0 && inputs.dimension_scores.team === null) {
    reasons.push('Team: neutral fallback (50) — no team signals available in current pipeline.');
  }

  // ── Market (0–100) ───────────────────────────────────────────────────────
  let market = inputs.market_score_raw;
  if (inputs.traction_signals.revenue_present) {
    market = clamp(market + 15, 0, 100);
    reasons.push('Revenue present — market demand confirmed (+15).');
  }
  if (inputs.traction_signals.growth_rate_present) {
    market = clamp(market + 10, 0, 100);
    reasons.push('Growth rate present — expanding market signal (+10).');
  }
  if (inputs.traction_signals.tam_present) {
    market = clamp(market + 10, 0, 100);
    reasons.push('TAM present — addressable market sized (+10).');
  }
  market = r(clamp(market, 0, 100));

  // ── Product (0–100) ──────────────────────────────────────────────────────
  // Structured: mean of solution_product + problem_clarity when available.
  // Fallback: V2's inferred product score (already incorporates traction/GTM signals).
  const sp = inputs.dimension_scores.solution_product;
  const pc = inputs.dimension_scores.problem_clarity;
  let product: number;
  if (sp !== null && pc !== null) {
    product = (sp + pc) / 2;
  } else if (sp !== null) {
    product = sp;
  } else if (pc !== null) {
    product = pc;
  } else {
    product = v2.breakdown.opportunity.product;
    reasons.push('Product: using V2 inferred score (no dimension scores in pipeline).');
  }
  if (inputs.gtm_signal.present && inputs.gtm_signal.confidence > 0.6) {
    product = clamp(product + 10, 0, 100);
    reasons.push('Strong GTM signal — product positioning reinforced (+10).');
  }
  product = r(clamp(product, 0, 100));

  // ── Traction (0–100) ─────────────────────────────────────────────────────
  // Additive from boolean signals; no floor (absence of traction is meaningful).
  let traction = 0;
  if (inputs.traction_signals.revenue_present)    { traction += 30; }
  if (inputs.traction_signals.arr_or_mrr_present) { traction += 30; }
  if (inputs.traction_signals.growth_rate_present){ traction += 20; }
  if (inputs.traction_signals.tam_present)         { traction += 10; }
  traction = r(clamp(traction, 0, 100));

  // ── Upside (0–100) ───────────────────────────────────────────────────────
  // Measures compounding potential from market + growth + revenue evidence.
  let upside = 0;
  if (inputs.traction_signals.tam_present)         upside += 30;
  if (inputs.traction_signals.growth_rate_present) upside += 25;
  if (inputs.traction_signals.arr_or_mrr_present)  upside += 25;
  if (inputs.traction_signals.revenue_present)     upside += 20;
  upside = r(clamp(upside, 0, 100));

  // ── Venture score ─────────────────────────────────────────────────────────
  const venture_score = r(
    0.25 * team +
    0.25 * market +
    0.20 * product +
    0.15 * traction +
    0.15 * upside
  );

  // ── Conviction level ──────────────────────────────────────────────────────
  const conviction_level: ConvictionLevel =
    venture_score >= 65 ? 'HIGH' :
    venture_score >= 45 ? 'MEDIUM' :
    'LOW';

  // ── Adjustment (applied to vc_composite_score) ──────────────────────────
  const adjustment: number =
    venture_score >= 75 ? 10 :
    venture_score >= 60 ? 5 :
    venture_score >= 45 ? 0 :
    venture_score >= 30 ? -5 :
    -10;

  // ── Final investment score ────────────────────────────────────────────────
  const final_investment_score = clamp(r(v2.vc_composite_score + adjustment), 0, 100);

  // ── Final posture (V2 base + conviction override rules) ──────────────────
  let final_posture: InvestmentPosture = v2.investment_posture;

  if (v2.investment_posture === 'INVESTIGATE' && adjustment >= 5) {
    final_posture = 'HIGH_PRIORITY_DILIGENCE';
    reasons.push('Posture upgraded: INVESTIGATE → HIGH_PRIORITY_DILIGENCE (conviction adjustment ≥ +5).');
  } else if (v2.investment_posture === 'MONITOR' && adjustment >= 10) {
    final_posture = 'INVESTIGATE';
    reasons.push('Posture upgraded: MONITOR → INVESTIGATE (conviction adjustment ≥ +10).');
  } else if (adjustment <= -10) {
    const idx = POSTURE_ORDER.indexOf(v2.investment_posture);
    if (idx > 0) {
      final_posture = POSTURE_ORDER[idx - 1];
      reasons.push(`Posture downgraded: ${v2.investment_posture} → ${final_posture} (conviction adjustment ≤ −10).`);
    }
  }

  // ── Summary reason ────────────────────────────────────────────────────────
  reasons.push(
    `Venture Score ${venture_score}/100 — Team ${team} · Market ${market} · Product ${product} · Traction ${traction} · Upside ${upside}.`
  );
  reasons.push(
    `Conviction: ${conviction_level}. Adjustment: ${adjustment >= 0 ? '+' : ''}${adjustment} → Final Score: ${final_investment_score}/100.`
  );

  return {
    venture_score,
    conviction_level,
    adjustment,
    final_investment_score,
    final_posture,
    reasons,
    breakdown: { team, market, product, traction, upside },
  };
}
