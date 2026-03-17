import { QUEUE_NAMES, type QueueName } from "@dealdecision/core";
import type { JobType, JobStatus } from "@dealdecision/contracts";
import { randomUUID } from "crypto";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import { getPool } from "../lib/db";

/**
 * Sanitize a string for use as a BullMQ job ID.
 * BullMQ/Redis uses ':' as a key-path separator and rejects any jobId containing it.
 * Mirrors apps/worker/src/lib/job-id.ts#sanitizeJobId — kept in-sync manually.
 *
 * Rules:
 *   ':'  →  '__'  (preserve semantic grouping)
 *   other disallowed chars  →  '_'
 *   leading/trailing '_'  stripped
 */
export function safeJobId(input: string): string {
  const colonNormalized = String(input ?? "").replace(/:+/g, "__");
  return colonNormalized.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

type QueueLike = {
  add: (name: string, data: Record<string, unknown>, opts: {
    jobId: string;
    removeOnComplete: boolean;
    removeOnFail: boolean;
    attempts?: number;
    backoff?: { type: string; delay: number };
    delay?: number;
  }) => Promise<any>;
};

/**
 * Default BullMQ retry options applied to every job enqueue unless explicitly overridden.
 * Provides 3 attempts with exponential backoff starting at 1 second.
 *
 * Jobs that require a different policy (e.g. extract_visuals which uses queue-level
 * defaultJobOptions with attempts=5) should pass explicit overrides instead.
 */
export function defaultBullmqRetryOpts() {
  return {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
  } as const;
}

type DbPoolLike = Pick<ReturnType<typeof getPool>, "query">;

export function getQueueNameForJobType(type: JobType): QueueName {
  switch (type) {
    case "ingest_documents":
      return QUEUE_NAMES.ingest_documents;
    case "render_document_pages":
      return QUEUE_NAMES.render_document_pages;
    case "extract_visuals":
    case "extract_visuals_deal":
      return QUEUE_NAMES.extract_visuals;
    case "populate_document_page_understanding":
      return QUEUE_NAMES.populate_document_page_understanding;
    case "deep_scan_visuals":
      return QUEUE_NAMES.deep_scan_visuals;
    case "document_intelligence_extract":
      return QUEUE_NAMES.document_intelligence_extract;
    case "fetch_evidence":
      return QUEUE_NAMES.fetch_evidence;
    case "analyze_deal":
      return QUEUE_NAMES.analyze_deal;
    case "verify_documents":
      return QUEUE_NAMES.verify_documents;
    case "remediate_extraction":
      return QUEUE_NAMES.remediate_extraction;
    case "reextract_documents":
      return QUEUE_NAMES.reextract_documents;
    case "generate_report":
    case "sync_crm":
      return QUEUE_NAMES.analyze_deal;
    case "classify_document":
      return QUEUE_NAMES.ingest_documents;
    case "investor_insights":
      return QUEUE_NAMES.investor_insights;
    case "export_report_pdf":
      return QUEUE_NAMES.export_report_pdf;
    case "monitor_deal_signals":
      return QUEUE_NAMES.monitor_deal_signals;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

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
    extract_visuals_deal: queues.extractVisualsQueue,
	populate_document_page_understanding: queues.populateDocumentPageUnderstandingQueue,
    deep_scan_visuals: queues.deepScanVisualsQueue,
    document_intelligence_extract: queues.documentIntelligenceExtractQueue,
    fetch_evidence: queues.fetchEvidenceQueue,
    analyze_deal: queues.analyzeDealQueue,
    verify_documents: queues.verifyDocumentsQueue,
    remediate_extraction: queues.remediateExtractionQueue,
    reextract_documents: queues.reextractDocumentsQueue,
    generate_report: queues.analyzeDealQueue,
    sync_crm: queues.analyzeDealQueue,
    classify_document: queues.ingestQueue,
    investor_insights: queues.investorInsightsQueue,
    export_report_pdf: queues.exportReportPdfQueue,
    monitor_deal_signals: queues.monitorDealSignalsQueue,
  };

  return queueMap[type];
}

export interface EnqueueJobInput {
  deal_id?: string;
  document_id?: string;
  type: JobType;
  payload?: Record<string, unknown>;
  /**
   * Optional override for the persisted `queue` column.
   * Useful when a logical job `type` differs from the actual BullMQ queue name.
   */
  queue?: string;
  parent_job_id?: string | null;
  page_start?: number;
  page_end?: number;
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
   * Optional BullMQ jobId for idempotent enqueueing.
   *
   * When provided, BullMQ will not create a duplicate job if one with this
   * id is already waiting or active in the queue.  The DB job row still uses
   * its own generated UUID so audit-log uniqueness is preserved; only the
   * BullMQ key is overridden.
   *
   * Callers should use a deterministic, content-addressed key so that repeated
   * calls with the same inputs produce the same BullMQ jobId:
   *   e.g. `dpu:${dealId}:${docId}:${docsFingerprint}:page_understanding_v1`
   */
  jobId?: string;

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

  // Guardrails: prevent invalid job rows that break deterministic debugging.
  if (input.type === "extract_visuals") {
    const docId = typeof input.document_id === "string" ? input.document_id.trim() : "";
    if (!docId) {
      throw new Error("invalid_extract_visuals_job:missing_document_id");
    }
    if (typeof input.page_start !== "number" || typeof input.page_end !== "number") {
      throw new Error("invalid_extract_visuals_job:missing_page_range");
    }
  }

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
		...(input.parent_job_id ? { parent_job_id: input.parent_job_id } : {}),
		...(typeof input.page_start === "number" ? { page_start: input.page_start } : {}),
		...(typeof input.page_end === "number" ? { page_end: input.page_end } : {}),
    job_id: jobId,
    type: input.type,
  }) as Record<string, unknown>;

  // Insert DB row first to avoid a race where the worker updates progress/status
  // before the job row exists (UI polls Postgres jobs table).
  const queueName = typeof input.queue === "string" && input.queue.trim().length > 0 ? input.queue.trim() : input.type;

  const { rows } = await pool.query(
    `INSERT INTO jobs (job_id, deal_id, document_id, type, queue, status, payload, parent_job_id, page_start, page_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     RETURNING id, job_id, status`,
    [
      sanitizeText(jobId),
      input.deal_id ? sanitizeText(input.deal_id) : null,
      input.document_id ? sanitizeText(input.document_id) : null,
      sanitizeText(input.type),
      sanitizeText(queueName),
      "queued",
      JSON.stringify(persistedPayload ?? {}),
			input.parent_job_id ? sanitizeText(input.parent_job_id) : null,
			typeof input.page_start === "number" ? Math.max(0, Math.floor(input.page_start)) : null,
			typeof input.page_end === "number" ? Math.max(0, Math.floor(input.page_end)) : null,
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
  // Always sanitize: BullMQ rejects IDs containing ':'. Callers may pass raw
  // template strings (e.g. from ensure-documents-ready-for-analysis). safeJobId
  // is idempotent for already-clean IDs.
  const sanitizedJobId = safeJobId(params.jobId);
  const retryOpts = defaultBullmqRetryOpts();
  console.log(
    JSON.stringify({
      event: "BULLMQ_ENQUEUE",
      queue: getQueueNameForJobType(params.type),
      name: params.type,
      job_id: sanitizedJobId,
      attempts: retryOpts.attempts,
      backoff_type: retryOpts.backoff.type,
      backoff_delay: retryOpts.backoff.delay,
      deal_id: typeof params.bullPayload.deal_id === "string" ? params.bullPayload.deal_id : undefined,
      document_id: typeof params.bullPayload.document_id === "string" ? params.bullPayload.document_id : undefined,
    })
  );
  await queue.add(params.type, params.bullPayload, {
    jobId: sanitizedJobId,
    removeOnComplete: true,
    removeOnFail: false,
    ...retryOpts,
  });
}

export async function enqueueJob(input: EnqueueJobInput, opts?: EnqueueJobOptions) {
  const pool: DbPoolLike = opts?.deps?.pool ?? getPool();
  const queue = opts?.deps?.queue;

  const inserted = await insertJobRow(input, opts);

  try {
    // If this is running inside an external DB transaction (idempotency wrapper),
    // callers should prefer calling insertJobRow(...) in-tx and enqueueBullmqJob(...) after commit.
    //
    // When opts.jobId is provided it is used as the BullMQ dedup key so that
    // repeated enqueue calls with the same deterministic key are ignored by BullMQ
    // while AWS DB rows continue to track each attempt independently.
    await enqueueBullmqJob(
      { type: input.type, jobId: opts?.jobId ?? inserted.job_id, bullPayload: inserted.bullPayload },
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
