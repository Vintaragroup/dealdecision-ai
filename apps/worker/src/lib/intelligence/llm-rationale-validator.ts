/**
 * LLM Rationale Validator — Phase 4 Implementation
 *
 * Validates a synthesized LLMDecisionRationaleV1 before it reaches UI or
 * is promoted to 'validated' status.
 *
 * Architecture:
 * - Deterministic pre-check (via llm-rationale-validator-deterministic.ts)
 *   runs synchronously and can short-circuit without an LLM call.
 * - LLM call (gpt-4o-mini) checks verdict alignment, evidence grounding,
 *   financial claim safety, and duplicate narrative.
 *
 * AUTHORITY RULE: Even a 'passed' validation does NOT permit the rationale
 * to alter the deterministic verdict. Validation gates UI display only.
 *
 * SHADOW MODE:
 * - Returns null on any error — always fail-open
 * - Returns null when OPENAI_API_KEY is missing
 */

import { OpenAIGPT4oProvider } from '../llm/providers/openai-provider.js';
import type { ProviderConfig } from '../llm/types.js';
import type {
  LLMRationaleValidationV1,
  RationaleCheckResult,
  RationaleValidationStatus,
} from '@dealdecision/core/dist/models/llm-rationale-validation-v1';
import type { LLMDecisionRationaleV1 } from '@dealdecision/core/dist/models/llm-decision-rationale-v1';
import {
  RATIONALE_VALIDATOR_SYSTEM_PROMPT,
  buildRationaleValidatorUserPrompt,
  type RationaleValidatorInput,
} from './prompts/rationale-validator-prompt.js';
import { runLLMRationaleValidatorV1 } from './llm-rationale-validator-deterministic.js';

const MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1500;

export type LLMRationaleValidatorInput = {
  deal_id: string;
  run_id: string | null;
  rationale: LLMDecisionRationaleV1;
  /** Financial facts used by the synthesizer — for claim accuracy checking */
  financial_facts_summary: Array<{
    metric: string;
    raw_value: string | null;
    is_projection: boolean | null;
  }>;
};

// ─── Raw LLM Response Type ────────────────────────────────────────────────────

interface ValidatorRawResponse {
  verdict_alignment?: unknown;
  evidence_alignment?: unknown;
  jargon_check?: unknown;
  financial_claim_check?: unknown;
  unsupported_claims?: unknown;
  backend_jargon_found?: unknown;
  projected_as_actual_warnings?: unknown;
  duplicate_narrative_warnings?: unknown;
  recommended_edits?: unknown;
  overall_status?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeCheckResult(val: unknown): RationaleCheckResult {
  if (val === 'pass' || val === 'fail' || val === 'warning') return val;
  return 'warning';
}

function safeValidationStatus(val: unknown): RationaleValidationStatus {
  if (val === 'passed' || val === 'failed' || val === 'needs_review') return val;
  return 'needs_review';
}

function safeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v) => typeof v === 'string');
}

/**
 * Run the LLM Rationale Validator.
 *
 * Runs deterministic pre-checks first (via runLLMRationaleValidatorV1).
 * If backend jargon or score narration is found, the LLM call is skipped
 * and the validation is marked as failed immediately.
 *
 * Returns null on any error (fail-open). Never throws.
 */
export async function runLLMRationaleValidator(
  input: LLMRationaleValidatorInput,
): Promise<LLMRationaleValidationV1 | null> {
  if (!process.env['OPENAI_API_KEY']) {
    return null;
  }

  const { rationale } = input;
  const runId = input.run_id;
  const dealId = input.deal_id;

  try {
    // ── Step 1: Deterministic pre-validation ────────────────────────────────
    const deterministicResult = runLLMRationaleValidatorV1({
      deal_id: dealId,
      run_id: runId,
      rationale,
      financial_facts_summary: input.financial_facts_summary,
    });

    if (deterministicResult.overall_status === 'failed') {
      console.log(
        JSON.stringify({
          event: 'RATIONALE_VALIDATOR_DETERMINISTIC_FAIL',
          deal_id: dealId,
          run_id: runId,
          jargon_count: deterministicResult.backend_jargon_found.length,
        }),
      );
      return deterministicResult;
    }

    // ── Step 2: LLM validation ───────────────────────────────────────────────
    const providerConfig: ProviderConfig = {
      type: 'openai',
      enabled: true,
      priority: 1,
      apiKey: process.env['OPENAI_API_KEY']!,
      timeout: TIMEOUT_MS,
      retries: 1,
    };
    const provider = new OpenAIGPT4oProvider(providerConfig);

    const validatorInput: RationaleValidatorInput = {
      canonical_verdict: rationale.canonical_verdict,
      rationale_run_id: rationale.run_id,
      primary_reason: rationale.primary_reason,
      why_not_pass: rationale.why_not_pass,
      why_not_reject: rationale.why_not_reject,
      strongest_signals: rationale.strongest_signals,
      gating_risks: rationale.gating_risks,
      missing_evidence: rationale.missing_evidence,
      confidence_explanation: rationale.confidence_explanation,
      evidence_refs: rationale.evidence_refs,
      source_quality_notes: rationale.source_quality_notes,
      backend_terms_removed: rationale.backend_terms_removed,
      generation_warnings: rationale.generation_warnings,
      available_evidence_refs: rationale.evidence_refs,
      financial_facts_summary: input.financial_facts_summary,
    };

    const userPrompt = buildRationaleValidatorUserPrompt(validatorInput);

    const response = await provider.complete({
      task: 'synthesis',
      model: MODEL as any,
      temperature: 0.0,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: RATIONALE_VALIDATOR_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      metadata: { dealId: dealId, kind: 'llm_rationale_validation_v1' },
    });

    const rawText = response.content?.trim() ?? '';
    if (!rawText) {
      return null;
    }

    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      : rawText;

    let parsed: ValidatorRawResponse;
    try {
      parsed = JSON.parse(jsonText) as ValidatorRawResponse;
    } catch {
      console.log(
        JSON.stringify({
          event: 'RATIONALE_VALIDATOR_PARSE_ERROR',
          deal_id: dealId,
          run_id: runId,
          raw_length: rawText.length,
        }),
      );
      return null;
    }

    const validation: LLMRationaleValidationV1 = {
      schema_version: 'llm_rationale_validation_v1',
      deal_id: dealId,
      run_id: runId,
      created_at: new Date().toISOString(),
      model: MODEL,
      provider: 'openai',
      rationale_run_id: rationale.run_id,
      verdict_alignment: safeCheckResult(parsed.verdict_alignment),
      evidence_alignment: safeCheckResult(parsed.evidence_alignment),
      jargon_check: safeCheckResult(parsed.jargon_check),
      financial_claim_check: safeCheckResult(parsed.financial_claim_check),
      unsupported_claims: safeStringArray(parsed.unsupported_claims),
      backend_jargon_found: safeStringArray(parsed.backend_jargon_found),
      projected_as_actual_warnings: safeStringArray(parsed.projected_as_actual_warnings),
      recommended_edits: safeStringArray(parsed.recommended_edits),
      overall_status: safeValidationStatus(parsed.overall_status),
    };

    console.log(
      JSON.stringify({
        event: 'RATIONALE_VALIDATOR_COMPLETE',
        deal_id: dealId,
        run_id: runId,
        overall_status: validation.overall_status,
        verdict_alignment: validation.verdict_alignment,
        jargon_check: validation.jargon_check,
        unsupported_claim_count: validation.unsupported_claims.length,
      }),
    );

    return validation;
  } catch {
    return null;
  }
}
