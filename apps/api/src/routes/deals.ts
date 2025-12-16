import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../lib/db";
import type { Deal } from "@dealdecision/contracts";
import { enqueueJob } from "../services/jobs";

const dealStageSchema = z.enum(["idea", "progress", "ready", "pitched"]);
const dealPrioritySchema = z.enum(["high", "medium", "low"]);
const dealTrendSchema = z.enum(["up", "down", "stable"]);

const dealCreateSchema = z.object({
  name: z.string().min(1),
  stage: dealStageSchema,
  priority: dealPrioritySchema,
  trend: dealTrendSchema.optional(),
  score: z.number().optional(),
  owner: z.string().optional(),
});

const dealUpdateSchema = dealCreateSchema.partial();

type DealRow = {
  id: string;
  name: string;
  stage: Deal["stage"];
  priority: Deal["priority"];
  trend: Deal["trend"] | null;
  score: number | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type DIOAggregateRow = {
  dio_version_id: string | null;
  dio_status: string | null;
  last_analyzed_at: string | null;
};

function mapDeal(row: DealRow, dio?: DIOAggregateRow | null): Deal {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    priority: row.priority,
    trend: row.trend ?? undefined,
    score: row.score ?? undefined,
    owner: row.owner ?? undefined,
    lastUpdated: new Date(row.updated_at).toISOString(),
    dioVersionId: dio?.dio_version_id ?? undefined,
    dioStatus: (dio?.dio_status as Deal["trend"]) ?? undefined,
    lastAnalyzedAt: dio?.last_analyzed_at ? new Date(dio.last_analyzed_at).toISOString() : undefined,
  } as Deal;
}

export async function registerDealRoutes(app: FastifyInstance) {
  const pool = getPool();

  app.post("/api/v1/deals", async (request, reply) => {
    const parsed = dealCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { name, stage, priority, trend, score, owner } = parsed.data;

    const { rows } = await pool.query<DealRow>(
      `INSERT INTO deals (name, stage, priority, trend, score, owner)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, stage, priority, trend ?? null, score ?? null, owner ?? null]
    );

    return mapDeal(rows[0]);
  });

  app.get("/api/v1/deals", async (request) => {
    // Accept optional filters but ignore for now (TODO)
    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    return rows.map((row) => mapDeal(row));
  });

  app.get("/api/v1/deals/:deal_id", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const { rows: dioRows } = await pool.query<DIOAggregateRow>(
      `SELECT id as dio_version_id, status as dio_status, created_at as last_analyzed_at
       FROM dio_versions
       WHERE deal_id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [dealId]
    );

    return mapDeal(rows[0], dioRows[0] ?? null);
  });

  app.put("/api/v1/deals/:deal_id", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const parsed = dealUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No fields to update" });
    }

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    let idx = 1;

    for (const key of Object.keys(updates) as Array<keyof typeof updates>) {
      fields.push(`${key} = $${idx}`);
      const val = updates[key];
      values.push((val as string | number | null | undefined) ?? null);
      idx += 1;
    }

    values.push(dealId);

    const { rows } = await pool.query<DealRow>(
      `UPDATE deals
         SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    return mapDeal(rows[0]);
  });

  app.delete("/api/v1/deals/:deal_id", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;
    const { rows } = await pool.query<DealRow>(
      `UPDATE deals SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    return mapDeal(rows[0]);
  });

  app.post("/api/v1/deals/:deal_id/analyze", async (request, reply) => {
    const dealId = (request.params as { deal_id: string }).deal_id;

    const { rows } = await pool.query<DealRow>(
      `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [dealId]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const job = await enqueueJob({ deal_id: dealId, type: "analyze_deal" });

    return reply.status(202).send({ job_id: job.job_id, status: job.status });
  });
}
