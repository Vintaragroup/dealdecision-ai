process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("POST /api/v1/deals/:deal_id/prepare returns 202 preparing_documents and enqueues prereqs", async () => {
  const dealId = "00000000-0000-0000-0000-000000000030";

  const enqueuedTypes: string[] = [];
  const enqueueJob = async (input: any) => {
    enqueuedTypes.push(String(input?.type ?? ""));
    return { id: enqueuedTypes.length, job_id: `job-${enqueuedTypes.length}`, status: "queued" as any };
  };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("information_schema.columns")) {
        // hasColumn probes
        return { rows: [{ ok: 1 }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("FROM documents d") && sql.includes("d.extraction_metadata") && sql.includes("d.full_text")) {
        // ensureDocumentsReadyForAnalysis documents query
        return {
          rows: [
            {
              id: "doc-1",
              title: "Deck",
              status: null,
              page_count: 0,
              extraction_metadata: {
                pdf_text_probe: { decision: "text_sparse_needs_ocr", needsOcr: true },
                needsOcr: true,
              },
              full_text: null,
              full_text_absent_reason: null,
              file_name: "deck.pdf",
              mime_type: "application/pdf",
            },
          ],
        };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        // readiness query sees page_count=0 => no expected pages
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 0,
              dpu_rows: 0,
              dpu_rows_meaningful: 0,
              non_meaningful_pages: [],
              missing_pages: [],
            },
          ],
        };
      }

      // The new readiness blocked_message query checks jobs for last 2 hours.
      if (sql.includes("FROM jobs") && sql.includes("created_at >=")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, { enqueueJob });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/prepare`,
    payload: { page_understanding_version: "page_understanding_v1" },
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.status, "preparing_documents");
  assert.equal(body.blocked_reason, "PAGE_COUNT_UNKNOWN");

  assert.ok(enqueuedTypes.includes("render_document_pages"), `expected render_document_pages to be enqueued; got ${JSON.stringify(enqueuedTypes)}`);
  assert.ok(enqueuedTypes.includes("document_intelligence_extract"), `expected document_intelligence_extract to be enqueued; got ${JSON.stringify(enqueuedTypes)}`);

  await app.close();
});

test("POST /api/v1/deals/:deal_id/prepare treats local rendered pages as render-ready and enqueues DPU", async () => {
  const dealId = "00000000-0000-0000-0000-000000000032";

  const enqueuedTypes: string[] = [];
  const enqueueJob = async (input: any) => {
    enqueuedTypes.push(String(input?.type ?? ""));
    return { id: enqueuedTypes.length, job_id: `job-${enqueuedTypes.length}`, status: "queued" as any };
  };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("information_schema.columns")) {
        // hasColumn probes
        return { rows: [{ ok: 1 }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("FROM documents d") && sql.includes("d.extraction_metadata") && sql.includes("d.full_text")) {
        // ensureDocumentsReadyForAnalysis documents query
        return {
          rows: [
            {
              id: "doc-1",
              title: "Deck",
              status: "ready_for_analysis",
              page_count: 17,
              extraction_metadata: {
                storage_mode: "local",
                rendered_pages_dir: "/app/uploads/rendered_pages/doc-1",
                rendered_pages_count: 17,
                rendered_pages_rendered: 17,
              },
              full_text: "some pdf text",
              full_text_absent_reason: null,
              file_name: "deck.pdf",
              mime_type: "application/pdf",
            },
          ],
        };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        // readiness query sees all pages missing => should enqueue populate_document_page_understanding
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 17,
              dpu_rows: 0,
              dpu_rows_meaningful: 0,
              non_meaningful_pages: [],
              missing_pages: Array.from({ length: 17 }, (_, i) => i),
            },
          ],
        };
      }

      // The readiness blocked_message query checks jobs for last 2 hours.
      if (sql.includes("FROM jobs") && sql.includes("created_at >=")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, { enqueueJob });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/prepare`,
    payload: { page_understanding_version: "page_understanding_v1" },
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.status, "preparing_documents");

  assert.ok(!enqueuedTypes.includes("render_document_pages"), `did not expect render_document_pages; got ${JSON.stringify(enqueuedTypes)}`);
  assert.ok(enqueuedTypes.includes("populate_document_page_understanding"), `expected populate_document_page_understanding; got ${JSON.stringify(enqueuedTypes)}`);
  assert.ok(enqueuedTypes.includes("extract_visuals_deal"), `expected extract_visuals_deal; got ${JSON.stringify(enqueuedTypes)}`);

  await app.close();
});

test("GET /api/v1/deals/:deal_id/readiness includes blocked_message when PAGE_COUNT_UNKNOWN and no prereq jobs exist", async () => {
  const dealId = "00000000-0000-0000-0000-000000000031";

  const enqueueJob = async (_input: any) => {
    throw new Error("should not enqueue in readiness");
  };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("information_schema.columns")) {
        // hasColumn probes
        return { rows: [{ ok: 1 }] };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        // readiness base data
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 0,
              dpu_rows: 0,
              dpu_rows_meaningful: 0,
              non_meaningful_pages: [],
              missing_pages: [],
            },
          ],
        };
      }

      if (sql.includes("FROM documents d") && sql.includes("COALESCE(d.page_count")) {
        // readiness visual docs page_count scan
        return {
          rows: [
            {
              id: "doc-1",
              page_count: 0,
              file_name: "deck.pdf",
              mime_type: "application/pdf",
            },
          ],
        };
      }

      // blocked_message query checks jobs
      if (sql.includes("FROM jobs") && sql.includes("created_at >=")) {
        return { rows: [] };
      }

      // document_page_understanding exists
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, { enqueueJob });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.ready, false);
  assert.equal(body.blocked_reason, "PAGE_COUNT_UNKNOWN");
  assert.ok(typeof body.blocked_message === "string" && body.blocked_message.includes("/prepare"));
  assert.ok(body.blocked_action && body.blocked_action.method === "POST");

  await app.close();
});
