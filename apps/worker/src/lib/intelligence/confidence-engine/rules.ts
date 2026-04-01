/**
 * Confidence Engine — Rules
 *
 * Declarative penalty rules applied during confidence calibration.
 * Pure: no I/O.
 */

import type { ConfidencePenalty } from "./types.js";
import type { ConfidenceInput } from "./types.js";

const LLM_CACHE_STALE_DAYS = 14;
const EVIDENCE_FLOOR = 5;
const EVIDENCE_LOW = 10;

/**
 * Compute all applicable penalties for a given confidence input.
 * Returns the list of penalties applied and the total penalty sum.
 */
export function computePenalties(input: ConfidenceInput): {
  penalties: ConfidencePenalty[];
  total_penalty: number;
} {
  const penalties: ConfidencePenalty[] = [];

  const add = (reason: string, penalty: number) => {
    penalties.push({ reason, penalty });
  };

  // Evaluator CRITICAL flags — up to 70 penalty
  if (input.evaluator_critical_count > 0) {
    const p = Math.min(35 * input.evaluator_critical_count, 70);
    add(`${input.evaluator_critical_count} CRITICAL evaluation flag(s)`, p);
  }

  // Evaluator ERROR flags — up to 40 penalty
  if (input.evaluator_error_count > 0) {
    const p = Math.min(20 * input.evaluator_error_count, 40);
    add(`${input.evaluator_error_count} ERROR evaluation flag(s)`, p);
  }

  // DPU fail-open
  if (input.dpu_provenance_missing) {
    add("DPU provenance missing (fail-open)", 15);
  }

  // XLSX LLM fallback
  if (input.xlsx_extraction_had_llm_fallback) {
    add("XLSX extraction fell back to LLM", 10);
  }

  // Evidence count
  if (input.evidence_count < EVIDENCE_FLOOR) {
    add(`Evidence count critically low (${input.evidence_count} < ${EVIDENCE_FLOOR})`, 20);
  } else if (input.evidence_count < EVIDENCE_LOW) {
    add(`Evidence count below recommended minimum (${input.evidence_count} < ${EVIDENCE_LOW})`, 10);
  }

  // Contradictions
  if (input.contradiction_count >= 3) {
    add(`${input.contradiction_count} contradictions detected`, 35);
  } else if (input.contradiction_count >= 1) {
    add(`${input.contradiction_count} contradiction(s) detected`, 20);
  }

  // Stale LLM cache
  if (input.llm_cache_age_days != null && input.llm_cache_age_days > LLM_CACHE_STALE_DAYS) {
    add(`LLM cache is ${input.llm_cache_age_days}d old (threshold: ${LLM_CACHE_STALE_DAYS}d)`, 10);
  }

  // Missing financial facts
  if (input.financial_completeness_pct < 30) {
    add(`Financial data very incomplete (${input.financial_completeness_pct.toFixed(0)}%)`, 10);
  }

  // Reconciliation conflict
  if (input.has_reconciliation_conflict) {
    add("Financial reconciliation conflict unresolved", 10);
  }

  // Low DCI
  if (input.dci_score < 30) {
    add(`DCI very low (${input.dci_score}) — document quality insufficient`, 15);
  }

  // Deterministic-only mode
  if (input.investor_insights_status === "deterministic_only") {
    add("LLM stage was skipped (deterministic-only mode)", 20);
  }

  const total_penalty = penalties.reduce((sum, p) => sum + p.penalty, 0);

  return { penalties, total_penalty };
}
