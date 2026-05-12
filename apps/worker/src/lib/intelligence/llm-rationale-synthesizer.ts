/**
 * LLM Decision Rationale Synthesizer — Phase 4 Implementation
 *
 * Synthesizes an investor-grade decision rationale from deterministic signals.
 *
 * AUTHORITY RULE: The LLM explains the verdict — it does NOT compute it.
 * canonical_verdict MUST be the deterministic conviction/recommendation.
 *
 * SHADOW MODE INVARIANTS:
 * - This function NEVER modifies conviction_v1, conviction_v2, canonical_decision_v2,
 *   structured_summary, financial_breakdown_v1, financial_coverage_v1, or any
 *   scoring or verdict fields.
 * - Returns null on any error — always fail-open.
 * - Returns null when OPENAI_API_KEY is missing.
 * - All returned rationale objects have status = 'shadow_only' until validated.
 */

import { OpenAIGPT4oProvider } from '../llm/providers/openai-provider.js';
import type { ProviderConfig } from '../llm/types.js';
import type { LLMDecisionRationaleV1, DecisionRationaleStatus } from '@dealdecision/core/dist/models/llm-decision-rationale-v1';
import {
  RATIONALE_SYNTHESIZER_SYSTEM_PROMPT,
  buildRationaleSynthesizerUserPrompt,
  type RationaleSynthesizerInput,
} from './prompts/rationale-synthesizer-prompt.js';

const MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 40_000;
const MAX_TOKENS = 2500;

export type LLMRationaleSynthesizerInput = {
  deal_id: string;
  run_id: string | null;
  company_name: string | null;
  archetype: string | null;
  /** Copied verbatim from the deterministic pipeline */
  canonical_verdict: string;
  /** Plain-text conviction summary — do NOT pass raw scoring object */
  conviction_summary: string | null;
  financial_coverage_summary: string | null;
  evidence_count: number;
  has_xlsx: boolean;
  has_cap_table: boolean;
  strongest_evidence_items: Array<{
    evidence_id: string;
    fact_type: string;
    summary: string;
    is_projection: boolean;
    source_kind: string;
    confidence: number;
  }>;
  financial_facts_summary: Array<{
    metric: string;
    value: number | null;
    raw_value: string | null;
    period: string | null;
    is_projection: boolean | null;
    source_kind: string | null;
  }>;
  contradiction_summaries: string[];
  missing_evidence_signals: string[];
  accepted_corrections_summary: string[];
  decision_readiness_score: number | null;
  financial_completeness_pct: number | null;
  underwriting_readiness_notes: string[];
  section_health_summary: Record<string, string> | null;
};

// ─── Raw LLM Response Type ────────────────────────────────────────────────────

interface RationaleRawResponse {
  primary_reason?: unknown;
  why_not_pass?: unknown;
  why_not_reject?: unknown;
  strongest_signals?: unknown;
  gating_risks?: unknown;
  missing_evidence?: unknown;
  confidence_explanation?: unknown;
  evidence_refs?: unknown;
  source_quality_notes?: unknown;
  backend_terms_removed?: unknown;
  generation_warnings?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v) => typeof v === 'string');
}

function safeString(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
}

/**
 * Run the LLM Decision Rationale Synthesizer in shadow mode.
 *
 * Returns null on any error (fail-open). All returned objects have
 * status = 'shadow_only' until the Rationale Validator upgrades them.
 */
export async function runLLMRationaleSynthesizer(
  input: LLMRationaleSynthesizerInput,
): Promise<LLMDecisionRationaleV1 | null> {
  if (!process.env['OPENAI_API_KEY']) {
    return null;
  }

  if (!input.canonical_verdict || input.canonical_verdict.trim() === '') {
    return null;
  }

  try {
    const providerConfig: ProviderConfig = {
      type: 'openai',
      enabled: true,
      priority: 1,
      apiKey: process.env['OPENAI_API_KEY']!,
      timeout: TIMEOUT_MS,
      retries: 1,
    };
    const provider = new OpenAIGPT4oProvider(providerConfig);

    const synthInput: RationaleSynthesizerInput = {
      deal_id: input.deal_id,
      company_name: input.company_name,
      archetype: input.archetype,
      canonical_verdict: input.canonical_verdict,
      conviction_summary: input.conviction_summary,
      financial_coverage_summary: input.financial_coverage_summary,
      evidence_count: input.evidence_count,
      has_xlsx: input.has_xlsx,
      has_cap_table: input.has_cap_table,
      strongest_evidence_items: input.strongest_evidence_items,
      financial_facts_summary: input.financial_facts_summary,
      contradiction_summaries: input.contradiction_summaries,
      missing_evidence_signals: input.missing_evidence_signals,
      accepted_corrections_summary: input.accepted_corrections_summary,
      decision_readiness_score: input.decision_readiness_score,
      financial_completeness_pct: input.financial_completeness_pct,
      underwriting_readiness_notes: input.underwriting_readiness_notes,
      section_health_summary: input.section_health_summary,
    };

    const userPrompt = buildRationaleSynthesizerUserPrompt(synthInput);

    const response = await provider.complete({
      task: 'synthesis',
      model: MODEL as any,
      temperature: 0.1,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: RATIONALE_SYNTHESIZER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      metadata: { dealId: input.deal_id, kind: 'llm_decision_rationale_v1' },
    });

    const rawText = response.content?.trim() ?? '';
    if (!rawText) {
      return null;
    }

    // Strip markdown fences if present
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      : rawText;

    let parsed: RationaleRawResponse;
    try {
      parsed = JSON.parse(jsonText) as RationaleRawResponse;
    } catch {
      console.log(
        JSON.stringify({
          event: 'RATIONALE_SYNTHESIZER_PARSE_ERROR',
          deal_id: input.deal_id,
          run_id: input.run_id,
          raw_length: rawText.length,
        }),
      );
      return null;
    }

    const rationale: LLMDecisionRationaleV1 = {
      schema_version: 'llm_decision_rationale_v1',
      deal_id: input.deal_id,
      run_id: input.run_id,
      created_at: new Date().toISOString(),
      model: MODEL,
      provider: 'openai',
      canonical_verdict: input.canonical_verdict,
      primary_reason: safeString(parsed.primary_reason, 'Rationale not generated.'),
      why_not_pass: safeStringArray(parsed.why_not_pass),
      why_not_reject: safeStringArray(parsed.why_not_reject),
      strongest_signals: safeStringArray(parsed.strongest_signals),
      gating_risks: safeStringArray(parsed.gating_risks),
      missing_evidence: safeStringArray(parsed.missing_evidence),
      confidence_explanation: safeString(
        parsed.confidence_explanation,
        'Confidence basis not available.',
      ),
      evidence_refs: safeStringArray(parsed.evidence_refs),
      source_quality_notes: safeStringArray(parsed.source_quality_notes),
      backend_terms_removed: safeStringArray(parsed.backend_terms_removed),
      generation_warnings: safeStringArray(parsed.generation_warnings),
      status: 'shadow_only' as DecisionRationaleStatus,
      validation_run_id: null,
    };

    console.log(
      JSON.stringify({
        event: 'RATIONALE_SYNTHESIZER_COMPLETE',
        deal_id: input.deal_id,
        run_id: input.run_id,
        canonical_verdict: input.canonical_verdict,
        evidence_refs_count: rationale.evidence_refs.length,
        has_warnings: rationale.generation_warnings.length > 0,
        status: rationale.status,
      }),
    );

    return rationale;
  } catch {
    return null;
  }
}
