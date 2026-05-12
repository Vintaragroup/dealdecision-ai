/**
 * Deterministic Correction Validator V1
 *
 * Evaluates LLM auditor proposals (from LLMFieldAuditV1 and
 * LLMFinancialVerificationV1) using deterministic rules and confidence
 * thresholds. Produces:
 *   - CorrectionLineageV1 items (accepted / rejected / needs_review / shadow_only)
 *   - LearningEventV1 records
 *   - LLMValidationSummaryV1 statistics
 *
 * Phase 3: Governance and validation only.
 *
 * NON-NEGOTIABLE INVARIANTS:
 * - applied_to_scoring is ALWAYS false
 * - No scoring, verdict, conviction, structured_summary, financial_breakdown_v1,
 *   financial_coverage_v1, or canonical_decision_v2 is mutated
 * - All accepted corrections are held for future Phase 4 scoring integration
 */

import type { LLMFieldAuditV1, LLMAuditedField } from '@dealdecision/core/dist/models/llm-field-audit-v1';
import type { LLMFinancialVerificationV1, LLMVerifiedFinancialValue } from '@dealdecision/core/dist/models/llm-financial-verification-v1';
import type { CorrectionLineageItem, CorrectionLineageV1, CorrectionLineageValidatorStatus } from '@dealdecision/core/dist/models/correction-lineage-v1';
import type { LearningEventV1, LearningEventType, LearningEventSeverity } from '@dealdecision/core/dist/models/learning-event-v1';
import type { LLMValidationSummaryV1 } from '@dealdecision/core/dist/models/llm-validation-summary-v1';

// ─── Validator Input ──────────────────────────────────────────────────────────

export type DeterministicValidatorInput = {
  deal_id: string;
  run_id: string | null;
  company_name?: string | null;
  archetype?: string | null;
  llm_field_audit: LLMFieldAuditV1 | null;
  llm_financial_verification: LLMFinancialVerificationV1 | null;
  /** DO NOT MUTATE — read-only reference to structured_summary */
  structured_summary?: Record<string, unknown> | null;
  /** DO NOT MUTATE — read-only reference to financial_breakdown_v1 */
  financial_breakdown?: Record<string, unknown> | null;
};

// ─── Validator Output ─────────────────────────────────────────────────────────

export type DeterministicValidatorOutput = {
  correction_lineage: CorrectionLineageV1;
  learning_events: LearningEventV1[];
  validation_summary: LLMValidationSummaryV1;
};

// ─── Confidence Thresholds ────────────────────────────────────────────────────

/** Minimum confidence to auto-accept a Rule Class A correction */
const ACCEPT_CONFIDENCE_THRESHOLD = 0.75;
/** Minimum confidence to require review rather than shadow_only */
const REVIEW_CONFIDENCE_THRESHOLD = 0.55;
/** High-confidence disagreement threshold for learning event generation */
const HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD = 0.80;

// ─── Rule Class A: Safe Auto-Accept Patterns ─────────────────────────────────

/**
 * Year-as-count: a value that is a 4-digit year (2020–2035) in a field that
 * semantically holds a count or metric. Classic example: customer_count = 2027.
 */
function isYearInCountField(field: LLMAuditedField): boolean {
  const val = typeof field.source_value === 'number'
    ? field.source_value
    : Number(field.source_value);
  if (isNaN(val)) return false;
  const isLikelyYear = val >= 2020 && val <= 2035;
  const isCountField = /customer.?count|headcount|employee.?count|user.?count/i.test(
    field.source_field,
  );
  return isLikelyYear && isCountField;
}

/**
 * Case-normalization: correction_type === 'duplicate_or_alias' with only
 * case or whitespace difference between source_value and proposed_value.
 */
function isCaseNormalization(field: LLMAuditedField): boolean {
  if (field.correction_type !== 'duplicate_or_alias') return false;
  const src = String(field.source_value ?? '').trim().toLowerCase();
  const prop = String(field.proposed_value ?? '').trim().toLowerCase();
  return src === prop && src !== '';
}

