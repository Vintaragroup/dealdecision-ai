import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";

export async function registerJobRoutes(app: FastifyInstance, pool = getPool()) {

  app.get("/api/v1/jobs/:job_id", async (request, reply) => {
    const jobId = (request.params as { job_id: string }).job_id;
    try {
      const { rows } = await pool.query(
        `SELECT job_id, type, status, progress_pct, message, deal_id, document_id, created_at, updated_at, started_at, status_detail
         FROM jobs
         WHERE job_id = $1
         LIMIT 1`,
        [jobId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Job not found" });
      }

      const row = rows[0];
      const createdAt = row.created_at ? new Date(row.created_at).toISOString() : undefined;
      const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : undefined;
      const startedAt = row.started_at ? new Date(row.started_at).toISOString() : undefined;

      return {
        job_id: row.job_id,
        type: row.type ?? undefined,
        status: row.status,
        progress_pct: row.progress_pct ?? undefined,
        message: row.message ?? undefined,
        deal_id: row.deal_id ?? undefined,
        document_id: row.document_id ?? undefined,
        created_at: createdAt,
        updated_at: updatedAt,
        started_at: startedAt,
        status_detail: row.status_detail ?? undefined,
      };
    } catch (err) {
      // Log and return a structured error instead of crashing the route (avoids 500 loops in the client).
      // eslint-disable-next-line no-console
      console.error(`[jobs] failed to fetch job ${jobId}:`, err);
      return reply.status(500).send({ error: "Failed to fetch job", job_id: jobId });
    }
  });
}
