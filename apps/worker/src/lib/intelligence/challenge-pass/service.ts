/**
 * Challenge Pass — Service
 *
 * Composes the analytical challenge layer into a ChallengePassResult.
 * The challenge asks: "What is the strongest reason this current verdict might
 * be wrong?" — not "what files are missing?"
 *
 * Scoring model: weighted deductions from analytical pressure (contradictions,
 * confidence penalties, eval flags, score inconsistency, fail-open conditions)
 * plus bounded deductions for structural gaps. Produces deal-specific output
 * that meaningfully varies across the assessment space.
 */

import type { Pool } from "pg";
import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type {
  ChallengePassResult,
  ChallengeFactor,
  ChallengeFactorCode,
  VerdictResistanceLabel,
} from "./types.js";
import type { MemoryInfluenceSummary } from "../decision-memory/influence.js";
import type { ConfidencePenalty } from "../confidence-engine/types.js";
import { buildOpposingCase } from "./opposing-case-builder.js";
import { detectMissingEvidence } from "./missing-evidence-detector.js";
import type { MissingEvidenceInput } from "./missing-evidence-detector.js";
import { buildContradictionExplanations } from "./contradiction-explainer.js";

// ─── Resistance scoring weights ───────────────────────────────────────────────
//
// Each weight represents the score deduction for that condition.
// Baseline is 100. Analytical pressure deducts more than structural gaps —
// contradictions and flag clusters are the hardest hits.
//
// Design goals:
//   - Clean deals (no contradictions, no critical flags) should reach 75+
//   - Contradiction clusters should push score below 50
//   - Missing evidence alone should not take a score below the Moderate band
//   - Memory fragility adds a meaningful extra penalty

const WEIGHT = {
  // Analytical pressure (highest deduction)
  CONTRADICTION_CLUSTER: 35,       // ≥3 contradictions
  SINGLE_CONTRADICTION: 18,        // 1–2 contradictions
  EVALUATOR_CRITICAL_FLAG: 22,     // per CRITICAL flag (capped at 2)
  EVALUATOR_ERROR_FLAG: 12,        // per ERROR flag (capped at 3)
  RECONCILIATION_CONFLICT: 12,
  SCORE_VERDICT_MISMATCH: 10,      // ORS and verdict semantically disagree
  // Pipeline quality
  FINANCIAL_EVIDENCE_WEAK: 10,     // completeness < 30%
  FINANCIAL_EVIDENCE_PARTIAL: 5,   // completeness 30–59%
  DOCUMENT_QUALITY_LOW: 8,         // DCI < 30
  FAIL_OPEN: 8,                    // DPU provenance missing
  LLM_FALLBACK: 5,
  DETERMINISTIC_ONLY: 8,
  EVIDENCE_BASE_THIN: 12,          // evidence count < 5
  // Memory signal
  MEMORY_FRAGILITY: 10,
  // Structural completeness (lower priority)
  MISSING_EVIDENCE_HIGH: 4,        // per High-sensitivity item (capped at 20)
  MISSING_EVIDENCE_MEDIUM: 2,      // per Medium-sensitivity item (capped at 8)
};

// Total cap for structural gap deductions — they cannot dominate the score
const STRUCTURAL_GAP_CAP = 22;

function toResistanceLabel(score: number): VerdictResistanceLabel {
  if (score >= 75) return "Robust";
  if (score >= 50) return "Moderate";
  if (score >= 25) return "Fragile";
  return "Very Fragile";
}

// ─── Challenge factor derivation ──────────────────────────────────────────────

interface ChallengeFactorInput {
  verdict: string;
  ors_score: number;
  flags: EvaluationFlag[];
  contradiction_count: number;
  financial_completeness_pct: number;
  dci_score: number;
  confidence_penalties: ConfidencePenalty[];
  memory_influence: MemoryInfluenceSummary | null | undefined;
  missing_evidence: ReturnType<typeof detectMissingEvidence>["missing_evidence"];
  deal_name: string;
}

function orsBandLabel(ors_score: number): "strong" | "moderate" | "weak" {
  if (ors_score >= 70) return "strong";
  if (ors_score >= 45) return "moderate";
  return "weak";
}

function verdictLabel(verdict: string): string {
  switch (verdict.toUpperCase()) {
    case "GO": return "GO";
    case "NO_GO": return "NO_GO";
    default: return "CONSIDER";
  }
}

