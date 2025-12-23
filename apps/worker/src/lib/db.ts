import { Pool } from "pg";
import { sanitizeText, sanitizeDeep } from "@dealdecision/core";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for worker DB access");
}

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function updateDocumentStatus(documentId: string, status: string) {
  const currentPool = getPool();
  await currentPool.query(
    `UPDATE documents
     SET status = $2
     WHERE id = $1`,
    [sanitizeText(documentId), sanitizeText(status)]
  );
}

export async function updateDocumentAnalysis(params: {
  documentId: string;
  status?: string;
  structuredData?: unknown;
  extractionMetadata?: unknown;
  fullContent?: unknown;
  fullText?: string;
  pageCount?: number;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `UPDATE documents
       SET structured_data = COALESCE($2, structured_data),
           extraction_metadata = COALESCE($3, extraction_metadata),
           status = COALESCE($4, status),
           full_content = COALESCE($5, full_content),
           full_text = COALESCE($6, full_text),
           page_count = COALESCE($7, page_count)
     WHERE id = $1`,
    [
      sanitizeText(params.documentId),
      params.structuredData === undefined ? null : sanitizeDeep(params.structuredData ?? null),
      params.extractionMetadata === undefined ? null : sanitizeDeep(params.extractionMetadata ?? null),
      params.status === undefined ? null : sanitizeText(params.status ?? null),
      params.fullContent === undefined ? null : sanitizeDeep(params.fullContent ?? null),
      params.fullText === undefined ? null : sanitizeText(params.fullText ?? null),
      params.pageCount ?? null,
    ]
  );
}

