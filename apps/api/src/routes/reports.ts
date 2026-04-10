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
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildDeterministicDealSummaryV1FromStructuredSummary, compileDIOToReport, compileDIOToReportWithPromotedFacts } from '@dealdecision/core';
import { buildDeterministicScoreInputsV1 } from '@dealdecision/core';
import { computeDecisionV1, computeHardPassGuardrailV2, getScoreBandV2 } from '@dealdecision/core';
import { LlmNarrationV1Schema, degradeNarrationV1, validateNoNewFacts } from '@dealdecision/core';
import { buildNarrationPrompt } from '@dealdecision/core';
import type { LlmNarrationV1Type } from '@dealdecision/core';
import { buildOverviewPrompt, degradeOverviewV1 } from '@dealdecision/core';
import { buildInvestmentAnalysisOverviewPrompt, LlmOverviewV1CitationSchema, LlmOverviewV1Schema } from '@dealdecision/core';
import { loadPromotedFactsForDeal } from '../lib/promoted-facts';
import { derivePromotedFactsFromDpuForDeal } from '../lib/promoted-facts-from-dpu';
import { getFinancialFactsForReport, getFinancialFactsMaxTimestamp, getDocumentsForReport } from './financial-facts';
import { detectFinancialSnapshotStaleness } from '@dealdecision/core';
import { compileDealSummaryV1 } from '../lib/deal-summary-v1';
import { getSegmentedNodesForDeal } from '../lib/segmented-nodes-for-deal';
import { inferDeckArchetypeV1 } from '../lib/deck-archetypes';
import { compileStructuredSummaryExtras } from '../lib/structured-summary-extras';
import { buildBusinessModelSummaryV1 } from '../lib/reports/business-model-summary';
import { buildInvestmentAnalysisOverviewV2 } from '@dealdecision/core';
import { computeArchetypeSegmentDriftV1 } from '../lib/archetype-segment-drift-v1';
import { computeOverrideQualityV1 } from '../lib/override-quality-v1';
import { computeDeterministicModifierV1, computeDeterministicScorePreviewV1Diagnostics, shouldPinUnadjusted } from '../lib/deterministic-score-preview-v1';
import { StageTimer, nowMs } from '../lib/telemetry/stage-timer';
import { enqueueJob } from '../services/jobs';
import { recordLLMMetrics } from '../lib/llm';

const isUuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;

const isMissingRelation = (err: unknown, relationName: string): boolean => {
  const e = err as any;
  const code = typeof e?.code === 'string' ? e.code : null;
  if (code !== '42P01') return false;
  void relationName; // intentionally ignored; catch blocks are relation-specific
  return true;
};

const envFlagEnabled = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

const readReportDeterministicFlags = () => {
  return {
    deterministic_score_v1_enabled: envFlagEnabled(process.env.DETERMINISTIC_SCORE_V1_ENABLED),
    fundability_shadow_mode: envFlagEnabled(process.env.FUNDABILITY_SHADOW_MODE),
    fundability_soft_caps: envFlagEnabled(process.env.FUNDABILITY_SOFT_CAPS),
    fundability_hard_gates: envFlagEnabled(process.env.FUNDABILITY_HARD_GATES),
    phaseb_visual_evidence: envFlagEnabled(process.env.DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE),
  };
};

