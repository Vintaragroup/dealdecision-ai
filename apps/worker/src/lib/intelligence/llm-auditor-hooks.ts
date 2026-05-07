/**
 * LLM Auditor Shadow Hooks — Phase 2 Implementation
 *
 * These functions are the insertion points for the LLM Deal Understanding
 * Auditor modules. In Phase 2, the Field Auditor and Financial Verifier
 * are wired to real LLM calls. All other hooks remain noops until Phase 3+.
 *
 * AUTHORITY RULE: These hooks MUST NOT alter scoring, verdicts, coverage,
 * financials, or UI. Return values are informational only until the
 * Phase 3 validator pipeline gates their application.
 *
 * SHADOW MODE INVARIANTS (Phase 2):
 * - applied_to_scoring is ALWAYS false
 * - All audited_fields entries have status = 'shadow_only'
 * - No report fields are overwritten by hook outputs
 */

import type { LLMFieldAuditV1 } from '@dealdecision/core/dist/models/llm-field-audit-v1';
import type { LLMFinancialVerificationV1 } from '@dealdecision/core/dist/models/llm-financial-verification-v1';
import type { LLMSchemaGapV1 } from '@dealdecision/core/dist/models/llm-schema-gap-v1';
import type { LLMDecisionRationaleV1 } from '@dealdecision/core/dist/models/llm-decision-rationale-v1';
import type { LLMRationaleValidationV1 } from '@dealdecision/core/dist/models/llm-rationale-validation-v1';
import type { CorrectionLineageV1 } from '@dealdecision/core/dist/models/correction-lineage-v1';
import { runLLMFieldAuditor, type LLMFieldAuditorInput } from './llm-field-auditor.js';
import { runLLMFinancialVerifier, type LLMFinancialVerifierInput } from './llm-financial-verifier.js';
import {
  runDeterministicCorrectionValidatorV1,
  type DeterministicValidatorInput,
  type DeterministicValidatorOutput,
} from './deterministic-correction-validator-v1.js';
import { runLLMRationaleSynthesizer, type LLMRationaleSynthesizerInput } from './llm-rationale-synthesizer.js';
import { runLLMRationaleValidator, type LLMRationaleValidatorInput } from './llm-rationale-validator.js';
import type { LLMValidationSummaryV1 } from '@dealdecision/core/dist/models/llm-validation-summary-v1';

// ─── Phase 2: Field Audit Input ───────────────────────────────────────────────

export type FieldAuditShadowArgs = {
  deal_id: string;
  run_id?: string | null;
  company_name?: string | null;
  archetype?: string | null;
  structured_summary?: Record<string, unknown> | null;
  financial_breakdown?: Record<string, unknown> | null;
  promoted_facts_sample?: Array<{
    evidence_id: string;
    fact_type: string;
    content: Record<string, unknown>;
    confidence: number;
  }>;
  evidence_count?: number;
  has_xlsx?: boolean;
  has_cap_table?: boolean;
};

// ─── Phase 2: Financial Verification Input ────────────────────────────────────

export type FinancialVerificationShadowArgs = {
  deal_id: string;
  run_id?: string | null;
  company_name?: string | null;
  has_xlsx?: boolean;
  has_cap_table?: boolean;
  financial_breakdown?: Record<string, unknown> | null;
  financial_facts?: Array<{
    fact_id: string | null;
    metric: string;
    value: number | null;
    raw_value: string | null;
    period: string | null;
    source_kind: string | null;
    confidence: number | null;
    is_projection: boolean | null;
  }>;
  deck_financial_signals?: Record<string, unknown> | null;
};

// ─── Field Audit Hook ────────────────────────────────────────────────────────

/**
 * Phase 2: Calls the LLM Field Auditor in shadow mode.
 * All returned fields have status = 'shadow_only'. Never throws. Fail-open.
 */
export async function runLLMFieldAuditShadow(
  args: FieldAuditShadowArgs,
): Promise<LLMFieldAuditV1 | null> {
  const input: LLMFieldAuditorInput = {
    deal_id: args.deal_id,
    run_id: args.run_id ?? null,
    company_name: args.company_name ?? null,
    archetype: args.archetype ?? null,
    structured_summary: args.structured_summary ?? null,
    financial_breakdown: args.financial_breakdown ?? null,
    promoted_facts_sample: args.promoted_facts_sample ?? [],
    evidence_count: args.evidence_count ?? 0,
    has_xlsx: args.has_xlsx ?? false,
    has_cap_table: args.has_cap_table ?? false,
  };
  return runLLMFieldAuditor(input);
}