export async function insertEvidence(params: {
  deal_id: string;
  document_id?: string | null;
  source: string;
  kind: string;
  text: string;
  confidence?: number;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `INSERT INTO evidence (deal_id, document_id, source, kind, text, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sanitizeText(params.deal_id),
      params.document_id ?? null,
      sanitizeText(params.source),
      sanitizeText(params.kind),
      sanitizeText(params.text),
      params.confidence ?? 0.5,
    ]
  );
}

export async function deleteExtractionEvidenceForDocument(params: {
  documentId: string;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `DELETE FROM evidence
      WHERE document_id = $1
        AND source = 'extraction'`,
    [sanitizeText(params.documentId)]
  );
}

export async function deleteExtractionEvidenceForDeal(params: {
  dealId: string;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `DELETE FROM evidence
      WHERE deal_id = $1
        AND source = 'extraction'`,
    [sanitizeText(params.dealId)]
  );
}

export async function upsertDocumentOriginalFile(params: {
  documentId: string;
  sha256: string;
  bytes: Buffer;
  sizeBytes: number;
  fileName?: string | null;
  mimeType?: string | null;
}) {
  const currentPool = getPool();

  await currentPool.query("BEGIN");
  try {
    await currentPool.query(
      `INSERT INTO document_file_blobs (sha256, bytes, size_bytes)
        VALUES ($1, $2, $3)
        ON CONFLICT (sha256) DO NOTHING`,
      [sanitizeText(params.sha256), params.bytes, params.sizeBytes]
    );

    await currentPool.query(
      `INSERT INTO document_files (document_id, sha256, file_name, mime_type, size_bytes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (document_id)
        DO UPDATE SET sha256 = EXCLUDED.sha256,
                      file_name = EXCLUDED.file_name,
                      mime_type = EXCLUDED.mime_type,
                      size_bytes = EXCLUDED.size_bytes`,
      [
        sanitizeText(params.documentId),
        sanitizeText(params.sha256),
        params.fileName == null ? null : sanitizeText(params.fileName),
        params.mimeType == null ? null : sanitizeText(params.mimeType),
        params.sizeBytes,
      ]
    );

    await currentPool.query("COMMIT");
  } catch (err) {
    await currentPool.query("ROLLBACK");
    throw err;
  }
}

export type DocumentOriginalFile = {
  document_id: string;
  sha256: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number;
  bytes: Buffer;
};

export async function getDocumentOriginalFile(documentId: string): Promise<DocumentOriginalFile | null> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentOriginalFile>(
    `SELECT f.document_id,
            f.sha256,
            f.file_name,
            f.mime_type,
            f.size_bytes,
            b.bytes
       FROM document_files f
       JOIN document_file_blobs b ON b.sha256 = f.sha256
      WHERE f.document_id = $1
      LIMIT 1`,
    [sanitizeText(documentId)]
  );
  return rows?.[0] ?? null;
}

export type DocumentRow = {
  document_id: string;
  deal_id: string;
  title: string;
  type: string;
  status: string;
  uploaded_at: string;
  updated_at: string;
};

export async function getDocumentsForDeal(dealId: string): Promise<DocumentRow[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentRow>(
    `SELECT document_id, deal_id, title, type, status, uploaded_at, updated_at
       FROM documents
       WHERE deal_id = $1
       ORDER BY uploaded_at DESC
       LIMIT 100`,
    [dealId]
  );
  return rows;
}

export async function getEvidenceDocumentIds(dealId: string): Promise<Set<string>> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<{ document_id: string | null }>(
    `SELECT document_id
       FROM evidence
       WHERE deal_id = $1
         AND document_id IS NOT NULL
         AND source = 'fetch_evidence'`,
    [dealId]
  );
  return new Set(rows.map((row) => row.document_id as string));
}

export async function updateDocumentVerification(params: {
  documentId: string;
  verificationStatus: string;
  verificationResult: unknown;
  readyForAnalysisAt?: Date;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `UPDATE documents
       SET verification_status = $2,
           verification_result = $3,
           ready_for_analysis_at = COALESCE($4, ready_for_analysis_at),
           updated_at = now()
     WHERE id = $1`,
    [
      sanitizeText(params.documentId),
      sanitizeText(params.verificationStatus),
      params.verificationResult === undefined ? null : sanitizeDeep(params.verificationResult ?? null),
      params.readyForAnalysisAt ?? null,
    ]
  );
}

export async function saveIngestionReport(params: {
  reportId: string;
  dealId: string;
  summary: unknown;
  documentIds: string[];
}) {
  const currentPool = getPool();
  await currentPool.query(
    `INSERT INTO ingestion_reports (report_id, deal_id, summary, document_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
    [
      sanitizeText(params.reportId),
      sanitizeText(params.dealId),
      params.summary === undefined ? null : sanitizeDeep(params.summary ?? null),
      (params.documentIds || []).map((id) => sanitizeText(id)),
    ]
  );
}

export type DocumentWithVerification = {
  id: string;
  deal_id: string;
  title: string;
  type: string;
  status: string;
  uploaded_at: string;
  updated_at: string;
  verification_status: string | null;
  verification_result: unknown | null;
  structured_data: unknown | null;
  extraction_metadata: unknown | null;
  full_content: unknown | null;
  full_text: string | null;
  page_count: number | null;
};

export type DocumentForAnalysis = {
  id: string;
  deal_id: string;
  title: string;
  type: string;
  status: string;
  structured_data: unknown | null;
  extraction_metadata: unknown | null;
  verification_status: string | null;
  verification_result: unknown | null;
  page_count: number | null;
  uploaded_at: string;
  updated_at: string;
};

export async function getDocumentsForDealWithAnalysis(dealId: string): Promise<DocumentForAnalysis[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentForAnalysis>(
    `SELECT id, deal_id, title, type, status,
            structured_data, extraction_metadata,
            verification_status, verification_result,
            page_count,
            uploaded_at, updated_at
       FROM documents
      WHERE deal_id = $1
      ORDER BY uploaded_at DESC
      LIMIT 100`,
    [sanitizeText(dealId)]
  );
  return rows;
}

export async function getDocumentsByIds(documentIds: string[]): Promise<DocumentWithVerification[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentWithVerification>(
    `SELECT id, deal_id, title, type, status, verification_status, verification_result,
            structured_data, extraction_metadata, full_content, full_text, page_count,
            uploaded_at, updated_at
       FROM documents
       WHERE id = ANY($1::uuid[])
       ORDER BY uploaded_at DESC`,
    [documentIds.map((id) => sanitizeText(id))]
  );
  return rows;
}

export async function getDocumentsForDealWithVerification(dealId: string): Promise<DocumentWithVerification[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentWithVerification>(
    `SELECT id, deal_id, title, type, status, verification_status, verification_result,
            structured_data, extraction_metadata, full_content, full_text, page_count,
            uploaded_at, updated_at
       FROM documents
      WHERE deal_id = $1
      ORDER BY uploaded_at DESC
      LIMIT 200`,
    [sanitizeText(dealId)]
  );
  return rows;
}

export async function insertDocumentExtractionAudit(params: {
  documentId: string;
  dealId: string;
  structuredData: unknown | null;
  extractionMetadata: unknown | null;
  fullContent: unknown | null;
  fullText: string | null;
  verificationStatus: string | null;
  verificationResult: unknown | null;
  reason?: string;
  triggeredByJobId?: string;
}) {
  const currentPool = getPool();
  try {
    await currentPool.query(
      `INSERT INTO document_extraction_audit (
          document_id,
          deal_id,
          structured_data,
          extraction_metadata,
          full_content,
          full_text,
          verification_status,
          verification_result,
          reason,
          triggered_by_job_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        sanitizeText(params.documentId),
        sanitizeText(params.dealId),
        params.structuredData === undefined ? null : sanitizeDeep(params.structuredData ?? null),
        params.extractionMetadata === undefined ? null : sanitizeDeep(params.extractionMetadata ?? null),
        params.fullContent === undefined ? null : sanitizeDeep(params.fullContent ?? null),
        params.fullText == null ? null : sanitizeText(params.fullText),
        params.verificationStatus == null ? null : sanitizeText(params.verificationStatus),
        params.verificationResult === undefined ? null : sanitizeDeep(params.verificationResult ?? null),
        params.reason ? sanitizeText(params.reason) : null,
        params.triggeredByJobId ? sanitizeText(params.triggeredByJobId) : null,
      ]
    );
  } catch (err: any) {
    // If the audit table isn't present (e.g., DB not migrated yet), do not block
    // remediation/re-extraction. This audit is helpful but non-critical.
    const code = err?.code;
    const message = err?.message;
    if (code === "42P01" || (typeof message === "string" && message.includes("document_extraction_audit"))) {
      console.warn(
        `[db] document_extraction_audit missing; skipping audit snapshot (reason=${params.reason ?? "unknown"})`
      );
      return;
    }
    throw err;
  }
}
