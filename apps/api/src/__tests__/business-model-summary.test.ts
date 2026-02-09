import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBusinessModelSummaryV1, type SegmentedNode } from '../lib/reports/business-model-summary';

test('business_model_summary_v1 (runner wrapper)', () => {
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
  ];

  const out = buildBusinessModelSummaryV1(nodes);
  assert.ok(out && out.value);
  assert.ok(String(out.value).startsWith('Golf apparel brand'));
  assert.match(out.value ?? '', /DTC/);
  assert.match(out.value ?? '', /wholesale/i);
  assert.match(out.value ?? '', /apparel/i);
  assert.ok(out.confidence >= 0.65);

  // Distribution slides contribute to GTM derived_from for business model summary.
  assert.deepEqual(out.derived_from.product_pages, [12, 13]);
  assert.deepEqual(out.derived_from.gtm_pages, [15, 22, 23]);
  assert.deepEqual(out.derived_from.traction_pages, [8]);
});
