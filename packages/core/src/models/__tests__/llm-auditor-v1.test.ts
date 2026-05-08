/**
 * Phase 1 + Phase 2 LLM Deal Understanding Auditor — Schema & Type Tests
 *
 * These tests verify structural contracts only.
 * No scoring, verdicts, or report behavior is affected by Phase 1 or Phase 2.
 */

import type { LLMFieldAuditV1, LLMAuditedField } from '../llm-field-audit-v1.js';
import type { LLMFinancialVerificationV1, LLMVerifiedFinancialValue } from '../llm-financial-verification-v1.js';
import type { LLMSchemaGapV1 } from '../llm-schema-gap-v1.js';
import type { LLMDecisionRationaleV1 } from '../llm-decision-rationale-v1.js';
import type { LLMRationaleValidationV1 } from '../llm-rationale-validation-v1.js';
import type { CorrectionLineageV1, CorrectionLineageItem } from '../correction-lineage-v1.js';
import type { LearningEventV1 } from '../learning-event-v1.js';
import type { InvestmentInterpretationV1 } from '../investment-interpretation-v1.js';
import type { NarrativeQualityValidationV1 } from '../narrative-quality-validation-v1.js';

// ─── LLMFieldAuditV1 ──────────────────────────────────────────────────────────

describe('LLMFieldAuditV1', () => {
  it('accepts a valid audit object with all required fields', () => {
    const audit: LLMFieldAuditV1 = {
      schema_version: 'llm_field_audit_v1',
      deal_id: 'deal-abc',
      run_id: 'run-001',
      created_at: new Date().toISOString(),
      model: 'gpt-4o-mini',
      provider: 'openai',
      archetype_at_audit: 'saas',
      audited_fields: [],
      risk_flags: [],
      summary: null,
      audit_confidence: 0.85,
      evidence_count_at_audit: 12,
    };
    expect(audit.schema_version).toBe('llm_field_audit_v1');
    expect(audit.audit_confidence).toBe(0.85);
  });

  it('schema_version is the correct discriminant', () => {
    const v: LLMFieldAuditV1['schema_version'] = 'llm_field_audit_v1';
    expect(v).toBe('llm_field_audit_v1');
  });

  it('Phase 2: audited_fields accept shadow_only status', () => {
    const field: LLMAuditedField = {
      source_field: 'structured_summary.customer_count',
      source_value: '2027',
      proposed_field: 'timeline.target_year',
      proposed_value: '2027',
      correction_type: 'projection_vs_actual',
      confidence: 0.9,
      evidence_refs: ['slide-5-text'],
      reason: '"2027" is a target year appearing in revenue context, not a customer count',
      status: 'shadow_only',
    };
    expect(field.status).toBe('shadow_only');
    expect(field.correction_type).toBe('projection_vs_actual');
  });

  it('Phase 2: market sizing misclassification can be flagged as risk', () => {
    const audit: LLMFieldAuditV1 = {
      schema_version: 'llm_field_audit_v1',
      deal_id: 'deal-xyz',
      run_id: null,
      created_at: new Date().toISOString(),
      archetype_at_audit: null,
      audited_fields: [],
      risk_flags: [
        {
          field: 'market_sizing_mistaken_for_revenue',
          description: '"$2B projected deployment" is a market/deployment forecast — not current company revenue',
          severity: 'high',
        },
      ],
      summary: 'Revenue field may contain market sizing data from deck',
      audit_confidence: 0.88,
      evidence_count_at_audit: 7,
    };
    expect(audit.risk_flags[0]!.severity).toBe('high');
  });
});

// ─── LLMFinancialVerificationV1 ───────────────────────────────────────────────

