import type { Job, Processor } from "bullmq";
import IORedis from "ioredis";
import { wrapBullmqProcessorWithRunLedger } from "./pipeline-run-ledger";

let BullMQ: typeof import("bullmq");

const injectedBullmq = (globalThis as any).__DEALDECISION_BULLMQ as
  | { Worker: any; Queue: any }
  | undefined;

if (injectedBullmq?.Worker && injectedBullmq?.Queue) {
  BullMQ = injectedBullmq as any;
} else {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    BullMQ = require("bullmq");
  } catch (err) {
    const error = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    console.error(
      JSON.stringify({
        event: "FATAL_MISSING_BULLMQ",
        service: "worker",
        error,
      })
    );
    process.exit(1);
  }
}

const { Worker, Queue } = BullMQ;

export function getBullmqRuntimeInfo(): { version: string | null; resolved: string | null } {
  let version: string | null = null;
  let resolved: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    version = require("bullmq/package.json")?.version ?? null;
  } catch {
    version = null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    resolved = require.resolve("bullmq");
  } catch {
    resolved = null;
  }
  return { version, resolved };
}

function installBullmqEvictionPolicyWarningDeduper() {
  const originalWarn = console.warn;
  let warned = false;

  // BullMQ logs this warning via console.warn when maxmemory-policy !== "noeviction".
  // On managed Redis/Valkey, changing the eviction policy may not be possible.
  // We keep the safety intent but ensure it only logs once per process.
  console.warn = (...args: any[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      first.startsWith("IMPORTANT! Eviction policy is ") &&
      first.includes('It should be "noeviction"')
    ) {
      if (warned) return;
      warned = true;

      return originalWarn(
        `${first} (continuing anyway; managed Redis/Valkey may not allow changing this setting)`
      );
    }
    return originalWarn(...args);
  };
}

installBullmqEvictionPolicyWarningDeduper();

const redisUrl = process.env.REDIS_URL ?? "";

if (!redisUrl) {
  throw new Error("REDIS_URL is required for worker queues");
}

function safeRedisUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname;
    const port = parsed.port || "6379";
    const user = parsed.username ? `${parsed.username}@` : "";
    return `${parsed.protocol}//${user}${host}:${port}${parsed.pathname}`;
  } catch {
    return "<invalid_redis_url>";
  }
}

console.log(`[queue] Connecting to Redis: ${safeRedisUrl(redisUrl)}`);

function safeDbTarget(raw: string | undefined): string {
  if (!raw) return "<missing_database_url>";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname;
    const port = parsed.port || "5432";
    const db = parsed.pathname?.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname;
    return `${host}:${port}/${db || "<unknown_db>"}`;
  } catch {
    return "<invalid_database_url>";
  }
}

console.log(`[queue] DB target: ${safeDbTarget(process.env.DATABASE_URL)}`);

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('connect', () => {
  console.log('[queue] Redis connected');
});

connection.on('error', (err) => {
  console.error('[queue] Redis connection error:', err);
});

