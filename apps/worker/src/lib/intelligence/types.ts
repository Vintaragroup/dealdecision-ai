/**
 * Intelligence Layer — Shared Types
 *
 * Top-level types shared across all intelligence subsystems:
 * decision-memory, evaluation-engine, confidence-engine, challenge-pass,
 * outcome-tracking.
 *
 * All subsystem-specific types are in their own types.ts files.
 */

// ─── Run identity ─────────────────────────────────────────────────────────────

/** A single invocation of the intelligence stage for one deal. */
export interface IntelligenceRunContext {
  run_id: string;
  deal_id: string;
  org_id: string | null;
  analysis_version: number;
  engine_version: string;
  upstream_fingerprint: string;
}

// ─── Shared result container ──────────────────────────────────────────────────

/** Returned by runIntelligenceStage — aggregates all sub-results. */
export interface IntelligencePassResult {
  run_id: string;
  deal_id: string;
  memory_snapshot_id: string | null;
  similar_deals: import("./decision-memory/types.js").SimilarDeal[];
  /**
   * Memory influence summary — derived from similar deals after memory recall.
   * Contains confidence adjustment, fragility/support signals, and challenge
   * memory context. This is an INTERNAL/ADMIN field and must not be exposed
   * directly in public user-facing API responses without review.
   */
  memory_influence_summary: import("./decision-memory/influence.js").MemoryInfluenceSummary | null;
  evaluator_report: import("./evaluation-engine/types.js").EvaluatorReport;
  confidence_report: import("./confidence-engine/types.js").ConfidenceReport;
  challenge_pass_result: import("./challenge-pass/types.js").ChallengePassResult;
  stage5_error: string | null;
}

// ─── Shared confidence band ───────────────────────────────────────────────────

export type ConfidenceBand = "High" | "Medium" | "Low";

export function scoreToConfidenceBand(score: number): ConfidenceBand {
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

// ─── Shared severity ──────────────────────────────────────────────────────────

export type EvaluationSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export const SEVERITY_ORDER: Record<EvaluationSeverity, number> = {
  INFO: 0,
  WARN: 1,
  ERROR: 2,
  CRITICAL: 3,
};

export function maxSeverity(severities: EvaluationSeverity[]): EvaluationSeverity {
  if (severities.length === 0) return "INFO";
  return severities.reduce((a, b) =>
    SEVERITY_ORDER[b] > SEVERITY_ORDER[a] ? b : a
  );
}
