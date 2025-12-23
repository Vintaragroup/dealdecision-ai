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

/**
 * Register analysis routes
 */
export async function registerAnalysisRoutes(
  app: FastifyInstance,
  pool: Pool = getPool(),
  enqueueJob = enqueueAnalysisJob
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
          type: "run_analysis",
          payload: {
            cycle: 1,
            max_cycles,
            mode: analysis_mode,
          },
        });

        reply.status(202).send({
          deal_id,
          job_id: job.id,
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
          risks_identified: analysisState.decision_pack.risk_map.map((r) => r.risk),
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
          type: "run_analysis",
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
          type: "run_analysis",
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
 * Import pool (mock for type checking)
 */
function getPool(): Pool {
  // This will be injected by caller
  throw new Error("getPool must be provided");
}

/**
 * Import enqueue job (mock for type checking)
 */
function enqueueAnalysisJob(job: any): Promise<{ id: string }> {
  // This will be injected by caller
  throw new Error("enqueueAnalysisJob must be provided");
}
