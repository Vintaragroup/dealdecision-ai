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

// Runtime-checkable tuple of all valid modes — kept in sync with the type above.
// NOTE: "active" is NOT a valid IntelligenceRolloutMode and must never be introduced.
// Persist=true modes are: "persist_only", "internal_expose", "full".
const VALID_ROLLOUT_MODES = [
  "off",
  "shadow",
  "persist_only",
  "internal_expose",
  "full",
] as const satisfies readonly IntelligenceRolloutMode[];

function isValidRolloutMode(v: string): v is IntelligenceRolloutMode {
  return (VALID_ROLLOUT_MODES as readonly string[]).includes(v);
}

// Internal assertion: guarantees any resolved mode is a recognized value.
// Throws synchronously — absorbed by Stage 5's outer try/catch so the main
// pipeline is never affected.
function assertRolloutMode(mode: unknown): asserts mode is IntelligenceRolloutMode {
  if (typeof mode !== "string" || !isValidRolloutMode(mode)) {
    throw new Error(
      `[intelligence] Resolved rollout mode "${String(mode)}" is not a recognized IntelligenceRolloutMode`
    );
  }
}

/**
 * Resolve the current rollout mode from environment variables.
 *
 * Priority:
 *  1. DDAI_INTELLIGENCE_LAYER_ENABLED !== "1"  → "off" (covers unset, "0", "false")
 *  2. DDAI_INTELLIGENCE_ROLLOUT_MODE env var   → use if valid, else "full"
 *  3. Default when ENABLED=1 but MODE not set  → "full"
 */
export function resolveRolloutMode(): IntelligenceRolloutMode {
  if (process.env.DDAI_INTELLIGENCE_LAYER_ENABLED !== "1") return "off";
  const raw = process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE ?? "";
  const mode: IntelligenceRolloutMode = isValidRolloutMode(raw) ? raw : "full";
  assertRolloutMode(mode); // dev-time guard — should never fire given the logic above
  return mode;
}

function isEnabled(): boolean {
  return resolveRolloutMode() !== "off";
}

function shouldPersist(mode: IntelligenceRolloutMode): boolean {
  // persist_only, internal_expose, full → true
  // off, shadow → false
  //
  // IMPORTANT: if you add a new mode, update VALID_ROLLOUT_MODES first, then
  // decide whether it should persist and update this function accordingly.
  // NOTE: "active" is NOT a valid mode — per VALID_ROLLOUT_MODES above.
  return mode === "persist_only" || mode === "internal_expose" || mode === "full";
}

// ─── Guards & invariants ──────────────────────────────────────────────────────

/**
 * Small invariant helper. Throws with a readable message in all environments.
 * Used near persistence gates and mode checks inside Stage 5.
 *
 * Throws synchronously so Stage 5's outer try/catch absorbs it — the main
 * pipeline is never affected.
 */
