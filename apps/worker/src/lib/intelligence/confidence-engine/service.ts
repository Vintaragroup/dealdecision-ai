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

  const uncertaintyNote = weakeners.length > 0
    ? `Confidence weakened by: ${weakeners.slice(0, 3).join("; ")}.`
    : null;

  // ── Revenue traction sub-conclusion ─────────────────────────────────────
  // Prefer FTRL truth state over raw null-check when available.
  const arrState = input.arr_truth_state ?? null;
  const arrSourceKind = input.arr_resolved_source_kind ?? null;

  let revenueScore: number;
  let revenueWeakeners: string[];
  let revenueUncertainty: string | null;

  if (arrState === "CONFIRMED") {
    revenueScore = Math.min(overallScore + 10, 100);
    revenueWeakeners = [];
    revenueUncertainty = arrSourceKind === "structured_derived"
      ? "ARR figure is derived from reliable structured inputs and should be treated as estimated rather than directly reported."
      : null;
  } else if (arrState === "CONFLICT") {
    revenueScore = Math.max(overallScore - 5, MIN_SCORE);
    revenueWeakeners = ["ARR/revenue figures are contradictory across data sources"];
    revenueUncertainty =
      "Financial data is present and usable, though conflicting source claims required resolution. Verify with a single authoritative financial statement.";
  } else if (arrState === "INSUFFICIENT") {
    revenueScore = Math.max(overallScore - 15, MIN_SCORE);
    revenueWeakeners = ["No verified ARR figure from structured financial data"];
    revenueUncertainty = "ARR figure could not be confirmed from the provided materials.";
  } else {
    // arrState is null — FTRL not run; fall back to scalar null-check
    revenueScore = input.arr_structured != null
      ? Math.min(overallScore + 10, 100)
      : Math.max(overallScore - 15, MIN_SCORE);
    revenueWeakeners = input.arr_structured == null ? ["No structured ARR data available"] : [];
    revenueUncertainty = input.arr_structured == null
      ? "ARR figure is unverified — sourced from deck narrative only."
      : null;
  }

  // ── Burn sustainability sub-conclusion ────────────────────────────────────
  const burnState = input.burn_truth_state ?? null;
  const burnSourceKind = input.burn_resolved_source_kind ?? null;

  let burnScore: number;
  let burnWeakeners: string[];
  let burnUncertainty: string | null;

  if (burnState === "CONFIRMED") {
    burnScore = overallScore;
    burnWeakeners = [];
    burnUncertainty = burnSourceKind === "structured_derived"
      ? "Burn rate is derived from reliable structured inputs and should be treated as estimated rather than directly reported."
      : null;
  } else if (burnState === "CONFLICT") {
    burnScore = Math.max(overallScore - 8, MIN_SCORE);
    burnWeakeners = ["Burn rate figures are contradictory across data sources"];
    burnUncertainty =
      "Contradictory burn rate data detected. Runway calculations should not be relied upon until reconciled.";
  } else if (burnState === "INSUFFICIENT") {
    burnScore = Math.max(overallScore - 15, MIN_SCORE);
    burnWeakeners = ["No structured burn rate data available"];
    burnUncertainty = "Burn and runway claims cannot be verified without structured financial data.";
  } else {
    // burnState is null — FTRL not run; fall back to scalar null-check
    burnScore = input.burn_rate_monthly != null
      ? overallScore
      : Math.max(overallScore - 15, MIN_SCORE);
    burnWeakeners = input.burn_rate_monthly == null ? ["No structured burn rate data available"] : [];
    burnUncertainty = input.burn_rate_monthly == null
      ? "Burn and runway claims cannot be verified without structured financial data."
      : null;
  }

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
      weakening_factors: revenueWeakeners,
      explicit_uncertainty: revenueUncertainty,
    },
    {
      conclusion_key: "burn_sustainability",
      confidence_score: clamp(burnScore, MIN_SCORE, 100),
      confidence_band: scoreToConfidenceBand(burnScore),
      supporting_evidence_count: input.evidence_count,
      weakening_factors: burnWeakeners,
      explicit_uncertainty: burnUncertainty,
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
  const baseScore = clamp(BASE_SCORE - total_penalty, MIN_SCORE, BASE_SCORE);
  const weakeners = penalties.map((p) => p.reason);

  // ── Memory adjustment (bounded, secondary signal) ────────────────────────
  // Applied AFTER base confidence is finalized.
  // Memory may never be the sole reason for a negative verdict.
  const memAdj = input.memory_influence?.confidence_adjustment ?? 0;
  const memReason =
    input.memory_influence?.confidence_adjustment_reason ??
    "No memory adjustment applied: memory influence not provided.";

  const overallScore = clamp(baseScore + memAdj, MIN_SCORE, BASE_SCORE);
  const overallBand = scoreToConfidenceBand(overallScore);

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
    memory_adjustment: memAdj,
    memory_adjustment_reason: memReason,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function persistConfidenceReport(
  pool: Pool,
  report: ConfidenceReport
): Promise<void> {
  await pool.query(
    `INSERT INTO deal_confidence_assessments
       (deal_id, overall_confidence_score, overall_confidence_band, penalties_applied, conclusions, rationale,
        intelligence_run_id, memory_adjustment, memory_adjustment_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (deal_id, intelligence_run_id) DO UPDATE SET
       overall_confidence_score  = EXCLUDED.overall_confidence_score,
       overall_confidence_band   = EXCLUDED.overall_confidence_band,
       penalties_applied         = EXCLUDED.penalties_applied,
       conclusions               = EXCLUDED.conclusions,
       rationale                 = EXCLUDED.rationale,
       memory_adjustment         = EXCLUDED.memory_adjustment,
       memory_adjustment_reason  = EXCLUDED.memory_adjustment_reason,
       updated_at                = now()`,
    [
      report.deal_id,
      report.overall_confidence_score,
      report.overall_confidence_band,
      JSON.stringify(report.penalties_applied),
      JSON.stringify(report.conclusions),
      report.rationale,
      report.intelligence_run_id,
      report.memory_adjustment,
      report.memory_adjustment_reason,
    ]
  );
}
