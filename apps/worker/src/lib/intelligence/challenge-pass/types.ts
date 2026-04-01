/**
 * Challenge Pass — Types
 */

export type VerdictResistanceLabel =
  | "Robust"       // ≥ 75
  | "Moderate"     // 50–74
  | "Fragile"      // 25–49
  | "Very Fragile" // < 25

export type EvidenceSensitivity = "High" | "Medium" | "Low";

export interface MissingEvidenceItem {
  evidence_type: string;
  description: string;
  verdict_sensitivity: EvidenceSensitivity;
  diligence_question: string;
}

export interface DiligenceGap {
  gap_id: string;
  category: "financial" | "team" | "market" | "product" | "legal";
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

export interface ChallengePassResult {
  deal_id: string;
  intelligence_run_id: string;
  verdict_resistance_score: number;
  verdict_resistance_label: VerdictResistanceLabel;
  opposing_case_summary: string;
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
}
