/**
 * Correction Lineage V1
 *
 * Immutable audit trail of every correction proposed by the LLM auditing
 * system. Each item records who proposed what, what the validator decided,
 * and whether the correction was applied to scoring.
 *
 * Phase 1: Types only. No corrections are applied to scoring in Phase 1.
 * Phase 3+: The validator may flip applied_to_scoring to true after the
 *   validator pipeline is wired.
 *
 * INVARIANT: applied_to_scoring is ALWAYS false in Phase 1 and Phase 2.
 */

export type CorrectionLineageSource =
  | 'llm_field_audit'
  | 'llm_financial_verification'
  | 'human_review'
  | 'deterministic_validator';

export type CorrectionLineageValidatorStatus =
  | 'accepted'
  | 'rejected'
  | 'needs_review'
  | 'shadow_only';

export type CorrectionLineageItem = {
  /** Stable UUID for this correction record */
  correction_id: string;
  source: CorrectionLineageSource;
  original_field: string;
  original_value: unknown;
  proposed_field: string;
  proposed_value: unknown;
  normalized_value: unknown;
  correction_type: string;
  /** 0–1 confidence in the proposed correction */
  confidence: number;
  evidence_refs: string[];
  validator_status: CorrectionLineageValidatorStatus;
  /** Reason for rejection — null unless status === 'rejected' */
  validator_reason: string | null;
  /**
   * Whether this correction has been applied to scoring.
   * ALWAYS false in Phase 1 and Phase 2.
   * Set to true only when the Phase 3 validator pipeline is wired.
   */
  applied_to_scoring: boolean;
  /** ISO timestamp when applied — null until applied_to_scoring becomes true */
  applied_at: string | null;
};

export type CorrectionLineageV1 = {
  schema_version: 'correction_lineage_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  corrections: CorrectionLineageItem[];
};
