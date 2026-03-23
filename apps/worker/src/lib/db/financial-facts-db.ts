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

// ─── Provenance packing/unpacking ──────────────────────────────────────────────

/**
 * Pack all provenance metadata fields from a FinancialFactV1 into a single
 * JSONB-compatible plain object for storage in `provenance_metadata`.
 *
 * Only includes keys that are actually present (no undefined padding).
 * Returns null when no provenance fields are set (non-XLSX sources, etc.).
 *
 * @internal — exported for unit tests only
 */
export function packProvenanceMetadata(f: FinancialFactV1): Record<string, unknown> | null {
  const m: Record<string, unknown> = {};
  if (f.value_kind !== undefined)                   m.value_kind = f.value_kind;
  if (f.formula !== undefined)                      m.formula = f.formula;
  if (f.cross_sheet_refs !== undefined)             m.cross_sheet_refs = f.cross_sheet_refs;
  if (f.named_range_refs !== undefined)             m.named_range_refs = f.named_range_refs;
  if (f.resolved_cross_sheet_values !== undefined)  m.resolved_cross_sheet_values = f.resolved_cross_sheet_values;
  if (f.formula_dependencies !== undefined)         m.formula_dependencies = f.formula_dependencies;
  if (f.dependency_depth !== undefined)             m.dependency_depth = f.dependency_depth;
  if (f.circular_reference_detected !== undefined)  m.circular_reference_detected = f.circular_reference_detected;
  if (f.temporal_scope !== undefined)               m.temporal_scope = f.temporal_scope;
  if (f.scenario !== undefined)                     m.scenario = f.scenario;
  if (f.cross_source_status !== undefined)          m.cross_source_status = f.cross_source_status;
  if (f.unit_scale_factor_applied !== undefined)    m.unit_scale_factor_applied = f.unit_scale_factor_applied;
  if (f.unit_scale_source_text !== undefined)       m.unit_scale_source_text = f.unit_scale_source_text;
  if (f.normalized_period_label !== undefined)      m.normalized_period_label = f.normalized_period_label;
  if (f.original_period_label !== undefined)        m.original_period_label = f.original_period_label;
  if (f.typing_reason !== undefined)                m.typing_reason = f.typing_reason;
  return Object.keys(m).length > 0 ? m : null;
}

/**
 * Unpack provenance metadata from the JSONB column back into FinancialFactV1 fields.
 * No-op when raw is null/undefined (pre-migration or non-XLSX facts).
 *
 * @internal — exported for unit tests only
 */
export function unpackProvenanceMetadata(raw: unknown, fact: FinancialFactV1): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const m = raw as Record<string, unknown>;
  if (m["value_kind"] != null)
    fact.value_kind = m["value_kind"] as FinancialFactV1["value_kind"];
  if ("formula" in m)
    fact.formula = m["formula"] as string | null;
  if (Array.isArray(m["cross_sheet_refs"]))
    fact.cross_sheet_refs = m["cross_sheet_refs"] as string[];
  if (Array.isArray(m["named_range_refs"]))
    fact.named_range_refs = m["named_range_refs"] as string[];
  if (Array.isArray(m["resolved_cross_sheet_values"]))
    fact.resolved_cross_sheet_values = m["resolved_cross_sheet_values"] as FinancialFactV1["resolved_cross_sheet_values"];
  if (Array.isArray(m["formula_dependencies"]))
    fact.formula_dependencies = m["formula_dependencies"] as FinancialFactV1["formula_dependencies"];
  if ("dependency_depth" in m)
    fact.dependency_depth = m["dependency_depth"] as number | null;
  if (m["circular_reference_detected"] === true)
    fact.circular_reference_detected = true;
  if (m["temporal_scope"] != null)
    fact.temporal_scope = m["temporal_scope"] as FinancialFactV1["temporal_scope"];
  if (m["scenario"] != null)
    fact.scenario = String(m["scenario"]);
  if (m["cross_source_status"] != null)
    fact.cross_source_status = m["cross_source_status"] as FinancialFactV1["cross_source_status"];
  if (m["unit_scale_factor_applied"] != null)
    fact.unit_scale_factor_applied = Number(m["unit_scale_factor_applied"]);
  if ("unit_scale_source_text" in m)
    fact.unit_scale_source_text = m["unit_scale_source_text"] as string | null;
  if (m["normalized_period_label"] != null)
    fact.normalized_period_label = String(m["normalized_period_label"]);
  if (m["original_period_label"] != null)
    fact.original_period_label = String(m["original_period_label"]);
  if (m["typing_reason"] != null)
    fact.typing_reason = String(m["typing_reason"]);
}

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
  // Columns (23 value cols + created_at):
  //   fact_id, deal_id, document_id, source_kind,
  //   metric_key, metric_label, period_type, period_label,
  //   value, unit, currency, confidence, reconciliation_status,
  //   sheet_name, page_number, row_index, col_index,
  //   source_pointer, evidence_id, excerpt,
  //   slide_type, slide_title,
  //   provenance_metadata
  const COL_COUNT = 23;
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
        $${base + 18}::text, $${base + 19}::text,
        $${base + 20}::text, $${base + 21}::text,
        $${base + 22}::jsonb)`
    );
    const provenanceMeta = packProvenanceMetadata(f);
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
      f.excerpt ?? null,
      f.slide_type ?? null,
      f.slide_title ?? null,
      provenanceMeta !== null ? JSON.stringify(provenanceMeta) : null
    );
  }

  const sql = `
    INSERT INTO public.financial_facts_v1
      (fact_id, deal_id, document_id, source_kind,
       metric_key, metric_label, period_type, period_label,
       value, unit, currency, confidence, reconciliation_status,
       sheet_name, page_number, row_index, col_index,
       source_pointer, evidence_id, excerpt,
       slide_type, slide_title,
       provenance_metadata)
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
      slide_type            = EXCLUDED.slide_type,
      slide_title           = EXCLUDED.slide_title,
      provenance_metadata   = EXCLUDED.provenance_metadata,
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
  const fact: FinancialFactV1 = {
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
  unpackProvenanceMetadata(r["provenance_metadata"], fact);
  return fact;
}
