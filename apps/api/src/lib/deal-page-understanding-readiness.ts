import type { Pool } from "pg";

export type PageUnderstandingReadinessDocument = {
  document_id: string;
  title: string | null;
  page_count: number;
  dpu_rows: number;
  missing_pages: number[];
};

export type PageUnderstandingReadiness = {
  deal_id: string;
  version: string;
  documents: PageUnderstandingReadinessDocument[];
  expected_pages_total: number;
  dpu_rows_total: number;
  missing_pages_total: number;
  /**
   * When readiness indicates missing pages but the pipeline has no work enqueued,
   * this field explains why readiness may not be progressing.
   */
  blocked_reason?: string | null;
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
    missing_pages: unknown;
  }>;
}): PageUnderstandingReadiness {
  const docs: PageUnderstandingReadinessDocument[] = (args.documents ?? []).map((d) => {
    const pageCount = Math.max(0, toInt(d.page_count, 0));
    const dpuRows = Math.max(0, toInt(d.dpu_rows, 0));
    const missingPages = normalizeMissingPages(d.missing_pages);

    return {
      document_id: String(d.document_id),
      title: d.title ?? null,
      page_count: pageCount,
      dpu_rows: dpuRows,
      missing_pages: missingPages,
    };
  });

  let expectedPagesTotal = 0;
  let dpuRowsTotal = 0;
  let missingPagesTotal = 0;

  for (const d of docs) {
    expectedPagesTotal += d.page_count;
    dpuRowsTotal += d.dpu_rows;
    missingPagesTotal += d.missing_pages.length;
  }

  return {
    deal_id: args.dealId,
    version: args.version,
    documents: docs,
    expected_pages_total: expectedPagesTotal,
    dpu_rows_total: dpuRowsTotal,
    missing_pages_total: missingPagesTotal,
    blocked_reason: null,
    ready: missingPagesTotal === 0,
  };
}

export async function fetchPageUnderstandingReadinessForDeal(pool: Pool, dealId: string, version: string) {
  const dpuTableOk = await hasTable(pool as any, "document_page_understanding");

  type Row = {
    document_id: string;
    title: string | null;
    page_count: number | null;
    dpu_rows: number | null;
    missing_pages: number[] | null;
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
      present AS (
        SELECT dpu.document_id, dpu.page_index
          FROM document_page_understanding dpu
          JOIN docs d ON d.document_id = dpu.document_id
         WHERE dpu.version = $2
      ),
      missing AS (
        SELECT e.document_id, e.page_index
          FROM expected e
          LEFT JOIN present p
            ON p.document_id = e.document_id
           AND p.page_index = e.page_index
         WHERE p.page_index IS NULL
      ),
      dpu_counts AS (
        SELECT d.document_id,
               COUNT(p.page_index) AS dpu_rows
          FROM docs d
          LEFT JOIN present p ON p.document_id = d.document_id
         GROUP BY d.document_id
      )
      SELECT d.document_id,
             d.title,
             d.page_count,
             COALESCE(c.dpu_rows, 0) AS dpu_rows,
             COALESCE((SELECT array_agg(m.page_index ORDER BY m.page_index) FROM missing m WHERE m.document_id = d.document_id), '{}'::int[]) AS missing_pages
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

  return computePageUnderstandingReadiness({ dealId, version, documents: rows });
}
