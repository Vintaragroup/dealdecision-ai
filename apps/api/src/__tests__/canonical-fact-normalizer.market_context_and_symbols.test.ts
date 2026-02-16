import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCanonicalFact } from '../lib/canonical/canonical-fact-normalizer';
import { compileDealSummaryV1 } from '../lib/deal-summary-v1';
import type { SegmentedDealNode } from '../lib/segmented-nodes-for-deal';

function makeNode(partial: Partial<SegmentedDealNode> & Pick<SegmentedDealNode, 'node_id' | 'document_id' | 'source_document_id' | 'page_index' | 'slide_title' | 'bullets' | 'bullets_snippet' | 'segment_key'>): SegmentedDealNode {
  return {
    node_id: partial.node_id,
    document_id: partial.document_id,
    source_document_id: partial.source_document_id,
    page_index: partial.page_index,
    slide_title: partial.slide_title,
    bullets: partial.bullets,
    bullets_snippet: partial.bullets_snippet,
    visual_asset_id: partial.visual_asset_id ?? null,
    segment_key: partial.segment_key,
    structured_segment_key_raw: partial.structured_segment_key_raw ?? null,
    quality_flags_segment_key_raw: partial.quality_flags_segment_key_raw ?? null,
    segment_reason:
      partial.segment_reason ??
      ({
        rules_hit: ['test'],
        keywords_hit: [],
        classifier_confidence: 1,
        source: 'deterministic',
      } as any),
  };
}

test('market_context clause miner selects a coherent GTM clause and tags rule', async () => {
  const mixed =
    'Organic 2. Content, 3. B2B2C | By harnessing partners into a network-building content engine, retention is growing organically and distribution is expanding.';

  const nodes: SegmentedDealNode[] = [
    makeNode({
      node_id: 'doc1:3',
      document_id: 'doc1',
      source_document_id: 'doc1',
      page_index: 3,
      slide_title: 'Go to Market',
      bullets: [mixed],
      bullets_snippet: mixed,
      segment_key: 'go_to_market',
    }),
  ];

  const out = await compileDealSummaryV1(null as any, 'deal1', { prefetched: { nodes, warnings: [] } } as any);

  assert.ok(out.market_context);
  assert.ok(out.market_context.display_text);
  assert.ok(out.meta?.market_context?.canonical?.rules_applied?.includes('market_context_clause_miner_v1'));
  assert.ok(!out.market_context.suppressed_reasons.includes('not_coherent_sentence_like'));
  assert.ok(!out.market_context.suppressed_reasons.includes('no_coherent_clause_found'));
});

test('market_context candidate ranking hardening: incoherent OCR junk is not selected (prefer missing)', async () => {
  const junk = 'S NA Beverage Consumption ma / } UR ae f A, U.';

  const nodes: SegmentedDealNode[] = [
    makeNode({
      node_id: 'doc2:7',
      document_id: 'doc2',
      source_document_id: 'doc2',
      page_index: 7,
      slide_title: 'Market',
      bullets: [junk],
      bullets_snippet: junk,
      segment_key: 'market',
    }),
  ];

  const out = await compileDealSummaryV1(null as any, 'deal2', { prefetched: { nodes, warnings: [] } } as any);

  assert.equal(out.market_context, null);
});

test('market_target symbol-lightening removes pipe/glyph artifacts but preserves KPI units', () => {
  const raw = '| a Powering Every Shared Payment Market | shared payment market with TAM €15.5B and 10% penetration • • — ©';
  const out = normalizeCanonicalFact(raw, { kind: 'market_target', maxLen: 220 });

  assert.ok(out.display_text);
  assert.ok(out.meta.rules_applied.includes('market_target_symbol_lighten_v1'));
  assert.match(out.display_text, /€15\.5B/);
  assert.match(out.display_text, /10%/);
  assert.ok(!out.suppressed_reasons.includes('too_many_symbols'));
});

test('market_target symbol-lightening safety: does not shorten mostly-symbol inputs into false positives', () => {
  const raw = '||||| • • • — — — © ™ …';
  const out = normalizeCanonicalFact(raw, { kind: 'market_target', maxLen: 220 });

  assert.equal(out.display_text, null);
  assert.ok(!out.meta.rules_applied.includes('market_target_symbol_lighten_v1'));
});