// ─── Financial Verification Hook ─────────────────────────────────────────────

/**
 * Phase 2: Calls the LLM Financial Verifier in shadow mode.
 * Output is advisory only — never rewrites deterministic financial fields.
 * Never throws. Fail-open.
 */
export async function runLLMFinancialVerificationShadow(
  args: FinancialVerificationShadowArgs,
): Promise<LLMFinancialVerificationV1 | null> {
  const input: LLMFinancialVerifierInput = {
    deal_id: args.deal_id,
    run_id: args.run_id ?? null,
    company_name: args.company_name ?? null,
    has_xlsx: args.has_xlsx ?? false,
    has_cap_table: args.has_cap_table ?? false,
    financial_breakdown: args.financial_breakdown ?? null,
    financial_facts: args.financial_facts ?? [],
    deck_financial_signals: args.deck_financial_signals ?? null,
  };
  return runLLMFinancialVerifier(input);
}

// ─── Schema Gap Hook ─────────────────────────────────────────────────────────

/**
 * Phase 1 noop. Phase 2 will call the Schema Gap Detector and return
 * a populated LLMSchemaGapV1.
 */
export async function runLLMSchemaGapShadow(_args: {
  deal_id: string;
  run_id?: string | null;
}): Promise<LLMSchemaGapV1 | null> {
  return null;
}

// ─── Decision Rationale Hook ─────────────────────────────────────────────────

export type RationaleShadowArgs = {
  deal_id: string;
  run_id?: string | null;
  /** Copied verbatim from deterministic pipeline — LLM explains, does NOT compute */
  canonical_verdict: string;
  company_name?: string | null;
  archetype?: string | null;
  conviction_summary?: string | null;
  financial_coverage_summary?: string | null;
  evidence_count?: number;
  has_xlsx?: boolean;
  has_cap_table?: boolean;
  strongest_evidence_items?: Array<{
    evidence_id: string;
    fact_type: string;
    summary: string;
    is_projection: boolean;
    source_kind: string;
    confidence: number;
  }>;
  financial_facts_summary?: Array<{
    metric: string;
    value: number | null;
    raw_value: string | null;
    period: string | null;
    is_projection: boolean | null;
    source_kind: string | null;
  }>;
  contradiction_summaries?: string[];
  missing_evidence_signals?: string[];
  accepted_corrections_summary?: string[];
  decision_readiness_score?: number | null;
  financial_completeness_pct?: number | null;
  underwriting_readiness_notes?: string[];
  section_health_summary?: Record<string, string> | null;
};

/**
 * Phase 4: Calls the LLM Decision Rationale Synthesizer in shadow mode.
 * Returns shadow_only rationale. Never throws. Fail-open.
 *
 * INVARIANT: canonical_verdict must be from the deterministic pipeline.
 * The LLM explains the verdict — it does NOT override or compute it.
 */
export async function runLLMDecisionRationaleShadow(
  args: RationaleShadowArgs,
): Promise<LLMDecisionRationaleV1 | null> {
  const input: LLMRationaleSynthesizerInput = {
    deal_id: args.deal_id,
    run_id: args.run_id ?? null,
    company_name: args.company_name ?? null,
    archetype: args.archetype ?? null,
    canonical_verdict: args.canonical_verdict,
    conviction_summary: args.conviction_summary ?? null,
    financial_coverage_summary: args.financial_coverage_summary ?? null,
    evidence_count: args.evidence_count ?? 0,
    has_xlsx: args.has_xlsx ?? false,
    has_cap_table: args.has_cap_table ?? false,
    strongest_evidence_items: args.strongest_evidence_items ?? [],
    financial_facts_summary: args.financial_facts_summary ?? [],
    contradiction_summaries: args.contradiction_summaries ?? [],
    missing_evidence_signals: args.missing_evidence_signals ?? [],
    accepted_corrections_summary: args.accepted_corrections_summary ?? [],
    decision_readiness_score: args.decision_readiness_score ?? null,
    financial_completeness_pct: args.financial_completeness_pct ?? null,
    underwriting_readiness_notes: args.underwriting_readiness_notes ?? [],
    section_health_summary: args.section_health_summary ?? null,
  };
  return runLLMRationaleSynthesizer(input);
}

