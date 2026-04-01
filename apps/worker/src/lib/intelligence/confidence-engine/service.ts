/**
 * Confidence Engine — Service
 *
 * Computes earned confidence scores from analysis inputs + evaluator report.
 */

import type { Pool } from "pg";
import type { ConfidenceInput, ConfidenceReport, ConfidenceConclusion } from "./types.js";
import { computePenalties } from "./rules.js";
import { scoreToConfidenceBand } from "../types.js";

const BASE_SCORE = 100;
const MIN_SCORE = 10;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ─── Build conclusion entries ─────────────────────────────────────────────────

function buildConclusions(
  input: ConfidenceInput,
  overallScore: number,
  weakeners: string[]
): ConfidenceConclusion[] {
  const band = scoreToConfidenceBand(overallScore);

  // Revenue traction sub-conclusion
  const revenueScore = input.arr_structured != null
    ? Math.min(overallScore + 10, 100)
    : Math.max(overallScore - 15, MIN_SCORE);

  // Burn sustainability sub-conclusion
  const burnScore = input.burn_rate_monthly != null
    ? overallScore
    : Math.max(overallScore - 15, MIN_SCORE);

  const uncertaintyNote = weakeners.length > 0
    ? `Confidence weakened by: ${weakeners.slice(0, 3).join("; ")}.`
    : null;

  return [
    {
      conclusion_key: "overall",
      confidence_score: overallScore,
      confidence_band: band,
      supporting_evidence_count: input.evidence_count,
      weakening_factors: weakeners,
      explicit_uncertainty: uncertaintyNote,
    },
    {
      conclusion_key: "revenue_traction",
      confidence_score: clamp(revenueScore, MIN_SCORE, 100),
      confidence_band: scoreToConfidenceBand(revenueScore),
      supporting_evidence_count: input.evidence_count,
      weakening_factors: input.arr_structured == null ? ["No structured ARR data available"] : [],
      explicit_uncertainty: input.arr_structured == null
        ? "ARR figure is unverified — sourced from deck narrative only."
        : null,
    },
    {
      conclusion_key: "burn_sustainability",
      confidence_score: clamp(burnScore, MIN_SCORE, 100),
      confidence_band: scoreToConfidenceBand(burnScore),
      supporting_evidence_count: input.evidence_count,
      weakening_factors: input.burn_rate_monthly == null ? ["No structured burn rate data available"] : [],
      explicit_uncertainty: input.burn_rate_monthly == null
        ? "Burn and runway claims cannot be verified without structured financial data."
        : null,
    },
  ];
}

// ─── Build rationale ─────────────────────────────────────────────────────────

function buildRationale(
  overallScore: number,
  totalPenalty: number,
  weakeners: string[]
): string {
  const band = scoreToConfidenceBand(overallScore);
  if (weakeners.length === 0) {
    return `Analysis is well-supported. Confidence is ${band} (${overallScore}/100) with no material penalties.`;
  }
  return `Confidence is ${band} (${overallScore}/100). Base score of ${BASE_SCORE} reduced by ${totalPenalty} points due to: ${weakeners.slice(0, 3).join("; ")}.`;
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeConfidence(input: ConfidenceInput): ConfidenceReport {
  const { penalties, total_penalty } = computePenalties(input);
  const overallScore = clamp(BASE_SCORE - total_penalty, MIN_SCORE, BASE_SCORE);
  const overallBand = scoreToConfidenceBand(overallScore);
  const weakeners = penalties.map((p) => p.reason);
  const conclusions = buildConclusions(input, overallScore, weakeners);
  const rationale = buildRationale(overallScore, total_penalty, weakeners);

  return {
    deal_id: input.deal_id,
    intelligence_run_id: input.intelligence_run_id,
    overall_confidence_score: overallScore,
    overall_confidence_band: overallBand,
    penalties_applied: penalties,
    conclusions,
    rationale,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function persistConfidenceReport(
  pool: Pool,
  report: ConfidenceReport
): Promise<void> {
  await pool.query(
    `INSERT INTO deal_confidence_assessments
       (deal_id, overall_confidence_score, overall_confidence_band, penalties_applied, conclusions, rationale, intelligence_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (deal_id, intelligence_run_id) DO UPDATE SET
       overall_confidence_score  = EXCLUDED.overall_confidence_score,
       overall_confidence_band   = EXCLUDED.overall_confidence_band,
       penalties_applied         = EXCLUDED.penalties_applied,
       conclusions               = EXCLUDED.conclusions,
       rationale                 = EXCLUDED.rationale,
       updated_at                = now()`,
    [
      report.deal_id,
      report.overall_confidence_score,
      report.overall_confidence_band,
      JSON.stringify(report.penalties_applied),
      JSON.stringify(report.conclusions),
      report.rationale,
      report.intelligence_run_id,
    ]
  );
}
