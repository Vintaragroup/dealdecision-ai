import type { Job } from "bullmq";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type { JobProgressEventV1 } from "@dealdecision/contracts";

import { getPool } from "./db";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed"
  | "retrying"
  | "cancelled";

export type JobProgressPayload = {
  stage?: string;
  current?: number;
  total?: number;
  message?: string;
  meta?: Record<string, unknown>;
};

export type UpdateJobProgressInput = {
  status?: JobStatus;
  stage?: string;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
  parent_job_id?: string | null;
  page_start?: number;
  page_end?: number;
};

type PendingDbWrite = {
  jobId: string;
  queueName?: string | null;
  status?: JobStatus;
  stage?: string;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
  statusDetailJson?: string;
  finishedAt?: string | null;
  startedAt?: string | null;
  progressPct?: number | null;
  parentJobId?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
};

type JobWriteState = {
  lastDbWriteAt: number;
  timer: NodeJS.Timeout | null;
  pending: PendingDbWrite | null;
};

const DEFAULT_DB_DEBOUNCE_MS = 400;

function getDbDebounceMs(): number {
  const raw = process.env.JOB_PROGRESS_DB_DEBOUNCE_MS;
  const n = raw == null ? DEFAULT_DB_DEBOUNCE_MS : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DB_DEBOUNCE_MS;
  return Math.max(150, Math.min(2000, Math.floor(n)));
}

const perJobState = new Map<string, JobWriteState>();

function mergePendingDbWrites(prev: PendingDbWrite, next: PendingDbWrite): PendingDbWrite {
  // Preserve already-known status and timestamps unless the newer payload explicitly sets them.
  // This prevents a progress-only update from clobbering a just-scheduled status transition
  // when DB writes are debounced.
  return {
    ...prev,
    ...next,
    status: next.status ?? prev.status,
    startedAt: next.startedAt ?? prev.startedAt,
    finishedAt: next.finishedAt ?? prev.finishedAt,
    parentJobId: next.parentJobId ?? prev.parentJobId,
    pageStart: typeof next.pageStart === "number" ? next.pageStart : prev.pageStart,
    pageEnd: typeof next.pageEnd === "number" ? next.pageEnd : prev.pageEnd,
  };
}

