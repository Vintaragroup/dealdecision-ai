process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";

test("POST /api/v1/deals defaults llm_phase_mode=exploratory", async () => {
  const dealId = "00000000-0000-0000-0000-000000000101";

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT id, name FROM deals WHERE deleted_at IS NULL")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO deals") && sql.includes("llm_phase_mode") && sql.includes("RETURNING")) {
        return {
          rows: [
            {
              id: dealId,
              name: String((params as any[])[0] ?? "Test Deal"),
              stage: String((params as any[])[1] ?? "intake"),
              priority: String((params as any[])[2] ?? "medium"),
              llm_phase_mode: "exploratory",
              trend: null,
              score: null,
              owner: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" }),
    jobs: { queue: { add: async () => ({ ok: true }) } },
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals",
    payload: {
      name: "Test Deal",
      stage: "intake",
      priority: "medium",
    },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.llm_phase_mode, "exploratory");

  await app.close();
});

test("PATCH /api/v1/deals/:deal_id/llm-phase updates llm_phase_mode", async () => {
  const dealId = "00000000-0000-0000-0000-000000000201";

  const queries: string[] = [];
  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      if (sql.includes("UPDATE deals") && sql.includes("SET llm_phase_mode")) {
        return {
          rows: [
            {
              id: dealId,
              name: "Deal",
              stage: "intake",
              priority: "medium",
              llm_phase_mode: String((params as any[])[1] ?? "governed"),
              trend: null,
              score: null,
              owner: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "PATCH",
    url: `/api/v1/deals/${dealId}/llm-phase`,
    payload: { llm_phase_mode: "governed" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.id, dealId);
  assert.equal(body.llm_phase_mode, "governed");

  await app.close();
  assert.ok(queries.some((q) => q.includes("UPDATE deals")));
});

test("PATCH /api/v1/deals/:deal_id/llm-phase rejects invalid llm_phase_mode", async () => {
  const dealId = "00000000-0000-0000-0000-000000000301";

  const queries: string[] = [];
  const mockPool = {
    query: async (sql: string) => {
      queries.push(sql);
      throw new Error("should_not_query");
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "PATCH",
    url: `/api/v1/deals/${dealId}/llm-phase`,
    payload: { llm_phase_mode: "nope" },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(queries.length, 0);

  await app.close();
});
