/**
 * LLM Rationale Validation V1
 *
 * Records the output of the Rationale Validator module: whether the
 * LLM-generated decision rationale is internally consistent, evidence-backed,
 * and free from backend jargon before it reaches the UI.
 *
 * Phase 1: Types only. No LLM or rule-based calls are made in Phase 1.
 * Phase 2+: The Rationale Validator job populates this structure.
 *
 * AUTHORITY RULE: Even a 'passed' validation does NOT permit the rationale to
 * alter the deterministic verdict. Validation gates UI display only.
 */

export type RationaleCheckResult = 'pass' | 'fail' | 'warning';

export type RationaleValidationStatus =
  | 'passed'
  | 'failed'
  | 'needs_review';

export type LLMRationaleValidationV1 = {
  schema_version: 'llm_rationale_validation_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  model?: string | null;
  provider?: string | null;
  /** Fingerprint of the rationale that was validated */
  rationale_run_id: string | null;
  /** Does the rationale correctly reflect the deterministic verdict? */
  verdict_alignment: RationaleCheckResult;
  /** Are claims traceable to evidence? */
  evidence_alignment: RationaleCheckResult;
  /** Are backend/internal terms absent? */
  jargon_check: RationaleCheckResult;
  /** Are financial claims consistent with deterministic extraction? */
  financial_claim_check: RationaleCheckResult;
  /** Claims in the rationale that are not supported by extracted evidence */
  unsupported_claims: string[];
  /** Backend or internal terms found in the rationale text */
  backend_jargon_found: string[];
  /** Projected values presented as actuals */
  projected_as_actual_warnings: string[];
  /** Suggested edits to bring the rationale into compliance */
  recommended_edits: string[];
  overall_status: RationaleValidationStatus;
};
