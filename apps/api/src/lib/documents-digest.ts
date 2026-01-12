import { sanitizeText } from "@dealdecision/core";
import { getPool } from "./db";

export type DocumentsDigestV1 = {
  extracted: number;
  unextracted: number;
  with_original_bytes: number;
  with_sha: number;
  duplicate_sha_groups: Array<{ sha: string; count: number; document_ids: string[] }>;
};

type QueryablePool = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

type DigestParams = {
  dealId: string;
  pool?: QueryablePool;
};

export async function buildDocumentsDigest(params: DigestParams): Promise<DocumentsDigestV1> {
  const pool = params.pool ?? getPool();
  const dealId = sanitizeText(params.dealId);

  const counts = await pool.query<{
    extracted: number;
    unextracted: number;
    with_original_bytes: number;
    with_sha: number;
  }>(
    `SELECT
        SUM((extraction_metadata IS NOT NULL)::int)::int AS extracted,
        SUM((extraction_metadata IS NULL)::int)::int AS unextracted,
        SUM((df.sha256 IS NOT NULL)::int)::int AS with_original_bytes,
        SUM((extraction_metadata ? 'original_bytes_sha256')::int)::int AS with_sha
       FROM documents d
       LEFT JOIN document_files df ON df.document_id = d.id
      WHERE d.deal_id = $1`,
    [dealId]
  );

  const duplicates = await pool.query<{
    sha: string;
    count: number;
    document_ids: string[];
  }>(
    `SELECT
        extraction_metadata->>'original_bytes_sha256' AS sha,
        COUNT(*)::int AS count,
        ARRAY_AGG(id ORDER BY uploaded_at DESC) AS document_ids
       FROM documents
      WHERE deal_id = $1
        AND extraction_metadata ? 'original_bytes_sha256'
      GROUP BY sha
     HAVING COUNT(*) > 1
      ORDER BY count DESC, sha ASC`,
    [dealId]
  );

  const row = counts.rows[0] ?? { extracted: 0, unextracted: 0, with_original_bytes: 0, with_sha: 0 };
  return {
    extracted: row.extracted ?? 0,
    unextracted: row.unextracted ?? 0,
    with_original_bytes: row.with_original_bytes ?? 0,
    with_sha: row.with_sha ?? 0,
    duplicate_sha_groups: duplicates.rows.map((d) => ({ sha: d.sha, count: d.count, document_ids: d.document_ids })) ?? [],
  };
}
