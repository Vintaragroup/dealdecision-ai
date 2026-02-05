process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDashboardRoutes } from "../routes/dashboard";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/dashboard/deals/:deal_id/nodes/inspect returns DPU nodes with segment mapping when available", async () => {
  const dealId = "00000000-0000-4000-8000-00000000d111";

  const doc1 = "00000000-0000-4000-8000-00000000c111";
  const doc2 = "00000000-0000-4000-8000-00000000c222";
  const doc3 = "00000000-0000-4000-8000-00000000c333";

  const va1 = "00000000-0000-4000-8000-00000000a111";
  const va2 = "00000000-0000-4000-8000-00000000a222";

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      // DPU rows
      if (sql.includes("FROM public.document_page_understanding") && sql.includes("version = 'page_understanding_v1'")) {
        assert.equal(String(params[0] ?? ""), dealId);
        return {
          rows: [
            {
              document_id: doc1,
              page_index: 0,
              payload: {
                structured: {
                  title: "Market overview",
                  bullets: ["TAM is large", "Strong tailwinds"],
                },
                source: {
                  visual_asset_id: va1,
                },
              },
            },
            {
              document_id: doc2,
              page_index: 1,
              payload: {
                structured: {
                  title: "Financials",
                  bullets: ["Revenue growing"],
                },
                source: {
                  visual_asset_id: va2,
                },
              },
            },
            {
              document_id: doc3,
              page_index: 2,
              payload: {
                structured: {
                  title: "Strategic Hires & Wholesale Build Out",
                  bullets: ["Serving 150+ green grass accounts", "Wholesale distribution into 500 doors"],
                },
              },
            },
          ],
        };
      }

      // Segment mapping via visual_assets.quality_flags.segment_key
      if (sql.includes("FROM visual_assets") && sql.includes("quality_flags") && sql.includes("id = ANY")) {
        const ids = params[0] as string[];
        assert.ok(Array.isArray(ids));
        assert.ok(ids.includes(va1));
        assert.ok(ids.includes(va2));

        return {
          rows: [
            {
              id: va1,
              quality_flags: {
                segment_key: "market",
                segment_source: "human_override",
                segment_confidence: 0.93,
              },
            },
            // Note: va2 intentionally not returned => segment remains null.
          ],
        };
      }

      // Evidence connections are optional.
      if (sql.includes("FROM evidence_items") && sql.includes("source_type = 'dpu_derived_fact'")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({
    method: "GET",
    url: `/api/dashboard/deals/${dealId}/nodes/inspect`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.deepEqual(body.document_ids?.sort(), [doc1, doc2, doc3].sort());

  assert.equal(body.metadata?.node_count, 3);
  assert.equal(body.metadata?.segmented_count, 3);
  assert.equal(body.metadata?.unsegmented_count, 0);

  const nodes = body.nodes as any[];
  assert.equal(nodes.length, 3);

  const n1 = nodes.find((n) => n.document_id === doc1 && n.page_index === 0);
  assert.ok(n1);
  assert.equal(n1.node_id, `${doc1}:0`);
  assert.equal(n1.slide_title, "Market overview");
  assert.ok(String(n1.bullets_snippet).includes("TAM is large"));
  assert.equal(n1.segment_key, "market");
  assert.deepEqual(n1.segment_reason?.rules_hit, ["visual_assets.quality_flags.segment_key"]);
  assert.ok(n1.segment_trace);
  assert.equal(n1.segment_trace.final_segment_key, "market");
  assert.equal(n1.segment_trace.did_override, false);
  assert.equal(n1.segment_trace.override_rule_id, null);
  assert.deepEqual(n1.connections?.feeds_fields ?? [], []);
  assert.deepEqual(n1.connections?.evidence_ids ?? [], []);

  const n2 = nodes.find((n) => n.document_id === doc2 && n.page_index === 1);
  assert.ok(n2);
  assert.equal(n2.node_id, `${doc2}:1`);
  assert.equal(n2.slide_title, "Financials");
  assert.equal(n2.segment_key, "financials");
  assert.ok(Array.isArray(n2.segment_reason?.rules_hit));
  assert.ok(n2.segment_reason?.rules_hit.includes("segmenter:dpu_page_v1"));
  assert.ok(n2.segment_reason?.rules_hit.includes("segmenter:title:financials.title.financials_forecast"));
  assert.equal(n2.segment_reason?.source, "deterministic");
  assert.ok(typeof n2.segment_reason?.classifier_confidence === "number");
  assert.ok(n2.segment_reason?.classifier_confidence >= 0.9);
  assert.ok(n2.segment_trace);
  assert.equal(n2.segment_trace.final_segment_key, "financials");
  assert.equal(n2.segment_trace.did_override, false);
  assert.equal(n2.segment_trace.override_rule_id, null);

  const n3 = nodes.find((n) => n.document_id === doc3 && n.page_index === 2);
  assert.ok(n3);
  assert.equal(n3.node_id, `${doc3}:2`);
  assert.equal(n3.slide_title, "Strategic Hires & Wholesale Build Out");
  assert.equal(n3.segment_key, "go_to_market");
  assert.ok(Array.isArray(n3.segment_reason?.rules_hit));
  assert.ok(n3.segment_reason?.rules_hit.includes("segmenter:title:team.title.strategic_hires"));
  assert.ok(n3.segment_reason?.rules_hit.includes("segmenter:override:gtm.intent.customers_distribution"));
  assert.ok(n3.segment_trace);
  assert.equal(n3.segment_trace.original_segment_key, "team");
  assert.equal(n3.segment_trace.final_segment_key, "go_to_market");
  assert.equal(n3.segment_trace.did_override, true);
  assert.equal(n3.segment_trace.override_rule_id, "segmenter:override:gtm.intent.customers_distribution");
  assert.ok(typeof n3.segment_trace.override_reason === "string");
  assert.ok(n3.segment_trace.override_reason.toLowerCase().includes("wholesale") || n3.segment_trace.override_reason.toLowerCase().includes("distribution"));
  assert.ok(typeof n3.segment_trace.override_confidence === "number");
  assert.ok(n3.segment_trace.override_confidence >= 0.8);

  await app.close();
});
