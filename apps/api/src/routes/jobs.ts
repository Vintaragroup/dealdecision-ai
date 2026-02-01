import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";

async function listJobColumns(pool: any): Promise<Set<string>> {
  try {
    const { rows } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'jobs'`
    );
    return new Set((rows ?? []).map((r: any) => String(r.column_name)));
  } catch {
    return new Set();
  }
}

function pickColumnOrNull(columnSet: Set<string>, col: string, alias?: string): string {
  const a = alias ?? col;
  if (columnSet.has(col)) return `${col} AS ${a}`;
  return `NULL AS ${a}`;
}

export async function registerJobRoutes(app: FastifyInstance, pool = getPool()) {

  app.get("/api/v1/deals/:deal_id/jobs", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const q = (request.query ?? {}) as any;

    const limitRaw = typeof q.limit === "string" ? Number(q.limit) : typeof q.limit === "number" ? q.limit : 200;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;

    const type = typeof q.type === "string" && q.type.trim().length > 0 ? q.type.trim() : null;
    const queue = typeof q.queue === "string" && q.queue.trim().length > 0 ? q.queue.trim() : null;

    try {
      const cols = await listJobColumns(pool);

      const select = [
        "job_id",
        pickColumnOrNull(cols, "queue"),
        pickColumnOrNull(cols, "type"),
        "status",
        pickColumnOrNull(cols, "stage"),
        pickColumnOrNull(cols, "progress_current"),
        pickColumnOrNull(cols, "progress_total"),
        pickColumnOrNull(cols, "progress_pct"),
        pickColumnOrNull(cols, "message"),
        "deal_id",
        pickColumnOrNull(cols, "document_id"),
        pickColumnOrNull(cols, "parent_job_id"),
        pickColumnOrNull(cols, "page_start"),
        pickColumnOrNull(cols, "page_end"),
        pickColumnOrNull(cols, "error"),
        "created_at",
        "updated_at",
        pickColumnOrNull(cols, "started_at"),
        pickColumnOrNull(cols, "finished_at"),
        pickColumnOrNull(cols, "status_detail"),
      ].join(", ");

      const where: string[] = [`deal_id = $1::uuid`];
      const params: any[] = [dealId];
      let idx = 2;

      if (type) {
        where.push(`type = $${idx}`);
        params.push(type);
        idx++;
      }
      if (queue) {
        where.push(`queue = $${idx}`);
        params.push(queue);
        idx++;
      }

      params.push(limit);

      const { rows } = await pool.query(
        `SELECT ${select}
           FROM jobs
          WHERE ${where.join(" AND ")}
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
          LIMIT $${idx}`,
        params
      );

      return (rows ?? []).map((row: any) => ({
        job_id: row.job_id,
        queue: row.queue ?? undefined,
        type: row.type ?? undefined,
        status: row.status,
        stage: row.stage ?? undefined,
        progress_current: typeof row.progress_current === "number" ? row.progress_current : row.progress_current ?? undefined,
        progress_total: typeof row.progress_total === "number" ? row.progress_total : row.progress_total ?? undefined,
        progress_pct: row.progress_pct ?? undefined,
        message: row.message ?? undefined,
        deal_id: row.deal_id ?? undefined,
        document_id: row.document_id ?? undefined,
        parent_job_id: row.parent_job_id ?? undefined,
        page_start: row.page_start ?? undefined,
        page_end: row.page_end ?? undefined,
        error: row.error ?? undefined,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
        started_at: row.started_at ? new Date(row.started_at).toISOString() : undefined,
        finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : undefined,
        status_detail: row.status_detail ?? undefined,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[jobs] failed to list deal jobs:`, err);
      return reply.status(500).send({ error: "Failed to list deal jobs", deal_id: dealId });
    }
  });

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