function deriveChallengeFactors(input: ChallengeFactorInput): ChallengeFactor[] {
  const factors: ChallengeFactor[] = [];
  const {
    verdict,
    ors_score,
    flags,
    contradiction_count,
    financial_completeness_pct,
    dci_score,
    confidence_penalties,
    memory_influence,
    missing_evidence,
    deal_name,
  } = input;

  const band = orsBandLabel(ors_score);
  const vLabel = verdictLabel(verdict);

  // 1. Contradictions — highest analytical signal
  if (contradiction_count >= 3) {
    factors.push({
      code: "contradiction_cluster",
      severity: "Critical",
      title: "Multiple internal contradictions detected",
      explanation: `${contradiction_count} contradictions were found between extracted claims and structured evidence. The analytical foundation for this verdict is internally inconsistent.`,
      detail: { contradiction_count },
    });
  } else if (contradiction_count === 2) {
    factors.push({
      code: "multi_contradiction",
      severity: "High",
      title: "Multiple contradictions detected",
      explanation: `2 contradictions were detected between narrative claims and structured financial data. Multiple conflicting signals reduce confidence in the extracted verdict.`,
      detail: { contradiction_count },
    });
  } else if (contradiction_count === 1) {
    factors.push({
      code: "single_contradiction",
      severity: "High",
      title: "Contradiction detected",
      explanation: `1 contradiction was detected between narrative claims and structured financial data, reducing confidence in the extracted signals.`,
      detail: { contradiction_count },
    });
  }

  // 2. Critical evaluator flags
  const criticals = flags.filter((f) => f.severity === "CRITICAL");
  for (const f of criticals.slice(0, 2)) {
    factors.push({
      code: "evaluator_critical_flag",
      severity: "Critical",
      title: `Critical evaluation issue: ${f.flag_type}`,
      explanation: f.description,
      detail: { flag_type: f.flag_type, detail: f.detail },
    });
  }

  // 3. Error evaluator flags (only if no criticals, to avoid repetition)
  if (criticals.length === 0) {
    const errors = flags.filter((f) => f.severity === "ERROR");
    for (const f of errors.slice(0, 2)) {
      factors.push({
        code: "evaluator_error_flag",
        severity: "High",
        title: `Evaluation error: ${f.flag_type}`,
        explanation: f.description,
        detail: { flag_type: f.flag_type },
      });
    }
  }

  // 4. Reconciliation conflict (from confidence penalties)
  const hasReconciliationConflict = confidence_penalties.some(
    (p) => p.reason.toLowerCase().includes("reconciliation")
  );
  if (hasReconciliationConflict) {
    factors.push({
      code: "reconciliation_conflict",
      severity: "High",
      title: "Financial reconciliation conflict",
      explanation: "Structured financial data did not reconcile with extracted narrative figures. The financial evidence supporting this verdict is internally inconsistent.",
    });
  }

  // 5. Score / verdict misalignment
  const isGoVerdict = verdict === "GO";
  const isConsider = verdict === "CONSIDER";
  const verdictScoreFlag = flags.find(
    (f) => f.flag_type === "ors_verdict_mismatch" || f.flag_type === "verdict_score_gap"
  );
  if (
    verdictScoreFlag ||
    (isGoVerdict && ors_score < 55) ||
    (isConsider && ors_score < 40)
  ) {
    factors.push({
      code: "score_verdict_misalignment",
      severity: "High",
      title: "Verdict and score are misaligned",
      explanation:
        ors_score < 55 && isGoVerdict
          ? `A GO verdict with ORS ${ors_score} is below the threshold where evidence typically supports strong positive recommendations.`
          : isConsider && ors_score < 40
          ? `A CONSIDER verdict with ORS ${ors_score} is near the NO_GO boundary — the recommendation has limited upside support.`
          : `The quantitative score and narrative verdict point in inconsistent directions.`,
      detail: { ors_score, verdict },
    });
  }

  // 6. Financial evidence weakness
  if (financial_completeness_pct < 30) {
    factors.push({
      code: "financial_evidence_weak",
      severity: "High",
      title: "Financial evidence critically incomplete",
      explanation: `For a ${vLabel} deal with a ${band} score (ORS ${ors_score}), only ${financial_completeness_pct.toFixed(0)}% of expected financial data is present. ${deal_name} depends on assumptions rather than verified financial signals.`,
      detail: { financial_completeness_pct },
    });
  } else if (financial_completeness_pct < 60) {
    factors.push({
      code: "financial_evidence_partial",
      severity: "Medium",
      title: "Financial evidence partially complete",
      explanation: `Financial completeness is ${financial_completeness_pct.toFixed(0)}% — key figures (burn rate, runway, or structured ARR) are missing from ${deal_name}'s documentation and should be confirmed before treating this ${vLabel} as robust.`,
      detail: { financial_completeness_pct },
    });
  }

  // 7. Document quality
  if (dci_score < 30) {
    factors.push({
      code: "document_quality_low",
      severity: "Medium",
      title: "Document quality insufficient for reliable extraction",
      explanation: `Document Confidence Index (DCI) for ${deal_name} is ${dci_score} — below the threshold for reliable extraction at a ${band} ORS level. Signals supporting this ${vLabel} verdict carry elevated uncertainty.`,
      detail: { dci_score },
    });
  }

  // 8. Fail-open conditions
  const failOpenFlag = flags.find((f) => f.flag_type === "dpu_provenance_missing");
  if (failOpenFlag) {
    factors.push({
      code: "fail_open_condition",
      severity: "Medium",
      title: "Document provenance unverified (fail-open)",
      explanation: "The document processing unit ran in fail-open mode — data provenance cannot be confirmed. Results are best-effort.",
    });
  }

  // 9. LLM fallback / deterministic-only
  const detOnly = flags.find((f) => f.flag_type === "deterministic_only_mode");
  const llmFallback = flags.find((f) => f.flag_type === "xlsx_extraction_llm_fallback");
  if (detOnly) {
    factors.push({
      code: "deterministic_only",
      severity: "Medium",
      title: "LLM enrichment stage was skipped",
      explanation: "This analysis ran in deterministic-only mode. Narrative-dependent signals (market framing, team signals) were not extracted.",
    });
  } else if (llmFallback) {
    factors.push({
      code: "llm_fallback",
      severity: "Low",
      title: "XLSX extraction relied on LLM inference",
      explanation: "Structured financial data was partially derived from LLM inference rather than direct spreadsheet parsing. Figures carry higher uncertainty.",
    });
  }

  // 10. Evidence base thin
  const thinEvidenceFlag = flags.find((f) => f.flag_type === "evidence_count_below_floor");
  if (thinEvidenceFlag) {
    factors.push({
      code: "evidence_base_thin",
      severity: "High",
      title: "Evidence base critically thin",
      explanation: `${deal_name} has insufficient evidence for a ${vLabel} verdict at ORS ${ors_score}. ${thinEvidenceFlag.description}`,
    });
  }

  // 11. Memory fragility
  if (memory_influence?.memory_fragility_signal) {
    factors.push({
      code: "memory_fragility",
      severity: "High",
      title: "Similar deals in memory predominantly NO_GO",
      explanation:
        memory_influence.challenge_memory_summary ??
        `Structurally similar deals in the pool have predominantly received NO_GO verdicts, suggesting this CONSIDER assessment may be fragile.`,
      detail: {
        similar_deal_count: memory_influence.similar_deal_count,
        avg_similarity_pct: memory_influence.avg_similarity_pct,
        verdict_agreement_fraction: memory_influence.verdict_agreement_fraction,
      },
    });
  }

  // 12. If nothing analytical was found, record structural gaps as the primary signal.
  // memory_fragility is excluded from this check so structural_gaps_only is produced
  // consistently regardless of whether memory context is present.
  const hasAnalyticalPressure = factors.some(
    (f) =>
      f.code !== "llm_fallback" &&
      f.code !== "deterministic_only" &&
      f.code !== "financial_evidence_partial" &&
      f.code !== "memory_fragility"
  );
  if (!hasAnalyticalPressure && missing_evidence.length > 0) {
    factors.push({
      code: "structural_gaps_only",
      severity: "Low",
      title: "Verdict based on incomplete documentation",
      explanation: `No analytical contradictions or flags were detected, but ${missing_evidence.length} evidence item${missing_evidence.length > 1 ? "s are" : " is"} missing. The verdict is reasonable given available data but cannot be considered high-confidence.`,
      detail: { missing_evidence_count: missing_evidence.length },
    });
  }

  // Sort: Critical → High → Medium → Low
  const ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  factors.sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));

  return factors;
}