const readReportAuthMode = (request: FastifyRequest): string => {
  const auth = (request as any)?.auth;
  if (!auth || typeof auth !== 'object') return 'none';
  if (auth?.claims?.bypass_auth) return 'bypass_claim';
  if (envFlagEnabled(process.env.DISABLE_CLERK_AUTH)) return 'bypass_env';
  if (typeof auth?.userId === 'string' && auth.userId.trim()) return 'clerk_jwt';
  return 'unknown';
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

// Increment when the report compiler logic changes so that all cached entries compiled
// by an older version are automatically treated as stale and recompiled.
const REPORT_COMPILER_VERSION = 20; // bumped: field-authority-guard + field-candidate-selector + final-publish-guard integrated

async function readIngestionReportSummaryByDealAndVersion(pool: Pool, dealId: string, analysisVersion: number): Promise<any | null> {
  try {
    const r = await pool.query<{ summary: any }>(
      `SELECT summary
         FROM ingestion_reports
        WHERE deal_id = $1 AND analysis_version = $2
        LIMIT 1`,
      [dealId, analysisVersion]
    );
    const summary = r.rows?.[0]?.summary ?? null;
    if (!summary || typeof summary !== 'object') return null;
    // Bust cache if compiled by an older compiler version.
    if ((summary as any).__compiler_version !== REPORT_COMPILER_VERSION) return null;
    return summary;
  } catch (err) {
    void err;
    return null;
  }
}

async function upsertIngestionReportSummaryByDealAndVersion(params: {
  pool: Pool;
  dealId: string;
  analysisVersion: number;
  summary: any;
  documentIds: string[];
}): Promise<{ report_id: string } | null> {
  const { pool, dealId, analysisVersion, summary, documentIds } = params;
  try {
    // Always stamp the compiler version so future reads can detect stale entries.
    const versionedSummary =
      summary && typeof summary === 'object'
        ? { ...summary, __compiler_version: REPORT_COMPILER_VERSION }
        : { __compiler_version: REPORT_COMPILER_VERSION };
    const r = await pool.query<{ report_id: string }>(
      `INSERT INTO ingestion_reports (report_id, deal_id, analysis_version, summary, document_ids)
       VALUES ($1, $2, $3, $4::jsonb, $5::text[])
       ON CONFLICT (deal_id, analysis_version)
       DO UPDATE SET
         updated_at = now(),
         summary = EXCLUDED.summary,
         document_ids = EXCLUDED.document_ids
       RETURNING report_id`,
      [randomUUID(), dealId, analysisVersion, versionedSummary, documentIds ?? []]
    );
    const row = r.rows?.[0];
    if (!row || typeof row.report_id !== 'string' || !row.report_id.trim()) return null;
    return { report_id: row.report_id };
  } catch (err) {
    void err;
    return null;
  }
}

/**
 * Computes whether the compiled financial snapshot (financial_breakdown_v1,
 * underwriting_readiness_v1) stored in ingestion_reports is stale relative
 * to the financial_facts_v1 data for the deal.
 *
 * Rule: stale = max(financial_facts_v1.created_at) > ingestion_reports.created_at
 *
 * Fail-open: always returns false on any error to never break /report.
 */
/**
 * Computes whether the financial snapshot embedded in the compiled report is stale
 * relative to the latest financial_facts_v1 data for the deal.
 *
 * Freshness anchor: deal_intelligence_objects.updated_at (the canonical artifact that
 * analyze_deal refreshes). NOT ingestion_reports.created_at — that column is set at
 * first cache insert and is never touched by analyze_deal, which would cause a permanent
 * stale signal and an infinite requeue loop.
 *
 * Rule: stale = max(financial_facts_v1.created_at) > deal_intelligence_objects.updated_at
 *
 * @param opts.dioUpdatedAt  Pass the DIO row's updated_at when already in scope to skip
 *   the DB lookup. When absent, the function falls back to querying DIO directly.
 */
async function computeReportFinancialSnapshotStale(
  pool: Pool,
  dealId: string,
  analysisVersion: number,
  opts?: { dioUpdatedAt?: string | null },
): Promise<{ stale: boolean; max_fact_ts: string | null; report_ts: string; freshness_basis: string }> {
  const FRESH = { stale: false, max_fact_ts: null as string | null, report_ts: '', freshness_basis: 'none' };
  try {
    const maxFactTs = await getFinancialFactsMaxTimestamp(pool, dealId);

    // Determine freshness anchor from DIO.updated_at.
    // Prefer caller-supplied value to avoid an extra DB round-trip on the hot /report path.
    let freshnessAnchor: Date | null = null;
    let freshnessBasis = 'none';

    const provided = opts?.dioUpdatedAt;
    if (provided != null) {
      const d = new Date(provided);
      if (!isNaN(d.getTime())) {
        freshnessAnchor = d;
        freshnessBasis = 'dio_updated_at_caller';
      }
    }

    if (!freshnessAnchor) {
      // Fallback: query DIO for updated_at (covers call sites that don't yet have a DIO row in scope).
      const dioRow = await pool.query<{ updated_at: string | null }>(
        `SELECT updated_at
           FROM deal_intelligence_objects
          WHERE deal_id = $1::uuid AND analysis_version = $2::int
          ORDER BY updated_at DESC NULLS LAST, dio_id DESC
          LIMIT 1`,
        [dealId, analysisVersion],
      );
      const rawAt = dioRow.rows?.[0]?.updated_at ?? null;
      if (rawAt) {
        const d = new Date(rawAt);
        if (!isNaN(d.getTime())) {
          freshnessAnchor = d;
          freshnessBasis = 'dio_updated_at_queried';
        }
      }
    }

    if (!freshnessAnchor) return FRESH;

    const result = detectFinancialSnapshotStaleness({ maxFactCreatedAt: maxFactTs, reportCreatedAt: freshnessAnchor });
    return { ...result, freshness_basis: freshnessBasis };
  } catch {
    return FRESH; // fail-open: never break /report for a staleness check
  }
}

async function openaiChatCompletion(params: {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  maxTokens: number;
  responseFormat?: { type: 'json_object' };
  audit?: {
    request: FastifyRequest;
    deal_id: string | null;
    dio_id: string | null;
    llm_phase_mode: string | null;
    call: string;
    prompt_version: string;
    prompt_hash: string;
    system_bytes: number;
    user_bytes: number;
    prompt_bytes: number;
    request_id: string | number | null;
  };
}): Promise<{ content: string; model: string; usage?: OpenAIChatCompletionResponse['usage']; finish_reason?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const startedAtMs = nowMs();
  if (params.audit) {
    params.audit.request.log.info(
      {
        event: 'LLM_CALL_START',
        provider: 'openai',
        model: params.model,
        call: params.audit.call,
        prompt_version: params.audit.prompt_version,
        llm_phase_mode: params.audit.llm_phase_mode,
        deal_id: params.audit.deal_id,
        dio_id: params.audit.dio_id,
        request_id: params.audit.request_id,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        top_p: null,
        prompt_hash: params.audit.prompt_hash,
        system_bytes: params.audit.system_bytes,
        user_bytes: params.audit.user_bytes,
        prompt_bytes: params.audit.prompt_bytes,
        ts: new Date().toISOString(),
      },
      'LLM_CALL_START'
    );
  }

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
    const errMessage = text || `OpenAI request failed with ${res.status}`;
    if (params.audit) {
      params.audit.request.log.info(
        {
          event: 'LLM_CALL_DONE',
          ok: false,
          provider: 'openai',
          model: params.model,
          call: params.audit.call,
          prompt_version: params.audit.prompt_version,
          llm_phase_mode: params.audit.llm_phase_mode,
          deal_id: params.audit.deal_id,
          dio_id: params.audit.dio_id,
          request_id: params.audit.request_id,
          elapsed_ms: nowMs() - startedAtMs,
          finish_reason: null,
          usage_available: false,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          error: errMessage.slice(0, 800),
          ts: new Date().toISOString(),
        },
        'LLM_CALL_DONE'
      );
    }
    throw new Error(errMessage);
  }

  const json = (await res.json()) as OpenAIChatCompletionResponse;
  const choice0 = json?.choices?.[0];
  const content = choice0?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    if (params.audit) {
      params.audit.request.log.info(
        {
          event: 'LLM_CALL_DONE',
          ok: false,
          provider: 'openai',
          model: json?.model ?? params.model,
          call: params.audit.call,
          prompt_version: params.audit.prompt_version,
          llm_phase_mode: params.audit.llm_phase_mode,
          deal_id: params.audit.deal_id,
          dio_id: params.audit.dio_id,
          request_id: params.audit.request_id,
          elapsed_ms: nowMs() - startedAtMs,
          finish_reason: choice0?.finish_reason ?? null,
          usage_available: Boolean(json?.usage),
          prompt_tokens: asFiniteInt(json?.usage?.prompt_tokens) ?? null,
          completion_tokens: asFiniteInt(json?.usage?.completion_tokens) ?? null,
          total_tokens: asFiniteInt(json?.usage?.total_tokens) ?? null,
          error: 'OpenAI returned empty content',
          ts: new Date().toISOString(),
        },
        'LLM_CALL_DONE'
      );
    }
    throw new Error('OpenAI returned empty content');
  }

  if (params.audit) {
    params.audit.request.log.info(
      {
        event: 'LLM_CALL_DONE',
        ok: true,
        provider: 'openai',
        model: json?.model ?? params.model,
        call: params.audit.call,
        prompt_version: params.audit.prompt_version,
        llm_phase_mode: params.audit.llm_phase_mode,
        deal_id: params.audit.deal_id,
        dio_id: params.audit.dio_id,
        request_id: params.audit.request_id,
        elapsed_ms: nowMs() - startedAtMs,
        finish_reason: choice0?.finish_reason ?? null,
        usage_available: Boolean(json?.usage),
        prompt_tokens: asFiniteInt(json?.usage?.prompt_tokens) ?? null,
        completion_tokens: asFiniteInt(json?.usage?.completion_tokens) ?? null,
        total_tokens: asFiniteInt(json?.usage?.total_tokens) ?? null,
        output_bytes: Buffer.byteLength(content, 'utf8'),
        ts: new Date().toISOString(),
      },
      'LLM_CALL_DONE'
    );
  }

  if (params.audit?.deal_id && typeof params.audit.deal_id === 'string' && params.audit.deal_id.trim().length > 0) {
    const clerkUserId = typeof (params.audit.request as any)?.auth?.userId === 'string'
      ? (params.audit.request as any).auth.userId
      : undefined;
    await recordLLMMetrics({
      dealId: params.audit.deal_id,
      taskType: 'synthesis',
      model: json.model || params.model,
      provider: 'openai',
      inputTokens: Number(json?.usage?.prompt_tokens ?? 0),
      outputTokens: Number(json?.usage?.completion_tokens ?? 0),
      costUsd: 0,
      latencyMs: nowMs() - startedAtMs,
      cached: false,
      clerkUserId,
    });
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

  // Normalize `source` to the shape expected by the guard.
  // Many deterministic extractors store 0-based `page_index`; guard citations use 1-based `page`.
  if (out.source && typeof out.source === 'object') {
    try {
      if ((out.source as any).page == null && typeof (out.source as any).page_index === 'number' && Number.isFinite((out.source as any).page_index)) {
        (out.source as any).page = (out.source as any).page_index + 1;
      }
    } catch {
      // ignore
    }
  }

  if (out.value_raw == null && out.value && typeof out.value === 'object') {
    const raw = (out.value as any).raw;
    if (typeof raw === 'string' && raw.trim()) out.value_raw = raw;
  }

  // Guard expects a single deterministic `source` object (page + optional slide_title).
  if (out.source == null) {
    const sources = Array.isArray(out.sources) ? out.sources : [];
    const best =
      sources.find(
        (s: any) =>
          s &&
          typeof s === 'object' &&
          (typeof (s as any).page === 'number' || typeof (s as any).page_index === 'number')
      ) ?? null;
    if (best) {
      const page =
        typeof (best as any).page === 'number'
          ? (best as any).page
          : (typeof (best as any).page_index === 'number' ? (best as any).page_index + 1 : null);
      if (typeof page === 'number' && Number.isFinite(page)) {
      out.source = {
        page,
        slide_title: typeof (best as any).slide_title === 'string' ? (best as any).slide_title : null,
      };
      }
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
  timer?: StageTimer;
  reportExcerpt?: any;
  excerptHash?: string;
  llmContext?: { deal_id: string | null; dio_id: string | null; llm_phase_mode: string | null; request_id: string | number | null };
}): Promise<void> {
  if (!args.narrateEnabled) return;
  if (!args.report || typeof args.report !== 'object') return;

  const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : {};
  const model = process.env.OPENAI_MODEL_REPORT_NARRATE || 'gpt-4o-mini';

  const excerpt = args.reportExcerpt ?? buildAllowlistedNarrationExcerpt(args.report, { promoted_facts: args.promotedFactsForExcerpt });
  const prompt = buildNarrationPrompt({ excerpt });

  const devCacheEnabled = String(process.env.NODE_ENV ?? '').toLowerCase() === 'development';
  const inputsHash =
    (typeof (args.report as any)?.metadata?.deterministic_score_preview_v1?.inputs_hash === 'string'
      ? String((args.report as any).metadata.deterministic_score_preview_v1.inputs_hash)
      : null) ||
    (typeof (args.report as any)?.metadata?.deterministic_score_inputs_v1?.inputs_hash === 'string'
      ? String((args.report as any).metadata.deterministic_score_inputs_v1.inputs_hash)
      : null) ||
    (typeof args.excerptHash === 'string' && args.excerptHash.trim() ? args.excerptHash : stableHash(JSON.stringify(excerpt ?? null)));

  const cacheKey = `${inputsHash}|${model}|${NARRATION_PROMPT_VERSION}`;
  if (devCacheEnabled) {
    const cached = narrationDevCache.get(cacheKey);
    if (cached) {
      args.request.log.info(
        {
          event: 'report_narration_decision_v1',
          deal_id: (args.report as any)?.deal_id ?? (args.report as any)?.dealId ?? null,
          narrate_query: (args.request.query as any)?.narrate ?? null,
          will_call_llm: false,
          skip_reason: 'cache_hit',
          provider: 'openai',
          model,
          has_api_key: Boolean(process.env.OPENAI_API_KEY),
          deterministic_flags: readReportDeterministicFlags(),
          auth_mode: readReportAuthMode(args.request),
        },
        'report_narration_decision_v1'
      );
      (args.report as any).llm_narration_v1 = cached.narration;
      meta.llm_narration_v1_skipped = { reason: 'cache_hit' };
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
    args.request.log.info(
      {
        event: 'report_narration_decision_v1',
        deal_id: (args.report as any)?.deal_id ?? (args.report as any)?.dealId ?? null,
        narrate_query: (args.request.query as any)?.narrate ?? null,
        will_call_llm: false,
        skip_reason: 'missing_api_key',
        provider: 'openai',
        model,
        has_api_key: false,
        deterministic_flags: readReportDeterministicFlags(),
        auth_mode: readReportAuthMode(args.request),
      },
      'report_narration_decision_v1'
    );
    meta.llm_narration_v1_error = meta.llm_narration_v1_error ?? { code: 'missing_openai_api_key' };
    meta.llm_narration_v1_skipped = { reason: 'missing_api_key' };
    args.report.metadata = meta;
    return;
  }

  args.request.log.info(
    {
      event: 'report_narration_decision_v1',
      deal_id: (args.report as any)?.deal_id ?? (args.report as any)?.dealId ?? null,
      narrate_query: (args.request.query as any)?.narrate ?? null,
      will_call_llm: true,
      skip_reason: null,
      provider: 'openai',
      model,
      has_api_key: true,
      deterministic_flags: readReportDeterministicFlags(),
      auth_mode: readReportAuthMode(args.request),
    },
    'report_narration_decision_v1'
  );

  const startedAt = Date.now();
  let completionFinishReason: string | null = null;
  let completionModelUsed: string | null = null;
  let completionOutputChars: number | null = null;
  try {
    const system = prompt.system;
    const user = prompt.user;
    const systemBytes = Buffer.byteLength(system, 'utf8');
    const userBytes = Buffer.byteLength(user, 'utf8');
    const promptHash = stableHash(`${system}\n\n${user}`);

    const completion = await openaiChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 1800,
      audit: {
        request: args.request,
        call: 'report.narration_v1',
        prompt_version: NARRATION_PROMPT_VERSION,
        prompt_hash: promptHash,
        system_bytes: systemBytes,
        user_bytes: userBytes,
        prompt_bytes: systemBytes + userBytes,
        deal_id: args.llmContext?.deal_id ?? null,
        dio_id: args.llmContext?.dio_id ?? null,
        llm_phase_mode: args.llmContext?.llm_phase_mode ?? null,
        request_id: args.llmContext?.request_id ?? null,
      },
    });

    const raw = completion.content;
    completionFinishReason = typeof completion.finish_reason === 'string' && completion.finish_reason.trim() ? completion.finish_reason.trim() : null;
    completionModelUsed = typeof completion.model === 'string' && completion.model.trim() ? completion.model.trim() : null;
    completionOutputChars = typeof raw === 'string' ? raw.length : null;
    const stageBase = {
      request_id: args.llmContext?.request_id ?? (args.request as any)?.id ?? null,
      deal_id: args.llmContext?.deal_id ?? (args.report as any)?.deal_id ?? (args.report as any)?.dealId ?? null,
      dio_id: args.llmContext?.dio_id ?? null,
    };

    const parseStartMs = nowMs();
    let parsed: unknown;
    try {
      parsed = parseJsonOnly(raw);
    } catch (e) {
      const parseMs = nowMs() - parseStartMs;
      args.timer?.mark('llm.narration_v1.parse_json', parseMs, false);
      args.request.log.info(
        { event: 'REPORT_STAGE_TIMING', stage: 'llm.narration_v1.parse_json', ms: parseMs, ok: false, ...stageBase, ts: new Date().toISOString() },
        'REPORT_STAGE_TIMING'
      );

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
    const parseMs = nowMs() - parseStartMs;
    args.timer?.mark('llm.narration_v1.parse_json', parseMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.narration_v1.parse_json', ms: parseMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const validateStartMs = nowMs();
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

    const validateMs = nowMs() - validateStartMs;
    args.timer?.mark('llm.narration_v1.schema_validate', validateMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.narration_v1.schema_validate', ms: validateMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const guardStartMs = nowMs();
    const guard = validateNoNewFacts({ reportExcerpt: excerpt, narration: validated.narration });
    const guardMs = nowMs() - guardStartMs;
    args.timer?.mark('llm.narration_v1.guard', guardMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.narration_v1.guard', ms: guardMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const narration = (() => {
      if (guard.ok) return validated.narration as LlmNarrationV1Type;
      const degradeStartMs = nowMs();
      const degraded = degradeNarrationV1({ narration: validated.narration as LlmNarrationV1Type, violations: guard.violations });
      const degradeMs = nowMs() - degradeStartMs;
      args.timer?.mark('llm.narration_v1.degrade', degradeMs, true);
      args.request.log.info(
        { event: 'REPORT_STAGE_TIMING', stage: 'llm.narration_v1.degrade', ms: degradeMs, ok: true, ...stageBase, ts: new Date().toISOString() },
        'REPORT_STAGE_TIMING'
      );

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

    const assignStartMs = nowMs();
    (args.report as any).llm_narration_v1 = narration;
    const assignMs = nowMs() - assignStartMs;
    args.timer?.mark('llm.narration_v1.assign', assignMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.narration_v1.assign', ms: assignMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );
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

const OVERVIEW_SCHEMA_MAX = {
  hero_header_chars: 900,
  deal_summary_hero_chars: 400,
  deal_summary_mid_chars: 1400,
  deal_summary_long_chars: 3600,
  investment_overview_chars: 2400,
  bullet_chars: 320,
  strengths_bullets: 6,
  concerns_bullets: 8,
  coverage_gaps_bullets: 12,
  citations: 80,
  quality_flags: 24,
  evidence_id_chars: 96,
  slide_title_chars: 160,
} as const;

function sanitizeLlmOverviewV1AfterGuard(overview: any): any {
  if (!overview || typeof overview !== 'object') return overview;

  const clamp = (v: unknown, max: number): unknown => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max).trimEnd();
  };

  const clampBulletArray = (arr: unknown, maxItems: number): unknown => {
    if (!Array.isArray(arr)) return arr;
    return arr
      .slice(0, maxItems)
      .map((v) => clamp(v, OVERVIEW_SCHEMA_MAX.bullet_chars));
  };

  const next: any = { ...overview };

  next.hero_header = clamp(next.hero_header, OVERVIEW_SCHEMA_MAX.hero_header_chars);
  next.investment_analysis_overview = clamp(next.investment_analysis_overview, OVERVIEW_SCHEMA_MAX.investment_overview_chars);

  if (next.deal_summary && typeof next.deal_summary === 'object') {
    next.deal_summary = { ...next.deal_summary };
    next.deal_summary.hero = clamp(next.deal_summary.hero, OVERVIEW_SCHEMA_MAX.deal_summary_hero_chars);
    next.deal_summary.mid = clamp(next.deal_summary.mid, OVERVIEW_SCHEMA_MAX.deal_summary_mid_chars);
    next.deal_summary.long = clamp(next.deal_summary.long, OVERVIEW_SCHEMA_MAX.deal_summary_long_chars);
  }

  next.strengths_overlay = clampBulletArray(next.strengths_overlay, OVERVIEW_SCHEMA_MAX.strengths_bullets);
  next.concerns_overlay = clampBulletArray(next.concerns_overlay, OVERVIEW_SCHEMA_MAX.concerns_bullets);
  next.coverage_gaps_overlay = clampBulletArray(next.coverage_gaps_overlay, OVERVIEW_SCHEMA_MAX.coverage_gaps_bullets);

  if (Array.isArray(next.citations)) {
    next.citations = next.citations.slice(0, OVERVIEW_SCHEMA_MAX.citations).map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const out: any = { ...c };
      out.slide_title = clamp(out.slide_title, OVERVIEW_SCHEMA_MAX.slide_title_chars);
      out.evidence_id = clamp(out.evidence_id, OVERVIEW_SCHEMA_MAX.evidence_id_chars);
      return out;
    });
  }

  if (Array.isArray(next.quality_flags)) {
    next.quality_flags = next.quality_flags.slice(0, OVERVIEW_SCHEMA_MAX.quality_flags).map((v: any) => clamp(v, 64));
  }

  return next;
}

function sanitizeOverviewCandidateBeforeGuard(overview: any): any {
  if (!overview || typeof overview !== 'object') return overview;

  const clamp = (v: unknown, max: number): unknown => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max).trimEnd();
  };

  const clampBulletArray = (arr: unknown, maxItems: number): unknown => {
    if (!Array.isArray(arr)) return arr;
    return arr
      .slice(0, maxItems)
      .map((v) => clamp(v, OVERVIEW_SCHEMA_MAX.bullet_chars));
  };

  const next: any = { ...(overview as any) };

  next.hero_header = clamp(next.hero_header, OVERVIEW_SCHEMA_MAX.hero_header_chars);
  if (next.deal_summary && typeof next.deal_summary === 'object') {
    next.deal_summary = { ...next.deal_summary };
    next.deal_summary.hero = clamp(next.deal_summary.hero, OVERVIEW_SCHEMA_MAX.deal_summary_hero_chars);
    next.deal_summary.mid = clamp(next.deal_summary.mid, OVERVIEW_SCHEMA_MAX.deal_summary_mid_chars);
    next.deal_summary.long = clamp(next.deal_summary.long, OVERVIEW_SCHEMA_MAX.deal_summary_long_chars);
  }
  if (typeof next.investment_analysis_overview === 'string') {
    const repaired = repairInvestmentAnalysisOverviewStructure(next.investment_analysis_overview);
    next.investment_analysis_overview = clamp(repaired, OVERVIEW_SCHEMA_MAX.investment_overview_chars);
  } else {
    next.investment_analysis_overview = clamp(next.investment_analysis_overview, OVERVIEW_SCHEMA_MAX.investment_overview_chars);
  }

  next.strengths_overlay = clampBulletArray(next.strengths_overlay, OVERVIEW_SCHEMA_MAX.strengths_bullets);
  next.concerns_overlay = clampBulletArray(next.concerns_overlay, OVERVIEW_SCHEMA_MAX.concerns_bullets);
  next.coverage_gaps_overlay = clampBulletArray(next.coverage_gaps_overlay, OVERVIEW_SCHEMA_MAX.coverage_gaps_bullets);

  if (Array.isArray(next.citations)) {
    const raw = next.citations.slice(0, OVERVIEW_SCHEMA_MAX.citations).map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const out: any = { ...c };
      out.slide_title = clamp(out.slide_title, OVERVIEW_SCHEMA_MAX.slide_title_chars);
      out.evidence_id = clamp(out.evidence_id, OVERVIEW_SCHEMA_MAX.evidence_id_chars);
      return out;
    });

    // If citations are still schema-invalid (even after truncation), drop them entirely.
    const allCitationsValid = raw.every((c: any) => LlmOverviewV1CitationSchema.safeParse(c).success);
    next.citations = allCitationsValid ? raw : [];
  }

  if (Array.isArray(next.quality_flags)) {
    next.quality_flags = next.quality_flags.slice(0, OVERVIEW_SCHEMA_MAX.quality_flags).map((v: any) => clamp(v, 64));
  }

  return next;
}

