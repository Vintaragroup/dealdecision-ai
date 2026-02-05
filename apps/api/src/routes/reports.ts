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
import { z } from 'zod';
import { compileDIOToReport, compileDIOToReportWithPromotedFacts } from '@dealdecision/core';
import { loadPromotedFactsForDeal } from '../lib/promoted-facts';
import { derivePromotedFactsFromDpuForDeal } from '../lib/promoted-facts-from-dpu';
import { compileDealSummaryV1 } from '../lib/deal-summary-v1';
import { getSegmentedNodesForDeal } from '../lib/segmented-nodes-for-deal';
import { inferDeckArchetypeV1 } from '../lib/deck-archetypes';
import { compileStructuredSummaryExtras } from '../lib/structured-summary-extras';
import { buildBusinessModelSummaryV1 } from '../lib/reports/business-model-summary';
import { computeArchetypeSegmentDriftV1 } from '../lib/archetype-segment-drift-v1';
import { computeOverrideQualityV1 } from '../lib/override-quality-v1';

const isUuid = (value: unknown): value is string => z.string().uuid().safeParse(value).success;

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
            (payload as any).metadata = nextMetadata;
            if (report && typeof report === 'object') (report as any).metadata = nextMetadata;
          }
        } catch (err) {
          request.log.warn({ event: 'deal.report.deck_archetype_failed', deal_id, dio_id: row.dio_id, err }, 'deck_archetype_v1 inference failed');
        }

        if (Array.isArray(promotedFacts) && promotedFacts.length > 0) {
          payload.promoted_facts = promotedFacts.map((r: any) => ({
            fact_type: r?.content_json?.fact_type ?? r?.fact_type ?? null,
            value_json: r?.content_json?.value_json ?? null,
            confidence: r?.confidence ?? null,
            source_path: r?.source_path ?? null,
            evidence_id: r?.evidence_id ?? null,
            extracted_at: r?.extracted_at ?? null,
          }));
        }
        if (report && typeof report === 'object') {
          // Keep deal_summary nested under the compiled report as well.
          (report as any).deal_summary = dealSummaryV1;
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
            (report as any).metadata = nextMetadata;
          }
        } catch (err) {
          request.log.warn({ event: 'deal.report.version.deck_archetype_failed', deal_id, version: versionNum, err }, 'deck_archetype_v1 inference failed (versioned)');
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
