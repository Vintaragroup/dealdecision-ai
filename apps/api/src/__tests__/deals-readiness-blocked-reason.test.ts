/**
 * PR7-lite: Truthful blocked_reason tests
 *
 * Verifies the new behavior in GET /api/v1/deals/:deal_id/readiness:
 *
 *   1. READY_TO_ANALYZE_ENQUEUE_PENDING: When no jobs exist AND all docs are
 *      extract_visuals-finalized, return the soft reason instead of INGEST_BLOCKED_NO_JOBS.
 *   2. INGEST_BLOCKED_NO_JOBS: When no jobs exist AND unfinalized (non-XLSX) docs exist,
 *      still return INGEST_BLOCKED_NO_JOBS (no false upgrade).
 *   3. Rule 2 override: When analyze_deal succeeded → blocked_reason = null.
 *   4. Rule 1 override: When render_package exists → blocked_reason = null.
 *   5. INGEST_PENDING_OCR: When docs need OCR and no jobs exist, still returns OCR reason
 *      (OCR check is earlier in the chain and is not affected by finalized check).
 */

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

// ── Shared DPU rows that indicate 3 missing pages ────────────────────────────
const dpuMissingRows = [
  {
    document_id: "doc-1",
    title: "Deck",
    page_count: 3,
    dpu_rows: 0,
    missing_pages: [0, 1, 2],
  },
];

// ── Test 1: All docs finalized → READY_TO_ANALYZE_ENQUEUE_PENDING ─────────────
test("GET /readiness returns READY_TO_ANALYZE_ENQUEUE_PENDING when all docs are finalized but no active jobs", async () => {
  const dealId = "00000000-0000-0000-0000-000000000020";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "document_page_understanding" }] };
      }
      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return { rows: dpuMissingRows };
      }
      // No active ingest/extract/render/DPU jobs
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("type = ANY")
      ) {
        return { rows: [] };
      }
      // OCR check: no docs need OCR
      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [] };
      }
      // Finalized check: all docs finalized (no unfinalized docs found)
      if (sql.includes("extract_visuals_finalized")) {
        return { rows: [] }; // EMPTY → all finalized
      }
      // Rule 2: no succeeded analyze_deal job
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("analyze_deal")
      ) {
        return { rows: [] };
      }
      // Rule 1: no render package
      if (sql.includes("investor_insight_reports")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify({ logger: false });
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  assert.equal(body.missing_pages_total, 3);
  assert.equal(body.blocked_reason, "READY_TO_ANALYZE_ENQUEUE_PENDING");

  await app.close();
});

// ── Test 2: Unfinalized docs present → INGEST_BLOCKED_NO_JOBS (unchanged) ────
test("GET /readiness returns INGEST_BLOCKED_NO_JOBS when unfinalized docs exist and no active jobs", async () => {
  const dealId = "00000000-0000-0000-0000-000000000021";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "document_page_understanding" }] };
      }
      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return { rows: dpuMissingRows };
      }
      // No active jobs
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("type = ANY")
      ) {
        return { rows: [] };
      }
      // OCR check: no docs need OCR
      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [] };
      }
      // Finalized check: one doc is NOT finalized (unfinalized row found)
      if (sql.includes("extract_visuals_finalized")) {
        return { rows: [{ id: "doc-1" }] }; // NON-EMPTY → unfinalized doc exists
      }
      // analyze_deal status (Rule 2 override check — no recent success)
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("analyze_deal")
      ) {
        return { rows: [] };
      }
      // investor_insight_reports (Rule 1 override check — no render package)
      if (sql.includes("investor_insight_reports")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify({ logger: false });
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  assert.equal(body.blocked_reason, "INGEST_BLOCKED_NO_JOBS");

  await app.close();
});

// ── Test 3: Rule 2 — analyze_deal succeeded → blocked_reason = null ───────────
test("GET /readiness returns null blocked_reason when analyze_deal succeeded (Rule 2)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000022";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "document_page_understanding" }] };
      }
      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return { rows: dpuMissingRows };
      }
      // No active ingest/extract/render jobs
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("type = ANY")
      ) {
        return { rows: [] };
      }
      // OCR check: clean
      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [] };
      }
      // Finalized check: unfinalized doc exists (would return INGEST_BLOCKED_NO_JOBS without override)
      if (sql.includes("extract_visuals_finalized")) {
        return { rows: [{ id: "doc-1" }] };
      }
      // Rule 2: analyze_deal succeeded
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("analyze_deal")
      ) {
        return { rows: [{ status: "succeeded" }] };
      }
      // Rule 1: no render package
      if (sql.includes("investor_insight_reports")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify({ logger: false });
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  // blocked_reason overridden to null because analysis succeeded
  assert.equal(body.blocked_reason, null);

  await app.close();
});

// ── Test 4: Rule 1 — render_package exists → blocked_reason = null ────────────
test("GET /readiness returns null blocked_reason when render_package exists (Rule 1)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000023";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "document_page_understanding" }] };
      }
      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return { rows: dpuMissingRows };
      }
      // No active ingest/extract/render jobs
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("type = ANY")
      ) {
        return { rows: [] };
      }
      // OCR check: clean
      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [] };
      }
      // Finalized check: unfinalized doc exists
      if (sql.includes("extract_visuals_finalized")) {
        return { rows: [{ id: "doc-1" }] };
      }
      // Rule 2: no succeeded analyze_deal
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("analyze_deal")
      ) {
        return { rows: [] };
      }
      // Rule 1: render_package IS present
      if (sql.includes("investor_insight_reports")) {
        return { rows: [{ id: "report-1" }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify({ logger: false });
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/readiness?page_understanding_version=page_understanding_v1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, dealId);
  assert.equal(body.ready, false);
  // blocked_reason overridden to null because render package exists
  assert.equal(body.blocked_reason, null);

  await app.close();
});

// ── Test 5: INGEST_PENDING_OCR still works (finalized check is after OCR check) ─
test("GET /readiness still returns INGEST_PENDING_OCR when docs need OCR (unchanged behavior)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000024";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
        return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
      }
      if (sql.includes("SELECT to_regclass")) {
        return { rows: [{ oid: "document_page_understanding" }] };
      }
      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return { rows: dpuMissingRows };
      }
      // No active ingest/extract/render jobs
      if (
        sql.includes("FROM jobs") &&
        sql.includes("WHERE deal_id") &&
        sql.includes("type = ANY")
      ) {
        return { rows: [] };
      }
      // OCR check: returns doc needing OCR → returns INGEST_PENDING_OCR early
      if (sql.includes("FROM documents") && sql.includes("status = 'needs_ocr'")) {
        return { rows: [{ one: 1 }] };
      }
      // Should not reach the finalized check (OCR check returns early)
      if (sql.includes("extract_visuals_finalized")) {
        throw new Error("Finalized check should not be called when INGEST_PENDING_OCR is returned");
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify({ logger: false });
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
