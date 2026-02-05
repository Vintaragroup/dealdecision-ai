import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBusinessModelSummaryV1, type SegmentedNode } from '../lib/reports/business-model-summary';
import { buildDealSummaryV1 } from '../lib/reports/canonical-summaries';

test('deal_summary_v1 is claim-gated and Palm-like (identity + product + audience + traction)', () => {
  const nodes: SegmentedNode[] = [
    {
      source_document_id: 'doc-1',
      page_index: 8,
      slide_title: 'Traction',
      bullets: [
        'Strong website conversion and revenue attribution across paid and organic.',
        'Wholesale accounts growing (46 accounts) alongside DTC conversion gains.',
      ],
      segment_key: 'traction',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 12,
      slide_title: 'Product',
      bullets: ['Premium golf apparel designed for performance and lifestyle, including gloves.'],
      segment_key: 'product',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 13,
      slide_title: 'Line',
      bullets: ['Apparel and accessories expanding across lifestyle categories.'],
      segment_key: 'product',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 1,
      slide_title: 'Market',
      bullets: ['Golf participation is growing, supporting premium apparel demand.'],
      segment_key: 'market',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const bm = buildBusinessModelSummaryV1(nodes);
  assert.ok(bm && bm.value);

  const out = buildDealSummaryV1({
    nodes,
    structured_summary: { business_model_summary: bm },
  });

  assert.ok(out && out.value);
  assert.equal(Array.isArray(out.claims) && out.claims.length, 4);
  assert.deepEqual(out.claims, ['what_the_company_is', 'what_it_sells', 'who_it_serves', 'why_it_wins']);

  assert.match(out.value, /golf apparel/i);
  assert.match(out.value, /DTC/i);
  assert.match(out.value, /wholesale/i);
  assert.match(out.value, /traction|conversion|accounts/i);

  assert.deepEqual(out.derived_from.product_pages, [12]);
  assert.deepEqual(out.derived_from.traction_pages, [8]);
  assert.deepEqual(out.derived_from.market_pages ?? [], [1]);

  assert.ok(out.supporting_nodes.length > 0);
  assert.ok(out.supporting_nodes.length <= 6);
});

test('deal_summary_v1 returns null when required claims are missing', () => {
  const nodes: SegmentedNode[] = [
    {
      source_document_id: 'doc-1',
      page_index: 3,
      slide_title: 'Market',
      bullets: ['Large market opportunity.'],
      segment_key: 'market',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const out = buildDealSummaryV1({ nodes, structured_summary: {} });
  assert.equal(out, null);
});
