/**
 * Correction Lineage V1
 *
 * Immutable audit trail of every correction proposed by the LLM auditing
 * system. Each item records who proposed what, what the validator decided,
 * and whether the correction was applied to scoring.
 *
 * runDeterministicCorrectionValidatorV1() itself always returns
 * applied_to_scoring: false — the validator only decides accept/reject/
 * needs_review/shadow_only, it never applies anything. applied_to_scoring
 * becomes true only downstream, in
 * apps/worker/src/lib/intelligence/apply-financial-corrections.ts, which is
 * called from apps/worker/src/jobs/analyze-deal/processor.ts pre-scoring for
 * corrections that are source: 'llm_financial_verification' AND
 * validator_status: 'accepted'. All other sources/statuses remain
 * informational (applied_to_scoring stays false).
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
