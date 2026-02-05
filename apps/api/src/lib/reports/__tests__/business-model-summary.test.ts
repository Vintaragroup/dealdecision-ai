import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBusinessModelSummaryV1, type SegmentedNode } from '../business-model-summary';

test('business_model_summary_v1 synthesizes Palm-like nodes (product + channels + traction)', () => {
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
      bullets: ['Premium golf apparel designed for performance and lifestyle.'],
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
      page_index: 15,
      slide_title: 'Go-to-market',
      bullets: ['DTC via website plus wholesale expansion into green grass retailers.'],
      segment_key: 'go_to_market',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 22,
      slide_title: 'Strategic Hires & Wholesale Build Out',
      bullets: ['Serving 150+ green grass accounts across wholesale distribution.'],
      segment_key: 'go_to_market',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 23,
      slide_title: 'Distribution',
      bullets: ['Omni-channel marketing to support DTC and wholesale growth.'],
      segment_key: 'distribution',
      segment_reason: { source: 'deterministic' },
    },

    // Excluded: raise_terms should never appear in supporting_nodes
    {
      source_document_id: 'doc-1',
      page_index: 19,
      slide_title: 'Capital Raise',
      bullets: ['$1.5MM raise on a $6MM valuation'],
      segment_key: 'raise_terms',
      segment_reason: { source: 'deterministic' },
    },

    // Excluded: operations/equipment should never appear
    {
      source_document_id: 'doc-1',
      page_index: 27,
      slide_title: 'Equipment',
      bullets: ['Operational optimization opportunities'],
      segment_key: 'equipment',
      segment_reason: { source: 'deterministic' },
    },

    // Excluded by default: financials without explicit channel/model language
    {
      source_document_id: 'doc-1',
      page_index: 16,
      slide_title: 'Growth Forecast',
      bullets: ['$4.5M+ 2026.'],
      segment_key: 'financials',
      segment_reason: { source: 'deterministic' },
    },

    // Market corroboration (category confirmation)
    {
      source_document_id: 'doc-1',
      page_index: 1,
      slide_title: 'Industry Outlook',
      bullets: ['Golf apparel remains a growing premium category.'],
      segment_key: 'market',
      segment_reason: { source: 'deterministic' },
    },

    // Guard: Licensing should not be counted as market corroboration
    {
      source_document_id: 'doc-1',
      page_index: 24,
      slide_title: 'Licensing',
      bullets: ['Licensing partners and royalties'],
      segment_key: 'market',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const out = buildBusinessModelSummaryV1(nodes);

  assert.ok(out && out.value, 'expected a synthesized value');
  assert.ok(String(out.value).startsWith('Golf apparel brand'), `expected value to start with "Golf apparel brand", got: ${out.value}`);
  assert.match(out.value ?? '', /DTC/);
  assert.match(out.value ?? '', /wholesale/i);
  assert.doesNotMatch(out.value ?? '', /opportunity/i);
  assert.doesNotMatch(out.value ?? '', /industry/i);
  assert.doesNotMatch(out.value ?? '', /market-led/i);
  assert.doesNotMatch(out.value ?? '', /\bpartners\b/i);

  assert.deepEqual(out.derived_from.product_pages, [12, 13]);
  assert.deepEqual(out.derived_from.traction_pages, [8]);
  assert.deepEqual(out.derived_from.gtm_pages, [15, 22, 23]);

  // Market pages should only include category confirmation (not licensing)
  assert.deepEqual(out.derived_from.market_pages, [1]);

  // Supporting evidence should never include Capital Raise
  assert.ok(!out.supporting_nodes.some((n) => n.page_index === 19), 'Capital Raise should not be a supporting node');

  // Market slides must not affect the core identity phrase.
  const outNoMarket = buildBusinessModelSummaryV1(nodes.filter((n) => n.page_index !== 1));
  assert.ok(outNoMarket && outNoMarket.value);
  assert.equal(outNoMarket.value, out.value);

  assert.ok(out.confidence >= 0.70, `expected confidence >= 0.70, got ${out.confidence}`);
});