// ─── Resistance scoring ───────────────────────────────────────────────────────

function computeResistanceScore(
  flags: EvaluationFlag[],
  contradiction_count: number,
  financial_completeness_pct: number,
  dci_score: number,
  memory_influence: MemoryInfluenceSummary | null | undefined,
  missing_evidence: ReturnType<typeof detectMissingEvidence>["missing_evidence"]
): number {
  let score = 100;

  // Analytical pressure (unbounded per category but collectively large)
  if (contradiction_count >= 3) {
    score -= WEIGHT.CONTRADICTION_CLUSTER;
  } else if (contradiction_count >= 1) {
    score -= WEIGHT.SINGLE_CONTRADICTION;
  }

  const criticals = flags.filter((f) => f.severity === "CRITICAL");
  const errors = flags.filter((f) => f.severity === "ERROR");

  score -= Math.min(criticals.length, 2) * WEIGHT.EVALUATOR_CRITICAL_FLAG;
  score -= Math.min(errors.length, 3) * WEIGHT.EVALUATOR_ERROR_FLAG;

  if (flags.some((f) => f.flag_type === "dci_fhc_gap")) {
    score -= WEIGHT.RECONCILIATION_CONFLICT;
  }
  if (
    flags.some(
      (f) => f.flag_type === "ors_verdict_mismatch" || f.flag_type === "verdict_score_gap"
    )
  ) {
    score -= WEIGHT.SCORE_VERDICT_MISMATCH;
  }

  // Pipeline quality
  if (financial_completeness_pct < 30) {
    score -= WEIGHT.FINANCIAL_EVIDENCE_WEAK;
  } else if (financial_completeness_pct < 60) {
    score -= WEIGHT.FINANCIAL_EVIDENCE_PARTIAL;
  }

  if (dci_score < 30) {
    score -= WEIGHT.DOCUMENT_QUALITY_LOW;
  }

  if (flags.some((f) => f.flag_type === "dpu_provenance_missing")) {
    score -= WEIGHT.FAIL_OPEN;
  }
  if (flags.some((f) => f.flag_type === "deterministic_only_mode")) {
    score -= WEIGHT.DETERMINISTIC_ONLY;
  } else if (flags.some((f) => f.flag_type === "xlsx_extraction_llm_fallback")) {
    score -= WEIGHT.LLM_FALLBACK;
  }
  if (flags.some((f) => f.flag_type === "evidence_count_below_floor")) {
    score -= WEIGHT.EVIDENCE_BASE_THIN;
  }

  // Memory
  if (memory_influence?.memory_fragility_signal) {
    score -= WEIGHT.MEMORY_FRAGILITY;
  }

  // Structural gaps (capped)
  let structuralDeduction = 0;
  for (const item of missing_evidence) {
    if (item.verdict_sensitivity === "High") structuralDeduction += WEIGHT.MISSING_EVIDENCE_HIGH;
    else if (item.verdict_sensitivity === "Medium") structuralDeduction += WEIGHT.MISSING_EVIDENCE_MEDIUM;
  }
  score -= Math.min(structuralDeduction, STRUCTURAL_GAP_CAP);

  return Math.max(0, Math.min(100, score));
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
   * Contradiction count from the extraction pipeline. Used to drive
   * the primary challenge signal — contradictions are the strongest
   * indicator that a verdict may be unreliable.
   */
  contradiction_count?: number;
  /**
   * Financial completeness percentage (0–100). Low values are a material
   * analytical pressure point, not just a documentation gap.
   */
  financial_completeness_pct?: number;
  /**
   * Document Confidence Index. Low DCI means extraction reliability is poor.
   */
  dci_score?: number;
  /**
   * Confidence penalties already computed by the confidence engine.
   * Avoids recomputing them and ensures challenge reasons match confidence reasons.
   */
  confidence_penalties?: ConfidencePenalty[];
  /**
   * Optional: memory influence summary derived from similar deals.
   * When present and fragility signal is active, the opposing case summary
   * is enriched with memory-based context.
   * Memory never rewrites ORS, verdict, or evidence facts.
   */
  memory_influence?: MemoryInfluenceSummary | null;
}

