/**
 * pages.ts — API routes: GET /api/v1/deals/:id/pages
 *                        GET /api/v1/deals/:id/pages/search
 *
 * Read-only endpoints returning PageRegistryRowV1 rows from the
 * page_registry_v1 table.
 *
 * Also exports `getPageContextForChat()` — a retrieval helper used by
 * the deal chat route to build the PAGE CONTEXT block for non-financial intents.
 */

import type { FastifyInstance } from "fastify";
import type { PageRegistryRowV1 } from "@dealdecision/core";
import { getPool } from "../lib/db";

// ─── Pool type ────────────────────────────────────────────────────────────────

type PoolLike = {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

// ─── Table guard ──────────────────────────────────────────────────────────────

async function hasPageRegistryTable(pool: PoolLike): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      "SELECT to_regclass('public.page_registry_v1') AS oid"
    );
    return !!rows[0]?.oid;
  } catch {
    return false;
  }
}

// ─── DB queries ───────────────────────────────────────────────────────────────

async function queryPages(
  pool: PoolLike,
  dealId: string,
  opts: { pageType?: string; documentId?: string; limit: number }
): Promise<PageRegistryRowV1[]> {
  const params: unknown[] = [dealId];
  const clauses: string[] = [];

  if (opts.pageType) {
    params.push(opts.pageType);
    clauses.push(`AND page_type = $${params.length}::text`);
  }
  if (opts.documentId) {
    params.push(opts.documentId);
    clauses.push(`AND document_id = $${params.length}::uuid`);
  }
  params.push(opts.limit);

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       page_id, deal_id, document_id::text, page_number,
       page_type, confidence,
       entities, numeric_claims, key_claims,
       evidence_ids, excerpt
     FROM public.page_registry_v1
     WHERE deal_id = $1::uuid
     ${clauses.join(" ")}
     ORDER BY document_id, page_number ASC
     LIMIT $${params.length}::int`,
    params
  );

  return rows.map(rowToRegistryRow);
}

async function searchPages(
  pool: PoolLike,
  dealId: string,
  query: string,
  limit: number
): Promise<PageRegistryRowV1[]> {
  const likePat = `%${query.replace(/[%_]/g, "\\$&").toLowerCase()}%`;

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       page_id, deal_id, document_id::text, page_number,
       page_type, confidence,
       entities, numeric_claims, key_claims,
       evidence_ids, excerpt
     FROM public.page_registry_v1
     WHERE deal_id = $1::uuid
       AND (
         LOWER(COALESCE(excerpt, '')) LIKE $2
         OR LOWER(key_claims::text) LIKE $2
         OR LOWER(numeric_claims::text) LIKE $2
       )
     ORDER BY document_id, page_number ASC
     LIMIT $3::int`,
    [dealId, likePat, limit]
  );

  return rows.map(rowToRegistryRow);
}

function rowToRegistryRow(r: Record<string, unknown>): PageRegistryRowV1 {
  return {
    page_id:        String(r["page_id"] ?? ""),
    deal_id:        String(r["deal_id"] ?? ""),
    document_id:    String(r["document_id"] ?? ""),
    page_number:    Number(r["page_number"] ?? 0),
    page_type:      (r["page_type"] as PageRegistryRowV1["page_type"]) ?? "unknown",
    confidence:     (r["confidence"] as PageRegistryRowV1["confidence"]) ?? "low",
    entities:       Array.isArray(r["entities"])
                      ? (r["entities"] as PageRegistryRowV1["entities"])
                      : [],
    numeric_claims: Array.isArray(r["numeric_claims"])
                      ? (r["numeric_claims"] as PageRegistryRowV1["numeric_claims"])
                      : [],
    key_claims:     Array.isArray(r["key_claims"])
                      ? (r["key_claims"] as PageRegistryRowV1["key_claims"])
                      : [],
    evidence_ids:   Array.isArray(r["evidence_ids"])
                      ? (r["evidence_ids"] as string[])
                      : [],
    excerpt:        r["excerpt"] != null ? String(r["excerpt"]) : undefined,
  };
}

// ─── Chat retrieval helper ────────────────────────────────────────────────────

/**
 * Fetch page registry rows for use in the chat PAGE CONTEXT block.
 *
 * @param pool
 * @param dealId
 * @param pageType — target page type for the current intent (e.g. "ask", "team")
 * @param maxPages — max rows to return (default 4)
 */
export async function getPageContextForChat(
  pool: PoolLike,
  dealId: string,
  pageType: string,
  maxPages = 4
): Promise<PageRegistryRowV1[]> {
  try {
    const tableExists = await hasPageRegistryTable(pool);
    if (!tableExists) return [];
    return await queryPages(pool, dealId, {
      pageType,
      limit: Math.min(maxPages, 8),
    });
  } catch {
    // Never crash chat on registry read failure
    return [];
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function registerPagesRoutes(
  app: FastifyInstance,
  pool = getPool()
): Promise<void> {
  /**
   * GET /api/v1/deals/:id/pages
   *
   * Query params:
   *   page_type   — optional, filter by page_type (ask|product|market|...)
   *   document_id — optional, filter to a single document
   *   limit       — optional, 1–500 (default 100)
   *
   * Returns:
   *   { pages: PageRegistryRowV1[], total: number }
   */
  app.get<{
    Params: { id: string };
    Querystring: { page_type?: string; document_id?: string; limit?: string };
  }>("/api/v1/deals/:id/pages", async (request, reply) => {
    const { id } = request.params;
    const pageType = request.query.page_type?.trim() || undefined;
    const documentId = request.query.document_id?.trim() || undefined;
    const limitRaw = parseInt(request.query.limit ?? "100", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 100;

    // Verify deal exists
    const { rows: deals } = await pool.query<{ id: string }>(
      `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (deals.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const tableExists = await hasPageRegistryTable(pool);
    if (!tableExists) {
      return reply.send({ pages: [], total: 0 });
    }

    const pages = await queryPages(pool, id, { pageType, documentId, limit });
    return reply.send({ pages, total: pages.length });
  });

  /**
   * GET /api/v1/deals/:id/pages/search?q=...
   *
   * Query params:
   *   q     — required, search string
   *   limit — optional, 1–50 (default 10)
   *
   * Returns:
   *   { pages: PageRegistryRowV1[], query: string }
   */
  app.get<{
    Params: { id: string };
    Querystring: { q?: string; limit?: string };
  }>("/api/v1/deals/:id/pages/search", async (request, reply) => {
    const { id } = request.params;
    const q = request.query.q?.trim() ?? "";
    const limitRaw = parseInt(request.query.limit ?? "10", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 50)
      : 10;

    if (!q) {
      return reply.status(400).send({ error: "q parameter is required" });
    }

    // Verify deal exists
    const { rows: deals } = await pool.query<{ id: string }>(
      `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (deals.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const tableExists = await hasPageRegistryTable(pool);
    if (!tableExists) {
      return reply.send({ pages: [], query: q });
    }

    const pages = await searchPages(pool, id, q, limit);
    return reply.send({ pages, query: q });
  });
}
