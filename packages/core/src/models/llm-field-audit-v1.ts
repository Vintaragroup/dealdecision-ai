/**
 * LLM Field Audit V1
 *
 * Records the output of the LLM Field Auditor module: whether deterministic
 * extraction placed values in semantically correct schema fields.
 *
 * Phase 1: Types only. No LLM calls are made in Phase 1.
 * Phase 2+: The LLM Field Auditor job populates this structure before scoring.
 *
 * AUTHORITY RULE: LLM corrections are proposals only. The deterministic
 * validator accepts/rejects them before they may affect scoring.
 */

export type LLMFieldCorrectionType =
  | 'misplaced_field'
  | 'wrong_entity_type'
  | 'wrong_financial_category'
  | 'projection_vs_actual'
  | 'duplicate_or_alias'
  | 'unsupported_value'
  | 'schema_gap';

export type LLMFieldCorrectionStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'needs_review'
  | 'shadow_only';

export type LLMAuditedField = {
  /** Original schema path (e.g. 'financial_facts.revenue') */
  source_field: string;
  /** Original extracted value as string representation */
  source_value: string | number | null;
  /** Proposed corrected schema path */
  proposed_field: string;
  /** Proposed corrected value */
  proposed_value: string | number | null;
  correction_type: LLMFieldCorrectionType;
  /** 0–1 confidence in this correction proposal */
  confidence: number;
  /** Evidence item IDs supporting this proposal */
  evidence_refs: string[];
  /** Human-readable explanation of the proposed correction */
  reason: string;
  /** Validator decision — null until the validator has run */
  status: LLMFieldCorrectionStatus;
  /** Populated when status === 'rejected' */
  rejection_reason?: string;
};

export type LLMFieldRiskFlag = {
  field: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
};

export type LLMFieldAuditV1 = {
  schema_version: 'llm_field_audit_v1';
  deal_id: string;
  /** Matches analysis_version from ingestion_reports */
  run_id: string | null;
  created_at: string;
  /** LLM provider metadata — optional in Phase 1 (all null until Phase 2) */
  model?: string | null;
  provider?: string | null;
  /** Archetype as understood at audit time */
  archetype_at_audit: string | null;
  /** Proposed archetype correction, if the auditor detected a mismatch */
  archetype_correction?: {
    original: string;
    proposed: string;
    confidence: number;
    reason: string;
  } | null;
  audited_fields: LLMAuditedField[];
  risk_flags: LLMFieldRiskFlag[];
  /** Human-readable audit summary */
  summary: string | null;
  /** Overall 0–1 confidence in the audit quality */
  audit_confidence: number | null;
  evidence_count_at_audit: number | null;
};
