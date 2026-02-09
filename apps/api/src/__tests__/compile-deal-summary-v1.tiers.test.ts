import test from 'node:test';
import assert from 'node:assert/strict';

import { compileDealSummaryV1 } from '../lib/deal-summary-v1';
import type { SegmentedDealNode } from '../lib/segmented-nodes-for-deal';

const mkNode = (partial: Partial<SegmentedDealNode> & Pick<SegmentedDealNode, 'node_id' | 'source_document_id' | 'page_index'>): SegmentedDealNode => {
  const bullets = Array.isArray(partial.bullets) ? partial.bullets : [];
  return {
    node_id: partial.node_id,
    document_id: partial.document_id ?? 'doc-1',
    source_document_id: partial.source_document_id,
    page_index: partial.page_index,
    slide_title: partial.slide_title ?? null,
    bullets,
    bullets_snippet: partial.bullets_snippet ?? bullets.join(' • ').slice(0, 200),
    visual_asset_id: partial.visual_asset_id ?? null,
    segment_key: partial.segment_key ?? null,
    structured_segment_key_raw: partial.structured_segment_key_raw ?? null,
    quality_flags_segment_key_raw: partial.quality_flags_segment_key_raw ?? null,
    segment_reason:
      partial.segment_reason ??
      {
        rules_hit: [],
        keywords_hit: [],
        classifier_confidence: null,
        source: 'deterministic',
      },
  };
};

test('compileDealSummaryV1 emits hero/overview/deep tiers (Palm-like) and they are ordered + non-identical', async () => {
  const nodes: SegmentedDealNode[] = [
    mkNode({
      node_id: 'n-overview',
      source_document_id: 'doc-1',
      page_index: 0,
      slide_title: 'Overview',
      segment_key: 'overview',
      bullets: [
        'Golf apparel and accessories brand selling performance and lifestyle products.',
        'Primary channel is DTC with wholesale expansion via retailers and pro shops.',
      ],
    }),
    mkNode({
      node_id: 'n-product',
      source_document_id: 'doc-1',
      page_index: 2,
      slide_title: 'Product',
      segment_key: 'product',
      bullets: ['Premium golf apparel and accessories including gloves and hats.'],
    }),
    mkNode({
      node_id: 'n-product-press',
      source_document_id: 'doc-1',
      page_index: 3,
      slide_title: 'Press',
      segment_key: 'product',
      bullets: ['As seen in Golf Digest and other media outlets.'],
    }),
    mkNode({
      node_id: 'n-market',
      source_document_id: 'doc-1',
      page_index: 4,
      slide_title: 'Market',
      segment_key: 'market',
      bullets: ['ICP: core 18–34 male golfers, expanding into women and youth. Sells via DTC and wholesale to green grass courses, retailers, and pro shops.'],
    }),
    mkNode({
      node_id: 'n-market-context',
      source_document_id: 'doc-1',
      page_index: 5,
      slide_title: 'Industry outlook',
      segment_key: 'market',
      bullets: ['Golf participation is growing, supporting premium apparel demand.'],
    }),
    mkNode({
      node_id: 'n-traction',
      source_document_id: 'doc-1',
      page_index: 6,
      slide_title: 'Traction',
      segment_key: 'traction',
      bullets: ['Wholesale accounts are growing alongside DTC conversion and repeat customer behavior.'],
    }),
  ];

  const out = await compileDealSummaryV1(null as any, 'deal-1', {
    prefetched: { nodes, warnings: [] },
  } as any);

  assert.equal(out.version, 'deal_summary_v1');
  assert.equal(out.ready, true);
  assert.ok(out.tiers);

  // Product must be definition (categories/lines), not validation/press language.
  assert.ok(out.product);
  assert.match(out.product.text, /apparel/i);
  assert.match(out.product.text, /gloves/i);
  assert.match(out.product.text, /accessories/i);
  assert.doesNotMatch(out.product.text, /as seen in|press|featured|award|golf digest/i);

  assert.ok(out.market_target);
  assert.match(out.market_target.text, /18\s*[-–]\s*34/i);
  assert.match(out.market_target.text, /women/i);
  assert.match(out.market_target.text, /youth/i);
  assert.match(out.market_target.text, /DTC/i);
  assert.match(out.market_target.text, /wholesale/i);
  assert.ok(out.market_context);
  assert.match(out.market_context.text, /participation|growing|growth/i);
  assert.ok(out.market);
  assert.match(out.market.text, /Target market:/i);
  assert.match(out.market.text, /Market context:/i);

  assert.match(out.tiers.hero, /golf apparel and accessories/i);
  assert.match(out.tiers.hero, /DTC/i);
  assert.match(out.tiers.hero, /wholesale/i);

  // Hard regressions: tiers must not collapse into reused strings.
  // Hero is a compact one-liner; overview adds labeled Product/Market; deep is multi-paragraph with details.
  assert.doesNotMatch(out.tiers.hero, /\bProduct:/i);
  assert.doesNotMatch(out.tiers.hero, /\bMarket:/i);

  assert.match(out.tiers.overview, /\bProduct:/i);
  assert.match(out.tiers.overview, /\bMarket:/i);

  assert.match(out.tiers.deep, /\bProduct details:/i);
  assert.match(out.tiers.deep, /\bMarket \/ ICP:/i);
  assert.match(out.tiers.deep, /\n\n/);

  assert.ok(out.tiers.overview.length > out.tiers.hero.length);
  assert.ok(out.tiers.deep.length > out.tiers.overview.length);
  assert.notEqual(out.tiers.hero, out.tiers.overview);
  assert.notEqual(out.tiers.overview, out.tiers.deep);

  // Additional guardrail: each tier must introduce at least one unique labeled phrase.
  assert.ok(out.tiers.overview.includes('Product:'), 'overview must add labeled Product section beyond hero');
  assert.ok(out.tiers.deep.includes('Product details:'), 'deep must add Product details beyond overview');
});
