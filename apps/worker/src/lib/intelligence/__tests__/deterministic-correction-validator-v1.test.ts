/**
 * Phase 3 — DeterministicCorrectionValidatorV1 Tests
 *
 * Tests verify:
 * - Rule Class A auto-accept conditions
 * - Rule Class B needs_review conditions
 * - Rule Class C reject conditions
 * - applied_to_scoring ALWAYS false invariant
 * - Learning events generated correctly
 * - Correction lineage structure
 * - No mutation of scoring inputs
 */

import { describe, it, expect } from 'vitest';
import { runDeterministicCorrectionValidatorV1 } from '../deterministic-correction-validator-v1.js';
import type { DeterministicValidatorInput } from '../deterministic-correction-validator-v1.js';
import type { LLMFieldAuditV1, LLMAuditedField } from '@dealdecision/core/dist/models/llm-field-audit-v1';
import type { LLMFinancialVerificationV1, LLMVerifiedFinancialValue } from '@dealdecision/core/dist/models/llm-financial-verification-v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFieldAudit(fields: LLMAuditedField[]): LLMFieldAuditV1 {
  return {
    schema_version: 'llm_field_audit_v1',
    deal_id: 'deal-001',
    run_id: 'run-001',
    created_at: new Date().toISOString(),
    model: 'gpt-4o-mini',
    archetype_at_audit: 'infrastructure',
    audited_fields: fields,
    risk_flags: [],
    summary: null,
    audit_confidence: 0.85,
    evidence_count_at_audit: 10,
  };
}

function makeFinancialVerif(
  values: LLMVerifiedFinancialValue[],
): LLMFinancialVerificationV1 {
  return {
    schema_version: 'llm_financial_verification_v1',
    deal_id: 'deal-001',
    run_id: 'run-001',
    created_at: new Date().toISOString(),
    verified_values: values,
    financial_gaps: [],
    summary: null,
    xlsx_data_present: false,
    cap_table_present: false,
  };
}

function baseInput(overrides: Partial<DeterministicValidatorInput> = {}): DeterministicValidatorInput {
  return {
    deal_id: 'deal-001',
    run_id: 'run-001',
    llm_field_audit: null,
    llm_financial_verification: null,
    ...overrides,
  };
}

// ─── Rule Class A: Auto-Accept ────────────────────────────────────────────────

