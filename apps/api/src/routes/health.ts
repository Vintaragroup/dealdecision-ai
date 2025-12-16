import type { FastifyInstance } from "fastify";
import { z } from "zod";

const healthResponseSchema = z.object({ ok: z.literal(true) });

type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function registerHealthRoutes(app: FastifyInstance) {
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
}
