process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/analysis-diagnostics returns null when no snapshot exists", async () => {
  const dealId = "00000000-0000-0000-0000-000000000050";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "deal_analysis_diagnostics" }] };
      }

      if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
        // Optional PR3.1 columns may or may not exist; return empty to indicate absent.
        return { rows: [] };
      }

      if (sql.includes("SELECT id FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]) }] };
      }

      if (sql.includes("FROM deal_analysis_diagnostics") && sql.includes("ORDER BY created_at DESC")) {
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
    url: `/api/v1/deals/${dealId}/analysis-diagnostics`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.diagnostics, null);

  await app.close();
});

test("GET /api/v1/deals/:deal_id/analysis-diagnostics returns latest snapshot", async () => {
  const dealId = "00000000-0000-0000-0000-000000000051";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "deal_analysis_diagnostics" }] };
      }

      if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
        // hasColumn(...) probes for PR3.1 fields
        return { rows: [{ ok: 1 }] };
      }

      if (sql.includes("SELECT id FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]) }] };
      }

      if (sql.includes("FROM deal_analysis_diagnostics") && sql.includes("ORDER BY created_at DESC")) {
        return {
          rows: [
            {
              id: "diag-1",
              deal_id: dealId,
              report_id: "report-1",
              llm_phase_mode: "governed",
              citation_integrity_percent: "98.76",
              numeric_claims_without_evidence: 4,
              semantic_drift_score: "0.5",
              hallucination_count: 2,
              deterministic_coverage_ratio: 0.333333,
              provider_error_count: 1,
              model_output_truncated_count: 2,
              model_output_not_json_count: 3,
              guard_degraded_count: 4,
              created_at: new Date().toISOString(),
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
    url: `/api/v1/deals/${dealId}/analysis-diagnostics`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body?.diagnostics?.deal_id, dealId);
  assert.equal(body?.diagnostics?.report_id, "report-1");
  assert.equal(body?.diagnostics?.llm_phase_mode, "governed");
  assert.equal(body?.diagnostics?.citation_integrity_percent, 98.76);
  assert.equal(body?.diagnostics?.numeric_claims_without_evidence, 4);
  assert.equal(body?.diagnostics?.semantic_drift_score, 0.5);
  assert.equal(body?.diagnostics?.hallucination_count, 2);
  assert.equal(body?.diagnostics?.deterministic_coverage_ratio, 0.333333);
  assert.equal(body?.diagnostics?.provider_error_count, 1);
  assert.equal(body?.diagnostics?.model_output_truncated_count, 2);
  assert.equal(body?.diagnostics?.model_output_not_json_count, 3);
  assert.equal(body?.diagnostics?.guard_degraded_count, 4);
  assert.ok(typeof body?.diagnostics?.created_at === "string");

  await app.close();
});
