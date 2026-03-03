/**
 * deal-facts-db.ts
 *
 * DB persistence layer for DealFactV1.
 * Table: public.deal_facts_v1
 * Primary key: fact_id (deterministic text)
 * Upsert is idempotent: re-runs overwrite the same fact_id row.
 */

import type { Pool } from "pg";
import type { DealFactV1 } from "@dealdecision/core";
import { validateDealFact } from "@dealdecision/core";

// ─── Type guard ───────────────────────────────────────────────────────────────

type PoolLike = { query: Pool["query"] };

async function hasDealFactsTable(pool: PoolLike): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      `SELECT to_regclass('public.deal_facts_v1') AS oid`
    );
    return rows[0]?.oid != null;
  } catch {
    return false;
  }
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Upsert a batch of DealFactV1 rows into public.deal_facts_v1.
 *
 * - Validates each fact (drops invalid ones quietly).
 * - Executes a single multi-row upsert when there are valid facts.
 * - Idempotent: ON CONFLICT (fact_id) DO UPDATE overwrites all mutable fields.
 * - Returns the count of facts successfully upserted.
 */
export async function upsertDealFactsV1(
  pool: Pool,
  facts: DealFactV1[],
): Promise<number> {
  if (facts.length === 0) return 0;

  if (!(await hasDealFactsTable(pool as unknown as PoolLike))) return 0;

  const valid = facts
    .map((f) => validateDealFact(f))
    .filter((f): f is DealFactV1 => f !== null);

  if (valid.length === 0) return 0;

  // 12 columns:
  //   fact_id, deal_id, type, label,
  //   value, timeframe, confidence,
  //   sources, page_refs, conflicts_with_fact_ids,
  //   created_at (skipped — DB default), updated_at (NOW())
  // We upsert 12 values; created_at uses DB DEFAULT on insert.
  const COL_COUNT = 11;
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (let i = 0; i < valid.length; i++) {
    const f = valid[i]!;
    const base = i * COL_COUNT + 1;
    rowPlaceholders.push(
      `($${base}::text, $${base + 1}::uuid, $${base + 2}::text, $${base + 3}::text,
        $${base + 4}::jsonb, $${base + 5}::text, $${base + 6}::text,
        $${base + 7}::jsonb, $${base + 8}::jsonb, $${base + 9}::jsonb,
        $${base + 10}::timestamptz)`
    );
    params.push(
      f.fact_id,
      f.deal_id,
      f.type,
      f.label,
      JSON.stringify(f.value),
      f.timeframe ?? null,
      f.confidence,
      JSON.stringify(f.sources ?? []),
      JSON.stringify(f.page_refs ?? []),
      JSON.stringify(f.conflicts_with_fact_ids ?? []),
      new Date().toISOString(),
    );
  }

  const sql = `
    INSERT INTO public.deal_facts_v1 (
      fact_id, deal_id, type, label,
      value, timeframe, confidence,
      sources, page_refs, conflicts_with_fact_ids,
      updated_at
    )
    VALUES ${rowPlaceholders.join(",\n    ")}
    ON CONFLICT (fact_id) DO UPDATE SET
      type                    = EXCLUDED.type,
      label                   = EXCLUDED.label,
      value                   = EXCLUDED.value,
      timeframe               = EXCLUDED.timeframe,
      confidence              = EXCLUDED.confidence,
      sources                 = EXCLUDED.sources,
      page_refs               = EXCLUDED.page_refs,
      conflicts_with_fact_ids = EXCLUDED.conflicts_with_fact_ids,
      updated_at              = EXCLUDED.updated_at
  `;

  await (pool as unknown as PoolLike).query(sql, params);
  return valid.length;
}

// ─── Query ────────────────────────────────────────────────────────────────────

export interface GetDealFactsV1Opts {
  type?: string | string[];
  confidence?: "high" | "medium" | "low";
  limit?: number;
}

/**
 * Retrieve DealFactV1 rows for a deal.
 * Returns empty array if table doesn't exist (migration not yet applied).
 */
export async function getDealFactsV1ForDeal(
  pool: Pool,
  dealId: string,
  opts: GetDealFactsV1Opts = {},
): Promise<DealFactV1[]> {
  try {
    if (!(await hasDealFactsTable(pool as unknown as PoolLike))) return [];

    const conditions: string[] = ["deal_id = $1"];
    const params: unknown[] = [dealId];

    if (opts.type) {
      const types = Array.isArray(opts.type) ? opts.type : [opts.type];
      const placeholders = types.map((_, i) => `$${params.length + i + 1}`);
      conditions.push(`type = ANY(ARRAY[${placeholders.join(", ")}]::text[])`);
      params.push(...types);
    }

    if (opts.confidence) {
      params.push(opts.confidence);
      conditions.push(`confidence = $${params.length}`);
    }

    const limit = Math.min(opts.limit ?? 120, 500);
    params.push(limit);

    const sql = `
      SELECT
        fact_id, deal_id, type, label,
        value, timeframe, confidence,
        sources, page_refs, conflicts_with_fact_ids,
        created_at, updated_at
      FROM public.deal_facts_v1
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        type,
        updated_at DESC
      LIMIT $${params.length}
    `;

    const { rows } = await (pool as unknown as PoolLike).query<Record<string, unknown>>(sql, params);
    return rows.map(rowToDealFact).filter((f): f is DealFactV1 => f !== null);
  } catch {
    return [];
  }
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "object") return raw as T; // pg already parses jsonb
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

function rowToDealFact(row: Record<string, unknown>): DealFactV1 | null {
  try {
    return {
      fact_id:                  String(row["fact_id"]),
      deal_id:                  String(row["deal_id"]),
      type:                     String(row["type"]) as DealFactV1["type"],
      label:                    String(row["label"]),
      value:                    safeParseJson(row["value"], { kind: "unknown", reason: "parse error" }),
      timeframe:                row["timeframe"] ? String(row["timeframe"]) : undefined,
      confidence:               String(row["confidence"]) as DealFactV1["confidence"],
      sources:                  safeParseJson(row["sources"], []),
      page_refs:                safeParseJson(row["page_refs"], []),
      conflicts_with_fact_ids:  safeParseJson(row["conflicts_with_fact_ids"], []),
      created_at:               row["created_at"] ? String(row["created_at"]) : undefined,
      updated_at:               row["updated_at"] ? String(row["updated_at"]) : undefined,
    };
  } catch {
    return null;
  }
}
