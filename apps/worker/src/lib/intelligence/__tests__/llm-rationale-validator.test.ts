/**
 * Tests for LLM Rationale Validator — Phase 4
 *
 * Focuses on deterministic pre-validation rules (jargon, score narration,
 * projection-as-actual) and overall validation contract shape.
 */

import { describe, it, expect } from 'vitest';
import { runLLMRationaleValidatorV1 } from '../llm-rationale-validator-deterministic';
import type { LLMDecisionRationaleV1 } from '@dealdecision/core/dist/models/llm-decision-rationale-v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRationale(overrides: Partial<LLMDecisionRationaleV1> = {}): LLMDecisionRationaleV1 {
  return {
    schema_version: 'llm_decision_rationale_v1',
    deal_id: 'deal-test-001',
    run_id: 'run-test-001',
    created_at: new Date().toISOString(),
    model: 'gpt-4o-mini',
    provider: 'openai',
    canonical_verdict: 'INVESTIGATE',
    primary_reason:
      'Climatic presents a coherent infrastructure-scale ammonia deployment strategy, but the current package lacks underwriting-grade financial evidence to support the projected capital deployment timeline.',
    why_not_pass: [
      'No audited financials provided — revenue figures are management projections only.',
      'Cap table details are absent; dilution risk cannot be assessed.',
    ],
    why_not_reject: [
      'The founding team carries deep sector expertise in industrial energy systems.',
      'The addressable market is supported by independent climate infrastructure reports.',
    ],
    strongest_signals: [
      'Signed LOIs with two regional utilities covering an estimated 200MW of deployment.',
      'ARPA-E grant awarded — independent technical validation of core technology.',
    ],
    gating_risks: [
      'Regulatory approvals for ammonia storage in target jurisdictions are unresolved.',
    ],
    missing_evidence: [
      'Audited financial statements or bank-verified cash position.',
      'Cap table with current ownership percentages and option pool size.',
    ],
    confidence_explanation:
      'Evidence set is sparse but directionally coherent. Recommend requesting verified financials before moving to IC.',
    evidence_refs: ['ev-001', 'ev-002', 'ev-003'],
    source_quality_notes: [
      'Primary financials sourced from pitch deck — not independently verified.',
    ],
    backend_terms_removed: [],
    generation_warnings: [],
    status: 'shadow_only',
    validation_run_id: null,
    ...overrides,
  };
}

// ─── Deterministic Validator (synchronous) — exported separately ──────────────

// NOTE: runLLMRationaleValidatorV1 is the synchronous deterministic-only
// pre-validator exported from a separate module. The full async validator
// (runLLMRationaleValidator) requires OPENAI_API_KEY and is tested in
// integration. These unit tests cover deterministic checks only.

// We test the deterministic pre-validation logic by directly checking
// the jargon / score narration scan behavior.

describe('Rationale Validator — deterministic pre-validation', () => {
  it('flags score narration: "47.1/100" in primary_reason', () => {
    const rationale = makeRationale({
      primary_reason: 'Initial analysis warrants further investigation (47.1/100).',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-001',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.overall_status).toBe('failed');
    expect(result.jargon_check).toBe('fail');
  });

  it('flags score narration: full integer "83/100"', () => {
    const rationale = makeRationale({
      primary_reason: 'The deal scored 83/100 against our benchmarks.',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-002',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.overall_status).toBe('failed');
    expect(result.jargon_check).toBe('fail');
  });

  it('flags backend jargon: conviction_v1', () => {
    const rationale = makeRationale({
      primary_reason: 'Based on conviction_v1, the deal appears strong.',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-003',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.backend_jargon_found).toContain('conviction_v1');
    expect(result.overall_status).toBe('failed');
  });

  it('flags backend jargon: hard_pass', () => {
    const rationale = makeRationale({
      confidence_explanation: 'This would be a hard_pass based on financial coverage.',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-004',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.backend_jargon_found).toContain('hard_pass');
    expect(result.overall_status).toBe('failed');
  });

  it('flags backend jargon: ORS in standalone position', () => {
    const rationale = makeRationale({
      primary_reason: 'The ORS score indicates medium readiness.',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-005',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.overall_status).toBe('failed');
    expect(result.jargon_check).toBe('fail');
  });

  it('passes a clean IC-memo-style rationale', () => {
    const rationale = makeRationale();
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-006',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.backend_jargon_found).toHaveLength(0);
    expect(result.jargon_check).toBe('pass');
    // NOTE: overall_status may be 'needs_review' due to no LLM check
    expect(['passed', 'needs_review']).toContain(result.overall_status);
  });

  it('flags score_narration: "below threshold" in why_not_pass', () => {
    const rationale = makeRationale({
      why_not_pass: ['Revenue is below threshold for Series A consideration.'],
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-007',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.overall_status).toBe('failed');
    expect(result.jargon_check).toBe('fail');
  });

  it('flags backend jargon: financial_coverage_v1', () => {
    const rationale = makeRationale({
      confidence_explanation: 'financial_coverage_v1 shows low completeness.',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-008',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.backend_jargon_found).toContain('financial_coverage_v1');
    expect(result.overall_status).toBe('failed');
  });

  it('output always contains correct schema_version', () => {
    const rationale = makeRationale();
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-009',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.schema_version).toBe('llm_rationale_validation_v1');
  });

  it('output always links back to rationale_run_id', () => {
    const rationale = makeRationale({ run_id: 'run-from-rationale' });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-010',
      run_id: 'run-validator',
      rationale,
      financial_facts_summary: [],
    });
    expect(result.rationale_run_id).toBe('run-from-rationale');
  });

  it('returns arrays not null for unsupported_claims, backend_jargon_found, etc.', () => {
    const rationale = makeRationale();
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-011',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    expect(Array.isArray(result.unsupported_claims)).toBe(true);
    expect(Array.isArray(result.backend_jargon_found)).toBe(true);
    expect(Array.isArray(result.projected_as_actual_warnings)).toBe(true);
    expect(Array.isArray(result.recommended_edits)).toBe(true);
  });

  it('verdict_alignment check: INVESTIGATE rationale aligned with INVESTIGATE verdict', () => {
    const rationale = makeRationale({
      canonical_verdict: 'INVESTIGATE',
      primary_reason: 'Further diligence required before a pass or reject decision can be made.',
    });
    const result = runLLMRationaleValidatorV1({
      deal_id: 'deal-test-012',
      run_id: 'run-001',
      rationale,
      financial_facts_summary: [],
    });
    // Deterministic check cannot fully resolve verdict alignment without LLM
    // but should not fail on a clean rationale
    expect(result.jargon_check).toBe('pass');
    expect(result.backend_jargon_found).toHaveLength(0);
  });
});
