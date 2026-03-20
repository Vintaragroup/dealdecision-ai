import type { FastifyInstance } from "fastify";
import { getPool } from "../lib/db";

export async function registerProfileRoutes(app: FastifyInstance) {
  // GET /api/v1/profile/stats
  // Returns real deal and document counts for the authenticated user.
  app.get("/api/v1/profile/stats", async (request, reply) => {
    const userId = (request as any)?.auth?.userId;
    if (!userId || typeof userId !== "string") {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const pool = getPool();
    const { rows } = await pool.query<{
      deal_count: string;
      document_count: string;
    }>(
      `SELECT
         COUNT(DISTINCT d.id)::text   AS deal_count,
         COUNT(DISTINCT doc.id)::text AS document_count
       FROM deals d
       LEFT JOIN documents doc ON doc.deal_id = d.id
       WHERE d.created_by_user_id = $1`,
      [userId]
    );

    return reply.send({
      dealCount: Number(rows[0]?.deal_count ?? 0),
      documentCount: Number(rows[0]?.document_count ?? 0),
    });
  });
}