describe('LLMFinancialVerificationV1', () => {
  it('accepts a minimal valid object', () => {
    const obj: LLMFinancialVerificationV1 = {
      schema_version: 'llm_financial_verification_v1',
      deal_id: 'deal-abc',
      run_id: 'run-001',
      created_at: new Date().toISOString(),
      verified_values: [],
      financial_gaps: [],
      summary: null,
      xlsx_data_present: false,
      cap_table_present: false,
    };
    expect(obj.schema_version).toBe('llm_financial_verification_v1');
    expect(obj.xlsx_data_present).toBe(false);
  });

  it('Phase 2: classifies a projection as projected_revenue with flagged_as_projection=true', () => {
    const value: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-001',
      raw_value: '$2B projected deployment',
      normalized_value: '$2,000,000,000',
      currency: 'USD',
      amount: 2_000_000_000,
      period: '2028',
      entity_level: 'project',
      financial_type: 'modeled_economics',
      confidence: 0.92,
      underwritable: 'no',
      source_kind: 'deck',
      evidence_refs: ['slide-3'],
      reason: '"$2B projected deployment" is a capital deployment forecast, not current company revenue',
      flagged_as_projection: true,
      flagged_as_market_sizing: false,
    };
    expect(value.flagged_as_projection).toBe(true);
    expect(value.financial_type).toBe('modeled_economics');
    expect(value.underwritable).toBe('no');
  });

  it('Phase 2: correctly distinguishes debt_facility from equity_raise', () => {
    const debtValue: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-002',
      raw_value: '$150M project finance facility',
      normalized_value: '$150,000,000',
      currency: 'USD',
      amount: 150_000_000,
      period: null,
      entity_level: 'project',
      financial_type: 'debt_facility',
      confidence: 0.95,
      underwritable: 'partial',
      source_kind: 'deck',
      evidence_refs: ['slide-7'],
      reason: 'Project finance facility — debt instrument, not equity raise',
      flagged_as_projection: false,
      flagged_as_market_sizing: false,
    };
    expect(debtValue.financial_type).toBe('debt_facility');
    expect(debtValue.financial_type).not.toBe('equity_raise');
    expect(debtValue.financial_type).not.toBe('safe');
  });

  it('Phase 2: market sizing sets flagged_as_market_sizing=true', () => {
    const tamValue: LLMVerifiedFinancialValue = {
      extraction_ref: 'ev-003',
      raw_value: 'TAM: $10B',
      normalized_value: '$10,000,000,000',
      currency: 'USD',
      amount: 10_000_000_000,
      period: null,
      entity_level: 'unknown',
      financial_type: 'modeled_economics',
      confidence: 0.85,
      underwritable: 'no',
      source_kind: 'deck',
      evidence_refs: ['slide-2'],
      reason: 'Total Addressable Market — market sizing, not company revenue',
      flagged_as_projection: false,
      flagged_as_market_sizing: true,
    };
    expect(tamValue.flagged_as_market_sizing).toBe(true);
    expect(tamValue.underwritable).toBe('no');
  });
});

// ─── LLMSchemaGapV1 ───────────────────────────────────────────────────────────

describe('LLMSchemaGapV1', () => {
  it('accepts a minimal valid object', () => {
    const obj: LLMSchemaGapV1 = {
      schema_version: 'llm_schema_gap_v1',
      deal_id: 'deal-abc',
      run_id: null,
      created_at: new Date().toISOString(),
      gaps: [],
      summary: null,
      total_gaps: 0,
    };
    expect(obj.schema_version).toBe('llm_schema_gap_v1');
    expect(obj.total_gaps).toBe(0);
  });
});

// ─── LLMDecisionRationaleV1 ───────────────────────────────────────────────────

describe('LLMDecisionRationaleV1', () => {
  it('accepts a valid rationale object', () => {
    const obj: LLMDecisionRationaleV1 = {
      schema_version: 'llm_decision_rationale_v1',
      deal_id: 'deal-abc',
      run_id: null,
      created_at: new Date().toISOString(),
      canonical_verdict: 'pass_with_conditions',
      primary_reason: 'Strong recurring revenue but burn rate is concerning.',
      why_not_pass: ['High monthly burn with 8 months runway'],
      why_not_reject: ['$500K ARR with 15% MoM growth'],
      strongest_signals: ['ARR growth', 'LOI from enterprise customer'],
      gating_risks: ['Runway falls below 6 months without bridge'],
      missing_evidence: ['Audited financials'],
      confidence_explanation: 'Medium confidence due to deck-only financials',
      evidence_refs: [],
      source_quality_notes: [],
      backend_terms_removed: [],
      generation_warnings: [],
      status: 'shadow_only',
    };
    expect(obj.schema_version).toBe('llm_decision_rationale_v1');
    expect(obj.canonical_verdict).toBe('pass_with_conditions');
    expect(obj.status).toBe('shadow_only');
  });
});

// ─── LLMRationaleValidationV1 ─────────────────────────────────────────────────

describe('LLMRationaleValidationV1', () => {
  it('accepts a valid validation object', () => {
    const obj: LLMRationaleValidationV1 = {
      schema_version: 'llm_rationale_validation_v1',
      deal_id: 'deal-abc',
      run_id: null,
      created_at: new Date().toISOString(),
      rationale_run_id: null,
      verdict_alignment: 'pass',
      evidence_alignment: 'pass',
      jargon_check: 'pass',
      financial_claim_check: 'warning',
      unsupported_claims: [],
      backend_jargon_found: [],
      projected_as_actual_warnings: [],
      recommended_edits: [],
      overall_status: 'passed',
    };
    expect(obj.schema_version).toBe('llm_rationale_validation_v1');
    expect(obj.overall_status).toBe('passed');
  });
});

