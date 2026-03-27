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
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);

      if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
        const col = String((params ?? [])[1] ?? '');
        if (col === 'created_by_user_id') {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'deal-1',
              created_by_user_id: null,
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

      if (String(sql).includes('information_schema.columns') && String(sql).includes('column_name = $2')) {
        const col = String((params ?? [])[1] ?? '');
        if (col === 'created_by_user_id') {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (String(sql).includes('FROM deals') && String(sql).includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'deal-1',
              created_by_user_id: null,
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

  const docsQuery = queries.find((q) => q.sql.includes("to_tsvector('english', full_text) @@") && q.sql.includes('FROM documents'));
  assert.ok(docsQuery, 'expected ranked documents query to run');
  assert.equal((docsQuery?.params ?? [])[0], "deal-1");
  assert.equal((docsQuery?.params ?? [])[1], "hello");

  await app.close();
});
