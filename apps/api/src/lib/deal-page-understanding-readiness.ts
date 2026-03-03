import type { Pool } from "pg";

type PoolLike = { query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> };

/** Check whether a column exists in information_schema — fail-soft returns false on error. */
async function hasColumn(pool: PoolLike, table: string, column: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, column]
    );
    return rows?.[0]?.exists === true;
  } catch {
    return false;
  }
}

export type PageUnderstandingReadinessDocument = {
  document_id: string;
  title: string | null;
  page_count: number;
  /** Total DPU rows present for expected pages (including placeholders). */
  dpu_rows: number;
  /** Pages considered "done" for completion metrics (page_text_empty=false). */
  dpu_rows_meaningful?: number;
  /** Pages that have a DPU row but it is placeholder/empty. */
  non_meaningful_pages?: number[];
  /** Pages missing for completion metrics (expected - done). Includes empty pages + hard-missing pages. */
  missing_pages: number[];
  /** Pages that do not have any DPU row at all (payload is NULL). */
  hard_missing_pages?: number[];
};

export type PageUnderstandingReadiness = {
  deal_id: string;
  version: string;
  documents: PageUnderstandingReadinessDocument[];
  expected_pages_total: number;
  dpu_rows_total: number;
  dpu_rows_meaningful_total?: number;
  non_meaningful_pages_total?: number;
  missing_pages_total: number;
  /** Pages that are truly missing (no DPU payload row) across all documents. */
  hard_missing_pages_total?: number;
  /** Max(document_page_understanding.created_at) for the deal+version, when available. */
  latest_dpu_created_at?: string | null;
  /**
   * When readiness indicates missing pages but the pipeline has no work enqueued,
   * this field explains why readiness may not be progressing.
   */
  blocked_reason?: string | null;
  poll_after_ms?: number | null;
  action?: { type: string; deal_id?: string; document_id?: string; version?: string } | null;
  ready: boolean;
};

async function hasTable(pool: PoolLike, table: string) {
  try {
    const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
    return rows?.[0]?.oid !== null;
  } catch {
    return false;
  }
}

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const normalizeMissingPages = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    const n = toInt(v, -1);
    if (n >= 0) out.push(n);
  }
  // ensure deterministic ordering + unique
  out.sort((a, b) => a - b);
  return out.filter((v, i) => (i === 0 ? true : v !== out[i - 1]));
};

