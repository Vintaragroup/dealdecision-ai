process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

// ---------------------------------------------------------------------------
// Shared minimal render_package fixture (satisfies OrchestratorRenderPackageInput)
// ---------------------------------------------------------------------------
function makeRenderPackage(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "investor_insights_v1",
    upstream_fingerprint: "test-fingerprint-abc",
    sections: [],
    gate_state: { all_passed: true, results: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: 400 for non-UUID deal_id
// ---------------------------------------------------------------------------
test("GET /api/v1/deals/:deal_id/orchestrator-report returns 400 for non-UUID deal_id", async () => {
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
    url: `/api/v1/deals/not-a-uuid/orchestrator-report`,
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.error, "invalid_deal_id");

  await app.close();
});

// ---------------------------------------------------------------------------
// Test 2: 404 when investor_insight_reports table is missing
// ---------------------------------------------------------------------------
test("GET /api/v1/deals/:deal_id/orchestrator-report returns 404 when table missing", async () => {
  const dealId = "00000000-0000-0000-0000-000000000070";

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
    url: `/api/v1/deals/${dealId}/orchestrator-report`,
  });

  assert.equal(res.statusCode, 404);
  const body = res.json() as any;
  assert.equal(body.error, "not_found");

  await app.close();
});

// ---------------------------------------------------------------------------
// Test 3: 404 when no rows in investor_insight_reports
// ---------------------------------------------------------------------------
test("GET /api/v1/deals/:deal_id/orchestrator-report returns 404 when no rows", async () => {
  const dealId = "00000000-0000-0000-0000-000000000071";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      if (sql.includes("FROM investor_insight_reports")) {
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
    url: `/api/v1/deals/${dealId}/orchestrator-report`,
  });

  assert.equal(res.statusCode, 404);
  const body = res.json() as any;
  assert.equal(body.error, "not_found");

  await app.close();
});

// ---------------------------------------------------------------------------
// Test 4: 404 when render_package is null
// ---------------------------------------------------------------------------
test("GET /api/v1/deals/:deal_id/orchestrator-report returns 404 when render_package is null", async () => {
  const dealId = "00000000-0000-0000-0000-000000000072";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      if (sql.includes("FROM investor_insight_reports")) {
        return {
          rows: [
            {
              status: "pending",
              render_package: null,
              upstream_fingerprint: "abc",
            },
          ],
        };
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
    url: `/api/v1/deals/${dealId}/orchestrator-report`,
  });

  assert.equal(res.statusCode, 404);
  const body = res.json() as any;
  assert.equal(body.error, "not_found");

  await app.close();
});

// ---------------------------------------------------------------------------
// Test 5: 200 success — schema_version + report fields present
// ---------------------------------------------------------------------------
test("GET /api/v1/deals/:deal_id/orchestrator-report returns 200 with valid report", async () => {
  const dealId = "00000000-0000-0000-0000-000000000073";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      if (sql.includes("FROM investor_insight_reports")) {
        return {
          rows: [
            {
              status: "deterministic_only",
              render_package: makeRenderPackage(),
              upstream_fingerprint: "test-fingerprint-abc",
            },
          ],
        };
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
    url: `/api/v1/deals/${dealId}/orchestrator-report`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  // Top-level shape
  assert.equal(body.schema_version, "ddai_orchestrator_report_v1");
  assert.ok(body.report, "report field must be present");

  // Report structure
  const report = body.report;
  assert.equal(report.schema_version, "ddai_orchestrator_report_v1");
  assert.equal(report.deal_id, dealId);
  assert.ok(typeof report.created_at === "string", "created_at must be a string");
  assert.ok(typeof report.scores.overall_recommendation_score === "number", "ORS must be a number");
  assert.ok(typeof report.scores.risk_severity_score === "number", "URSS must be a number");
  assert.ok(["GO", "CONSIDER", "NO_GO"].includes(report.decision.label), "decision.label must be valid");
  assert.ok(["Seed", "SeriesA", "Growth", "Unknown"].includes(report.stage_context.stage), "stage must be valid");
  assert.ok(Array.isArray(report.decision.rationale_bullets), "rationale_bullets must be an array");
  assert.ok(typeof report.document_confidence.score === "number", "DCI score must be a number");
  assert.equal(report.input_fingerprint, "test-fingerprint-abc");

  await app.close();
});

// ---------------------------------------------------------------------------
// Test 6: Deterministic — same input produces same ORS
// ---------------------------------------------------------------------------
test("GET /api/v1/deals/:deal_id/orchestrator-report is deterministic for identical inputs", async () => {
  const dealId = "00000000-0000-0000-0000-000000000074";
  const fingerprint = "deterministic-fp-001";

  const rp = makeRenderPackage({ upstream_fingerprint: fingerprint });

  const makePool = () => ({
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      if (sql.includes("FROM investor_insight_reports")) {
        return { rows: [{ status: "deterministic_only", render_package: rp, upstream_fingerprint: fingerprint }] };
      }
      throw new Error(`Unexpected: ${sql}`);
    },
  } as any);

  const app1 = Fastify();
  await registerDealRoutes(app1, makePool(), {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
  });
  const res1 = await app1.inject({ method: "GET", url: `/api/v1/deals/${dealId}/orchestrator-report` });
  await app1.close();

  const app2 = Fastify();
  await registerDealRoutes(app2, makePool(), {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
  });
  const res2 = await app2.inject({ method: "GET", url: `/api/v1/deals/${dealId}/orchestrator-report` });
  await app2.close();

  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);

  const r1 = (res1.json() as any).report;
  const r2 = (res2.json() as any).report;

  // All deterministic fields must match
  assert.equal(r1.scores.overall_recommendation_score, r2.scores.overall_recommendation_score);
  assert.equal(r1.scores.risk_severity_score, r2.scores.risk_severity_score);
  assert.equal(r1.decision.label, r2.decision.label);
  assert.equal(r1.stage_context.stage, r2.stage_context.stage);
  assert.equal(r1.document_confidence.score, r2.document_confidence.score);
  assert.equal(r1.input_fingerprint, r2.input_fingerprint);
});
