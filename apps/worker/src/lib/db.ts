import { Pool } from "pg";
import { sanitizeText, sanitizeDeep } from "@dealdecision/core";
import { randomUUID } from "crypto";

const envConnectionString = process.env.DATABASE_URL;

if (!envConnectionString) {
  throw new Error("DATABASE_URL is required for worker DB access");
}

// After this guard, the connection string is guaranteed to be defined.
const connectionString: string = envConnectionString;

let pool: Pool | null = null;

// Render Postgres (and many managed PG providers) require SSL.
// pg supports SSL via connection string params (e.g., ?sslmode=require) but we also
// explicitly enable TLS when PGSSLMODE=require or sslmode=require is present.
function shouldUseSsl(cs: string): boolean {
  const lower = cs.toLowerCase();
  return (
    process.env.PGSSLMODE === "require" ||
    lower.includes("sslmode=require") ||
    lower.includes("ssl=true")
  );
}

let shuttingDown = false;

export function markDbShuttingDown() {
  shuttingDown = true;
}

export function getPool() {
  if (!pool) {
    const useSsl = shouldUseSsl(connectionString);
    pool = new Pool({
      connectionString,
      // Common for managed Postgres where local CA chain isn't present in the container.
      // This still encrypts traffic; it only disables CA verification.
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return pool;
}

// IMPORTANT: This is a long-lived worker. Never close the shared pool during normal
// execution. Only close it as part of an explicit process shutdown.
export async function closePool() {
  if (!shuttingDown) {
    console.warn("[db] closePool() called while not shutting down; ignoring to avoid breaking active jobs");
    return;
  }
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
  fullTextAbsentReason?: string;
  pageCount?: number;
}) {
  const currentPool = getPool();
  await currentPool.query(
    `UPDATE documents
       SET structured_data = COALESCE($2::jsonb, structured_data),
           extraction_metadata = CASE
             WHEN $3::jsonb IS NULL THEN extraction_metadata
             ELSE COALESCE(extraction_metadata, '{}'::jsonb) || $3::jsonb
           END,
           status = COALESCE($4, status),
           full_content = COALESCE($5::jsonb, full_content),
           full_text = COALESCE($6, full_text),
           full_text_absent_reason = CASE
             WHEN $6 IS NOT NULL AND length(trim($6)) > 0 THEN NULL
             ELSE COALESCE($7, full_text_absent_reason)
           END,
           page_count = COALESCE($8, page_count)
     WHERE id = $1`,
    [
      sanitizeText(params.documentId),
      params.structuredData === undefined ? null : sanitizeDeep(params.structuredData ?? null),
      params.extractionMetadata === undefined ? null : sanitizeDeep(params.extractionMetadata ?? null),
      params.status === undefined ? null : sanitizeText(params.status ?? null),
      params.fullContent === undefined ? null : sanitizeDeep(params.fullContent ?? null),
      params.fullText === undefined ? null : sanitizeText(params.fullText ?? null),
      params.fullTextAbsentReason === undefined ? null : sanitizeText(params.fullTextAbsentReason ?? null),
      params.pageCount ?? null,
    ]
  );
}

export async function mergeDocumentExtractionMetadata(params: {
  documentId: string;
  patch: Record<string, unknown>;
}) {
  // Merge without overwriting unrelated keys. Right-side wins on conflicts.
  const currentPool = getPool();
  await currentPool.query(
    `
    UPDATE documents
    SET extraction_metadata = COALESCE(extraction_metadata, '{}'::jsonb) || $2::jsonb,
      updated_at = now()
    WHERE id = $1
    `,
    [params.documentId, JSON.stringify(params.patch)]
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

  const shape = await getEvidenceInsertShape(currentPool);
  const cols: string[] = [];
  const values: any[] = [];

  if (shape.idColumn) {
    cols.push(shape.idColumn);
    values.push(randomUUID());
  }

  cols.push("deal_id");
  values.push(sanitizeText(params.deal_id));

  if (shape.hasDocumentId) {
    cols.push("document_id");
    values.push(params.document_id ?? null);
  }

  cols.push("source", "kind", "text");
  values.push(sanitizeText(params.source), sanitizeText(params.kind), sanitizeText(params.text));

  if (shape.hasConfidence) {
    cols.push("confidence");
    values.push(params.confidence ?? 0.5);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

  try {
    await currentPool.query(`INSERT INTO evidence (${cols.join(", ")}) VALUES (${placeholders})`, values);
  } catch (err: any) {
    // Emit structured diagnostics for common schema drift failures.
    const code = typeof err?.code === "string" ? err.code : undefined;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        event: "evidence_insert_failed",
        pg_code: code,
        message,
        deal_id: params.deal_id,
        document_id: params.document_id ?? null,
        attempted_cols: cols,
      })
    );
    throw err;
  }
}

type EvidenceInsertShape = {
  hasDocumentId: boolean;
  hasConfidence: boolean;
  idColumn: "id" | "evidence_id" | null;
};

let cachedEvidenceInsertShape: EvidenceInsertShape | null = null;

async function getEvidenceInsertShape(currentPool: Pool): Promise<EvidenceInsertShape> {
  if (cachedEvidenceInsertShape) return cachedEvidenceInsertShape;
  const { rows } = await currentPool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'evidence'`
  );
  const cols = new Set(rows.map((r) => r.column_name));
  const idColumn = cols.has("id") ? "id" : cols.has("evidence_id") ? "evidence_id" : null;
  cachedEvidenceInsertShape = {
    hasDocumentId: cols.has("document_id"),
    hasConfidence: cols.has("confidence"),
    idColumn,
  };
  return cachedEvidenceInsertShape;
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

export type DocumentOriginalFileMeta = {
  document_id: string;
  sha256: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number;
};

export async function getDocumentOriginalFileMeta(documentId: string): Promise<DocumentOriginalFileMeta | null> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentOriginalFileMeta>(
    `SELECT d.id AS document_id,
        COALESCE(f.sha256, '') AS sha256,
        f.file_name,
        COALESCE(f.mime_type, d.mime_type) AS mime_type,
        COALESCE(f.size_bytes, d.size_bytes, 0) AS size_bytes
       FROM documents d
       LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.id = $1
      LIMIT 1`,
    [sanitizeText(documentId)]
  );
  return rows?.[0] ?? null;
}

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
    `SELECT id AS document_id, deal_id, title, type, status, uploaded_at, updated_at
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
  full_content: unknown | null;
  verification_status: string | null;
  verification_result: unknown | null;
  page_count: number | null;
  full_text: string | null;
  full_text_absent_reason: string | null;
  uploaded_at: string;
  updated_at: string;
};

export async function getDocumentsForDealWithAnalysis(dealId: string): Promise<DocumentForAnalysis[]> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<DocumentForAnalysis>(
    `SELECT id, deal_id, title, type, status,
            structured_data, extraction_metadata,
            full_content,
            verification_status, verification_result,
            page_count,
            full_text,
            full_text_absent_reason,
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

type PoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

let cachedDocumentsDeletedAtExists: boolean | null = null;
let cachedDocumentsDeletedAtExistsPromise: Promise<boolean> | null = null;

export function __resetDocumentsDeletedAtExistsCacheForTests() {
  cachedDocumentsDeletedAtExists = null;
  cachedDocumentsDeletedAtExistsPromise = null;
}

export async function hasDocumentsDeletedAtColumn(pool: PoolLike): Promise<boolean> {
  if (cachedDocumentsDeletedAtExists !== null) return cachedDocumentsDeletedAtExists;
  if (cachedDocumentsDeletedAtExistsPromise) return cachedDocumentsDeletedAtExistsPromise;

  cachedDocumentsDeletedAtExistsPromise = (async () => {
    try {
      const { rows } = await pool.query(
        `SELECT 1 AS ok
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'documents'
            AND column_name = 'deleted_at'
          LIMIT 1;`
      );
      cachedDocumentsDeletedAtExists = Array.isArray(rows) && rows.length > 0;
      return cachedDocumentsDeletedAtExists;
    } catch {
      // Best-effort: if we can't query information_schema, do not reference deleted_at.
      cachedDocumentsDeletedAtExists = false;
      return false;
    } finally {
      cachedDocumentsDeletedAtExistsPromise = null;
    }
  })();

  return cachedDocumentsDeletedAtExistsPromise;
}

export function buildGetDocumentsForDealWithVerificationSql(input: { hasDeletedAt: boolean }): string {
  return `SELECT d.id, d.deal_id, d.title, d.type, d.status, d.verification_status, d.verification_result,
            d.structured_data, d.extraction_metadata, d.full_content, d.full_text, d.page_count,
            d.uploaded_at, d.updated_at
       FROM documents d
      WHERE d.deal_id = $1${input.hasDeletedAt ? "\n        AND d.deleted_at IS NULL" : ""}
      ORDER BY d.uploaded_at DESC
      LIMIT 200`;
}

export async function __getDocumentsForDealWithVerificationWithPoolForTests(
  pool: PoolLike,
  dealId: string
): Promise<DocumentWithVerification[]> {
  const hasDeletedAt = await hasDocumentsDeletedAtColumn(pool);
  const { rows } = await pool.query(buildGetDocumentsForDealWithVerificationSql({ hasDeletedAt }), [sanitizeText(dealId)]);
  return rows as DocumentWithVerification[];
}

export async function getDocumentsForDealWithVerification(dealId: string): Promise<DocumentWithVerification[]> {
  const currentPool = getPool();
  const hasDeletedAt = await hasDocumentsDeletedAtColumn(currentPool as unknown as PoolLike);
  const { rows } = await currentPool.query<DocumentWithVerification>(
    buildGetDocumentsForDealWithVerificationSql({ hasDeletedAt }),
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

export type PhaseBRunRow = {
  id: string;
  deal_id: string;
  version: number;
  phase_b_result: unknown;
  phase_b_features: unknown;
  source_run_id: string | null;
  created_at: string;
};

export async function insertPhaseBRun(params: {
  dealId: string;
  phaseBResult: unknown;
  phaseBFeatures: unknown;
  sourceRunId?: string | null;
  versionOverride?: number | null;
}): Promise<PhaseBRunRow | null> {
  const currentPool = getPool();
  const sanitizedResult = sanitizeDeep(params.phaseBResult ?? null);
  const sanitizedFeatures = sanitizeDeep(params.phaseBFeatures ?? null);

  const { rows } = await currentPool.query<PhaseBRunRow>(
    `WITH next_version AS (
        SELECT COALESCE(MAX(version) + 1, 1) AS version
          FROM deal_phase_b_runs
         WHERE deal_id = $1
      )
      INSERT INTO deal_phase_b_runs (
        deal_id,
        version,
        phase_b_result,
        phase_b_features,
        source_run_id
      )
      SELECT
        $1,
        COALESCE($5, nv.version),
        $2::jsonb,
        $3::jsonb,
        $4
      FROM next_version nv
      RETURNING id, deal_id, version, phase_b_result, phase_b_features, source_run_id, created_at`,
    [
      sanitizeText(params.dealId),
      sanitizedResult,
      sanitizedFeatures,
      params.sourceRunId ? sanitizeText(params.sourceRunId) : null,
      params.versionOverride ?? null,
    ]
  );

  return rows[0] ?? null;
}

export async function getLatestPhaseBRun(dealId: string): Promise<PhaseBRunRow | null> {
  const currentPool = getPool();
  const { rows } = await currentPool.query<PhaseBRunRow>(
    `SELECT id, deal_id, version, phase_b_result, phase_b_features, source_run_id, created_at
       FROM deal_phase_b_runs
      WHERE deal_id = $1
      ORDER BY version DESC, created_at DESC
      LIMIT 1`,
    [sanitizeText(dealId)]
  );

  return rows[0] ?? null;
}
