import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";

export async function registerJobRoutes(app: FastifyInstance, pool = getPool()) {

  app.get("/api/v1/jobs", async (request, reply) => {
    const q = (request.query ?? {}) as any;
    const dealId = typeof q.deal_id === "string" && q.deal_id.trim().length > 0 ? q.deal_id.trim() : null;
    const type = typeof q.type === "string" && q.type.trim().length > 0 ? q.type.trim() : null;

    const limitRaw = typeof q.limit === "string" ? Number(q.limit) : typeof q.limit === "number" ? q.limit : 50;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

    try {
      const where: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (dealId) {
        where.push(`deal_id = $${idx}::uuid`);
        params.push(dealId);
        idx++;
      }
      if (type) {
        where.push(`type = $${idx}`);
        params.push(type);
        idx++;
      }

      params.push(limit);

      const { rows } = await pool.query(
        `SELECT job_id, type, status, progress_pct, message, deal_id, document_id, created_at, updated_at, started_at, status_detail
           FROM jobs
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
          LIMIT $${idx}`,
        params
      );

      return (rows ?? []).map((row: any) => ({
        job_id: row.job_id,
        type: row.type ?? undefined,
        status: row.status,
        progress_pct: row.progress_pct ?? undefined,
        message: row.message ?? undefined,
        deal_id: row.deal_id ?? undefined,
        document_id: row.document_id ?? undefined,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
        started_at: row.started_at ? new Date(row.started_at).toISOString() : undefined,
        status_detail: row.status_detail ?? undefined,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[jobs] failed to list jobs:`, err);
      return reply.status(500).send({ error: "Failed to list jobs" });
    }
  });

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
