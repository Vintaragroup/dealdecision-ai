/**
 * LLM Schema Gap V1
 *
 * Records schema gaps detected by the LLM — financial or business data that
 * is present in the source documents but has no appropriate destination field
 * in the current extraction schema.
 *
 * Phase 1: Types only. No LLM calls are made in Phase 1.
 * Phase 2+: The Schema Gap Detector job populates this structure.
 *
 * Gaps are proposals only. They feed the engineering backlog — they do NOT
 * affect scoring, verdicts, or UI in Phase 1 or Phase 2.
 */

export type SchemaGapSeverity = 'low' | 'medium' | 'high';

export type SchemaGapStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'backlog'
  | 'ignored';

export type LLMSchemaGapItem = {
  /** Category of missing data (e.g. 'monthly_churn_rate', 'gross_margin_pct') */
  missing_category: string;
  /** Representative extracted strings showing what was found */
  example_values: string[];
  /** Recommended field path in the extraction schema */
  recommended_field: string;
  /** Recommended parent object (e.g. 'financial_facts', 'structured_summary') */
  recommended_parent_object: string;
  reason: string;
  severity: SchemaGapSeverity;
  evidence_refs: string[];
  status: SchemaGapStatus;
};

export type LLMSchemaGapV1 = {
  schema_version: 'llm_schema_gap_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  model?: string | null;
  provider?: string | null;
  gaps: LLMSchemaGapItem[];
  /** Human-readable summary of detected gaps */
  summary: string | null;
  /** Total count of unique gap categories detected */
  total_gaps: number;
};
