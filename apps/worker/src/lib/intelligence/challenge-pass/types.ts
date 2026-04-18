/**
 * Challenge Pass — Types
 */

export type VerdictResistanceLabel =
  | "Robust"       // ≥ 75
  | "Moderate"     // 50–74
  | "Fragile"      // 25–49
  | "Very Fragile" // < 25

export type EvidenceSensitivity = "High" | "Medium" | "Low";

export type ChallengeFactorSeverity = "Critical" | "High" | "Medium" | "Low";

/**
 * Codes for structured challenge factors.
 * Each code maps to a specific analytical weakness — not a generic missing-file label.
 */
export type ChallengeFactorCode =
  | "contradiction_cluster"        // ≥3 contradictions detected
  | "multi_contradiction"          // 2 contradictions
  | "single_contradiction"         // 1 contradiction
  | "evaluator_critical_flag"      // CRITICAL evaluation flag
  | "evaluator_error_flag"         // ERROR evaluation flag
  | "financial_evidence_weak"      // financial completeness < 30%
  | "financial_evidence_partial"   // financial completeness 30–59%
  | "document_quality_low"         // DCI < 30
  | "fail_open_condition"          // DPU provenance missing
  | "llm_fallback"                 // XLSX extraction fell back to LLM
  | "deterministic_only"           // LLM stage skipped entirely
  | "reconciliation_conflict"      // structured vs extracted value conflict
  | "score_verdict_misalignment"    // ORS + verdict disagree
  | "memory_fragility"             // similar deals heavily NO_GO
  | "evidence_base_thin"           // evidence count critically low
  | "structural_gaps_only";        // only missing evidence, no analytical pressure

export interface ChallengeFactor {
  code: ChallengeFactorCode;
  severity: ChallengeFactorSeverity;
  title: string;
  explanation: string;
  /** Optional structured detail for the challenge factor. */
  detail?: Record<string, unknown>;
}

export interface MissingEvidenceItem {
  evidence_type: string;
  description: string;
  verdict_sensitivity: EvidenceSensitivity;
  diligence_question: string;
}

export interface DiligenceGap {
  gap_id: string;
  category: "financial" | "team" | "market" | "product" | "traction" | "legal";
  description: string;
  severity: "Critical" | "Major" | "Minor";
  source_evidence_type: string;
}

export interface OverconfidentClaim {
  claim_text: string;
  source: "deck" | "narrative" | "score";
  challenge_reason: string;
  flag_type?: string;
}

// ─── Contradiction Explanations ───────────────────────────────────────────────

export interface ContradictionSource {
  document: string;
  location: string;
  value: string;
}

export type ContradictionType =
  | "revenue_mismatch"
  | "burn_inconsistency"
  | "growth_conflict"
  | "margin_conflict"
  | "valuation_conflict"
  | "timeline_inconsistency"
  | "unresolved_conflict"
  | "other";

export interface ContradictionExplanation {
  type: ContradictionType;
  title: string;
  explanation: string;
  sources: ContradictionSource[];
}

// ─── Challenge Pass Result ────────────────────────────────────────────────────

export interface ChallengePassResult {
  deal_id: string;
  intelligence_run_id: string;
  verdict_resistance_score: number;
  verdict_resistance_label: VerdictResistanceLabel;
  /**
   * The single most important reason the current verdict might be wrong.
   * Drawn from the highest-severity challenge factor. Never generic.
   */
  primary_challenge_reason: string;
  /**
   * 2–5 sentence opposing case grounded in the top challenge factors.
   * Specific to this deal's detected weaknesses.
   */
  opposing_case_summary: string;
  /**
   * Structured list of analytical pressure points driving the opposition.
   * Ordered by severity descending.
   */
  challenge_factors: ChallengeFactor[];
  overconfident_claims: OverconfidentClaim[];
  missing_evidence: MissingEvidenceItem[];
  diligence_gaps: DiligenceGap[];
  flag_count_critical: number;
  flag_count_error: number;
  flag_count_warn: number;
  /** Whether decision memory was used to enrich the opposing case. */
  memory_challenge_used: boolean;
  /**
   * Memory-derived challenge context appended to the opposing case summary.
   * null when memory was not used (pool too small, similarity too weak, or no
   * fragility signal).
   */
  memory_challenge_summary: string | null;
  /**
   * Human-readable explanations of detected contradictions, grounded in
   * specific source documents and values. Top 3, sorted by financial severity.
   * Empty array when no contradictions detected.
   */
  contradiction_explanations: ContradictionExplanation[];
}
