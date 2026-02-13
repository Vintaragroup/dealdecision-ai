import { test } from "node:test";
import assert from "node:assert/strict";

import { compileDealSummaryV1 } from "../src/lib/deal-summary-v1";

const mkNode = (partial: Partial<any>): any => ({
  source_document_id: partial.source_document_id ?? "00000000-0000-4000-8000-00000000e999",
  page_index: partial.page_index ?? 0,
  slide_title: partial.slide_title ?? null,
  bullets: partial.bullets ?? [],
  bullets_snippet: partial.bullets_snippet ?? null,
  segment_key: partial.segment_key ?? null,
  node_id: partial.node_id ?? `node_${Math.random().toString(16).slice(2)}`,
});

test("compileDealSummaryV1 emits suppressed semantics when best candidate is garbage", async () => {
  const nodes = [
    mkNode({
      page_index: 0,
      slide_title: "Product",
      bullets: ["CONFIDENTIAL © 2024 www.example.com"],
      segment_key: "product",
      node_id: "p0",
    }),
    mkNode({
      page_index: 1,
      slide_title: "Market / ICP",
      bullets: ["Target customers are mid-market operations teams in logistics and field services."],
      segment_key: "market",
      node_id: "m1",
    }),
    mkNode({
      page_index: 2,
      slide_title: "Company Overview",
      bullets: ["We help operations teams automate complex workflows across existing systems."],
      segment_key: "overview",
      node_id: "o2",
    }),
  ];

  const mockPool: any = { query: async () => {
    throw new Error("DB should not be called when prefetched nodes are provided");
  }};

  const out: any = await compileDealSummaryV1(mockPool, "deal_x", { prefetched: { nodes, warnings: [] } } as any);

  assert.ok(out.product);
  assert.equal(out.product.display_text, null);
  assert.equal(out.product.text, "");
  assert.equal(out.product.quality, "garbage");
  assert.ok(Array.isArray(out.product.suppressed_reasons));
  assert.ok(out.reason?.includes("suppressed_product"));
  assert.equal(out.ready, false);
});

test("compileDealSummaryV1 does not amplify market_context into an overlong market megastring", async () => {
  const longContext = "TAM is large and growing ".repeat(30) + "with strong tailwinds.";

  const nodes = [
    mkNode({
      page_index: 0,
      slide_title: "Product",
      bullets: ["We sell subscription software that automates dispatch routing for field service teams."],
      segment_key: "product",
      node_id: "p0",
    }),
    mkNode({
      page_index: 1,
      slide_title: "Market / ICP",
      bullets: ["Target customers are mid-market operations teams in logistics and field services."],
      segment_key: "market",
      node_id: "m1",
    }),
    mkNode({
      page_index: 2,
      slide_title: "Industry outlook",
      bullets: [longContext],
      segment_key: "market",
      node_id: "mc2",
    }),
    mkNode({
      page_index: 3,
      slide_title: "Company Overview",
      bullets: ["We help operations teams automate complex workflows across existing systems."],
      segment_key: "overview",
      node_id: "o3",
    }),
  ];

  const mockPool: any = { query: async () => {
    throw new Error("DB should not be called when prefetched nodes are provided");
  }};

  const out: any = await compileDealSummaryV1(mockPool, "deal_y", { prefetched: { nodes, warnings: [] } } as any);

  assert.ok(out.market_target?.display_text);
  assert.ok(out.market);
  assert.ok(out.market.display_text);
  assert.ok(!out.market.display_text.includes("Market context:"));

  // If a context candidate existed but was too long, it should be present as suppressed.
  assert.ok(out.market_context);
  assert.equal(out.market_context.display_text, null);
  assert.equal(out.market_context.quality, "garbage");
  assert.ok(out.market_context.suppressed_reasons.includes("too_long"));

  assert.equal(out.ready, true);
});

test("compileDealSummaryV1 does not surface composed market text when it is suppressed", async () => {
  const nodes = [
    mkNode({
      page_index: 0,
      slide_title: "Product",
      bullets: ["We sell subscription software that automates dispatch routing for field service teams."],
      segment_key: "product",
      node_id: "p0",
    }),
    mkNode({
      page_index: 1,
      slide_title: "Market / ICP",
      bullets: ["Target customers are SMB operators."],
      segment_key: "market",
      node_id: "m1",
    }),
    mkNode({
      page_index: 2,
      slide_title: "Industry outlook",
      // Deliberately garbagey context that should not be concatenated or displayed.
      bullets: ["CONFIDENTIAL © 2026 www.example.com"],
      segment_key: "market",
      node_id: "mc2",
    }),
  ];

  const mockPool: any = {
    query: async () => {
      throw new Error("DB should not be called when prefetched nodes are provided");
    },
  };

  const out: any = await compileDealSummaryV1(mockPool, "deal_z", { prefetched: { nodes, warnings: [] } } as any);

  assert.ok(out.market_target);
  assert.ok(out.market_target.display_text);
  assert.ok(out.market);

  // The composed market line should never force display_text when suppressed.
  assert.equal(typeof out.market.quality, "string");
  if (out.market.quality === "garbage") {
    assert.equal(out.market.display_text, null);
    assert.equal(out.market.text, "");
  }
});

test("compileDealSummaryV1 only falls back to slide_title when title is good/ok", async () => {
  const nodes = [
    mkNode({
      page_index: 0,
      slide_title: "CONFIDENTIAL © 2026 www.example.com",
      bullets: [],
      bullets_snippet: null,
      segment_key: "product",
      node_id: "p0",
    }),
  ];

  const mockPool: any = {
    query: async () => {
      throw new Error("DB should not be called when prefetched nodes are provided");
    },
  };

  const out: any = await compileDealSummaryV1(mockPool, "deal_title", { prefetched: { nodes, warnings: [] } } as any);

  // Title is garbage, so we should end up suppressed/missing rather than surfacing it.
  assert.ok(out.product);
  assert.equal(out.product.display_text, null);
  assert.equal(out.product.text, "");
});
