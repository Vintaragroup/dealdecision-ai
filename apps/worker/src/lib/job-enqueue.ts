import { randomUUID } from "crypto";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import { sanitizeJobId } from "./job-id";

import { getPool } from "./db";
import { getQueue } from "./queue";

export type EnqueuePersistedJobInput = {
	job_id?: string;
	idempotent?: boolean;
  delay_ms?: number;
  type:
    | "ingest_documents"
    | "render_document_pages"
    | "extract_visuals"
    | "deep_scan_visuals"
    | "populate_document_page_understanding"
    | "document_intelligence_extract"
    | "fetch_evidence"
    | "analyze_deal"
    | "verify_documents"
    | "remediate_extraction"
    | "reextract_documents"
    | "orchestration"
    | "generate_ingestion_report"
    | "export_report_pdf";
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

  const normalizedDealId = typeof input.deal_id === "string" ? input.deal_id.trim() : "";
  const normalizedDocumentId = typeof input.document_id === "string" ? input.document_id.trim() : "";

  const requiresDocumentId = new Set<EnqueuePersistedJobInput["type"]>([
    "render_document_pages",
    "extract_visuals",
    "deep_scan_visuals",
    "populate_document_page_understanding",
    "document_intelligence_extract",
    "fetch_evidence",
    "verify_documents",
    "remediate_extraction",
    "reextract_documents",
    "generate_ingestion_report",
  ]);
  if (requiresDocumentId.has(input.type) && !normalizedDocumentId) {
    throw new Error(`Missing document_id for job type ${input.type}`);
  }

  // Defensive: BullMQ job ids must not contain ':' or other reserved separators.
  // UUIDs are already safe, but sanitize to harden against any future changes.
  const jobId = sanitizeJobId(input.job_id ? String(input.job_id) : randomUUID());

  const payload = sanitizeDeep({
    ...(input.payload ?? {}),
		...(normalizedDealId ? { deal_id: normalizedDealId } : {}),
		...(normalizedDocumentId ? { document_id: normalizedDocumentId } : {}),
    ...(input.parent_job_id ? { parent_job_id: input.parent_job_id } : {}),
    ...(typeof input.page_start === "number" ? { page_start: input.page_start } : {}),
    ...(typeof input.page_end === "number" ? { page_end: input.page_end } : {}),
  }) as Record<string, unknown>;

  // Insert DB row first to avoid a race where the job starts before the row exists.
  if (input.idempotent) {
    await pool.query(
      `INSERT INTO jobs (job_id, deal_id, document_id, type, queue, status, payload, parent_job_id, page_start, page_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       ON CONFLICT (job_id) DO NOTHING`,
      [
        sanitizeText(jobId),
        normalizedDealId ? sanitizeText(normalizedDealId) : null,
        normalizedDocumentId ? sanitizeText(normalizedDocumentId) : null,
        sanitizeText(input.type),
        sanitizeText(input.type),
        "queued",
        JSON.stringify(payload),
        input.parent_job_id ? sanitizeText(input.parent_job_id) : null,
        typeof input.page_start === "number" ? Math.max(0, Math.floor(input.page_start)) : null,
        typeof input.page_end === "number" ? Math.max(0, Math.floor(input.page_end)) : null,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO jobs (job_id, deal_id, document_id, type, queue, status, payload, parent_job_id, page_start, page_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        sanitizeText(jobId),
        normalizedDealId ? sanitizeText(normalizedDealId) : null,
        normalizedDocumentId ? sanitizeText(normalizedDocumentId) : null,
        sanitizeText(input.type),
        sanitizeText(input.type),
        "queued",
        JSON.stringify(payload),
        input.parent_job_id ? sanitizeText(input.parent_job_id) : null,
        typeof input.page_start === "number" ? Math.max(0, Math.floor(input.page_start)) : null,
        typeof input.page_end === "number" ? Math.max(0, Math.floor(input.page_end)) : null,
      ]
    );
  }

  try {
    const delayMsRaw = typeof input.delay_ms === "number" && Number.isFinite(input.delay_ms) ? input.delay_ms : null;
    const delayMs = delayMsRaw != null ? Math.max(0, Math.floor(delayMsRaw)) : 250;
    // Apply default retry opts for all job types except extract_visuals, which uses
    // queue-level defaultJobOptions (attempts: 5) set in getQueue("extract_visuals").
    // Job-level opts take precedence over queue defaultJobOptions, so we must not
    // override the higher attempts count for extract_visuals jobs.
    const retryOpts = input.type === "extract_visuals"
      ? {}
      : { attempts: 3, backoff: { type: "exponential" as const, delay: 1000 } };
    await queue.add(input.type, payload, {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
      delay: delayMs,
      ...retryOpts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (input.idempotent && msg.toLowerCase().includes("exists")) {
      // Already enqueued (or currently running). Treat as idempotent success.
    } else {
      throw err;
    }
  }

  return { job_id: jobId };
}
