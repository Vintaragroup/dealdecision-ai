/**
 * LLM Rationale Validator — Deterministic Pre-Validation Layer
 *
 * Synchronous, testable layer that scans a rationale for:
 * - Backend jargon (hard fail)
 * - Score narration (hard fail)
 * - Returns LLMRationaleValidationV1 with overall_status reflecting findings
 *
 * This is exported separately so tests can exercise it without an LLM call.
 * The full async validator (llm-rationale-validator.ts) runs this first, then
 * calls the LLM for deeper checks.
 */

import type {
  LLMRationaleValidationV1,
  RationaleCheckResult,
  RationaleValidationStatus,
} from '@dealdecision/core/dist/models/llm-rationale-validation-v1';
import type { LLMDecisionRationaleV1 } from '@dealdecision/core/dist/models/llm-decision-rationale-v1';

// ─── Known Backend Jargon Terms ───────────────────────────────────────────────

const BACKEND_JARGON_TERMS = [
  'conviction_v1',
  'conviction_v2',
  'challenge_pass',
  'hard_pass',
  'hard_reject',
  'deterministic-only',
  'structured_arr',
  'financial_coverage_v1',
  'financial_breakdown_v1',
  'recommendation_key',
  'structured_summary',
  'financial_facts',
  'promoted_facts',
  'ingestion_reports',
] as const;

// ORS requires word boundary detection to avoid false positives in English words
const ORS_PATTERN = /\bORS\b/;

const SCORE_NARRATION_PATTERNS: RegExp[] = [
  /\b\d{1,3}\.\d\/100\b/,
  /\b\d{1,3}\/100\b/,
  /score of \d+/i,
  /below threshold/i,
  /above threshold/i,
  /score band/i,
];

export type RationaleValidatorDeterministicInput = {
  deal_id: string;
  run_id: string | null;
  rationale: LLMDecisionRationaleV1;
  financial_facts_summary: Array<{
    metric: string;
    raw_value: string | null;
    is_projection: boolean | null;
  }>;
};

/**
 * Synchronous deterministic pre-validation.
 *
 * Returns an LLMRationaleValidationV1 immediately without any LLM call.
 * If failures are found: overall_status = 'failed'.
 * If clean: overall_status = 'needs_review' (LLM call needed to promote to 'passed').
 *
 * Never throws.
 */
export function runLLMRationaleValidatorV1(
  input: RationaleValidatorDeterministicInput,
): LLMRationaleValidationV1 {
  const { rationale, deal_id, run_id } = input;

  // Concatenate all text fields for scanning
  const allText = [
    rationale.primary_reason,
    ...rationale.why_not_pass,
    ...rationale.why_not_reject,
    ...rationale.strongest_signals,
    ...rationale.gating_risks,
    ...rationale.missing_evidence,
    rationale.confidence_explanation,
    ...rationale.source_quality_notes,
  ].join(' ');

  // ── Jargon scan ────────────────────────────────────────────────────────────
  const jargon_found = (BACKEND_JARGON_TERMS as readonly string[]).filter(
    (term) => allText.includes(term),
  );

  // ORS check (word-boundary aware)
  if (ORS_PATTERN.test(allText)) {
    jargon_found.push('ORS');
  }

  // ── Score narration scan ───────────────────────────────────────────────────
  const score_narration_found: string[] = [];
  for (const pattern of SCORE_NARRATION_PATTERNS) {
    const match = allText.match(pattern);
    if (match) {
      score_narration_found.push(match[0]);
    }
  }

  // Score narration is treated as jargon — merges into jargon_found
  for (const item of score_narration_found) {
    if (!jargon_found.includes(item)) {
      jargon_found.push(item);
    }
  }

  const hasHardFail = jargon_found.length > 0;

  const jargon_check: RationaleCheckResult = hasHardFail ? 'fail' : 'pass';
  const verdict_alignment: RationaleCheckResult = hasHardFail ? 'fail' : 'warning';
  const evidence_alignment: RationaleCheckResult = 'warning';
  const financial_claim_check: RationaleCheckResult = 'warning';

  const overall_status: RationaleValidationStatus = hasHardFail ? 'failed' : 'needs_review';

  const recommended_edits = [
    ...jargon_found.map((j) => `Remove backend term: "${j}"`),
  ];

  return {
    schema_version: 'llm_rationale_validation_v1',
    deal_id,
    run_id,
    created_at: new Date().toISOString(),
    model: 'deterministic',
    provider: 'deterministic',
    rationale_run_id: rationale.run_id,
    verdict_alignment,
    evidence_alignment,
    jargon_check,
    financial_claim_check,
    unsupported_claims: [],
    backend_jargon_found: jargon_found,
    projected_as_actual_warnings: [],
    recommended_edits,
    overall_status,
  };
}
