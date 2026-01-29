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
  const queues = q.getQueues();

  const queueMap: Record<JobType, QueueLike> = {
    ingest_documents: queues.ingestQueue,
    render_document_pages: queues.renderDocumentPagesQueue,
    extract_visuals: queues.extractVisualsQueue,
    deep_scan_visuals: queues.deepScanVisualsQueue,
    fetch_evidence: queues.fetchEvidenceQueue,
    analyze_deal: queues.analyzeDealQueue,
    verify_documents: queues.verifyDocumentsQueue,
    remediate_extraction: queues.remediateExtractionQueue,
    reextract_documents: queues.reextractDocumentsQueue,
    generate_report: queues.analyzeDealQueue,
    sync_crm: queues.analyzeDealQueue,
    classify_document: queues.ingestQueue,
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

export type InsertJobRowResult = {
  id: number;
  job_id: string;
  status: JobStatus;
  bullPayload: Record<string, unknown>;
};

export async function insertJobRow(input: EnqueueJobInput, opts?: EnqueueJobOptions): Promise<InsertJobRowResult> {
  const pool: DbPoolLike = opts?.deps?.pool ?? getPool();

  // Optional dedupe: if a matching job is already active, return it.
  if (opts?.dedupe?.by && (input.deal_id || input.document_id)) {
    const statuses =
      Array.isArray(opts.dedupe.statuses) && opts.dedupe.statuses.length > 0
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
      if (existing.rows.length > 0) {
        return {
          id: existing.rows[0]!.id,
          job_id: existing.rows[0]!.job_id,
          status: existing.rows[0]!.status,
          bullPayload: {},
        };
      }
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
      if (existing.rows.length > 0) {
        return {
          id: existing.rows[0]!.id,
          job_id: existing.rows[0]!.job_id,
          status: existing.rows[0]!.status,
          bullPayload: {},
        };
      }
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

  return { ...rows[0], bullPayload };
}

export async function enqueueBullmqJob(
  params: { type: JobType; jobId: string; bullPayload: Record<string, unknown> },
  opts?: { deps?: { queue?: QueueLike } }
): Promise<void> {
  const queue = opts?.deps?.queue ?? getQueueForType(params.type);
  if (!queue) {
    throw new Error(`queue_not_found_for_type:${params.type}`);
  }
  await queue.add(params.type, params.bullPayload, {
    jobId: params.jobId,
    removeOnComplete: true,
    removeOnFail: false,
  });
}

export async function enqueueJob(input: EnqueueJobInput, opts?: EnqueueJobOptions) {
  const pool: DbPoolLike = opts?.deps?.pool ?? getPool();
  const queue = opts?.deps?.queue;

  const inserted = await insertJobRow(input, opts);

  try {
    // If this is running inside an external DB transaction (idempotency wrapper),
    // callers should prefer calling insertJobRow(...) in-tx and enqueueBullmqJob(...) after commit.
    await enqueueBullmqJob(
      { type: input.type, jobId: inserted.job_id, bullPayload: inserted.bullPayload },
      { deps: { queue } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE jobs
          SET status = 'failed',
              message = $2,
              updated_at = now()
        WHERE job_id = $1`,
      [sanitizeText(inserted.job_id), sanitizeText(message)]
    );
    throw err;
  }

  return { id: inserted.id, job_id: inserted.job_id, status: inserted.status };
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
