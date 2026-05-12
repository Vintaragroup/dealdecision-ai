/**
 * Learning Event V1
 *
 * Structured record of a single learning signal detected by the LLM Auditing
 * system. Emitted by any auditor module or human reviewer. Stored in the
 * learning_events DB table for systematic tracking and resolution.
 *
 * Phase 1: Type definition and DB table (via migration). No events are
 *   emitted yet — the emitter functions are noop stubs in Phase 1.
 * Phase 2+: Auditor modules emit events via recordLearningEvent().
 */

export type LearningEventType =
  | 'field_misclassification'
  | 'wrong_archetype'
  | 'wrong_policy'
  | 'financial_semantic_error'
  | 'contradiction_false_positive'
  | 'weak_rationale'
  | 'ui_semantic_confusion'
  | 'schema_gap'
  | 'llm_correction_proposed'
  | 'llm_correction_accepted'
  | 'llm_correction_rejected';

export type LearningEventSeverity = 'low' | 'medium' | 'high' | 'critical';

export type LearningEventSource =
  | 'deterministic'
  | 'llm_auditor'
  | 'human_review'
  | 'regression_test'
  | 'ui_feedback';

export type LearningEventStatus = 'open' | 'reviewed' | 'resolved' | 'ignored';

export type LearningEventV1 = {
  /** UUID — matches the primary key in learning_events DB table */
  id: string;
  deal_id: string | null;
  /** Matches analysis_version / report_id from ingestion_reports */
  run_id: string | null;
  event_type: LearningEventType;
  severity: LearningEventSeverity;
  source: LearningEventSource;
  /** Freeform payload specific to the event_type */
  payload: Record<string, unknown>;
  /** Evidence item IDs related to this event */
  evidence_refs: string[];
  status: LearningEventStatus;
  created_at: string;
  reviewed_at: string | null;
  resolved_at: string | null;
  /** Optional reviewer notes — populated after human review */
  review_notes?: string | null;
};
