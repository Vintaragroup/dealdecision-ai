process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDashboardRoutes } from "../routes/dashboard";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/dashboard/deals/:deal_id/deterministic returns header_canonical from structured_summary when report.ready=true", async () => {
  const dealId = "00000000-0000-0000-0000-00000000d111";

  const reportPayload = {
    ready: true,
    version: 1,
    artifact: {
      kind: "deal_intelligence_object",
      dio_id: "dio-1",
      analysis_version: 7,
      updated_at: "2026-02-04T00:00:00.000Z",
    },
    structured_summary: {
      raise: {
        value: "$10M",
        label: "Raise",
        sources: [{ document_id: "doc-1", page_range: [1, 1] }],
      },
      business_model: {
        value: "SaaS",
        label: "Business model",
        sources: [{ document_id: "doc-1", page_range: [2, 2] }],
      },
      revenue: {
        value: { raw: "$1M ARR" },
        label: "Revenue",
        sources: [{ document_id: "doc-2", page_range: [3, 3] }],
      },
      customers: {
        value: { raw: "100 customers" },
        label: "Customers",
        sources: [{ document_id: "doc-2", page_range: [4, 4] }],
      },
      growth: {
        value: { raw: "20% MoM" },
        label: "Growth",
        sources: [{ document_id: "doc-2", page_range: [5, 5] }],
      },
    },
  };

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      // Deterministic endpoint loads a single deal row + latest DIO (LATERAL join).
      if (sql.includes("FROM deals d") && sql.includes("deal_intelligence_objects") && sql.includes("LEFT JOIN LATERAL")) {
        const id = String(params[0] ?? "");
        return {
          rows: [
            {
              deal_id: id,
              deal_name: "Test Deal",
              stage: "intake",
              priority: "normal",
              dio_id: "dio-from-db",
              analysis_version: 6,
              dio_updated_at: "2026-02-03T00:00:00.000Z",
              dio_data: {
                phase1: {
                  deal_overview_v2: {
                    // Intentionally different to ensure we do not mix.
                    raise: "$999M",
                    business_model: "Should not appear",
                    revenue: "$999 ARR",
                    customers: "999 customers",
                    growth: "999% MoM",
                  },
                },
              },
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();

  // Stub the report route so the deterministic dashboard endpoint can inject it.
  app.get("/api/v1/deals/:deal_id/report", async () => reportPayload);

  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/dashboard/deals/${dealId}/deterministic`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.report?.ready, true);

  // Ensure structured_summary is surfaced
  assert.equal(body.structured_summary?.raise?.value, "$10M");
  assert.equal(body.structured_summary?.business_model?.value, "SaaS");

  // Canonical header MUST come from structured_summary when report.ready=true
  assert.equal(body.header_canonical?.raise?.value, "$10M");
  assert.equal(body.header_canonical?.business_model?.value, "SaaS");

  // Preserve label + sources
  assert.equal(body.header_canonical?.raise?.label, "Raise");
  assert.deepEqual(body.header_canonical?.raise?.sources, [{ document_id: "doc-1", page_range: [1, 1] }]);

  // De-risking: include dio_id (prefer report artifact)
  assert.equal(body.ids?.dio_id, "dio-1");
  assert.equal(body.ids?.analysis_version, 7);

  // UI Preview (v1) DTO should be attached (best-effort) under report.metadata
  assert.ok(body.report?.metadata?.ui_preview_v1);
  assert.equal(body.report.metadata.ui_preview_v1.version, "ui_preview_v1");
  assert.equal(body.report.metadata.ui_preview_v1.header_tiles?.business_model?.badge, "promoted");
  assert.equal(body.report.metadata.ui_preview_v1.header_tiles?.business_model?.value, "SaaS");

  await app.close();
});

test("GET /api/dashboard/deals/:deal_id/deterministic ready=false uses Phase 1 only and ignores structured_summary entirely", async () => {
  const dealId = "00000000-0000-0000-0000-00000000d222";

  const reportPayload = {
    ready: false,
    version: 1,
    artifact: {
      kind: "deal_intelligence_object",
      dio_id: "dio-ready-false",
      analysis_version: 3,
      updated_at: "2026-02-04T00:00:00.000Z",
    },
    // Intentionally populated to prove it's ignored when ready=false.
    structured_summary: {
      raise: {
        value: "$123M",
        label: "Raise",
        sources: [{ document_id: "doc-structured", page_range: [1, 1] }],
      },
      business_model: {
        value: "StructuredModel",
        label: "Business model",
        sources: [{ document_id: "doc-structured", page_range: [2, 2] }],
      },
      revenue: {
        value: { raw: "$999 ARR" },
        label: "Revenue",
        sources: [{ document_id: "doc-structured", page_range: [3, 3] }],
      },
      customers: {
        value: { raw: "999 customers" },
        label: "Customers",
        sources: [{ document_id: "doc-structured", page_range: [4, 4] }],
      },
      growth: {
        value: { raw: "999% MoM" },
        label: "Growth",
        sources: [{ document_id: "doc-structured", page_range: [5, 5] }],
      },
    },
  };

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM deals d") && sql.includes("deal_intelligence_objects") && sql.includes("LEFT JOIN LATERAL")) {
        const id = String(params[0] ?? "");
        return {
          rows: [
            {
              deal_id: id,
              deal_name: "Test Deal (ready=false)",
              stage: "intake",
              priority: "normal",
              dio_id: "dio-from-db-ready-false",
              analysis_version: 2,
              dio_updated_at: "2026-02-03T00:00:00.000Z",
              dio_data: {
                phase1: {
                  deal_overview_v2: {
                    business_model: "Phase1Model",
                    raise: "Phase1Raise",
                    // revenue/growth/customers intentionally omitted
                  },
                },
              },
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  app.get("/api/v1/deals/:deal_id/report", async () => reportPayload);
  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/dashboard/deals/${dealId}/deterministic`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.report?.ready, false);

  // Prove report includes structured_summary values...
  assert.equal(body.structured_summary?.raise?.value, "$123M");
  assert.equal(body.structured_summary?.business_model?.value, "StructuredModel");

  // ...but canonical header MUST come only from Phase 1 when ready=false.
  assert.equal(body.header_canonical?.raise?.value, "Phase1Raise");
  assert.equal(body.header_canonical?.business_model?.value, "Phase1Model");

  // Missing Phase 1 fields must remain null (no structured_summary fallback).
  assert.equal(body.header_canonical?.revenue?.value, null);
  assert.equal(body.header_canonical?.growth?.value, null);
  assert.equal(body.header_canonical?.customers?.value, null);

  // Explicit no-mixing assertions (canonical != structured_summary values).
  assert.notEqual(body.header_canonical?.raise?.value, body.structured_summary?.raise?.value);
  assert.notEqual(body.header_canonical?.business_model?.value, body.structured_summary?.business_model?.value);
  assert.notEqual(body.header_canonical?.revenue?.value, body.structured_summary?.revenue?.value?.raw);
  assert.notEqual(body.header_canonical?.growth?.value, body.structured_summary?.growth?.value?.raw);
  assert.notEqual(body.header_canonical?.customers?.value, body.structured_summary?.customers?.value?.raw);

  await app.close();
});

test("GET /api/dashboard HTML includes deterministic auto-fill on deal select", async () => {
  const app = Fastify();

  const mockPool = {
    query: async () => {
      throw new Error("Unexpected DB query for /api/dashboard HTML");
    },
  } as any;

  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: "/api/dashboard",
  });

  assert.equal(res.statusCode, 200);
  const html = res.body;

  assert.ok(html.includes("function setDeterministicDealId(dealId)"));
  assert.ok(html.includes("function activateDeterministicSubtab(name)"));
  assert.ok(html.includes("activateDeterministicSubtab('canonical')"));
  assert.ok(html.includes('id="det-subtab-canonical"'));
  assert.ok(html.includes('id="det-subtab-structured"'));
  assert.ok(html.includes('id="det-subtab-legacy"'));
  assert.ok(html.includes("Canonical Header"));
  assert.ok(html.includes("Structured Summary (raw)"));
  assert.ok(html.includes("Legacy / Phase 1"));
  assert.ok(html.includes("function setNodeInspectorDealId(dealId)"));
  assert.ok(html.includes("function selectDeal(dealId)"));
  assert.ok(html.includes("setDeterministicDealId(dealId);"));
  assert.ok(html.includes("setNodeInspectorDealId(dealId);"));
  assert.ok(html.includes("🧩 Node Inspector"));

  // Deterministic -> Node Inspector bridge
  assert.ok(html.includes("View in Node Inspector"));
  assert.ok(html.includes("deterministic-view-nodeinspector-btn"));
  assert.ok(html.includes("setNodeInspectorDealId(dealId)"));
  assert.ok(html.includes("activateTab('node-inspector')"));

  // Node Inspector KPI Coverage panel
  assert.ok(html.includes("KPI Coverage"));
  assert.ok(html.includes("id=\"node-inspector-kpi\""));
  assert.ok(html.includes("kpi-coverage-revenue"));
  assert.ok(html.includes("kpi-coverage-growth"));
  assert.ok(html.includes("kpi-coverage-customers"));

  // Node Inspector report/nodes diff panel
  assert.ok(html.includes("Report ↔ Nodes Diff"));

  await app.close();
});