/**
 * OCR garbage: source_value contains non-printable characters, excessive
 * punctuation, or is clearly invalid for any numeric field.
 */
function isOcrGarbageInMetricField(field: LLMAuditedField): boolean {
  if (field.correction_type !== 'unsupported_value') return false;
  const val = String(field.source_value ?? '');
  const hasGarbage = /[^\x20-\x7E]/.test(val) || /[^a-z0-9$.,% \-]/i.test(val.slice(0, 5));
  const isMetricField = /revenue|arr|mrr|burn|cash|runway|metric|kpi/i.test(field.source_field);
  return hasGarbage && isMetricField;
}

/**
 * Regulatory risk classified as contradiction: source_field contains
 * 'contradiction' and correction_type is 'wrong_financial_category'.
 */
function isRegulatoryRiskAsContradiction(field: LLMAuditedField): boolean {
  return (
    field.correction_type === 'wrong_financial_category' &&
    /contradiction/i.test(field.source_field) &&
    /risk|regulatory|uncertainty|pending/i.test(String(field.reason))
  );
}

/**
 * Checks all Rule Class A conditions. Returns the matched rule name or null.
 */
function matchesRuleClassA(field: LLMAuditedField): string | null {
  if (isYearInCountField(field)) return 'year_in_count_field';
  if (isCaseNormalization(field)) return 'case_normalization';
  if (isOcrGarbageInMetricField(field)) return 'ocr_garbage_in_metric_field';
  if (isRegulatoryRiskAsContradiction(field)) return 'regulatory_risk_as_contradiction';
  return null;
}

// ─── Rule Class B: Needs Review Patterns ─────────────────────────────────────

/**
 * Projected vs modeled economics: ambiguous boundary between projection and model.
 */
function isProjectedVsModeledAmbiguity(field: LLMAuditedField): boolean {
  return (
    field.correction_type === 'projection_vs_actual' &&
    /projected|modeled|model|forecast/i.test(String(field.reason))
  );
}

/**
 * Financial instrument ambiguity: SAFE vs convertible note vs equity, or
 * debt facility vs project finance vs capex.
 */
function isFinancialInstrumentAmbiguity(field: LLMAuditedField): boolean {
  return (
    field.correction_type === 'wrong_financial_category' &&
    /safe|convertible|project.?finance|debt.?facility|capex|equity/i.test(
      String(field.reason) + String(field.proposed_field),
    )
  );
}

/**
 * Entity-level ambiguity: SPV vs parent company vs subsidiary.
 */
function isEntityLevelAmbiguity(field: LLMAuditedField): boolean {
  return (
    field.correction_type === 'wrong_entity_type' &&
    /spv|subsidiary|parent|fund/i.test(
      String(field.reason) + String(field.proposed_field),
    )
  );
}

function matchesRuleClassB(field: LLMAuditedField): string | null {
  if (isProjectedVsModeledAmbiguity(field)) return 'projected_vs_modeled_ambiguity';
  if (isFinancialInstrumentAmbiguity(field)) return 'financial_instrument_ambiguity';
  if (isEntityLevelAmbiguity(field)) return 'entity_level_ambiguity';
  return null;
}

// ─── Rule Class C: Reject Patterns ───────────────────────────────────────────

function shouldReject(field: LLMAuditedField): string | null {
  if (!Array.isArray(field.evidence_refs) || field.evidence_refs.length === 0) {
    return 'missing_evidence_refs';
  }
  if (typeof field.confidence !== 'number' || field.confidence < 0.30) {
    return 'confidence_below_minimum';
  }
  if (!field.proposed_field || field.proposed_field.trim() === '') {
    return 'missing_proposed_field';
  }
  if (!field.reason || field.reason.trim() === '') {
    return 'missing_reason';
  }
  // Sanity: proposed_field must differ from source_field for non-case-norm corrections
  if (
    field.correction_type !== 'duplicate_or_alias' &&
    field.proposed_field === field.source_field
  ) {
    return 'proposed_field_identical_to_source';
  }
  return null;
}

