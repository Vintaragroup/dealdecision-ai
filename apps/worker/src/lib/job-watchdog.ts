import { sanitizeText } from "@dealdecision/core";

export type JobWatchdogOptions = {
  pool?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
  now?: Date;
  limit?: number;
};

type RunningJobRow = {
  job_id: string;
  queue: string | null;
  type: string | null;
  stage: string | null;
  updated_at: string | Date;
  document_id: string | null;
};

const MIN_SCAN_AGE_MS = 5 * 60_000;

const QUEUE_TIMEOUTS_MS: Record<string, number> = {
  ingest_documents: 60 * 60_000,
  extract_visuals: 60 * 60_000,
  deep_scan_visuals: 90 * 60_000,
  fetch_evidence: 30 * 60_000,
  analyze_deal: 30 * 60_000,
  verify_documents: 30 * 60_000,
  remediate_extraction: 30 * 60_000,
  reextract_documents: 30 * 60_000,
  orchestration: 60 * 60_000,
  generate_ingestion_report: 20 * 60_000,
  reconcile_ingest: 20 * 60_000,
};

// Stage-specific overrides. Key format: `${queue}:${stage}`.
const STAGE_TIMEOUTS_MS: Record<string, number> = {
  "ingest_documents:persist_document": 30 * 60_000,
  "ingest_documents:finalize": 10 * 60_000,
  "reextract_documents:status_update": 5 * 60_000,
};

function parseUpdatedAt(value: string | Date): Date {
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : new Date(0);
}

export function getJobTimeoutMs(queue: string | null, stage: string | null, type: string | null): number {
  const q = (queue ?? type ?? "").toString();
  const s = (stage ?? "").toString();
  const key = q && s ? `${q}:${s}` : "";
  if (key && STAGE_TIMEOUTS_MS[key] != null) return STAGE_TIMEOUTS_MS[key];
  if (q && QUEUE_TIMEOUTS_MS[q] != null) return QUEUE_TIMEOUTS_MS[q];
  return 60 * 60_000;
}

export function formatStaleJobError(details: {
  ageMs: number;
  timeoutMs: number;
  queue: string | null;
  stage: string | null;
}): string {
  const ageMin = Math.round(details.ageMs / 60_000);
  const timeoutMin = Math.round(details.timeoutMs / 60_000);
  const q = details.queue ?? "";
  const s = details.stage ?? "";
  return `stale_job_timeout age_min=${ageMin} timeout_min=${timeoutMin} queue=${q} stage=${s}`.trim();
}

export async function runJobWatchdogOnce(opts?: JobWatchdogOptions): Promise<{ scanned: number; failed: number }> {
  const pool =
    opts?.pool ??
    // Lazily import DB to avoid DATABASE_URL requirement in unit tests that inject a mock pool.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require("./db") as { getPool: () => any }).getPool();
  const now = opts?.now ?? new Date();
  const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : 500;

  const { rows } = (await pool.query(
    `SELECT job_id, queue, type, stage, updated_at, document_id
       FROM jobs
      WHERE status = 'running'
        AND updated_at < (now() - ($1::int * interval '1 millisecond'))
      ORDER BY updated_at ASC
      LIMIT ${limit}`,
    [MIN_SCAN_AGE_MS]
  )) as unknown as { rows: RunningJobRow[] };

  let failed = 0;

  for (const row of rows) {
    const updatedAt = parseUpdatedAt(row.updated_at);
    const ageMs = now.getTime() - updatedAt.getTime();
    const timeoutMs = getJobTimeoutMs(row.queue, row.stage, row.type);

    if (!Number.isFinite(ageMs) || ageMs <= timeoutMs) continue;

    const error = formatStaleJobError({ ageMs, timeoutMs, queue: row.queue, stage: row.stage });

    const res = await pool.query(
      `UPDATE jobs
          SET status = 'failed',
              error = $2,
              finished_at = now(),
              updated_at = now()
        WHERE job_id = $1
          AND status = 'running'
        RETURNING job_id`,
      [sanitizeText(row.job_id), sanitizeText(error)]
    );

    // Self-heal: if an ingest_documents job stalls/fails, ensure the related document row is also marked failed.
    const isIngest = String(row.queue ?? row.type ?? '').toLowerCase() === 'ingest_documents';
    if (isIngest && row.document_id && (res.rows?.length ?? 0) > 0) {
      await pool.query(
        `UPDATE documents
            SET status = 'failed',
                extraction_metadata = jsonb_set(
                  jsonb_set(COALESCE(extraction_metadata, '{}'::jsonb), '{status}', '"failed"'::jsonb, true),
                  '{errorMessage}', to_jsonb($2::text), true
                ),
                updated_at = now()
          WHERE id = $1`,
        [sanitizeText(row.document_id), sanitizeText(error)]
      );
    }

    if ((res.rows?.length ?? 0) > 0) failed++;
  }

  return { scanned: rows.length, failed };
}
