/**
 * financial-facts-db.ts
 *
 * DB persistence for FinancialFactV1.
 * Table: public.financial_facts_v1
 * Primary key: fact_id (deterministic text)
 * Upsert is idempotent: re-runs overwrite the same fact_id row.
 */

import type { Pool } from "pg";
import type { FinancialFactV1 } from "@dealdecision/core";
import { validateFinancialFact } from "@dealdecision/core";

/**
 * Upsert a batch of FinancialFactV1 rows into public.financial_facts_v1.
 *
 * - Validates each fact (drops invalid ones quietly).
 * - Executes a single multi-row upsert when there are valid rows.
 * - Idempotent: ON CONFLICT (fact_id) DO UPDATE overwrites all mutable fields.
 * - Returns the count of facts that were successfully upserted.
 */
export async function upsertFinancialFactsV1(
  pool: Pool,
  facts: FinancialFactV1[]
): Promise<number> {
  if (facts.length === 0) return 0;

  // Validate + filter
  const valid = facts
    .map((f) => validateFinancialFact(f))
    .filter((f): f is FinancialFactV1 => f !== null);

  if (valid.length === 0) return 0;

  // Build parameterised multi-row upsert
  // Columns (18 value cols + created_at):
  //   fact_id, deal_id, document_id, source_kind,
  //   metric_key, metric_label, period_type, period_label,
  //   value, unit, currency, confidence, reconciliation_status,
  //   sheet_name, page_number, row_index, col_index,
  //   source_pointer, evidence_id, excerpt
  const COL_COUNT = 20;
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (let i = 0; i < valid.length; i++) {
    const f = valid[i];
    const base = i * COL_COUNT + 1;
    rowPlaceholders.push(
      `($${base}::text, $${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::text,
        $${base + 4}::text, $${base + 5}::text, $${base + 6}::text, $${base + 7}::text,
        $${base + 8}::numeric, $${base + 9}::text, $${base + 10}::text, $${base + 11}::text,
        $${base + 12}::text, $${base + 13}::text, $${base + 14}::int,
        $${base + 15}::int, $${base + 16}::int, $${base + 17}::text,
        $${base + 18}::text, $${base + 19}::text)`
    );
    params.push(
      f.fact_id,
      f.deal_id,
      f.document_id ?? null,
      f.source_kind,
      f.metric_key,
      f.metric_label ?? null,
      f.period_type,
      f.period_label,
      f.value,
      f.unit,
      f.currency ?? null,
      f.confidence,
      f.reconciliation_status ?? null,
      f.sheet_name ?? null,
      f.page_number ?? null,
      f.row_index ?? null,
      f.col_index ?? null,
      f.source_pointer ?? null,
      f.evidence_id ?? null,
      f.excerpt ?? null
    );
  }

  const sql = `
    INSERT INTO public.financial_facts_v1
      (fact_id, deal_id, document_id, source_kind,
       metric_key, metric_label, period_type, period_label,
       value, unit, currency, confidence, reconciliation_status,
       sheet_name, page_number, row_index, col_index,
       source_pointer, evidence_id, excerpt)
    VALUES ${rowPlaceholders.join(",\n    ")}
    ON CONFLICT (fact_id) DO UPDATE SET
      document_id           = EXCLUDED.document_id,
      source_kind           = EXCLUDED.source_kind,
      metric_label          = EXCLUDED.metric_label,
      period_type           = EXCLUDED.period_type,
      value                 = EXCLUDED.value,
      unit                  = EXCLUDED.unit,
      currency              = EXCLUDED.currency,
      confidence            = EXCLUDED.confidence,
      reconciliation_status = EXCLUDED.reconciliation_status,
      sheet_name            = EXCLUDED.sheet_name,
      page_number           = EXCLUDED.page_number,
      row_index             = EXCLUDED.row_index,
      col_index             = EXCLUDED.col_index,
      source_pointer        = EXCLUDED.source_pointer,
      evidence_id           = EXCLUDED.evidence_id,
      excerpt               = EXCLUDED.excerpt,
      updated_at            = now()
  `;

  await pool.query(sql, params);
  return valid.length;
}

/**
 * Fetch FinancialFactV1 rows for a deal, ordered most-recent period first.
 *
 * @param pool
 * @param dealId
 * @param opts.metricKey - optional filter by metric_key
 * @param opts.limit - max rows (default 25)
 */
export async function getFinancialFactsForDeal(
  pool: Pool,
  dealId: string,
  opts: { metricKey?: string; limit?: number } = {}
): Promise<FinancialFactV1[]> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const params: unknown[] = [dealId, limit];
  const metricFilter = opts.metricKey
    ? `AND metric_key = $3::text`
    : "";
  if (opts.metricKey) params.splice(2, 0, opts.metricKey);

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       fact_id, deal_id, document_id::text, source_kind,
       metric_key, metric_label, period_type, period_label,
       value::float8, unit, currency, confidence, reconciliation_status,
       sheet_name, page_number, row_index, col_index,
       source_pointer, evidence_id, excerpt
     FROM public.financial_facts_v1
     WHERE deal_id = $1::uuid
     ${metricFilter}
     ORDER BY
       -- Prefer annual + most recent period label (lexicographic desc)
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

  return rows.map((r) => rowToFact(r));
}

// ─── Internal mapper ──────────────────────────────────────────────────────────

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
    sheet_name:    r["sheet_name"]    != null ? String(r["sheet_name"])    : undefined,
    page_number:   r["page_number"]   != null ? Number(r["page_number"])   : undefined,
    row_index:     r["row_index"]     != null ? Number(r["row_index"])     : undefined,
    col_index:     r["col_index"]     != null ? Number(r["col_index"])     : undefined,
    source_pointer:r["source_pointer"]!= null ? String(r["source_pointer"]): undefined,
    evidence_id:   r["evidence_id"]   != null ? String(r["evidence_id"])   : undefined,
    excerpt:       r["excerpt"]       != null ? String(r["excerpt"])       : undefined,
  };
}
