import type { JobType, JobStatus } from "@dealdecision/contracts";
import { randomUUID } from "crypto";
import { sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";
import {
  ingestQueue,
  fetchEvidenceQueue,
  analyzeDealQueue,
} from "../lib/queue";

const queueMap: Record<JobType, typeof ingestQueue> = {
  ingest_document: ingestQueue,
  ingest_documents: ingestQueue,
  fetch_evidence: fetchEvidenceQueue,
  analyze_deal: analyzeDealQueue,
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

export async function enqueueJob(input: EnqueueJobInput) {
  const pool = getPool();
  const queue = queueMap[input.type];
  const jobId = randomUUID();
  const bullJob = await queue.add(input.type, input.payload ?? {}, {
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
