import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMarketSummaryV1 } from '../lib/reports/canonical-summaries';

test('market_summary_v1 is market-only and Palm-like (participation growth; not company)', () => {
  const nodes = [
    {
      source_document_id: 'doc-1',
      page_index: 1,
      slide_title: 'Industry Outlook',
      bullets: ['Golf participation is growing, expanding the premium apparel category.'],
      segment_key: 'market',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 4,
      slide_title: 'Market Dynamics',
      bullets: ['Premium consumer demand is shifting toward performance lifestyle apparel.'],
      segment_key: 'market',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const out = buildMarketSummaryV1(nodes as any);
  assert.ok(out && out.value);
  assert.match(out.value, /golf participation/i);
  assert.doesNotMatch(out.value, /\bpalm\b/i);
  assert.doesNotMatch(out.value, /\bwe\b|\bour\b/i);
  assert.ok(out.confidence >= 0.75);
});

test('market_summary_v1 is optional for compliance decks and does not backfill', () => {
  const nodes = [
    {
      source_document_id: 'doc-1',
      page_index: 1,
      slide_title: 'Compliance Controls',
      bullets: ['Audit controls and policy coverage across regulated workflows.'],
      segment_key: 'operations',
      segment_reason: { source: 'deterministic' },
    },
    {
      source_document_id: 'doc-1',
      page_index: 2,
      slide_title: 'Security & Privacy',
      bullets: ['SOC 2 alignment and GDPR readiness.'],
      segment_key: 'operations',
      segment_reason: { source: 'deterministic' },
    },
  ];

  const out = buildMarketSummaryV1(nodes as any);
  assert.equal(out, null);
});