describe('Rule Class A — auto-accept', () => {
  it('accepts year-as-customer-count correction (Climatic pattern)', () => {
    const field: LLMAuditedField = {
      source_field: 'structured_summary.customer_count',
      source_value: 2027,
      proposed_field: 'timeline.target_year',
      proposed_value: '2027',
      correction_type: 'projection_vs_actual',
      confidence: 0.92,
      evidence_refs: ['slide-5-text'],
      reason: '"2027" is a target year appearing in customer count field — not a customer count',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('accepted');
    expect(correction.applied_to_scoring).toBe(false); // INVARIANT
    expect(correction.original_field).toBe('structured_summary.customer_count');
    expect(correction.proposed_field).toBe('timeline.target_year');
    expect(result.validation_summary.accepted).toBe(1);
    expect(result.validation_summary.rejected).toBe(0);
  });

  it('accepts regulatory risk classified as contradiction (Climatic pattern)', () => {
    const field: LLMAuditedField = {
      source_field: 'conviction_v1.contradictions',
      source_value: 'Regulatory approval uncertainty',
      proposed_field: 'risk_factors.regulatory',
      proposed_value: 'Regulatory approval uncertainty',
      correction_type: 'wrong_financial_category',
      confidence: 0.88,
      evidence_refs: ['slide-8-text'],
      reason: 'This is a risk statement about regulatory uncertainty — not a factual contradiction',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('accepted');
    expect(correction.applied_to_scoring).toBe(false);
    expect(result.validation_summary.contradiction_false_positives).toBe(1);

    // Learning event should be a contradiction_false_positive
    const fpEvent = result.learning_events.find(
      (e) => e.event_type === 'contradiction_false_positive',
    );
    expect(fpEvent).toBeDefined();
  });

  it('accepts market sizing misclassified as revenue via financial verifier', () => {
    const value: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-001',
      raw_value: 'TAM: $10B',
      normalized_value: '$10,000,000,000',
      currency: 'USD',
      amount: 10_000_000_000,
      period: null,
      entity_level: 'unknown',
      financial_type: 'modeled_economics',
      confidence: 0.91,
      underwritable: 'no',
      source_kind: 'deck',
      evidence_refs: ['slide-2-text'],
      reason: 'Total Addressable Market — market sizing, not company revenue',
      flagged_as_projection: false,
      flagged_as_market_sizing: true,
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_financial_verification: makeFinancialVerif([value]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('accepted');
    expect(correction.applied_to_scoring).toBe(false);
    expect(result.validation_summary.financial_semantic_conflicts).toBeGreaterThan(0);
  });

  it('accepts projection flagged as current revenue with high confidence', () => {
    const value: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-002',
      raw_value: '$5M ARR (2026 target)',
      normalized_value: '$5,000,000',
      currency: 'USD',
      amount: 5_000_000,
      period: '2026',
      entity_level: 'parent_company',
      financial_type: 'projected_revenue',
      confidence: 0.82,
      underwritable: 'no',
      source_kind: 'deck',
      evidence_refs: ['slide-4-text'],
      reason: '"2026 target" — this is a projection, not current revenue',
      flagged_as_projection: true,
      flagged_as_market_sizing: false,
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_financial_verification: makeFinancialVerif([value]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('accepted');
    expect(correction.applied_to_scoring).toBe(false);
  });
});

// ─── Rule Class B: Needs Review ───────────────────────────────────────────────

describe('Rule Class B — needs_review', () => {
  it('puts projected vs modeled economics ambiguity into needs_review', () => {
    const field: LLMAuditedField = {
      source_field: 'financial_facts.revenue',
      source_value: '$2B modeled deployment forecast',
      proposed_field: 'financial_facts.modeled_economics',
      proposed_value: '$2B modeled deployment forecast',
      correction_type: 'projection_vs_actual',
      confidence: 0.72,
      evidence_refs: ['slide-6-text'],
      reason: 'This value appears to be a modeled project economics forecast, possibly projected revenue',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('needs_review');
    expect(correction.applied_to_scoring).toBe(false);
    expect(result.validation_summary.needs_review).toBe(1);
  });

  it('puts debt facility vs project finance into needs_review', () => {
    const field: LLMAuditedField = {
      source_field: 'financial_facts.raise_amount',
      source_value: '$150M project finance facility',
      proposed_field: 'financial_facts.debt_facility',
      proposed_value: '$150M project finance facility',
      correction_type: 'wrong_financial_category',
      confidence: 0.78,
      evidence_refs: ['slide-7-text'],
      reason: '$150M project finance facility — could be debt_facility or project finance',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('needs_review');
    expect(correction.applied_to_scoring).toBe(false);
  });

  it('puts ambiguous financial instrument (SAFE) into needs_review via financial verifier', () => {
    const value: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-003',
      raw_value: 'SAFE round $500K',
      normalized_value: '$500,000',
      currency: 'USD',
      amount: 500_000,
      period: null,
      entity_level: 'parent_company',
      financial_type: 'safe',
      confidence: 0.75,
      underwritable: 'partial',
      source_kind: 'deck',
      evidence_refs: ['slide-10-text'],
      reason: 'Could be SAFE, convertible note, or equity pre-seed',
      flagged_as_projection: false,
      flagged_as_market_sizing: false,
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_financial_verification: makeFinancialVerif([value]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('needs_review');
    expect(correction.applied_to_scoring).toBe(false);
  });
});

// ─── Rule Class C: Reject ─────────────────────────────────────────────────────

describe('Rule Class C — reject', () => {
  it('rejects a correction with missing evidence_refs', () => {
    const field: LLMAuditedField = {
      source_field: 'financial_facts.burn_rate',
      source_value: 'high',
      proposed_field: 'financial_facts.burn_classification',
      proposed_value: 'high',
      correction_type: 'misplaced_field',
      confidence: 0.80,
      evidence_refs: [], // no evidence
      reason: 'burn rate is incorrectly classified',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('rejected');
    expect(correction.validator_reason).toBe('missing_evidence_refs');
    expect(correction.applied_to_scoring).toBe(false);
    expect(result.validation_summary.rejected).toBe(1);

    const rejectedEvent = result.learning_events.find(
      (e) => e.event_type === 'llm_correction_rejected',
    );
    expect(rejectedEvent).toBeDefined();
  });

  it('rejects a correction with confidence below 0.30', () => {
    const field: LLMAuditedField = {
      source_field: 'financial_facts.revenue',
      source_value: 'possibly some value',
      proposed_field: 'some_hallucinated_field.xyz',
      proposed_value: 'possibly some value',
      correction_type: 'schema_gap',
      confidence: 0.20, // too low
      evidence_refs: ['slide-1-text'],
      reason: 'speculative schema jump',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('rejected');
    expect(correction.validator_reason).toBe('confidence_below_minimum');
    expect(correction.applied_to_scoring).toBe(false);
  });

  it('rejects financial verifier value with no evidence refs', () => {
    const value: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-004',
      raw_value: 'some number',
      normalized_value: '$0',
      currency: 'USD',
      amount: 0,
      period: null,
      entity_level: 'unknown',
      financial_type: 'unknown',
      confidence: 0.80,
      underwritable: 'no',
      source_kind: 'unknown',
      evidence_refs: [], // no evidence
      reason: 'unknown financial value',
      flagged_as_projection: false,
      flagged_as_market_sizing: false,
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_financial_verification: makeFinancialVerif([value]) }),
    );

    const correction = result.correction_lineage.corrections[0]!;
    expect(correction.validator_status).toBe('rejected');
    expect(correction.applied_to_scoring).toBe(false);
  });
});

// ─── INVARIANT: applied_to_scoring MUST be false for all statuses ─────────────

describe('INVARIANT: applied_to_scoring is always false', () => {
  it('all corrections from any rule class have applied_to_scoring = false', () => {
    const fields: LLMAuditedField[] = [
      {
        // Rule Class A — will be accepted
        source_field: 'structured_summary.customer_count',
        source_value: 2027,
        proposed_field: 'timeline.target_year',
        proposed_value: '2027',
        correction_type: 'projection_vs_actual',
        confidence: 0.92,
        evidence_refs: ['slide-5'],
        reason: 'year not count',
        status: 'shadow_only',
      },
      {
        // Rule Class B — will be needs_review
        source_field: 'financial_facts.revenue',
        source_value: '$2B modeled',
        proposed_field: 'financial_facts.modeled_economics',
        proposed_value: '$2B modeled',
        correction_type: 'projection_vs_actual',
        confidence: 0.72,
        evidence_refs: ['slide-6'],
        reason: 'modeled forecast possibly projected revenue',
        status: 'shadow_only',
      },
      {
        // Rule Class C — will be rejected
        source_field: 'financial_facts.burn_rate',
        source_value: 'high',
        proposed_field: 'something',
        proposed_value: 'high',
        correction_type: 'misplaced_field',
        confidence: 0.80,
        evidence_refs: [],
        reason: 'missing evidence',
        status: 'shadow_only',
      },
    ];

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit(fields) }),
    );

    for (const correction of result.correction_lineage.corrections) {
      expect(correction.applied_to_scoring).toBe(false);
      expect(correction.applied_at).toBeNull();
    }
  });

  it('accepted corrections do NOT appear in structured_summary (no mutation)', () => {
    const structuredSummary = { customer_count: 2027, arr: 500_000 };
    const snapshot = JSON.parse(JSON.stringify(structuredSummary));

    const field: LLMAuditedField = {
      source_field: 'structured_summary.customer_count',
      source_value: 2027,
      proposed_field: 'timeline.target_year',
      proposed_value: '2027',
      correction_type: 'projection_vs_actual',
      confidence: 0.92,
      evidence_refs: ['slide-5'],
      reason: 'year not count',
      status: 'shadow_only',
    };

    runDeterministicCorrectionValidatorV1(
      baseInput({
        llm_field_audit: makeFieldAudit([field]),
        structured_summary: structuredSummary,
      }),
    );

    // structured_summary must be unchanged after validator runs
    expect(structuredSummary).toEqual(snapshot);
  });
});

// ─── Learning Events ──────────────────────────────────────────────────────────

describe('Learning events generated correctly', () => {
  it('generates llm_correction_accepted event for accepted field correction', () => {
    const field: LLMAuditedField = {
      source_field: 'structured_summary.customer_count',
      source_value: 2027,
      proposed_field: 'timeline.target_year',
      proposed_value: '2027',
      correction_type: 'projection_vs_actual',
      confidence: 0.92,
      evidence_refs: ['slide-5'],
      reason: 'year not count',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const accepted = result.learning_events.find(
      (e) => e.event_type === 'llm_correction_accepted',
    );
    expect(accepted).toBeDefined();
    expect(accepted!.deal_id).toBe('deal-001');
    expect(accepted!.status).toBe('open');
    expect(accepted!.applied_to_scoring).toBeUndefined(); // LearningEventV1 has no such field
  });

  it('generates llm_correction_rejected event for rejected correction', () => {
    const field: LLMAuditedField = {
      source_field: 'financial_facts.burn_rate',
      source_value: 'high',
      proposed_field: 'something',
      proposed_value: 'high',
      correction_type: 'misplaced_field',
      confidence: 0.80,
      evidence_refs: [],
      reason: 'some reason',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    const rejected = result.learning_events.find(
      (e) => e.event_type === 'llm_correction_rejected',
    );
    expect(rejected).toBeDefined();
  });

  it('generates financial_semantic_error event for market sizing conflict', () => {
    const value: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-005',
      raw_value: 'TAM: $10B',
      normalized_value: '$10,000,000,000',
      currency: 'USD',
      amount: 10_000_000_000,
      period: null,
      entity_level: 'unknown',
      financial_type: 'modeled_economics',
      confidence: 0.91,
      underwritable: 'no',
      source_kind: 'deck',
      evidence_refs: ['slide-2'],
      reason: 'TAM not revenue',
      flagged_as_projection: false,
      flagged_as_market_sizing: true,
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_financial_verification: makeFinancialVerif([value]) }),
    );

    const semanticEvent = result.learning_events.find(
      (e) => e.event_type === 'financial_semantic_error',
    );
    expect(semanticEvent).toBeDefined();
    expect(semanticEvent!.payload.flagged_as_market_sizing).toBe(true);
  });

  it('generates schema_gap learning event for high-severity financial gaps', () => {
    const verif: LLMFinancialVerificationV1 = {
      schema_version: 'llm_financial_verification_v1',
      deal_id: 'deal-001',
      run_id: 'run-001',
      created_at: new Date().toISOString(),
      verified_values: [],
      financial_gaps: [
        { field: 'burn_rate', description: 'No burn rate found in documents', severity: 'high' },
      ],
      summary: null,
      xlsx_data_present: false,
      cap_table_present: false,
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_financial_verification: verif }),
    );

    const gapEvent = result.learning_events.find((e) => e.event_type === 'schema_gap');
    expect(gapEvent).toBeDefined();
    expect(gapEvent!.payload.field).toBe('burn_rate');
    expect(gapEvent!.severity).toBe('high');
  });
});

