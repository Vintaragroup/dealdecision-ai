/**
 * Evaluation Engine — Service
 *
 * Composes all 6 checkers into a single evaluator pass.
 * Returns a structured EvaluatorReport.
 */

import { createHash } from "crypto";
import type { EvaluatorInput, EvaluatorReport, EvaluationFlag } from "./types.js";
import { runContradictionChecker } from "./contradiction-checker.js";
import { runEvidenceCoverageChecker } from "./evidence-coverage-checker.js";
import { runScoreConsistencyChecker } from "./score-consistency-checker.js";
import { runStalenessChecker } from "./staleness-checker.js";
import { runFailOpenChecker } from "./fail-open-checker.js";
import type { Pool } from "pg";

// ─── persistence ──────────────────────────────────────────────────────────────

export async function persistEvaluationFlags(
  pool: Pool,
  flags: EvaluationFlag[],
  intelligenceRunId: string
): Promise<void> {
  if (flags.length === 0) return;

  const values = flags
    .map(
      (f, i) => `($${i * 10 + 1},$${i * 10 + 2},$${i * 10 + 3},$${i * 10 + 4},$${i * 10 + 5},$${i * 10 + 6},$${i * 10 + 7},$${i * 10 + 8},$${i * 10 + 9},$${i * 10 + 10})`
    )
    .join(",");

  const params: unknown[] = [];
  for (const f of flags) {
    params.push(
      f.flag_id,
      f.deal_id,
      f.flag_type,
      f.severity,
      f.source_stage,
      f.impacted_score,
      f.description,
      JSON.stringify(f.detail),
      f.resolution_status,
      intelligenceRunId
    );
  }

  await pool.query(
    `INSERT INTO deal_evaluation_flags
       (flag_id, deal_id, flag_type, severity, source_stage, impacted_score, description, detail, resolution_status, intelligence_run_id)
     VALUES ${values}
     ON CONFLICT (flag_id) DO UPDATE SET
       severity           = EXCLUDED.severity,
       description        = EXCLUDED.description,
       detail             = EXCLUDED.detail,
       intelligence_run_id = EXCLUDED.intelligence_run_id,
       updated_at         = now()`,
    params
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all evaluator checks and return a structured report.
 * Pure computation: does not write to DB (caller handles persistence).
 */
export function runEvaluatorPass(input: EvaluatorInput): EvaluatorReport {
  const flags: EvaluationFlag[] = [
    ...runContradictionChecker({
      deal_id: input.deal_id,
      verdict: input.verdict,
      ors_score: input.ors_score,
      arr_narrative: input.arr_narrative,
      arr_structured: input.arr_structured,
      contradiction_count: input.contradiction_count,
      arr_truth_state: input.arr_truth_state ?? null,
    }),
    ...runEvidenceCoverageChecker({
      deal_id: input.deal_id,
      evidence_count: input.evidence_count,
      section_count: input.section_count,
      section_evidence_counts: input.section_evidence_counts,
      financial_completeness_pct: input.financial_completeness_pct,
    }),
    ...runScoreConsistencyChecker({
      deal_id: input.deal_id,
      ors_score: input.ors_score,
      dci_score: input.dci_score,
      fhc_score: input.fhc_score,
      urss_score: input.urss_score,
      verdict: input.verdict,
    }),
    ...runStalenessChecker({
      deal_id: input.deal_id,
      llm_cache_age_days: input.llm_cache_age_days,
    }),
    ...runFailOpenChecker({
      deal_id: input.deal_id,
      dpu_provenance_missing: input.dpu_provenance_missing,
      xlsx_extraction_had_llm_fallback: input.xlsx_extraction_had_llm_fallback,
      evidence_gate_passed: input.evidence_gate_passed,
      investor_insights_status: input.investor_insights_status,
    }),
  ];

  const summary = {
    total_flags: flags.length,
    critical_count: flags.filter((f) => f.severity === "CRITICAL").length,
    error_count: flags.filter((f) => f.severity === "ERROR").length,
    warn_count: flags.filter((f) => f.severity === "WARN").length,
    info_count: flags.filter((f) => f.severity === "INFO").length,
    clean: flags.length === 0,
  };

  return {
    deal_id: input.deal_id,
    run_id: input.run_id,
    flags,
    summary,
  };
}
