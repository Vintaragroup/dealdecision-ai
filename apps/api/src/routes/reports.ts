/**
 * Report Routes
 *
 * Endpoints for generating and retrieving deal analysis reports.
 *
 * Important contract:
 * - /api/v1/deals/:deal_id/report must NOT 404 in normal pre-analysis / in-progress states.
 * - Readiness is determined from persisted Postgres artifacts (deal_intelligence_objects).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { compileDIOToReport, compileDIOToReportWithPromotedFacts } from '@dealdecision/core';
import { buildDeterministicScoreInputsV1 } from '@dealdecision/core';
import { computeDecisionV1, computeHardPassGuardrailV2, getScoreBandV2 } from '@dealdecision/core';
import { LlmNarrationV1Schema, degradeNarrationV1, validateNoNewFacts } from '@dealdecision/core';
import { buildNarrationPrompt } from '@dealdecision/core';
import type { LlmNarrationV1Type } from '@dealdecision/core';
import { buildOverviewPrompt, degradeOverviewV1 } from '@dealdecision/core';
import { buildInvestmentAnalysisOverviewPrompt, LlmOverviewV1Schema } from '@dealdecision/core';
import { loadPromotedFactsForDeal } from '../lib/promoted-facts';
import { derivePromotedFactsFromDpuForDeal } from '../lib/promoted-facts-from-dpu';
import { compileDealSummaryV1 } from '../lib/deal-summary-v1';
import { getSegmentedNodesForDeal } from '../lib/segmented-nodes-for-deal';
import { inferDeckArchetypeV1 } from '../lib/deck-archetypes';
import { compileStructuredSummaryExtras } from '../lib/structured-summary-extras';
import { buildBusinessModelSummaryV1 } from '../lib/reports/business-model-summary';
import { computeArchetypeSegmentDriftV1 } from '../lib/archetype-segment-drift-v1';
import { computeOverrideQualityV1 } from '../lib/override-quality-v1';
import { computeDeterministicModifierV1, computeDeterministicScorePreviewV1Diagnostics, shouldPinUnadjusted } from '../lib/deterministic-score-preview-v1';

const isUuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;

const envFlagEnabled = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const asFiniteNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const asFiniteInt = (v: unknown): number | null => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
};

type OpenAIChatCompletionResponse = {
  model: string;
  choices: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const NARRATION_PROMPT_VERSION = 'glnl_v2_insights_v1';
const OVERVIEW_PROMPT_VERSION = 'glnl_v1_overview_v1';
const INVESTMENT_ANALYSIS_OVERVIEW_PROMPT_VERSION = 'ia_v1_reasoning_only';

type NarrationDevCacheValue = {
  narration: LlmNarrationV1Type;
  meta: { model: string; usage?: OpenAIChatCompletionResponse['usage'] | null };
  created_at_ms: number;
};

const narrationDevCache = new Map<string, NarrationDevCacheValue>();

const stableHash = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

async function openaiChatCompletion(params: {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  maxTokens: number;
  responseFormat?: { type: 'json_object' };
}): Promise<{ content: string; model: string; usage?: OpenAIChatCompletionResponse['usage']; finish_reason?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `OpenAI request failed with ${res.status}`);
  }

  const json = (await res.json()) as OpenAIChatCompletionResponse;
  const choice0 = json?.choices?.[0];
  const content = choice0?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('OpenAI returned empty content');
  }
  return { content, model: json.model, usage: json.usage, finish_reason: choice0?.finish_reason };
}

const parseJsonOnly = (raw: string): unknown => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('empty_model_output');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('model_output_not_json');
  }
};

const normalizeKpiForNarrationExcerpt = (kpi: any): any => {
  if (!kpi || typeof kpi !== 'object') return kpi;
  const out: any = { ...kpi };

  if (out.value_raw == null && out.value && typeof out.value === 'object') {
    const raw = (out.value as any).raw;
    if (typeof raw === 'string' && raw.trim()) out.value_raw = raw;
  }

  // Guard expects a single deterministic `source` object (page + optional slide_title).
  if (out.source == null) {
    const sources = Array.isArray(out.sources) ? out.sources : [];
    const best = sources.find((s: any) => s && typeof s === 'object' && typeof s.page === 'number') ?? null;
    if (best) {
      out.source = {
        page: (best as any).page,
        slide_title: typeof (best as any).slide_title === 'string' ? (best as any).slide_title : null,
      };
    }
  }
  return out;
};

function buildAllowlistedNarrationExcerpt(report: any, opts?: { promoted_facts?: any[] }): any {
  const structured = report?.structured_summary && typeof report.structured_summary === 'object' ? report.structured_summary : null;
  const kpisRaw = structured?.kpis && typeof structured.kpis === 'object' ? structured.kpis : null;

  const kpis = kpisRaw
    ? {
        ...kpisRaw,
        raise: normalizeKpiForNarrationExcerpt((kpisRaw as any).raise),
        revenue: normalizeKpiForNarrationExcerpt((kpisRaw as any).revenue),
        customers: normalizeKpiForNarrationExcerpt((kpisRaw as any).customers),
        growth: normalizeKpiForNarrationExcerpt((kpisRaw as any).growth),
        performance:
          (kpisRaw as any).performance && typeof (kpisRaw as any).performance === 'object'
            ? {
                ...(kpisRaw as any).performance,
                marketing_attributed_revenue_v1: normalizeKpiForNarrationExcerpt(
                  (kpisRaw as any).performance?.marketing_attributed_revenue_v1
                ),
              }
            : undefined,
      }
    : null;

  const citationsSummary = (() => {
    const pages: number[] = [];
    const pushPage = (v: unknown) => {
      const i = asFiniteInt(v);
      if (i == null) return;
      pages.push(i);
    };

    // KPI sources: prefer excerpted kpis.*.source, but fall back to sources[] if present.
    if (kpis && typeof kpis === 'object') {
      const visitKpi = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.source && typeof obj.source === 'object') {
          pushPage((obj.source as any).page ?? (obj.source as any).page_index);
        }
        const sources = Array.isArray(obj.sources) ? obj.sources : [];
        for (const s of sources) pushPage((s as any)?.page ?? (s as any)?.page_index);
      };
      for (const key of ['raise', 'revenue', 'customers', 'growth']) visitKpi((kpis as any)[key]);
      visitKpi((kpis as any)?.performance?.marketing_attributed_revenue_v1);
    }

    // Deal summary sources (page_index or page).
    const ds = report?.deal_summary;
    const visitLine = (line: any) => {
      const sources = Array.isArray(line?.sources) ? line.sources : [];
      for (const s of sources) pushPage((s as any)?.page ?? (s as any)?.page_index);
    };
    if (ds && typeof ds === 'object') {
      visitLine((ds as any).one_liner);
      visitLine((ds as any).product);
      visitLine((ds as any).market_target);
      visitLine((ds as any).market_context);
      visitLine((ds as any).market);
      const paragraphs = Array.isArray((ds as any).paragraphs) ? (ds as any).paragraphs : [];
      for (const p of paragraphs) visitLine(p);
    }

    const unique = new Set<number>(pages);
    return { total_sources: pages.length, unique_pages: unique.size };
  })();

  const scoreExplanation = report?.metadata?.score_explanation ?? null;
  const understanding = scoreExplanation?.understanding_v1 ?? null;

  // Expand allowlisted grounding surface with deterministic, provenance-linked evidence IDs.
  // This is excerpt-only (overlay use); it must not mutate canonical deterministic report outputs.
  const componentEvidenceIds = (() => {
    const out: Record<string, string[]> = {};
    const comps = scoreExplanation?.components;
    if (!comps || typeof comps !== 'object') return out;
    for (const [k, v] of Object.entries(comps)) {
      if (!v || typeof v !== 'object') continue;
      const ids = Array.isArray((v as any).evidence_ids) ? (v as any).evidence_ids : [];
      const cleaned = ids
        .map((x: any) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x: string) => x.length > 0);
      if (cleaned.length > 0) out[k] = cleaned.slice(0, 80);
    }
    return out;
  })();

  return {
    structured_summary: structured
      ? {
          kpis,
          marketing_metrics: structured?.marketing_metrics ?? null,
        }
      : null,
    deal_summary_v1: report?.deal_summary ?? null,
    // Optional: promoted facts (deterministic; provenance via evidence_id + source_path)
    promoted_facts: Array.isArray(opts?.promoted_facts) ? opts?.promoted_facts : null,
    score_explanation: {
      understanding_v1: understanding,
      component_evidence_ids: componentEvidenceIds,
    },
    citations: citationsSummary,
  };
}

async function maybeAttachNarrationV1(args: {
  request: FastifyRequest;
  report: any;
  nextMetadata: any;
  narrateEnabled: boolean;
  promotedFactsForExcerpt?: any[];
}): Promise<void> {
  if (!args.narrateEnabled) return;
  if (!args.report || typeof args.report !== 'object') return;

  const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : {};
  const model = process.env.OPENAI_MODEL_REPORT_NARRATE || 'gpt-4o-mini';

  const excerpt = buildAllowlistedNarrationExcerpt(args.report, { promoted_facts: args.promotedFactsForExcerpt });
  const prompt = buildNarrationPrompt({ excerpt });

  const devCacheEnabled = String(process.env.NODE_ENV ?? '').toLowerCase() === 'development';
  const inputsHash =
    (typeof (args.report as any)?.metadata?.deterministic_score_preview_v1?.inputs_hash === 'string'
      ? String((args.report as any).metadata.deterministic_score_preview_v1.inputs_hash)
      : null) ||
    (typeof (args.report as any)?.metadata?.deterministic_score_inputs_v1?.inputs_hash === 'string'
      ? String((args.report as any).metadata.deterministic_score_inputs_v1.inputs_hash)
      : null) ||
    stableHash(JSON.stringify(excerpt ?? null));

  const cacheKey = `${inputsHash}|${model}|${NARRATION_PROMPT_VERSION}`;
  if (devCacheEnabled) {
    const cached = narrationDevCache.get(cacheKey);
    if (cached) {
      (args.report as any).llm_narration_v1 = cached.narration;
      meta.llm_narration_v1_meta = {
        model: cached.meta.model,
        usage: cached.meta.usage ?? null,
        duration_ms: 0,
        cache_hit: true,
        prompt_version: NARRATION_PROMPT_VERSION,
      };
      args.report.metadata = meta;
      return;
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    meta.llm_narration_v1_error = { code: 'missing_openai_api_key' };
    args.report.metadata = meta;
    return;
  }

  const startedAt = Date.now();
  let completionFinishReason: string | null = null;
  let completionModelUsed: string | null = null;
  let completionOutputChars: number | null = null;
  try {
    const completion = await openaiChatCompletion({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 1800,
    });

    const raw = completion.content;
    completionFinishReason = typeof completion.finish_reason === 'string' && completion.finish_reason.trim() ? completion.finish_reason.trim() : null;
    completionModelUsed = typeof completion.model === 'string' && completion.model.trim() ? completion.model.trim() : null;
    completionOutputChars = typeof raw === 'string' ? raw.length : null;
    const parsed = (() => {
      try {
        return parseJsonOnly(raw);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e ?? 'unknown_error');
        if (message === 'model_output_not_json') {
          const trimmed = typeof raw === 'string' ? raw.trim() : '';
          const head = trimmed.slice(0, 400);
          const tail = trimmed.slice(Math.max(0, trimmed.length - 200));
          args.request.log.warn(
            {
              code: 'model_output_not_json',
              model: completionModelUsed ?? model,
              finish_reason: completionFinishReason,
              output_chars: completionOutputChars,
              raw_head: head,
              raw_tail: tail,
            },
            'LLM_NARRATION_RAW_OUTPUT'
          );
        }
        throw e;
      }
    })();
    const validatedStrict = LlmNarrationV1Schema.safeParse(parsed);

    // Recovery path: if strict schema fails due to missing fields (e.g., what_would_change_my_mind),
    // parse with a looser schema and let the guard degrade only the invalid section(s).
    // This keeps narration additive and avoids dropping the entire narration payload.
    const validated = (() => {
      if (validatedStrict.success) return { ok: true as const, narration: validatedStrict.data as LlmNarrationV1Type, recovered: false };

      const LooseLlmNarrationV1Schema = z
        .object({
          version: z.literal('llm_narration_v1'),
          summary: z.string(),
          sections: z.array(
            z
              .object({
                title: z.string(),
                body: z.string(),
                what_would_change_my_mind: z.string().optional().default(''),
                citations: z
                  .array(
                    z
                      .object({
                        page: z.number().optional(),
                        slide_title: z.string().optional(),
                        evidence_id: z.string().optional(),
                      })
                      .strict()
                  )
                  .optional(),
                evidence_basis: z.enum(['cited', 'no_evidence']),
              })
              .strict()
          ),
          insights: z
            .array(
              z
                .object({
                  title: z.string(),
                  claim: z.string(),
                  tier: z.enum(['restatement', 'implication', 'hypothesis']),
                  confidence: z.enum(['low', 'medium', 'high']),
                  basis: z
                    .array(
                      z
                        .object({
                          page: z.number().optional(),
                          slide_title: z.string().optional(),
                          evidence_id: z.string().optional(),
                        })
                        .strict()
                    )
                    .optional()
                    .default([]),
                  evidence_basis: z.enum(['cited', 'no_evidence']),
                  what_would_change_my_mind: z.string().optional().default(''),
                })
                .strict()
            )
            .optional()
            .default([]),
          suggestions: z
            .object({
              gaps: z.array(
                z
                  .object({
                    key: z.string(),
                    rationale: z.string(),
                  })
                  .strict()
              ),
              questions: z.array(z.string()),
            })
            .strict(),
          quality_flags: z.array(z.string()),
        })
        .strict();

      const looseRes = LooseLlmNarrationV1Schema.safeParse(parsed);
      if (!looseRes.success) {
        meta.llm_narration_v1_error = {
          code: 'schema_invalid',
          details: validatedStrict.error.flatten(),
        };
        args.report.metadata = meta;
        return { ok: false as const };
      }

      meta.llm_narration_v1_error = {
        code: 'schema_invalid',
        recovered: true,
        details: validatedStrict.error.flatten(),
      };

      return { ok: true as const, narration: looseRes.data as unknown as LlmNarrationV1Type, recovered: true };
    })();

    if (!validated.ok) return;

    const guard = validateNoNewFacts({ reportExcerpt: excerpt, narration: validated.narration });

    const narration = (() => {
      if (guard.ok) return validated.narration as LlmNarrationV1Type;
      const degraded = degradeNarrationV1({ narration: validated.narration as LlmNarrationV1Type, violations: guard.violations });

    const blockedSectionTitles = (() => {
      const titles = new Set<string>();
      const sections = Array.isArray((validated.narration as any)?.sections) ? ((validated.narration as any).sections as any[]) : [];
      for (const v of guard.violations ?? []) {
        const m = /^narration\.sections\[(\d+)\]/.exec(String((v as any)?.path ?? ""));
        if (!m) continue;
        const idx = Number(m[1]);
        if (!Number.isFinite(idx)) continue;
        const title = typeof sections[idx]?.title === 'string' && sections[idx].title.trim() ? String(sections[idx].title).trim() : `Section ${idx}`;
        titles.add(title);
      }
      return Array.from(titles).slice(0, 10);
    })();

    const blockedReasonsTop3 = (() => {
      const counts = new Map<string, number>();
      for (const v of guard.violations ?? []) {
        const code = typeof (v as any)?.code === 'string' ? String((v as any).code) : '';
        if (!code) continue;
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([code]) => code);
    })();

      if (!validated.recovered) {
        meta.llm_narration_v1_error = {
          code: 'guard_degraded',
          invalid_sections: degraded.invalid_sections,
          dropped_insights: (degraded as any).dropped_insights ?? 0,
          dropped_suggestions: degraded.dropped_suggestions,
          blocked_section_titles: blockedSectionTitles,
          blocked_reasons_top3: blockedReasonsTop3,
          violations: Array.isArray(guard.violations) ? guard.violations.slice(0, 10) : [],
        };
      } else {
        // Preserve the schema_invalid+recovered signal set above, but also attach guard info.
        meta.llm_narration_v1_error = {
          ...(meta.llm_narration_v1_error ?? { code: 'schema_invalid', recovered: true }),
          guard_degraded: true,
          invalid_sections: degraded.invalid_sections,
          dropped_insights: (degraded as any).dropped_insights ?? 0,
          dropped_suggestions: degraded.dropped_suggestions,
          blocked_section_titles: blockedSectionTitles,
          blocked_reasons_top3: blockedReasonsTop3,
          violations: Array.isArray(guard.violations) ? guard.violations.slice(0, 10) : [],
        };
      }
      return degraded.narration;
    })();

    (args.report as any).llm_narration_v1 = narration;
    meta.llm_narration_v1_meta = {
      model: completion.model,
      usage: completion.usage ?? null,
      duration_ms: Date.now() - startedAt,
      cache_hit: false,
      prompt_version: NARRATION_PROMPT_VERSION,
    };

    if (devCacheEnabled) {
      // Keep the cache bounded.
      narrationDevCache.set(cacheKey, {
        narration,
        meta: { model: completion.model, usage: completion.usage ?? null },
        created_at_ms: Date.now(),
      });
      if (narrationDevCache.size > 50) {
        const firstKey = narrationDevCache.keys().next().value;
        if (firstKey) narrationDevCache.delete(firstKey);
      }
    }

    args.report.metadata = meta;
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    const message = baseMessage === 'model_output_not_json' && completionFinishReason === 'length' ? 'model_output_truncated' : baseMessage;
    meta.llm_narration_v1_error = {
      code: 'provider_error',
      message,
    };
    args.report.metadata = meta;
  }
}

async function maybeAttachOverviewV1(args: {
  request: FastifyRequest;
  report: any;
  nextMetadata: any;
  narrateEnabled: boolean;
  promotedFactsForExcerpt?: any[];
}): Promise<void> {
  if (!args.narrateEnabled) return;
  if (!args.report || typeof args.report !== 'object') return;

  const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : {};
  const model = process.env.OPENAI_MODEL_REPORT_OVERVIEW || process.env.OPENAI_MODEL_REPORT_NARRATE || 'gpt-4o-mini';

  const ensureOverviewPresent = () => {
    const existing = (args.report as any).llm_overview_v1;
    if (existing && typeof existing === 'object') return;
    (args.report as any).llm_overview_v1 = {
      version: 'llm_overview_v1',
      hero_header: '',
      deal_summary: { hero: '', mid: '', long: '' },
      investment_analysis_overview: '',
      strengths_overlay: [],
      concerns_overlay: [],
      coverage_gaps_overlay: [],
      citations: [],
      quality_flags: ['guard_degraded'],
    };
  };

  let excerpt: any;
  let prompt: { system: string; user: string };
  try {
    excerpt = buildAllowlistedNarrationExcerpt(args.report, { promoted_facts: args.promotedFactsForExcerpt });
    const narrationStyleHint = (args.report as any).llm_narration_v1 ?? null;
    prompt = buildOverviewPrompt({ reportExcerpt: excerpt, narration: narrationStyleHint });
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    ensureOverviewPresent();
    meta.llm_overview_v1_error = { code: 'provider_error', message: baseMessage };
    args.report.metadata = meta;
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    ensureOverviewPresent();
    meta.llm_overview_v1_error = { code: 'missing_openai_api_key' };
    args.report.metadata = meta;
    return;
  }

  const startedAt = Date.now();
  let completionFinishReason: string | null = null;
  let completionModelUsed: string | null = null;
  let completionOutputChars: number | null = null;
  try {
    const completion = await openaiChatCompletion({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 1800,
    });

    const raw = completion.content;
    completionFinishReason = typeof completion.finish_reason === 'string' && completion.finish_reason.trim() ? completion.finish_reason.trim() : null;
    completionModelUsed = typeof completion.model === 'string' && completion.model.trim() ? completion.model.trim() : null;
    completionOutputChars = typeof raw === 'string' ? raw.length : null;

    const parsed = (() => {
      try {
        return parseJsonOnly(raw);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e ?? 'unknown_error');
        if (message === 'model_output_not_json') {
          const trimmed = typeof raw === 'string' ? raw.trim() : '';
          args.request.log.warn(
            {
              code: 'model_output_not_json',
              model: completionModelUsed ?? model,
              finish_reason: completionFinishReason,
              output_chars: completionOutputChars,
              raw_head: trimmed.slice(0, 400),
              raw_tail: trimmed.slice(Math.max(0, trimmed.length - 200)),
            },
            'LLM_OVERVIEW_RAW_OUTPUT'
          );
        }
        throw e;
      }
    })();

    const guarded = degradeOverviewV1({ reportExcerpt: excerpt, overview: parsed });
    (args.report as any).llm_overview_v1 = guarded.overview;

    meta.llm_overview_v1_meta = {
      model: completion.model,
      usage: completion.usage ?? null,
      duration_ms: Date.now() - startedAt,
      prompt_version: OVERVIEW_PROMPT_VERSION,
    };

    if (!guarded.ok || guarded.error?.degraded) {
      meta.llm_overview_v1_error = {
        code: 'guard_degraded',
        dropped_fields: guarded.error?.invalid_fields ?? 0,
        dropped_bullets: guarded.error?.dropped_bullets ?? 0,
        violations: Array.isArray(guarded.error?.violations) ? guarded.error?.violations.slice(0, 10) : [],
      };
    } else {
      meta.llm_overview_v1_error = null;
    }

    args.report.metadata = meta;
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    // Unlike narration, requested behavior is to record model_output_not_json on parse failure.
    if (baseMessage === 'model_output_not_json') {
      ensureOverviewPresent();
      meta.llm_overview_v1_error = { code: 'provider_error', message: 'model_output_not_json' };
    } else {
      ensureOverviewPresent();
      meta.llm_overview_v1_error = { code: 'provider_error', message: baseMessage };
    }
    args.report.metadata = meta;
  }
}

async function maybeAttachInvestmentAnalysisOverviewV1(args: {
  request: FastifyRequest;
  report: any;
  nextMetadata: any;
  narrateEnabled: boolean;
  promotedFactsForExcerpt?: any[];
}): Promise<void> {
  if (!args.narrateEnabled) return;
  if (!args.report || typeof args.report !== 'object') return;

  const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : {};
  const model = process.env.OPENAI_MODEL_REPORT_OVERVIEW || process.env.OPENAI_MODEL_REPORT_NARRATE || 'gpt-4o-mini';

  const ensureOverviewPresent = () => {
    const existing = (args.report as any).llm_overview_v1;
    if (existing && typeof existing === 'object') return;
    (args.report as any).llm_overview_v1 = {
      version: 'llm_overview_v1',
      hero_header: '',
      deal_summary: { hero: '', mid: '', long: '' },
      investment_analysis_overview: '',
      strengths_overlay: [],
      concerns_overlay: [],
      coverage_gaps_overlay: [],
      citations: [],
      quality_flags: ['guard_degraded'],
    };
  };

  const collectDeterministicOverviewCitations = (reportExcerpt: any, limit = 40): Array<{ page: number; slide_title?: string; evidence_id?: string }> => {
    const out: Array<{ page: number; slide_title?: string; evidence_id?: string }> = [];
    const seen = new Set<string>();

    const push = (page: unknown, slideTitle: unknown, evidenceId: unknown) => {
      const p = typeof page === 'number' && Number.isFinite(page) ? page : null;
      if (p == null) return;
      const t = typeof slideTitle === 'string' && slideTitle.trim() ? slideTitle.trim() : undefined;
      const e = typeof evidenceId === 'string' && evidenceId.trim() ? evidenceId.trim() : undefined;
      const key = `${p}|${(t ?? '').toLowerCase()}|${(e ?? '').toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ page: p, ...(t ? { slide_title: t } : {}), ...(e ? { evidence_id: e } : {}) });
    };

    const walk = (node: any, depth: number) => {
      if (out.length >= limit) return;
      if (depth > 10) return;
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const v of node) walk(v, depth + 1);
        return;
      }

      // Common shapes: {page, slide_title} and {page_index, slide_title}
      if (Object.prototype.hasOwnProperty.call(node, 'page') || Object.prototype.hasOwnProperty.call(node, 'page_index')) {
        push((node as any).page ?? (node as any).page_index, (node as any).slide_title, (node as any).evidence_id);
      }
      if ((node as any).source && typeof (node as any).source === 'object') {
        const s = (node as any).source;
        push(s.page ?? s.page_index, s.slide_title, s.evidence_id);
      }
      if (Array.isArray((node as any).sources)) {
        for (const s of (node as any).sources) {
          if (!s || typeof s !== 'object') continue;
          push((s as any).page ?? (s as any).page_index, (s as any).slide_title, (s as any).evidence_id);
        }
      }

      for (const v of Object.values(node)) walk(v as any, depth + 1);
    };

    walk(reportExcerpt, 0);
    return out;
  };

  const repairInvestmentAnalysisOverviewStructure = (text: string): string => {
    const raw = typeof text === 'string' ? text : '';
    const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!cleaned) return cleaned;

    const signalRe = /(^|\n)\s*[•*\-]?\s*Signal\s*:/gim;
    const starts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = signalRe.exec(cleaned)) !== null) {
      // Start at the actual 'S' of Signal:
      const idx = cleaned.indexOf('Signal', m.index);
      starts.push(idx >= 0 ? idx : m.index);
      if (m.index === signalRe.lastIndex) signalRe.lastIndex++;
    }
    const uniqStarts = Array.from(new Set(starts.filter((x) => x >= 0))).sort((a, b) => a - b);
    if (uniqStarts.length === 0) return cleaned;

    const points: string[] = [];
    for (let i = 0; i < uniqStarts.length && points.length < 4; i++) {
      const start = uniqStarts[i];
      const end = i + 1 < uniqStarts.length ? uniqStarts[i + 1] : cleaned.length;
      let chunk = cleaned.slice(start, end).trim();
      if (!chunk) continue;

      const hasImplication = /(^|\n)\s*[•*\-]?\s*Implication\s*:/im.test(chunk);
      const hasUncertainty = /(^|\n)\s*[•*\-]?\s*Uncertainty\s*:/im.test(chunk);
      const hasDecisionTension = /(^|\n)\s*[•*\-]?\s*Decision\s*Tension\s*:/im.test(chunk);
      if (!hasImplication || !hasUncertainty) continue;

      if (!hasDecisionTension) {
        chunk = `${chunk}\nDecision Tension: What evidence would most change conviction, and what specific diligence question should be answered next?`;
      }

      points.push(chunk.trim());
    }

    // Only rewrite when we can produce a valid 2–4 point structure.
    if (points.length >= 2 && points.length <= 4) return points.join('\n\n');
    return cleaned;
  };

  let excerpt: any;
  let prompt: { system: string; user: string };
  try {
    excerpt = buildAllowlistedNarrationExcerpt(args.report, { promoted_facts: args.promotedFactsForExcerpt });
    prompt = buildInvestmentAnalysisOverviewPrompt({ reportExcerpt: excerpt });
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    ensureOverviewPresent();
    meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'provider_error', message: baseMessage };
    args.report.metadata = meta;
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    // Mirror existing behavior: record missing key and do not attempt provider call.
    ensureOverviewPresent();
    meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'missing_openai_api_key' };
    args.report.metadata = meta;
    return;
  }

  const startedAt = Date.now();
  let completionFinishReason: string | null = null;
  let completionModelUsed: string | null = null;
  let completionOutputChars: number | null = null;
  try {
    const completion = await openaiChatCompletion({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 900,
    });

    const raw = completion.content;
    completionFinishReason = typeof completion.finish_reason === 'string' && completion.finish_reason.trim() ? completion.finish_reason.trim() : null;
    completionModelUsed = typeof completion.model === 'string' && completion.model.trim() ? completion.model.trim() : null;
    completionOutputChars = typeof raw === 'string' ? raw.length : null;

    const parsed = (() => {
      try {
        return parseJsonOnly(raw);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e ?? 'unknown_error');
        if (message === 'model_output_not_json') {
          const trimmed = typeof raw === 'string' ? raw.trim() : '';
          args.request.log.warn(
            {
              code: 'model_output_not_json',
              model: completionModelUsed ?? model,
              finish_reason: completionFinishReason,
              output_chars: completionOutputChars,
              raw_head: trimmed.slice(0, 400),
              raw_tail: trimmed.slice(Math.max(0, trimmed.length - 200)),
            },
            'LLM_INVESTMENT_ANALYSIS_OVERVIEW_RAW_OUTPUT'
          );
        }
        throw e;
      }
    })();

    const rawCandidate = parsed && typeof parsed === 'object' ? (parsed as any).investment_analysis_overview : null;
    if (typeof rawCandidate !== 'string') {
      // Schema failure: attach empty string and mark guard_degraded (per spec).
      const existing = (args.report as any).llm_overview_v1;
      if (!existing || typeof existing !== 'object') {
        (args.report as any).llm_overview_v1 = {
          version: 'llm_overview_v1',
          hero_header: '',
          deal_summary: { hero: '', mid: '', long: '' },
          investment_analysis_overview: '',
          strengths_overlay: [],
          concerns_overlay: [],
          coverage_gaps_overlay: [],
          citations: [],
          quality_flags: ['guard_degraded'],
        };
      } else {
        (existing as any).investment_analysis_overview = '';
        (existing as any).quality_flags = Array.isArray((existing as any).quality_flags)
          ? Array.from(new Set([...(existing as any).quality_flags, 'guard_degraded']))
          : ['guard_degraded'];
      }

      if (!meta.llm_overview_v1_error || meta.llm_overview_v1_error.code === 'guard_degraded') {
        meta.llm_overview_v1_error = {
          code: 'guard_degraded',
          dropped_fields: 1,
          dropped_bullets: 0,
          violations: [
            {
              code: 'schema_invalid',
              path: 'overview.investment_analysis_overview',
              message: 'investment_analysis_overview failed schema validation',
            },
          ],
        };
      }

      args.report.metadata = meta;
      return;
    }

    // Be tolerant of minor prompt non-compliance: clamp to schema max rather than dropping.
    const maxChars = 2400;
    const candidateText =
      rawCandidate.length <= maxChars
        ? rawCandidate
        : `${rawCandidate.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;

    const repairedText = repairInvestmentAnalysisOverviewStructure(candidateText);

    // Provide deterministic citations so numeric tokens (if any) can pass guard.
    const guardCitations = collectDeterministicOverviewCitations(excerpt, 40);
    const guarded = degradeOverviewV1({
      reportExcerpt: excerpt,
      overview: { version: 'llm_overview_v1', investment_analysis_overview: repairedText, citations: guardCitations },
    });

    const existing = (args.report as any).llm_overview_v1;
    if (!existing || typeof existing !== 'object') {
      (args.report as any).llm_overview_v1 = guarded.overview;
    } else {
      (existing as any).investment_analysis_overview = guarded.overview.investment_analysis_overview;
      if (!Array.isArray((existing as any).citations) || (existing as any).citations.length === 0) {
        (existing as any).citations = guardCitations;
      }
      if (Array.isArray(guarded.overview.quality_flags) && guarded.overview.quality_flags.includes('guard_degraded')) {
        (existing as any).quality_flags = Array.isArray((existing as any).quality_flags)
          ? Array.from(new Set([...(existing as any).quality_flags, 'guard_degraded']))
          : ['guard_degraded'];
      }
    }

    // Attach lightweight metadata without introducing new meta keys.
    meta.llm_overview_v1_meta = meta.llm_overview_v1_meta ?? {
      model: completion.model,
      usage: completion.usage ?? null,
      duration_ms: Date.now() - startedAt,
      prompt_version: INVESTMENT_ANALYSIS_OVERVIEW_PROMPT_VERSION,
    };

    if (!guarded.ok || guarded.error?.degraded) {
      if (!meta.llm_overview_v1_error || meta.llm_overview_v1_error.code === 'guard_degraded') {
        meta.llm_overview_v1_error = {
          code: 'guard_degraded',
          dropped_fields: guarded.error?.invalid_fields ?? 0,
          dropped_bullets: guarded.error?.dropped_bullets ?? 0,
          violations: Array.isArray(guarded.error?.violations) ? guarded.error?.violations.slice(0, 10) : [],
        };
      }
    }

    args.report.metadata = meta;
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    ensureOverviewPresent();
    meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'provider_error', message: baseMessage };
    args.report.metadata = meta;
  }
}

function ensureStructuredRevenueSelectionReason(report: any): void {
  try {
    if (!report || typeof report !== 'object') return;
    const structured = (report as any).structured_summary;
    if (!structured || typeof structured !== 'object') return;

    const hasNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

    const revenueExisting = (structured as any).revenue;
    if (!revenueExisting || typeof revenueExisting !== 'object') {
      (structured as any).revenue = {
        value: null,
        confidence: 0,
        sources: [],
        label: null,
        selection_reason: 'not_extracted_yet',
        candidates: [],
      };
      return;
    }

    const revenue = revenueExisting as any;
    const selection = revenue.selection_reason;
    if (hasNonEmptyString(selection)) return;

    // Prefer signals from candidates/sources to keep this deterministic and meaningful.
    const candidates: any[] = Array.isArray(revenue.candidates) ? revenue.candidates : [];
    const selectedCandidate = candidates.find((c) => c && typeof c === 'object' && c.selected === true) ?? null;
    const selectedScope = hasNonEmptyString(selectedCandidate?.scope) ? String(selectedCandidate.scope).trim().toLowerCase() : null;

    const sources: any[] = Array.isArray(revenue.sources) ? revenue.sources : [];
    const sourceKinds = new Set(
      sources
        .map((s) => (s && typeof s === 'object' ? String((s as any).kind ?? '').trim().toLowerCase() : ''))
        .filter(Boolean)
    );

    const hasRevenueValue = (() => {
      const v = revenue.value;
      if (v == null) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      if (typeof v === 'object') {
        const raw = (v as any).raw;
        if (hasNonEmptyString(raw)) return true;
        const amount = (v as any).amount;
        if (typeof amount === 'number' && Number.isFinite(amount)) return true;
      }
      return true;
    })();

    if (sourceKinds.has('input_metric') || selectedScope === 'input_metric') {
      revenue.selection_reason = 'input_metric_preferred';
      return;
    }
    if (sourceKinds.has('financial_health.metrics') || selectedScope === 'financial_health') {
      revenue.selection_reason = 'financial_health_fallback';
      return;
    }
    if (selectedScope === 'company_financials_table') {
      revenue.selection_reason = 'financial_table_preferred';
      return;
    }
    if (selectedScope === 'company_total') {
      revenue.selection_reason = 'company_total_preferred';
      return;
    }

    revenue.selection_reason = hasRevenueValue ? 'unknown_source_defaulted' : 'not_extracted_yet';
  } catch {
    // ignore
  }
}

function ensureStructuredSummaryKpis(report: any): void {
  try {
    if (!report || typeof report !== 'object') return;
    const structured = (report as any).structured_summary;
    if (!structured || typeof structured !== 'object') return;

    const existing = (structured as any).kpis;
    const kpis = existing && typeof existing === 'object' ? existing : {};

    // Compatibility mapping: older clients expect structured_summary.kpis.*
    if ((kpis as any).raise == null) (kpis as any).raise = (structured as any).raise ?? null;
    if ((kpis as any).revenue == null) (kpis as any).revenue = (structured as any).revenue ?? null;
    if ((kpis as any).customers == null) (kpis as any).customers = (structured as any).customers ?? null;
    if ((kpis as any).growth == null) (kpis as any).growth = (structured as any).growth ?? null;

    // Ensure revenue selection reason is present (shape-only, deterministic).
    try {
      const kpiRevenue = (kpis as any).revenue;
      const structuredRevenue = (structured as any).revenue;
      if (
        kpiRevenue &&
        typeof kpiRevenue === 'object' &&
        (kpiRevenue as any).selection_reason == null &&
        structuredRevenue &&
        typeof structuredRevenue === 'object' &&
        (structuredRevenue as any).selection_reason != null
      ) {
        (kpiRevenue as any).selection_reason = (structuredRevenue as any).selection_reason;
      }
    } catch {
      // ignore
    }

    if ((kpis as any).business_model == null) {
      (kpis as any).business_model = (structured as any).business_model ?? (structured as any).business_model_summary ?? null;
    }

    // Compatibility: surface marketing attributed revenue under kpis.performance when available.
    const marketingMetrics = (structured as any).marketing_metrics;
    const attributedRevenue =
      marketingMetrics && typeof marketingMetrics === 'object'
        ? ((marketingMetrics as any).attributed_revenue ?? (marketingMetrics as any).marketing_attributed_revenue_v1 ?? null)
        : null;

    if (attributedRevenue) {
      const perfExisting = (kpis as any).performance;
      const perf = perfExisting && typeof perfExisting === 'object' ? perfExisting : {};
      if ((perf as any).marketing_attributed_revenue_v1 == null) {
        (perf as any).marketing_attributed_revenue_v1 = attributedRevenue;
      }
      (kpis as any).performance = perf;
    }

    (structured as any).kpis = kpis;
  } catch {
    // ignore
  }
}

type ReportRecommendationV0 = 'strong_yes' | 'yes' | 'consider' | 'pass';
type ReportGradeV0 = 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' | 'Insufficient Information';

function mapDecisionV1ToReportRecommendation(decisionKey: unknown): ReportRecommendationV0 | null {
  if (typeof decisionKey !== 'string') return null;
  switch (decisionKey) {
    case 'hard_pass':
      return 'pass';
    case 'consider':
      return 'consider';
    case 'strong_consider':
      return 'consider';
    case 'fund_caution':
      return 'yes';
    case 'fund_track':
      return 'yes';
    case 'fund_confident':
      return 'strong_yes';
    default:
      return null;
  }
}

function mapDecisionV1ToReportGrade(decisionKey: unknown): ReportGradeV0 | null {
  if (typeof decisionKey !== 'string') return null;
  switch (decisionKey) {
    case 'hard_pass':
      return 'Needs Improvement';
    case 'consider':
      return 'Fair';
    case 'strong_consider':
      return 'Good';
    case 'fund_caution':
      return 'Good';
    case 'fund_track':
      return 'Excellent';
    case 'fund_confident':
      return 'Excellent';
    default:
      return null;
  }
}

function alignReportFieldsToDecisionV1(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : null;
    const report = args.report && typeof args.report === 'object' ? args.report : null;
    if (!meta || !report) return;

    if (meta.decision_v1_report_alignment_v1 === true) return;

    const decision = meta.decision_v1 && typeof meta.decision_v1 === 'object' ? meta.decision_v1 : null;
    const decisionKey = (decision as any)?.recommendation_key;

    const mappedRec = mapDecisionV1ToReportRecommendation(decisionKey);
    const mappedGrade = mapDecisionV1ToReportGrade(decisionKey);
    if (!mappedRec && !mappedGrade) return;

    const existingRecommendation = typeof report.recommendation === 'string' ? (report.recommendation as string) : null;
    const existingGrade = typeof report.grade === 'string' ? (report.grade as string) : null;

    if (meta.legacy_recommendation_v0 == null && existingRecommendation) meta.legacy_recommendation_v0 = existingRecommendation;
    if (meta.legacy_grade_v0 == null && existingGrade) meta.legacy_grade_v0 = existingGrade;

    if (mappedRec) report.recommendation = mappedRec;
    if (mappedGrade) report.grade = mappedGrade;

    meta.decision_v1_report_alignment_v1 = true;
  } catch {
    // ignore
  }
}

function attachScoreBandAndGuardrailV2(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : {};
    const scoreExp = args.report?.metadata?.score_explanation ?? null;
    const totals = scoreExp && scoreExp.totals ? scoreExp.totals : null;

    const overall = asFiniteNumber(totals?.overall_score) ?? asFiniteNumber(args.report?.overallScore);
    if (overall == null) return;

    const band = getScoreBandV2(overall);
    meta.score_band_v2 = {
      key: band.key,
      label: band.label,
      overall_score: overall,
      thresholds_version: 'v2',
    };

    const coverageRatio = asFiniteNumber(totals?.coverage_ratio);
    const unadjusted = asFiniteNumber(totals?.unadjusted_overall_score);

    const inputs = meta?.deterministic_score_inputs_v1 ?? null;
    const kpisRaw: any[] = Array.isArray(inputs?.kpis) ? inputs.kpis : [];
    const kpis = kpisRaw
      .map((k) => ({
        key: typeof k?.key === 'string' ? k.key : 'unknown',
        confidence: asFiniteNumber(k?.confidence) ?? 0,
        value_raw: (typeof k?.value_raw === 'string' ? k.value_raw : null),
      }))
      .filter((k) => typeof k.key === 'string');

    const driftAssessment = (() => {
      const drift = meta?.archetype_segment_drift_v1?.overall_assessment;
      const a = typeof drift === 'string' && drift.trim() ? drift.trim() : null;
      if (a) return a;
      const fromInputs = inputs?.deck?.drift_assessment;
      return (typeof fromInputs === 'string' && fromInputs.trim()) ? fromInputs.trim() : 'unknown';
    })();

    const guardrail = computeHardPassGuardrailV2({
      overall_score: overall,
      coverage_ratio: coverageRatio,
      unadjusted_overall_score: unadjusted,
      kpis,
      drift_assessment: driftAssessment,
    });

    meta.hard_pass_guardrail_v2 = {
      triggered: guardrail.triggered,
      reason: guardrail.reason,
      note: guardrail.note,
      criteria_snapshot: guardrail.criteria_snapshot,
    };

    // Derived decision_v1: stable UI contract.
    try {
      const preview = meta?.deterministic_score_preview_v1 ?? null;
      const blockedByDrift = Boolean(preview?.gate?.blocked_by_drift_misaligned);
      const blockedByPinned = Boolean(preview?.gate?.blocked_by_unadjusted_pinned);

      const overrideQuality = meta?.override_quality ?? null;
      const overrideAssessment = typeof overrideQuality?.assessment === 'string' ? String(overrideQuality.assessment) : null;
      const overrideRatio = asFiniteNumber(overrideQuality?.override_ratio);

      const unadjustedPinned = Boolean((totals as any)?.unadjusted_pinned === true);
      const unadjustedReason = (totals && typeof (totals as any).unadjusted_reason === 'string' && String((totals as any).unadjusted_reason).trim())
        ? String((totals as any).unadjusted_reason).trim()
        : null;

      meta.decision_v1 = computeDecisionV1({
        score_band_key: band.key,
        score_band_label: band.label,
        hard_pass_guardrail_triggered: guardrail.triggered,
        hard_pass_guardrail_reason: guardrail.reason,
        hard_pass_guardrail_note: guardrail.note,
        drift_assessment: driftAssessment,
        override_quality_assessment: overrideAssessment,
        override_ratio: overrideRatio,
        unadjusted_pinned: unadjustedPinned,
        unadjusted_reason: unadjustedReason,
        coverage_ratio: coverageRatio,
        blocked_by_drift_misaligned: blockedByDrift,
        blocked_by_unadjusted_pinned: blockedByPinned,
      });
    } catch {
      // ignore
    }

    // Prompt 15: decision_v1 is the single source of truth for recommendation/grade.
    // Preserve legacy values in metadata and ensure idempotency.
    alignReportFieldsToDecisionV1({ nextMetadata: meta, report: args.report });

    args.nextMetadata = meta;
  } catch {
    // Best-effort: never fail /report for metadata enrichment.
  }
}

interface ReportParams {
  deal_id: string;
}

export async function registerReportRoutes(
  app: FastifyInstance,
  pool: Pool
) {
  
  /**
   * GET /api/v1/deals/:deal_id/report
   * Get compiled report from latest DIO
   * 
   * Returns ReportDTO with structured sections, scores, and evidence
   */
  app.get<{ Params: ReportParams }>(
    "/api/v1/deals/:deal_id/report",
    async (request: FastifyRequest<{ Params: ReportParams }>, reply: FastifyReply) => {
      const startTs = Date.now();
      try {
        const { deal_id } = request.params;
        request.log.info({ msg: "deal.report.start", deal_id, start_ts: new Date(startTs).toISOString() });

        if (!isUuid(deal_id)) {
          return reply.status(400).send({ error: 'invalid_deal_id', message: 'deal_id must be a UUID' });
        }

        // 404 only when the deal itself does not exist.
        const { rows: dealRows } = await pool.query<{ id: string }>(
          `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
          [deal_id]
        );
        if (dealRows.length === 0) {
          return reply.status(404).send({ error: 'Deal not found' });
        }

        // Canonical persisted analysis artifact: the latest Deal Intelligence Object (DIO).
        // Do NOT infer readiness from job messages.
        const { rows: dioRows } = await pool.query<{
          dio_id: string;
          analysis_version: number | null;
          recommendation: string | null;
          overall_score: number | null;
          dio_data: any;
          updated_at: string | null;
        }>(
          `SELECT dio_id, analysis_version, recommendation, overall_score, dio_data, updated_at
             FROM deal_intelligence_objects
            WHERE deal_id = $1
            ORDER BY analysis_version DESC,
                     updated_at DESC NULLS LAST,
                     dio_id DESC
            LIMIT 1`,
          [deal_id]
        );

        if (dioRows.length === 0) {
          return reply.status(200).send({ ready: false, reason: 'not_generated_yet' });
        }

        const row = dioRows[0];
        const version = typeof row.analysis_version === 'number' && Number.isFinite(row.analysis_version)
          ? row.analysis_version
          : undefined;

        const artifact = {
          kind: 'deal_intelligence_object',
          dio_id: row.dio_id,
          analysis_version: row.analysis_version,
          updated_at: row.updated_at,
          recommendation: row.recommendation,
          overall_score: row.overall_score,
        };

        // Deterministic deal summary (no LLM): derived from segmented DPU nodes.
        // Best-effort: never fail the whole /report response if this compilation fails.
        let dealSummaryV1: any = null;
        let segmentedNodes: { nodes: any[]; warnings: string[] } | null = null;
        try {
          segmentedNodes = await getSegmentedNodesForDeal(pool as any, deal_id);
        } catch (err) {
          request.log.warn({ event: 'deal.report.segmented_nodes_failed', deal_id, dio_id: row.dio_id, err }, 'segmented nodes lookup failed');
          segmentedNodes = null;
        }
        try {
          dealSummaryV1 = await compileDealSummaryV1(pool as any, deal_id, { prefetched: segmentedNodes ?? undefined } as any);
        } catch (err) {
          request.log.warn({ event: 'deal.report.deal_summary_v1_failed', deal_id, dio_id: row.dio_id, err }, 'deal_summary_v1 compilation failed');
          dealSummaryV1 = {
            version: 'deal_summary_v1',
            ready: false,
            reason: 'compile_failed',
            one_liner: null,
            product: null,
            market: null,
            paragraphs: [],
            warnings: [],
          };
        }

        // Backward compatibility: include the compiled report payload so existing clients
        // can continue to render without needing to understand the readiness envelope.
        let report: any = null;
        let promotedFacts: any[] = [];
        try {
          promotedFacts = await loadPromotedFactsForDeal(pool as any, deal_id);

      // Deterministic fallback: if evidence_items did not get populated yet, derive
      // promoted-like facts directly from document_page_understanding payloads.
      // This keeps /report structured_summary accurate with page-level citations.
      const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
      const hasRaise = promotedFacts.some((r: any) => factTypeOf(r) === 'raise_terms_v1');
      const hasModel = promotedFacts.some((r: any) => factTypeOf(r) === 'business_model_v1');
      const hasKpi = promotedFacts.some((r: any) => {
        const ft = factTypeOf(r);
        return ft === 'revenue_v1' || ft === 'customers_v1' || ft === 'growth_v1' || ft === 'growth_outlook_v1';
      });

      // If any of the key structured_summary items are missing, derive them deterministically
      // from document_page_understanding and attach as promotedFacts inputs.
      if (!hasRaise || !hasModel || !hasKpi) {
        const derived = await derivePromotedFactsFromDpuForDeal(pool as any, deal_id);
        const existingEvidenceIds = new Set(promotedFacts.map((r: any) => String(r?.evidence_id ?? '')).filter(Boolean));
        for (const r of derived) {
          const evidenceId = String((r as any)?.evidence_id ?? '');
          if (evidenceId && existingEvidenceIds.has(evidenceId)) continue;

          const ft = factTypeOf(r);
          if (ft === 'raise_terms_v1' && hasRaise) continue;
          if (ft === 'business_model_v1' && hasModel) continue;
          promotedFacts.push(r as any);
          if (evidenceId) existingEvidenceIds.add(evidenceId);
        }
      }

          report = promotedFacts.length > 0
            ? compileDIOToReportWithPromotedFacts(row.dio_data, { promotedFacts })
            : compileDIOToReport(row.dio_data);

          // Deterministic structured_summary additions (no LLM): market/product/gtm/deal summaries.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && segmentedNodes?.nodes) {
              const extras = compileStructuredSummaryExtras({ nodes: segmentedNodes.nodes as any, structured_summary: (report as any).structured_summary });
              Object.assign((report as any).structured_summary, extras);
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.structured_summary_extras_failed', deal_id, dio_id: row.dio_id, err }, 'structured_summary extras compilation failed');
          }

          // Deterministic synthesized business model summary (non-promoted, node-derived).
          // Hard rule: multi-node synthesis; must not replace structured_summary.business_model.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && Array.isArray(segmentedNodes?.nodes) && segmentedNodes!.nodes.length > 0) {
              const businessModelSummary = buildBusinessModelSummaryV1(segmentedNodes!.nodes as any);
              if (businessModelSummary) {
                (report as any).structured_summary.business_model_summary = { ...businessModelSummary };
              }
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.business_model_summary_failed', deal_id, dio_id: row.dio_id, err }, 'business_model_summary_v1 synthesis failed');
          }
        } catch (compileErr) {
          request.log.error({ event: 'deal.report.compile_failed', deal_id, dio_id: row.dio_id, err: compileErr }, 'deal.report.compile_failed');
          // Still return readiness + persisted artifact; the report is an optional view.
          report = null;
        }
        
        const payload: any = { ready: true, version: version ?? report?.version ?? 1, artifact };
        payload.deal_summary = dealSummaryV1;

        // Deterministic deck archetype inference (diagnostics only; no enforcement).
        try {
          if (Array.isArray(segmentedNodes?.nodes) && segmentedNodes!.nodes.length > 0) {
            const inferred = inferDeckArchetypeV1(segmentedNodes!.nodes as any, {
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            nextMetadata.deck_archetype = inferred.deck_archetype;
            nextMetadata.archetype_diagnostics = inferred.diagnostics;
            nextMetadata.archetype_segment_drift_v1 = computeArchetypeSegmentDriftV1({
              deck_archetype: inferred.deck_archetype,
              diagnostics: inferred.diagnostics,
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            nextMetadata.override_quality = computeOverrideQualityV1(segmentedNodes!.nodes as any);

            // Prompt 14: Deterministic Segmentation → Scoring Bridge (v1)
            // Diagnostics-first: always attach inputs + preview; apply to score only when env-flag enabled and drift not misaligned.
            try {
              const inputs = buildDeterministicScoreInputsV1({
                structured_summary: (report as any)?.structured_summary ?? null,
                segmented_nodes: segmentedNodes!.nodes as any,
                metadata: nextMetadata,
        input_documents: Array.isArray((row as any)?.dio_data?.inputs?.documents)
          ? (((row as any).dio_data.inputs.documents as any[]) ?? [])
          : [],
              });

              const enabled = envFlagEnabled(process.env.DETERMINISTIC_SCORE_V1_ENABLED);
              const driftAssessment = String((nextMetadata as any)?.archetype_segment_drift_v1?.overall_assessment ?? 'unknown');
              const driftMisaligned = driftAssessment === 'misaligned';

              const scoreExp = (report as any)?.metadata?.score_explanation ?? null;
              const totals = scoreExp && scoreExp.totals ? scoreExp.totals : null;

              const baseEvidence = (totals && typeof totals.evidence_factor === 'number') ? totals.evidence_factor : null;
              const baseDD = (totals && typeof totals.due_diligence_factor === 'number') ? totals.due_diligence_factor : null;
              const baseAdj = (totals && typeof totals.adjustment_factor === 'number') ? totals.adjustment_factor : null;
              const coverageRatio = (totals && typeof (totals as any).coverage_ratio === 'number') ? (totals as any).coverage_ratio : null;
              const scoreConfidence = (totals && typeof (totals as any).confidence_score === 'number') ? (totals as any).confidence_score : null;
              const baseUnadjustedReason = (totals && typeof (totals as any).unadjusted_reason === 'string' && String((totals as any).unadjusted_reason).trim())
                ? String((totals as any).unadjusted_reason).trim()
                : null;
              const baseUnadjustedMissing = (totals && Array.isArray((totals as any).unadjusted_missing_inputs))
                ? ((totals as any).unadjusted_missing_inputs as any[]).map((x) => String(x)).filter((s) => s.trim())
                : [];
              const baseUnadjusted = (totals && typeof totals.unadjusted_overall_score === 'number') ? totals.unadjusted_overall_score : null;
              const baseOverall = (totals && typeof totals.overall_score === 'number') ? totals.overall_score : (typeof (report as any)?.overallScore === 'number' ? (report as any).overallScore : null);

              const mod = computeDeterministicModifierV1(inputs);

              const kpis: any[] = Array.isArray(inputs?.kpis) ? inputs.kpis : [];
              const kpiCount = kpis.filter((k) => typeof k?.key === 'string' && k.key.trim()).length;

              const pin = shouldPinUnadjusted({
                coverageRatio,
                kpiCount,
                driftAssessment,
                scoreConfidence,
              });
              const baseUnadjustedPinned = Boolean(pin.pinned || ((totals as any)?.unadjusted_pinned === true));
              const baseUnadjustedPinReason = (pin.reason ?? null);

              // When baseline unadjusted is pinned (low-signal), we keep the deterministic preview frozen to baseline.
              // This prevents the preview from suggesting a score move that cannot be applied.
              let detEvidence = baseEvidence == null ? null : clamp01(baseEvidence * mod.modifier);
              let detAdj = (detEvidence == null || baseDD == null) ? null : clamp01(detEvidence * baseDD);
              let detOverall = (baseUnadjusted == null || detAdj == null)
                ? null
                : Math.round(baseUnadjusted * detAdj + 50 * (1 - detAdj));

              if (baseUnadjustedPinned) {
                detEvidence = baseEvidence;
                detAdj = baseAdj;
                detOverall = baseOverall;
              }

              const deltaOverallScore = (baseOverall != null && detOverall != null) ? (detOverall - baseOverall) : null;

              const canApply = Boolean(enabled && !driftMisaligned && !baseUnadjustedPinned && detOverall != null && scoreExp && totals);
              const appliedParts = canApply
                ? ['score_explanation.totals.evidence_factor', 'score_explanation.totals.adjustment_factor', 'score_explanation.totals.overall_score', 'report.overallScore']
                : [];

              const deltaDiagnostics = computeDeterministicScorePreviewV1Diagnostics({
                applied: canApply,
                delta_overall_score: deltaOverallScore,
                base_unadjusted_overall_score: baseUnadjusted,
                base_adjustment_factor: baseAdj,
                det_adjustment_factor: detAdj,
                base_evidence_factor: baseEvidence,
                det_evidence_factor: detEvidence,
              });

              (nextMetadata as any).deterministic_score_inputs_v1 = inputs;
              (nextMetadata as any).deterministic_score_preview_v1 = {
                version: 'deterministic_score_preview_v1',
                enabled,
                gate: {
                  drift_assessment: driftAssessment,
                  blocked_by_drift_misaligned: driftMisaligned,
                  blocked_by_unadjusted_pinned: baseUnadjustedPinned,
                },
                notes: baseUnadjustedPinned ? ['pinned_unadjusted'] : [],
                inputs_hash: inputs.inputs_hash,
                modifier_v1: {
                  signal_strength: mod.signal_strength,
                  modifier: mod.modifier,
                  notes: mod.notes,
                },
                baseline: {
                  overall_score: baseOverall,
                  unadjusted_overall_score: baseUnadjusted,
                  unadjusted_pinned: baseUnadjustedPinned,
                  unadjusted_pin_reason: baseUnadjustedPinReason,
                  unadjusted_reason: baseUnadjustedReason,
                  unadjusted_missing_inputs: baseUnadjustedMissing,
                  evidence_factor: baseEvidence,
                  due_diligence_factor: baseDD,
                  adjustment_factor: baseAdj,
                },
                deterministic: {
                  overall_score: detOverall,
                  evidence_factor: detEvidence,
                  adjustment_factor: detAdj,
                },
                delta_overall_score: deltaOverallScore,
                delta_unrounded_overall: deltaDiagnostics.delta_unrounded_overall,
                delta_adjustment_factor: deltaDiagnostics.delta_adjustment_factor,
                delta_evidence_factor: deltaDiagnostics.delta_evidence_factor,
                rounding_note: deltaDiagnostics.rounding_note,
                applied: canApply,
                applied_parts: appliedParts,
              };

              if (canApply) {
                // Mutate the compiled report view only (reversible; does not persist into DB).
                try {
                  scoreExp.totals.evidence_factor = detEvidence;
                  scoreExp.totals.adjustment_factor = detAdj;
                  scoreExp.totals.overall_score = detOverall;
                  (report as any).overallScore = detOverall;

                  // Ensure explainability reflects the deterministic bridge.
                  if (scoreExp?.components?.metric_benchmark?.notes && Array.isArray(scoreExp.components.metric_benchmark.notes)) {
                    scoreExp.components.metric_benchmark.notes.push(`deterministic_score_v1 applied (inputs_hash=${inputs.inputs_hash.slice(0, 12)}…, modifier=${mod.modifier.toFixed(3)})`);
                  }
                } catch {
                  // If score explanation shape changes, do not fail /report.
                }
              }
            } catch (err) {
              request.log.warn({ event: 'deal.report.deterministic_score_inputs_failed', deal_id, dio_id: row.dio_id, err }, 'deterministic score inputs v1 failed');
            }

            // Score bands v2 + hard-pass guardrail v2 (metadata only; does not alter score).
            attachScoreBandAndGuardrailV2({ nextMetadata, report });

            (payload as any).metadata = nextMetadata;
            if (report && typeof report === 'object') (report as any).metadata = nextMetadata;
          }
        } catch (err) {
          request.log.warn({ event: 'deal.report.deck_archetype_failed', deal_id, dio_id: row.dio_id, err }, 'deck_archetype_v1 inference failed');
        }

        // Always attach score band v2 + guardrail v2 when a score exists (best-effort).
        try {
          if (report && typeof report === 'object') {
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            attachScoreBandAndGuardrailV2({ nextMetadata, report });
            (payload as any).metadata = nextMetadata;
            (report as any).metadata = nextMetadata;
          }
        } catch {
          // ignore
        }

        const promotedFactsForExcerpt = Array.isArray(promotedFacts) && promotedFacts.length > 0
          ? promotedFacts.map((r: any) => ({
              fact_type: r?.content_json?.fact_type ?? r?.fact_type ?? null,
              value_json: r?.content_json?.value_json ?? null,
              confidence: r?.confidence ?? null,
              source_path: r?.source_path ?? null,
              evidence_id: r?.evidence_id ?? null,
              extracted_at: r?.extracted_at ?? null,
            }))
          : null;

        if (Array.isArray(promotedFactsForExcerpt) && promotedFactsForExcerpt.length > 0) {
          payload.promoted_facts = promotedFactsForExcerpt;
        }
        const narrateEnabled = envFlagEnabled((request.query as any)?.narrate);

        if (report && typeof report === 'object') {
          ensureStructuredRevenueSelectionReason(report);
          ensureStructuredSummaryKpis(report);
          // Keep deal_summary nested under the compiled report as well.
          (report as any).deal_summary = dealSummaryV1;

          // Optional LLM narration: additive only; never alters deterministic fields.
          try {
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            await maybeAttachNarrationV1({ request, report, nextMetadata, narrateEnabled, promotedFactsForExcerpt: promotedFactsForExcerpt ?? undefined });
            (payload as any).metadata = (report as any).metadata;

			// Optional LLM overview: additive only; never alters deterministic fields.
			try {
        await maybeAttachOverviewV1({ request, report, nextMetadata, narrateEnabled, promotedFactsForExcerpt: promotedFactsForExcerpt ?? undefined });
				(payload as any).metadata = (report as any).metadata;
			} catch {
				// ignore
			}

      // Optional Investment Analysis Overview reasoning: additive only; never alters deterministic fields.
      try {
        await maybeAttachInvestmentAnalysisOverviewV1({ request, report, nextMetadata, narrateEnabled, promotedFactsForExcerpt: promotedFactsForExcerpt ?? undefined });
        (payload as any).metadata = (report as any).metadata;
      } catch {
        // ignore
      }
          } catch {
            // ignore
          }

          payload.report = report;
          // Spread the report into the response for compatibility with older consumers.
          // (Older clients expected the ReportDTO shape directly.)
          Object.assign(payload, report);
        }
        
        const endTs = Date.now();
        request.log.info({
          msg: "deal.report.done",
          deal_id,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        });

        return reply.status(200).send(payload);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * GET /api/v1/deals/:deal_id/report/:version
   * Get compiled report from specific DIO version
   */
  app.get<{ Params: ReportParams & { version: string } }>(
    "/api/v1/deals/:deal_id/report/:version",
    async (request: FastifyRequest<{ Params: ReportParams & { version: string } }>, reply: FastifyReply) => {
      const startTs = Date.now();
      try {
        const { deal_id, version } = request.params;
        request.log.info({ msg: "deal.report.version.start", deal_id, version, start_ts: new Date(startTs).toISOString() });
        if (!isUuid(deal_id)) {
          return reply.status(400).send({ error: 'invalid_deal_id', message: 'deal_id must be a UUID' });
        }
        const versionNum = parseInt(version);
        
        if (isNaN(versionNum) || versionNum < 1) {
          return reply.status(400).send({
            error: 'Invalid version number'
          });
        }

        // 404 only when the deal itself does not exist.
        const { rows: dealRows } = await pool.query<{ id: string }>(
          `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
          [deal_id]
        );
        if (dealRows.length === 0) {
          return reply.status(404).send({ error: 'Deal not found' });
        }
        
        // Get specific DIO version (persisted canonical artifact).
        const { rows: dioRows } = await pool.query<{ dio_data: any }>(
          `SELECT dio_data
             FROM deal_intelligence_objects
            WHERE deal_id = $1 AND analysis_version = $2
            ORDER BY updated_at DESC NULLS LAST,
                     dio_id DESC
            LIMIT 1`,
          [deal_id, versionNum]
        );

        if (dioRows.length === 0) {
          return reply.status(404).send({
            error: `No DIO found for deal ${deal_id} version ${version}`
          });
        }

        // Compile DIO into ReportDTO
        let promotedFacts: any[] = [];
        try {
          promotedFacts = await loadPromotedFactsForDeal(pool as any, deal_id);
        } catch {
          promotedFacts = [];
        }
        const report = promotedFacts.length > 0
          ? compileDIOToReportWithPromotedFacts(dioRows[0].dio_data, { promotedFacts })
          : compileDIOToReport(dioRows[0].dio_data);

        // Backward compatibility: normalize structured KPI shape (order matters).
        ensureStructuredRevenueSelectionReason(report);
        ensureStructuredSummaryKpis(report);

        const narrateEnabled = envFlagEnabled((request.query as any)?.narrate);

        // Best-effort: attach deterministic deck archetype metadata for versioned reports too.
        try {
          const segmented = await getSegmentedNodesForDeal(pool as any, deal_id);
          if (Array.isArray(segmented?.nodes) && segmented.nodes.length > 0) {
            const inferred = inferDeckArchetypeV1(segmented.nodes as any, {
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            const nextMetadata = { ...((report as any)?.metadata ?? {}) };
            nextMetadata.deck_archetype = inferred.deck_archetype;
            nextMetadata.archetype_diagnostics = inferred.diagnostics;
            nextMetadata.archetype_segment_drift_v1 = computeArchetypeSegmentDriftV1({
              deck_archetype: inferred.deck_archetype,
              diagnostics: inferred.diagnostics,
              structured_summary: (report as any)?.structured_summary ?? null,
            });
            nextMetadata.override_quality = computeOverrideQualityV1(segmented.nodes as any);

            // Best-effort: also attach deterministic score inputs v1 (for KPIs/drift) so guardrail can be evaluated.
            try {
              const inputs = buildDeterministicScoreInputsV1({
                structured_summary: (report as any)?.structured_summary ?? null,
                segmented_nodes: segmented.nodes as any,
                metadata: nextMetadata,
				input_documents: Array.isArray((dioRows[0] as any)?.dio_data?.inputs?.documents)
					? (((dioRows[0] as any).dio_data.inputs.documents as any[]) ?? [])
					: [],
              });
              (nextMetadata as any).deterministic_score_inputs_v1 = inputs;
            } catch {
              // ignore
            }

            attachScoreBandAndGuardrailV2({ nextMetadata, report });
            (report as any).metadata = nextMetadata;
          }
        } catch (err) {
          request.log.warn({ event: 'deal.report.version.deck_archetype_failed', deal_id, version: versionNum, err }, 'deck_archetype_v1 inference failed (versioned)');
        }

        // Always attach score band v2 + guardrail v2 when a score exists (best-effort).
        try {
          if (report && typeof report === 'object') {
            const nextMetadata = { ...((report as any)?.metadata ?? {}) };
            attachScoreBandAndGuardrailV2({ nextMetadata, report });
            (report as any).metadata = nextMetadata;
          }
        } catch {
          // ignore
        }

        // Optional LLM narration: additive only; never alters deterministic fields.
        try {
          const nextMetadata = { ...((report as any)?.metadata ?? {}) };
          await maybeAttachNarrationV1({ request, report, nextMetadata, narrateEnabled });

		  // Optional LLM overview: additive only; never alters deterministic fields.
		  try {
			  await maybeAttachOverviewV1({ request, report, nextMetadata, narrateEnabled });
		  } catch {
			  // ignore
		  }

      // Optional Investment Analysis Overview reasoning: additive only; never alters deterministic fields.
      try {
        await maybeAttachInvestmentAnalysisOverviewV1({ request, report, nextMetadata, narrateEnabled });
      } catch {
        // ignore
      }
        } catch {
          // ignore
        }
        
        const endTs = Date.now();
        request.log.info({
          msg: "deal.report.version.done",
          deal_id,
          version: versionNum,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        });

        return reply.status(200).send(report);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate versioned report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
}