export function computePageUnderstandingReadiness(args: {
  dealId: string;
  version: string;
  documents: Array<{
    document_id: string;
    title: string | null;
    page_count: number | null;
    dpu_rows: number | null;
    dpu_rows_meaningful?: number | null;
    non_meaningful_pages?: unknown;
    missing_pages: unknown;
    hard_missing_pages?: unknown;
  }>;
}): PageUnderstandingReadiness {
  const docs: PageUnderstandingReadinessDocument[] = (args.documents ?? []).map((d) => {
    const pageCount = Math.max(0, toInt(d.page_count, 0));
    const dpuRows = Math.max(0, toInt(d.dpu_rows, 0));
    const dpuRowsMeaningful =
      typeof (d as any)?.dpu_rows_meaningful === "number" && Number.isFinite((d as any).dpu_rows_meaningful)
        ? Math.max(0, Math.trunc((d as any).dpu_rows_meaningful))
        : undefined;
    const missingPages = normalizeMissingPages(d.missing_pages);
    const nonMeaningfulPages = normalizeMissingPages((d as any).non_meaningful_pages);
    const hardMissingRaw = (d as any).hard_missing_pages;
    const hasHardMissing = Array.isArray(hardMissingRaw);
    const hardMissingPages = normalizeMissingPages(hardMissingRaw);

    return {
      document_id: String(d.document_id),
      title: d.title ?? null,
      page_count: pageCount,
      dpu_rows: dpuRows,
      ...(typeof dpuRowsMeaningful === "number" ? { dpu_rows_meaningful: dpuRowsMeaningful } : {}),
      ...(nonMeaningfulPages.length > 0 ? { non_meaningful_pages: nonMeaningfulPages } : {}),
      missing_pages: missingPages,
      ...(hasHardMissing ? { hard_missing_pages: hardMissingPages } : {}),
    };
  });

  let expectedPagesTotal = 0;
  let dpuRowsTotal = 0;
  let dpuRowsMeaningfulTotal = 0;
  let nonMeaningfulPagesTotal = 0;
  let missingPagesTotal = 0;
  let hardMissingPagesTotal = 0;
  const hasHardMissingFieldAny = docs.some((d: any) => Array.isArray(d?.hard_missing_pages));

  for (const d of docs) {
    expectedPagesTotal += d.page_count;
    dpuRowsTotal += d.dpu_rows;
    dpuRowsMeaningfulTotal += typeof d.dpu_rows_meaningful === "number" ? d.dpu_rows_meaningful : 0;
    nonMeaningfulPagesTotal += Array.isArray(d.non_meaningful_pages) ? d.non_meaningful_pages.length : 0;
    missingPagesTotal += d.missing_pages.length;
    // Back-compat: if hard_missing_pages is not provided, treat missing_pages as hard-missing.
    hardMissingPagesTotal += Array.isArray((d as any).hard_missing_pages)
      ? (d as any).hard_missing_pages.length
      : d.missing_pages.length;
  }

  return {
    deal_id: args.dealId,
    version: args.version,
    documents: docs,
    expected_pages_total: expectedPagesTotal,
    dpu_rows_total: dpuRowsTotal,
    ...(dpuRowsMeaningfulTotal > 0 ? { dpu_rows_meaningful_total: dpuRowsMeaningfulTotal } : {}),
    ...(nonMeaningfulPagesTotal > 0 ? { non_meaningful_pages_total: nonMeaningfulPagesTotal } : {}),
    missing_pages_total: missingPagesTotal,
    ...(hasHardMissingFieldAny ? { hard_missing_pages_total: hardMissingPagesTotal } : {}),
    blocked_reason: null,
    poll_after_ms: null,
    action: null,
    // Ready for analysis when no pages are truly missing (payload row absent).
    ready: hardMissingPagesTotal === 0,
  };
}

/**
 * Fail-soft wrapper: returns a not-ready readiness payload with blocked_reason
 * READINESS_COMPUTE_ERROR instead of throwing when a query or migration issue
 * prevents normal computation.
 */
function makeErrorFallbackReadiness(dealId: string, version: string, errorHint: string): PageUnderstandingReadiness {
  return {
    deal_id: dealId,
    version,
    documents: [],
    expected_pages_total: 0,
    dpu_rows_total: 0,
    missing_pages_total: 0,
    hard_missing_pages_total: 0,
    blocked_reason: "READINESS_COMPUTE_ERROR",
    poll_after_ms: 2000,
    action: null,
    ready: false,
    ...(errorHint ? { error_hint: errorHint } : {}),
  } as PageUnderstandingReadiness & { error_hint?: string };
}

export async function fetchPageUnderstandingReadinessForDeal(pool: Pool, dealId: string, version: string): Promise<PageUnderstandingReadiness> {
  try {
    return await _fetchPageUnderstandingReadinessForDealInner(pool as any, dealId, version);
  } catch (err) {
    const hint = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    return makeErrorFallbackReadiness(dealId, version, hint);
  }
}

