import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProductSummaryV1 } from '../lib/reports/canonical-summaries';

test('product_summary_v1 is node-first and Palm-like (apparel + gloves + accessories; no TAM)', () => {
  const nodes = [
    {
      source_document_id: 'doc-1',
      page_index: 12,
      slide_title: 'Product',
      bullets: ['Premium golf apparel designed for performance and lifestyle, including gloves and accessories.'],
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
      page_index: 8,
      slide_title: 'Traction',
      bullets: ['Wholesale accounts growing (46 accounts) alongside DTC conversion gains.'],
      segment_key: 'traction',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const out = buildProductSummaryV1(nodes as any);
  assert.ok(out && out.value);
  assert.match(out.value, /apparel/i);
  assert.match(out.value, /gloves/i);
  assert.match(out.value, /accessories/i);
  assert.doesNotMatch(out.value, /tam|sam|som|cagr|market size/i);

  assert.ok(out.confidence >= 0.75);
  assert.ok(out.confidence <= 0.85);
  assert.deepEqual(out.derived_from.product_pages, [12, 13]);
});

test('product_summary_v1 supports roll-up decks (multi-entity aggregation)', () => {
  const nodes = [
    {
      source_document_id: 'doc-1',
      page_index: 2,
      slide_title: 'Roll-up Strategy',
      bullets: ['Buy and build portfolio through acquisitions.'],
      segment_key: 'product',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 3,
      slide_title: 'Targets',
      bullets: ['Acquire Alpha Plumbing and Beta HVAC as initial operating companies.'],
      segment_key: 'product',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const out = buildProductSummaryV1(nodes as any);
  assert.ok(out && out.value);
  assert.match(out.value, /roll-up|rollup/i);
  assert.match(out.value, /Alpha|Beta/);
});
