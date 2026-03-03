// P2: GET /api/v1/deals/:deal_id/investor-insights status_summary contract.
// Verifies the normalised status_summary is present in all response branches
// so the UI never has to infer job state from raw table values.

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

after(async () => {
  await closeQueues();
});

const DEAL_ID = "00000000-0000-0000-0000-000000000042";

// Helper: build a mock pool that routes the four expected SQL calls.
function buildMockPool(opts: {
  analyzeJob: { status: string; updated_at: string } | null;
  reportRow: {
    status: string;
    engine_version?: string;
    upstream_fingerprint?: string;
    gate_state?: unknown;
    compliance_state?: unknown;
    render_package: unknown;
    updated_at: string;
  } | null;
}) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      // hasTable check
      if (sql.includes("to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }

      // buildStatusSummary: analyze_deal job lookup
      if (sql.includes("type = 'analyze_deal'")) {
        return { rows: opts.analyzeJob ? [opts.analyzeJob] : [] };
      }

      // buildStatusSummary: investor_insight_reports lookup
      // AND the main route SELECT (both target the same table / shape)
      if (sql.includes("investor_insight_reports") && sql.includes("WHERE deal_id")) {
        // buildStatusSummary asks for status, render_package, updated_at only.
        // Main route asks for more columns. Track by column list presence.
        if (sql.includes("engine_version")) {
          // Main route query
          return { rows: opts.reportRow ? [opts.reportRow] : [] };
        }
        // buildStatusSummary query
        return { rows: opts.reportRow ? [opts.reportRow] : [] };
      }

      // Fallback — let unexpected queries pass so the pool doesn't throw on  
      // other deal-route initialisation queries (e.g. feature-flag checks).
      return { rows: [] };
    },
  } as any;
}

// ─── Scenario 1: analysis succeeded AND report has render_package ──────────
test("GET investor-insights: has_existing_render_package=true → blocking_reason is null", async () => {
  const pool = buildMockPool({
    analyzeJob: { status: "succeeded", updated_at: "2025-01-01T00:00:00Z" },
    reportRow: {
      status: "ready",
      engine_version: "v1",
      upstream_fingerprint: "fp1",
      gate_state: null,
      compliance_state: null,
      render_package: { sections: [] },
      updated_at: "2025-01-02T00:00:00Z",
    },
  });

  const app = Fastify();
  await registerDealRoutes(app, pool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  const ss = body.status_summary;

  assert.ok(ss, "status_summary must be present");
  assert.equal(ss.analysis_status, "succeeded");
  assert.equal(ss.report_status, "succeeded");
  assert.equal(ss.has_existing_render_package, true);
  assert.equal(ss.blocking_reason, null,
    "blocking_reason must be null when render_package exists");
});

// ─── Scenario 2: analysis succeeded, no report row yet ────────────────────
test("GET investor-insights: analyze succeeded, no report row → not_started report + no blocking", async () => {
  const pool = buildMockPool({
    analyzeJob: { status: "succeeded", updated_at: "2025-01-01T00:00:00Z" },
    reportRow: null,
  });

  const app = Fastify();
  await registerDealRoutes(app, pool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  const ss = body.status_summary;

  assert.ok(ss, "status_summary must be present even when status is not_started");
  assert.equal(ss.analysis_status, "succeeded");
  assert.equal(ss.report_status, "not_started");
  assert.equal(ss.has_existing_render_package, false);
  // Analysis succeeded, so the deal is still processing — no blocking_reason.
  assert.equal(ss.blocking_reason, null);
});

// ─── Scenario 3: analysis failed, no render_package ──────────────────────
test("GET investor-insights: analyze failed, no render_package → blocking_reason=analysis_failed", async () => {
  const pool = buildMockPool({
    analyzeJob: { status: "failed", updated_at: "2025-01-01T00:00:00Z" },
    reportRow: null,
  });

  const app = Fastify();
  await registerDealRoutes(app, pool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  const ss = body.status_summary;

  assert.ok(ss, "status_summary must be present");
  assert.equal(ss.analysis_status, "failed");
  assert.equal(ss.has_existing_render_package, false);
  assert.equal(ss.blocking_reason, "analysis_failed");
});

// ─── Scenario 4: table does not exist → synthetic not_started summary ─────
test("GET investor-insights: table absent → status_summary with all not_started", async () => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ oid: null }] };
      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, pool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  const ss = body.status_summary;

  assert.ok(ss, "status_summary must be present even when table is absent");
  assert.equal(ss.analysis_status, "not_started");
  assert.equal(ss.report_status, "not_started");
  assert.equal(ss.has_existing_render_package, false);
  assert.equal(ss.blocking_reason, null);
});
