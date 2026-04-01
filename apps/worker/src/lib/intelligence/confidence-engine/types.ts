/**
 * Confidence Engine — Types
 */

import type { ConfidenceBand } from "../types.js";
import type { MemoryInfluenceSummary } from "../decision-memory/influence.js";

export type { MemoryInfluenceSummary };

export interface ConfidencePenalty {
  reason: string;
  penalty: number;
}

export interface ConfidenceConclusion {
  conclusion_key: string;      // e.g., "revenue_traction", "burn_sustainability", "overall"
  confidence_score: number;    // 10–100
  confidence_band: ConfidenceBand;
  supporting_evidence_count: number;
  weakening_factors: string[];
  explicit_uncertainty: string | null;  // null if none
}

export interface ConfidenceReport {
  deal_id: string;
  intelligence_run_id: string;
  overall_confidence_score: number;
  overall_confidence_band: ConfidenceBand;
  penalties_applied: ConfidencePenalty[];
  conclusions: ConfidenceConclusion[];
  rationale: string;
  /** Memory adjustment applied after base confidence computation. 0 = no adjustment. */
  memory_adjustment: number;
  /** Human-readable explanation of the memory adjustment (or why none was applied). */
  memory_adjustment_reason: string;
}

export interface ConfidenceInput {
  deal_id: string;
  intelligence_run_id: string;
  evidence_count: number;
  contradiction_count: number;
  dpu_provenance_missing: boolean;
  xlsx_extraction_had_llm_fallback: boolean;
  llm_cache_age_days: number | null;
  financial_completeness_pct: number;
  dci_score: number;
  investor_insights_status: string;
  has_reconciliation_conflict: boolean;
  evaluator_error_count: number;
  evaluator_critical_count: number;
  arr_structured: number | null;
  burn_rate_monthly: number | null;
  /**
   * Optional: memory influence summary derived from similar deals.
   * null or undefined → no memory adjustment applied.
   * Must never be used to overwrite base ORS or extracted facts.
   */
  memory_influence?: MemoryInfluenceSummary | null;
}
