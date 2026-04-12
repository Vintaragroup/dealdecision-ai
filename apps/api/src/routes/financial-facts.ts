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
import { buildFinancialCoverageV1 } from "@dealdecision/core";
import type { FinancialCoverageV1 } from "@dealdecision/core";
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
 * Unpack provenance metadata from the JSONB column back into FinancialFactV1 fields.
 * No-op when raw is null/undefined (pre-migration or non-XLSX facts).
 */
function unpackProvenanceMetadata(raw: unknown, fact: FinancialFactV1): void {
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
       source_pointer, evidence_id, excerpt,
       slide_type, slide_title,
       provenance_metadata
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
    sheet_name:    r["sheet_name"]     != null ? String(r["sheet_name"])     : undefined,
    page_number:   r["page_number"]    != null ? Number(r["page_number"])    : undefined,
    row_index:     r["row_index"]      != null ? Number(r["row_index"])      : undefined,
    col_index:     r["col_index"]      != null ? Number(r["col_index"])      : undefined,
    source_pointer:r["source_pointer"] != null ? String(r["source_pointer"]) : undefined,
    evidence_id:   r["evidence_id"]    != null ? String(r["evidence_id"])    : undefined,
    excerpt:       r["excerpt"]        != null ? String(r["excerpt"])        : undefined,
    slide_type:    r["slide_type"]     != null ? String(r["slide_type"])     : undefined,
    slide_title:   r["slide_title"]    != null ? String(r["slide_title"])    : undefined,
  };
  unpackProvenanceMetadata(r["provenance_metadata"], fact);
  return fact;
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

/**
 * Fetch financial facts for the /report route compiler.
 * Returns up to 200 facts for XLSX-sourced financial data injection.
 * Fail-open: always returns an empty array on error.
 */
export async function getFinancialFactsForReport(
  pool: PoolLike,
  dealId: string
): Promise<FinancialFactV1[]> {
  try {
    const tableExists = await hasFinancialFactsTable(pool);
    if (!tableExists) return [];
    return await queryFacts(pool, dealId, { limit: 200 });
  } catch {
    // Never crash /report on registry read failure
    return [];
  }
}

/**
 * Fetch document metadata (id, filename, kind, mime_type) for all non-deleted
 * documents belonging to a deal. Used by the report compiler to enrich cap-table
 * and XLSX detection when the DIO's inputs.documents lacks filenames.
 */
/**
 * Returns page_text strings from document_page_understanding rows that contain
 * high-signal report keywords used by compiler guards and capital-logic inference:
 * - going concern language (RC-002b)
 * - use-of-funds / use-of-proceeds / allocation language (RC-006)
 * - prior-funding historical raise language (RC-005)
 * Never crashes /report — returns [] on error.
 */
