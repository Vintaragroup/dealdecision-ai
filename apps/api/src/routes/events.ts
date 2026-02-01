import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";
import { z } from "zod";

type JobRow = {
  job_id: string;
  status: string;
  progress_pct: number | null;
  message: string | null;
  deal_id: string | null;
  updated_at: string;
  type: string | null;
  created_at: string;
  started_at: string | null;
  status_detail: unknown;
};

const EventsQuerySchema = z.object({
  deal_id: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const s = v.trim();
      return s.length === 0 ? undefined : s;
    },
    z.string().uuid().optional()
  ),
  cursor: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const s = v.trim();
      if (s.length === 0) return undefined;
      // Accept ISO/RFC3339 and also common JS Date.toString() values (legacy clients).
      // Normalize to ISO so the downstream zod datetime validator and SQL parameter are consistent.
      const parsed = Date.parse(s);
      if (Number.isFinite(parsed)) {
        try {
          return new Date(parsed).toISOString();
        } catch {
          return s;
        }
      }
      return s;
    },
    z.string().datetime({ offset: true }).optional()
  ),
});

export async function registerEventRoutes(app: FastifyInstance, pool = getPool()) {
  const applyCors = (request: any, reply: any) => {
    const origin = (request?.headers?.origin as string | undefined) ?? undefined;

    // If an Origin is present, echo it back (safe with credentials).
    if (origin) {
      reply.raw.setHeader("Access-Control-Allow-Origin", origin);
      reply.raw.setHeader("Vary", "Origin");
      reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      // Non-browser clients may omit Origin.
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    }

    reply.raw.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    reply.raw.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Last-Event-ID, Authorization"
    );
    reply.raw.setHeader("Access-Control-Expose-Headers", "Content-Type");
  };

  // Handle OPTIONS preflight requests for EventSource CORS
  app.options("/api/v1/events", async (request, reply) => {
    applyCors(request, reply);
    reply.code(204);
    return reply.send();
  });

  app.get("/api/v1/events", async (request, reply) => {
    const startTs = Date.now();
    const connId = (request as any).id ?? `${startTs}-${Math.random().toString(36).slice(2, 8)}`;
    const parsed = EventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: parsed.error.flatten(),
      });
    }

    reply.hijack();

    const { deal_id, cursor } = parsed.data;
    const lastEventIdHeader = request.headers["last-event-id"] as string | undefined;
    const testMode = request.headers["x-ddai-test-mode"] === "1";

    // Set CORS headers for streaming response
    applyCors(request, reply);
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();

    let closed = false;

    const safeWrite = (chunk: string) => {
      if (closed || reply.raw.destroyed || reply.raw.writableEnded || reply.raw.closed === true || !reply.raw.writable) {
        return;
      }
      try {
        reply.raw.write(chunk);
      } catch (err) {
        request.log.error({ err, deal_id }, "events.sse.write_failed");
        cleanup();
      }
    };

    const send = (event: string, data: unknown, id?: string) => {
      if (closed) return;
      if (id) {
        safeWrite(`id: ${id}\n`);
      }
      safeWrite(`event: ${event}\n`);
      safeWrite(`data: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(pollInterval);
      clearInterval(heartbeat);
      if (reply.raw.writable) {
        try {
          reply.raw.end();
        } catch {
          // ignore
        }
      }
      const endTs = Date.now();
      request.log.info({
        msg: "events.sse.closed",
        deal_id,
        conn_id: connId,
        start_ts: new Date(startTs).toISOString(),
        end_ts: new Date(endTs).toISOString(),
        duration_ms: endTs - startTs,
      });
      if (process.env.NODE_ENV === "development") {
        request.log.info({ deal_id, conn_id: connId, cleaned_up: true }, "events.sse.cleanup.dev");
      }
    };

    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);

    request.log.info({
      msg: "events.sse.open",
      deal_id,
      conn_id: connId,
      start_ts: new Date(startTs).toISOString(),
    });

    send("ready", { ok: true });

    const initialCursor = lastEventIdHeader || cursor;
    const defaultCursorWindow = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let lastJobUpdatedAt = initialCursor ?? defaultCursorWindow;

    const heartbeat = setInterval(() => {
      if (closed) return;
      safeWrite(":keep-alive\n\n");
    }, 15000);

    const pollIntervalMs = testMode ? 10 : 2000;
    const pollInterval = setInterval(async () => {
      try {
        const { rows } = await pool.query<JobRow>(
          `SELECT job_id, status, progress_pct, message, deal_id, updated_at, created_at, started_at, status_detail, type
           FROM jobs
           WHERE ($1::uuid IS NULL OR deal_id = $1::uuid)
             AND updated_at > $2::timestamptz
           ORDER BY updated_at ASC
           LIMIT 50`,
          [deal_id ?? null, lastJobUpdatedAt]
        );

        if (rows.length > 0) {
          // Ensure cursor is always ISO/RFC3339 so browser reconnects pass validation.
          lastJobUpdatedAt = new Date(rows[rows.length - 1].updated_at).toISOString();
          for (const row of rows) {
            const statusDetail = (row as any).status_detail ?? null;
            const progress = statusDetail && typeof statusDetail === "object" && (statusDetail as any).progress ? (statusDetail as any).progress : null;
            const updatedIso = new Date(row.updated_at).toISOString();
            const createdIso = row.created_at ? new Date(row.created_at).toISOString() : undefined;
            const startedIso = row.started_at ? new Date(row.started_at).toISOString() : undefined;
            send(
              "job.updated",
              {
                job_id: row.job_id,
                status: row.status,
                progress_pct: row.progress_pct ?? undefined,
                message: row.message ?? undefined,
                deal_id: row.deal_id ?? undefined,
                type: row.type ?? undefined,
                updated_at: updatedIso,
                created_at: createdIso,
                started_at: startedIso,
                status_detail: statusDetail ?? undefined,
              },
              updatedIso
            );

            if (progress && typeof progress === "object") {
              const progressPayload = {
                version: "job.progress.v1",
                job_id: row.job_id,
                deal_id: row.deal_id ?? undefined,
                document_id: (progress as any).document_id ?? undefined,
                type: row.type ?? undefined,
                status: row.status,
                stage: (progress as any).stage,
                percent: (progress as any).percent ?? progress.percent ?? row.progress_pct ?? undefined,
                completed: (progress as any).completed ?? undefined,
                total: (progress as any).total ?? undefined,
                message: (progress as any).message ?? row.message ?? undefined,
                reason: (progress as any).reason ?? undefined,
                meta: (progress as any).meta ?? undefined,
                created_at: createdIso ?? undefined,
                updated_at: updatedIso,
                at: (progress as any).at ?? updatedIso,
                status_detail: statusDetail ?? undefined,
              };
              send("job.progress", progressPayload, updatedIso);
            }
          }
        }
      } catch (err) {
        request.log.error({ err, deal_id }, "events.sse.poll_failed");
        cleanup();
      }
    }, pollIntervalMs);

    // Test harness support: allow fastify.inject() to complete without changing
    // production SSE behavior.
    if (testMode) {
      setTimeout(() => {
        cleanup();
      }, 30);
    }

    return reply;
  });
}