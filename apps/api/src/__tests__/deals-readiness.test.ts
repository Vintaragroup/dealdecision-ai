process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";
import { computePageUnderstandingReadiness } from "../lib/deal-page-understanding-readiness";

test.after(async () => {
  await closeQueues();
});

test("computePageUnderstandingReadiness: page_count=3 with 2 DPU rows => missing [2] and ready=false", async () => {
  const readiness = computePageUnderstandingReadiness({
    dealId: "deal-1",
    version: "page_understanding_v1",
    documents: [
      {
        document_id: "doc-1",
        title: "Deck",
        page_count: 3,
        dpu_rows: 2,
        missing_pages: [2],
      },
    ],
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.expected_pages_total, 3);
  assert.equal(readiness.dpu_rows_total, 2);
  assert.equal(readiness.missing_pages_total, 1);
  assert.deepEqual(readiness.documents[0].missing_pages, [2]);
});

test("GET /api/v1/deals/:deal_id/readiness returns readiness shape", async () => {
  const dealId = "00000000-0000-0000-0000-000000000010";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 3,
              dpu_rows: 2,
              missing_pages: [2],
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
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.version, "page_understanding_v1");
  assert.equal(body.ready, false);
  assert.equal(body.expected_pages_total, 3);
  assert.equal(body.dpu_rows_total, 2);
  assert.equal(body.missing_pages_total, 1);
  assert.ok(Array.isArray(body.documents));
  assert.equal(body.documents.length, 1);
  assert.deepEqual(body.documents[0].missing_pages, [2]);
  assert.equal(body.blocked_reason, null);

  await app.close();
});

test("GET /api/v1/deals/:deal_id/readiness includes blocked_reason when missing pages and no jobs exist", async () => {
  const dealId = "00000000-0000-0000-0000-000000000011";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 3,
              dpu_rows: 0,
              missing_pages: [0, 1, 2],
            },
          ],
        };
      }

      if (sql.includes("FROM jobs") && sql.includes("WHERE deal_id")) {
        // No required jobs exist.
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  assert.equal(body.expected_pages_total, 3);
  assert.equal(body.dpu_rows_total, 0);
  assert.equal(body.missing_pages_total, 3);
  assert.equal(body.blocked_reason, "INGEST_BLOCKED_NO_JOBS");

  await app.close();
});

test("GET /api/v1/deals/:deal_id/readiness returns INGEST_PENDING_OCR when docs need OCR and no jobs exist", async () => {
  const dealId = "00000000-0000-0000-0000-000000000012";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 3,
              dpu_rows: 0,
              missing_pages: [0, 1, 2],
            },
          ],
        };
      }

      if (sql.includes("FROM jobs") && sql.includes("WHERE deal_id")) {
        // No required jobs exist.
        return { rows: [] };
      }

      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [{ one: 1 }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  assert.equal(body.blocked_reason, "INGEST_PENDING_OCR");

  await app.close();
});

test("GET /api/v1/deals/:deal_id/readiness reports placeholder/empty DPU as non-meaningful (and missing-for-completion) but ready=true", async () => {
  const dealId = "00000000-0000-0000-0000-000000000013";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return {
          rows: [
            {
              document_id: "doc-1",
              title: "Deck",
              page_count: 3,
              dpu_rows: 3,
              dpu_rows_meaningful: 0,
              non_meaningful_pages: [0, 1, 2],
              // Missing-for-completion = expected - done.
              missing_pages: [0, 1, 2],
              // Hard missing (no payload row) is empty, so readiness.ready should be true.
              hard_missing_pages: [],
            },
          ],
        };
      }

      if (sql.includes("FROM jobs") && sql.includes("WHERE deal_id")) {
        // No required jobs exist.
        return { rows: [] };
      }

      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, true);
  assert.equal(body.expected_pages_total, 3);
  assert.equal(body.dpu_rows_total, 3);
  assert.equal(body.missing_pages_total, 3);
  assert.equal(body.non_meaningful_pages_total, 3);
  assert.equal(body.blocked_reason, null);

  await app.close();
});

test("GET /api/v1/deals/:deal_id/readiness treats visual docs with page_count=0 as not ready (PAGE_COUNT_UNKNOWN)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000014";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }

      if (sql.includes("SELECT to_regclass")) {
        // document_page_understanding exists
        return { rows: [{ oid: "document_page_understanding" }] };
      }

      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
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

      if (sql.includes("information_schema.columns")) {
        // hasColumn() probes
        return { rows: [{ ok: 1 }] };
      }

      if (sql.includes("FROM documents d") && sql.includes("COALESCE(d.page_count")) {
        // extra gating query in readiness handler
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

      if (sql.includes("FROM jobs") && sql.includes("WHERE deal_id")) {
        // presence check path: no jobs
        return { rows: [] };
      }

      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  assert.equal(body.blocked_reason, "PAGE_COUNT_UNKNOWN");
  assert.ok(Array.isArray(body.render_missing_page_count_documents));
  assert.deepEqual(body.render_missing_page_count_documents, ["doc-1"]);

  await app.close();
});