const repairInvestmentAnalysisOverviewStructure = (text: string): string => {
  const raw = typeof text === 'string' ? text : '';
  const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleaned) return cleaned;

  const signalRe = /(^|\n)\s*[•*\-]?\s*Signal\s*:/gim;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = signalRe.exec(cleaned)) !== null) {
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

    chunk = chunk
      .replace(/(^|\n)\s*[•*\-]?\s*Signal\s*:/gim, '$1• Signal:')
      .replace(/(^|\n)\s*[•*\-]?\s*Implication\s*:/gim, '$1• Implication:')
      .replace(/(^|\n)\s*[•*\-]?\s*Uncertainty\s*:/gim, '$1• Uncertainty:')
      .replace(/(^|\n)\s*[•*\-]?\s*Decision\s*Tension\s*:/gim, '$1• Decision Tension:');

    if (!hasDecisionTension) {
      chunk = `${chunk}\n• Decision Tension: What evidence would most change conviction, and what specific diligence question should be answered next?`;
    }

    points.push(chunk.trim());
  }

  if (points.length >= 2 && points.length <= 4) return points.join('\n\n');
  return cleaned;
};

function sanitizeAndValidateOverviewOrDropCitations(overview: any):
  | { ok: true; overview: any; dropped_citations: boolean }
  | { ok: false; overview: any; error: any } {
  const sanitized = sanitizeLlmOverviewV1AfterGuard(overview);

  const first = LlmOverviewV1Schema.safeParse(sanitized);
  if (first.success) return { ok: true as const, overview: first.data, dropped_citations: false };

  const citationsOnly = first.error.issues.every((i) => i?.path?.[0] === 'citations');
  if (!citationsOnly) return { ok: false as const, overview: sanitized, error: first.error.flatten() };

  const dropped = sanitized && typeof sanitized === 'object' ? { ...(sanitized as any), citations: [] } : sanitized;
  const second = LlmOverviewV1Schema.safeParse(dropped);
  if (second.success) return { ok: true as const, overview: second.data, dropped_citations: true };
  return { ok: false as const, overview: dropped, error: second.error.flatten() };
}