export function runChallengePass(input: ChallengePassInput): ChallengePassResult {
  const {
    deal_id,
    deal_name,
    intelligence_run_id,
    verdict,
    ors_score,
    flags,
    deck_risk_items = [],
    evidence,
    contradiction_count = 0,
    financial_completeness_pct = 100,
    dci_score = 100,
    confidence_penalties = [],
  } = input;

  const { missing_evidence, diligence_gaps } = detectMissingEvidence(evidence);

  const resistance_score = computeResistanceScore(
    flags,
    contradiction_count,
    financial_completeness_pct,
    dci_score,
    input.memory_influence,
    missing_evidence
  );
  const resistance_label = toResistanceLabel(resistance_score);

  const challenge_factors = deriveChallengeFactors({
    verdict,
    ors_score,
    flags,
    contradiction_count,
    financial_completeness_pct,
    dci_score,
    confidence_penalties,
    memory_influence: input.memory_influence,
    missing_evidence,
    deal_name,
  });

  const { opposing_case_summary, overconfident_claims } = buildOpposingCase({
    deal_name,
    verdict,
    ors_score,
    flags,
    deck_risk_items,
    challenge_factors,
    missing_evidence,
    memory_influence: input.memory_influence ?? null,
  });

  const primary_challenge_reason =
    challenge_factors.length > 0
      ? challenge_factors[0].explanation
      : "No material challenge factors detected given available evidence.";

  // Memory enrichment — append to (never replace) the base opposing case
  const memChallengeUsed = input.memory_influence?.challenge_memory_used ?? false;
  const memChallengeSummary = input.memory_influence?.challenge_memory_summary ?? null;

  // Memory fragility is already factored into challenge_factors and opposing_case_summary
  // via buildOpposingCase; the raw signal is kept for the panel's explicit "memory signal" display
  const enrichedOpposingCase =
    memChallengeUsed && memChallengeSummary
      ? `${opposing_case_summary}\n\nMemory signal: ${memChallengeSummary}`
      : opposing_case_summary;

  const contradiction_explanations = buildContradictionExplanations(flags, missing_evidence);

  return {
    deal_id,
    intelligence_run_id,
    verdict_resistance_score: resistance_score,
    verdict_resistance_label: resistance_label,
    primary_challenge_reason,
    opposing_case_summary: enrichedOpposingCase,
    challenge_factors,
    overconfident_claims,
    missing_evidence,
    diligence_gaps,
    flag_count_critical: flags.filter((f) => f.severity === "CRITICAL").length,
    flag_count_error: flags.filter((f) => f.severity === "ERROR").length,
    flag_count_warn: flags.filter((f) => f.severity === "WARN").length,
    memory_challenge_used: memChallengeUsed,
    memory_challenge_summary: memChallengeSummary,
    contradiction_explanations,
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
        memory_challenge_used, memory_challenge_summary,
        primary_challenge_reason, challenge_factors,
        contradiction_explanations)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (deal_id, intelligence_run_id) DO UPDATE SET
       verdict_resistance_score    = EXCLUDED.verdict_resistance_score,
       verdict_resistance_label    = EXCLUDED.verdict_resistance_label,
       opposing_case_summary       = EXCLUDED.opposing_case_summary,
       overconfident_claims        = EXCLUDED.overconfident_claims,
       missing_evidence            = EXCLUDED.missing_evidence,
       diligence_gaps              = EXCLUDED.diligence_gaps,
       flag_count_critical         = EXCLUDED.flag_count_critical,
       flag_count_error            = EXCLUDED.flag_count_error,
       flag_count_warn             = EXCLUDED.flag_count_warn,
       memory_challenge_used       = EXCLUDED.memory_challenge_used,
       memory_challenge_summary    = EXCLUDED.memory_challenge_summary,
       primary_challenge_reason    = EXCLUDED.primary_challenge_reason,
       challenge_factors           = EXCLUDED.challenge_factors,
       contradiction_explanations  = EXCLUDED.contradiction_explanations,
       updated_at                  = now()`,
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
      result.primary_challenge_reason,
      JSON.stringify(result.challenge_factors),
      JSON.stringify(result.contradiction_explanations),
    ]
  );
}
