/**
 * Analysis Routes
 * /api/v1/analysis - HRM-DD analysis endpoints
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  initializeAnalysis,
  loadAnalysisState,
  generateAnalysisSummary,
  saveAnalysisState,
  shouldProgressCycle,
  validateAnalysisPrerequisites,
  logAnalysisEvent,
} from "../services/analysis";
import type { AnalysisRequest, AnalysisProgress, AnalysisResult } from "@dealdecision/contracts";
import { ensureDocumentsReadyForAnalysis } from "../lib/ensure-documents-ready-for-analysis";
import { enqueueJob as realEnqueueJob } from "../services/jobs";

/**
 * Register analysis routes
 */
export async function registerAnalysisRoutes(
  app: FastifyInstance,
  pool: Pool = getPool(),
  enqueueJob: typeof realEnqueueJob = realEnqueueJob
) {
  /**
   * POST /api/v1/analysis/start
   * Start analysis for a deal
   */
  app.post<{ Body: AnalysisRequest }>(
    "/api/v1/analysis/start",
    async (request, reply) => {
      const { deal_id, max_cycles = 3, analysis_mode = "full" } = request.body;

      // Validate
      if (!deal_id) {
        reply.status(400).send({ error: "deal_id is required" });
        return;
      }

      try {
        // Check deal exists and has documents
        const { rows: dealRows } = await pool.query(
          `SELECT id, stage FROM deals WHERE id = $1 AND deleted_at IS NULL`,
          [deal_id]
        );

        if (!dealRows.length) {
          reply.status(404).send({ error: "Deal not found" });
          return;
        }

        const deal = dealRows[0];

        // Check documents
        const { rows: docRows } = await pool.query(
          `SELECT COUNT(*) as count FROM documents WHERE deal_id = $1`,
          [deal_id]
        );
        const documentCount = parseInt(docRows[0].count || 0, 10);

        // Check has pitch deck
        const { rows: deckRows } = await pool.query(
          `SELECT COUNT(*) as count FROM documents WHERE deal_id = $1 AND type IN ('pitch_deck', 'other')`,
          [deal_id]
        );
        const hasDeck = parseInt(deckRows[0].count || 0, 10) > 0;

        // Validate prerequisites
        const validation = validateAnalysisPrerequisites(deal_id, documentCount, hasDeck);
        if (!validation.valid) {
          reply.status(400).send({ error: validation.errors.join("; ") });
          return;
        }

        // ── Gate 1: DPU preflight ───────────────────────────────────────────
        // Verify DPU readiness before enqueueing analysis. When DPU is missing,
        // stale, or partially covered, auto-enqueue DPU backfill and return 202
        // { status: "preparing_documents" } so the UI can poll instead of
        // proceeding to an analysis cycle that will fail the DPU gate.
        //
        // Fail-open: if this preflight throws (e.g. pool unavailable in tests),
        // proceed rather than blocking the user.
        try {
          const prep = await ensureDocumentsReadyForAnalysis({
            pool: pool as any,
            dealId: deal_id,
            requirePageUnderstanding: true,
            pageUnderstandingVersion: "page_understanding_v1",
            logger: request.log,
            enqueue: enqueueJob,
          });

          if (!prep.ready && prep.action === "enqueue_dpu_backfill") {
            const clientBlockedReason = (() => {
              const raw = prep.blocked_reason;
              if (raw === "DPU_STALE") return "dpu_stale";
              const expPages = prep.readiness.expected_pages_total ?? 0;
              const dpuRows = prep.readiness.dpu_rows_total ?? 0;
              const missingPages = prep.readiness.missing_pages_total ?? 0;
              if (expPages > 0 && dpuRows === 0) return "missing_dpu";
              if (expPages > 0 && dpuRows > 0 && missingPages > 0) return "dpu_partial";
              return raw ?? "missing_dpu";
            })();

            request.log.info(
              {
                event: "ANALYSIS_START_GATE1_DPU_BACKFILL",
                deal_id,
                blocked_reason: clientBlockedReason,
                docs_fingerprint: prep.docs_fingerprint,
                expected_pages_total: prep.readiness.expected_pages_total,
                dpu_rows_total: prep.readiness.dpu_rows_total,
                missing_pages_total: prep.readiness.missing_pages_total,
              },
              "analysis/start Gate 1 blocked — auto-enqueued DPU backfill"
            );

            return reply.status(202).send({
              status: "preparing_documents",
              blocked_reason: clientBlockedReason,
              action: "enqueue_dpu_backfill",
              poll_after_ms: prep.poll_after_ms ?? 1500,
              docs_fingerprint: prep.docs_fingerprint,
              expected_pages_total: prep.readiness.expected_pages_total ?? 0,
              dpu_rows_total: prep.readiness.dpu_rows_total ?? 0,
              missing_pages_total: prep.readiness.missing_pages_total ?? 0,
              enqueued: prep.enqueued,
              stale_diagnostics: prep.stale_diagnostics ?? null,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          request.log.warn(
            { event: "ANALYSIS_START_GATE1_PREFLIGHT_FAILED", deal_id, err: msg },
            "Gate 1 DPU preflight failed — proceeding with analysis enqueue"
          );
        }

        // Initialize or load existing analysis
        let analysisState = await loadAnalysisState(pool, deal_id);
        if (!analysisState) {
          analysisState = await initializeAnalysis(pool, deal_id);
        }

        logAnalysisEvent(deal_id, 1, "analysis_started", {
          mode: analysis_mode,
          max_cycles,
          stage: deal.stage,
        });

        // Enqueue Cycle 1 job
        const job = await enqueueJob({
          deal_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: "run_analysis" as any, // legacy job type pre-dates JobType union
          payload: {
            cycle: 1,
            max_cycles,
            mode: analysis_mode,
          },
        });

        reply.status(202).send({
          deal_id,
          job_id: job.job_id,
          status: "queued",
          cycle: 1,
          message: "Analysis queued for Cycle 1",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start analysis";
        logAnalysisEvent(deal_id, 0, "analysis_error", { error: message });
        reply.status(500).send({ error: message });
      }
    }
  );

  /**
   * GET /api/v1/analysis/:deal_id/progress
   * Get analysis progress for a deal
   */
  app.get<{ Params: { deal_id: string } }>(
    "/api/v1/analysis/:deal_id/progress",
    async (request, reply) => {
      const { deal_id } = request.params;

      try {
        const analysisState = await loadAnalysisState(pool, deal_id);

        if (!analysisState) {
          reply.status(404).send({ error: "No analysis found for this deal" });
          return;
        }

        const summary = generateAnalysisSummary(analysisState);

        const progress: AnalysisProgress = {
          deal_id,
          current_cycle: summary.cycle,
          total_cycles_planned: 3,
          status:
            analysisState.status === "complete"
              ? "completed"
              : (`cycle_${analysisState.current_cycle}` as any) || "starting",
          facts_extracted: summary.facts_count,
          uncertainties_identified: analysisState.planner_state.subgoals.length,
          progress_percent:
            analysisState.status === "complete"
              ? 100
              : Math.round((summary.cycle / 3) * 100),
        };

        reply.send(progress);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to get progress";
        reply.status(500).send({ error: message });
      }
    }
  );

  /**
   * GET /api/v1/analysis/:deal_id/result
   * Get analysis result (decision pack) for a deal
   */
  app.get<{ Params: { deal_id: string } }>(
    "/api/v1/analysis/:deal_id/result",
    async (request, reply) => {
      const { deal_id } = request.params;

      try {
        const analysisState = await loadAnalysisState(pool, deal_id);

        if (!analysisState || !analysisState.decision_pack) {
          reply.status(404).send({ error: "Analysis result not found" });
          return;
        }

        const result: AnalysisResult = {
          deal_id,
          analysis_id: `analysis_${deal_id}`,
          cycles_completed: analysisState.ledger.cycles,
          decision_recommendation: analysisState.decision_pack.go_no_go,
          executive_summary: analysisState.decision_pack.executive_summary,
          key_findings: [], // Extract from decision_pack
          risks_identified: analysisState.decision_pack.risk_map.map((r: any) => r.risk),
          next_steps: analysisState.decision_pack.what_to_verify,
          confidence_score: calculateConfidence(analysisState),
          completed_at: new Date().toISOString(),
        };

        reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to get result";
        reply.status(500).send({ error: message });
      }
    }
  );

  /**
   * POST /api/v1/analysis/:deal_id/cycle/:cycle
   * Run specific cycle for deal
   */
  app.post<{ Params: { deal_id: string; cycle: string } }>(
    "/api/v1/analysis/:deal_id/cycle/:cycle",
    async (request, reply) => {
      const { deal_id, cycle: cycleStr } = request.params;
      const cycle = parseInt(cycleStr, 10);

      if (!deal_id || isNaN(cycle) || cycle < 1 || cycle > 3) {
        reply.status(400).send({ error: "Invalid deal_id or cycle" });
        return;
      }

      try {
        const analysisState = await loadAnalysisState(pool, deal_id);
        if (!analysisState) {
          reply.status(404).send({ error: "Analysis not initialized" });
          return;
        }

        logAnalysisEvent(deal_id, cycle, "cycle_started");

        const job = await enqueueJob({
          deal_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: "run_analysis" as any,
          payload: {
            cycle: cycle as 1 | 2 | 3,
            max_cycles: 3,
          },
        });

        reply.status(202).send({
          deal_id,
          job_id: job.id,
          cycle,
          status: "queued",
          message: `Cycle ${cycle} analysis queued`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to queue cycle";
        reply.status(500).send({ error: message });
      }
    }
  );

  /**
   * POST /api/v1/analysis/:deal_id/synthesize
   * Run synthesis (Cycle 3) for a deal
   */
  app.post<{ Params: { deal_id: string } }>(
    "/api/v1/analysis/:deal_id/synthesize",
    async (request, reply) => {
      const { deal_id } = request.params;

      try {
        const analysisState = await loadAnalysisState(pool, deal_id);
        if (!analysisState) {
          reply.status(404).send({ error: "Analysis not initialized" });
          return;
        }

        if (analysisState.current_cycle !== 2 && analysisState.current_cycle !== 3) {
          reply
            .status(400)
            .send({ error: "Must complete Cycle 2 before synthesis" });
          return;
        }

        logAnalysisEvent(deal_id, 3, "synthesis_started");

        const job = await enqueueJob({
          deal_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: "run_analysis" as any,
          payload: {
            cycle: 3,
            mode: "synthesis",
          },
        });

        reply.status(202).send({
          deal_id,
          job_id: job.id,
          cycle: 3,
          status: "queued",
          message: "Synthesis queued",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to queue synthesis";
        reply.status(500).send({ error: message });
      }
    }
  );
}

/**
 * Helper: Calculate overall confidence
 */
function calculateConfidence(analysisState: any): number {
  if (analysisState.fact_table.length === 0) return 0;

  const avgConfidence =
    analysisState.fact_table.reduce((sum: number, f: any) => sum + f.confidence, 0) /
    analysisState.fact_table.length;

  return Math.round(avgConfidence * 100);
}

/**
 * Stub pool — must be replaced by caller injection in production.
 */
function getPool(): Pool {
  // This will be injected by caller
  throw new Error("getPool must be provided");
}
