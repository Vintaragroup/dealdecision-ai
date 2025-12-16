import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";

export async function registerJobRoutes(app: FastifyInstance, pool = getPool()) {

  app.get("/api/v1/jobs/:job_id", async (request, reply) => {
    const jobId = (request.params as { job_id: string }).job_id;
    const { rows } = await pool.query(
      `SELECT job_id, status, progress_pct, message, deal_id, document_id, created_at, updated_at
       FROM jobs
       WHERE job_id = $1`,
      [jobId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Job not found" });
    }

    const row = rows[0];
    return {
      job_id: row.job_id,
      status: row.status,
      progress_pct: row.progress_pct ?? undefined,
      message: row.message ?? undefined,
      deal_id: row.deal_id ?? undefined,
      document_id: row.document_id ?? undefined,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  });
}
