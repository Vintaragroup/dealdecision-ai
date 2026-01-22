import type { FastifyInstance } from "fastify";
import { z } from "zod";

const healthResponseSchema = z.object({ ok: z.literal(true) });

type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function registerHealthRoutes(app: FastifyInstance) {
  // Render default health probe often checks GET /.
  // Keep this lightweight, unauthenticated, and non-invasive.
  app.get(
    "/",
    {
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
      schema: {
        response: {
          200: { type: "string" },
        },
      },
    },
    async (_request, reply) => reply.type("text/plain").send("ok")
  );
}
