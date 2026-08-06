/**
 * LLM Financial Verifier — Phase 2 Shadow Implementation
 *
 * Runs the LLM Financial Verifier in shadow mode. Classifies each extracted
 * financial value by entity level, financial type, and underwritability.
 *
 * SHADOW MODE INVARIANTS:
 * - This function NEVER modifies financial_breakdown_v1, financial_coverage_v1,
 *   financial_facts, or any scoring fields.
 * - All output is advisory / informational only.
 * - Returns null on any error — always fail-open.
 * - Returns null when OPENAI_API_KEY is missing.
 */

import { OpenAIGPT4oProvider } from '../llm/providers/openai-provider.js';
import type { ProviderConfig } from '../llm/types.js';
import type {
  LLMFinancialVerificationV1,
  LLMVerifiedFinancialValue,
  FinancialGapItem,
  FinancialEntityLevel,
  FinancialType,
  FinancialUnderwritable,
  FinancialSourceKind,
} from '@dealdecision/core/dist/models/llm-financial-verification-v1';
import {
  FINANCIAL_VERIFIER_SYSTEM_PROMPT,
  buildFinancialVerifierUserPrompt,
  type FinancialVerifierInput,
} from './prompts/financial-verifier-prompt.js';

const MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 2500;

export type LLMTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type LLMFinancialVerifierResult = {
  verification: LLMFinancialVerificationV1;
  usage: LLMTokenUsage | null;
};

export type LLMFinancialVerifierInput = {
  deal_id: string;
  run_id: string | null;
  company_name: string | null;
  has_xlsx: boolean;
  has_cap_table: boolean;
  financial_breakdown: Record<string, unknown> | null;
  financial_facts: Array<{
    fact_id: string | null;
    metric: string;
    value: number | null;
    raw_value: string | null;
    period: string | null;
    source_kind: string | null;
    confidence: number | null;
    is_projection: boolean | null;
  }>;
  deck_financial_signals: Record<string, unknown> | null;
};

/**
 * Run the LLM Financial Verifier in shadow mode.
 *
 * Fails open — returns null on any exception or missing API key.
 * Never throws.
 */
