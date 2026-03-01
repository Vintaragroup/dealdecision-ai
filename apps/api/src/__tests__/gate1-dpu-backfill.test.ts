/**
 * Gate 1 DPU Backfill — regression tests for the regenerate endpoint.
 *
 * When a user clicks "Regenerate Report" and DPU is missing, stale, or only
 * partially covered, the endpoint must:
 *   1. Call ensureDocumentsReadyForAnalysis (which auto-enqueues DPU backfill).
 *   2. Return 202 { status: "preparing_documents", blocked_reason, action, ... }.
 *   3. NOT enqueue investor-insights yet (that job waits for DPU to complete).
 *
 * When DPU is complete the endpoint falls through to the normal enqueue path.
 *
 * Fail-open: if the database is unavailable the preflight throws and the
 * endpoint proceeds normally rather than surfacing a 5xx.
 *
 * Also covers POST /api/v1/analysis/start Gate 1 parity (same preflight
 * behaviour on the legacy analysis pipeline entrypoint).
 */

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerDealRoutes } from "../routes/deals";
import { registerAnalysisRoutes } from "../routes/analysis";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

// ─── Constants ----------------------------------------------------------------

const DEAL_ID = "00000000-0000-0000-0000-000000000099";
const DOC_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PAGE_COUNT = 18;

// ─── Pool mock helpers --------------------------------------------------------

/** Returns 0 DPU rows for a PDF doc with 18 pages → triggers missing_dpu */
function buildMissingDpuPool() {
  return {
    query: async (sql: string) => {
      // hasColumn probes
      if (sql.includes("information_schema.columns")) return { rows: [{ ok: 1 }] };
      // document_page_understanding table existence
      if (sql.includes("to_regclass")) return { rows: [{ oid: "document_page_understanding" }] };
      // Documents query (extraction_metadata + full_text)
      if (sql.includes("d.extraction_metadata") && sql.includes("d.full_text")) {
        return {
          rows: [
            {
              id: DOC_ID,
              title: "Pitch Deck",
              status: "ready_for_analysis",
              page_count: PAGE_COUNT,
              extraction_metadata: {
                rendered_pages_r2: { prefix: "r2://bucket/doc" },
                rendered_pages_count: PAGE_COUNT,
                rendered_pages_rendered: PAGE_COUNT,
              },
              full_text: null,
              full_text_absent_reason: null,
              file_name: "deck.pdf",
              mime_type: "application/pdf",
            },
          ],
        };
      }
      // DPU readiness: 0 rows → all pages missing
      if (sql.includes("WITH docs AS") && sql.includes("document_page_understanding")) {
        return {
          rows: [
            {
              document_id: DOC_ID,
              title: "Pitch Deck",
              page_count: PAGE_COUNT,
              dpu_rows: 0,
              dpu_rows_meaningful: 0,
              non_meaningful_pages: [],
              missing_pages: Array.from({ length: PAGE_COUNT }, (_, i) => i),
              hard_missing_pages: Array.from({ length: PAGE_COUNT }, (_, i) => i),
            },
          ],
        };
      }
      // DPU freshness query (not armed — no minDpuCreatedAt)
      if (sql.includes("MAX(GREATEST") && sql.includes("latest_dpu_created_at")) {
        return { rows: [{ latest_dpu_created_at: null }] };
      }
      // Self-heal recent-jobs guard
      if (sql.includes("FROM jobs") && sql.includes("populate_document_page_understanding")) {
        return { rows: [] };
      }
      // Render-page count query
      if (sql.includes("FROM documents d") && sql.includes("COALESCE(d.page_count")) {
        return {
          rows: [{ id: DOC_ID, page_count: PAGE_COUNT, file_name: "deck.pdf", mime_type: "application/pdf" }],
        };
      }
      return { rows: [] };
    },
  } as any;
}

