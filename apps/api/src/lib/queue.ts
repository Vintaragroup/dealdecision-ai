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
