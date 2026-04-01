/**
 * Stage 5 — Intelligence Pass
 *
 * Non-blocking post-analysis stage that runs the full intelligence layer:
 *   1. Decision Memory (persist + recall similar deals)
 *   2. Evaluation Engine (flag contradictions, evidence gaps, fail-opens)
 *   3. Confidence Engine (earned confidence score)
 *   4. Challenge Pass (opposing case + verdict resistance)
 *
 * Gated by env var DDAI_INTELLIGENCE_LAYER_ENABLED=1.
 * Rollout mode controlled by DDAI_INTELLIGENCE_ROLLOUT_MODE:
 *   "off"           — disabled (same as ENABLED=0)
 *   "shadow"        — run subsystems + log, do NOT persist artifacts
 *   "persist_only"  — run + persist artifacts, output not exposed downstream
 *   "internal_expose" — run + persist + make available for debug/admin surfaces
 *   "full"          — fully integrated (default when ENABLED=1, mode not set)
 *
 * Never throws — errors are captured in stage5_error and logged.
 *
 * Returns IntelligencePassResult (always), stage5_error=null on success.
 */

import { randomUUID } from "crypto";
import type { Pool } from "pg";

import type { IntelligencePassResult } from "../../../lib/intelligence/types.js";

import { buildMemorySnapshot, persistAndRecallMemory } from "../../../lib/intelligence/decision-memory/service.js";
import { runEvaluatorPass, persistEvaluationFlags } from "../../../lib/intelligence/evaluation-engine/service.js";
import { computeConfidence, persistConfidenceReport } from "../../../lib/intelligence/confidence-engine/service.js";
import { runChallengePass, persistChallengePassResult } from "../../../lib/intelligence/challenge-pass/service.js";
import { intelligenceMetrics } from "../../../lib/intelligence/metrics.js";

// ─── Rollout mode ─────────────────────────────────────────────────────────────

export type IntelligenceRolloutMode =
  | "off"
  | "shadow"
  | "persist_only"
  | "internal_expose"
  | "full";

/**
 * Resolve the current rollout mode from environment variables.
 *
 * Priority:
 *  1. DDAI_INTELLIGENCE_LAYER_ENABLED != "1"   → "off"
 *  2. DDAI_INTELLIGENCE_ROLLOUT_MODE env var   → use value if valid, else "full"
 *  3. Default when ENABLED=1 but no mode set   → "full"
 */
export function resolveRolloutMode(): IntelligenceRolloutMode {
  if (process.env.DDAI_INTELLIGENCE_LAYER_ENABLED !== "1") return "off";
  const raw = process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE ?? "";
  const valid: IntelligenceRolloutMode[] = [
    "off",
    "shadow",
    "persist_only",
    "internal_expose",
    "full",
  ];
  return (valid.includes(raw as IntelligenceRolloutMode)
    ? raw
    : "full") as IntelligenceRolloutMode;
}

function isEnabled(): boolean {
  return resolveRolloutMode() !== "off";
}

function shouldPersist(mode: IntelligenceRolloutMode): boolean {
  return mode === "persist_only" || mode === "internal_expose" || mode === "full";
}

// ─── Empty/no-op result ───────────────────────────────────────────────────────

function disabledResult(deal_id: string): IntelligencePassResult {
  return {
    run_id: "",
    deal_id,
    memory_snapshot_id: null,
    similar_deals: [],
    evaluator_report: {
      deal_id,
      run_id: "",
      flags: [],
      summary: {
        total_flags: 0,
        critical_count: 0,
        error_count: 0,
        warn_count: 0,
        info_count: 0,
        clean: true,
      },
    },
    confidence_report: {
      deal_id,
      intelligence_run_id: "",
      overall_confidence_score: 100,
      overall_confidence_band: "High",
      penalties_applied: [],
      conclusions: [],
      rationale: "Intelligence layer disabled.",
    },
    challenge_pass_result: {
      deal_id,
      intelligence_run_id: "",
      verdict_resistance_score: 100,
      verdict_resistance_label: "Robust",
      opposing_case_summary: "Intelligence layer disabled.",
      overconfident_claims: [],
      missing_evidence: [],
      diligence_gaps: [],
      flag_count_critical: 0,
      flag_count_error: 0,
      flag_count_warn: 0,
    },
    stage5_error: null,
  };
}