export async function getGoingConcernPageTexts(
  pool: PoolLike,
  dealId: string
): Promise<string[]> {
  try {
    const r = await pool.query<{ page_text: string }>(
      `SELECT dpu.payload->>'page_text' AS page_text
         FROM document_page_understanding dpu
         JOIN documents d ON d.id = dpu.document_id
        WHERE d.deal_id = $1
          AND d.deleted_at IS NULL
          AND dpu.payload->>'page_text' ~* 'ability[[:space:]]+to[[:space:]]+continue[[:space:]]+as[[:space:]]+a[[:space:]]+going[[:space:]]+concern|substantial[[:space:]]+doubt.*going[[:space:]]+concern|going[[:space:]]+concern.*substantial[[:space:]]+doubt|use[[:space:]]+of[[:space:]]+(funds|proceeds)|allocation[[:space:]]+of[[:space:]]+funds|capital[[:space:]]+allocation|spending[[:space:]]+plan|funds?[[:space:]]+will[[:space:]]+be[[:space:]]+used|funds?[[:space:]]+will[[:space:]]+primarily[[:space:]]+go[[:space:]]+towards|initial[[:space:]]+funds?[[:space:]]+.*go[[:space:]]+towards|proceeds?[[:space:]]+.*used[[:space:]]+for|previously[[:space:]]+(raised|funded|secured|closed)|prior[[:space:]]+(raised|funded|secured|closed)|already[[:space:]]+(raised|funded|secured|closed)|to[[:space:]]+date[[:space:]]+(raised|funded|secured|closed)|looking[[:space:]]+for[[:space:]]+(a[[:space:]]+|the[[:space:]]+|our[[:space:]]+)?(cto|chief[[:space:]]+technology[[:space:]]+officer)|seeking[[:space:]]+(a[[:space:]]+|the[[:space:]]+|our[[:space:]]+)?(cto|chief[[:space:]]+technology[[:space:]]+officer)|hiring[[:space:]]+(a[[:space:]]+|the[[:space:]]+|our[[:space:]]+)?(cto|chief[[:space:]]+technology[[:space:]]+officer)|cto[[:space:]]+(position|role|seat)[[:space:]]+(is[[:space:]]+)?(open|vacant|unfilled|needed|available)|form[[:space:]]+10-?k|form[[:space:]]+10-?q|form[[:space:]]+8-?k|form[[:space:]]+s-?1|registration[[:space:]]+statement|annual[[:space:]]+report[[:space:]]+pursuant[[:space:]]+to[[:space:]]+section[[:space:]]+13|quarterly[[:space:]]+report[[:space:]]+pursuant[[:space:]]+to[[:space:]]+section[[:space:]]+13'`,
      [dealId],
    );
    return (r.rows ?? []).map((row) => row.page_text).filter((t) => typeof t === 'string' && t.length > 0);
  } catch {
    // Never crash /report if page understanding is unavailable.
    return [];
  }
}

export async function getDocumentsForReport(
  pool: PoolLike,
  dealId: string
): Promise<Array<{ document_id: string; filename: string | null; kind: string | null; mime_type: string | null }>> {
  try {
    const r = await pool.query<{ document_id: string; filename: string | null; kind: string | null; mime_type: string | null }>(
      `SELECT d.id AS document_id,
              df.file_name AS filename,
              d.type AS kind,
              COALESCE(df.mime_type, d.mime_type) AS mime_type
         FROM documents d
         LEFT JOIN document_files df ON df.document_id = d.id
        WHERE d.deal_id = $1
          AND d.deleted_at IS NULL`,
      [dealId],
    );
    return r.rows ?? [];
  } catch {
    // Never crash /report if document metadata is unavailable.
    return [];
  }
}

// ─── RC-S6-009/010/008: Document full-text extraction helpers ─────────────────

/**
 * Extracts a candidate company name from a document's full_text.
 * Tries copyright/watermark patterns first, then legal entity patterns, then early short lines.
 * Returns null if no candidate found.
 */