/** Returns 10 / 18 DPU rows with hard-missing [10..17] → triggers dpu_partial */
function buildPartialDpuPool() {
  const DPU_ROWS = 10;
  const missing = Array.from({ length: PAGE_COUNT - DPU_ROWS }, (_, i) => i + DPU_ROWS);

  return {
    query: async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ ok: 1 }] };
      if (sql.includes("to_regclass")) return { rows: [{ oid: "document_page_understanding" }] };
      if (sql.includes("d.extraction_metadata") && sql.includes("d.full_text")) {
        return {
          rows: [
            {
              id: DOC_ID,
              title: "Pitch Deck",
              status: "ready_for_analysis",
              page_count: PAGE_COUNT,
              extraction_metadata: {
                rendered_pages_r2: { prefix: "r2://bucket/doc" },
                rendered_pages_count: PAGE_COUNT,
                rendered_pages_rendered: PAGE_COUNT,
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
        return {
          rows: [
            {
              document_id: DOC_ID,
              title: "Pitch Deck",
              page_count: PAGE_COUNT,
              dpu_rows: DPU_ROWS,
              dpu_rows_meaningful: DPU_ROWS,
              non_meaningful_pages: [],
              missing_pages: missing,
              hard_missing_pages: missing,
            },
          ],
        };
      }
      if (sql.includes("MAX(GREATEST") && sql.includes("latest_dpu_created_at")) {
        return { rows: [{ latest_dpu_created_at: null }] };
      }
      if (sql.includes("FROM jobs") && sql.includes("populate_document_page_understanding")) {
        return { rows: [] };
      }
      if (sql.includes("FROM documents d") && sql.includes("COALESCE(d.page_count")) {
        return {
          rows: [{ id: DOC_ID, page_count: PAGE_COUNT, file_name: "deck.pdf", mime_type: "application/pdf" }],
        };
      }
      return { rows: [] };
    },
  } as any;
}

/** All 18 DPU rows present → no blocking, normal enqueue path */
function buildValidDpuPool() {
  return {
    query: async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ ok: 1 }] };
      if (sql.includes("to_regclass")) return { rows: [{ oid: "document_page_understanding" }] };
      if (sql.includes("d.extraction_metadata") && sql.includes("d.full_text")) {
        return {
          rows: [
            {
              id: DOC_ID,
              title: "Pitch Deck",
              status: "ready_for_analysis",
              page_count: PAGE_COUNT,
              extraction_metadata: {
                rendered_pages_r2: { prefix: "r2://bucket/doc" },
                rendered_pages_count: PAGE_COUNT,
                rendered_pages_rendered: PAGE_COUNT,
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
        return {
          rows: [
            {
              document_id: DOC_ID,
              title: "Pitch Deck",
              page_count: PAGE_COUNT,
              dpu_rows: PAGE_COUNT,
              dpu_rows_meaningful: PAGE_COUNT,
              non_meaningful_pages: [],
              missing_pages: [],
              hard_missing_pages: [],
            },
          ],
        };
      }
      if (sql.includes("MAX(GREATEST") && sql.includes("latest_dpu_created_at")) {
        return { rows: [{ latest_dpu_created_at: null }] };
      }
      if (sql.includes("FROM jobs") && sql.includes("populate_document_page_understanding")) {
        return { rows: [] };
      }
      if (sql.includes("FROM documents d") && sql.includes("COALESCE(d.page_count")) {
        return {
          rows: [{ id: DOC_ID, page_count: PAGE_COUNT, file_name: "deck.pdf", mime_type: "application/pdf" }],
        };
      }
      return { rows: [] };
    },
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("Gate1 | missing DPU (0/18 rows) → 202 preparing_documents with blocked_reason=missing_dpu", async () => {
  let insightsAddCalled = false;
  const enqueueCalls: string[] = [];

  const app = Fastify();
  await registerDealRoutes(app, buildMissingDpuPool(), {
    enqueueJob: async (input: any) => {
      enqueueCalls.push(String(input?.type ?? ""));
      return { id: 1, job_id: `job-${enqueueCalls.length}`, status: "queued" as any };
    },
    investorInsightsQueue: {
      add: async () => {
        insightsAddCalled = true;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`,
  });

  assert.equal(res.statusCode, 202, `Expected 202, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as any;

  // Gate 1 meta
  assert.equal(body.status, "preparing_documents", "status must be preparing_documents");
  assert.equal(body.blocked_reason, "missing_dpu", "blocked_reason must be missing_dpu");
  assert.equal(body.action, "enqueue_dpu_backfill", "action must be enqueue_dpu_backfill");
  assert.ok(typeof body.poll_after_ms === "number" && body.poll_after_ms > 0, "poll_after_ms must be positive number");

  // docs_fingerprint: dealId::expPages::dpuRows::missingPages
  assert.ok(typeof body.docs_fingerprint === "string" && body.docs_fingerprint.includes(DEAL_ID), "docs_fingerprint must contain deal_id");

  // Page counts
  assert.equal(body.expected_pages_total, PAGE_COUNT, "expected_pages_total should equal PAGE_COUNT");
  assert.equal(body.dpu_rows_total, 0, "dpu_rows_total must be 0 for missing DPU");
  assert.equal(body.missing_pages_total, PAGE_COUNT, "missing_pages_total should equal PAGE_COUNT");

  // DPU backfill enqueued, investor-insights NOT enqueued
  const dpuJobs = enqueueCalls.filter((t) => t === "populate_document_page_understanding");
  assert.ok(dpuJobs.length > 0, "Should auto-enqueue populate_document_page_understanding");
  assert.equal(insightsAddCalled, false, "investorInsightsQueue.add must NOT be called when DPU missing");

  await app.close();
});

test("Gate1 | partial DPU (10/18 rows, 8 hard-missing) → 202 preparing_documents with blocked_reason=dpu_partial", async () => {
  let insightsAddCalled = false;
  const enqueueCalls: string[] = [];

  const app = Fastify();
  await registerDealRoutes(app, buildPartialDpuPool(), {
    enqueueJob: async (input: any) => {
      enqueueCalls.push(String(input?.type ?? ""));
      return { id: 1, job_id: `job-${enqueueCalls.length}`, status: "queued" as any };
    },
    investorInsightsQueue: {
      add: async () => {
        insightsAddCalled = true;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`,
  });

  assert.equal(res.statusCode, 202, `Expected 202, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as any;

  assert.equal(body.status, "preparing_documents");
  assert.equal(body.blocked_reason, "dpu_partial", "blocked_reason must be dpu_partial for 10/18 coverage");
  assert.equal(body.action, "enqueue_dpu_backfill");

  assert.equal(body.dpu_rows_total, 10, "dpu_rows_total should be 10");
  assert.equal(body.missing_pages_total, 8, "missing_pages_total should be 8");

  const dpuJobs = enqueueCalls.filter((t) => t === "populate_document_page_understanding");
  assert.ok(dpuJobs.length > 0, "Should auto-enqueue populate_document_page_understanding for partial coverage");
  assert.equal(insightsAddCalled, false, "investorInsightsQueue.add must NOT be called when DPU partial");

  await app.close();
});

test("Gate1 | complete DPU (18/18 rows) → normal 202 { ok, enqueued } path", async () => {
  let insightsAddCalled = false;

  const app = Fastify();
  await registerDealRoutes(app, buildValidDpuPool(), {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async () => {
        insightsAddCalled = true;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`,
  });

  assert.equal(res.statusCode, 202, `Expected 202, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as any;

  assert.equal(body.ok, true, "Normal path should return { ok: true }");
  assert.equal(body.enqueued, true, "Normal path should return { enqueued: true }");
  assert.equal(body.status, undefined, "Normal path must NOT have status field");
  assert.equal(insightsAddCalled, true, "investorInsightsQueue.add MUST be called when DPU ready");

  await app.close();
});

test("Gate1 | fail-open: pool throws → proceeds to normal enqueue path (no 5xx)", async () => {
  let insightsAddCalled = false;

  const throwingPool = {
    query: async () => {
      throw new Error("FATAL: connection pool unavailable");
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, throwingPool, {
    enqueueJob: async () => ({ id: 1, job_id: "job-1", status: "queued" as any }),
    investorInsightsQueue: {
      add: async () => {
        insightsAddCalled = true;
        return {};
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`,
  });

  // Must NOT 500 — fail-open means we skip Gates and enqueue normally
  assert.equal(res.statusCode, 202, `Fail-open must return 202, got ${res.statusCode}`);
  const body = res.json() as any;
  assert.equal(body.ok, true, "Fail-open must return { ok: true }");
  assert.equal(insightsAddCalled, true, "Fail-open must still enqueue investor-insights");

  await app.close();
});

test("Gate1 | preparing_documents response includes enqueued shape (object with array)", async () => {
  const app = Fastify();
  await registerDealRoutes(app, buildMissingDpuPool(), {
    enqueueJob: async (input: any) => ({
      id: 1,
      job_id: `job-populate-${input?.document_id ?? "x"}`,
      status: "queued" as any,
    }),
    investorInsightsQueue: {
      add: async () => ({}),
    },
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`,
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.status, "preparing_documents");

  // enqueued shape must be an object (from EnsureDocumentsReadyResult)
  assert.ok(
    body.enqueued !== null && typeof body.enqueued === "object" && !Array.isArray(body.enqueued),
    "enqueued must be an object with per-job-type arrays"
  );
  assert.ok(
    "populate_document_page_understanding" in (body.enqueued as object),
    "enqueued must have populate_document_page_understanding key"
  );

  await app.close();
});

// ─── /analysis/start Gate 1 tests ─────────────────────────────────────────────

/**
 * Universal pool mock for analysis/start tests.
 * Handles: deal lookup, document counts, DPU readiness queries,
 * and planner_states / ledger_manifests initialisation.
 */
function buildAnalysisPool(dpuReady: boolean) {
  const DPU_ROWS = dpuReady ? PAGE_COUNT : 0;
  const missing = dpuReady ? [] : Array.from({ length: PAGE_COUNT }, (_, i) => i);

  return {
    query: async (sql: string) => {
      if (sql.includes("FROM deals WHERE id")) {
        return { rows: [{ id: DEAL_ID, stage: "pre_seed" }] };
      }
      // Document count
      if (sql.includes("SELECT COUNT(*) as count FROM documents WHERE deal_id = $1") && !sql.includes("type IN")) {
        return { rows: [{ count: "1" }] };
      }
      // Deck count
      if (sql.includes("type IN ('pitch_deck', 'other')")) {
        return { rows: [{ count: "1" }] };
      }

      // ── ensureDocumentsReadyForAnalysis pool probes ──
      if (sql.includes("information_schema.columns")) return { rows: [{ ok: 1 }] };
      if (sql.includes("to_regclass")) return { rows: [{ oid: "document_page_understanding" }] };
      if (sql.includes("d.extraction_metadata") && sql.includes("d.full_text")) {
        return {
          rows: [
            {
              id: DOC_ID,
              title: "Pitch Deck",
              status: "ready_for_analysis",
              page_count: PAGE_COUNT,
              extraction_metadata: {
                rendered_pages_r2: { prefix: "r2://bucket/doc" },
                rendered_pages_count: PAGE_COUNT,
                rendered_pages_rendered: PAGE_COUNT,
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
        return {
          rows: [
            {
              document_id: DOC_ID,
              title: "Pitch Deck",
              page_count: PAGE_COUNT,
              dpu_rows: DPU_ROWS,
              dpu_rows_meaningful: DPU_ROWS,
              non_meaningful_pages: [],
              missing_pages: missing,
              hard_missing_pages: missing,
            },
          ],
        };
      }
      if (sql.includes("MAX(GREATEST") && sql.includes("latest_dpu_created_at")) {
        return { rows: [{ latest_dpu_created_at: null }] };
      }
      if (sql.includes("FROM jobs") && sql.includes("populate_document_page_understanding")) {
        return { rows: [] };
      }
      if (sql.includes("FROM documents d") && sql.includes("COALESCE(d.page_count")) {
        return {
          rows: [{ id: DOC_ID, page_count: PAGE_COUNT, file_name: "deck.pdf", mime_type: "application/pdf" }],
        };
      }

      // ── Analysis service pool queries ──
      if (sql.includes("FROM planner_states WHERE deal_id")) return { rows: [] };
      if (sql.includes("INSERT INTO planner_states")) return { rows: [] };
      if (sql.includes("INSERT INTO ledger_manifests")) return { rows: [] };
      if (sql.includes("FROM fact_rows WHERE deal_id")) return { rows: [] };
      if (sql.includes("FROM decision_packs WHERE deal_id")) return { rows: [] };
      if (sql.includes("FROM ledger_manifests WHERE deal_id")) return { rows: [] };

      return { rows: [] };
    },
  } as any;
}

test("Gate1/analysis:start | missing DPU (0/18) → 202 preparing_documents", async () => {
  const enqueueCalls: Array<{ type: string; opts?: any }> = [];

  const app = Fastify();
  await registerAnalysisRoutes(app, buildAnalysisPool(false), async (input: any, opts?: any) => {
    enqueueCalls.push({ type: String(input?.type ?? ""), opts });
    return { id: 1, job_id: `job-${enqueueCalls.length}`, status: "queued" as any };
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/analysis/start",
    payload: { deal_id: DEAL_ID },
  });

  assert.equal(res.statusCode, 202, `Expected 202, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as any;

  assert.equal(body.status, "preparing_documents", "status must be preparing_documents");
  assert.equal(body.blocked_reason, "missing_dpu", "blocked_reason must be missing_dpu");
  assert.equal(body.action, "enqueue_dpu_backfill", "action must be enqueue_dpu_backfill");
  assert.ok(typeof body.poll_after_ms === "number" && body.poll_after_ms > 0, "poll_after_ms must be positive");
  assert.ok(typeof body.docs_fingerprint === "string" && body.docs_fingerprint.includes(DEAL_ID), "docs_fingerprint must contain deal_id");

  // Must enqueue DPU backfill but NOT run_analysis
  const dpuJobs = enqueueCalls.filter((c) => c.type === "populate_document_page_understanding");
  const analysisJobs = enqueueCalls.filter((c) => c.type === "run_analysis");
  assert.ok(dpuJobs.length > 0, "Should enqueue DPU backfill");
  assert.equal(analysisJobs.length, 0, "Must NOT enqueue run_analysis when DPU missing");

  await app.close();
});

test("Gate1/analysis:start | complete DPU (18/18) → 202 queued (normal path)", async () => {
  const enqueueCalls: Array<{ type: string }> = [];

  const app = Fastify();
  await registerAnalysisRoutes(app, buildAnalysisPool(true), async (input: any) => {
    enqueueCalls.push({ type: String(input?.type ?? "") });
    return { id: 1, job_id: "job-analysis-1", status: "queued" as any };
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/analysis/start",
    payload: { deal_id: DEAL_ID },
  });

  assert.equal(res.statusCode, 202, `Expected 202, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as any;

  assert.equal(body.status, "queued", "Normal path must return status=queued");
  assert.equal(body.deal_id, DEAL_ID, "deal_id must be present");
  assert.ok(typeof body.job_id === "string", "job_id must be a string");

  const analysisJobs = enqueueCalls.filter((c) => c.type === "run_analysis");
  assert.equal(analysisJobs.length, 1, "Must enqueue run_analysis when DPU ready");

  const dpuJobs = enqueueCalls.filter((c) => c.type === "populate_document_page_understanding");
  assert.equal(dpuJobs.length, 0, "Must NOT enqueue DPU backfill when DPU already ready");

  await app.close();
});

test("Gate1/analysis:start | DPU enqueue uses deterministic BullMQ jobId keyed on docs_fingerprint", async () => {
  const enqueueCallOpts: any[] = [];

  const app = Fastify();
  await registerAnalysisRoutes(app, buildAnalysisPool(false), async (_input: any, opts?: any) => {
    enqueueCallOpts.push(opts ?? null);
    return { id: 1, job_id: "job-dpu", status: "queued" as any };
  });

  await app.inject({
    method: "POST",
    url: "/api/v1/analysis/start",
    payload: { deal_id: DEAL_ID },
  });

  // All DPU enqueue calls must supply a deterministic BullMQ jobId
  const dpuOpts = enqueueCallOpts.filter((o) => o && typeof o?.jobId === "string");
  assert.ok(dpuOpts.length > 0, "At least one DPU enqueue must supply a jobId option");

  for (const opts of dpuOpts) {
    const jobId: string = opts.jobId;
    assert.ok(jobId.startsWith("dpu:"), `jobId must start with 'dpu:' — got: ${jobId}`);
    assert.ok(jobId.includes(DEAL_ID), `jobId must contain deal_id — got: ${jobId}`);
    assert.ok(jobId.endsWith("page_understanding_v1"), `jobId must end with version suffix — got: ${jobId}`);
  }

  await app.close();
});

test("Gate1/analysis:start | fail-open: pool throws → proceeds to run_analysis (no 5xx)", async () => {
  const enqueueCalls: string[] = [];

  // This pool succeeds for the analysis handler's own queries (deals, document counts,
  // planner/ledger init) but throws for the DPU-specific probe that
  // ensureDocumentsReadyForAnalysis fires first (information_schema.columns).
  // Gate 1 is fail-open so it recovers and the analysis job is still enqueued.
  const failOpenPool = {
    query: async (sql: string) => {
      // DPU probe — throw to simulate gate1 failure
      if (sql.includes("information_schema.columns") || sql.includes("to_regclass")) {
        throw new Error("simulated partial pool failure");
      }
      // Analysis handler queries — return normally
      if (sql.includes("FROM deals WHERE id")) {
        return { rows: [{ id: DEAL_ID, stage: "pre_seed" }] };
      }
      if (sql.includes("SELECT COUNT(*) as count FROM documents") && !sql.includes("type IN")) {
        return { rows: [{ count: "1" }] };
      }
      if (sql.includes("type IN ('pitch_deck', 'other')")) {
        return { rows: [{ count: "1" }] };
      }
      if (sql.includes("FROM planner_states WHERE deal_id")) return { rows: [] };
      if (sql.includes("INSERT INTO planner_states")) return { rows: [] };
      if (sql.includes("INSERT INTO ledger_manifests")) return { rows: [] };
      if (sql.includes("FROM fact_rows WHERE deal_id")) return { rows: [] };
      if (sql.includes("FROM decision_packs WHERE deal_id")) return { rows: [] };
      if (sql.includes("FROM ledger_manifests WHERE deal_id")) return { rows: [] };
      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  await registerAnalysisRoutes(app, failOpenPool, async (input: any) => {
    enqueueCalls.push(String(input?.type ?? ""));
    return { id: 1, job_id: "job-fallback", status: "queued" as any };
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/analysis/start",
    payload: { deal_id: DEAL_ID },
  });

  // Fail-open: Gate 1 threw but analysis proceeds normally → 202 queued
  assert.equal(res.statusCode, 202, `Fail-open must return 202, got ${res.statusCode}: ${res.body}`);
  const body = res.json() as any;
  assert.equal(body.status, "queued", "Fail-open must return status=queued (analysis enqueued)");
  assert.notEqual(body.status, "preparing_documents", "Must NOT be stuck in preparing_documents when gate1 fails-open");

  const analysisJobs = enqueueCalls.filter((t) => t === "run_analysis");
  assert.equal(analysisJobs.length, 1, "run_analysis must be enqueued on fail-open");

  await app.close();
});
