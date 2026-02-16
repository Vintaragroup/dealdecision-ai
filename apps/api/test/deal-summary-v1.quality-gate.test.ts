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
  assert.equal(out.product.text, null);
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
  assert.ok(!out.market.display_text.includes("(Context:"));

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
    assert.equal(out.market.text, null);
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
  assert.equal(out.product.text, null);
});

test('compileDealSummaryV1 market falls back to target when composed target+context is too long', async () => {
  const capTo = (s: string, maxLen: number): string => {
    const text = String(s).trim();
    if (text.length <= maxLen) return text;
    const head = text.slice(0, maxLen);
    const lastSpace = head.lastIndexOf(' ');
    return (lastSpace >= Math.floor(maxLen * 0.6) ? head.slice(0, lastSpace) : head).trim();
  };

  // Keep each component individually <= 220 (displayable), but guarantee composed target+context exceeds 220.
  const target = capTo(
    'Target customers are mid-market operations teams in logistics and field services buying routing + dispatch automation across multi-site operations, complex shift coverage, seasonal demand, and multi-warehouse workflows.',
    218,
  );
  const context = capTo(
    'Industry context: category growth is strong with participation tailwinds, expanding adoption, and increasing spend on automation across adjacent operational areas and geographies.',
    218,
  );

  // Individually, these should be displayable under the 220-char gate after canonical normalization;
  // together they should exceed the composed cap and trigger fallback.
  const nodes = [
    mkNode({
      page_index: 0,
      slide_title: 'Product',
      bullets: ['We sell subscription software that automates dispatch routing for field service teams.'],
      segment_key: 'product',
      node_id: 'p0',
    }),
    mkNode({
      page_index: 1,
      slide_title: 'Market / ICP',
      bullets: [target],
      segment_key: 'market',
      node_id: 'm1',
    }),
    mkNode({
      page_index: 2,
      slide_title: 'Industry outlook',
      bullets: [context],
      segment_key: 'market',
      node_id: 'mc2',
    }),
    mkNode({
      page_index: 3,
      slide_title: 'Company Overview',
      bullets: ['We help operations teams automate complex workflows across existing systems.'],
      segment_key: 'overview',
      node_id: 'o3',
    }),
  ];

  const mockPool: any = {
    query: async () => {
      throw new Error('DB should not be called when prefetched nodes are provided');
    },
  };

  const out: any = await compileDealSummaryV1(mockPool, 'deal_market_fallback', { prefetched: { nodes, warnings: [] } } as any);

  assert.ok(out.market_target?.display_text);
  assert.ok(out.market_context?.display_text);
  assert.ok(out.market);

  // Previously this was frequently suppressed as too_long; now it should fall back to a clean component.
  assert.ok(out.market.display_text);
  assert.ok(!out.market.suppressed_reasons?.includes('too_long'));
  assert.ok(!out.market.display_text.includes('(Context:'));

  // Auditable composition decision.
  assert.ok(out.meta);
  assert.ok(out.meta.market);
  assert.ok(out.meta.market.canonical);
  assert.ok(Array.isArray(out.meta.market.canonical.rules_applied));
  assert.ok(out.meta.market.canonical.rules_applied.includes('market_compose_fallback_more_coherent_component'));

  // Citations should align with the chosen text (coherence-based fallback => either market_target or market_context sources).
  assert.equal(out.market.sources.length, 1);
  const chosenId = out.market.sources[0].node_id;
  const targetId = out.market_target.sources[0].node_id;
  const contextId = out.market_context.sources[0].node_id;
  assert.ok(chosenId === targetId || chosenId === contextId);

  if (chosenId === targetId) {
    assert.match(out.market.display_text, /Target customers are/i);
  }
});

test('compileDealSummaryV1 market uses composed target+context when it fits cap', async () => {
  const nodes = [
    mkNode({
      page_index: 0,
      slide_title: 'Product',
      bullets: ['We sell subscription software that automates dispatch routing for field service teams.'],
      segment_key: 'product',
      node_id: 'p0',
    }),
    mkNode({
      page_index: 1,
      slide_title: 'Market / ICP',
      bullets: ['Target customers are mid-market field service operators.'],
      segment_key: 'market',
      node_id: 'm1',
    }),
    mkNode({
      page_index: 2,
      slide_title: 'Industry outlook',
      bullets: ['Industry participation is growing, expanding demand for operational automation.'],
      segment_key: 'market',
      node_id: 'mc2',
    }),
    mkNode({
      page_index: 3,
      slide_title: 'Company Overview',
      bullets: ['We help operations teams automate complex workflows across existing systems.'],
      segment_key: 'overview',
      node_id: 'o3',
    }),
  ];

  const mockPool: any = {
    query: async () => {
      throw new Error('DB should not be called when prefetched nodes are provided');
    },
  };

  const out: any = await compileDealSummaryV1(mockPool, 'deal_market_composed', { prefetched: { nodes, warnings: [] } } as any);

  assert.ok(out.market_target?.display_text);
  assert.ok(out.market_context?.display_text);
  assert.ok(out.market?.display_text);
  assert.ok(out.market.display_text.includes('(Context:'));
  assert.ok(!out.meta?.market?.canonical?.rules_applied?.includes('market_compose_fallback_more_coherent_component'));
});
