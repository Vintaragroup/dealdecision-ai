process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDashboardRoutes } from "../routes/dashboard";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("dashboard browser contract smoke: HTML shell contains load-bearing strings + JS wiring", async () => {
  const app = Fastify();

  const mockPool = {
    query: async () => ({ rows: [] }),
  } as any;

  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({ method: "GET", url: "/api/dashboard" });
  assert.equal(res.statusCode, 200);

  const html = String(res.body ?? "");

  // HTML shell contract (browser-facing strings)
  assert.ok(html.includes("🧭 Deterministic"));
  assert.ok(html.includes("🧩 Node Inspector"));
  assert.ok(html.includes("Deal Summary (v1)"));
  assert.ok(html.includes("Product Summary (v1)"));
  assert.ok(html.includes("Market Summary (v1)"));
  assert.ok(html.includes("Deck Archetype (v1)"));
  assert.ok(html.includes("Archetype ↔ Segment Alignment"));
  assert.ok(html.includes("Override Quality (v1)"));
  assert.ok(html.includes("Score Inputs (v1)"));
  assert.ok(html.includes("Expected segments"));
  assert.ok(html.includes("deck_type"));

  // JS wiring contract (string-based, no DOM parsing)
  assert.ok(html.includes("function loadDeterministic("));
  assert.ok(html.includes("function loadNodeInspector("));
  assert.ok(html.includes("function activateTab("));
  assert.ok(html.includes("function setDeterministicDealId("));
  assert.ok(html.includes("function setNodeInspectorDealId("));

  await app.close();
});

