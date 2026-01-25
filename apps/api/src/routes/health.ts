import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../lib/db";

const healthResponseSchema = z.object({ ok: z.literal(true) });

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
