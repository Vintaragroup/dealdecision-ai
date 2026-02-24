process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

const noopPool = {
  query: async (_sql: string) => {
    throw new Error("should not be called");
  },
} as any;

test("POST /api/v1/deals/:deal_id/investor-insights/generate returns 400 for non-UUID deal_id", async () => {
  const app = Fastify();
  await registerDealRoutes(app, noopPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/investor-insights/generate",
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.error, "invalid_deal_id");

  await app.close();
});

test("POST /api/v1/deals/:deal_id/investor-insights/generate returns 202 { ok: true } when enqueue succeeds", async () => {
  const dealId = "00000000-0000-0000-0000-000000000070";

  let capturedName: string | undefined;
  let capturedData: unknown;
  let capturedOpts: unknown;

  const app = Fastify();
  await registerDealRoutes(app, noopPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async (name: string, data: unknown, opts?: unknown) => {
        capturedName = name;
        capturedData = data;
        capturedOpts = opts;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/investor-insights/generate`,
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.ok, true);

  // Verify enqueue arguments.
  assert.equal(capturedName, "generate_investor_insights");
  assert.deepEqual(capturedData, {
    deal_id: dealId,
    engine_version: "v1",
    triggered_by: "manual_generate",
    force_recompute: true,
  });
  const opts = capturedOpts as any;
  assert.equal(opts.jobId, `investor_insights__${dealId}__v1__manual_generate`);
  assert.equal(opts.removeOnComplete, true);
  assert.equal(opts.removeOnFail, false);

  await app.close();
});

test("POST /api/v1/deals/:deal_id/investor-insights/generate returns 500 when enqueue throws", async () => {
  const dealId = "00000000-0000-0000-0000-000000000071";

  const app = Fastify();
  await registerDealRoutes(app, noopPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async () => {
        throw new Error("Redis connection refused");
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/investor-insights/generate`,
  });

  assert.equal(res.statusCode, 500);
  const body = res.json() as any;
  assert.equal(body.error, "enqueue_failed");

  await app.close();
});