test("dashboard browser contract smoke: deterministic JSON endpoint returns canonical shapes + v1 summaries with sources", async () => {
  const dealId = "00000000-0000-0000-0000-000000000901";

  const app = Fastify();

  // Stub the report endpoint: dashboard deterministic route injects this internally.
  app.get("/api/v1/deals/:deal_id/report", async () => {
    return {
      ready: true,
      version: 1,
      metadata: {
        deck_archetype: {
          version: "deck_archetype_v1",
          key: "consumer_apparel_dtc",
          confidence: 0.72,
          scores: {
            consumer_apparel_dtc: 0.72,
            enterprise_saas_compliance: 0.12,
            pe_rollup_consolidation: 0.08,
          },
          segment_counts: { product: 2, market: 2, traction: 1 },
          keyword_hits: { dtc: 1, wholesale: 1, apparel: 1 },
        },
        archetype_diagnostics: [
          { kind: "overrepresentation", message: "Overrepresented segment: operations (70% of nodes)", details: { segment: "operations" } },
        ],
        override_quality: {
          total_nodes: 10,
          overridden_nodes: 2,
          override_ratio: 0.2,
          by_segment: { go_to_market: 2 },
          by_override_rule: { "segmenter:override:gtm.intent.customers_distribution": 2 },
          assessment: "moderate",
          notes: ["Overrides concentrated in GTM-related slides"],
          by_override_rule_segments: { "segmenter:override:gtm.intent.customers_distribution": ["go_to_market"] },
        },
        deterministic_score_inputs_v1: {
          version: "deterministic_score_inputs_v1",
          inputs_hash: "a".repeat(64),
          segments: {
            total_nodes: 10,
            counts: { product: 2, market: 2, traction: 1 },
            override_ratio: 0.2,
            overridden_nodes: 2,
          },
          deck: { deck_archetype_key: "consumer_apparel_dtc", drift_assessment: "mostly_aligned" },
          kpis: [
            { key: "revenue", confidence: 0.8, sources: [{ document_id: "doc-1", page_index: 2 }], value_raw: "$1M ARR" },
            { key: "customers", confidence: 0.7, sources: [{ document_id: "doc-1", page_index: 4 }], value_raw: "100 customers" },
            { key: "growth", confidence: 0.6, sources: [{ document_id: "doc-1", page_index: 3 }], value_raw: "20% MoM" },
          ],
        },
        deterministic_score_preview_v1: {
          version: "deterministic_score_preview_v1",
          enabled: false,
          gate: { drift_assessment: "mostly_aligned", blocked_by_drift_misaligned: false },
          inputs_hash: "a".repeat(64),
          modifier_v1: { signal_strength: 0.7, modifier: 1.02, notes: ["signal_strength=0.700", "modifier=1.020"] },
          baseline: { overall_score: 67, unadjusted_overall_score: 80, evidence_factor: 0.55, due_diligence_factor: 1, adjustment_factor: 0.55 },
          deterministic: { overall_score: 68, evidence_factor: 0.561, adjustment_factor: 0.561 },
          delta_overall_score: 1,
          applied: false,
          applied_parts: [],
        },
      },
      artifact: {
        kind: "deal_intelligence_object",
        dio_id: "dio-contract",
        analysis_version: 99,
        updated_at: "2026-02-05T00:00:00.000Z",
      },
      structured_summary: {
        raise: { value: "$10M", label: "Raise", sources: [{ document_id: "doc-1", page_range: [1, 1] }] },
        business_model: { value: "DTC", label: "Business model", sources: [{ document_id: "doc-1", page_range: [2, 2] }] },
        revenue: { value: { raw: "$1M ARR" }, label: "Revenue", sources: [{ document_id: "doc-1", page_range: [3, 3] }] },
        growth: { value: { raw: "20% MoM" }, label: "Growth", sources: [{ document_id: "doc-1", page_range: [4, 4] }] },
        customers: { value: { raw: "100 customers" }, label: "Customers", sources: [{ document_id: "doc-1", page_range: [5, 5] }] },

        // Canonical v1 summaries (browser-safe: include sources[].page_index)
        deck_type: "pitch",
        deal_summary_v1: {
          value: "Company: Premium golf apparel brand. Sells: Gloves and apparel. Serves: Golf consumers. Why it wins: Conversion and wholesale accounts.",
          confidence: 0.8,
          sources: [{ document_id: "doc-1", page_index: 8, slide_title: "Traction", snippet: "Wholesale accounts growing (46 accounts) alongside DTC conversion gains." }],
        },
        product_summary_v1: {
          value: "Product: Premium golf apparel and gloves (physical).",
          confidence: 0.78,
          sources: [{ document_id: "doc-1", page_index: 12, slide_title: "Product", snippet: "Premium golf apparel designed for performance and lifestyle, including gloves." }],
        },
        market_summary_v1: {
          value: "Market: Golf participation is growing, supporting premium apparel demand.",
          confidence: 0.7,
          sources: [{ document_id: "doc-1", page_index: 1, slide_title: "Market", snippet: "Golf participation is growing, supporting premium apparel demand." }],
        },
      },
    };
  });

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM deals d") && sql.includes("deal_intelligence_objects") && sql.includes("LEFT JOIN LATERAL")) {
        const id = String(params[0] ?? "");
        return {
          rows: [
            {
              deal_id: id,
              deal_name: "Contract Deal",
              stage: "intake",
              priority: "normal",
              dio_id: "dio-from-db",
              analysis_version: 1,
              dio_updated_at: "2026-02-05T00:00:00.000Z",
              dio_data: {
                phase1: { deal_overview_v2: { raise: "Phase1Raise", business_model: "Phase1Model" } },
              },
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({ method: "GET", url: `/api/dashboard/deals/${dealId}/deterministic` });
  assert.equal(res.statusCode, 200);

  const body = res.json() as any;

  assert.ok(body.header_canonical);
  assert.ok(body.header_canonical.raise);
  assert.ok(body.header_canonical.business_model);
  assert.ok(body.header_canonical.revenue);
  assert.ok(body.header_canonical.growth);
  assert.ok(body.header_canonical.customers);

  assert.ok(body.structured_summary);
  assert.ok(body.structured_summary.deal_summary_v1);
  assert.ok(body.structured_summary.product_summary_v1);
  assert.ok(body.structured_summary.market_summary_v1);

  for (const key of ["deal_summary_v1", "product_summary_v1", "market_summary_v1"] as const) {
    const section = body.structured_summary[key];
    assert.equal(typeof section.value, "string");
    assert.equal(typeof section.confidence, "number");
    assert.ok(Array.isArray(section.sources));
    assert.ok(section.sources.length > 0);
    assert.equal(typeof section.sources[0].page_index, "number");
  }

  assert.ok(body.report && body.report.metadata);
  assert.ok(body.report.metadata.deck_archetype);
  assert.equal(body.report.metadata.deck_archetype.key, "consumer_apparel_dtc");
  assert.ok(Array.isArray(body.report.metadata.archetype_diagnostics));
  assert.equal(body.report.metadata.archetype_diagnostics[0].kind, "overrepresentation");

  assert.ok(body.report.metadata.override_quality);
  assert.ok(body.report.metadata.deterministic_score_inputs_v1);
  assert.equal(body.report.metadata.deterministic_score_inputs_v1.version, "deterministic_score_inputs_v1");
  assert.equal(typeof body.report.metadata.deterministic_score_inputs_v1.inputs_hash, "string");
  assert.ok(body.report.metadata.deterministic_score_preview_v1);
  assert.equal(body.report.metadata.deterministic_score_preview_v1.version, "deterministic_score_preview_v1");
  assert.equal(body.report.metadata.override_quality.assessment, "moderate");
  assert.equal(body.report.metadata.override_quality.total_nodes, 10);
  assert.equal(body.report.metadata.override_quality.overridden_nodes, 2);

  await app.close();
});

test("dashboard browser contract smoke: node inspector returns nodes with segment_trace override fields", async () => {
  const dealId = "00000000-0000-0000-0000-000000000902";

  const app = Fastify();

  const dpuRows = [
    {
      document_id: "doc-1",
      page_index: 1,
      payload: {
        structured: {
          title: "Product",
          bullets: ["Premium golf apparel designed for performance and lifestyle."],
        },
      },
    },
    {
      document_id: "doc-1",
      page_index: 2,
      payload: {
        structured: {
          title: "Business Performance",
          bullets: ["Revenue reached $1.2M.", "Strong conversion and CAC payback improvements."],
        },
      },
    },
  ];

  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes("FROM public.document_page_understanding") && sql.includes("page_understanding_v1")) {
        return { rows: dpuRows };
      }

      if (sql.includes("FROM evidence_items")) {
        return { rows: [] };
      }

      // getSegmentedNodesForDeal might query visual_assets if visual_asset_id is present; we omit it.
      if (sql.includes("FROM visual_assets")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({ method: "GET", url: `/api/dashboard/deals/${dealId}/nodes/inspect` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.ok(Array.isArray(body.nodes));
  assert.equal(body.nodes.length, 2);

  for (const n of body.nodes) {
    assert.ok(typeof n.segment_key === "string" || n.segment_key === null);
    assert.ok(n.segment_reason);
    assert.ok(n.segment_trace);
  }

  const overridden = body.nodes.find((n: any) => n.page_index === 2);
  assert.ok(overridden, "expected overridden node at page_index=2");
  assert.equal(overridden.segment_trace.did_override, true);
  assert.notEqual(overridden.segment_trace.original_segment_key, overridden.segment_trace.final_segment_key);
  assert.ok(typeof overridden.segment_trace.override_rule_id === "string" && overridden.segment_trace.override_rule_id.length > 0);
  assert.equal(typeof overridden.segment_trace.override_confidence, "number");

  const nonOverridden = body.nodes.find((n: any) => n.page_index === 1);
  assert.ok(nonOverridden, "expected non-overridden node at page_index=1");
  assert.equal(nonOverridden.segment_trace.did_override, false);

  await app.close();
});
