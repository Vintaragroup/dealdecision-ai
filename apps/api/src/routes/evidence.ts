import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../lib/db";
import { enqueueJob } from "../services/jobs";

const fetchSchema = z.object({
  deal_id: z.string().min(1),
  filter: z.string().optional(),
});

const dealIdSchema = z.string().min(1);

export async function registerEvidenceRoutes(app: FastifyInstance, pool = getPool(), enqueue = enqueueJob) {
  app.post("/api/v1/evidence/fetch", async (request, reply) => {
    const parsed = fetchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { deal_id, filter } = parsed.data;
    const { rows: deals } = await pool.query(`SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`, [deal_id]);
    if (deals.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    try {
      const job = await enqueue({ deal_id, type: "fetch_evidence", payload: filter ? { filter } : {} });
      return reply.status(202).send({ job_id: job.job_id, status: job.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to queue evidence job";
      return reply.status(500).send({ error: message });
    }
  });

  app.get("/api/v1/deals/:deal_id/evidence", async (request) => {
    const dealParam = (request.params as { deal_id: string }).deal_id;
    const parsedDeal = dealIdSchema.safeParse(dealParam);
    if (!parsedDeal.success) {
      return { evidence: [] };
    }
    const dealId = parsedDeal.data;

    const { rows: deals } = await pool.query(`SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`, [dealId]);
    if (deals.length === 0) {
      return { evidence: [] };
    }
    const { rows } = await pool.query(
      `SELECT id, deal_id, document_id, source, kind, text, confidence, created_at
       FROM evidence
       WHERE deal_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [dealId]
    );

    return { evidence: rows.map((row) => ({
      id: row.id,
      deal_id: row.deal_id,
      document_id: row.document_id ?? undefined,
      source: row.source,
      kind: row.kind,
      text: row.text,
      confidence: row.confidence ?? undefined,
      created_at: row.created_at,
    })) };
  });
}
