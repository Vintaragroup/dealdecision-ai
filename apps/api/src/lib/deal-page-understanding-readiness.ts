import type { Pool } from "pg";

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

type QueryResult<T> = { rows: T[] };

async function hasTable(pool: { query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>> }, table: string) {
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

export async function fetchPageUnderstandingReadinessForDeal(pool: Pool, dealId: string, version: string) {
  const dpuTableOk = await hasTable(pool as any, "document_page_understanding");

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
               COALESCE(page_count, 0) AS page_count
          FROM documents
         WHERE deal_id = $1
           AND deleted_at IS NULL
      ),
      expected AS (
        SELECT document_id, generate_series(0, page_count - 1) AS page_index
          FROM docs
         WHERE page_count > 0
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
    const res = await pool.query<Row>(
      `
      WITH docs AS (
        SELECT id AS document_id,
               title,
               COALESCE(page_count, 0) AS page_count
          FROM documents
         WHERE deal_id = $1
           AND deleted_at IS NULL
      )
      SELECT document_id,
             title,
             page_count,
             0::int AS dpu_rows,
             CASE
               WHEN page_count > 0 THEN ARRAY(SELECT generate_series(0, page_count - 1))
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
        SELECT MAX(dpu.created_at)::text AS latest_dpu_created_at
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
