import { randomUUID } from "crypto";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import { sanitizeJobId } from "./job-id";

import { getPool } from "./db";
import { getQueue } from "./queue";

export type EnqueuePersistedJobInput = {
  type:
    | "ingest_documents"
    | "extract_visuals"
    | "deep_scan_visuals"
    | "fetch_evidence"
    | "analyze_deal"
    | "verify_documents"
    | "remediate_extraction"
    | "reextract_documents"
    | "orchestration"
    | "generate_ingestion_report";
  deal_id?: string;
  document_id?: string;
  payload?: Record<string, unknown>;
  parent_job_id?: string | null;
  page_start?: number;
  page_end?: number;
};

export async function enqueuePersistedJob(input: EnqueuePersistedJobInput): Promise<{ job_id: string }> {
  const pool = getPool();
  const queue = getQueue(input.type as any);

  // Defensive: BullMQ job ids must not contain ':' or other reserved separators.
  // UUIDs are already safe, but sanitize to harden against any future changes.
  const jobId = sanitizeJobId(randomUUID());

  const payload = sanitizeDeep({
    ...(input.payload ?? {}),
    ...(input.deal_id ? { deal_id: input.deal_id } : {}),
    ...(input.document_id ? { document_id: input.document_id } : {}),
    ...(input.parent_job_id ? { parent_job_id: input.parent_job_id } : {}),
    ...(typeof input.page_start === "number" ? { page_start: input.page_start } : {}),
    ...(typeof input.page_end === "number" ? { page_end: input.page_end } : {}),
  }) as Record<string, unknown>;

  // Insert DB row first to avoid a race where the job starts before the row exists.
  await pool.query(
    `INSERT INTO jobs (job_id, deal_id, document_id, type, queue, status, payload, parent_job_id, page_start, page_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
    [
      sanitizeText(jobId),
      input.deal_id ? sanitizeText(input.deal_id) : null,
      input.document_id ? sanitizeText(input.document_id) : null,
      sanitizeText(input.type),
      sanitizeText(input.type),
      "queued",
      JSON.stringify(payload),
      input.parent_job_id ? sanitizeText(input.parent_job_id) : null,
      typeof input.page_start === "number" ? Math.max(0, Math.floor(input.page_start)) : null,
      typeof input.page_end === "number" ? Math.max(0, Math.floor(input.page_end)) : null,
    ]
  );

  await queue.add(input.type, payload, {
    jobId,
    removeOnComplete: true,
    removeOnFail: false,
    delay: 250,
  });

  return { job_id: jobId };
}
