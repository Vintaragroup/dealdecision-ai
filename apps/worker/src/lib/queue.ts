import { Worker, type Job, type Processor } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required for worker queues");
}

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export function createWorker(
  name: "ingest_document" | "fetch_evidence" | "analyze_deal",
  processor: Processor<any, any, string>
) {
  return new Worker(name, processor, { connection });
}
