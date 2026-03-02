/**
 * financial-facts.ts — API route: GET /api/v1/deals/:id/financial-facts
 *
 * Read-only endpoint returning FinancialFactV1 rows for a deal from the
 * financial_facts_v1 registry table.
 *
 * Also exports `getFinancialFactsForChat()` — a retrieval helper used by
 * the deal chat route to build the FACTS block for financial intent questions.
 */

import type { FastifyInstance } from "fastify";
import type { FinancialFactV1 } from "@dealdecision/core";
import { getPool } from "../lib/db";

// ─── DB query ─────────────────────────────────────────────────────────────────

type PoolLike = {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

async function hasFinancialFactsTable(pool: PoolLike): Promise<boolean> {
  const { rows } = await pool.query<{ oid: string | null }>(
    "SELECT to_regclass('public.financial_facts_v1') AS oid"
  );
  return !!rows[0]?.oid;
}

/**
 * Query financial facts for a deal.
 * Returns up to `limit` rows ordered: annual first, most-recent period first.
 */
async function queryFacts(
  pool: PoolLike,
  dealId: string,
  opts: { metricKey?: string; limit: number }
): Promise<FinancialFactV1[]> {
  const params: unknown[] = [dealId];
  let metricClause = "";
  if (opts.metricKey) {
    params.push(opts.metricKey);
    metricClause = `AND metric_key = $${params.length}::text`;
  }
  params.push(opts.limit);

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       fact_id, deal_id, document_id::text, source_kind,
       metric_key, metric_label, period_type, period_label,
       value::float8, unit, currency, confidence, reconciliation_status,
       sheet_name, page_number, row_index, col_index,
       source_pointer, evidence_id, excerpt
     FROM public.financial_facts_v1
     WHERE deal_id = $1::uuid
     ${metricClause}
     ORDER BY
       CASE period_type
         WHEN 'annual'    THEN 1
         WHEN 'ttm'       THEN 2
         WHEN 'quarterly' THEN 3
         WHEN 'monthly'   THEN 4
         ELSE 5
       END ASC,
       period_label DESC,
       confidence DESC
     LIMIT $${params.length}::int`,
    params
  );

  return rows.map(rowToFact);
}

function rowToFact(r: Record<string, unknown>): FinancialFactV1 {
  return {
    fact_id:               String(r["fact_id"] ?? ""),
    deal_id:               String(r["deal_id"] ?? ""),
    document_id:           r["document_id"] != null ? String(r["document_id"]) : undefined,
    source_kind:           (r["source_kind"] as FinancialFactV1["source_kind"]) ?? "unknown",
    metric_key:            String(r["metric_key"] ?? ""),
    metric_label:          r["metric_label"] != null ? String(r["metric_label"]) : undefined,
    period_type:           (r["period_type"] as FinancialFactV1["period_type"]) ?? "unknown",
    period_label:          String(r["period_label"] ?? ""),
    value:                 Number(r["value"] ?? 0),
    unit:                  (r["unit"] as FinancialFactV1["unit"]) ?? "unknown",
    currency:              r["currency"] != null ? String(r["currency"]) : undefined,
    confidence:            (r["confidence"] as FinancialFactV1["confidence"]) ?? "low",
    reconciliation_status: r["reconciliation_status"] != null
      ? (r["reconciliation_status"] as FinancialFactV1["reconciliation_status"])
      : undefined,
    sheet_name:    r["sheet_name"]     != null ? String(r["sheet_name"])     : undefined,
    page_number:   r["page_number"]    != null ? Number(r["page_number"])    : undefined,
    row_index:     r["row_index"]      != null ? Number(r["row_index"])      : undefined,
    col_index:     r["col_index"]      != null ? Number(r["col_index"])      : undefined,
    source_pointer:r["source_pointer"] != null ? String(r["source_pointer"]) : undefined,
    evidence_id:   r["evidence_id"]    != null ? String(r["evidence_id"])    : undefined,
    excerpt:       r["excerpt"]        != null ? String(r["excerpt"])        : undefined,
  };
}

// ─── Chat retrieval helper ────────────────────────────────────────────────────

/**
 * Fetch a compact set of FinancialFactV1 rows for a financial-intent
 * chat question. Returns at most 25 facts.
 *
 * Ordering: annual facts → most recent period → high confidence first.
 * Used by the deal chat route to build the FACTS block.
 */
export async function getFinancialFactsForChat(
  pool: PoolLike,
  dealId: string
): Promise<FinancialFactV1[]> {
  try {
    const tableExists = await hasFinancialFactsTable(pool);
    if (!tableExists) return [];
    return await queryFacts(pool, dealId, { limit: 25 });
  } catch {
    // Never crash chat on registry read failure
    return [];
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function registerFinancialFactsRoutes(
  app: FastifyInstance,
  pool = getPool()
): Promise<void> {
  /**
   * GET /api/v1/deals/:id/financial-facts
   *
   * Query params:
   *   metric_key  — optional, filter by metric_key
   *   limit       — optional, 1–100 (default 50)
   *
   * Returns:
   *   { facts: FinancialFactV1[] }
   */
  app.get<{
    Params: { id: string };
    Querystring: { metric_key?: string; limit?: string };
  }>("/api/v1/deals/:id/financial-facts", async (request, reply) => {
    const { id } = request.params;
    const metricKey = request.query.metric_key?.trim() || undefined;
    const limitRaw = parseInt(request.query.limit ?? "50", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 50;

    // Verify deal exists
    const { rows: deals } = await pool.query<{ id: string }>(
      `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (deals.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    // Check table exists (graceful no-op if migration not applied)
    const tableExists = await hasFinancialFactsTable(pool);
    if (!tableExists) {
      return reply.send({ facts: [] });
    }

    const facts = await queryFacts(pool, id, { metricKey, limit });
    return reply.send({ facts });
  });
}
