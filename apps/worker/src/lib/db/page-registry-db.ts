/**
 * page-registry-db.ts
 *
 * DB persistence for PageRegistryRowV1.
 * Table: public.page_registry_v1
 * Primary key: page_id (deterministic text)
 * Upsert is idempotent: re-runs overwrite the same page_id row.
 */

import type { Pool } from "pg";
import type { PageRegistryRowV1 } from "@dealdecision/core";
import { validatePageRegistryRow } from "@dealdecision/core";

/**
 * Upsert a batch of PageRegistryRowV1 rows into public.page_registry_v1.
 *
 * - Validates each row (drops invalid ones quietly).
 * - Executes a single multi-row upsert when there are valid rows.
 * - Idempotent: ON CONFLICT (page_id) DO UPDATE overwrites all mutable fields.
 * - Returns the count of rows that were successfully upserted.
 */
export async function upsertPageRegistryRowsV1(
  pool: Pool,
  rows: PageRegistryRowV1[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const valid = rows
    .map((r) => validatePageRegistryRow(r))
    .filter((r): r is PageRegistryRowV1 => r !== null);

  if (valid.length === 0) return 0;

  // 11 value columns per row:
  // page_id, deal_id, document_id, page_number,
  // page_type, confidence,
  // entities, numeric_claims, key_claims, evidence_ids, excerpt
  const COL_COUNT = 11;
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const base = i * COL_COUNT + 1;
    rowPlaceholders.push(
      `($${base}::text, $${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::int,
        $${base + 4}::text, $${base + 5}::text,
        $${base + 6}::jsonb, $${base + 7}::jsonb, $${base + 8}::jsonb,
        $${base + 9}::jsonb, $${base + 10}::text)`
    );
    params.push(
      r.page_id,
      r.deal_id,
      r.document_id,
      r.page_number,
      r.page_type,
      r.confidence,
      JSON.stringify(r.entities),
      JSON.stringify(r.numeric_claims),
      JSON.stringify(r.key_claims),
      JSON.stringify(r.evidence_ids),
      r.excerpt ?? null
    );
  }

  const sql = `
    INSERT INTO public.page_registry_v1
      (page_id, deal_id, document_id, page_number,
       page_type, confidence,
       entities, numeric_claims, key_claims,
       evidence_ids, excerpt)
    VALUES ${rowPlaceholders.join(",\n    ")}
    ON CONFLICT (page_id) DO UPDATE SET
      page_type        = EXCLUDED.page_type,
      confidence       = EXCLUDED.confidence,
      entities         = EXCLUDED.entities,
      numeric_claims   = EXCLUDED.numeric_claims,
      key_claims       = EXCLUDED.key_claims,
      evidence_ids     = EXCLUDED.evidence_ids,
      excerpt          = EXCLUDED.excerpt,
      updated_at       = now()
  `;

  await pool.query(sql, params);
  return valid.length;
}

/**
 * Query page registry rows for a deal.
 *
 * @param pool
 * @param dealId
 * @param opts.pageType  — optional filter
 * @param opts.documentId — optional filter
 * @param opts.limit — default 100, max 500
 */
export async function queryPageRegistryForDeal(
  pool: Pool,
  dealId: string,
  opts: { pageType?: string; documentId?: string; limit?: number } = {}
): Promise<PageRegistryRowV1[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
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
  params.push(limit);

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

/**
 * Simple full-text search over excerpt + key_claims text.
 * Returns top N rows ordered by deal/document/page.
 */
export async function searchPageRegistry(
  pool: Pool,
  dealId: string,
  query: string,
  limit = 10
): Promise<PageRegistryRowV1[]> {
  const safeLimit = Math.min(limit, 50);
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
    [dealId, likePat, safeLimit]
  );

  return rows.map(rowToRegistryRow);
}

// ─── Internal mapper ──────────────────────────────────────────────────────────

function rowToRegistryRow(r: Record<string, unknown>): PageRegistryRowV1 {
  return {
    page_id:        String(r["page_id"] ?? ""),
    deal_id:        String(r["deal_id"] ?? ""),
    document_id:    String(r["document_id"] ?? ""),
    page_number:    Number(r["page_number"] ?? 0),
    page_type:      (r["page_type"] as PageRegistryRowV1["page_type"]) ?? "unknown",
    confidence:     (r["confidence"] as PageRegistryRowV1["confidence"]) ?? "low",
    entities:       Array.isArray(r["entities"]) ? r["entities"] as PageRegistryRowV1["entities"] : [],
    numeric_claims: Array.isArray(r["numeric_claims"]) ? r["numeric_claims"] as PageRegistryRowV1["numeric_claims"] : [],
    key_claims:     Array.isArray(r["key_claims"]) ? r["key_claims"] as PageRegistryRowV1["key_claims"] : [],
    evidence_ids:   Array.isArray(r["evidence_ids"]) ? (r["evidence_ids"] as string[]) : [],
    excerpt:        r["excerpt"] != null ? String(r["excerpt"]) : undefined,
  };
}
