import { test } from "node:test";
import assert from "node:assert/strict";

import { derivePromotedFactsFromDpuForDeal } from "../src/lib/promoted-facts-from-dpu";

function makeDpuPayload(input: { title: string; segment_key: string; bullets: string[] }) {
  return {
    structured: {
      title: input.title,
      segment_key: input.segment_key,
      bullets: input.bullets,
    },
  };
}

test("business_model_v1 promotion: enforces primary/supporting roles + hard exclusions", async () => {
  const dealId = "deal-1";
  const docId = "doc-1";

  const dpuRows = [
    // Excluded: team/hiring, even if channel tokens appear
    {
      document_id: docId,
      page_index: 1,
      payload: makeDpuPayload({
        title: "Team",
        segment_key: "team",
        bullets: ["Hiring plan", "Ex-Shopify leader (DTC)", "Wholesale experience"],
      }),
    },
    // Excluded: financial-only, even if channel tokens appear
    {
      document_id: docId,
      page_index: 2,
      payload: makeDpuPayload({
        title: "Financial Projections",
        segment_key: "financials",
        bullets: ["Wholesale revenue forecast $10M"],
      }),
    },
    // Excluded: opportunity/vision
    {
      document_id: docId,
      page_index: 3,
      payload: makeDpuPayload({
        title: "Market Opportunity",
        segment_key: "market",
        bullets: ["Retail opportunity is huge"],
      }),
    },
    // Primary: explicit GTM/channels
    {
      document_id: docId,
      page_index: 4,
      payload: makeDpuPayload({
        title: "Go to Market Strategy",
        segment_key: "go_to_market",
        bullets: ["Channels: DTC via Shopify and wholesale through retailers"],
      }),
    },
    // Supporting: channel-referential but not a primary-structured channel slide
    {
      document_id: docId,
      page_index: 5,
      payload: makeDpuPayload({
        title: "Traction",
        segment_key: "traction",
        bullets: ["100 retail stores"],
      }),
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("SELECT 1 FROM document_page_understanding")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("WHERE deal_id")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const rows = await derivePromotedFactsFromDpuForDeal(mockPool, dealId);
  const bm = rows.find((r) => r.content_json?.fact_type === "business_model_v1");
  assert.ok(bm, "Expected business_model_v1 promoted fact");

  assert.equal(bm.content_json?.value_json?.display, "Omnichannel (DTC + Wholesale/Retail)");

  const prov = bm.content_json?.provenance;
  assert.ok(prov, "Expected provenance");

  assert.ok(Array.isArray(prov.primary_sources));
  assert.equal(prov.primary_sources.length, 1);
  assert.equal(prov.primary_sources[0].page_index, 4);

  assert.ok(Array.isArray(prov.supporting_sources));
  // Should include the traction slide, but never excluded slides
  assert.ok(prov.supporting_sources.some((s: any) => s.page_index === 5));
  assert.ok(!prov.supporting_sources.some((s: any) => s.page_index === 1));
  assert.ok(!prov.supporting_sources.some((s: any) => s.page_index === 2));
  assert.ok(!prov.supporting_sources.some((s: any) => s.page_index === 3));
});

test("business_model_v1 promotion: Palm deck primary must be page_index 15 or 23", async () => {
  const dealId = "deal-palm";
  const docId = "doc-palm";

  const dpuRows = [
    {
      document_id: docId,
      page_index: 3,
      payload: makeDpuPayload({
        title: "Traction",
        segment_key: "traction",
        bullets: ["100 wholesale accounts"],
      }),
    },
    {
      document_id: docId,
      page_index: 15,
      payload: makeDpuPayload({
        title: "Go to Market Strategy",
        segment_key: "go_to_market",
        bullets: ["Channels: DTC via Shopify; wholesale through retailers"],
      }),
    },
    {
      document_id: docId,
      page_index: 23,
      payload: makeDpuPayload({
        title: "Omni-Channel Marketing",
        segment_key: "distribution",
        bullets: ["Channels: DTC via website; wholesale through retail"],
      }),
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("SELECT 1 FROM document_page_understanding")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("WHERE deal_id")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const rows = await derivePromotedFactsFromDpuForDeal(mockPool, dealId);
  const bm = rows.find((r) => r.content_json?.fact_type === "business_model_v1");
  assert.ok(bm, "Expected business_model_v1 promoted fact");

  const prov = bm.content_json?.provenance;
  const primaryPi = prov?.primary_sources?.[0]?.page_index;
  assert.ok(primaryPi === 15 || primaryPi === 23, `Expected primary page_index 15 or 23, got ${String(primaryPi)}`);
});
