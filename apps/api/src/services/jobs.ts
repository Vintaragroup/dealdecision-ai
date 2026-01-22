import type { JobType, JobStatus } from "@dealdecision/contracts";
import { randomUUID } from "crypto";
import { sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";
import {
  ingestQueue,
  extractVisualsQueue,
  deepScanVisualsQueue,
  fetchEvidenceQueue,
  analyzeDealQueue,
  verifyDocumentsQueue,
  remediateExtractionQueue,
  reextractDocumentsQueue,
} from "../lib/queue";

const queueMap: Record<JobType, typeof ingestQueue> = {
  ingest_documents: ingestQueue,
  extract_visuals: extractVisualsQueue,
  deep_scan_visuals: deepScanVisualsQueue,
  fetch_evidence: fetchEvidenceQueue,
  analyze_deal: analyzeDealQueue,
  verify_documents: verifyDocumentsQueue,
  remediate_extraction: remediateExtractionQueue,
  reextract_documents: reextractDocumentsQueue,
  generate_report: analyzeDealQueue,
  sync_crm: analyzeDealQueue,
  classify_document: ingestQueue,
};

export interface EnqueueJobInput {
  deal_id?: string;
  document_id?: string;
  type: JobType;
  payload?: Record<string, unknown>;
}

export interface EnqueueJobOptions {
	/**
	 * If set, will return an existing active job instead of enqueuing a duplicate.
	 * Intended for set-and-forget production usage.
	 */
	dedupe?: {
		by: "deal" | "document";
		statuses?: JobStatus[];
	};
}

const DEFAULT_DEDUPE_STATUSES: JobStatus[] = ["queued", "running", "retrying"];

export async function enqueueJob(input: EnqueueJobInput, opts?: EnqueueJobOptions) {
  const pool = getPool();
  const queue = queueMap[input.type];

  // Optional dedupe: if a matching job is already active, return it.
  if (opts?.dedupe?.by && (input.deal_id || input.document_id)) {
    const statuses = Array.isArray(opts.dedupe.statuses) && opts.dedupe.statuses.length > 0
      ? opts.dedupe.statuses
      : DEFAULT_DEDUPE_STATUSES;

    if (opts.dedupe.by === "deal" && input.deal_id) {
      const existing = await pool.query<{ id: number; job_id: string; status: JobStatus }>(
        `SELECT id, job_id, status
           FROM jobs
          WHERE deal_id = $1
            AND type = $2
            AND status = ANY($3::text[])
          ORDER BY created_at DESC
          LIMIT 1`,
        [sanitizeText(input.deal_id), sanitizeText(input.type), statuses]
      );
      if (existing.rows.length > 0) return existing.rows[0];
    }

    if (opts.dedupe.by === "document" && input.document_id) {
      const existing = await pool.query<{ id: number; job_id: string; status: JobStatus }>(
        `SELECT id, job_id, status
           FROM jobs
          WHERE document_id = $1
            AND type = $2
            AND status = ANY($3::text[])
          ORDER BY created_at DESC
          LIMIT 1`,
        [sanitizeText(input.document_id), sanitizeText(input.type), statuses]
      );
      if (existing.rows.length > 0) return existing.rows[0];
    }
  }

  const jobId = randomUUID();

  // Include identifiers in the BullMQ payload so workers don't depend on a DB read
  // (and to avoid a race where the job is picked up before the jobs table insert completes).
  const bullPayload = {
    ...(input.payload ?? {}),
    ...(input.deal_id ? { deal_id: input.deal_id } : {}),
    ...(input.document_id ? { document_id: input.document_id } : {}),
  };

  const bullJob = await queue.add(input.type, bullPayload, {
    jobId,
    removeOnComplete: true,
    removeOnFail: false,
  });

  const { rows } = await pool.query(
    `INSERT INTO jobs (job_id, deal_id, document_id, type, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, job_id, status`,
    [sanitizeText(jobId), input.deal_id ? sanitizeText(input.deal_id) : null, input.document_id ? sanitizeText(input.document_id) : null, sanitizeText(input.type), "queued"]
  );

  return rows[0];
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  progressPct?: number,
  message?: string
) {
  const pool = getPool();
  await pool.query(
    `UPDATE jobs
     SET status = $2,
         updated_at = now(),
         progress_pct = COALESCE($3, progress_pct),
         message = COALESCE($4, message)
     WHERE job_id = $1`,
    [sanitizeText(jobId), sanitizeText(status), progressPct ?? null, message ? sanitizeText(message) : null]
  );
}
