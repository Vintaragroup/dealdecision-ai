/**
 * LLM Field Auditor — Phase 2 Shadow Implementation
 *
 * Runs the LLM Field Auditor in shadow mode. Calls the OpenAI provider
 * with a curated prompt and returns an LLMFieldAuditV1 object.
 *
 * SHADOW MODE INVARIANTS:
 * - All returned LLMAuditedField entries have status = 'shadow_only'
 * - This function NEVER modifies structured_summary, financial_breakdown_v1,
 *   financial_coverage_v1, conviction_v1, or any scoring fields.
 * - Returns null on any error — always fail-open.
 * - Returns null when OPENAI_API_KEY is missing.
 */

import { OpenAIGPT4oProvider } from '../llm/providers/openai-provider.js';
import type { ProviderConfig } from '../llm/types.js';
import type {
  LLMFieldAuditV1,
  LLMAuditedField,
  LLMFieldRiskFlag,
  LLMFieldCorrectionType,
  LLMFieldCorrectionStatus,
} from '@dealdecision/core/dist/models/llm-field-audit-v1';
import {
  FIELD_AUDITOR_SYSTEM_PROMPT,
  buildFieldAuditorUserPrompt,
  type FieldAuditorInput,
} from './prompts/field-auditor-prompt.js';

const MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 2000;

export type LLMFieldAuditorInput = {
  deal_id: string;
  run_id: string | null;
  company_name: string | null;
  archetype: string | null;
  structured_summary: Record<string, unknown> | null;
  financial_breakdown: Record<string, unknown> | null;
  promoted_facts_sample: Array<{
    evidence_id: string;
    fact_type: string;
    content: Record<string, unknown>;
    confidence: number;
  }>;
  evidence_count: number;
  has_xlsx: boolean;
  has_cap_table: boolean;
};

/**
 * Run the LLM Field Auditor in shadow mode.
 *
 * Fails open — returns null on any exception or missing API key.
 * Never throws.
 */
export async function runLLMFieldAuditor(
  input: LLMFieldAuditorInput,
): Promise<LLMFieldAuditV1 | null> {
  const { deal_id, run_id } = input;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log(
      JSON.stringify({
        event: 'LLM_FIELD_AUDIT_SHADOW_SKIPPED',
        deal_id,
        reason: 'missing_openai_api_key',
        ts: new Date().toISOString(),
      }),
    );
    return null;
  }

  console.log(
    JSON.stringify({
      event: 'LLM_FIELD_AUDIT_SHADOW_STARTED',
      deal_id,
      run_id,
      model: MODEL,
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

    const promptInput: FieldAuditorInput = {
      deal_id,
      company_name: input.company_name,
      archetype: input.archetype,
      structured_summary: input.structured_summary,
      financial_breakdown: input.financial_breakdown,
      promoted_facts_sample: input.promoted_facts_sample,
      evidence_count: input.evidence_count,
      has_xlsx: input.has_xlsx,
      has_cap_table: input.has_cap_table,
    };

    const response = await provider.complete({
      task: 'synthesis',
      model: MODEL as any,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: FIELD_AUDITOR_SYSTEM_PROMPT },
        { role: 'user', content: buildFieldAuditorUserPrompt(promptInput) },
      ],
      metadata: { dealId: deal_id, kind: 'llm_field_audit_v1' },
    });

    if (!response?.content) {
      console.warn(
        JSON.stringify({
          event: 'LLM_FIELD_AUDIT_SHADOW_SKIPPED',
          deal_id,
          reason: 'empty_response',
          ts: new Date().toISOString(),
        }),
      );
      return null;
    }

    const parsed = safeParseAuditResponse(response.content);
    if (!parsed) {
      console.warn(
        JSON.stringify({
          event: 'LLM_FIELD_AUDIT_SHADOW_SKIPPED',
          deal_id,
          reason: 'parse_failed',
          ts: new Date().toISOString(),
        }),
      );
      return null;
    }

    // Build the typed result — all fields are shadow_only
    const auditedFields: LLMAuditedField[] = (parsed.audited_fields ?? []).map(
      (f: any): LLMAuditedField => ({
        source_field: String(f.source_field ?? ''),
        source_value: f.source_value ?? null,
        proposed_field: f.proposed_field ?? f.source_field ?? '',
        proposed_value: f.proposed_value ?? null,
        correction_type: toValidCorrectionType(f.correction_type),
        confidence: clampConfidence(f.confidence),
        evidence_refs: Array.isArray(f.evidence_refs) ? f.evidence_refs.map(String) : [],
        reason: String(f.reason ?? ''),
        status: 'shadow_only' as LLMFieldCorrectionStatus,
      }),
    );

    const riskFlags: LLMFieldRiskFlag[] = (parsed.risk_flags ?? []).map(
      (r: any): LLMFieldRiskFlag => ({
        field: String(r.flag_type ?? r.field ?? 'unknown'),
        description: String(r.description ?? ''),
        severity: toValidSeverity(r.confidence),
      }),
    );

    const archetype_at_audit = input.archetype;
    const archetype_correction =
      parsed.archetype_correction && input.archetype
        ? {
            original: input.archetype,
            proposed: String(parsed.archetype_correction),
            confidence: clampConfidence(parsed.archetype_confidence),
            reason: String(parsed.summary ?? ''),
          }
        : null;

    const result: LLMFieldAuditV1 = {
      schema_version: 'llm_field_audit_v1',
      deal_id,
      run_id,
      created_at: new Date().toISOString(),
      model: MODEL,
      provider: 'openai',
      archetype_at_audit,
      archetype_correction,
      audited_fields: auditedFields,
      risk_flags: riskFlags,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      audit_confidence: clampConfidence(parsed.audit_confidence),
      evidence_count_at_audit: input.evidence_count,
    };

    console.log(
      JSON.stringify({
        event: 'LLM_FIELD_AUDIT_SHADOW_COMPLETE',
        deal_id,
        run_id,
        audited_field_count: auditedFields.length,
        risk_flag_count: riskFlags.length,
        audit_confidence: result.audit_confidence,
        latency_ms: response.latency_ms ?? null,
        ts: new Date().toISOString(),
      }),
    );

    return result;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: 'LLM_FIELD_AUDIT_SHADOW_SKIPPED',
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

function safeParseAuditResponse(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content.trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Try to extract JSON object from text
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

const VALID_CORRECTION_TYPES: LLMFieldCorrectionType[] = [
  'misplaced_field',
  'wrong_entity_type',
  'wrong_financial_category',
  'projection_vs_actual',
  'duplicate_or_alias',
  'unsupported_value',
  'schema_gap',
];

function toValidCorrectionType(raw: unknown): LLMFieldCorrectionType {
  // Map prompt output to internal types
  if (raw === 'no_change') return 'schema_gap'; // no_change = effectively no correction needed
  if (raw === 'field_rename') return 'misplaced_field';
  if (raw === 'value_normalization') return 'unsupported_value';
  if (raw === 'type_correction') return 'wrong_financial_category';
  if (raw === 'archetype_shift') return 'wrong_entity_type';
  if (typeof raw === 'string' && (VALID_CORRECTION_TYPES as string[]).includes(raw)) {
    return raw as LLMFieldCorrectionType;
  }
  return 'schema_gap';
}

function toValidSeverity(confidence: unknown): 'low' | 'medium' | 'high' {
  const c = typeof confidence === 'number' ? confidence : 0;
  if (c >= 0.8) return 'high';
  if (c >= 0.5) return 'medium';
  return 'low';
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'));
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