// ─── Financial Verifier — Validator Rules ────────────────────────────────────

type FinancialFieldStatus = {
  status: CorrectionLineageValidatorStatus;
  reason: string | null;
};

function validateFinancialValue(val: LLMVerifiedFinancialValue): FinancialFieldStatus {
  // Reject: no evidence
  if (!Array.isArray(val.evidence_refs) || val.evidence_refs.length === 0) {
    return { status: 'rejected', reason: 'missing_evidence_refs' };
  }
  // Reject: low confidence
  if (val.confidence < 0.30) {
    return { status: 'rejected', reason: 'confidence_below_minimum' };
  }

  // Auto-accept: clear market sizing misclassification
  if (val.flagged_as_market_sizing && val.underwritable === 'no' && val.confidence >= ACCEPT_CONFIDENCE_THRESHOLD) {
    return { status: 'accepted', reason: null };
  }

  // Auto-accept: clear projection misclassification with high confidence
  if (
    val.flagged_as_projection &&
    val.financial_type !== 'current_revenue' &&
    val.confidence >= ACCEPT_CONFIDENCE_THRESHOLD
  ) {
    return { status: 'accepted', reason: null };
  }

  // Needs review: ambiguous instrument types
  if (
    val.financial_type === 'debt_facility' ||
    val.financial_type === 'safe' ||
    val.financial_type === 'modeled_economics'
  ) {
    return { status: 'needs_review', reason: 'ambiguous_financial_instrument_or_model' };
  }

  // Needs review: entity-level ambiguity
  if (val.entity_level === 'spv' || val.entity_level === 'unknown') {
    return { status: 'needs_review', reason: 'entity_level_ambiguity' };
  }

  // Shadow only: moderate confidence, no clear rule
  if (val.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
    return { status: 'shadow_only', reason: null };
  }

  return { status: 'needs_review', reason: 'requires_manual_classification' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _correctionCounter = 0;
function newCorrectionId(): string {
  // Use a stable-enough UUID-like ID derived from timestamp + counter
  const ts = Date.now().toString(36);
  const c = (++_correctionCounter).toString(36).padStart(4, '0');
  return `corr-${ts}-${c}`;
}

function newEventId(): string {
  const ts = Date.now().toString(36);
  const c = (++_correctionCounter).toString(36).padStart(4, '0');
  return `evt-${ts}-${c}`;
}

function makeLearningEvent(
  dealId: string,
  runId: string | null,
  eventType: LearningEventType,
  severity: LearningEventSeverity,
  payload: Record<string, unknown>,
  evidenceRefs: string[],
): LearningEventV1 {
  return {
    id: newEventId(),
    deal_id: dealId,
    run_id: runId,
    event_type: eventType,
    severity,
    source: 'llm_auditor',
    payload,
    evidence_refs: evidenceRefs,
    status: 'open',
    created_at: new Date().toISOString(),
    reviewed_at: null,
    resolved_at: null,
  };
}

// ─── Main Validator ───────────────────────────────────────────────────────────

/**
 * Run the deterministic validator over LLM auditor proposals.
 *
 * Returns a correction lineage, learning events, and a validation summary.
 * NEVER mutates any scoring input — all results are governance/audit only.
 */
export function runDeterministicCorrectionValidatorV1(
  input: DeterministicValidatorInput,
): DeterministicValidatorOutput {
  const { deal_id, run_id } = input;
  const now = new Date().toISOString();

  const corrections: CorrectionLineageItem[] = [];
  const learningEvents: LearningEventV1[] = [];

  // ── Counters for summary ─────────────────────────────────────────────────
  let accepted = 0;
  let rejected = 0;
  let needsReview = 0;
  let shadowOnly = 0;
  let financialSemanticConflicts = 0;
  let contradictionFalsePositives = 0;
  let archetypeDisagreements = 0;
  let highConfidenceDisagreements = 0;

  // ── Process Field Audit Proposals ────────────────────────────────────────
  if (input.llm_field_audit) {
    const audit = input.llm_field_audit;

    // Archetype correction
    if (audit.archetype_correction && audit.archetype_correction.confidence >= ACCEPT_CONFIDENCE_THRESHOLD) {
      archetypeDisagreements += 1;
      learningEvents.push(makeLearningEvent(
        deal_id, run_id,
        'wrong_archetype',
        audit.archetype_correction.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD ? 'high' : 'medium',
        {
          original_archetype: audit.archetype_correction.original,
          proposed_archetype: audit.archetype_correction.proposed,
          confidence: audit.archetype_correction.confidence,
          reason: audit.archetype_correction.reason,
        },
        [],
      ));
    }

    for (const field of audit.audited_fields) {
      // Step 1: Check for reject conditions
      const rejectReason = shouldReject(field);
      if (rejectReason) {
        corrections.push({
          correction_id: newCorrectionId(),
          source: 'llm_field_audit',
          original_field: field.source_field,
          original_value: field.source_value,
          proposed_field: field.proposed_field,
          proposed_value: field.proposed_value,
          normalized_value: field.proposed_value,
          correction_type: field.correction_type,
          confidence: field.confidence ?? 0,
          evidence_refs: field.evidence_refs ?? [],
          validator_status: 'rejected',
          validator_reason: rejectReason,
          applied_to_scoring: false, // INVARIANT: always false
          applied_at: null,
        });
        rejected += 1;
        learningEvents.push(makeLearningEvent(
          deal_id, run_id,
          'llm_correction_rejected',
          'low',
          {
            source_field: field.source_field,
            proposed_field: field.proposed_field,
            reject_reason: rejectReason,
            confidence: field.confidence,
            correction_type: field.correction_type,
          },
          field.evidence_refs ?? [],
        ));
        continue;
      }

      // Step 2: Check Rule Class A (auto-accept)
      const classARule = matchesRuleClassA(field);
      if (classARule && field.confidence >= ACCEPT_CONFIDENCE_THRESHOLD) {
        corrections.push({
          correction_id: newCorrectionId(),
          source: 'llm_field_audit',
          original_field: field.source_field,
          original_value: field.source_value,
          proposed_field: field.proposed_field,
          proposed_value: field.proposed_value,
          normalized_value: field.proposed_value,
          correction_type: field.correction_type,
          confidence: field.confidence,
          evidence_refs: field.evidence_refs,
          validator_status: 'accepted',
          validator_reason: null,
          applied_to_scoring: false, // INVARIANT: always false — Phase 4 will change this
          applied_at: null,
        });
        accepted += 1;

        // Track special events
        if (isRegulatoryRiskAsContradiction(field)) {
          contradictionFalsePositives += 1;
          learningEvents.push(makeLearningEvent(
            deal_id, run_id,
            'contradiction_false_positive',
            'medium',
            {
              source_field: field.source_field,
              reason: field.reason,
              confidence: field.confidence,
              rule: classARule,
            },
            field.evidence_refs,
          ));
        } else {
          learningEvents.push(makeLearningEvent(
            deal_id, run_id,
            'llm_correction_accepted',
            field.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD ? 'high' : 'medium',
            {
              source_field: field.source_field,
              proposed_field: field.proposed_field,
              correction_type: field.correction_type,
              confidence: field.confidence,
              rule: classARule,
            },
            field.evidence_refs,
          ));
        }

        if (field.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD) {
          highConfidenceDisagreements += 1;
        }
        continue;
      }

      // Step 3: Check Rule Class B (needs review)
      const classBRule = matchesRuleClassB(field);
      if (classBRule || (classARule && field.confidence < ACCEPT_CONFIDENCE_THRESHOLD)) {
        corrections.push({
          correction_id: newCorrectionId(),
          source: 'llm_field_audit',
          original_field: field.source_field,
          original_value: field.source_value,
          proposed_field: field.proposed_field,
          proposed_value: field.proposed_value,
          normalized_value: field.proposed_value,
          correction_type: field.correction_type,
          confidence: field.confidence,
          evidence_refs: field.evidence_refs,
          validator_status: 'needs_review',
          validator_reason: classBRule ?? 'class_a_below_threshold',
          applied_to_scoring: false,
          applied_at: null,
        });
        needsReview += 1;

        if (field.correction_type === 'wrong_financial_category') {
          financialSemanticConflicts += 1;
          learningEvents.push(makeLearningEvent(
            deal_id, run_id,
            'financial_semantic_error',
            'medium',
            {
              source_field: field.source_field,
              proposed_field: field.proposed_field,
              reason: field.reason,
              confidence: field.confidence,
              rule: classBRule,
            },
            field.evidence_refs,
          ));
        }
        if (field.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD) {
          highConfidenceDisagreements += 1;
        }
        continue;
      }

      // Step 4: Fall through to shadow_only
      corrections.push({
        correction_id: newCorrectionId(),
        source: 'llm_field_audit',
        original_field: field.source_field,
        original_value: field.source_value,
        proposed_field: field.proposed_field,
        proposed_value: field.proposed_value,
        normalized_value: field.proposed_value,
        correction_type: field.correction_type,
        confidence: field.confidence,
        evidence_refs: field.evidence_refs,
        validator_status: 'shadow_only',
        validator_reason: 'no_matching_rule',
        applied_to_scoring: false,
        applied_at: null,
      });
      shadowOnly += 1;

      if (field.correction_type === 'field_misclassification' || field.correction_type === 'misplaced_field') {
        learningEvents.push(makeLearningEvent(
          deal_id, run_id,
          'field_misclassification',
          'low',
          {
            source_field: field.source_field,
            proposed_field: field.proposed_field,
            confidence: field.confidence,
          },
          field.evidence_refs,
        ));
      }
    }
  }

  // ── Process Financial Verifier Proposals ─────────────────────────────────
  const financialVerifSchemaGapCount = input.llm_financial_verification?.financial_gaps?.length ?? 0;

  if (input.llm_financial_verification) {
    for (const val of input.llm_financial_verification.verified_values) {
      const { status: vStatus, reason: vReason } = validateFinancialValue(val);

      const proposedField = `financial_facts.${val.financial_type}`;
      const sourceField = val.extraction_ref ?? 'financial_facts.unknown';

      corrections.push({
        correction_id: newCorrectionId(),
        source: 'llm_financial_verification',
        original_field: sourceField,
        original_value: val.raw_value,
        proposed_field: proposedField,
        proposed_value: val.normalized_value,
        normalized_value: val.normalized_value,
        correction_type: val.flagged_as_market_sizing
          ? 'wrong_financial_category'
          : val.flagged_as_projection
            ? 'projection_vs_actual'
            : 'wrong_financial_category',
        confidence: val.confidence,
        evidence_refs: val.evidence_refs,
        validator_status: vStatus,
        validator_reason: vReason,
        applied_to_scoring: false, // INVARIANT: always false
        applied_at: null,
      });

      switch (vStatus) {
        case 'accepted':
          accepted += 1;
          if (val.flagged_as_market_sizing || val.flagged_as_projection) {
            financialSemanticConflicts += 1;
            learningEvents.push(makeLearningEvent(
              deal_id, run_id,
              'financial_semantic_error',
              val.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD ? 'high' : 'medium',
              {
                raw_value: val.raw_value,
                financial_type: val.financial_type,
                flagged_as_market_sizing: val.flagged_as_market_sizing,
                flagged_as_projection: val.flagged_as_projection,
                reason: val.reason,
                confidence: val.confidence,
              },
              val.evidence_refs,
            ));
          }
          learningEvents.push(makeLearningEvent(
            deal_id, run_id,
            'llm_correction_accepted',
            val.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD ? 'high' : 'medium',
            {
              source_field: sourceField,
              proposed_field: proposedField,
              financial_type: val.financial_type,
              confidence: val.confidence,
            },
            val.evidence_refs,
          ));
          if (val.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD) {
            highConfidenceDisagreements += 1;
          }
          break;
        case 'rejected':
          rejected += 1;
          learningEvents.push(makeLearningEvent(
            deal_id, run_id,
            'llm_correction_rejected',
            'low',
            {
              raw_value: val.raw_value,
              financial_type: val.financial_type,
              reject_reason: vReason,
              confidence: val.confidence,
            },
            val.evidence_refs,
          ));
          break;
        case 'needs_review':
          needsReview += 1;
          if (val.flagged_as_market_sizing || val.flagged_as_projection) {
            financialSemanticConflicts += 1;
          }
          if (val.confidence >= HIGH_CONFIDENCE_DISAGREEMENT_THRESHOLD) {
            highConfidenceDisagreements += 1;
          }
          break;
        case 'shadow_only':
          shadowOnly += 1;
          break;
      }
    }

    // Emit schema gap learning events for financial gaps
    for (const gap of input.llm_financial_verification.financial_gaps) {
      if (gap.severity === 'high' || gap.severity === 'medium') {
        learningEvents.push(makeLearningEvent(
          deal_id, run_id,
          'schema_gap',
          gap.severity === 'high' ? 'high' : 'medium',
          {
            field: gap.field,
            description: gap.description,
            severity: gap.severity,
          },
          [],
        ));
      }
    }
  }

  // ── Compute Review Priority ───────────────────────────────────────────────
  const totalProposals = corrections.length;
  const requiresHumanReview = accepted > 0 || needsReview > 0;
  let reviewPriority: 'low' | 'medium' | 'high' | null = null;
  let reviewReason: string | null = null;

  if (requiresHumanReview) {
    if (
      accepted >= 3 ||
      financialSemanticConflicts >= 2 ||
      contradictionFalsePositives >= 1 ||
      archetypeDisagreements >= 1
    ) {
      reviewPriority = 'high';
      reviewReason =
        archetypeDisagreements >= 1
          ? 'archetype_disagreement_detected'
          : contradictionFalsePositives >= 1
            ? 'contradiction_false_positive_accepted'
            : 'multiple_accepted_corrections';
    } else if (accepted >= 1 || needsReview >= 2) {
      reviewPriority = 'medium';
      reviewReason =
        financialSemanticConflicts >= 1
          ? 'financial_semantic_conflict_flagged'
          : 'accepted_correction_pending_review';
    } else {
      reviewPriority = 'low';
      reviewReason = 'needs_review_proposals_present';
    }
  }

  // ── Build Outputs ─────────────────────────────────────────────────────────
  const correctionLineage: CorrectionLineageV1 = {
    schema_version: 'correction_lineage_v1',
    deal_id,
    run_id,
    created_at: now,
    corrections,
  };

  const validationSummary: LLMValidationSummaryV1 = {
    schema_version: 'llm_validation_summary_v1',
    deal_id,
    run_id,
    created_at: now,
    total_proposals: totalProposals,
    accepted,
    rejected,
    needs_review: needsReview,
    shadow_only: shadowOnly,
    high_confidence_disagreements: highConfidenceDisagreements,
    financial_semantic_conflicts: financialSemanticConflicts,
    contradiction_false_positives: contradictionFalsePositives,
    archetype_disagreements: archetypeDisagreements,
    policy_disagreements: 0, // Phase 4+ will populate policy disagreements
    schema_gap_count: financialVerifSchemaGapCount,
    generated_learning_events: learningEvents.length,
    requires_human_review: requiresHumanReview,
    review_priority: reviewPriority,
    review_reason: reviewReason,
  };

  console.log(
    JSON.stringify({
      event: 'DETERMINISTIC_VALIDATOR_V1_COMPLETE',
      deal_id,
      run_id,
      total_proposals: totalProposals,
      accepted,
      rejected,
      needs_review: needsReview,
      shadow_only: shadowOnly,
      learning_events: learningEvents.length,
      review_priority: reviewPriority,
      ts: now,
    }),
  );

  return {
    correction_lineage: correctionLineage,
    learning_events: learningEvents,
    validation_summary: validationSummary,
  };
}
