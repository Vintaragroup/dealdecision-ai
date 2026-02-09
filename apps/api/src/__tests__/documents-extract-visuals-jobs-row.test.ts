process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../routes/documents";
import { enqueueJob as realEnqueueJob } from "../services/jobs";

test("POST /api/v1/deals/:deal_id/documents/:document_id/extract-visuals persists non-null document_id and page range", async () => {
  const dealId = "00000000-0000-0000-0000-000000000001";
  const documentId = "00000000-0000-0000-0000-000000000002";

  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let insertedParams: unknown[] | null = null;

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });

      if (sql.includes("SELECT to_regclass")) {
        // hasTable(document_files)
        return { rows: [{ oid: "documents" }] };
      }

      if (sql.includes("information_schema.columns") && sql.includes("table_name") && sql.includes("column_name")) {
        // hasColumn(mime_type)
        return { rows: [{ ok: 1 }] };
      }

      if (sql.includes("FROM documents d") && sql.includes("WHERE d.id = $1") && sql.includes("d.deal_id = $2")) {
        return {
          rows: [
            {
              extraction_metadata: {
                rendered_pages_r2: {
                  bucket: "b",
                  prefix: "deals/d/documents/doc/rendered_pages",
                  format: "page_%04d.png",
                },
                rendered_pages_count: 31,
                rendered_pages_rendered: 31,
              },
              file_name: "deck.pdf",
              mime_type: "application/pdf",
            },
          ],
        };
      }

      if (sql.includes("SELECT id, job_id, status") && sql.includes("FROM jobs") && sql.includes("WHERE document_id = $1")) {
        // Dedupe check: no existing job.
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO jobs") && sql.includes("parent_job_id") && sql.includes("page_start") && sql.includes("page_end")) {
        insertedParams = params;
        const jobId = String((params as any[])[0]);
        return { rows: [{ id: 1, job_id: jobId, status: "queued" }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const mockQueue = {
    add: async () => ({ ok: true }),
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool, {
    enqueueJob: (input: any, opts: any) => realEnqueueJob(input, { ...(opts ?? {}), deps: { pool: mockPool, queue: mockQueue } }),
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/documents/${documentId}/extract-visuals`,
    payload: {},
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.ok, true);
  assert.ok(typeof body.job_id === "string" && body.job_id.length > 0);

  assert.ok(insertedParams, "expected an INSERT INTO jobs call");
  const p = insertedParams as any[];

  // INSERT INTO jobs (... job_id, deal_id, document_id, ... parent_job_id, page_start, page_end)
  assert.equal(p[1], dealId);
  assert.equal(p[2], documentId);

  const pageStart = p[p.length - 2];
  const pageEnd = p[p.length - 1];
  assert.equal(pageStart, 0);
  assert.equal(pageEnd, 31);

  await app.close();

  // Ensure we didn't accidentally short-circuit before hitting DB insert.
  assert.ok(queries.length > 0);
});

test("POST /api/v1/deals/:deal_id/documents/:document_id/extract-visuals rejects invalid UUID params with 400", async () => {
  const queries: string[] = [];
  const mockPool = {
    query: async (sql: string) => {
      queries.push(sql);
      throw new Error("unexpected query");
    },
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool, {
    enqueueJob: async () => {
      throw new Error("should_not_enqueue");
    },
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/documents/not-a-uuid/extract-visuals",
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(queries.length, 0);

  await app.close();
});