// ─── Validation Summary ───────────────────────────────────────────────────────

describe('Validation summary', () => {
  it('summary has correct schema_version', () => {
    const result = runDeterministicCorrectionValidatorV1(baseInput({}));
    expect(result.validation_summary.schema_version).toBe('llm_validation_summary_v1');
    expect(result.validation_summary.deal_id).toBe('deal-001');
  });

  it('requires_human_review is true when there are accepted corrections', () => {
    const field: LLMAuditedField = {
      source_field: 'structured_summary.customer_count',
      source_value: 2027,
      proposed_field: 'timeline.target_year',
      proposed_value: '2027',
      correction_type: 'projection_vs_actual',
      confidence: 0.92,
      evidence_refs: ['slide-5'],
      reason: 'year not count',
      status: 'shadow_only',
    };

    const result = runDeterministicCorrectionValidatorV1(
      baseInput({ llm_field_audit: makeFieldAudit([field]) }),
    );

    expect(result.validation_summary.requires_human_review).toBe(true);
    expect(result.validation_summary.review_priority).not.toBeNull();
  });

  it('correction_lineage schema_version is correct', () => {
    const result = runDeterministicCorrectionValidatorV1(baseInput({}));
    expect(result.correction_lineage.schema_version).toBe('correction_lineage_v1');
    expect(result.correction_lineage.deal_id).toBe('deal-001');
  });

  it('produces empty corrections when both auditors return null', () => {
    const result = runDeterministicCorrectionValidatorV1(baseInput({}));
    expect(result.correction_lineage.corrections).toHaveLength(0);
    expect(result.validation_summary.total_proposals).toBe(0);
    expect(result.validation_summary.requires_human_review).toBe(false);
  });
});
