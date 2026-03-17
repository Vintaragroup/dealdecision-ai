/**
 * Regression tests for status_summary.report_status mapping.
 *
 * Covers the STATUS_SUMMARY_V2 feature flag that exposes `deterministic_only`
 * as a distinct report_status value instead of collapsing it into `succeeded`.
 *
 * Related fix: apps/api/src/routes/deals.ts mapReportRowStatus()
 * Related blueprint: docs/Active/system-audits/2026-03-03-refactor-blueprint-pass3.md Phase 1
 */

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

after(async () => {
  await closeQueues();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEAL_ID = "00000000-0000-0000-0000-000000009001";
const UPDATED_AT = "2026-03-04T10:00:00.000Z";

/**
 * Build a minimal mock pool for the GET /investor-insights handler.
 *
 * The handler runs three SQL queries:
 *  1. SELECT to_regclass($1)           — hasTable check
 *  2. SELECT ... FROM investor_insight_reports  — main row fetch
 *  3. SELECT ... FROM investor_insight_reports  — buildStatusSummary (parallel)
 *  4. SELECT ... FROM jobs             — buildStatusSummary (parallel)
 */
function buildMockPool(reportStatus: string) {
  const reportRow = {
    status: reportStatus,
    engine_version: "v1",
    upstream_fingerprint: "fp-test-001",
    gate_state: { all_passed: true, results: [] },
    compliance_state: { status: "not_run", events: [] },
    render_package: { sections: [], evidence_gate: null },
    updated_at: UPDATED_AT,
  };

  return {
    query: async (sql: string) => {
      // hasTable: SELECT to_regclass($1)
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "investor_insight_reports" }] };
      }
      // investor_insight_reports — both the main fetch and buildStatusSummary use this
      if (sql.includes("FROM investor_insight_reports") && sql.includes("ORDER BY updated_at DESC")) {
        return { rows: [reportRow] };
      }
      // buildStatusSummary jobs query
      if (sql.includes("FROM jobs") && sql.includes("type = 'analyze_deal'")) {
        return { rows: [{ status: "succeeded", updated_at: UPDATED_AT }] };
      }
      throw new Error(`Unexpected query in mock pool: ${sql.slice(0, 120)}`);
    },
  } as any;
}

// ─── Scenario 1 ─────────────────────────────────────────────────────────────
// STATUS_SUMMARY_V2=true, DB status = deterministic_only
// Expected: status_summary.report_status === 'deterministic_only'

test("status_summary.report_status is 'deterministic_only' when STATUS_SUMMARY_V2 is set", async () => {
  const originalFlag = process.env.STATUS_SUMMARY_V2;
  process.env.STATUS_SUMMARY_V2 = "true";

  try {
    const app = Fastify();
    await registerDealRoutes(app, buildMockPool("deterministic_only"), {
      enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
    });

    assert.equal(res.statusCode, 200, "expected HTTP 200");
    const body = res.json() as any;

    // Raw DB row status passes through on the top-level field
    assert.equal(body.status, "deterministic_only", "top-level status should reflect DB row");

    // status_summary.report_status should expose deterministic_only when flag is on
    assert.ok(body.status_summary, "status_summary should be present");
    assert.equal(
      body.status_summary.report_status,
      "deterministic_only",
      "report_status should be deterministic_only with STATUS_SUMMARY_V2=true"
    );
    assert.equal(body.status_summary.analysis_status, "succeeded");
    assert.equal(body.status_summary.has_existing_render_package, true);
    // blocking_reason must be null when render_package exists
    assert.equal(body.status_summary.blocking_reason, null);

    await app.close();
  } finally {
    // Always restore original value, even if test throws
    if (originalFlag === undefined) {
      delete process.env.STATUS_SUMMARY_V2;
    } else {
      process.env.STATUS_SUMMARY_V2 = originalFlag;
    }
  }
});

// ─── Scenario 2 ─────────────────────────────────────────────────────────────
// STATUS_SUMMARY_V2 not set (legacy V1 mode), DB status = deterministic_only
// Expected: status_summary.report_status === 'succeeded'  (backwards compat)

test("status_summary.report_status is 'succeeded' when STATUS_SUMMARY_V2 is NOT set (legacy mode)", async () => {
  const originalFlag = process.env.STATUS_SUMMARY_V2;
  delete process.env.STATUS_SUMMARY_V2;

  try {
    const app = Fastify();
    await registerDealRoutes(app, buildMockPool("deterministic_only"), {
      enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
    });

    assert.equal(res.statusCode, 200, "expected HTTP 200");
    const body = res.json() as any;

    // Top-level status still reflects raw DB row
    assert.equal(body.status, "deterministic_only", "top-level status should reflect DB row");

    // Without the flag, deterministic_only collapses to succeeded (V1 behaviour)
    assert.ok(body.status_summary, "status_summary should be present");
    assert.equal(
      body.status_summary.report_status,
      "succeeded",
      "report_status should collapse to succeeded without STATUS_SUMMARY_V2"
    );

    await app.close();
  } finally {
    if (originalFlag === undefined) {
      delete process.env.STATUS_SUMMARY_V2;
    } else {
      process.env.STATUS_SUMMARY_V2 = originalFlag;
    }
  }
});

// ─── Scenario 3 ─────────────────────────────────────────────────────────────
// STATUS_SUMMARY_V2=true, DB status = succeeded (normal full report)
// Expected: status_summary.report_status === 'succeeded'

test("status_summary.report_status is 'succeeded' for a normal full report regardless of flag", async () => {
  const originalFlag = process.env.STATUS_SUMMARY_V2;
  process.env.STATUS_SUMMARY_V2 = "true";

  try {
    const app = Fastify();
    await registerDealRoutes(app, buildMockPool("succeeded"), {
      enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
    });

    assert.equal(res.statusCode, 200, "expected HTTP 200");
    const body = res.json() as any;

    assert.equal(body.status, "succeeded", "top-level status should be succeeded");
    assert.ok(body.status_summary, "status_summary should be present");
    assert.equal(
      body.status_summary.report_status,
      "succeeded",
      "full report should always show succeeded"
    );
    assert.equal(body.status_summary.analysis_status, "succeeded");

    await app.close();
  } finally {
    if (originalFlag === undefined) {
      delete process.env.STATUS_SUMMARY_V2;
    } else {
      process.env.STATUS_SUMMARY_V2 = originalFlag;
    }
  }
});

// ─── Scenario 4 ─────────────────────────────────────────────────────────────
// STATUS_SUMMARY_V2=true, DB status = ready
// Expected: status_summary.report_status === 'ready'

test("status_summary.report_status is 'ready' when STATUS_SUMMARY_V2 is set and DB status is ready", async () => {
  const originalFlag = process.env.STATUS_SUMMARY_V2;
  process.env.STATUS_SUMMARY_V2 = "true";

  try {
    const app = Fastify();
    await registerDealRoutes(app, buildMockPool("ready"), {
      enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${DEAL_ID}/investor-insights`,
    });

    assert.equal(res.statusCode, 200, "expected HTTP 200");
    const body = res.json() as any;

    assert.ok(body.status_summary, "status_summary should be present");
    assert.equal(
      body.status_summary.report_status,
      "ready",
      "ready should be a distinct status when STATUS_SUMMARY_V2=true"
    );

    await app.close();
  } finally {
    if (originalFlag === undefined) {
      delete process.env.STATUS_SUMMARY_V2;
    } else {
      process.env.STATUS_SUMMARY_V2 = originalFlag;
    }
  }
});
