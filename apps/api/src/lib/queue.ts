import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";

// Ensure env is loaded before queues initialize.
dotenv.config();

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required for queue operations");
}

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const ingestQueue = new Queue("ingest_documents", { connection });
export const extractVisualsQueue = new Queue("extract_visuals", { connection });
export const fetchEvidenceQueue = new Queue("fetch_evidence", { connection });
export const analyzeDealQueue = new Queue("analyze_deal", { connection });
export const verifyDocumentsQueue = new Queue("verify_documents", { connection });
export const remediateExtractionQueue = new Queue("remediate_extraction", { connection });
export const reextractDocumentsQueue = new Queue("reextract_documents", { connection });

if (process.env.NODE_ENV !== "production") {
  try {
    const parsed = new URL(redisUrl);
    const host = parsed.hostname;
    const port = parsed.port || "6379";
    const user = parsed.username ? `${parsed.username}@` : "";
    const safeUrl = `${parsed.protocol}//${user}${host}:${port}${parsed.pathname}`;
    const queues = [
      "ingest_documents",
      "extract_visuals",
      "fetch_evidence",
      "analyze_deal",
      "verify_documents",
      "remediate_extraction",
      "reextract_documents",
    ];
    console.log(
      JSON.stringify({
        event: "queue_config",
        kind: "api",
        redis: { host, port, url: safeUrl, prefix: "bull" },
        queues,
      })
    );
  } catch (err) {
    console.warn("[queue] Failed to log queue config", err);
  }
}

export async function closeQueues() {
  await Promise.allSettled([
    ingestQueue.close(),
    extractVisualsQueue.close(),
    fetchEvidenceQueue.close(),
    analyzeDealQueue.close(),
    verifyDocumentsQueue.close(),
    remediateExtractionQueue.close(),
    reextractDocumentsQueue.close(),
    connection.quit(),
  ]);
}