function extractCompanyNameFromFullText(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const head = text.slice(0, 8000);

  // 1. Copyright/watermark: "©2026 Climatic Capital ·" pattern
  const copyright = head.match(/©\s*\d{4}\s+([A-Z][A-Za-z0-9&\s.'-]{2,50}?)(?:\s+(?:Global|·)\b|\s{2,})/);
  if (copyright?.[1]) {
    const candidate = copyright[1].trim();
    if (candidate.length >= 3 && candidate.length <= 60 && !/\b(Confidential|Commercial|Proprietary)\b/i.test(candidate)) {
      return candidate;
    }
  }

  // 2. Legal entity: "Company Name Inc/LLC/Ltd/Corp/Holdings/Capital Management"
  const legal = head.match(
    /\b([A-Z][A-Za-z0-9&.'-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'-]{1,40}){0,4})\s+(?:Inc\.?|LLC\.?|Ltd\.?|Corporation|Corp\.?|GmbH|Holdings|Capital\s+Management|Capital\s+Partners)\b/,
  );
  if (legal?.[1]) {
    const candidate = legal[1].trim();
    if (candidate.length >= 3 && candidate.length <= 60 && !/^(This|The|Our|For|Any|Such|Each|When)\b/i.test(candidate)) {
      return candidate;
    }
  }

  // 3. Short early lines (title case or ALLCAPS, no colon, no generic headings)
  const lines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 70 && !l.includes(':'));
  for (const line of lines.slice(0, 15)) {
    if (
      /^[A-Z][A-Za-z0-9\s&.'-]{2,50}$/.test(line) &&
      line.split(/\s+/).length <= 6 &&
      !/^(?:Confidential|Proprietary|Disclaimer|Contents|Overview|Introduction|Executive\s+Summary|Pitch|Deck|Slide)/i.test(line)
    ) {
      return line;
    }
  }

  return null;
}

/**
 * Returns the full_text of documents for a deal (up to 50K chars each, max 3 docs).
 * Used by the report compiler to extract team highlights, fund signals, and UOF breakdowns.
 * Never crashes.
 */
export async function getDocumentFullTextForDeal(
  pool: PoolLike,
  dealId: string,
): Promise<string[]> {
  try {
    const r = await pool.query<{ full_text: string }>(
      `SELECT SUBSTR(full_text, 1, 50000) AS full_text
         FROM documents
        WHERE deal_id = $1
          AND deleted_at IS NULL
          AND full_text IS NOT NULL
          AND CHAR_LENGTH(full_text) > 0
        ORDER BY uploaded_at DESC
        LIMIT 3`,
      [dealId],
    );
    return (r.rows ?? []).map((row) => row.full_text).filter((t) => typeof t === 'string' && t.length > 0);
  } catch {
    return [];
  }
}

/**
 * Returns the best candidate company name extracted from document full_text for a deal.
 * Used by the report compiler to populate structured_summary.company_name.
 * Never crashes.
 */
export async function getCompanyNameFromDocuments(
  pool: PoolLike,
  dealId: string,
): Promise<string | null> {
  try {
    const r = await pool.query<{ full_text: string }>(
      `SELECT SUBSTR(full_text, 1, 8000) AS full_text
         FROM documents
        WHERE deal_id = $1
          AND deleted_at IS NULL
          AND full_text IS NOT NULL
          AND CHAR_LENGTH(full_text) > 0
        ORDER BY uploaded_at DESC
        LIMIT 3`,
      [dealId],
    );
    const texts = (r.rows ?? []).map((row) => row.full_text).filter((t) => typeof t === 'string' && t.length > 0);
    for (const text of texts) {
      const name = extractCompanyNameFromFullText(text);
      if (name) return name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the max created_at timestamp across all financial_facts_v1 rows for a deal.
 * Returns null when no facts exist or the table is absent.
 * Used by the staleness detector to determine if facts are newer than the compiled report.
 */
export async function getFinancialFactsMaxTimestamp(
  pool: PoolLike,
  dealId: string
): Promise<Date | null> {
  try {
    const tableExists = await hasFinancialFactsTable(pool);
    if (!tableExists) return null;
    const r = await pool.query<{ max_ts: Date | null }>(
      `SELECT max(created_at) AS max_ts FROM financial_facts_v1 WHERE deal_id = $1`,
      [dealId],
    );
    return r.rows?.[0]?.max_ts ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a FinancialCoverageV1 for a deal.
 * Fetches all facts then runs buildFinancialCoverageV1 (pure, no LLM).
 * Returns null when the table doesn't exist or facts are absent.
 */
export async function getFinancialCoverageForChat(
  pool: PoolLike,
  dealId: string
): Promise<FinancialCoverageV1 | null> {
  try {
    const tableExists = await hasFinancialFactsTable(pool);
    if (!tableExists) return null;
    const facts = await queryFacts(pool, dealId, { limit: 200 });
    if (facts.length === 0) return null;
    return buildFinancialCoverageV1(dealId, facts);
  } catch {
    return null;
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

  /**
   * GET /api/v1/deals/:id/financial-coverage
   *
   * Returns a FinancialCoverageV1 report for the deal:
   *   - Which financial statements are represented
   *   - Which periods are covered
   *   - Metrics present vs. expected-but-missing
   *   - Any intra-registry conflicts
   *   - Confidence distribution
   *
   * Returns { coverage: null } when no facts exist yet.
   */
  app.get<{
    Params: { id: string };
  }>("/api/v1/deals/:id/financial-coverage", async (request, reply) => {
    const { id } = request.params;

    const { rows: deals } = await pool.query<{ id: string }>(
      `SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (deals.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    const coverage = await getFinancialCoverageForChat(pool, id);
    return reply.send({ coverage });
  });
}
