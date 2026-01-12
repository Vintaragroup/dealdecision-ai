import { Worker, Queue, type Job, type Processor } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "";

if (!redisUrl) {
  throw new Error("REDIS_URL is required for worker queues");
}

console.log(`[queue] Connecting to Redis: ${redisUrl}`);

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
    | "extract_visuals"
    | "fetch_evidence"
    | "analyze_deal"
    | "verify_documents"
    | "remediate_extraction"
    | "reextract_documents"
    | "generate_ingestion_report"
    | "generate_ingestion_report"
    | "reconcile_ingest"
    | "orchestration",
  processor: Processor<any, any, string>
) {
  console.log(`[queue] Creating worker for queue: ${name}`);
  
  const worker = new Worker(name, processor, { 
    connection,
    concurrency: 2,  // Allow 2 concurrent jobs
  });
  
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
    | "extract_visuals"
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
  return new Queue(name, { connection });
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
