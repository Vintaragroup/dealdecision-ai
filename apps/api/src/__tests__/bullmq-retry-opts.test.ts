// PR3 — BullMQ retry configuration regression tests.
//
// Guarantees:
// 1. defaultBullmqRetryOpts() returns the baseline: attempts=3, exponential backoff at 1s.
// 2. enqueueBullmqJob always passes attempts/backoff to queue.add.
// 3. BULLMQ_ENQUEUE structured log is emitted with retry metadata.
// 4. Route-level investor-insights enqueue carries attempts/backoff.
// 5. Route-level export-pdf enqueue carries attempts/backoff.

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { enqueueBullmqJob, defaultBullmqRetryOpts } from "../services/jobs";
import { registerDealRoutes } from "../routes/deals";
import { registerExportPdfRoutes } from "../routes/export-pdf";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultBullmqRetryOpts
// ─────────────────────────────────────────────────────────────────────────────

test("defaultBullmqRetryOpts returns attempts:3 with exponential backoff at 1000ms", () => {
  const opts = defaultBullmqRetryOpts();
  assert.equal(opts.attempts, 3);
  assert.equal(opts.backoff.type, "exponential");
  assert.equal(opts.backoff.delay, 1000);
});

// ─────────────────────────────────────────────────────────────────────────────
// enqueueBullmqJob — retry opts presence
// ─────────────────────────────────────────────────────────────────────────────

test("enqueueBullmqJob passes attempts:3 and exponential backoff to queue.add", async () => {
  let capturedOpts: Record<string, unknown> | undefined;
  const mockQueue = {
    add: async (_name: string, _data: unknown, opts: Record<string, unknown>) => {
      capturedOpts = opts;
      return {};
    },
  };

  await enqueueBullmqJob(
    { type: "analyze_deal", jobId: "job-abc-123", bullPayload: { deal_id: "deal-001" } },
    { deps: { queue: mockQueue as any } }
  );

  assert.ok(capturedOpts, "queue.add must be called");
  assert.equal(capturedOpts.attempts, 3, "attempts must be 3");
  const backoff = capturedOpts.backoff as any;
  assert.equal(backoff.type, "exponential", "backoff type must be exponential");
  assert.equal(backoff.delay, 1000, "backoff delay must be 1000ms");
});

test("enqueueBullmqJob sanitizes jobId before passing to queue.add", async () => {
  let capturedOpts: Record<string, unknown> | undefined;
  const mockQueue = {
    add: async (_name: string, _data: unknown, opts: Record<string, unknown>) => {
      capturedOpts = opts;
      return {};
    },
  };

  await enqueueBullmqJob(
    { type: "fetch_evidence", jobId: "dpu:deal-1:doc-2:v1", bullPayload: {} },
    { deps: { queue: mockQueue as any } }
  );

  assert.ok(capturedOpts, "queue.add must be called");
  const jobId = capturedOpts.jobId as string;
  assert.ok(!jobId.includes(":"), `jobId must not contain ':': "${jobId}"`);
  // Also has retry opts
  assert.equal(capturedOpts.attempts, 3);
});

test("enqueueBullmqJob emits BULLMQ_ENQUEUE log with retry metadata and identifiers", async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string") logs.push(args[0]);
  };

  const mockQueue = {
    add: async () => ({}),
  };

  try {
    await enqueueBullmqJob(
      {
        type: "populate_document_page_understanding",
        jobId: "job-log-test",
        bullPayload: { deal_id: "deal-xyz", document_id: "doc-abc" },
      },
      { deps: { queue: mockQueue as any } }
    );
  } finally {
    console.log = origLog;
  }

  const enqueueLog = logs.find((l) => {
    try {
      return JSON.parse(l).event === "BULLMQ_ENQUEUE";
    } catch {
      return false;
    }
  });

  assert.ok(enqueueLog, `Expected a BULLMQ_ENQUEUE log; saw: ${JSON.stringify(logs)}`);
  const parsed = JSON.parse(enqueueLog!) as Record<string, unknown>;
  assert.equal(parsed.attempts, 3);
  assert.equal(parsed.backoff_type, "exponential");
  assert.equal(parsed.backoff_delay, 1000);
  assert.equal(parsed.deal_id, "deal-xyz");
  assert.equal(parsed.document_id, "doc-abc");
});

