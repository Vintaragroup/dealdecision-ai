import type { JobType, JobStatus } from "@dealdecision/contracts";
import { randomUUID } from "crypto";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";

type QueueLike = {
  add: (name: string, data: Record<string, unknown>, opts: { jobId: string; removeOnComplete: boolean; removeOnFail: boolean }) => Promise<any>;
};

type DbPoolLike = Pick<ReturnType<typeof getPool>, "query">;

function getQueueForType(type: JobType): QueueLike {
  // Lazily require queues so unit tests can import this module without REDIS_URL.
  // In production, this resolves to BullMQ Queue instances.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const q = require("../lib/queue") as typeof import("../lib/queue");

  const queueMap: Record<JobType, QueueLike> = {
    ingest_documents: q.ingestQueue,
    extract_visuals: q.extractVisualsQueue,
    deep_scan_visuals: q.deepScanVisualsQueue,
    fetch_evidence: q.fetchEvidenceQueue,
    analyze_deal: q.analyzeDealQueue,
    verify_documents: q.verifyDocumentsQueue,
    remediate_extraction: q.remediateExtractionQueue,
    reextract_documents: q.reextractDocumentsQueue,
    generate_report: q.analyzeDealQueue,
    sync_crm: q.analyzeDealQueue,
    classify_document: q.ingestQueue,
  };

  return queueMap[type];
}

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

  /**
   * Dependency injection for tests.
   */
  deps?: {
    pool?: DbPoolLike;
    queue?: QueueLike;
  };
}

const DEFAULT_DEDUPE_STATUSES: JobStatus[] = ["queued", "running", "retrying"];
// Guardrail: if a job row gets stuck in an "active" status (e.g., queued) for too long,
// dedupe would otherwise keep returning it forever and block new work.
const DEFAULT_DEDUPE_MAX_AGE_MINUTES = 30;

export async function enqueueJob(input: EnqueueJobInput, opts?: EnqueueJobOptions) {
  const pool: DbPoolLike = opts?.deps?.pool ?? getPool();
  const queue = opts?.deps?.queue ?? getQueueForType(input.type);

  // Optional dedupe: if a matching job is already active, return it.
  if (opts?.dedupe?.by && (input.deal_id || input.document_id)) {
    const statuses = Array.isArray(opts.dedupe.statuses) && opts.dedupe.statuses.length > 0
      ? opts.dedupe.statuses
      : DEFAULT_DEDUPE_STATUSES;
    const maxAgeMinutes = DEFAULT_DEDUPE_MAX_AGE_MINUTES;

    if (opts.dedupe.by === "deal" && input.deal_id) {
      const existing = (await pool.query(
        `SELECT id, job_id, status
           FROM jobs
          WHERE deal_id = $1
            AND type = $2
            AND status = ANY($3::text[])
            AND created_at >= (now() - ($4::int * interval '1 minute'))
          ORDER BY created_at DESC
          LIMIT 1`,
        [sanitizeText(input.deal_id), sanitizeText(input.type), statuses, maxAgeMinutes]
      )) as unknown as { rows: Array<{ id: number; job_id: string; status: JobStatus }> };
      if (existing.rows.length > 0) return existing.rows[0];
    }

    if (opts.dedupe.by === "document" && input.document_id) {
      const existing = (await pool.query(
        `SELECT id, job_id, status
           FROM jobs
          WHERE document_id = $1
            AND type = $2
            AND status = ANY($3::text[])
            AND created_at >= (now() - ($4::int * interval '1 minute'))
          ORDER BY created_at DESC
          LIMIT 1`,
        [sanitizeText(input.document_id), sanitizeText(input.type), statuses, maxAgeMinutes]
      )) as unknown as { rows: Array<{ id: number; job_id: string; status: JobStatus }> };
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

  // Persist a non-null payload for debugging and filtering.
  // Include identifiers even if the caller didn't supply them in payload.
  const persistedPayload = sanitizeDeep({
    ...(input.payload ?? {}),
    ...(input.deal_id ? { deal_id: input.deal_id } : {}),
    ...(input.document_id ? { document_id: input.document_id } : {}),
    job_id: jobId,
    type: input.type,
  }) as Record<string, unknown>;

  // Insert DB row first to avoid a race where the worker updates progress/status
  // before the job row exists (UI polls Postgres jobs table).
  const { rows } = await pool.query(
    `INSERT INTO jobs (job_id, deal_id, document_id, type, queue, status, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, job_id, status`,
    [
      sanitizeText(jobId),
      input.deal_id ? sanitizeText(input.deal_id) : null,
      input.document_id ? sanitizeText(input.document_id) : null,
      sanitizeText(input.type),
      sanitizeText(input.type),
      "queued",
      JSON.stringify(persistedPayload ?? {}),
    ]
  );

  try {
    await queue.add(input.type, bullPayload, {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE jobs
          SET status = 'failed',
              message = $2,
              updated_at = now()
        WHERE job_id = $1`,
      [sanitizeText(jobId), sanitizeText(message)]
    );
    throw err;
  }

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
