import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required for queue operations");
}

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const ingestQueue = new Queue("ingest_document", { connection });
export const fetchEvidenceQueue = new Queue("fetch_evidence", { connection });
export const analyzeDealQueue = new Queue("analyze_deal", { connection });

export async function closeQueues() {
  await Promise.allSettled([
    ingestQueue.close(),
    fetchEvidenceQueue.close(),
    analyzeDealQueue.close(),
    connection.quit(),
  ]);
}
