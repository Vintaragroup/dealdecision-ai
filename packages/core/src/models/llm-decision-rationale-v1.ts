/**
 * LLM Decision Rationale V1
 *
 * Structured narrative explaining why the deterministic pipeline produced
 * the canonical verdict it did. The LLM synthesizes this from deterministic
 * signals — it does NOT compute the verdict.
 *
 * Phase 1: Types only. No LLM calls are made in Phase 1.
 * Phase 2+: The Decision Rationale Synthesizer job populates this structure
 *   after the deterministic compiler has finalized the verdict.
 *
 * AUTHORITY RULE: canonical_verdict MUST match the deterministic pipeline
 * output. The LLM cannot override or modify the verdict — it only explains it.
 */

export type DecisionRationaleStatus =
  | 'draft'
  | 'validated'
  | 'rejected'
  | 'shadow_only';

export type LLMDecisionRationaleV1 = {
  schema_version: 'llm_decision_rationale_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  model?: string | null;
  provider?: string | null;
  /** Copied verbatim from the deterministic conviction_v1.recommendation_key */
  canonical_verdict: string;
  /** One-sentence primary reason for the verdict */
  primary_reason: string;
  /** Key blockers that prevented a stronger positive outcome */
  why_not_pass: string[];
  /** Key blockers that prevented outright rejection */
  why_not_reject: string[];
  /** The two or three strongest supporting signals */
  strongest_signals: string[];
  /** Conditions that could change the verdict */
  gating_risks: string[];
  /** Evidence that would materially change conviction if present */
  missing_evidence: string[];
  /** Natural-language explanation of the confidence level */
  confidence_explanation: string;
  evidence_refs: string[];
  /** Notes on the reliability of sources used */
  source_quality_notes: string[];
  /** Backend/internal terms stripped before UI display */
  backend_terms_removed: string[];
  /** Warnings generated during synthesis (e.g. low-confidence inputs) */
  generation_warnings: string[];
  status: DecisionRationaleStatus;
  /** Populated when status === 'validated' — fingerprint of the rationale validator run */
  validation_run_id?: string | null;
};
