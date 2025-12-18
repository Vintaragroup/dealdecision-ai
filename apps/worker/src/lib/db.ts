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

export async function getDocumentsByIds(documentIds: string[]): Promise<DocumentWithVerification[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentWithVerification>(
    `SELECT id, deal_id, title, type, status, verification_status, verification_result,
            structured_data, extraction_metadata, full_content, full_text, page_count,
            uploaded_at, updated_at
       FROM documents
       WHERE id = ANY($1::text[])
       ORDER BY uploaded_at DESC`,
    [documentIds.map((id) => sanitizeText(id))]
  );
  return rows;
}
