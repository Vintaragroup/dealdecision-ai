import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
import { QUEUE_NAMES } from "@dealdecision/core";

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

      // Re-log once with an explicit non-fatal note.
      return originalWarn(
        `${first} (continuing anyway; managed Redis/Valkey may not allow changing this setting)`
      );
    }
    return originalWarn(...args);
  };
}

export type ApiQueues = {
  ingestQueue: Queue;
  renderDocumentPagesQueue: Queue;
  extractVisualsQueue: Queue;
  populateDocumentPageUnderstandingQueue: Queue;
  deepScanVisualsQueue: Queue;
  documentIntelligenceExtractQueue: Queue;
  fetchEvidenceQueue: Queue;
  analyzeDealQueue: Queue;
  verifyDocumentsQueue: Queue;
  remediateExtractionQueue: Queue;
  reextractDocumentsQueue: Queue;
};

function assertQueueNamesRuntimeExport() {
  if (!QUEUE_NAMES || typeof QUEUE_NAMES !== "object") {
    throw new Error(
      "QUEUE_NAMES is missing at runtime. API must import QUEUE_NAMES from @dealdecision/core (runtime export), not @dealdecision/contracts."
    );
  }

  const requiredKeys = [
    "ingest_documents",
    "render_document_pages",
    "extract_visuals",
    "populate_document_page_understanding",
    "document_intelligence_extract",
  ] as const;

  for (const key of requiredKeys) {
    const value = (QUEUE_NAMES as any)[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `QUEUE_NAMES is missing required key: ${key}. API must import QUEUE_NAMES from @dealdecision/core only.`
      );
    }
  }
}

let singletonConnection: IORedis | null = null;
let singletonQueues: ApiQueues | null = null;
let didInstallBullmqWarnDeduper = false;
let didLogQueueConfig = false;

function ensureEnvLoaded() {
  // We intentionally avoid calling dotenv.config() at import time so importing this module
  // does not have side effects in unit tests.
  dotenv.config();
}

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for queue operations");
  }
  return redisUrl;
}

function installBullmqWarnDeduperOnce() {
  if (didInstallBullmqWarnDeduper) return;
  didInstallBullmqWarnDeduper = true;
  try {
    installBullmqEvictionPolicyWarningDeduper();
  } catch (err) {
    // Never throw from init path.
    try {
      console.warn("[queue] Failed to install BullMQ warn deduper", err);
    } catch {
      // ignore
    }
  }
}

function attachConnectionEventHandlers(conn: IORedis) {
  // Avoid double-registering handlers.
  const marker = "__dealdecision_api_queue_handlers_installed";
  if ((conn as any)[marker]) return;
  (conn as any)[marker] = true;

  conn.on("error", (err) => {
    try {
      console.warn("[queue] Redis connection error", err);
    } catch {
      // ignore
    }
  });

  conn.on("end", () => {
    try {
      console.warn("[queue] Redis connection ended");
    } catch {
      // ignore
    }
  });
}

export function getConnection(): IORedis {
  if (singletonConnection) return singletonConnection;

  ensureEnvLoaded();
  const redisUrl = getRedisUrl();

  const conn = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  attachConnectionEventHandlers(conn);
  singletonConnection = conn;
  return conn;
}

export function getQueues(): ApiQueues {
  if (singletonQueues) return singletonQueues;

  installBullmqWarnDeduperOnce();
  assertQueueNamesRuntimeExport();
  const connection = getConnection();

  singletonQueues = {
    ingestQueue: new Queue(QUEUE_NAMES.ingest_documents, { connection }),
    renderDocumentPagesQueue: new Queue(QUEUE_NAMES.render_document_pages, {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
    }),
    extractVisualsQueue: new Queue(QUEUE_NAMES.extract_visuals, {
      connection,
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 10_000 } },
    }),
    populateDocumentPageUnderstandingQueue: new Queue(QUEUE_NAMES.populate_document_page_understanding, {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
    }),
    deepScanVisualsQueue: new Queue(QUEUE_NAMES.deep_scan_visuals, { connection }),
    documentIntelligenceExtractQueue: new Queue(QUEUE_NAMES.document_intelligence_extract, { connection }),
    fetchEvidenceQueue: new Queue(QUEUE_NAMES.fetch_evidence, { connection }),
    analyzeDealQueue: new Queue(QUEUE_NAMES.analyze_deal, { connection }),
    verifyDocumentsQueue: new Queue(QUEUE_NAMES.verify_documents, { connection }),
    remediateExtractionQueue: new Queue(QUEUE_NAMES.remediate_extraction, { connection }),
    reextractDocumentsQueue: new Queue(QUEUE_NAMES.reextract_documents, { connection }),
  };

  if (!didLogQueueConfig && process.env.NODE_ENV !== "production") {
    didLogQueueConfig = true;
    try {
      const redisUrl = getRedisUrl();
      const parsed = new URL(redisUrl);
      const host = parsed.hostname;
      const port = parsed.port || "6379";
      const user = parsed.username ? `${parsed.username}@` : "";
      const safeUrl = `${parsed.protocol}//${user}${host}:${port}${parsed.pathname}`;
      const queues = [
        QUEUE_NAMES.ingest_documents,
        QUEUE_NAMES.render_document_pages,
        QUEUE_NAMES.extract_visuals,
        QUEUE_NAMES.populate_document_page_understanding,
        QUEUE_NAMES.deep_scan_visuals,
        QUEUE_NAMES.document_intelligence_extract,
        QUEUE_NAMES.fetch_evidence,
        QUEUE_NAMES.analyze_deal,
        QUEUE_NAMES.verify_documents,
        QUEUE_NAMES.remediate_extraction,
        QUEUE_NAMES.reextract_documents,
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
      try {
        console.warn("[queue] Failed to log queue config", err);
      } catch {
        // ignore
      }
    }
  }

  return singletonQueues;
}

export async function closeQueues() {
  const queues = singletonQueues;
  const conn = singletonConnection;

  // Ensure idempotency: calling closeQueues() without initialization should be a no-op.
  singletonQueues = null;
  singletonConnection = null;

  const closeQueuePromises: Promise<unknown>[] = [];

  if (queues) {
    closeQueuePromises.push(
      queues.ingestQueue.close(),
      queues.renderDocumentPagesQueue.close(),
      queues.extractVisualsQueue.close(),
      queues.populateDocumentPageUnderstandingQueue.close(),
      queues.deepScanVisualsQueue.close(),
      queues.documentIntelligenceExtractQueue.close(),
      queues.fetchEvidenceQueue.close(),
      queues.analyzeDealQueue.close(),
      queues.verifyDocumentsQueue.close(),
      queues.remediateExtractionQueue.close(),
      queues.reextractDocumentsQueue.close()
    );
  }

  // Close all queues first.
  await Promise.allSettled(closeQueuePromises);

  // Then shut down the Redis connection. Prefer disconnect() to avoid writing during teardown
  // (node:test has been producing EPIPE/unhandledRejection when sockets are closed late).
  if (conn) {
    const shutdownPromises: Promise<unknown>[] = [];

    shutdownPromises.push(
      (async () => {
        try {
          conn.disconnect();
        } catch {
          // Fall back to quit() if disconnect() fails for any reason.
          try {
            await conn.quit();
          } catch {
            // ignore
          }
        }
      })()
    );

    await Promise.allSettled(shutdownPromises);
  }
}
