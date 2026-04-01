/**
 * Evaluation Engine — Types
 */

import type { EvaluationSeverity } from "../types.js";

// ─── Flag types ───────────────────────────────────────────────────────────────

export type EvaluationFlagType =
  // Contradiction checker
  | "revenue_narrative_vs_structured"
  | "stage_mismatch"
  | "burn_direction_inconsistency"
  | "verdict_score_gap"
  // Evidence coverage
  | "section_no_evidence"
  | "critical_claim_no_provenance"
  | "evidence_count_below_floor"
  // Score consistency
  | "ors_verdict_mismatch"
  | "dci_fhc_gap"
  | "urss_verdict_mismatch"
  | "fundability_suppressed"
  // Staleness
  | "llm_cache_stale"
  | "evidence_predates_document"
  | "analysis_version_mismatch"
  // Fail-open
  | "dpu_provenance_missing"
  | "xlsx_extraction_llm_fallback"
  | "evidence_gate_failed_open"
  | "vision_zero_regions"
  // Missing sections
  | "zero_sections_produced"
  | "required_section_absent"
  | "deterministic_only_mode"
  // Overconfidence
  | "high_confidence_low_evidence"
  | "high_confidence_with_contradictions"
  | "dci_too_low_for_financial_confidence";

export interface EvaluationFlag {
  flag_id: string;           // deterministic: sha256-prefix of (deal_id + type + source_stage)
  deal_id: string;
  flag_type: EvaluationFlagType;
  severity: EvaluationSeverity;
  source_stage: string;      // e.g., "stage-3-llm", "extraction-xlsx"
  impacted_score: string | null;   // "ors" | "dci" | "fhc" | "urss" | null
  description: string;
  detail: Record<string, unknown>;
  resolution_status: "open";
}

// ─── Evaluator input ──────────────────────────────────────────────────────────

export interface EvaluatorInput {
  deal_id: string;
  run_id: string;

  // Scores
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  verdict: string;
  scoreband_key: string;

  // Evidence
  evidence_count: number;
  contradiction_count: number;
  section_count: number;

  // Flags from pipeline
  dpu_provenance_missing: boolean;
  xlsx_extraction_had_llm_fallback: boolean;
  evidence_gate_passed: boolean;
  investor_insights_status: string;  // "complete" | "deterministic_only" | etc.

  // LLM cache metadata
  llm_cache_age_days: number | null;

  // Financial signals
  arr_narrative: number | null;    // from narration
  arr_structured: number | null;   // from financial_facts_v1
  financial_completeness_pct: number;

  // Optional: section-level evidence counts (section_key -> count)
  section_evidence_counts?: Record<string, number>;
}

// ─── Evaluator output ─────────────────────────────────────────────────────────

export interface EvaluatorReport {
  deal_id: string;
  run_id: string;
  flags: EvaluationFlag[];
  summary: {
    total_flags: number;
    critical_count: number;
    error_count: number;
    warn_count: number;
    info_count: number;
    clean: boolean;
  };
}