async function _fetchPageUnderstandingReadinessForDealInner(pool: PoolLike, dealId: string, version: string): Promise<PageUnderstandingReadiness> {
  const dpuTableOk = await hasTable(pool, "document_page_understanding");

  // Probe for optional columns so we can build XLSX-aware SQL only when available.
  // These columns may not exist in older migrations or test environments.
  const hasFileName = await hasColumn(pool, "documents", "file_name");
  const hasFilename = !hasFileName && await hasColumn(pool, "documents", "filename");
  const hasMimeType = await hasColumn(pool, "documents", "mime_type");

  // Expressions that safely alias to '' when the column is missing.
  const fileNameExpr = hasFileName ? "COALESCE(file_name, '')" : hasFilename ? "COALESCE(filename, '')" : "''";
  const mimeTypeExpr = hasMimeType ? "COALESCE(mime_type, '')" : "''";
  // Only emit the xlsx_docs CTE when we have at least one identification column.
  const canDetectXlsx = hasFileName || hasFilename || hasMimeType;

  // xlsx_docs CTE fragment — only included when columns are available.
  // When columns are absent we fall through and treat all docs as page-based (pre-existing behavior).
  const xlsxDocsCte = canDetectXlsx
    ? `
      -- Spreadsheet documents use structured extraction (not rendered page images).
      -- Exclude them from page-based expected pages so they never appear as "missing pages".
      xlsx_docs AS (
        SELECT document_id FROM docs
         WHERE lower(${fileNameExpr}) LIKE '%.xlsx'
            OR lower(${fileNameExpr}) LIKE '%.xls'
            OR lower(${mimeTypeExpr}) LIKE '%spreadsheet%'
      ),`
    : "";

  const xlsxExclusionClause = canDetectXlsx
    ? "\n           AND document_id NOT IN (SELECT document_id FROM xlsx_docs)"
    : "";

  type Row = {
    document_id: string;
    title: string | null;
    page_count: number | null;
    dpu_rows: number | null;
    dpu_rows_meaningful?: number | null;
    non_meaningful_pages?: number[] | null;
    missing_pages: number[] | null;
    hard_missing_pages?: number[] | null;
  };

  let rows: Row[] = [];

  if (dpuTableOk) {
    const res = await pool.query<Row>(
      `
      WITH docs AS (
        SELECT id AS document_id,
               title,
               COALESCE(page_count, 0) AS page_count,
               ${fileNameExpr} AS file_name,
               ${mimeTypeExpr} AS mime_type
          FROM documents
         WHERE deal_id = $1
           AND deleted_at IS NULL
      ),${xlsxDocsCte}
      expected AS (
        SELECT document_id, generate_series(0, page_count - 1) AS page_index
          FROM docs
         WHERE page_count > 0${xlsxExclusionClause}
      ),
      dpu_all AS (
        SELECT dpu.document_id, dpu.page_index, dpu.payload
          FROM document_page_understanding dpu
          JOIN docs d ON d.document_id = dpu.document_id
         WHERE dpu.version = $2
      ),
      dpu_expected AS (
        SELECT e.document_id, e.page_index, a.payload
          FROM expected e
          LEFT JOIN dpu_all a
            ON a.document_id = e.document_id
           AND a.page_index = e.page_index
      ),
      dpu_done AS (
        -- Done pages: a row exists AND page_text_empty=false.
        SELECT document_id, page_index
          FROM dpu_expected
         WHERE payload IS NOT NULL
           AND COALESCE((payload->'quality_flags'->>'page_text_empty')::boolean, false) = false
      ),
      hard_missing AS (
        -- Hard-missing pages: no DPU payload row at all.
        SELECT document_id, page_index
          FROM dpu_expected
         WHERE payload IS NULL
      ),
      non_meaningful AS (
        -- Non-meaningful pages: a row exists but page_text_empty=true.
        SELECT document_id, page_index
          FROM dpu_expected
         WHERE payload IS NOT NULL
           AND COALESCE((payload->'quality_flags'->>'page_text_empty')::boolean, false) = true
      ),
      missing AS (
        -- Missing for completion metrics: expected pages that are not done.
        SELECT e.document_id, e.page_index
          FROM expected e
          LEFT JOIN dpu_done d
            ON d.document_id = e.document_id
           AND d.page_index = e.page_index
         WHERE d.page_index IS NULL
      ),
      dpu_counts AS (
        SELECT d.document_id,
          COUNT(*) FILTER (WHERE e.payload IS NOT NULL) AS dpu_rows,
          COUNT(*) FILTER (WHERE dn.page_index IS NOT NULL) AS dpu_rows_meaningful
          FROM docs d
        LEFT JOIN dpu_expected e ON e.document_id = d.document_id
        LEFT JOIN dpu_done dn ON dn.document_id = e.document_id AND dn.page_index = e.page_index
         GROUP BY d.document_id
      )
      SELECT d.document_id,
             d.title,
             d.page_count,
             COALESCE(c.dpu_rows, 0) AS dpu_rows,
             COALESCE(c.dpu_rows_meaningful, 0) AS dpu_rows_meaningful,
             COALESCE((SELECT array_agg(n.page_index ORDER BY n.page_index) FROM non_meaningful n WHERE n.document_id = d.document_id), '{}'::int[]) AS non_meaningful_pages,
             COALESCE((SELECT array_agg(m.page_index ORDER BY m.page_index) FROM missing m WHERE m.document_id = d.document_id), '{}'::int[]) AS missing_pages,
             COALESCE((SELECT array_agg(h.page_index ORDER BY h.page_index) FROM hard_missing h WHERE h.document_id = d.document_id), '{}'::int[]) AS hard_missing_pages
        FROM docs d
        LEFT JOIN dpu_counts c ON c.document_id = d.document_id
       ORDER BY d.title NULLS LAST, d.document_id;
      `,
      [dealId, version]
    );
    rows = res.rows ?? [];
  } else {
    // Fallback when document_page_understanding table doesn't exist yet.
    const xlsxFallbackCte = canDetectXlsx
      ? `,\n      xlsx_docs AS (\n        SELECT document_id FROM docs\n         WHERE lower(${fileNameExpr}) LIKE '%.xlsx'\n            OR lower(${fileNameExpr}) LIKE '%.xls'\n            OR lower(${mimeTypeExpr}) LIKE '%spreadsheet%'\n      )`
      : "";
    const xlsxFallbackCase = canDetectXlsx
      ? `WHEN page_count > 0 AND document_id NOT IN (SELECT document_id FROM xlsx_docs)`
      : `WHEN page_count > 0`;

    const res = await pool.query<Row>(
      `
      WITH docs AS (
        SELECT id AS document_id,
               title,
               COALESCE(page_count, 0) AS page_count,
               ${fileNameExpr} AS file_name,
               ${mimeTypeExpr} AS mime_type
          FROM documents
         WHERE deal_id = $1
           AND deleted_at IS NULL
      )${xlsxFallbackCte}
      SELECT document_id,
             title,
             page_count,
             0::int AS dpu_rows,
             CASE
               ${xlsxFallbackCase}
               THEN ARRAY(SELECT generate_series(0, page_count - 1))
               ELSE '{}'::int[]
             END AS missing_pages
        FROM docs
       ORDER BY title NULLS LAST, document_id;
      `,
      [dealId]
    );
    rows = res.rows ?? [];
  }

  const readiness = computePageUnderstandingReadiness({ dealId, version, documents: rows });

  // Best-effort: attach a freshness signal so callers can gate on "new enough" DPU.
  if (dpuTableOk) {
    try {
      const res = await pool.query<{ latest_dpu_created_at: string | null }>(
        `
        SELECT MAX(GREATEST(dpu.created_at, COALESCE(dpu.updated_at, dpu.created_at)))::text AS latest_dpu_created_at
          FROM document_page_understanding dpu
          JOIN documents d ON d.id = dpu.document_id
         WHERE d.deal_id = $1
           AND d.deleted_at IS NULL
           AND dpu.version = $2
        `,
        [dealId, version]
      );
      const v = res.rows?.[0]?.latest_dpu_created_at ?? null;
      (readiness as any).latest_dpu_created_at = typeof v === 'string' ? v : null;
    } catch {
      // ignore
    }
  }
  return readiness;
}
