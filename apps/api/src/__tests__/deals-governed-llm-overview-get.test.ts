process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/governed-llm-overview returns null when table missing", async () => {
  const dealId = "00000000-0000-0000-0000-000000000040";

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: null }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, { enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }) });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/governed-llm-overview`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.overview, null);

  await app.close();
});

test("GET /api/v1/deals/:deal_id/governed-llm-overview returns latest overview", async () => {
  const dealId = "00000000-0000-0000-0000-000000000041";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "governed_llm_overviews" }] };
      }

      if (sql.includes("SELECT id FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]) }] };
      }

      if (sql.includes("FROM governed_llm_overviews") && sql.includes("ORDER BY created_at DESC")) {
        return {
          rows: [
            {
              id: "ov-1",
              deal_id: dealId,
              schema_version: "governed_llm_overview_v1",
              llm_phase_mode: "governed",
              input_hash: "hash-1",
              run_id: "run-1",
              step_run_id: null,
              summary_text: "Deal: TestCo.",
              claims: [
                {
                  claim_type: "kpi",
                  label: "ARR",
                  value_number: 123,
                  unit: "USD",
                  confidence: 0.8,
                  evidence_refs: [{ document_id: "doc-1", page_index: 0 }],
                },
              ],
              disclosures: [],
              created_at: new Date().toISOString(),
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, { enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }) });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/governed-llm-overview`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body?.overview?.deal_id, dealId);
  assert.equal(body?.overview?.schema_version, "governed_llm_overview_v1");
  assert.equal(body?.overview?.input_hash, "hash-1");
  assert.ok(Array.isArray(body?.overview?.claims));

  await app.close();
});
