import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("POST /api/v1/deals accepts trend=flat but returns stable", async () => {
  let insertedTrend: unknown = null;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT id, name FROM deals WHERE deleted_at IS NULL")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO deals") && sql.includes("RETURNING *")) {
        insertedTrend = (params ?? [])[3];
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000099",
              name: (params ?? [])[0],
              stage: (params ?? [])[1],
              priority: (params ?? [])[2],
              trend: (params ?? [])[3],
              owner: (params ?? [])[5],
              score: (params ?? [])[4],
              updated_at: new Date("2026-02-11T00:00:00.000Z"),
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
    method: "POST",
    url: "/api/v1/deals",
    payload: { name: "Test Deal", trend: "flat" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(insertedTrend, "stable");
  assert.equal(body.trend, "stable");

  await app.close();
});

test("POST /api/v1/deals accepts trend=stable", async () => {
  let insertedTrend: unknown = null;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT id, name FROM deals WHERE deleted_at IS NULL")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO deals") && sql.includes("RETURNING *")) {
        insertedTrend = (params ?? [])[3];
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000100",
              name: (params ?? [])[0],
              stage: (params ?? [])[1],
              priority: (params ?? [])[2],
              trend: (params ?? [])[3],
              owner: (params ?? [])[5],
              score: (params ?? [])[4],
              updated_at: new Date("2026-02-11T00:00:00.000Z"),
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
    method: "POST",
    url: "/api/v1/deals",
    payload: { name: "Test Deal", trend: "stable" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(insertedTrend, "stable");
  assert.equal(body.trend, "stable");

  await app.close();
});