export async function runLLMFinancialVerifier(
  input: LLMFinancialVerifierInput,
): Promise<LLMFinancialVerifierResult | null> {
  const { deal_id, run_id } = input;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log(
      JSON.stringify({
        event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_SKIPPED',
        deal_id,
        reason: 'missing_openai_api_key',
        ts: new Date().toISOString(),
      }),
    );
    return null;
  }

  // Skip if there are no financial facts and no financial breakdown to analyze
  const hasContent =
    (input.financial_facts && input.financial_facts.length > 0) ||
    (input.financial_breakdown && Object.keys(input.financial_breakdown).length > 0);

  if (!hasContent) {
    console.log(
      JSON.stringify({
        event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_SKIPPED',
        deal_id,
        reason: 'no_financial_content',
        ts: new Date().toISOString(),
      }),
    );
    return null;
  }

  console.log(
    JSON.stringify({
      event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_STARTED',
      deal_id,
      run_id,
      model: MODEL,
      fact_count: input.financial_facts.length,
      has_xlsx: input.has_xlsx,
      has_cap_table: input.has_cap_table,
      ts: new Date().toISOString(),
    }),
  );

  try {
    const providerConfig: ProviderConfig = {
      type: 'openai',
      enabled: true,
      priority: 1,
      apiKey,
      timeout: TIMEOUT_MS,
      retries: 2,
    };

    const provider = new OpenAIGPT4oProvider(providerConfig);

    const promptInput: FinancialVerifierInput = {
      deal_id,
      company_name: input.company_name,
      has_xlsx: input.has_xlsx,
      has_cap_table: input.has_cap_table,
      financial_breakdown: input.financial_breakdown,
      financial_facts: input.financial_facts,
      deck_financial_signals: input.deck_financial_signals,
    };

    const response = await provider.complete({
      task: 'synthesis',
      model: MODEL as any,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: FINANCIAL_VERIFIER_SYSTEM_PROMPT },
        { role: 'user', content: buildFinancialVerifierUserPrompt(promptInput) },
      ],
      metadata: { dealId: deal_id, kind: 'llm_financial_verification_v1' },
    });

    if (!response?.content) {
      console.warn(
        JSON.stringify({
          event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_SKIPPED',
          deal_id,
          reason: 'empty_response',
          ts: new Date().toISOString(),
        }),
      );
      return null;
    }

    const parsed = safeParseVerificationResponse(response.content);
    if (!parsed) {
      console.warn(
        JSON.stringify({
          event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_SKIPPED',
          deal_id,
          reason: 'parse_failed',
          ts: new Date().toISOString(),
        }),
      );
      return null;
    }

    const verifiedValues: LLMVerifiedFinancialValue[] = (parsed.verified_values ?? []).map(
      (v: any): LLMVerifiedFinancialValue => ({
        extraction_ref: v.extraction_ref ?? null,
        raw_value: v.raw_value ?? null,
        normalized_value: v.normalized_value ?? null,
        currency: v.currency ?? null,
        amount: typeof v.amount === 'number' ? v.amount : null,
        period: v.period ?? null,
        entity_level: toValidEntityLevel(v.entity_level),
        financial_type: toValidFinancialType(v.financial_type),
        confidence: clampConfidence(v.confidence),
        underwritable: toValidUnderwritable(v.underwritable),
        source_kind: toValidSourceKind(v.source_kind),
        evidence_refs: Array.isArray(v.evidence_refs) ? v.evidence_refs.map(String) : [],
        reason: String(v.reason ?? ''),
        flagged_as_projection: Boolean(v.flagged_as_projection),
        flagged_as_market_sizing: Boolean(v.flagged_as_market_sizing),
      }),
    );

    const financialGaps: FinancialGapItem[] = (parsed.financial_gaps ?? []).map(
      (g: any): FinancialGapItem => ({
        field: String(g.field ?? 'unknown'),
        description: String(g.description ?? ''),
        severity: toValidGapSeverity(g.severity),
      }),
    );

    const result: LLMFinancialVerificationV1 = {
      schema_version: 'llm_financial_verification_v1',
      deal_id,
      run_id,
      created_at: new Date().toISOString(),
      model: MODEL,
      provider: 'openai',
      verified_values: verifiedValues,
      financial_gaps: financialGaps,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      xlsx_data_present: Boolean(parsed.xlsx_data_present ?? input.has_xlsx),
      cap_table_present: Boolean(parsed.cap_table_present ?? input.has_cap_table),
    };

    const usage: LLMTokenUsage | null = response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : null;

    console.log(
      JSON.stringify({
        event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_COMPLETE',
        deal_id,
        run_id,
        verified_value_count: verifiedValues.length,
        financial_gap_count: financialGaps.length,
        xlsx_data_present: result.xlsx_data_present,
        cap_table_present: result.cap_table_present,
        latency_ms: response.latency_ms ?? null,
        tokens_prompt: usage?.prompt_tokens ?? null,
        tokens_completion: usage?.completion_tokens ?? null,
        tokens_total: usage?.total_tokens ?? null,
        ts: new Date().toISOString(),
      }),
    );

    return { verification: result, usage };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: 'LLM_FINANCIAL_VERIFICATION_SHADOW_SKIPPED',
        deal_id,
        reason: 'exception',
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseVerificationResponse(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content.trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

const VALID_ENTITY_LEVELS: FinancialEntityLevel[] = [
  'parent_company', 'subsidiary', 'spv', 'project', 'fund', 'unknown',
];

function toValidEntityLevel(raw: unknown): FinancialEntityLevel {
  if (typeof raw === 'string' && (VALID_ENTITY_LEVELS as string[]).includes(raw)) {
    return raw as FinancialEntityLevel;
  }
  return 'unknown';
}

const VALID_FINANCIAL_TYPES: FinancialType[] = [
  'current_revenue', 'historical_revenue', 'projected_revenue', 'modeled_economics',
  'capex', 'opex', 'debt_facility', 'equity_raise', 'safe', 'grant', 'valuation',
  'cash_balance', 'burn_rate', 'runway', 'use_of_funds', 'unit_economics',
  'customer_metric', 'unknown',
];

function toValidFinancialType(raw: unknown): FinancialType {
  if (typeof raw === 'string' && (VALID_FINANCIAL_TYPES as string[]).includes(raw)) {
    return raw as FinancialType;
  }
  return 'unknown';
}

function toValidUnderwritable(raw: unknown): FinancialUnderwritable {
  if (raw === 'yes' || raw === 'no' || raw === 'partial') return raw;
  return 'no';
}

const VALID_SOURCE_KINDS: FinancialSourceKind[] = [
  'audited_financial', 'spreadsheet_model', 'bank_statement', 'signed_contract',
  'third_party', 'management_claim', 'projection', 'deck', 'ocr_only', 'inferred', 'unknown',
];

function toValidSourceKind(raw: unknown): FinancialSourceKind {
  if (typeof raw === 'string' && (VALID_SOURCE_KINDS as string[]).includes(raw)) {
    return raw as FinancialSourceKind;
  }
  return 'unknown';
}

function toValidGapSeverity(raw: unknown): 'low' | 'medium' | 'high' {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'medium';
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'));
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