export function createWorker(
  name:
    | "ingest_documents"
    | "render_document_pages"
    | "extract_visuals"
    | "deep_scan_visuals"
    | "document_intelligence_extract"
    | "fetch_evidence"
    | "analyze_deal"
    | "verify_documents"
    | "remediate_extraction"
    | "reextract_documents"
    | "generate_ingestion_report"
    | "reconcile_ingest"
    | "orchestration",
  processor: Processor<any, any, string>,
  options?: {
    concurrency?: number;
    lockDuration?: number;
  }
) {
  console.log(`[queue] Creating worker for queue: ${name}`);

  const readPositiveIntEnv = (key: string, fallback: number) => {
    const raw = process.env[key];
    if (raw == null || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      console.warn(`[queue] Invalid ${key}=${raw}; using ${fallback}`);
      return fallback;
    }
    return parsed;
  };

  // Global concurrency cap (Render OOM prevention).
  // Default is 1 unless explicitly overridden per-queue.
  const envConcurrency = readPositiveIntEnv("WORKER_CONCURRENCY", 1);
  const concurrency = options?.concurrency ?? envConcurrency;

  // NOTE: lockDuration must cover long-running CPU-heavy extraction loops.
  // Keep reextract_documents here: it can run full document re-processing + enqueue downstream work.
  const heavyQueues = new Set([
    "ingest_documents",
    "render_document_pages",
    "extract_visuals",
    "deep_scan_visuals",
    "reextract_documents",
  ]);
  const lockDuration =
    options?.lockDuration ?? (heavyQueues.has(name) ? 10 * 60 * 1000 : 2 * 60 * 1000);

  const heartbeatMsRaw = process.env.JOB_HEARTBEAT_INTERVAL_MS;
  const heartbeatMs = heartbeatMsRaw == null ? 60000 : Number(heartbeatMsRaw);

  const processorWithHeartbeat: Processor<any, any, string> = async (job, token) => {
    const intervalMs = Number.isFinite(heartbeatMs)
      ? Math.max(5000, Math.floor(heartbeatMs))
      : 60000;
    let stopped = false;

    const timer = setInterval(() => {
      if (stopped) return;
      // Only update updated_at / status_detail; do NOT overwrite stage or message.
      // Lazily require to avoid forcing DB env in unit tests that don't need it.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { updateJobProgress } = require("./job-progress") as typeof import("./job-progress");

      void updateJobProgress(job as Job, { meta: { heartbeat: true } }).catch(() => {
        // Best-effort heartbeat.
      });
    }, intervalMs);

    try {
      return await processor(job, token);
    } finally {
      stopped = true;
      clearInterval(timer);
    }
  };

  const processorWithLedger = wrapBullmqProcessorWithRunLedger(
    () => {
      // Lazy DB import so unit tests that only validate worker options don't need DATABASE_URL.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getPool } = require("./db") as typeof import("./db");
      return getPool();
    },
    processorWithHeartbeat
  );

  const worker = new Worker(name, processorWithLedger, {
    connection,
    concurrency,
    lockDuration,
  });

  console.log(
    JSON.stringify({
      event: "worker_config",
      queue: name,
      concurrency,
      lock_duration_ms: lockDuration,
    })
  );
  
  worker.on('active', (job) => {
    console.log(`[worker] Job active: ${job.id} - ${name}`);
  });
  
  worker.on('completed', (job) => {
    console.log(`[worker] Job completed: ${job.id} - ${name}`);
  });
  
  worker.on('failed', (job, err) => {
    console.error(`[worker] Job failed: ${job?.id} - ${name}`, err?.message);
  });
  
  worker.on('error', (err) => {
    console.error(`[worker] Worker error: ${name}`, err);
  });
  
  // Log ready state
  worker.on('ready', () => {
    console.log(`[worker] Worker ready: ${name}`);
  });
  
  // Log when worker is waiting for jobs
  worker.on('drained', () => {
    console.log(`[worker] Queue drained (waiting for jobs): ${name}`);
  });
  
  return worker;
}

export function getQueue(
  name:
    | "ingest_documents"
    | "render_document_pages"
    | "extract_visuals"
    | "deep_scan_visuals"
    | "document_intelligence_extract"
    | "fetch_evidence"
    | "analyze_deal"
    | "verify_documents"
    | "remediate_extraction"
    | "reextract_documents"
    | "generate_ingestion_report"
    | "generate_ingestion_report"
    | "reconcile_ingest"
    | "orchestration"
) {
  const defaultJobOptions = name === "extract_visuals"
    ? { attempts: 5, backoff: { type: "exponential", delay: 10_000 } }
    : undefined;
  return new Queue(name, { connection, defaultJobOptions });
}

export function logWorkerQueueConfig(kind: "worker", workers: string[]) {
  if (process.env.NODE_ENV === "production") return;
  try {
    const parsed = new URL(redisUrl);
    const host = parsed.hostname;
    const port = parsed.port || "6379";
    const user = parsed.username ? `${parsed.username}@` : "";
    const safeUrl = `${parsed.protocol}//${user}${host}:${port}${parsed.pathname}`;

    console.log(
      JSON.stringify({
        event: "queue_config",
        kind,
        redis: { host, port, url: safeUrl, prefix: "bull" },
        workers,
      })
    );
  } catch (err) {
    console.warn("[queue] Failed to log worker queue config", err);
  }
}