// ─── Rationale Validation Hook ────────────────────────────────────────────────

export type RationaleValidationShadowArgs = {
  deal_id: string;
  run_id?: string | null;
  rationale: LLMDecisionRationaleV1;
  financial_facts_summary?: Array<{
    metric: string;
    raw_value: string | null;
    is_projection: boolean | null;
  }>;
};

/**
 * Phase 4: Calls the LLM Rationale Validator.
 * Validates that synthesized rationale is verdict-aligned, evidence-grounded,
 * jargon-free, and projection-safe before UI display.
 *
 * Returns 'validated' status on overall_status = 'passed'.
 * Returns null on error (fail-open).
 */
export async function runLLMRationaleValidationShadow(
  args: RationaleValidationShadowArgs,
): Promise<LLMRationaleValidationV1 | null> {
  const input: LLMRationaleValidatorInput = {
    deal_id: args.deal_id,
    run_id: args.run_id ?? null,
    rationale: args.rationale,
    financial_facts_summary: args.financial_facts_summary ?? [],
  };
  return runLLMRationaleValidator(input);
}

// ─── Correction Lineage Hook ──────────────────────────────────────────────────

// ─── Phase 3: Deterministic Validator Shadow Args ─────────────────────────────

export type DeterministicValidatorShadowArgs = {
  deal_id: string;
  run_id?: string | null;
  company_name?: string | null;
  archetype?: string | null;
  llm_field_audit: LLMFieldAuditV1 | null;
  llm_financial_verification: LLMFinancialVerificationV1 | null;
  /** Read-only reference — MUST NOT be mutated */
  structured_summary?: Record<string, unknown> | null;
  /** Read-only reference — MUST NOT be mutated */
  financial_breakdown?: Record<string, unknown> | null;
};

/**
 * Phase 3: Runs the DeterministicCorrectionValidatorV1 in shadow mode.
 * Produces correction lineage, learning events, and validation summary.
 *
 * INVARIANTS:
 * - applied_to_scoring is always false
 * - structured_summary and financial_breakdown are never mutated
 * - Never throws. Fail-open — returns null on any error.
 */
export async function runDeterministicValidatorShadow(
  args: DeterministicValidatorShadowArgs,
): Promise<DeterministicValidatorOutput | null> {
  try {
    const input: DeterministicValidatorInput = {
      deal_id: args.deal_id,
      run_id: args.run_id ?? null,
      company_name: args.company_name ?? null,
      archetype: args.archetype ?? null,
      llm_field_audit: args.llm_field_audit,
      llm_financial_verification: args.llm_financial_verification,
      structured_summary: args.structured_summary ?? null,
      financial_breakdown: args.financial_breakdown ?? null,
    };
    return runDeterministicCorrectionValidatorV1(input);
  } catch {
    return null;
  }
}

/**
 * Phase 3: Aggregates accepted corrections from field audit + financial verification
 * via the validator. Returns the populated CorrectionLineageV1.
 *
 * Phase 1/2 noop shape preserved as wrapper — use runDeterministicValidatorShadow
 * directly for the full output including learning events and summary.
 */
export async function buildCorrectionLineageShadow(args: {
  deal_id: string;
  run_id?: string | null;
  llm_field_audit?: LLMFieldAuditV1 | null;
  llm_financial_verification?: LLMFinancialVerificationV1 | null;
  structured_summary?: Record<string, unknown> | null;
  financial_breakdown?: Record<string, unknown> | null;
}): Promise<CorrectionLineageV1[] | null> {
  const result = await runDeterministicValidatorShadow({
    deal_id: args.deal_id,
    run_id: args.run_id,
    llm_field_audit: args.llm_field_audit ?? null,
    llm_financial_verification: args.llm_financial_verification ?? null,
    structured_summary: args.structured_summary ?? null,
    financial_breakdown: args.financial_breakdown ?? null,
  });
  if (!result) return null;
  return [result.correction_lineage];
}

export type { DeterministicValidatorOutput, LLMValidationSummaryV1 };
