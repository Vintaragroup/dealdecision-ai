process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerExportPdfRoutes } from "../routes/export-pdf";
import { closeQueues } from "../lib/queue";

const DEAL_UUID = "00000000-0000-0000-0000-000000000099";
const EXPORT_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test.after(async () => {
  await closeQueues();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDeps(overrides: {
  dealRows?: { id: string }[];
  exportRows?: Record<string, unknown>[];
  queueAdd?: (...args: any[]) => Promise<any>;
} = {}) {
  const pool = {
    query: async (sql: string, params?: any[]) => {
      const s = sql.trim().toLowerCase();
      if (s.startsWith("select id from deals")) {
        return { rows: overrides.dealRows ?? [{ id: DEAL_UUID }] };
      }
      if (s.startsWith("insert into deal_report_exports")) {
        return { rows: [] };
      }
      if (s.startsWith("select") && s.includes("deal_report_exports")) {
        return { rows: overrides.exportRows ?? [] };
      }
      return { rows: [] };
    },
  } as any;

  const exportReportPdfQueue = {
    add: overrides.queueAdd ?? (async () => ({ id: "bullmq-job-1" })),
  };

  return { pool, exportReportPdfQueue };
}

const validConfig = {
  preset: "investor",
  format: "standard",
  sections: ["executive_summary", "financial_analysis"],
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/deals/:deal_id/report/export-pdf
// ─────────────────────────────────────────────────────────────────────────────

test("POST export-pdf returns 400 for non-UUID deal_id", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps();
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/report/export-pdf",
    payload: { config: validConfig },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_deal_id");

  await app.close();
});

test("POST export-pdf returns 400 when config is missing sections", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps();
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf`,
    payload: { config: { preset: "investor", format: "standard", sections: [] } },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_config");

  await app.close();
});

test("POST export-pdf returns 400 when config is absent", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps();
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf`,
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_config");

  await app.close();
});

test("POST export-pdf returns 404 when deal does not exist", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps({ dealRows: [] });
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf`,
    payload: { config: validConfig },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "deal_not_found");

  await app.close();
});

test("POST export-pdf returns 202 with ok+export_id when successful", async () => {
  let enqueuedName: string | undefined;
  let enqueuedData: any;

  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps({
    queueAdd: async (name: string, data: any) => {
      enqueuedName = name;
      enqueuedData = data;
      return { id: "bullmq-42" };
    },
  });
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf`,
    payload: { config: validConfig },
  });

  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.ok, true);
  assert.equal(typeof body.export_id, "string");
  assert.equal(typeof body.job_id, "string");
  assert.equal(body.status, "pending");

  // Verify the job was enqueued with the correct structure
  assert.equal(enqueuedName, "export_report_pdf");
  assert.equal(enqueuedData.deal_id, DEAL_UUID);
  assert.equal(typeof enqueuedData.export_id, "string");
  assert.deepEqual(enqueuedData.config, validConfig);

  await app.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/deals/:deal_id/report/export-pdf/:export_id
// ─────────────────────────────────────────────────────────────────────────────

test("GET export-pdf status returns 404 for unknown export_id", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps({ exportRows: [] });
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf/${EXPORT_UUID}`,
  });

  assert.equal(res.statusCode, 404);

  await app.close();
});

test("GET export-pdf status returns pending status row", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps({
    exportRows: [
      {
        id: EXPORT_UUID,
        deal_id: DEAL_UUID,
        status: "pending",
        r2_key: null,
        download_url: null,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf/${EXPORT_UUID}`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.status, "pending");

  await app.close();
});

test("GET export-pdf status returns completed with download_url", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps({
    exportRows: [
      {
        id: EXPORT_UUID,
        deal_id: DEAL_UUID,
        status: "completed",
        r2_key: "deals/xxx/exports/123.pdf",
        download_url: "https://cdn.example.com/deals/xxx/exports/123.pdf",
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf/${EXPORT_UUID}`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.status, "completed");
  assert.equal(typeof body.download_url, "string");
  assert.ok(body.download_url.length > 0);

  await app.close();
});

test("GET export-pdf status returns failed with error_message", async () => {
  const app = Fastify();
  const { pool, exportReportPdfQueue } = makeDeps({
    exportRows: [
      {
        id: EXPORT_UUID,
        deal_id: DEAL_UUID,
        status: "failed",
        r2_key: null,
        download_url: null,
        error_message: "Playwright not installed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  await registerExportPdfRoutes(app, pool, { exportReportPdfQueue });

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${DEAL_UUID}/report/export-pdf/${EXPORT_UUID}`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.status, "failed");
  assert.equal(body.error_message, "Playwright not installed");

  await app.close();
});