// ─── Stage inputs ──────────────────────────────────────────────────────────────

export interface Stage5Inputs {
  deal_id: string;
  deal_name: string;
  org_id: string | null;
  engine_version: string;
  upstream_fingerprint: string;

  // Scores + verdict
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  verdict: string;
  scoreband_key: string;

  // Evidence signals
  evidence_count: number;
  contradiction_count: number;
  section_count: number;

  // Pipeline health signals
  dpu_provenance_missing: boolean;
  xlsx_extraction_had_llm_fallback: boolean;
  evidence_gate_passed: boolean;
  investor_insights_status: string;

  // LLM cache metadata
  llm_cache_age_days: number | null;

  // Financial signals
  arr_narrative: number | null;
  arr_structured: number | null;
  burn_rate_monthly: number | null;
  runway_months: number | null;
  cash_on_hand: number | null;
  financial_completeness_pct: number;
  has_xlsx: boolean;
  has_cap_table: boolean;

  // Optional per-section evidence breakdown
  section_evidence_counts?: Record<string, number>;

  // Deck-sourced risk items (optional)
  deck_risk_items?: string[];
}

// ─── Main stage entry point ───────────────────────────────────────────────────

export async function runIntelligenceStage(
  pool: Pool,
  inputs: Stage5Inputs
): Promise<IntelligencePassResult> {
  const mode = resolveRolloutMode();

  if (mode === "off") {
    intelligenceMetrics.increment("stage5_skipped");
    console.log(
      JSON.stringify({
        event: "intelligence.stage5.skipped",
        deal_id: inputs.deal_id,
        reason: "feature_flag_off",
        ts: new Date().toISOString(),
      })
    );
    return disabledResult(inputs.deal_id);
  }

  const run_id = randomUUID();
  const stageStartMs = Date.now();

  intelligenceMetrics.increment("stage5_runs");
  if (mode === "shadow") intelligenceMetrics.increment("stage5_shadow_runs");
  if (mode === "persist_only") intelligenceMetrics.increment("stage5_persist_only_runs");

  console.log(
    JSON.stringify({
      event: "intelligence.stage5.started",
      deal_id: inputs.deal_id,
      run_id,
      rollout_mode: mode,
      ts: new Date().toISOString(),
    })
  );

  const persist = shouldPersist(mode);

  try {
    // ── 1. Decision Memory ────────────────────────────────────────────────────
    const memStart = Date.now();
    const snapshot = buildMemorySnapshot({
      deal_id: inputs.deal_id,
      org_id: inputs.org_id,
      analysis_version: 1,
      engine_version: inputs.engine_version,
      upstream_fingerprint: inputs.upstream_fingerprint,
      ors_score: inputs.ors_score,
      dci_score: inputs.dci_score,
      fhc_score: inputs.fhc_score,
      urss_score: inputs.urss_score,
      scoreband_key: inputs.scoreband_key,
      verdict: inputs.verdict,
      stage: "Unknown",
      sector: null,
      arr_value: inputs.arr_structured,
      mrr_value: null,
      burn_rate_monthly: inputs.burn_rate_monthly,
      runway_months: inputs.runway_months,
      raise_amount: null,
      evidence_count: inputs.evidence_count,
      contradiction_count: inputs.contradiction_count,
      key_risk_count: 0,
      key_strength_count: 0,
      financial_completeness_pct: inputs.financial_completeness_pct,
      document_quality_score: inputs.dci_score,
      has_xlsx: inputs.has_xlsx,
    });

    let memory_snapshot_id: string | null = null;
    let similar_deals: import("../../../lib/intelligence/decision-memory/types.js").SimilarDeal[] = [];

    if (persist) {
      try {
        const memResult = await persistAndRecallMemory(pool, snapshot);
        memory_snapshot_id = memResult.memory_snapshot_id;
        similar_deals = memResult.similar_deals;
        intelligenceMetrics.increment("memory_writes");
        console.log(
          JSON.stringify({
            event: "intelligence.memory.persisted",
            deal_id: inputs.deal_id,
            run_id,
            memory_snapshot_id,
            similar_deal_count: similar_deals.length,
            duration_ms: Date.now() - memStart,
            ts: new Date().toISOString(),
          })
        );
      } catch (memErr) {
        intelligenceMetrics.increment("memory_write_failures");
        intelligenceMetrics.increment("persistence_write_failures");
        const errMsg = memErr instanceof Error ? memErr.message : String(memErr);
        console.error(
          JSON.stringify({
            event: "intelligence.persistence.partial_failure",
            subsystem: "decision_memory",
            deal_id: inputs.deal_id,
            run_id,
            error: errMsg,
            ts: new Date().toISOString(),
          })
        );
        // Non-fatal: continue without memory persistence
      }
    } else {
      // shadow mode: build snapshot only, do not persist
      console.log(
        JSON.stringify({
          event: "intelligence.memory.shadow",
          deal_id: inputs.deal_id,
          run_id,
          ors_score: inputs.ors_score,
          ts: new Date().toISOString(),
        })
      );
    }

    // ── 2. Evaluation Engine ──────────────────────────────────────────────────
    const evalStart = Date.now();
    const evaluatorInput: import("../../../lib/intelligence/evaluation-engine/types.js").EvaluatorInput = {
      deal_id: inputs.deal_id,
      run_id,
      ors_score: inputs.ors_score,
      dci_score: inputs.dci_score,
      fhc_score: inputs.fhc_score,
      urss_score: inputs.urss_score,
      verdict: inputs.verdict,
      scoreband_key: inputs.scoreband_key,
      evidence_count: inputs.evidence_count,
      contradiction_count: inputs.contradiction_count,
      section_count: inputs.section_count,
      dpu_provenance_missing: inputs.dpu_provenance_missing,
      xlsx_extraction_had_llm_fallback: inputs.xlsx_extraction_had_llm_fallback,
      evidence_gate_passed: inputs.evidence_gate_passed,
      investor_insights_status: inputs.investor_insights_status,
      llm_cache_age_days: inputs.llm_cache_age_days,
      arr_narrative: inputs.arr_narrative,
      arr_structured: inputs.arr_structured,
      financial_completeness_pct: inputs.financial_completeness_pct,
      section_evidence_counts: inputs.section_evidence_counts,
    };

    const evaluator_report = runEvaluatorPass(evaluatorInput);
    intelligenceMetrics.increment("evaluator_runs");
    intelligenceMetrics.increment("evaluator_flag_critical", evaluator_report.summary.critical_count);
    intelligenceMetrics.increment("evaluator_flag_error", evaluator_report.summary.error_count);
    intelligenceMetrics.increment("evaluator_flag_warn", evaluator_report.summary.warn_count);
    intelligenceMetrics.increment("evaluator_flag_info", evaluator_report.summary.info_count);

    console.log(
      JSON.stringify({
        event: "intelligence.evaluation.completed",
        deal_id: inputs.deal_id,
        run_id,
        total_flags: evaluator_report.summary.total_flags,
        critical_count: evaluator_report.summary.critical_count,
        error_count: evaluator_report.summary.error_count,
        warn_count: evaluator_report.summary.warn_count,
        info_count: evaluator_report.summary.info_count,
        clean: evaluator_report.summary.clean,
        duration_ms: Date.now() - evalStart,
        ts: new Date().toISOString(),
      })
    );

    if (persist) {
      try {
        await persistEvaluationFlags(pool, evaluator_report.flags, run_id);
      } catch (flagErr) {
        intelligenceMetrics.increment("persistence_write_failures");
        console.error(
          JSON.stringify({
            event: "intelligence.persistence.partial_failure",
            subsystem: "evaluation_flags",
            deal_id: inputs.deal_id,
            run_id,
            error: flagErr instanceof Error ? flagErr.message : String(flagErr),
            ts: new Date().toISOString(),
          })
        );
        // Non-fatal: continue
      }
    }

    // ── 3. Confidence Engine ──────────────────────────────────────────────────
    const confStart = Date.now();
    const confidenceInput: import("../../../lib/intelligence/confidence-engine/types.js").ConfidenceInput = {
      deal_id: inputs.deal_id,
      intelligence_run_id: run_id,
      evaluator_critical_count: evaluator_report.summary.critical_count,
      evaluator_error_count: evaluator_report.summary.error_count,
      contradiction_count: inputs.contradiction_count,
      evidence_count: inputs.evidence_count,
      dpu_provenance_missing: inputs.dpu_provenance_missing,
      xlsx_extraction_had_llm_fallback: inputs.xlsx_extraction_had_llm_fallback,
      financial_completeness_pct: inputs.financial_completeness_pct,
      dci_score: inputs.dci_score,
      llm_cache_age_days: inputs.llm_cache_age_days,
      investor_insights_status: inputs.investor_insights_status,
      has_reconciliation_conflict: evaluator_report.flags.some(
        (f) => f.flag_type === "dci_fhc_gap"
      ),
      arr_structured: inputs.arr_structured,
      burn_rate_monthly: inputs.burn_rate_monthly,
    };

    const confidence_report = computeConfidence(confidenceInput);
    intelligenceMetrics.increment("confidence_runs");
    if (confidence_report.overall_confidence_band === "Low") {
      intelligenceMetrics.increment("confidence_low_count");
    } else if (confidence_report.overall_confidence_band === "Medium") {
      intelligenceMetrics.increment("confidence_medium_count");
    } else {
      intelligenceMetrics.increment("confidence_high_count");
    }

    console.log(
      JSON.stringify({
        event: "intelligence.confidence.computed",
        deal_id: inputs.deal_id,
        run_id,
        overall_confidence_score: confidence_report.overall_confidence_score,
        overall_confidence_band: confidence_report.overall_confidence_band,
        penalty_count: confidence_report.penalties_applied.length,
        total_penalty: confidence_report.penalties_applied.reduce(
          (sum, p) => sum + p.penalty,
          0
        ),
        duration_ms: Date.now() - confStart,
        ts: new Date().toISOString(),
      })
    );

    if (persist) {
      try {
        await persistConfidenceReport(pool, confidence_report);
      } catch (confErr) {
        intelligenceMetrics.increment("persistence_write_failures");
        console.error(
          JSON.stringify({
            event: "intelligence.persistence.partial_failure",
            subsystem: "confidence_report",
            deal_id: inputs.deal_id,
            run_id,
            error: confErr instanceof Error ? confErr.message : String(confErr),
            ts: new Date().toISOString(),
          })
        );
        // Non-fatal: continue
      }
    }

    // ── 4. Challenge Pass ─────────────────────────────────────────────────────
    const chalStart = Date.now();
    const missingEvidenceInput: import("../../../lib/intelligence/challenge-pass/missing-evidence-detector.js").MissingEvidenceInput = {
      arr_structured: inputs.arr_structured,
      burn_rate_monthly: inputs.burn_rate_monthly,
      runway_months: inputs.runway_months,
      cash_on_hand: inputs.cash_on_hand,
      has_xlsx: inputs.has_xlsx,
      has_cap_table: inputs.has_cap_table,
      evidence_count: inputs.evidence_count,
      evidence_sections_covered: inputs.section_count,
    };

    const challenge_pass_result = runChallengePass({
      deal_id: inputs.deal_id,
      deal_name: inputs.deal_name,
      intelligence_run_id: run_id,
      verdict: inputs.verdict,
      ors_score: inputs.ors_score,
      flags: evaluator_report.flags,
      deck_risk_items: inputs.deck_risk_items,
      evidence: missingEvidenceInput,
    });

    intelligenceMetrics.increment("challenge_pass_runs");
    if (
      challenge_pass_result.verdict_resistance_label === "Fragile" ||
      challenge_pass_result.verdict_resistance_label === "Very Fragile"
    ) {
      intelligenceMetrics.increment("challenge_pass_fragile");
    }

    console.log(
      JSON.stringify({
        event: "intelligence.challenge.completed",
        deal_id: inputs.deal_id,
        run_id,
        verdict_resistance_score: challenge_pass_result.verdict_resistance_score,
        verdict_resistance_label: challenge_pass_result.verdict_resistance_label,
        missing_evidence_count: challenge_pass_result.missing_evidence.length,
        overconfident_claims_count: challenge_pass_result.overconfident_claims.length,
        diligence_gaps_count: challenge_pass_result.diligence_gaps.length,
        duration_ms: Date.now() - chalStart,
        ts: new Date().toISOString(),
      })
    );

    if (persist) {
      try {
        await persistChallengePassResult(pool, challenge_pass_result);
      } catch (chalErr) {
        intelligenceMetrics.increment("persistence_write_failures");
        console.error(
          JSON.stringify({
            event: "intelligence.persistence.partial_failure",
            subsystem: "challenge_pass",
            deal_id: inputs.deal_id,
            run_id,
            error: chalErr instanceof Error ? chalErr.message : String(chalErr),
            ts: new Date().toISOString(),
          })
        );
        // Non-fatal: continue
      }
    }

    // ── Summary log ───────────────────────────────────────────────────────────
    const totalDurationMs = Date.now() - stageStartMs;
    intelligenceMetrics.increment("stage5_successes");
    intelligenceMetrics.timing("stage5.duration_ms", totalDurationMs);

    console.log(
      JSON.stringify({
        event: "intelligence.stage5.completed",
        deal_id: inputs.deal_id,
        run_id,
        rollout_mode: mode,
        persisted: persist,
        total_flags: evaluator_report.summary.total_flags,
        confidence_score: confidence_report.overall_confidence_score,
        confidence_band: confidence_report.overall_confidence_band,
        verdict_resistance: challenge_pass_result.verdict_resistance_score,
        verdict_resistance_label: challenge_pass_result.verdict_resistance_label,
        similar_deal_count: similar_deals.length,
        memory_snapshot_id,
        duration_ms: totalDurationMs,
        ts: new Date().toISOString(),
      })
    );

    return {
      run_id,
      deal_id: inputs.deal_id,
      memory_snapshot_id,
      similar_deals,
      evaluator_report,
      confidence_report,
      challenge_pass_result,
      stage5_error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const totalDurationMs = Date.now() - stageStartMs;

    intelligenceMetrics.increment("stage5_failures");
    intelligenceMetrics.timing("stage5.duration_ms", totalDurationMs);

    console.error(
      JSON.stringify({
        event: "intelligence.stage5.failed",
        deal_id: inputs.deal_id,
        run_id,
        rollout_mode: mode,
        error: errorMsg,
        duration_ms: totalDurationMs,
        ts: new Date().toISOString(),
      })
    );

    return {
      run_id,
      deal_id: inputs.deal_id,
      memory_snapshot_id: null,
      similar_deals: [],
      evaluator_report: {
        deal_id: inputs.deal_id,
        run_id,
        flags: [],
        summary: {
          total_flags: 0, critical_count: 0, error_count: 0, warn_count: 0, info_count: 0, clean: true,
        },
      },
      confidence_report: {
        deal_id: inputs.deal_id,
        intelligence_run_id: run_id,
        overall_confidence_score: 100,
        overall_confidence_band: "High",
        penalties_applied: [],
        conclusions: [],
        rationale: "Stage 5 error — see logs.",
      },
      challenge_pass_result: {
        deal_id: inputs.deal_id,
        intelligence_run_id: run_id,
        verdict_resistance_score: 100,
        verdict_resistance_label: "Robust",
        opposing_case_summary: "Stage 5 error — see logs.",
        overconfident_claims: [],
        missing_evidence: [],
        diligence_gaps: [],
        flag_count_critical: 0,
        flag_count_error: 0,
        flag_count_warn: 0,
      },
      stage5_error: errorMsg,
    };
  }
}

