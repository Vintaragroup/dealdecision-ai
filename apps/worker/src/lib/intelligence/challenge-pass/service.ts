/**
 * Challenge Pass — Service
 *
 * Composes the opposing-case builder + missing-evidence detector into a
 * ChallengePassResult, and handles DB persistence.
 */

import type { Pool } from "pg";
import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type { ChallengePassResult, VerdictResistanceLabel } from "./types.js";
import type { MemoryInfluenceSummary } from "../decision-memory/influence.js";
import { buildOpposingCase } from "./opposing-case-builder.js";
import { detectMissingEvidence, missingEvidencePenalty } from "./missing-evidence-detector.js";
import type { MissingEvidenceInput } from "./missing-evidence-detector.js";

// ─── Verdict resistance helpers ───────────────────────────────────────────────

const FLAG_WEIGHT: Record<string, number> = {
  CRITICAL: 25,
  ERROR: 15,
  WARN: 5,
};

function toResistanceLabel(score: number): VerdictResistanceLabel {
  if (score >= 75) return "Robust";
  if (score >= 50) return "Moderate";
  if (score >= 25) return "Fragile";
  return "Very Fragile";
}

function computeVerdictResistanceScore(
  flags: EvaluationFlag[],
  missingPenalty: number
): number {
  const flagPenalty = flags.reduce((sum, f) => sum + (FLAG_WEIGHT[f.severity] ?? 0), 0);
  return Math.max(0, 100 - flagPenalty - missingPenalty);
}

// ─── Public run API ───────────────────────────────────────────────────────────

export interface ChallengePassInput {
  deal_id: string;
  deal_name: string;
  intelligence_run_id: string;
  verdict: string;
  ors_score: number;
  flags: EvaluationFlag[];
  deck_risk_items?: string[];
  evidence: MissingEvidenceInput;
  /**
   * Optional: memory influence summary derived from similar deals.
   * When present and fragility signal is active, the opposing case summary
   * is enriched with memory-based context.
   * Memory never rewrites ORS, verdict, or evidence facts.
   */
  memory_influence?: MemoryInfluenceSummary | null;
}

export function runChallengePass(input: ChallengePassInput): ChallengePassResult {
  const { deal_id, deal_name, intelligence_run_id, verdict, ors_score, flags, deck_risk_items = [], evidence } = input;

  const { missing_evidence, diligence_gaps } = detectMissingEvidence(evidence);
  const missing_penalty = missingEvidencePenalty(missing_evidence);

  const resistance_score = computeVerdictResistanceScore(flags, missing_penalty);
  const resistance_label = toResistanceLabel(resistance_score);

  const { opposing_case_summary, overconfident_claims } = buildOpposingCase({
    deal_name,
    verdict,
    ors_score,
    flags,
    deck_risk_items,
  });

  // ── Memory enrichment ─────────────────────────────────────────────────────
  // Only append memory context when the fragility signal is active.
  // Memory challenge summary is appended to (never replaces) the base opposing case.
  const memChallengeUsed = input.memory_influence?.challenge_memory_used ?? false;
  const memChallengeSummary = input.memory_influence?.challenge_memory_summary ?? null;

  const enrichedOpposingCase =
    memChallengeUsed && memChallengeSummary
      ? `${opposing_case_summary}\n\nMemory signal: ${memChallengeSummary}`
      : opposing_case_summary;

  return {
    deal_id,
    intelligence_run_id,
    verdict_resistance_score: resistance_score,
    verdict_resistance_label: resistance_label,
    opposing_case_summary: enrichedOpposingCase,
    overconfident_claims,
    missing_evidence,
    diligence_gaps,
    flag_count_critical: flags.filter((f) => f.severity === "CRITICAL").length,
    flag_count_error: flags.filter((f) => f.severity === "ERROR").length,
    flag_count_warn: flags.filter((f) => f.severity === "WARN").length,
    memory_challenge_used: memChallengeUsed,
    memory_challenge_summary: memChallengeSummary,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function persistChallengePassResult(
  pool: Pool,
  result: ChallengePassResult
): Promise<void> {
  await pool.query(
    `INSERT INTO deal_challenge_pass_results
       (deal_id, intelligence_run_id, verdict_resistance_score, verdict_resistance_label,
        opposing_case_summary, overconfident_claims, missing_evidence, diligence_gaps,
        flag_count_critical, flag_count_error, flag_count_warn,
        memory_challenge_used, memory_challenge_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (deal_id, intelligence_run_id) DO UPDATE SET
       verdict_resistance_score  = EXCLUDED.verdict_resistance_score,
       verdict_resistance_label  = EXCLUDED.verdict_resistance_label,
       opposing_case_summary     = EXCLUDED.opposing_case_summary,
       overconfident_claims      = EXCLUDED.overconfident_claims,
       missing_evidence          = EXCLUDED.missing_evidence,
       diligence_gaps            = EXCLUDED.diligence_gaps,
       flag_count_critical       = EXCLUDED.flag_count_critical,
       flag_count_error          = EXCLUDED.flag_count_error,
       flag_count_warn           = EXCLUDED.flag_count_warn,
       memory_challenge_used     = EXCLUDED.memory_challenge_used,
       memory_challenge_summary  = EXCLUDED.memory_challenge_summary,
       updated_at                = now()`,
    [
      result.deal_id,
      result.intelligence_run_id,
      result.verdict_resistance_score,
      result.verdict_resistance_label,
      result.opposing_case_summary,
      JSON.stringify(result.overconfident_claims),
      JSON.stringify(result.missing_evidence),
      JSON.stringify(result.diligence_gaps),
      result.flag_count_critical,
      result.flag_count_error,
      result.flag_count_warn,
      result.memory_challenge_used,
      result.memory_challenge_summary,
    ]
  );
}