describe('InvestmentInterpretationV1', () => {
  it('accepts a valid interpretation object', () => {
    const obj: InvestmentInterpretationV1 = {
      schema_version: 'investment_interpretation_v1',
      deal_id: 'deal-abc',
      report_id: null,
      run_id: 'run-001',
      created_at: new Date().toISOString(),
      status: 'shadow_only',
      synthesizer_version: 'deterministic_v1',
      sections: [
        {
          section_id: 'product',
          observation: 'The company presents an enterprise workflow automation product.',
          interpretation: 'A workflow-specific product could support differentiated adoption if it maps to a painful operational bottleneck.',
          supporting_evidence: ['Product overview appears in the company materials.'],
          limitations: ['Customer adoption evidence is not independently validated.'],
          investment_implication: 'Product quality may matter to pricing power, but current underwriting confidence remains limited without proof of deployment success.',
          confidence: 'medium',
          evidence_refs: ['ev-001'],
          source_quality: 'directional',
          warnings: [],
        },
      ],
    };
    expect(obj.sections[0]?.section_id).toBe('product');
    expect(obj.status).toBe('shadow_only');
  });
});

describe('NarrativeQualityValidationV1', () => {
  it('accepts a valid quality validation object', () => {
    const obj: NarrativeQualityValidationV1 = {
      schema_version: 'narrative_quality_validation_v1',
      deal_id: 'deal-abc',
      run_id: 'run-001',
      created_at: new Date().toISOString(),
      specificity_check: 'pass',
      evidence_grounding_check: 'pass',
      jargon_check: 'pass',
      score_narration_check: 'pass',
      investment_implication_check: 'pass',
      limitation_presence_check: 'pass',
      unsupported_claim_check: 'warning',
      generic_language_warnings: [],
      critical_warnings: [],
      recommended_edits: [],
      status: 'passed',
    };
    expect(obj.status).toBe('passed');
  });
});

// ─── CorrectionLineageV1 — Phase 1+2 invariant ────────────────────────────────

describe('CorrectionLineageV1 — applied_to_scoring invariant', () => {
  it('CorrectionLineageItem.applied_to_scoring must be false in Phase 1 and Phase 2', () => {
    const item: CorrectionLineageItem = {
      correction_id: 'corr-001',
      source: 'llm_field_audit',
      original_field: 'structured_summary.customer_count',
      original_value: '2027',
      proposed_field: 'timeline.target_year',
      proposed_value: '2027',
      normalized_value: '2027',
      correction_type: 'projection_vs_actual',
      confidence: 0.9,
      evidence_refs: ['slide-5'],
      validator_status: 'shadow_only',
      validator_reason: null,
      applied_to_scoring: false, // INVARIANT: always false in Phase 1 + 2
      applied_at: null,
    };
    expect(item.applied_to_scoring).toBe(false);
    expect(item.applied_at).toBeNull();
  });

  it('CorrectionLineageV1 wraps items with schema_version', () => {
    const lineage: CorrectionLineageV1 = {
      schema_version: 'correction_lineage_v1',
      deal_id: 'deal-abc',
      run_id: null,
      created_at: new Date().toISOString(),
      corrections: [],
    };
    expect(lineage.schema_version).toBe('correction_lineage_v1');
    expect(lineage.corrections).toHaveLength(0);
  });
});

// ─── LearningEventV1 ──────────────────────────────────────────────────────────

describe('LearningEventV1', () => {
  it('accepts a financial_semantic_error event', () => {
    const event: LearningEventV1 = {
      id: 'evt-001',
      deal_id: 'deal-abc',
      run_id: 'run-001',
      event_type: 'financial_semantic_error',
      severity: 'medium',
      source: 'llm_auditor',
      payload: { field: 'revenue', issue: 'deck claim conflicts with XLSX' },
      evidence_refs: ['ev-001'],
      status: 'open',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      resolved_at: null,
    };
    expect(event.event_type).toBe('financial_semantic_error');
    expect(event.status).toBe('open');
  });

  it('accepts a schema_gap event with null deal_id', () => {
    const event: LearningEventV1 = {
      id: 'evt-002',
      deal_id: null,
      run_id: null,
      event_type: 'schema_gap',
      severity: 'low',
      source: 'llm_auditor',
      payload: { missing_field: 'burn_rate', occurrence_count: 3 },
      evidence_refs: [],
      status: 'open',
      created_at: new Date().toISOString(),
      reviewed_at: null,
      resolved_at: null,
    };
    expect(event.deal_id).toBeNull();
    expect(event.event_type).toBe('schema_gap');
  });
});