// ─────────────────────────────────────────────────────────────────────────────
// investor-insights /generate route — retry opts
// ─────────────────────────────────────────────────────────────────────────────

const noopPool = { query: async () => { throw new Error("should not be called"); } } as any;

test("POST investor-insights/generate passes attempts:3 and exponential backoff to insightsQueue.add", async () => {
  const dealId = "00000000-0000-0000-0000-000000000080";
  let capturedOpts: Record<string, unknown> | undefined;

  const app = Fastify();
  await registerDealRoutes(app, noopPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async (_name: string, _data: unknown, opts: any) => {
        capturedOpts = opts as Record<string, unknown>;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/investor-insights/generate`,
  });
  await app.close();

  assert.equal(res.statusCode, 202);
  assert.ok(capturedOpts, "insightsQueue.add must be called");
  assert.equal(capturedOpts.attempts, 3, "attempts must be 3");
  const backoff = capturedOpts.backoff as any;
  assert.equal(backoff?.type, "exponential", "backoff type must be exponential");
  assert.equal(backoff?.delay, 1000, "backoff delay must be 1000ms");
});

test("POST investor-insights/regenerate passes attempts:3 and exponential backoff to insightsQueue.add", async () => {
  const dealId = "00000000-0000-0000-0000-000000000081";
  let capturedOpts: Record<string, unknown> | undefined;

  const regeneratePool = {
    query: async (sql: string) => {
      const s = sql.trim().toLowerCase();
      if (s.includes("financial_facts_v1") || s.includes("insight") || s.includes("dpu")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, regeneratePool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async (_name: string, _data: unknown, opts: any) => {
        capturedOpts = opts as Record<string, unknown>;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/investor-insights/regenerate`,
  });
  await app.close();

  assert.equal(res.statusCode, 202);
  assert.ok(capturedOpts, "insightsQueue.add must be called");
  assert.equal(capturedOpts.attempts, 3, "attempts must be 3");
  const backoff = capturedOpts.backoff as any;
  assert.equal(backoff?.type, "exponential");
  assert.equal(backoff?.delay, 1000);
});

// ─────────────────────────────────────────────────────────────────────────────
// export-pdf route — retry opts
// ─────────────────────────────────────────────────────────────────────────────

const DEAL_UUID_PDF = "00000000-0000-0000-0000-000000000099";

function makeExportDeps(queueAdd?: (...args: any[]) => Promise<any>) {
  const pool = {
    query: async (sql: string) => {
      const s = sql.trim().toLowerCase();
      if (s.startsWith("select id from deals")) return { rows: [{ id: DEAL_UUID_PDF }] };
      if (s.startsWith("insert into deal_report_exports")) return { rows: [] };
      if (s.includes("deal_report_exports")) return { rows: [] };
      return { rows: [] };
    },
  } as any;
  return { pool, exportReportPdfQueue: { add: queueAdd ?? (async () => ({ id: "bm-1" })) } };
}

const validExportConfig = {
  preset: "investor",
  format: "standard",
  sections: ["executive_summary", "financial_analysis"],
};

test("POST export-pdf passes attempts:3 and exponential backoff to queue.add", async () => {
  let capturedOpts: Record<string, unknown> | undefined;

  const { pool, exportReportPdfQueue } = makeExportDeps(
    async (_name: string, _data: unknown, opts: Record<string, unknown>) => {
      capturedOpts = opts;
      return { id: "bm-99" };
    }
  );

  const app = Fastify();
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_UUID_PDF}/report/export-pdf`,
    payload: { config: validExportConfig },
  });
  await app.close();

  assert.equal(res.statusCode, 202);
  assert.ok(capturedOpts, "queue.add must be called");
  assert.equal(capturedOpts.attempts, 3, "attempts must be 3");
  const backoff = capturedOpts.backoff as any;
  assert.equal(backoff?.type, "exponential");
  assert.equal(backoff?.delay, 1000);
});