function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[intelligence] Invariant violation: ${message}`);
  }
}

/**
 * Dev-time structured-log field assertion.
 *
 * Validates that required keys are present and forbidden keys are absent before
 * any console.log call. Throws synchronously → absorbed by Stage 5's outer catch.
 *
 * @param eventName     - Label used in error messages.
 * @param payload       - The log payload object.
 * @param reqKeys       - Keys that MUST be present and non-undefined.
 * @param forbiddenKeys - Keys that MUST NOT be present (deprecated aliases etc.)
 */
function assertEventKeys(
  eventName: string,
  payload: object,
  reqKeys: readonly string[],
  forbiddenKeys: readonly string[] = []
): void {
  const p = payload as Record<string, unknown>;
  for (const k of reqKeys) {
    if (!(k in p) || p[k] === undefined) {
      throw new Error(
        `[intelligence] Event "${eventName}" missing required key: "${k}"`
      );
    }
  }
  for (const k of forbiddenKeys) {
    if (k in p) {
      throw new Error(
        `[intelligence] Event "${eventName}" contains forbidden key: "${k}" (deprecated — use the canonical name instead)`
      );
    }
  }
}

// ─── Log payload types ────────────────────────────────────────────────────────
// Explicit TypeScript types for emitted structured-log payloads.
// Prevents silent field renames and makes payload shape auditable in one place.

export interface Stage5SkippedEvent {
  event: "intelligence.stage5.skipped";
  deal_id: string;
  /** Intentionally coarse — covers both ENABLED=0 and MODE="off" paths. */
  reason: "feature_flag_off";
  ts: string;
}

export interface Stage5StartedEvent {
  event: "intelligence.stage5.started";
  deal_id: string;
  run_id: string;
  rollout_mode: IntelligenceRolloutMode;
  ts: string;
}

export interface MemoryShadowEvent {
  event: "intelligence.memory.shadow";
  deal_id: string;
  run_id: string;
  ors_score: number;
  ts: string;
}

/** "flag_count" is a deprecated alias — never emit it. Use "total_flags". */
export interface EvaluationCompletedEvent {
  event: "intelligence.evaluation.completed";
  deal_id: string;
  run_id: string;
  total_flags: number;
  critical_count: number;
  error_count: number;
  warn_count: number;
  info_count: number;
  clean: boolean;
  duration_ms: number;
  ts: string;
}

/**
 * "flag_count" and "total_duration_ms" are deprecated aliases — never emit them.
 * Use "total_flags" and "duration_ms" respectively.
 */
export interface Stage5CompletedEvent {
  event: "intelligence.stage5.completed";
  deal_id: string;
  run_id: string;
  rollout_mode: IntelligenceRolloutMode;
  persisted: boolean;
  total_flags: number;
  confidence_score: number;
  confidence_band: string;
  verdict_resistance: number;
  verdict_resistance_label: string;
  similar_deal_count: number;
  memory_snapshot_id: string | null;
  duration_ms: number;
  ts: string;
}

export interface Stage5FailedEvent {
  event: "intelligence.stage5.failed";
  deal_id: string;
  run_id: string;
  rollout_mode: IntelligenceRolloutMode;
  error: string;
  duration_ms: number;
  ts: string;
}

// ─── Log payload builders ─────────────────────────────────────────────────────
// Centralise field names so accidental renames (e.g. flag_count → total_flags,
// total_duration_ms → duration_ms) are caught by TypeScript rather than
// discovered at runtime in logs.

function buildStage5SkippedEvent(deal_id: string): Stage5SkippedEvent {
  return {
    event: "intelligence.stage5.skipped",
    deal_id,
    reason: "feature_flag_off",
    ts: new Date().toISOString(),
  };
}

function buildStage5StartedEvent(
  deal_id: string,
  run_id: string,
  rollout_mode: IntelligenceRolloutMode
): Stage5StartedEvent {
  return {
    event: "intelligence.stage5.started",
    deal_id,
    run_id,
    rollout_mode,
    ts: new Date().toISOString(),
  };
}

function buildMemoryShadowEvent(
  deal_id: string,
  run_id: string,
  ors_score: number
): MemoryShadowEvent {
  return {
    event: "intelligence.memory.shadow",
    deal_id,
    run_id,
    ors_score,
    ts: new Date().toISOString(),
  };
}

function buildEvaluationCompletedEvent(
  deal_id: string,
  run_id: string,
  summary: {
    total_flags: number;
    critical_count: number;
    error_count: number;
    warn_count: number;
    info_count: number;
    clean: boolean;
  },
  duration_ms: number
): EvaluationCompletedEvent {
  return {
    event: "intelligence.evaluation.completed",
    deal_id,
    run_id,
    total_flags: summary.total_flags,
    critical_count: summary.critical_count,
    error_count: summary.error_count,
    warn_count: summary.warn_count,
    info_count: summary.info_count,
    clean: summary.clean,
    duration_ms,
    ts: new Date().toISOString(),
  };
}

function buildStage5CompletedEvent(params: {
  deal_id: string;
  run_id: string;
  rollout_mode: IntelligenceRolloutMode;
  persisted: boolean;
  total_flags: number;
  confidence_score: number;
  confidence_band: string;
  verdict_resistance: number;
  verdict_resistance_label: string;
  similar_deal_count: number;
  memory_snapshot_id: string | null;
  duration_ms: number;
}): Stage5CompletedEvent {
  return {
    event: "intelligence.stage5.completed",
    ...params,
    ts: new Date().toISOString(),
  };
}

function buildStage5FailedEvent(
  deal_id: string,
  run_id: string,
  rollout_mode: IntelligenceRolloutMode,
  error: string,
  duration_ms: number
): Stage5FailedEvent {
  return {
    event: "intelligence.stage5.failed",
    deal_id,
    run_id,
    rollout_mode,
    error,
    duration_ms,
    ts: new Date().toISOString(),
  };
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
    const skippedPayload = buildStage5SkippedEvent(inputs.deal_id);
    assertEventKeys("intelligence.stage5.skipped", skippedPayload, ["deal_id", "reason", "ts"]);
    console.log(JSON.stringify(skippedPayload));
    return disabledResult(inputs.deal_id);
  }

  const run_id = randomUUID();
  const stageStartMs = Date.now();

  intelligenceMetrics.increment("stage5_runs");
  if (mode === "shadow") intelligenceMetrics.increment("stage5_shadow_runs");
  if (mode === "persist_only") intelligenceMetrics.increment("stage5_persist_only_runs");

  console.log(JSON.stringify(buildStage5StartedEvent(inputs.deal_id, run_id, mode)));

  const persist = shouldPersist(mode);
  // TypeScript confirms mode ≠ "off" here: the "off" branch returned early above.
  // persist reflects whether this mode writes artifacts to storage.

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
        // Non-fatal: stage5_error is NOT set here — only the outer catch sets stage5_error.
      }
    } else {
      // shadow mode: build snapshot only, do not persist
      console.log(JSON.stringify(buildMemoryShadowEvent(inputs.deal_id, run_id, inputs.ors_score)));
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

    const evalPayload = buildEvaluationCompletedEvent(
      inputs.deal_id,
      run_id,
      evaluator_report.summary,
      Date.now() - evalStart
    );
    assertEventKeys(
      "intelligence.evaluation.completed",
      evalPayload,
      ["total_flags", "critical_count", "error_count", "warn_count", "info_count", "clean", "duration_ms"],
      ["flag_count"] // deprecated alias — must never be emitted
    );
    console.log(JSON.stringify(evalPayload));

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
        // Non-fatal: stage5_error is NOT set here — only the outer catch sets stage5_error.
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
        // Non-fatal: stage5_error is NOT set here — only the outer catch sets stage5_error.
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
        // Non-fatal: stage5_error is NOT set here — only the outer catch sets stage5_error.
      }
    }

    // ── Summary log ───────────────────────────────────────────────────────────
    const totalDurationMs = Date.now() - stageStartMs;
    intelligenceMetrics.increment("stage5_successes");
    intelligenceMetrics.timing("stage5.duration_ms", totalDurationMs);

    const completedPayload = buildStage5CompletedEvent({
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
    });
    assertEventKeys(
      "intelligence.stage5.completed",
      completedPayload,
      ["run_id", "rollout_mode", "duration_ms", "total_flags", "confidence_score", "confidence_band", "verdict_resistance", "persisted"],
      ["flag_count", "total_duration_ms"] // deprecated aliases — must never be emitted
    );
    console.log(JSON.stringify(completedPayload));

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
    // Stage-level failure. This is the ONLY place stage5_error is set to a
    // non-null value. Persistence sub-failures are caught by their own inner
    // try/catch blocks and must never surface here or be assigned to stage5_error.
    const errorMsg = err instanceof Error ? err.message : String(err);
    const totalDurationMs = Date.now() - stageStartMs;

    intelligenceMetrics.increment("stage5_failures");
    intelligenceMetrics.timing("stage5.duration_ms", totalDurationMs);

    console.error(JSON.stringify(buildStage5FailedEvent(inputs.deal_id, run_id, mode, errorMsg, totalDurationMs)));

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

