import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";

type JobRow = {
  job_id: string;
  status: string;
  progress_pct: number | null;
  message: string | null;
  deal_id: string | null;
  updated_at: string;
  type: string | null;
};

export async function registerEventRoutes(app: FastifyInstance, pool = getPool()) {
  // Handle OPTIONS preflight requests for EventSource CORS
  app.options("/api/v1/events", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
    reply.send();
  });

  app.get("/api/v1/events", async (request, reply) => {
    const { deal_id, cursor } = request.query as { deal_id?: string; cursor?: string };
    const lastEventIdHeader = request.headers["last-event-id"] as string | undefined;

    // Set CORS headers for streaming response
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
    reply.header("Access-Control-Expose-Headers", "Content-Type");
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();

    const send = (event: string, data: unknown, id?: string) => {
      if (id) {
        reply.raw.write(`id: ${id}\n`);
      }
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(pollInterval);
      clearInterval(heartbeat);
      reply.raw.end();
    };

    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);

    send("ready", { ok: true });

    const initialCursor = lastEventIdHeader || cursor;
    // Start from provided cursor or "now" to avoid replaying historical jobs on first connect.
    let lastJobUpdatedAt = initialCursor ?? new Date().toISOString();

    const heartbeat = setInterval(() => {
      if (closed) return;
      reply.raw.write(":keep-alive\n\n");
    }, 15000);

    const pollInterval = setInterval(async () => {
      try {
        const { rows } = await pool.query<JobRow>(
          `SELECT job_id, status, progress_pct, message, deal_id, updated_at, type
           FROM jobs
           WHERE ($1::text IS NULL OR deal_id = $1)
             AND updated_at > $2
           ORDER BY updated_at ASC
           LIMIT 50`,
          [deal_id ?? null, lastJobUpdatedAt]
        );

        if (rows.length > 0) {
          lastJobUpdatedAt = rows[rows.length - 1].updated_at;
          for (const row of rows) {
            send(
              "job.updated",
              {
                job_id: row.job_id,
                status: row.status,
                progress_pct: row.progress_pct ?? undefined,
                message: row.message ?? undefined,
                deal_id: row.deal_id ?? undefined,
                type: row.type ?? undefined,
                updated_at: new Date(row.updated_at).toISOString(),
              },
              row.updated_at
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send("error", { message });
      }
    }, 2000);

    // Keep the connection open
    return reply;
  });
}