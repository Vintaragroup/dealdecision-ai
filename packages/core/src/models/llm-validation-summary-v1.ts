/**
 * LLM Validation Summary V1
 *
 * Aggregate statistics produced by the DeterministicCorrectionValidatorV1 after
 * it has reviewed all LLM auditor proposals for a single analysis run.
 *
 * Phase 3: First populated by the validator. Stored as an optional slot on the
 * compiled ReportDTO alongside correction_lineage_v1.
 *
 * AUTHORITY RULE: This summary is observational only. Its counts and flags do
 * NOT affect scoring, verdicts, conviction, or any deterministic report field.
 */

export type LLMValidationSummaryV1 = {
  schema_version: 'llm_validation_summary_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;

  // ── Proposal counts ──────────────────────────────────────────────────────
  /** Total correction proposals received from all LLM auditor modules */
  total_proposals: number;
  /** Proposals auto-accepted by the deterministic validator (Rule Class A) */
  accepted: number;
  /** Proposals rejected by the deterministic validator (Rule Class C) */
  rejected: number;
  /** Proposals requiring manual or future review (Rule Class B) */
  needs_review: number;
  /** Proposals left in shadow_only state (low confidence, no evidence refs) */
  shadow_only: number;

  // ── Semantic conflict counts ─────────────────────────────────────────────
  /** Proposals where LLM detected a high-confidence disagreement with deterministic output */
  high_confidence_disagreements: number;
  /** Proposals involving financial type misclassification (e.g. market sizing as revenue) */
  financial_semantic_conflicts: number;
  /** Proposals involving a contradiction that the LLM flagged as likely false positive */
  contradiction_false_positives: number;
  /** Proposals involving archetype mismatch */
  archetype_disagreements: number;
  /** Proposals involving policy mismatch */
  policy_disagreements: number;
  /** Unique schema gap categories identified across all modules */
  schema_gap_count: number;

  // ── Output ───────────────────────────────────────────────────────────────
  /** Total learning events emitted by the validator this run */
  generated_learning_events: number;

  // ── Review readiness ─────────────────────────────────────────────────────
  /** At least one accepted correction exists and warrants human awareness */
  requires_human_review: boolean;
  /** Priority for human review: null if requires_human_review is false */
  review_priority: 'low' | 'medium' | 'high' | null;
  /** Reason for human review requirement — null if not required */
  review_reason: string | null;
};
