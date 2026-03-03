process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/investor-insights returns 400 for non-UUID deal_id", async () => {
  const mockPool = {
    query: async (_sql: string) => {
      throw new Error("should not be called");
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
  });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/not-a-uuid/investor-insights`,
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.error, "invalid_deal_id");

  await app.close();
});

test("GET /api/v1/deals/:deal_id/investor-insights returns not_started when table missing", async () => {
  const dealId = "00000000-0000-0000-0000-000000000060";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: null }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
  });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.status, "not_started");

  await app.close();
});

test("GET /api/v1/deals/:deal_id/investor-insights returns not_started when no rows", async () => {
  const dealId = "00000000-0000-0000-0000-000000000061";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      if (sql.includes("FROM investor_insight_reports") && sql.includes("ORDER BY updated_at DESC")) {
        return { rows: [] };
      }
      // buildStatusSummary jobs query
      if (sql.includes("FROM jobs") && sql.includes("type = 'analyze_deal'")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
  });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.status, "not_started");

  await app.close();
});

test("GET /api/v1/deals/:deal_id/investor-insights returns report shape when row exists", async () => {
  const dealId = "00000000-0000-0000-0000-000000000062";
  const updatedAt = "2026-02-23T10:00:00.000Z";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      if (sql.includes("FROM investor_insight_reports") && sql.includes("ORDER BY updated_at DESC")) {
        return {
          rows: [
            {
              status: "deterministic_only",
              engine_version: "v1",
              upstream_fingerprint: "abc123",
              gate_state: { all_passed: true, results: [] },
              compliance_state: { status: "not_run", events: [] },
              render_package: { sections: [] },
              updated_at: updatedAt,
            },
          ],
        };
      }
      // buildStatusSummary jobs query
      if (sql.includes("FROM jobs") && sql.includes("type = 'analyze_deal'")) {
        return { rows: [{ status: "succeeded", updated_at: updatedAt }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
  });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.status, "deterministic_only");
  assert.equal(body.engine_version, "v1");
  assert.equal(body.upstream_fingerprint, "abc123");
  assert.deepEqual(body.gate_state, { all_passed: true, results: [] });
  assert.deepEqual(body.compliance_state, { status: "not_run", events: [] });
  assert.deepEqual(body.render_package, { sections: [] });
  assert.equal(body.updated_at, updatedAt);
  assert.equal(body.report_payload, undefined); // never returned

  await app.close();
});
