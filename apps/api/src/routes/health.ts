import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../lib/db";

const healthResponseSchema = z.object({ ok: z.literal(true) });

const renderHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  uptime_seconds: z.number(),
  timestamp: z.string(),
  db: z.enum(["ok", "unreachable"]),
  // [DDAI][build_fingerprint] — correlate API commit against web UI commit.
  sha: z.string(),
  build_time: z.string(),
});

type RenderHealthResponse = z.infer<typeof renderHealthSchema>;

type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function registerHealthRoutes(app: FastifyInstance) {
  // Render default health probe often checks GET /.
  // Keep this lightweight, unauthenticated, and non-invasive.
  app.get(
    "/",
    {
      logLevel: "silent",
      schema: {
        response: {
          200: { type: "string" },
        },
      },
    },
    async (_request, reply) => reply.type("text/plain").send("ok")
  );

  app.get<{ Reply: HealthResponse }>(
    "/api/v1/health",
    {
      logLevel: "silent",
      schema: {
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
        },
      },
    },
    async () => ({ ok: true })
  );

  // Canonical external health check endpoint.
  // Requirements:
  // - Always return 200 (even if DB unreachable)
  // - Include a lightweight DB connectivity probe
  app.get<{ Reply: RenderHealthResponse }>(
    "/health",
    {
      logLevel: "silent",
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              uptime_seconds: { type: "number" },
              timestamp: { type: "string" },
              db: { type: "string" },
              sha: { type: "string" },
              build_time: { type: "string" },
            },
            required: ["status", "service", "uptime_seconds", "timestamp", "db", "sha", "build_time"],
          },
        },
      },
    },
    async () => {
      const pool = getPool();
      const timestamp = new Date().toISOString();
      let db: "ok" | "unreachable" = "unreachable";

      // Keep the probe fast; if it errors or times out, still return 200.
      const timeoutMs = 40;
      try {
        await Promise.race([
          pool.query("SELECT 1"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("db_probe_timeout")), timeoutMs)),
        ]);
        db = "ok";
      } catch {
        db = "unreachable";
      }

      return {
        status: "ok",
        service: "api",
        uptime_seconds: Math.floor(process.uptime()),
        timestamp,
        db,
        // [DDAI][build_fingerprint] — Render auto-injects RENDER_GIT_COMMIT for all services.
        // Fallback: API_BUILD_SHA set manually (e.g. via Render envVar or Dockerfile ARG).
        sha: process.env.RENDER_GIT_COMMIT ?? process.env.API_BUILD_SHA ?? 'unknown',
        build_time: process.env.API_BUILD_TIME ?? 'unknown',
      };
    }
  );

  // Render-style health check (no auth, lightweight).
  app.get(
    "/healthz",
    {
      logLevel: "silent",
      schema: {
        response: {
          200: { type: "string" },
        },
      },
    },
    async (_request, reply) => reply.type("text/plain").send("ok")
  );

  app.get(
    "/api/v1/health/schema",
    {
      logLevel: "silent",
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              checked_at: { type: "string" },
              missing: { type: "array", items: { type: "string" } },
              required: { type: "array", items: { type: "string" } },
            },
            required: ["ok", "checked_at", "missing", "required"],
          },
        },
      },
    },
    async () => {
      const pool = getPool();
      const required = [
        "evidence.confidence",
        "documents.storage_provider",
        "documents.storage_bucket",
        "documents.storage_key",
        "documents.size_bytes",
        "documents.mime_type",
      ];

      const missing: string[] = [];
      for (const key of required) {
        const [table, column] = key.split(".");
        const { rows } = await pool.query<{ ok: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = $2
           ) AS ok`,
          [table, column]
        );
        if (!rows?.[0]?.ok) missing.push(key);
      }

      return {
        ok: missing.length === 0,
        checked_at: new Date().toISOString(),
        required,
        missing,
      };
    }
  );
}