function computeProgressPct(current: number | undefined, total: number | undefined): number | null {
  if (typeof current !== "number" || typeof total !== "number") return null;
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  const pct = Math.round((Math.max(0, Math.min(current, total)) / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

function normalizeNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

async function writeJobProgressToDb(pending: PendingDbWrite): Promise<void> {
  const pool = getPool();

  await pool.query(
    `UPDATE jobs
        SET status = COALESCE($2, status),
            queue = COALESCE(queue, type),
            stage = COALESCE($3, stage),
            progress_current = COALESCE($4, progress_current),
            progress_total = COALESCE($5, progress_total),
            progress_pct = COALESCE($6, progress_pct),
            message = COALESCE($7, message),
            error = COALESCE($8, error),
            status_detail = COALESCE($9::jsonb, status_detail),
            started_at = COALESCE($10::timestamptz, started_at),
            finished_at = COALESCE($11::timestamptz, finished_at),
            parent_job_id = COALESCE($12, parent_job_id),
            page_start = COALESCE($13, page_start),
            page_end = COALESCE($14, page_end),
            updated_at = now()
      WHERE job_id = $1`,
    [
      sanitizeText(pending.jobId),
      pending.status ? sanitizeText(pending.status) : null,
      pending.stage ? sanitizeText(pending.stage) : null,
      typeof pending.current === "number" ? pending.current : null,
      typeof pending.total === "number" ? pending.total : null,
      typeof pending.progressPct === "number" ? pending.progressPct : null,
      pending.message ? sanitizeText(pending.message) : null,
      pending.error ? sanitizeText(pending.error) : null,
      pending.statusDetailJson ?? null,
      pending.startedAt ?? null,
      pending.finishedAt ?? null,
      pending.parentJobId ? sanitizeText(pending.parentJobId) : null,
      typeof pending.pageStart === "number" ? pending.pageStart : null,
      typeof pending.pageEnd === "number" ? pending.pageEnd : null,
    ]
  );

  const isIngest = String(pending.queueName ?? "").toLowerCase() === "ingest_documents";
  if (pending.status === "failed" && isIngest) {
    const { rows } = await pool.query<{ document_id: string | null }>(
      `SELECT document_id FROM jobs WHERE job_id = $1 LIMIT 1`,
      [sanitizeText(pending.jobId)]
    );
    const documentId = rows?.[0]?.document_id;
    if (documentId) {
      const message = pending.error ?? pending.message ?? "failed";
      await pool.query(
        `UPDATE documents
            SET status = 'failed',
                extraction_metadata = jsonb_set(
                  jsonb_set(COALESCE(extraction_metadata, '{}'::jsonb), '{status}', '"failed"'::jsonb, true),
                  '{errorMessage}', to_jsonb($2::text), true
                ),
                updated_at = now()
          WHERE id = $1`,
        [sanitizeText(documentId), sanitizeText(message)]
      );
    }
  }
}

function scheduleDbWrite(jobId: string, pending: PendingDbWrite): void {
  const debounceMs = getDbDebounceMs();
  const now = Date.now();

  const state: JobWriteState = perJobState.get(jobId) ?? { lastDbWriteAt: 0, timer: null, pending: null };
  state.pending = state.pending ? mergePendingDbWrites(state.pending, pending) : pending;

  const elapsed = now - state.lastDbWriteAt;
  const delay = elapsed >= debounceMs ? 0 : debounceMs - elapsed;

  if (state.timer) {
    // Existing timer will flush the latest pending payload.
    perJobState.set(jobId, state);
    return;
  }

  state.timer = setTimeout(() => {
    const s = perJobState.get(jobId);
    if (!s) return;
    const p = s.pending;
    s.pending = null;
    s.timer = null;
    s.lastDbWriteAt = Date.now();
    perJobState.set(jobId, s);

    if (!p) return;
    void writeJobProgressToDb(p).catch((err) => {
      console.warn(
        `[job_progress] db update failed job=${jobId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }, delay);

  perJobState.set(jobId, state);
}

export async function updateJobProgress(job: Job, input: UpdateJobProgressInput): Promise<void> {
  const jobId = (job.id ?? job.name)?.toString();
  if (!jobId) return;

  const stage = typeof input.stage === "string" ? input.stage : undefined;
  const current = normalizeNumber(input.current);
  const total = normalizeNumber(input.total);
  const message = typeof input.message === "string" ? input.message : undefined;

  // BullMQ progress (fast): can be updated on every loop.
  const progressPayload: JobProgressPayload = {
    ...(stage ? { stage } : {}),
    ...(typeof current === "number" ? { current } : {}),
    ...(typeof total === "number" ? { total } : {}),
    ...(message ? { message } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  };

  try {
    await job.updateProgress(progressPayload as any);
  } catch (err) {
    console.warn(
      `[job_progress] bullmq updateProgress failed job=${jobId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Postgres write (debounced): keep UI progress across reloads.
  const atIso = new Date().toISOString();
  const progressPct = computeProgressPct(current, total);
  const isTerminal =
    input.status === "succeeded" ||
    input.status === "succeeded_with_warnings" ||
    input.status === "failed" ||
    input.status === "cancelled";
  const startedAt = input.status === "running" ? atIso : null;
  const finishedAt = isTerminal ? atIso : null;

  const statusDetail = {
    progress: {
      at: atIso,
      job_id: jobId,
      ...progressPayload,
      ...(typeof progressPct === "number" ? { percent: progressPct } : {}),
    },
  };

  const pending: PendingDbWrite = {
    jobId,
    queueName: (job as any).queueName ?? null,
    status: input.status,
    stage,
    current,
    total,
    message,
    error: input.error,
    statusDetailJson: JSON.stringify(sanitizeDeep(statusDetail)),
    startedAt,
    finishedAt,
    progressPct,
    parentJobId: input.parent_job_id ?? null,
    pageStart:
      typeof input.page_start === "number" && Number.isFinite(input.page_start)
        ? Math.max(0, Math.floor(input.page_start))
        : null,
    pageEnd:
      typeof input.page_end === "number" && Number.isFinite(input.page_end)
        ? Math.max(0, Math.floor(input.page_end))
        : null,
  };

  scheduleDbWrite(jobId, pending);
}

// ── Throttled progress event emitter ─────────────────────────────────────────
// Module-level cache so per-module callers share the same dedup window.
const progressEmitCache = new Map<string, { ts: number; stage?: string }>();

/**
 * Emit a structured job-progress event (JobProgressEventV1) via updateJobProgress,
 * with a 1-second per-stage dedup window to avoid flooding the DB.
 *
 * Exported so processors outside of index.ts can use the same throttling.
 */
export async function emitJobProgress(job: Job, progress: JobProgressEventV1): Promise<void> {
  const jobId = (job.id ?? (job as any).name)?.toString();
  if (!jobId) return;
  const now = Date.now();
  const prev = progressEmitCache.get(jobId);
  if (prev && prev.stage === progress.stage && now - prev.ts < 1000) return;
  progressEmitCache.set(jobId, { ts: now, stage: progress.stage });

  await updateJobProgress(job, {
    stage: progress.stage,
    current: typeof progress.percent === "number" ? progress.percent : undefined,
    total: typeof progress.percent === "number" ? 100 : undefined,
    message: progress.message,
    meta: (progress as any).meta,
    page_start:
      typeof (progress as any)?.meta?.page_start === "number"
        ? (progress as any).meta.page_start
        : undefined,
    page_end:
      typeof (progress as any)?.meta?.page_end === "number"
        ? (progress as any).meta.page_end
        : undefined,
  });
}
