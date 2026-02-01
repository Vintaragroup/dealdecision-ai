process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../routes/documents";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/documents/search validates q", async () => {
  const mockPool = {
    query: async () => {
      throw new Error("Unexpected query");
    },
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/deals/deal-1/documents/search?q=a",
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "q is required (min 2 chars)" });

  await app.close();
});

test("GET /api/v1/deals/:deal_id/documents/search returns ranked results", async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql: String(sql), params });

      if (String(sql).includes("to_tsvector('english', full_text) @@") && String(sql).includes("FROM documents")) {
        return {
          rows: [
            {
              id: "doc-1",
              title: "Pitch Deck",
              type: "application/pdf",
              rank: 0.42,
              excerpt: "hello world",
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/deals/deal-1/documents/search?q=hello&limit=10",
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, "deal-1");
  assert.equal(body.q, "hello");
  assert.equal(Array.isArray(body.results), true);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].document_id, "doc-1");
  assert.equal(body.results[0].title, "Pitch Deck");

  assert.ok(queries.length === 1, `expected 1 query, got ${queries.length}`);
  assert.equal((queries[0].params ?? [])[0], "deal-1");
  assert.equal((queries[0].params ?? [])[1], "hello");

  await app.close();
});
