/**
 * apps/api/src/routes/deals/intelligence.routes.ts
 * registerIntelligenceRoutes — Stage 5 challenge_pass read-only exposure (PR24)
 *
 * Exposes challenge_pass records from deal_challenge_pass_results for a given deal.
 * Read-only. No mutations. No business logic — surfaces what's in the DB.
 *
 * Route: GET /api/v1/deals/:deal_id/intelligence
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DealRoutesPool } from "./_shared";

export async function registerIntelligenceRoutes(
  app: FastifyInstance,
  pool: DealRoutesPool
): Promise<void> {
  /**
   * GET /api/v1/deals/:deal_id/intelligence
   *
   * Returns all challenge_pass records for the deal, sorted by created_at DESC.
   * JSONB columns (challenge_factors, overconfident_claims, missing_evidence, diligence_gaps)
   * are returned as parsed JSON — the DB driver handles this automatically for jsonb columns.
   */
  app.get("/api/v1/deals/:deal_id/intelligence", async (request, reply) => {
    const rawDealId = (request.params as { deal_id: string }).deal_id;
    const parsed = z.object({ deal_id: z.string().uuid() }).safeParse({ deal_id: rawDealId });
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_deal_id", message: "deal_id must be a UUID" });
    }
    const dealId = parsed.data.deal_id;

    // Verify deal exists and is not deleted.
    const { rows: dealRows } = await pool.query<{ id: string }>(
      `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [dealId]
    );
    if (!dealRows.length) {
      return reply.status(404).send({ error: "deal_not_found" });
    }

    const { rows } = await pool.query(
      `SELECT
         id,
         deal_id,
         intelligence_run_id,
         verdict,
         verdict_resistance_score,
         verdict_resistance_label,
         primary_challenge_reason,
         opposing_case_summary,
         challenge_factors,
         overconfident_claims,
         missing_evidence,
         diligence_gaps,
         flag_count_critical,
         flag_count_error,
         flag_count_warn,
         memory_challenge_used,
         memory_challenge_summary,
         contradiction_explanations,
         created_at,
         updated_at
       FROM deal_challenge_pass_results
       WHERE deal_id = $1
       ORDER BY created_at DESC`,
      [dealId]
    );

    return reply.status(200).send({
      data: rows,
      count: rows.length,
    });
  });
}