async function maybeAttachOverviewV1(args: {
  request: FastifyRequest;
  report: any;
  nextMetadata: any;
  narrateEnabled: boolean;
  promotedFactsForExcerpt?: any[];
  timer?: StageTimer;
  reportExcerpt?: any;
  excerptHash?: string;
  llmContext?: { deal_id: string | null; dio_id: string | null; llm_phase_mode: string | null; request_id: string | number | null };
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
    excerpt = args.reportExcerpt ?? buildAllowlistedNarrationExcerpt(args.report, { promoted_facts: args.promotedFactsForExcerpt });
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
    meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'missing_openai_api_key' };
    meta.llm_overview_v1_skipped = { reason: 'missing_api_key' };
    args.report.metadata = meta;
    return;
  }

  const startedAt = Date.now();
  let completionFinishReason: string | null = null;
  let completionModelUsed: string | null = null;
  let completionOutputChars: number | null = null;
  try {
    const system = prompt.system;
    const user = prompt.user;
    const systemBytes = Buffer.byteLength(system, 'utf8');
    const userBytes = Buffer.byteLength(user, 'utf8');
    const promptHash = stableHash(`${system}\n\n${user}`);

    const completion = await openaiChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 1800,
      audit: {
        request: args.request,
        call: 'report.overview_v1',
        prompt_version: OVERVIEW_PROMPT_VERSION,
        prompt_hash: promptHash,
        system_bytes: systemBytes,
        user_bytes: userBytes,
        prompt_bytes: systemBytes + userBytes,
        deal_id: args.llmContext?.deal_id ?? null,
        dio_id: args.llmContext?.dio_id ?? null,
        llm_phase_mode: args.llmContext?.llm_phase_mode ?? null,
        request_id: args.llmContext?.request_id ?? null,
      },
    });

    const raw = completion.content;
    completionFinishReason = typeof completion.finish_reason === 'string' && completion.finish_reason.trim() ? completion.finish_reason.trim() : null;
    completionModelUsed = typeof completion.model === 'string' && completion.model.trim() ? completion.model.trim() : null;
    completionOutputChars = typeof raw === 'string' ? raw.length : null;

    const stageBase = {
      request_id: args.llmContext?.request_id ?? (args.request as any)?.id ?? null,
      deal_id: args.llmContext?.deal_id ?? (args.report as any)?.deal_id ?? (args.report as any)?.dealId ?? null,
      dio_id: args.llmContext?.dio_id ?? null,
    };

    const parseStartMs = nowMs();
    let parsed: unknown;
    try {
      parsed = parseJsonOnly(raw);
    } catch (e) {
      const parseMs = nowMs() - parseStartMs;
      args.timer?.mark('llm.overview_v1.parse_json', parseMs, false);
      args.request.log.info(
        { event: 'REPORT_STAGE_TIMING', stage: 'llm.overview_v1.parse_json', ms: parseMs, ok: false, ...stageBase, ts: new Date().toISOString() },
        'REPORT_STAGE_TIMING'
      );

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
    const parseMs = nowMs() - parseStartMs;
    args.timer?.mark('llm.overview_v1.parse_json', parseMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.overview_v1.parse_json', ms: parseMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const sanitizeStartMs = nowMs();
    const candidate = sanitizeOverviewCandidateBeforeGuard(parsed);
    const sanitizeMs = nowMs() - sanitizeStartMs;
    args.timer?.mark('llm.overview_v1.sanitize_before_guard', sanitizeMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.overview_v1.sanitize_before_guard', ms: sanitizeMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const guardStartMs = nowMs();
    const guarded = degradeOverviewV1({ reportExcerpt: excerpt, overview: candidate });
    const guardMs = nowMs() - guardStartMs;
    args.timer?.mark('llm.overview_v1.guard_degrade', guardMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.overview_v1.guard_degrade', ms: guardMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const validateStartMs = nowMs();
    const validated = sanitizeAndValidateOverviewOrDropCitations(guarded.overview);
    const validateMs = nowMs() - validateStartMs;
    args.timer?.mark('llm.overview_v1.validate', validateMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.overview_v1.validate', ms: validateMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );
    if (validated.ok) {
      (args.report as any).llm_overview_v1 = validated.overview;
    } else {
      ensureOverviewPresent();
      meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'schema_invalid_after_degrade', details: validated.error };
    }

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
  timer?: StageTimer;
  reportExcerpt?: any;
  excerptHash?: string;
  llmContext?: { deal_id: string | null; dio_id: string | null; llm_phase_mode: string | null; request_id: string | number | null };
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

    const clampTitle = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const trimmed = v.trim();
      if (!trimmed) return undefined;
      return trimmed.length <= OVERVIEW_SCHEMA_MAX.slide_title_chars ? trimmed : trimmed.slice(0, OVERVIEW_SCHEMA_MAX.slide_title_chars).trimEnd();
    };

    const push = (page: unknown, slideTitle: unknown, evidenceId: unknown) => {
      const p = typeof page === 'number' && Number.isFinite(page) ? page : null;
      if (p == null) return;
      const t = clampTitle(slideTitle);
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

  let excerpt: any;
  let prompt: { system: string; user: string };
  try {
    excerpt = args.reportExcerpt ?? buildAllowlistedNarrationExcerpt(args.report, { promoted_facts: args.promotedFactsForExcerpt });
    prompt = buildInvestmentAnalysisOverviewPrompt({ reportExcerpt: excerpt });
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    ensureOverviewPresent();
    meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'provider_error', message: baseMessage };
    args.report.metadata = meta;
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    ensureOverviewPresent();
    meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'missing_openai_api_key' };
    meta.llm_overview_v1_skipped = meta.llm_overview_v1_skipped ?? { reason: 'missing_api_key' };
    args.report.metadata = meta;
    return;
  }

  const startedAt = Date.now();
  let completionFinishReason: string | null = null;
  let completionModelUsed: string | null = null;
  let completionOutputChars: number | null = null;
  try {
    const system = prompt.system;
    const user = prompt.user;
    const systemBytes = Buffer.byteLength(system, 'utf8');
    const userBytes = Buffer.byteLength(user, 'utf8');
    const promptHash = stableHash(`${system}\n\n${user}`);

    const completion = await openaiChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 900,
      audit: {
        request: args.request,
        call: 'report.investment_analysis_overview_v1',
        prompt_version: INVESTMENT_ANALYSIS_OVERVIEW_PROMPT_VERSION,
        prompt_hash: promptHash,
        system_bytes: systemBytes,
        user_bytes: userBytes,
        prompt_bytes: systemBytes + userBytes,
        deal_id: args.llmContext?.deal_id ?? null,
        dio_id: args.llmContext?.dio_id ?? null,
        llm_phase_mode: args.llmContext?.llm_phase_mode ?? null,
        request_id: args.llmContext?.request_id ?? null,
      },
    });

    const raw = completion.content;
    completionFinishReason = typeof completion.finish_reason === 'string' && completion.finish_reason.trim() ? completion.finish_reason.trim() : null;
    completionModelUsed = typeof completion.model === 'string' && completion.model.trim() ? completion.model.trim() : null;
    completionOutputChars = typeof raw === 'string' ? raw.length : null;

    const stageBase = {
      request_id: args.llmContext?.request_id ?? (args.request as any)?.id ?? null,
      deal_id: args.llmContext?.deal_id ?? (args.report as any)?.deal_id ?? (args.report as any)?.dealId ?? null,
      dio_id: args.llmContext?.dio_id ?? null,
    };

    const parseStartMs = nowMs();
    let parsed: unknown;
    try {
      parsed = parseJsonOnly(raw);
    } catch (e) {
      const parseMs = nowMs() - parseStartMs;
      args.timer?.mark('llm.investment_analysis_overview_v1.parse_json', parseMs, false);
      args.request.log.info(
        { event: 'REPORT_STAGE_TIMING', stage: 'llm.investment_analysis_overview_v1.parse_json', ms: parseMs, ok: false, ...stageBase, ts: new Date().toISOString() },
        'REPORT_STAGE_TIMING'
      );

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
    const parseMs = nowMs() - parseStartMs;
    args.timer?.mark('llm.investment_analysis_overview_v1.parse_json', parseMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.investment_analysis_overview_v1.parse_json', ms: parseMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

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
    const guardStartMs = nowMs();
    const guardCitations = collectDeterministicOverviewCitations(excerpt, 40);
    const guarded = degradeOverviewV1({
      reportExcerpt: excerpt,
      overview: { version: 'llm_overview_v1', investment_analysis_overview: repairedText, citations: guardCitations },
    });
    const guardMs = nowMs() - guardStartMs;
    args.timer?.mark('llm.investment_analysis_overview_v1.guard_degrade', guardMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.investment_analysis_overview_v1.guard_degrade', ms: guardMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );

    const existing = (args.report as any).llm_overview_v1;
    if (!existing || typeof existing !== 'object') {
      (args.report as any).llm_overview_v1 = guarded.overview;
    } else {
      (existing as any).investment_analysis_overview = guarded.overview.investment_analysis_overview;
      if (!Array.isArray((existing as any).citations)) {
        (existing as any).citations = guardCitations;
      }
      if (Array.isArray(guarded.overview.quality_flags) && guarded.overview.quality_flags.includes('guard_degraded')) {
        (existing as any).quality_flags = Array.isArray((existing as any).quality_flags)
          ? Array.from(new Set([...(existing as any).quality_flags, 'guard_degraded']))
          : ['guard_degraded'];
      }
    }

    // Final schema safety pass (after guard/degrade + merge).
    const validateStartMs = nowMs();
    const current = (args.report as any).llm_overview_v1;
    const validated = sanitizeAndValidateOverviewOrDropCitations(current);
    const validateMs = nowMs() - validateStartMs;
    args.timer?.mark('llm.investment_analysis_overview_v1.validate', validateMs, true);
    args.request.log.info(
      { event: 'REPORT_STAGE_TIMING', stage: 'llm.investment_analysis_overview_v1.validate', ms: validateMs, ok: true, ...stageBase, ts: new Date().toISOString() },
      'REPORT_STAGE_TIMING'
    );
    if (validated.ok) {
      (args.report as any).llm_overview_v1 = validated.overview;
    } else {
      ensureOverviewPresent();
      meta.llm_overview_v1_error = meta.llm_overview_v1_error ?? { code: 'schema_invalid_after_degrade', details: validated.error };
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

export function applyStructuredNumericTrustGates(report: any): void {
  try {
    if (!report || typeof report !== 'object') return;
    const structured = (report as any).structured_summary;
    if (!structured || typeof structured !== 'object') return;

    const sourceText = (sources: any[]): string =>
      (Array.isArray(sources) ? sources : [])
        .map((s) => {
          if (!s || typeof s !== 'object') return '';
          return [
            String((s as any).note_snippet ?? ''),
            String((s as any).snippet ?? ''),
            String((s as any).slide_title ?? ''),
          ]
            .join(' ')
            .trim();
        })
        .filter((x) => x.length > 0)
        .join(' ')
        .toLowerCase();

    const sourceKinds = (sources: any[]): Set<string> =>
      new Set(
        (Array.isArray(sources) ? sources : [])
          .map((s) => (s && typeof s === 'object' ? String((s as any).kind ?? '').trim().toLowerCase() : ''))
          .filter(Boolean)
      );

    const isExternalContractLike = (text: string): boolean =>
      /\b(cost\s+to\s+acquire|fully\s+guaranteed|draft\s+picks?|game\s+suspension|contract\s+value|sportsbook|trade)\b/.test(text);

    const isMarketSizingHypothetical = (text: string): boolean =>
      /\b(tam|sam|som|market\s+share|users?|arr|annual\s+recurring\s+revenue)\b/.test(text) &&
      /\?|\b(help\s+me\s+understand|what\s+if|would|could|assum(?:e|ing|ption|ptions)|imply)\b/.test(text);

    const isPackagingLike = (text: string): boolean =>
      /\b\d{2,4}\s*(ml|oz|fl\s*oz|g|kg|lb|lbs)\b/.test(text) ||
      (/\b(cans?|bottles?|packs?)\b/.test(text) && /\b(ml|oz|fl\s*oz)\b/.test(text));

    // Raise trust gate: drop large promoted raises sourced from clearly non-financing contexts.
    try {
      const raise = (structured as any).raise;
      if (raise && typeof raise === 'object') {
        const amountRaw = (raise as any)?.value_json?.amount?.amount;
        const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null;
        const sources = Array.isArray((raise as any).sources) ? (raise as any).sources : [];
        const kinds = sourceKinds(sources);
        const text = sourceText(sources);
        const suspiciousContext = isExternalContractLike(text) || isMarketSizingHypothetical(text);
        if (amount != null && amount >= 50_000_000 && kinds.has('promoted_fact') && suspiciousContext) {
          (raise as any).value = null;
          if ((raise as any).value_json && typeof (raise as any).value_json === 'object') {
            (raise as any).value_json = {
              ...(raise as any).value_json,
              amount: {
                amount: null,
                currency: (raise as any).value_json?.amount?.currency ?? 'USD',
              },
            };
          }
          (raise as any).suppressed_reason = 'low_trust_raise_context';
        }
      }
    } catch {
      // ignore
    }

    // Revenue trust gate: suppress weak-source outliers and fall back to safer candidates when present.
    try {
      const revenue = (structured as any).revenue;
      if (revenue && typeof revenue === 'object') {
        const candidates: any[] = Array.isArray((revenue as any).candidates) ? (revenue as any).candidates : [];

        const hasStrongCorroboration = (candidate: any): boolean => {
          const amount = typeof candidate?.amount === 'number' && Number.isFinite(candidate.amount) ? candidate.amount : null;
          if (amount == null || amount <= 0) return false;
          return candidates.some((other) => {
            if (!other || other === candidate) return false;
            const otherAmount = typeof other?.amount === 'number' && Number.isFinite(other.amount) ? other.amount : null;
            if (otherAmount == null || otherAmount <= 0) return false;
            const kinds = sourceKinds(other?.sources ?? []);
            const hasStrongKind = ['xlsx', 'pdf_table', 'pdf_kpi_line', 'input_metric'].some((k) => kinds.has(k));
            if (!hasStrongKind) return false;
            const relDelta = Math.abs(otherAmount - amount) / Math.max(amount, 1);
            return relDelta <= 0.5;
          });
        };

        const isSuspiciousRevenueCandidate = (candidate: any): boolean => {
          const amount = typeof candidate?.amount === 'number' && Number.isFinite(candidate.amount) ? candidate.amount : null;
          if (amount == null || amount < 100_000_000) return false;

          const kinds = sourceKinds(candidate?.sources ?? []);
          const text = sourceText(candidate?.sources ?? []);
          const confidence = typeof candidate?.confidence === 'number' && Number.isFinite(candidate.confidence) ? candidate.confidence : 0;

          if (kinds.has('promoted_fact') && (isExternalContractLike(text) || isMarketSizingHypothetical(text) || isPackagingLike(text))) {
            return true;
          }

          const weakKpi = kinds.has('kpi_tile') || kinds.has('chart_pixel');
          if (weakKpi && confidence <= 0.65 && !hasStrongCorroboration(candidate)) {
            return true;
          }

          return false;
        };

        const selected = candidates.find((c) => c && c.selected === true) ?? null;
        if (selected && isSuspiciousRevenueCandidate(selected)) {
          const fallback = candidates.find((c) => c && c !== selected && !isSuspiciousRevenueCandidate(c)) ?? null;
          if (fallback) {
            const nextAmount = typeof fallback.amount === 'number' && Number.isFinite(fallback.amount) ? fallback.amount : null;
            (revenue as any).value = {
              amount: nextAmount,
              currency: typeof fallback.currency === 'string' && fallback.currency.trim() ? fallback.currency : ((revenue as any)?.value?.currency ?? 'USD'),
              period: (revenue as any)?.value?.period ?? null,
              raw: typeof fallback.value_raw === 'string' && fallback.value_raw.trim() ? fallback.value_raw : null,
            };
            (revenue as any).confidence = typeof fallback.confidence === 'number' && Number.isFinite(fallback.confidence)
              ? fallback.confidence
              : (revenue as any).confidence;
            (revenue as any).sources = Array.isArray(fallback.sources) ? fallback.sources : [];
            (revenue as any).selection_reason = 'trust_gate_fallback';
            (revenue as any).candidates = candidates.map((c) => ({ ...c, selected: c === fallback }));
          } else {
            (revenue as any).value = null;
            (revenue as any).sources = [];
            (revenue as any).selection_reason = 'suppressed_low_trust_revenue';
            (revenue as any).candidates = candidates.map((c) => ({ ...c, selected: false }));
          }
        }
      }
    } catch {
      // ignore
    }
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

function titleCaseFromKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(' ');
}

function decisionV1DisplayLabel(meta: any): string | null {
  const decision = meta?.decision_v1 && typeof meta.decision_v1 === 'object' ? meta.decision_v1 : null;
  const label = typeof decision?.label === 'string' && decision.label.trim() ? decision.label.trim() : null;
  if (label) return label;
  const key = typeof decision?.recommendation_key === 'string' && decision.recommendation_key.trim()
    ? decision.recommendation_key.trim()
    : null;
  return key ? titleCaseFromKey(key) : null;
}

function alignReportSectionsToDecisionV1(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : null;
    const report = args.report && typeof args.report === 'object' ? args.report : null;
    if (!meta || !report) return;

    if (meta.decision_v1_sections_alignment_v1 === true) return;

    const label = decisionV1DisplayLabel(meta);
    if (!label) return;

    const sectionsRaw: any[] = Array.isArray((report as any).sections) ? (report as any).sections : [];
    if (!sectionsRaw.length) return;

    const shouldRewrite = (title: unknown): boolean => {
      const t = typeof title === 'string' ? title.trim() : '';
      return t === 'Executive Summary' || t === 'Investment Recommendation';
    };

    const nextSections = sectionsRaw.map((section) => {
      if (!section || typeof section !== 'object') return section;
      if (!shouldRewrite((section as any).title)) return section;
      const content = typeof (section as any).content === 'string' ? String((section as any).content) : '';
      if (!content) return section;

      // Sections from the core compiler currently encode newlines as literal "\\n" sequences.
      // Rewrite the "Recommendation:" line regardless of whether content uses real newlines or literal "\\n".
      const nextContent = content.replace(
        /Recommendation:\s*.*?(?=(\n|\\n|$))/g,
        `Recommendation: ${label}`
      );
      if (nextContent === content) return section;
      return { ...(section as any), content: nextContent };
    });

    (report as any).sections = nextSections;

    meta.decision_v1_sections_alignment_v1 = true;
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

      // [BACKFILL] For older DIOs where unadjusted_pinned was not persisted, recompute
      // it deterministically from stored totals so decision_v1 severity is correct.
      const _pinnedExplicit = (totals && (totals as any).unadjusted_pinned !== undefined)
        ? Boolean((totals as any).unadjusted_pinned)
        : null;
      const _scoreConfidence = asFiniteNumber(totals?.confidence_score);
      const _kpiCountForPin = kpis.length;
      const _pinBackfill = _pinnedExplicit === null
        ? shouldPinUnadjusted({
            coverageRatio,
            kpiCount: _kpiCountForPin,
            driftAssessment,
            scoreConfidence: _scoreConfidence,
          })
        : { pinned: _pinnedExplicit, reason: null as null };
      const unadjustedPinned = _pinnedExplicit !== null ? _pinnedExplicit : _pinBackfill.pinned;
      const unadjustedReason = (
        totals && typeof (totals as any).unadjusted_reason === 'string' && String((totals as any).unadjusted_reason).trim()
      )
        ? String((totals as any).unadjusted_reason).trim()
        : (_pinBackfill.reason ?? null);

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

    // Ensure any pre-rendered section text uses canonical decision_v1 too.
    alignReportSectionsToDecisionV1({ nextMetadata: meta, report: args.report });

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
   * GET /api/v1/deals/:deal_id/report_diagnostics
   * Debug endpoint: show selected business_model_v1 promoted fact (persisted or DPU-derived).
   */
  app.get<{ Params: ReportParams }>(
    "/api/v1/deals/:deal_id/report_diagnostics",
    async (request: FastifyRequest<{ Params: ReportParams }>, reply: FastifyReply) => {
      const { deal_id } = request.params;
      if (!isUuid(deal_id)) {
        return reply.status(400).send({ ok: false, error: 'invalid_deal_id', message: 'deal_id must be a UUID' });
      }

      // Artifact metadata (best-effort).
      let artifact: any = null;
      let dioUpdatedAt: string | null = null;
      let dioData: any = null;
      try {
        const r = await pool.query(
          `SELECT dio_id, analysis_version, input_hash, updated_at, dio_data
             FROM deal_intelligence_objects
            WHERE deal_id = $1
            ORDER BY analysis_version DESC, updated_at DESC NULLS LAST, dio_id DESC
            LIMIT 1`,
          [deal_id]
        );
        const row = r.rows?.[0] ?? null;
        dioUpdatedAt = row && row.updated_at ? String(row.updated_at) : null;
        dioData = row && (row as any).dio_data ? (row as any).dio_data : null;
        artifact = row
          ? {
              dio_id: row.dio_id,
              analysis_version: row.analysis_version,
              input_hash: row.input_hash,
              updated_at: row.updated_at,
            }
          : null;
      } catch {
        artifact = null;
        dioUpdatedAt = null;
        dioData = null;
      }

      // DPU freshness (best-effort)
      let latestDpuCreatedAt: string | null = null;
      try {
        const r = await pool.query<{ latest_dpu_created_at: string | null }>(
          `
          SELECT MAX(dpu.created_at)::text AS latest_dpu_created_at
            FROM document_page_understanding dpu
            JOIN documents d ON d.id = dpu.document_id
           WHERE d.deal_id = $1
             AND d.deleted_at IS NULL
             AND dpu.version = 'page_understanding_v1'
          `,
          [deal_id]
        );
        latestDpuCreatedAt = typeof r.rows?.[0]?.latest_dpu_created_at === 'string' ? String(r.rows[0].latest_dpu_created_at) : null;
      } catch {
        latestDpuCreatedAt = null;
      }

      const dioMinDpuCreatedAt = (() => {
        const meta = dioData && typeof dioData === 'object' ? (dioData as any).meta : null;
        const raw = meta && typeof meta === 'object' ? (meta as any).min_dpu_created_at : null;
        return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
      })();

      // Correct freshness gating: compare DPU to the DPU-freshness floor used for the analysis run
      // (not dio.updated_at, which is written after prerequisites and is not a valid DPU provenance signal).
      const dpuStaleVsDio = (() => {
        if (!latestDpuCreatedAt || !dioMinDpuCreatedAt) return null;
        const a = Date.parse(latestDpuCreatedAt);
        const b = Date.parse(dioMinDpuCreatedAt);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        return a < b;
      })();

      // Facts: persisted evidence_items + deterministic DPU-derived fallback.
      let promotedFacts: any[] = [];
      try {
        promotedFacts = await loadPromotedFactsForDeal(pool as any, deal_id);
      } catch {
        promotedFacts = [];
      }

      const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
      const hasModel = promotedFacts.some((r: any) => factTypeOf(r) === 'business_model_v1');
      if (!hasModel) {
        try {
          const derived = await derivePromotedFactsFromDpuForDeal(pool as any, deal_id);
          promotedFacts.push(...(derived as any[]));
        } catch {
          // fail open
        }
      }

      const models = promotedFacts.filter((r: any) => factTypeOf(r) === 'business_model_v1');
      const score = (f: any): number => {
        const st = typeof f?.source_type === 'string' ? f.source_type : '';
        const conf = typeof f?.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence : 0;
        const bonus = st === 'business_model_fact' ? 0.25 : 0;
        return conf + bonus;
      };
      const selected =
        (models
          .slice()
          .sort(
            (a: any, b: any) =>
              score(b) - score(a) || String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? ''))
          )[0] as any) ?? null;

      const value_json = selected?.content_json?.value_json ?? selected?.content_json?.valueJson ?? null;
      const diagnostics = value_json && typeof value_json === 'object' ? (value_json as any).diagnostics ?? null : null;

      return reply.send({
        ok: true,
        deal_id,
        artifact,
        dpu: {
          version: 'page_understanding_v1',
          latest_dpu_created_at: latestDpuCreatedAt,
          stale_vs_dio_updated_at: dpuStaleVsDio,
        },
        business_model_v1: selected
          ? {
              evidence_id: selected.evidence_id ?? null,
              source_type: selected.source_type ?? null,
              source_path: selected.source_path ?? null,
              source_document_id: selected.source_document_id ?? null,
              extracted_at: selected.extracted_at ?? null,
              confidence: selected.confidence ?? null,
              value_json,
              diagnostics,
              meta: selected.meta ?? null,
            }
          : null,
      });
    }
  );
  
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
      const timer = new StageTimer();
      const requestId = (request as any)?.id ?? null;
      const logStage = (stage: string, ms: number, ok: boolean, extra?: Record<string, any>) => {
        request.log.info(
          {
            event: 'REPORT_STAGE_TIMING',
            stage,
            ms,
            ok,
            request_id: requestId,
            deal_id: request.params?.deal_id ?? null,
            ...(extra ?? {}),
            ts: new Date().toISOString(),
          },
          'REPORT_STAGE_TIMING'
        );
      };
      try {
        const { deal_id } = request.params;
        request.log.info({ msg: "deal.report.start", deal_id, start_ts: new Date(startTs).toISOString() });

        const narrateEnabled = envFlagEnabled((request.query as any)?.narrate);

        if (!isUuid(deal_id)) {
          return reply.status(400).send({ error: 'invalid_deal_id', message: 'deal_id must be a UUID' });
        }

        // 404 only when the deal itself does not exist.
        const dealLookup = await timer.stage('db.deal_lookup', async () => {
          return pool.query<{ id: string; llm_phase_mode: string | null }>(
            `SELECT id, llm_phase_mode::text as llm_phase_mode FROM deals WHERE id = $1 AND deleted_at IS NULL`,
            [deal_id]
          );
        });
        logStage('db.deal_lookup', dealLookup.ms, true);
        const dealRows = dealLookup.value.rows;
        if (dealRows.length === 0) {
          return reply.status(404).send({ error: 'Deal not found' });
        }
        const llm_phase_mode = typeof dealRows[0]?.llm_phase_mode === 'string' ? dealRows[0].llm_phase_mode : null;

        // Canonical persisted analysis artifact: the latest Deal Intelligence Object (DIO).
        // Do NOT infer readiness from job messages.
        let dioRows: Array<{
          dio_id: string;
          analysis_version: number | null;
          recommendation: string | null;
          overall_score: number | null;
          dio_data: any;
          updated_at: string | null;
        }> = [];
        try {
          const dioLookup = await timer.stage('db.dio_latest', async () => {
            return pool.query<{
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
          });
          logStage('db.dio_latest', dioLookup.ms, true);
          dioRows = dioLookup.value.rows ?? [];
        } catch (err) {
          if (isMissingRelation(err, 'deal_intelligence_objects')) {
            logStage('db.dio_latest', 0, false, { missing_table: 'deal_intelligence_objects' });
            return reply.status(200).send({
              ready: false,
              reason: 'db_missing_table',
              missing_table: 'deal_intelligence_objects',
            });
          }
          throw err;
        }

        if (dioRows.length === 0) {
          return reply.status(200).send({ ready: false, reason: 'not_generated_yet' });
        }

        const row = dioRows[0];
        const version = typeof row.analysis_version === 'number' && Number.isFinite(row.analysis_version)
          ? row.analysis_version
          : undefined;

        // Idempotent report cache (non-narrated only): ingestion_reports keyed by (deal_id, analysis_version).
        // This must not change response shape; it only avoids duplicate rows and re-computation.
        if (!narrateEnabled && typeof version === 'number' && Number.isFinite(version) && version >= 1) {
          const cached = await timer.stage('db.ingestion_reports.read', async () =>
            readIngestionReportSummaryByDealAndVersion(pool, deal_id, version)
          );
          logStage('db.ingestion_reports.read', cached.ms, true);

          if (cached.value && typeof cached.value === 'object') {
            // Touch updated_at on each access per UPSERT contract.
            const touch = await timer.stage('db.ingestion_reports.upsert', async () =>
              upsertIngestionReportSummaryByDealAndVersion({ pool, dealId: deal_id, analysisVersion: version, summary: cached.value, documentIds: [] })
            );
            logStage('db.ingestion_reports.upsert', touch.ms, true, { cache: 'hit' });
            // Inject live staleness flag — same pattern as the versioned route.
            // Never persisted; always computed fresh on cache-hit.
            let financial_snapshot_stale = false;
            try {
              const _sr = await computeReportFinancialSnapshotStale(pool, deal_id, version, { dioUpdatedAt: row.updated_at });
              financial_snapshot_stale = _sr.stale;
            } catch { /* fail-open */ }
            // Inject investment_analysis_overview_v2 fresh on cache-hit — never persisted.
            // Ensures the summary field (and any future builder changes) are always current.
            const cacheHitReport: any = { ...cached.value };
            try {
              const freshIaoV2 = buildInvestmentAnalysisOverviewV2({
                dio: row.dio_data as any,
                report: cacheHitReport,
              });
              cacheHitReport.investment_analysis_overview_v2 = freshIaoV2;
              const meta = { ...((cacheHitReport.metadata && typeof cacheHitReport.metadata === 'object' ? cacheHitReport.metadata : {})) };
              meta.investment_analysis_overview_v2 = freshIaoV2;
              cacheHitReport.metadata = meta;
              if (cacheHitReport.report && typeof cacheHitReport.report === 'object') {
                cacheHitReport.report = { ...cacheHitReport.report, investment_analysis_overview_v2: freshIaoV2 };
              }
            } catch { /* fail-open */ }
            return reply.status(200).send({ ...cacheHitReport, financial_snapshot_stale });
          }
        }

        const artifact = {
          kind: 'deal_intelligence_object',
          dio_id: row.dio_id,
          analysis_version: row.analysis_version,
          updated_at: row.updated_at,
          recommendation: row.recommendation,
          overall_score: row.overall_score,
        };

        // DPU freshness signal for safety gating of derived promoted facts.
        let latestDpuCreatedAt: string | null = null;
        let dpuStaleVsDio = false;
        try {
          const r = await timer.stage('db.dpu_latest_created_at', async () => {
            return pool.query<{ latest_dpu_created_at: string | null }>(
              `
              SELECT MAX(dpu.created_at)::text AS latest_dpu_created_at
                FROM document_page_understanding dpu
                JOIN documents d ON d.id = dpu.document_id
               WHERE d.deal_id = $1
                 AND d.deleted_at IS NULL
                 AND dpu.version = 'page_understanding_v1'
              `,
              [deal_id]
            );
          });
          logStage('db.dpu_latest_created_at', r.ms, true);
          latestDpuCreatedAt = typeof r.value.rows?.[0]?.latest_dpu_created_at === 'string' ? String(r.value.rows[0].latest_dpu_created_at) : null;

          const dioMinDpuCreatedAt = (() => {
            const dioData = row && (row as any).dio_data && typeof (row as any).dio_data === 'object' ? (row as any).dio_data : null;
            const meta = dioData && typeof dioData === 'object' ? (dioData as any).meta : null;
            const raw = meta && typeof meta === 'object' ? (meta as any).min_dpu_created_at : null;
            return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
          })();

          if (latestDpuCreatedAt && dioMinDpuCreatedAt) {
            const a = Date.parse(latestDpuCreatedAt);
            const b = Date.parse(dioMinDpuCreatedAt);
            if (Number.isFinite(a) && Number.isFinite(b)) dpuStaleVsDio = a < b;
          } else {
            // If we don't have a provenance token, fail open so /report can use deterministic
            // DPU-derived facts rather than getting stuck in a permanent "stale" state.
            dpuStaleVsDio = false;
          }
        } catch {
          // best-effort
          latestDpuCreatedAt = null;
          dpuStaleVsDio = false;
        }

        // Deterministic deal summary (no LLM): derived from segmented DPU nodes.
        // Best-effort: never fail the whole /report response if this compilation fails.
        let dealSummaryV1: any = null;
        let segmentedNodes: { nodes: any[]; warnings: string[] } | null = null;
        try {
          const seg = await timer.stage('db.segmented_nodes', async () => getSegmentedNodesForDeal(pool as any, deal_id));
          logStage('db.segmented_nodes', seg.ms, true);
          segmentedNodes = seg.value;
        } catch (err) {
          const ms = 0;
          logStage('db.segmented_nodes', ms, false, { error: err instanceof Error ? err.message : String(err ?? 'unknown_error') });
          request.log.warn({ event: 'deal.report.segmented_nodes_failed', deal_id, dio_id: row.dio_id, err }, 'segmented nodes lookup failed');
          segmentedNodes = null;
        }
        try {
          const q = (request.query ?? {}) as any;
          const dbg = String(q?.debug_deal_summary ?? '').trim().toLowerCase();
          const debugDealSummary = dbg === '1' || dbg === 'true' || dbg === 'yes' || dbg === 'on';

          const ds = await timer.stage('compile.deal_summary_v1', async () =>
            compileDealSummaryV1(pool as any, deal_id, {
              prefetched: segmentedNodes ?? undefined,
              includeDebug: debugDealSummary,
              includeCandidates: debugDealSummary,
            } as any)
          );
          logStage('compile.deal_summary_v1', ds.ms, true);
          dealSummaryV1 = ds.value;

          if (debugDealSummary && dealSummaryV1 && typeof dealSummaryV1 === 'object') {
            const dbgPayload = (dealSummaryV1 as any).debug ?? null;

            request.log.info(
              {
                event: 'deal.report.deal_summary_debug',
                deal_id,
                dio_id: row.dio_id,
                selected: {
                  tiers: {
                    hero: (dealSummaryV1 as any)?.tiers?.hero ?? null,
                    mid: (dealSummaryV1 as any)?.tiers?.overview ?? null,
                    long: (dealSummaryV1 as any)?.tiers?.deep ?? null,
                  },
                  sources: dbgPayload?.selected?.sources ?? null,
                },
                selection_path: dbgPayload?.selection_path ?? null,
                candidates: dbgPayload?.candidates ?? null,
                ready: (dealSummaryV1 as any)?.ready ?? null,
                reason: (dealSummaryV1 as any)?.reason ?? null,
                ts: new Date().toISOString(),
              },
              'deal_summary_debug'
            );

            // Do not leak debug payload to clients.
            try {
              delete (dealSummaryV1 as any).debug;
            } catch {
              // ignore
            }
          }
        } catch (err) {
          logStage('compile.deal_summary_v1', 0, false, { error: err instanceof Error ? err.message : String(err ?? 'unknown_error') });
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
        // Prefer a canonical persisted report if present — but only when it was compiled
        // by the current compiler version (older entries lack __compiler_version and are recompiled).
        try {
          const persisted = row && row.dio_data && typeof row.dio_data === 'object' ? (row.dio_data as any).report : null;
          if (
            persisted &&
            typeof persisted === 'object' &&
            (persisted as any).__compiler_version === REPORT_COMPILER_VERSION
          ) {
            report = persisted;
            logStage('compile.report.persisted', 0, true, { source: 'dio_data.report' });
          }
        } catch {
          // ignore
        }

        let promotedFacts: any[] = [];
        try {
          if (!report) {
            const pf = await timer.stage('db.promoted_facts', async () => loadPromotedFactsForDeal(pool as any, deal_id));
            logStage('db.promoted_facts', pf.ms, true);
            promotedFacts = pf.value;

      // Deterministic fallback: if evidence_items did not get populated yet, derive
      // promoted-like facts directly from document_page_understanding payloads.
      // This keeps /report structured_summary accurate with page-level citations.
      const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
      const hasRaise = promotedFacts.some((r: any) => {
        if (factTypeOf(r) !== 'raise_terms_v1') return false;
        // Per-share prices (e.g. $1.092) are stored as raise_terms_v1 by some extractors but are
        // NOT valid capital raise amounts. Only count raise facts with amount ≥ $1,000 so that
        // a sub-dollar per-share artifact does not block the DPU fallback from finding the actual raise.
        const amount = r?.content_json?.value_json?.amount?.amount ?? null;
        return amount == null || (typeof amount === 'number' && amount >= 1000);
      });
      const hasModel = promotedFacts.some((r: any) => factTypeOf(r) === 'business_model_v1');
      const hasKpi = promotedFacts.some((r: any) => {
        const ft = factTypeOf(r);
        return ft === 'revenue_v1' || ft === 'customers_v1' || ft === 'growth_v1' || ft === 'growth_outlook_v1';
      });

      // If any of the key structured_summary items are missing, derive them deterministically
      // from document_page_understanding and attach as promotedFacts inputs.
      if (!hasRaise || !hasModel || !hasKpi) {
        // Safety gate: do not rely on DPU-derived facts when DPU looks older than the DIO itself.
        // This prevents stale fallbacks from "winning" after reruns where DPU did not refresh.
        if (dpuStaleVsDio) {
          request.log.warn(
            {
              event: 'deal.report.promoted_facts_dpu_fallback_skipped',
              deal_id,
              dio_id: row.dio_id,
              dio_updated_at: row.updated_at ?? null,
              latest_dpu_created_at: latestDpuCreatedAt,
              reason: 'dpu_stale_vs_dio',
            },
            'Skipping DPU-derived promoted fact fallback due to stale DPU'
          );
        } else {
          const derivedStage = await timer.stage('db.promoted_facts_derived_from_dpu', async () => derivePromotedFactsFromDpuForDeal(pool as any, deal_id));
          logStage('db.promoted_facts_derived_from_dpu', derivedStage.ms, true);
          const derived = derivedStage.value;
          const existingEvidenceIds = new Set(promotedFacts.map((r: any) => String(r?.evidence_id ?? '')).filter(Boolean));
          for (const r of derived) {
            const evidenceId = String((r as any)?.evidence_id ?? '');
            if (evidenceId && existingEvidenceIds.has(evidenceId)) continue;

            const ft = factTypeOf(r);
            if (ft === 'raise_terms_v1' && hasRaise) continue;
            promotedFacts.push(r as any);
            if (evidenceId) existingEvidenceIds.add(evidenceId);
          }
        }
      }

            const compiled = await timer.stage('compile.report', async () => {
              const financialFacts = await getFinancialFactsForReport(pool as any, deal_id);
              const documents = await getDocumentsForReport(pool as any, deal_id);
              return compileDIOToReportWithPromotedFacts(row.dio_data, { promotedFacts, financialFacts, documents });
            });
            logStage('compile.report', compiled.ms, true);
            report = compiled.value;
          }

          // TEMP DEBUG: trace where structured_summary.business_model is sourced from.
          // Enable by passing ?debug_business_model=1 on /report requests.
          try {
            const q = (request.query ?? {}) as any;
            const dbg = String(q?.debug_business_model ?? '').trim().toLowerCase();
            const debugBusinessModel = dbg === '1' || dbg === 'true' || dbg === 'yes' || dbg === 'on';
            if (debugBusinessModel && report && typeof report === 'object') {
              const bm = (report as any)?.structured_summary?.business_model ?? null;
              const bmValue = typeof bm?.value === 'string' ? bm.value : null;
              const bmSources = Array.isArray(bm?.sources) ? bm.sources : [];
              const kinds = bmSources.map((s: any) => String(s?.kind ?? '')).filter(Boolean);
              const evidenceIds = bmSources.map((s: any) => s?.evidence_id ?? null).filter((x: any) => typeof x === 'string' && x.trim());

              const phase1 = (row as any)?.dio_data?.dio?.phase1;
              const overviewModel = phase1?.deal_overview_v2?.business_model ?? null;
              const overviewSourcesCount = Array.isArray(phase1?.deal_overview_v2?.sources) ? phase1.deal_overview_v2.sources.length : 0;
              const execModel = phase1?.executive_summary_v1?.business_model ?? null;
              const arbitrationModel = phase1?.business_model_arbitration_v1?.business_model ?? null;

              const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
              const promotedModels = Array.isArray(promotedFacts)
                ? promotedFacts
                    .filter((r: any) => factTypeOf(r) === 'business_model_v1')
                    .map((r: any) => ({
                      evidence_id: r?.evidence_id ?? null,
                      extracted_at: r?.extracted_at ?? null,
                      confidence: r?.confidence ?? null,
                      source_path: r?.source_path ?? null,
                      run_id: r?.meta?.run_id ?? r?.meta?.runId ?? null,
                    }))
                : [];

              request.log.info(
                {
                  event: 'deal.report.business_model_debug',
                  deal_id,
                  dio_id: row.dio_id,
                  dio_updated_at: row.updated_at ?? null,
                  dio_meta_min_dpu_created_at: (() => {
                    const dioData = row && (row as any).dio_data && typeof (row as any).dio_data === 'object' ? (row as any).dio_data : null;
                    const meta = dioData && typeof dioData === 'object' ? (dioData as any).meta : null;
                    const raw = meta && typeof meta === 'object' ? (meta as any).min_dpu_created_at : null;
                    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
                  })(),
                  latest_dpu_created_at: latestDpuCreatedAt ?? null,
                  dpu_stale_vs_dio: dpuStaleVsDio,
                  selected: {
                    value: bmValue,
                    source_kinds: kinds.slice(0, 6),
                    evidence_ids: evidenceIds.slice(0, 6),
                  },
                  dio_phase1: {
                    deal_overview_v2_business_model: overviewModel,
                    deal_overview_v2_sources_count: overviewSourcesCount,
                    executive_summary_v1_business_model: execModel,
                    business_model_arbitration_v1_business_model: arbitrationModel,
                  },
                  promoted_fact_candidates: {
                    business_model_v1: promotedModels,
                  },
                  ts: new Date().toISOString(),
                },
                'business_model_debug'
              );
            }
          } catch {
            // never fail /report for debug logging
          }

          // Deterministic structured_summary additions (no LLM): market/product/gtm/deal summaries.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && segmentedNodes?.nodes) {
              const extras = compileStructuredSummaryExtras({ nodes: segmentedNodes.nodes as any, structured_summary: (report as any).structured_summary });
              Object.assign((report as any).structured_summary, extras);
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.structured_summary_extras_failed', deal_id, dio_id: row.dio_id, err }, 'structured_summary extras compilation failed');
          }

          // Back-compat display overrides:
          // - Prefer promoted fact display strings for raise + business_model (when present)
          // - Fall back to Phase1 executive_summary strings when promoted facts are missing
          // - IMPORTANT: do NOT override valuation-structured raises (they are intentionally normalized to amount-only)
          // - IMPORTANT: do NOT override facts that were rejected by field_authority_guard — the
          //   guard's decision takes precedence over the raw promoted-fact display string.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && typeof (report as any).structured_summary === 'object') {
              const structured = (report as any).structured_summary as any;

              // Build set of fact_types that were explicitly rejected by the field_authority_guard.
              // Rejected facts must NOT be used to override the compiler's guarded output.
              const _guardLog = Array.isArray((report as any)?.metadata?.field_authority_guard?.log)
                ? (report as any).metadata.field_authority_guard.log : [];
              const _guardRejectedTypes = new Set<string>(
                _guardLog.filter((e: any) => e?.action === 'reject').map((e: any) => String(e?.fact_type ?? ''))
              );

              const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
              const pickBestFact = (factType: string): any | null => {
                const rows = Array.isArray(promotedFacts) ? promotedFacts : [];
                const cands = rows.filter((r: any) => factTypeOf(r) === factType);
                if (cands.length === 0) return null;
                return (
                  cands
                    .slice()
                    .sort((a: any, b: any) => {
                      const ca = typeof a?.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0;
                      const cb = typeof b?.confidence === 'number' && Number.isFinite(b.confidence) ? b.confidence : 0;
                      if (cb !== ca) return cb - ca;
                      return String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? ''));
                    })[0] ?? null
                );
              };

              const execPhase1 = (row as any)?.dio_data?.dio?.phase1 ?? null;
              const execRaiseRaw = execPhase1?.executive_summary_v1?.raise;
              const execRaise = typeof execRaiseRaw === 'string' && execRaiseRaw.trim() && execRaiseRaw.trim().toLowerCase() !== 'unknown' ? execRaiseRaw.trim() : null;

              const execModelRaw = execPhase1?.executive_summary_v1?.business_model;
              const execModel = typeof execModelRaw === 'string' && execModelRaw.trim() ? execModelRaw.trim() : null;

              const raiseFact = pickBestFact('raise_terms_v1');
              const raiseValueJson = raiseFact?.content_json?.value_json ?? raiseFact?.content_json?.valueJson ?? null;
              const raiseDisplay = typeof raiseValueJson?.display === 'string' && raiseValueJson.display.trim() ? raiseValueJson.display.trim() : null;
              const raiseHasStructuredValuation = Boolean(raiseValueJson && typeof raiseValueJson === 'object' && (raiseValueJson as any).valuation && typeof (raiseValueJson as any).valuation === 'object');

              let nextRaiseValue: string | null = null;
              if (raiseFact && !_guardRejectedTypes.has('raise_terms_v1')) {
                if (!raiseHasStructuredValuation && raiseDisplay) nextRaiseValue = raiseDisplay;
              } else if (!raiseFact && execRaise) {
                nextRaiseValue = execRaise;
              }

              if (nextRaiseValue) {
                if (!structured.raise || typeof structured.raise !== 'object') structured.raise = {};
                structured.raise.value = nextRaiseValue;
              }

              const modelFact = pickBestFact('business_model_v1');
              const modelValueJson = modelFact?.content_json?.value_json ?? modelFact?.content_json?.valueJson ?? null;
              const modelDisplay = typeof modelValueJson?.display === 'string' && modelValueJson.display.trim() ? modelValueJson.display.trim() : null;

              const nextBusinessModelValue = (modelFact && !_guardRejectedTypes.has('business_model_v1'))
                ? modelDisplay
                : (!modelFact ? execModel : null);
              // Only apply back-compat override when the compiler (guard+selector pipeline) did not
              // already set a BM value. If the selector picked a winner, trust it.
              if (nextBusinessModelValue && !structured.business_model?.value) {
                if (!structured.business_model || typeof structured.business_model !== 'object') structured.business_model = {};
                structured.business_model.value = nextBusinessModelValue;
              }
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.display_overrides_failed', deal_id, dio_id: row.dio_id, err }, 'display override patch failed');
          }

          // Deterministic deal_summary_v1: KPI-locked synthesis from structured_summary.
          // Goal: provide stable hero/overview/deep and citations without overlay drift.
          try {
            if (report && typeof report === 'object' && (report as any).structured_summary && typeof (report as any).structured_summary === 'object') {
              applyStructuredNumericTrustGates(report);
              const det = buildDeterministicDealSummaryV1FromStructuredSummary({
                structured_summary: (report as any).structured_summary,
              });
              (report as any).structured_summary.deal_summary_v1 = det;
              // Back-compat: keep the older top-level location too.
              (report as any).deal_summary_v1 = det;
            }
          } catch (err) {
            request.log.warn({ event: 'deal.report.deal_summary_v1_failed', deal_id, dio_id: row.dio_id, err }, 'deal_summary_v1 synthesis failed');
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
        // narrateEnabled computed above for cache gating

        const llmContext = {
          deal_id,
          dio_id: String(row.dio_id ?? ''),
          llm_phase_mode: typeof llm_phase_mode === 'string' && llm_phase_mode.trim() ? llm_phase_mode.trim() : null,
          request_id: requestId,
        };

        let reportExcerpt: any = undefined;
        let excerptHash: string | undefined = undefined;
        if (narrateEnabled && report && typeof report === 'object') {
          try {
            // Ensure excerpt contains the stable deterministic KPI shapes required by the narration guard.
            // These are deterministic, shape-only normalizations and must not change underlying extracted values.
            applyStructuredNumericTrustGates(report);
            ensureStructuredRevenueSelectionReason(report);
            ensureStructuredSummaryKpis(report);
            // Ensure excerpt sees the deterministic deal_summary_v1 subtree as well.
            (report as any).deal_summary = dealSummaryV1;

            const ex = await timer.stage('llm.build_excerpt', async () => {
              const e = buildAllowlistedNarrationExcerpt(report, { promoted_facts: promotedFactsForExcerpt ?? undefined });
              return e;
            });
            logStage('llm.build_excerpt', ex.ms, true);
            reportExcerpt = ex.value;

            const hashStage = await timer.stage('llm.excerpt_hash', async () => stableHash(JSON.stringify(reportExcerpt ?? null)));
            logStage('llm.excerpt_hash', hashStage.ms, true);
            excerptHash = hashStage.value;
          } catch (err) {
            logStage('llm.build_excerpt', 0, false, { error: err instanceof Error ? err.message : String(err ?? 'unknown_error') });
            reportExcerpt = undefined;
            excerptHash = undefined;
          }
        }

        if (report && typeof report === 'object') {
          applyStructuredNumericTrustGates(report);
          ensureStructuredRevenueSelectionReason(report);
          ensureStructuredSummaryKpis(report);
          // Keep deal_summary nested under the compiled report as well.
          (report as any).deal_summary = dealSummaryV1;

          // Deterministic Investment Analysis Overview v2 (no LLM): derived from persisted DIO + deterministic report metadata.
          try {
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            const iaoV2 = buildInvestmentAnalysisOverviewV2({
              dio: row.dio_data as any,
              report,
            });
            (nextMetadata as any).investment_analysis_overview_v2 = iaoV2;
            // Also hoist to top-level on report so the canonical DataFlow path
            // (report.investment_analysis_overview_v2.summary) resolves correctly.
            (report as any).investment_analysis_overview_v2 = iaoV2;
            (payload as any).metadata = nextMetadata;
            (report as any).metadata = nextMetadata;
          } catch {
            // ignore
          }

          // Optional LLM narration: additive only; never alters deterministic fields.
          try {
            const nextMetadata = { ...((report as any)?.metadata ?? (payload as any)?.metadata ?? {}) };
            const narr = await timer.stage('llm.narration_v1', async () =>
              maybeAttachNarrationV1({
                request,
                report,
                nextMetadata,
                narrateEnabled,
                promotedFactsForExcerpt: promotedFactsForExcerpt ?? undefined,
                timer,
                reportExcerpt,
                excerptHash,
                llmContext,
              })
            );
            logStage('llm.narration_v1', narr.ms, true);
            (payload as any).metadata = (report as any).metadata;

			// Optional LLM overview: additive only; never alters deterministic fields.
			try {
        const ov = await timer.stage('llm.overview_v1', async () =>
          maybeAttachOverviewV1({
            request,
            report,
            nextMetadata,
            narrateEnabled,
            promotedFactsForExcerpt: promotedFactsForExcerpt ?? undefined,
            timer,
            reportExcerpt,
            excerptHash,
            llmContext,
          })
        );
        logStage('llm.overview_v1', ov.ms, true);
				(payload as any).metadata = (report as any).metadata;
			} catch {
				// ignore
			}

      // Optional Investment Analysis Overview reasoning: additive only; never alters deterministic fields.
      try {
        const ia = await timer.stage('llm.investment_analysis_overview_v1', async () =>
          maybeAttachInvestmentAnalysisOverviewV1({
            request,
            report,
            nextMetadata,
            narrateEnabled,
            promotedFactsForExcerpt: promotedFactsForExcerpt ?? undefined,
            timer,
            reportExcerpt,
            excerptHash,
            llmContext,
          })
        );
        logStage('llm.investment_analysis_overview_v1', ia.ms, true);
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

        const summary = timer.summary();
        request.log.info(
          {
            event: 'REPORT_TIMING_SUMMARY',
            request_id: requestId,
            deal_id,
            dio_id: String(row?.dio_id ?? ''),
            llm_phase_mode: typeof llm_phase_mode === 'string' ? llm_phase_mode : null,
            total_ms: summary.total_ms,
            stage_ms: summary.stage_ms,
            ts: new Date().toISOString(),
          },
          'REPORT_TIMING_SUMMARY'
        );

        // Persist a canonical deterministic response snapshot for idempotency.
        if (!narrateEnabled && typeof version === 'number' && Number.isFinite(version) && version >= 1) {
          const up = await timer.stage('db.ingestion_reports.upsert', async () =>
            upsertIngestionReportSummaryByDealAndVersion({ pool, dealId: deal_id, analysisVersion: version, summary: payload, documentIds: [] })
          );
          logStage('db.ingestion_reports.upsert', up.ms, true, { cache: 'miss', ok: Boolean(up.value) });
        }

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

        const narrateEnabled = envFlagEnabled((request.query as any)?.narrate);
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
        let dioRows: Array<{
          dio_id: string;
          analysis_version: number | null;
          recommendation: string | null;
          overall_score: number | null;
          dio_data: any;
          updated_at: string | null;
        }> = [];
        try {
          const r = await pool.query<{
            dio_id: string;
            analysis_version: number | null;
            recommendation: string | null;
            overall_score: number | null;
            dio_data: any;
            updated_at: string | null;
          }>(
            `SELECT dio_id, analysis_version, recommendation, overall_score, dio_data, updated_at
               FROM deal_intelligence_objects
              WHERE deal_id = $1 AND analysis_version = $2
              ORDER BY updated_at DESC NULLS LAST,
                       dio_id DESC
              LIMIT 1`,
            [deal_id, versionNum]
          );
          dioRows = r.rows ?? [];
        } catch (err) {
          if (isMissingRelation(err, 'deal_intelligence_objects')) {
            return reply.status(200).send({
              ready: false,
              reason: 'db_missing_table',
              missing_table: 'deal_intelligence_objects',
            });
          }
          throw err;
        }

        if (dioRows.length === 0) {
          // Versioned endpoint should fail-open like /report (no 404 for normal pre-analysis/in-progress states).
          return reply.status(200).send({ ready: false, reason: 'not_generated_yet', version: versionNum });
        }

        const row = dioRows[0];
        const artifact = {
          kind: 'deal_intelligence_object',
          dio_id: row.dio_id,
          analysis_version: row.analysis_version,
          updated_at: row.updated_at,
          recommendation: row.recommendation,
          overall_score: row.overall_score,
        };

        // Idempotent report cache (non-narrated only): ingestion_reports keyed by (deal_id, analysis_version).
        if (!narrateEnabled && Number.isFinite(versionNum) && versionNum >= 1) {
          const cached = await readIngestionReportSummaryByDealAndVersion(pool, deal_id, versionNum);
          if (cached && typeof cached === 'object') {
            await upsertIngestionReportSummaryByDealAndVersion({ pool, dealId: deal_id, analysisVersion: versionNum, summary: cached, documentIds: [] });
            // Best-effort: inject live staleness flag. Never persisted — always computed fresh on cache-hit.
            // Uses DIO.updated_at (from row) as freshness anchor — the artifact analyze_deal actually refreshes.
            let financial_snapshot_stale = false;
            let _stale_max_fact_ts: string | null = null;
            let _stale_report_ts = '';
            let _stale_freshness_basis = 'none';
            try {
              const _sr = await computeReportFinancialSnapshotStale(pool, deal_id, versionNum, { dioUpdatedAt: row.updated_at });
              financial_snapshot_stale = _sr.stale;
              _stale_max_fact_ts = _sr.max_fact_ts;
              _stale_report_ts = _sr.report_ts;
              _stale_freshness_basis = _sr.freshness_basis;
            } catch { /* fail-open */ }
            // Inject investment_analysis_overview_v2 fresh on cache-hit — never persisted.
            try {
              const freshIaoV2 = buildInvestmentAnalysisOverviewV2({
                dio: row.dio_data as any,
                report: cached,
              });
              (cached as any).investment_analysis_overview_v2 = freshIaoV2;
              const meta = { ...((cached as any).metadata && typeof (cached as any).metadata === 'object' ? (cached as any).metadata : {}) };
              meta.investment_analysis_overview_v2 = freshIaoV2;
              (cached as any).metadata = meta;
              if ((cached as any).report && typeof (cached as any).report === 'object') {
                (cached as any).report = { ...(cached as any).report, investment_analysis_overview_v2: freshIaoV2 };
              }
            } catch { /* fail-open */ }
            // Lazy recompile: when financial_facts_v1 are newer than the DIO's updated_at, trigger a
            // fresh analyze_deal job in the background. Idempotent via dedupe — never blocks response.
            if (financial_snapshot_stale) {
              // Fingerprint guard: skip if a recent analyze_deal job for this deal was already created
              // AFTER the stale watermark. Prevents re-enqueueing when a completed job already covers
              // the same facts — the complement to the running/queued dedupe.
              let fingerprintBlocked = false;
              if (_stale_max_fact_ts) {
                try {
                  const fpCheck = await pool.query(
                    `SELECT 1 FROM jobs
                      WHERE deal_id = $1
                        AND type = 'analyze_deal'
                        AND created_at > $2::timestamptz
                        AND created_at >= (now() - interval '60 minutes')
                      LIMIT 1`,
                    [deal_id, _stale_max_fact_ts],
                  );
                  if ((fpCheck.rowCount ?? 0) > 0) {
                    fingerprintBlocked = true;
                    request.log.info(
                      {
                        event: 'STALE_REQUEUE_SKIPPED_FINGERPRINT',
                        deal_id,
                        analysis_version: versionNum,
                        max_fact_ts: _stale_max_fact_ts,
                        freshness_basis: _stale_freshness_basis,
                        reason: 'recent_analyze_deal_covers_watermark',
                      },
                      'stale requeue skipped: recent analyze_deal already covers stale watermark',
                    );
                  }
                } catch { /* fail-open: don't block on fingerprint check */ }
              }
              if (!fingerprintBlocked) {
                request.log.info(
                  {
                    event: 'STALE_REQUEUE_TRIGGERED',
                    deal_id,
                    analysis_version: versionNum,
                    max_fact_ts: _stale_max_fact_ts,
                    freshness_basis: _stale_freshness_basis,
                    freshness_anchor_ts: _stale_report_ts,
                    reason: 'financial_snapshot_stale',
                    dedupe_key: `analyze_deal:deal:${deal_id}`,
                    stale_facts_watermark: _stale_max_fact_ts,
                  },
                  'lazy recompile enqueued: financial snapshot stale',
                );
                void enqueueJob(
                  { deal_id: deal_id, type: 'analyze_deal', payload: { reason: 'financial_snapshot_stale', stale_facts_watermark: _stale_max_fact_ts } },
                  { dedupe: { by: 'deal' } },
                ).catch(() => { /* fail-open: never break /report for a recompile trigger */ });
              }
            } else if (_stale_max_fact_ts) {
              request.log.debug(
                {
                  event: 'STALE_NOT_TRIGGERED',
                  deal_id,
                  analysis_version: versionNum,
                  max_fact_ts: _stale_max_fact_ts,
                  freshness_basis: _stale_freshness_basis,
                  freshness_anchor_ts: _stale_report_ts,
                },
                'financial snapshot not stale: DIO covers current facts',
              );
            }
            return reply.status(200).send({ ...cached, financial_snapshot_stale });
          }
        }

        // Best-effort: prefetch segmented nodes for deterministic structured_summary additions.
        let segmentedNodes: { nodes: any[]; warnings: string[] } | null = null;
        try {
          segmentedNodes = await getSegmentedNodesForDeal(pool as any, deal_id);
        } catch (err) {
          request.log.warn(
            { event: 'deal.report.version.segmented_nodes_failed', deal_id, version: versionNum, err },
            'segmented nodes lookup failed (versioned)'
          );
          segmentedNodes = null;
        }

        // Compile DIO into ReportDTO
        let report: any = null;
        // Prefer persisted canonical report if present — but only when it was compiled
        // by the current compiler version (older entries lack __compiler_version and are recompiled).
        try {
          const persisted = row && row.dio_data && typeof row.dio_data === 'object' ? (row.dio_data as any).report : null;
          if (
            persisted &&
            typeof persisted === 'object' &&
            (persisted as any).__compiler_version === REPORT_COMPILER_VERSION
          ) {
            report = persisted;
          }
        } catch {
          // ignore
        }

        let promotedFacts: any[] = [];
        if (!report) {
          try {
            promotedFacts = await loadPromotedFactsForDeal(pool as any, deal_id);
          } catch {
            promotedFacts = [];
          }
          const financialFacts = await getFinancialFactsForReport(pool as any, deal_id);
          const documents = await getDocumentsForReport(pool as any, deal_id);
          report = compileDIOToReportWithPromotedFacts(row.dio_data, { promotedFacts, financialFacts, documents });
        }

        // Backward compatibility: normalize structured KPI shape (order matters).
        applyStructuredNumericTrustGates(report);
        ensureStructuredRevenueSelectionReason(report);
        ensureStructuredSummaryKpis(report);

        // Deterministic structured_summary additions (node-derived): deal/product/market summaries.
        try {
          if (report && typeof report === 'object' && (report as any).structured_summary && Array.isArray(segmentedNodes?.nodes)) {
            const extras = compileStructuredSummaryExtras({
              nodes: segmentedNodes!.nodes as any,
              structured_summary: (report as any).structured_summary,
            });
            Object.assign((report as any).structured_summary, extras);
          }
        } catch (err) {
          request.log.warn(
            { event: 'deal.report.version.structured_summary_extras_failed', deal_id, version: versionNum, err },
            'structured_summary extras compilation failed (versioned)'
          );
        }

        // Deterministic deal_summary_v1: KPI-locked synthesis from structured_summary.
        try {
          if (report && typeof report === 'object' && (report as any).structured_summary && typeof (report as any).structured_summary === 'object') {
            // Back-compat display overrides:
            // - Prefer promoted fact display strings for raise + business_model (when present)
            // - Fall back to Phase1 executive_summary strings when promoted facts are missing
            // - IMPORTANT: do NOT override valuation-structured raises (they are intentionally normalized to amount-only)
            // - IMPORTANT: do NOT override facts that were rejected by field_authority_guard.
            try {
              const structured = (report as any).structured_summary as any;

              // Respect field_authority_guard decisions — rejected fact types must not re-enter via override.
              const _guardLog2 = Array.isArray((report as any)?.metadata?.field_authority_guard?.log)
                ? (report as any).metadata.field_authority_guard.log : [];
              const _guardRejectedTypes2 = new Set<string>(
                _guardLog2.filter((e: any) => e?.action === 'reject').map((e: any) => String(e?.fact_type ?? ''))
              );

              const factTypeOf = (r: any): string => String(r?.content_json?.fact_type ?? r?.fact_type ?? '').trim();
              const pickBestFact = (factType: string): any | null => {
                const rows = Array.isArray(promotedFacts) ? promotedFacts : [];
                const cands = rows.filter((r: any) => factTypeOf(r) === factType);
                if (cands.length === 0) return null;
                return (
                  cands
                    .slice()
                    .sort((a: any, b: any) => {
                      const ca = typeof a?.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0;
                      const cb = typeof b?.confidence === 'number' && Number.isFinite(b.confidence) ? b.confidence : 0;
                      if (cb !== ca) return cb - ca;
                      return String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? ''));
                    })[0] ?? null
                );
              };

              const execPhase1 = (row as any)?.dio_data?.dio?.phase1 ?? null;
              const execRaiseRaw = execPhase1?.executive_summary_v1?.raise;
              const execRaise = typeof execRaiseRaw === 'string' && execRaiseRaw.trim() && execRaiseRaw.trim().toLowerCase() !== 'unknown' ? execRaiseRaw.trim() : null;

              const execModelRaw = execPhase1?.executive_summary_v1?.business_model;
              const execModel = typeof execModelRaw === 'string' && execModelRaw.trim() ? execModelRaw.trim() : null;

              const raiseFact = pickBestFact('raise_terms_v1');
              const raiseValueJson = raiseFact?.content_json?.value_json ?? raiseFact?.content_json?.valueJson ?? null;
              const raiseDisplay = typeof raiseValueJson?.display === 'string' && raiseValueJson.display.trim() ? raiseValueJson.display.trim() : null;
              const raiseHasStructuredValuation = Boolean(raiseValueJson && typeof raiseValueJson === 'object' && (raiseValueJson as any).valuation && typeof (raiseValueJson as any).valuation === 'object');

              let nextRaiseValue: string | null = null;
              if (raiseFact && !_guardRejectedTypes2.has('raise_terms_v1')) {
                if (!raiseHasStructuredValuation && raiseDisplay) nextRaiseValue = raiseDisplay;
              } else if (!raiseFact && execRaise) {
                nextRaiseValue = execRaise;
              }

              if (nextRaiseValue) {
                if (!structured.raise || typeof structured.raise !== 'object') structured.raise = {};
                structured.raise.value = nextRaiseValue;
              }

              const modelFact = pickBestFact('business_model_v1');
              const modelValueJson = modelFact?.content_json?.value_json ?? modelFact?.content_json?.valueJson ?? null;
              const modelDisplay = typeof modelValueJson?.display === 'string' && modelValueJson.display.trim() ? modelValueJson.display.trim() : null;

              const nextBusinessModelValue = (modelFact && !_guardRejectedTypes2.has('business_model_v1'))
                ? modelDisplay
                : (!modelFact ? execModel : null);
              // Only apply back-compat override when the compiler (guard+selector pipeline) did not
              // already set a BM value. If the selector picked a winner, trust it.
              if (nextBusinessModelValue && !structured.business_model?.value) {
                if (!structured.business_model || typeof structured.business_model !== 'object') structured.business_model = {};
                structured.business_model.value = nextBusinessModelValue;
              }
            } catch {
              // ignore
            }

            applyStructuredNumericTrustGates(report);

            const det = buildDeterministicDealSummaryV1FromStructuredSummary({
              structured_summary: (report as any).structured_summary,
            });
            (report as any).structured_summary.deal_summary_v1 = det;
            // Back-compat: keep the older top-level location too.
            (report as any).deal_summary_v1 = det;
          }
        } catch (err) {
          request.log.warn(
            { event: 'deal.report.version.deal_summary_v1_failed', deal_id, version: versionNum, err },
            'deal_summary_v1 synthesis failed (versioned)'
          );
        }

        // narrateEnabled computed above for cache gating

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
				input_documents: Array.isArray((row as any)?.dio_data?.inputs?.documents)
					? (((row as any).dio_data.inputs.documents as any[]) ?? [])
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

        // Deterministic Investment Analysis Overview v2 (no LLM): derived from persisted DIO + deterministic report metadata.
        try {
          const nextMetadata = { ...((report as any)?.metadata ?? {}) };
          const iaoV2 = buildInvestmentAnalysisOverviewV2({
            dio: row.dio_data as any,
            report,
          });
          (nextMetadata as any).investment_analysis_overview_v2 = iaoV2;
          // Also hoist to top-level on report so the canonical DataFlow path
          // (report.investment_analysis_overview_v2.summary) resolves correctly.
          (report as any).investment_analysis_overview_v2 = iaoV2;
          (report as any).metadata = nextMetadata;
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

        const payload: any = { ready: true, version: versionNum, artifact };
        payload.report = report;
        // Spread the report into the response for compatibility with older consumers.
        Object.assign(payload, report);

        if (!narrateEnabled && Number.isFinite(versionNum) && versionNum >= 1) {
          await upsertIngestionReportSummaryByDealAndVersion({ pool, dealId: deal_id, analysisVersion: versionNum, summary: payload, documentIds: [] });
        }

        // Best-effort: inject live staleness flag AFTER upsert (so ingestion_reports row exists).
        // Fresh compiles load current facts → expected false; detects edge cases where facts arrived mid-compile.
        try { payload.financial_snapshot_stale = (await computeReportFinancialSnapshotStale(pool, deal_id, versionNum, { dioUpdatedAt: row.updated_at })).stale; } catch { payload.financial_snapshot_stale = false; }

        return reply.status(200).send(payload);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate versioned report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  /**
   * POST /api/v1/deals/:deal_id/recompute-financials
   *
   * Manually trigger a fresh analyze_deal job to recompile financial data.
   * Idempotent: returns the existing active job if one is already queued or running
   * (deduped by deal within a 30-minute window).
   *
   * Returns 202 Accepted with { ok, job_id, status }.
   */
  app.post<{ Params: ReportParams }>(
    '/api/v1/deals/:deal_id/recompute-financials',
    async (request: FastifyRequest<{ Params: ReportParams }>, reply: FastifyReply) => {
      const { deal_id } = request.params;
      if (!isUuid(deal_id)) {
        return reply.status(400).send({ ok: false, error: 'invalid_deal_id' });
      }
      const dealRow = await pool.query(
        `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
        [deal_id],
      );
      if (dealRow.rows.length === 0) {
        return reply.status(404).send({ ok: false, error: 'deal_not_found' });
      }
      try {
        const result = await enqueueJob(
          { deal_id, type: 'analyze_deal', payload: { reason: 'manual_recompute_financials' } },
          { dedupe: { by: 'deal' } },
        );
        return reply.status(202).send({ ok: true, job_id: result.job_id, status: result.status });
      } catch (err) {
        request.log.error({ event: 'recompute_financials.enqueue_failed', deal_id, err }, 'Failed to enqueue recompute-financials job');
        return reply.status(500).send({ ok: false, error: 'enqueue_failed' });
      }
    },
  );
}
