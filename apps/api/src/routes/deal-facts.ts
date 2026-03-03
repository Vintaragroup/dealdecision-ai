/**
 * deal-facts.ts — API route: GET /api/v1/deals/:id/deal-facts
 *
 * Read-only endpoint returning DealFactV1 rows for a deal from the
 * deal_facts_v1 registry table.
 *
 * Also exports:
 *   getDealFactsForChat()  — retrieval helper for the deal chat route;
 *                            intent-mapped, capped at 20 facts, graceful fail.
 */

import type { FastifyInstance } from "fastify";
import type { DealFactV1 } from "@dealdecision/core";
import { getPool } from "../lib/db";

// ─── Pool type ────────────────────────────────────────────────────────────────

type PoolLike = {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

// ─── Table guard ──────────────────────────────────────────────────────────────

async function hasDealFactsTable(pool: PoolLike): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      "SELECT to_regclass('public.deal_facts_v1') AS oid"
    );
    return !!rows[0]?.oid;
  } catch {
    return false;
  }
}

// ─── DB query ─────────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "object") return raw as T;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

function rowToDealFact(r: Record<string, unknown>): DealFactV1 {
  return {
    fact_id:                 String(r["fact_id"] ?? ""),
    deal_id:                 String(r["deal_id"] ?? ""),
    type:                    String(r["type"] ?? "unknown") as DealFactV1["type"],
    label:                   String(r["label"] ?? ""),
    value:                   safeParseJson(r["value"], { kind: "unknown", reason: "parse error" }),
    timeframe:               r["timeframe"] ? String(r["timeframe"]) : undefined,
    confidence:              String(r["confidence"] ?? "low") as DealFactV1["confidence"],
    sources:                 safeParseJson(r["sources"], []),
    page_refs:               safeParseJson(r["page_refs"], []),
    conflicts_with_fact_ids: safeParseJson(r["conflicts_with_fact_ids"], []),
    created_at:              r["created_at"] ? String(r["created_at"]) : undefined,
    updated_at:              r["updated_at"] ? String(r["updated_at"]) : undefined,
  };
}

async function queryDealFacts(
  pool: PoolLike,
  dealId: string,
  opts: { types?: string[]; limit: number }
): Promise<DealFactV1[]> {
  const params: unknown[] = [dealId];
  let typeClause = "";

  if (opts.types && opts.types.length > 0) {
    const placeholders = opts.types.map((_, i) => `$${i + 2}`);
    typeClause = `AND type = ANY(ARRAY[${placeholders.join(", ")}]::text[])`;
    params.push(...opts.types);
  }

  params.push(opts.limit);

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       fact_id, deal_id, type, label,
       value, timeframe, confidence,
       sources, page_refs, conflicts_with_fact_ids,
       created_at, updated_at
     FROM public.deal_facts_v1
     WHERE deal_id = $1::uuid
     ${typeClause}
     ORDER BY
       CASE confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       type,
       updated_at DESC
     LIMIT $${params.length}::int`,
    params
  );

  return rows.map(rowToDealFact);
}

// ─── Intent → fact type mapping ───────────────────────────────────────────────

/** Map chat QuestionIntent → relevant DealFactTypeV1[] */
const INTENT_TO_FACT_TYPES: Record<string, string[]> = {
  terms:       ["raise_amount", "valuation", "round_stage", "use_of_funds"],
  product:     ["target_customer", "business_model", "product_capability", "ai_usage_claim", "pricing_model"],
  ai:          ["ai_usage_claim", "product_capability", "business_model"],
  traction:    ["traction_metric"],
  team:        ["team_key_role"],
  risk:        ["raise_amount", "valuation", "traction_metric"],  // helpful for risk context
  general:     [],   // no specific types for general
};

// ─── Chat helper ──────────────────────────────────────────────────────────────

/**
 * Retrieve deal facts for the chat prompt block.
 *
 * - Returns up to 20 facts, ordered by confidence desc.
 * - Graceful fail: returns [] on any error.
 */
export async function getDealFactsForChat(
  pool: PoolLike,
  dealId: string,
  intent: string,
  maxFacts = 20,
): Promise<DealFactV1[]> {
  try {
    if (!(await hasDealFactsTable(pool))) return [];

    const types = INTENT_TO_FACT_TYPES[intent];
    if (types && types.length === 0) return []; // general intent → no deal facts block

    return await queryDealFacts(pool, dealId, {
      types:  types ?? undefined,
      limit:  Math.min(maxFacts, 20),
    });
  } catch {
    return [];
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerDealFactsRoutes(
  app: FastifyInstance,
  pool = getPool(),
): Promise<void> {
  /**
   * GET /api/v1/deals/:id/deal-facts
   *
   * Query params:
   *   type?    — filter by one or more DealFactTypeV1 (comma-sep or repeated)
   *   limit?   — max results (1–500, default 120)
   */
  app.get<{
    Params:   { id: string };
    Querystring: { type?: string | string[]; limit?: string };
  }>("/api/v1/deals/:id/deal-facts", async (request, reply) => {
    const { id: dealId } = request.params;

    try {
      const tableExists = await hasDealFactsTable(pool as unknown as PoolLike);
      if (!tableExists) {
        return reply.send({ deal_facts: [], total: 0 });
      }

      // Validate deal exists
      const { rows: deals } = await (pool as unknown as PoolLike).query<{ id: string }>(
        "SELECT id FROM deals WHERE id = $1::uuid LIMIT 1",
        [dealId]
      );
      if (deals.length === 0) {
        return reply.code(404).send({ error: "Deal not found" });
      }

      // Parse filters
      const rawType = request.query.type;
      const types: string[] = rawType
        ? (Array.isArray(rawType) ? rawType : rawType.split(",").map((t) => t.trim()))
        : [];

      const limit = Math.max(1, Math.min(500, parseInt(request.query.limit ?? "120", 10) || 120));

      const facts = await queryDealFacts(pool as unknown as PoolLike, dealId, {
        types: types.length > 0 ? types : undefined,
        limit,
      });

      return reply.send({ deal_facts: facts, total: facts.length });
    } catch (err) {
      request.log.error({ err }, "deal-facts route error");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}
