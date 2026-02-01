import { sanitizeText } from "@dealdecision/core";
import { getPool } from "./db";
import type { EnqueueJobInput } from "../services/jobs";

export type ReconcileSummary = {
  deal_id: string;
  total_docs: number;
  eligible_unextracted: number;
  enqueued: number;
  already_extracted: number;
  missing_bytes: number;
  skipped: number;
  stalled_jobs_detected: number;
  stalled_processing_count: number;
  stalled_marked_failed: number;
  errors: string[];
};

type ReconcileParams = {
  dealId: string;
  limit?: number;
  pool?: ReturnType<typeof getPool>;
  enqueue?: (input: EnqueueJobInput) => Promise<any>;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ELIGIBLE_STATUSES = new Set(["pending", "uploaded"]);
const STALLED_STATUSES = new Set(["queued", "running", "processing"]);

const getStalledMinutesThreshold = () => {
  const fromEnv = Number(process.env.INGEST_STALLED_MINUTES ?? process.env.INGEST_RECONCILE_STALLED_MINUTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return process.env.NODE_ENV === "production" ? 10 : 2;
};

type CandidateRow = {
  id: string;
  title: string;
  status: string;
  extraction_metadata: unknown | null;
  file_sha: string | null;
  file_name: string | null;
  has_file_row: boolean;
  has_blob_bytes: boolean;
  page_count: number | null;
  latest_ingest_job_id: string | null;
  latest_ingest_status: string | null;
  latest_ingest_updated_at: string | null;
};

export async function reconcileIngest(params: ReconcileParams): Promise<ReconcileSummary> {
  const pool = params.pool ?? getPool();
  const enqueue =
    params.enqueue ??
    (require("../services/jobs") as { enqueueJob: (input: EnqueueJobInput) => Promise<any> }).enqueueJob;
  const dealId = sanitizeText(params.dealId);
  const limitRaw = params.limit ?? DEFAULT_LIMIT;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Number(limitRaw)), MAX_LIMIT) : DEFAULT_LIMIT;

  const { rows } = await pool.query<CandidateRow>(
    `SELECT d.id,
            d.title,
            d.status,
            d.extraction_metadata,
            d.page_count,
            df.sha256 AS file_sha,
            df.file_name AS file_name,
            (df.sha256 IS NOT NULL) AS has_file_row,
            (dfb.bytes IS NOT NULL) AS has_blob_bytes,
            latest.job_id AS latest_ingest_job_id,
            latest.status AS latest_ingest_status,
            latest.updated_at AS latest_ingest_updated_at
       FROM documents d
       LEFT JOIN document_files df ON df.document_id = d.id
       LEFT JOIN document_file_blobs dfb ON dfb.sha256 = df.sha256
       LEFT JOIN LATERAL (
         SELECT j.job_id, j.status, j.updated_at
           FROM jobs j
          WHERE j.document_id = d.id AND j.type = 'ingest_documents'
          ORDER BY j.updated_at DESC
          LIMIT 1
       ) latest ON TRUE
      WHERE d.deal_id = $1
      ORDER BY d.uploaded_at ASC`,
    [dealId]
  );

  const summary: ReconcileSummary = {
    deal_id: dealId,
    total_docs: rows.length,
    eligible_unextracted: 0,
    enqueued: 0,
    already_extracted: rows.filter((r) => r.extraction_metadata != null).length,
    missing_bytes: 0,
    skipped: 0,
    stalled_jobs_detected: 0,
    stalled_processing_count: 0,
    stalled_marked_failed: 0,
    errors: [],
  };

  const stalledThresholdMinutes = getStalledMinutesThreshold();
  const stalledCutoff = Date.now() - stalledThresholdMinutes * 60_000;

  const candidates = rows.filter((row) => {
    const status = (row.status || "").toLowerCase();
    const hasStoredBytes = row.has_file_row && row.has_blob_bytes;
    if (!hasStoredBytes) return false;

    const extractionMissing = row.extraction_metadata == null;
    const pageCountMissing = row.page_count == null || row.page_count <= 0;

    const latestUpdated = row.latest_ingest_updated_at ? new Date(row.latest_ingest_updated_at).getTime() : null;
    const latestStatus = (row.latest_ingest_status || "").toLowerCase();
    const stalled = latestUpdated != null && STALLED_STATUSES.has(latestStatus) && latestUpdated < stalledCutoff;
    if (stalled) summary.stalled_jobs_detected += 1;
    if (stalled && status === "processing" && pageCountMissing) {
      summary.stalled_processing_count += 1;
    }

    const eligibleByStatus = ELIGIBLE_STATUSES.has(status);
    const eligibleByStall = stalled;
    const eligibleProcessingStalled = status === "processing" && pageCountMissing && stalled;

    return extractionMissing || eligibleByStatus || eligibleByStall || eligibleProcessingStalled;
  });

  const withBytes = candidates.filter((row) => row.has_file_row && row.has_blob_bytes);
  const missingBytes = candidates.filter((row) => !(row.has_file_row && row.has_blob_bytes));

  summary.missing_bytes = missingBytes.length;
  summary.eligible_unextracted = withBytes.length;

  const toEnqueue = withBytes.slice(0, limit);
  summary.skipped += Math.max(0, withBytes.length - toEnqueue.length);

  for (const row of toEnqueue) {
    try {
      const latestStatus = (row.latest_ingest_status || "").toLowerCase();
      const latestUpdated = row.latest_ingest_updated_at ? new Date(row.latest_ingest_updated_at).getTime() : null;
      const stalled = latestUpdated != null && STALLED_STATUSES.has(latestStatus) && latestUpdated < stalledCutoff;

      if (stalled && row.latest_ingest_job_id) {
        summary.stalled_marked_failed += 1;
        await pool.query(
          `UPDATE jobs
              SET status = 'failed',
                  message = 'stalled; requeued by reconcile-ingest',
                  updated_at = now()
            WHERE job_id = $1`,
          [row.latest_ingest_job_id]
        );
      }

      await pool.query(`UPDATE documents SET status = 'pending', updated_at = now() WHERE id = $1`, [row.id]);

      const payload: EnqueueJobInput = {
        deal_id: dealId,
        document_id: row.id,
        type: "ingest_documents",
        payload: {
          document_id: row.id,
          deal_id: dealId,
          mode: "from_storage",
          file_name: row.file_name ?? row.title ?? "document",
        },
      };
      await enqueue(payload);
      summary.enqueued += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "enqueue_failed";
      summary.errors.push(`doc=${row.id}: ${message}`);
      summary.skipped += 1;
    }
  }

  return summary;
}
