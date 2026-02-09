process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("POST /api/v1/deals/:deal_id/analyze returns 202 preparing_documents when visual page_count is unknown", async () => {
  const dealId = "00000000-0000-0000-0000-000000000020";

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
              extraction_metadata: null,
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

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, { enqueueJob });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/analyze`,
    payload: { require_page_understanding: true, page_understanding_version: "page_understanding_v1" },
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.status, "preparing_documents");
  assert.equal(body.error, "page_understanding_not_ready");
  assert.equal(body.blocked_reason, "PAGE_COUNT_UNKNOWN");

  // Should schedule rendering prerequisites; should not schedule analysis yet.
  assert.ok(enqueuedTypes.includes("render_document_pages"), `expected render_document_pages to be enqueued; got ${JSON.stringify(enqueuedTypes)}`);
  assert.ok(!enqueuedTypes.includes("analyze_deal"), `did not expect analyze_deal to be enqueued; got ${JSON.stringify(enqueuedTypes)}`);

  await app.close();
});
