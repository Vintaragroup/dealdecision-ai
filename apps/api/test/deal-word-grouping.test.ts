import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

function buildMockPool(handler: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: handler };
}

test('visual-assets group_word=1 returns grouped_visual_assets for structured Word blocks', async () => {
  const dealId = 'deal-word-1';
  const docId = '752c7cfd-efcd-4bed-b3ad-1a10a816d0de';

  const wordBlocks = Array.from({ length: 25 }).map((_, idx) => ({
    visual_asset_id: `va-word-${idx + 1}`,
    id: `va-word-${idx + 1}`,
    document_id: docId,
    deal_id: dealId,
    page_index: idx,
    bbox: null,
    image_uri: null,
    image_hash: null,
    created_at: `2026-01-10T00:00:${String(idx).padStart(2, '0')}.000Z`,
    asset_type: 'structured',
    confidence: '1',
    quality_flags: { source: 'structured_word', segment_key: 'product' },
    extractor_version: 'structured_native_v1',
    document_title: 'Word Doc',
    document_type: 'docx',
    document_status: 'ready',
    document_page_count: 25,
    evidence_count: 0,
    evidence_sample_snippets: [],
    has_extraction: true,
    structured_kind: null,
    structured_summary: null,
    ocr_text: null,
    ocr_blocks: null,
    units: null,
    structured_json: {
      kind: 'word_section',
      heading: idx === 0 ? 'Product' : null,
      paragraphs: idx === 24 ? [] : [`Product block ${idx + 1} text.`],
      text_snippet: idx === 24 ? '' : `Product block ${idx + 1} snippet`,
      segment_key: idx === 24 ? 'unknown' : 'product',
    },
  }));

  const pool = buildMockPool(async (sql: string, params?: unknown[]) => {
    const q = String(sql);

    if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };

    if (q.includes('information_schema.columns')) {
      const tableName = Array.isArray(params) ? params[0] : undefined;
      const columnName = Array.isArray(params) ? params[1] : undefined;

      // Allow visual_extractions extra columns.
      if (tableName === 'visual_extractions') return { rows: [{ ok: 1 }] };
      // Avoid document updates by pretending extraction_metadata absent.
      if (tableName === 'documents' && columnName === 'extraction_metadata') return { rows: [] };
      // Allow other optional columns.
      return { rows: [{ ok: 1 }] };
    }

    if (q.includes('SELECT id FROM deals') && q.includes('WHERE id = $1')) return { rows: [{ id: dealId }] };

    if (q.includes('FROM visual_assets va') && q.includes('latest_extraction')) return { rows: wordBlocks };

    return { rows: [] };
  });

  const app = Fastify({ logger: false });
  await registerDealRoutes(app as any, pool as any);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/visual-assets?group_word=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.ok(Array.isArray(body.visual_assets));
  assert.ok(Array.isArray(body.grouped_visual_assets), 'expected grouped_visual_assets array');

  // 24 non-empty blocks in the same segment should collapse to <= 8-per-group => 3 groups.
  assert.equal(body.grouped_visual_assets.length, 3);
  assert.ok(
    body.grouped_visual_assets.every((g: any) => g.segment_key === 'product'),
    'expected all groups segment_key=product'
  );

  assert.ok(body.warnings_counters, 'expected warnings_counters');
  assert.equal(body.warnings_counters.word_members_skipped_empty, 1);
  assert.equal(body.warnings_counters.word_groups_skipped_empty, 0);

  for (const g of body.grouped_visual_assets) {
    assert.equal(g.document_id, docId);
    assert.ok(typeof g.group_id === 'string' && g.group_id.includes(docId));
    assert.ok(Array.isArray(g.member_visual_asset_ids));
    assert.ok(typeof g.page_label === 'string' && /^product(?: \(part \d+\))?$/.test(g.page_label));
    assert.ok(g.page_label.trim().length > 0, 'expected non-empty page_label');
    assert.ok(typeof g.page_index === 'number' && Number.isFinite(g.page_index), 'expected numeric page_index');
    assert.ok(typeof g.captured_text === 'string');
    assert.ok(g.captured_text.length <= 1501);
    assert.equal(g.segment_key, 'product');
    assert.equal(g.effective_segment, 'product');
    assert.ok(typeof g.computed_segment === 'string' && g.computed_segment.length > 0, 'expected computed_segment');
    assert.ok(typeof g.segment_source === 'string' && g.segment_source.length > 0, 'expected segment_source');
    assert.ok(typeof g.segment_confidence === 'number', 'expected segment_confidence');
    assert.ok(Array.isArray(g.evidence_snippets));
    assert.ok(Array.isArray(g.evidence_asset_ids));
  }

});

test('lineage group_word=1 emits visual_asset_group nodes and suppresses raw word nodes unless debug_word_raw=1', async () => {
  const dealId = 'deal-word-2';
  const docId = '752c7cfd-efcd-4bed-b3ad-1a10a816d0de';

  const docs = [{ id: docId, title: 'Word Doc', type: 'docx', page_count: 25, uploaded_at: '2026-01-10T00:00:00.000Z' }];

  const visuals = Array.from({ length: 25 }).map((_, idx) => ({
    id: `va-word-${idx + 1}`,
    document_id: docId,
    page_index: idx,
    asset_type: 'structured',
    bbox: null,
    image_uri: null,
    image_hash: null,
    extractor_version: 'structured_native_v1',
    confidence: '1',
    quality_flags: { source: 'structured_word', segment_key: 'product' },
    created_at: `2026-01-10T00:00:${String(idx).padStart(2, '0')}.000Z`,
    evidence_count: 0,
    evidence_sample_snippets: [],
    ocr_text: null,
    ocr_blocks: null,
    structured_json: {
      kind: 'word_section',
      heading: idx === 0 ? 'Product' : null,
      paragraphs: idx === 24 ? [] : [`Product block ${idx + 1} text.`],
      text_snippet: idx === 24 ? '' : `Product block ${idx + 1} snippet`,
      segment_key: idx === 24 ? 'unknown' : 'product',
    },
    structured_summary: null,
    units: null,
    extraction_confidence: null,
    structured_kind: null,
    extraction_method: null,
  }));

  const pool = buildMockPool(async (sql: string, params?: unknown[]) => {
    const q = String(sql);
    const p0 = Array.isArray(params) ? params[0] : undefined;

    if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };

    if (q.includes('information_schema.columns')) {
      const tableName = Array.isArray(params) ? params[0] : undefined;
      const columnName = Array.isArray(params) ? params[1] : undefined;
      if (tableName === 'documents' && (columnName === 'updated_at' || columnName === 'extraction_metadata')) return { rows: [] };
      if (tableName === 'deals' && (columnName === 'lifecycle_status' || columnName === 'score')) return { rows: [{ ok: 1 }] };
      if (tableName === 'visual_extractions') return { rows: [{ ok: 1 }] };
      return { rows: [] };
    }

    if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
      assert.equal(p0, dealId);
      return { rows: [{ id: dealId, name: 'Deal', lifecycle_status: 'under_review', score: 50 }] };
    }

    if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
      assert.equal(p0, dealId);
      return { rows: docs };
    }

    if (q.includes('FROM visual_assets va') && q.includes('latest_extractions')) {
      assert.equal(p0, dealId);
      return { rows: visuals };
    }

    return { rows: [] };
  });

  const app = Fastify({ logger: false });
  await registerDealRoutes(app as any, pool as any);

  const resGrouped = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?group_word=1` });
  assert.equal(resGrouped.statusCode, 200);
  const bodyGrouped = resGrouped.json() as any;
  const nodesGrouped = Array.isArray(bodyGrouped.nodes) ? bodyGrouped.nodes : [];
  const edgesGrouped = Array.isArray(bodyGrouped.edges) ? bodyGrouped.edges : [];

  const groupNodes = nodesGrouped.filter((n: any) => String(n.type ?? n.kind ?? '').toLowerCase() === 'visual_asset_group');
  assert.ok(groupNodes.length > 0, 'expected visual_asset_group nodes');
  assert.equal(groupNodes.length, 3);

  const rogueEvidence = nodesGrouped.filter((n: any) => String(n?.id ?? n?.node_id ?? '').startsWith('evidence:group:'));
  assert.equal(rogueEvidence.length, 0, 'expected zero rogue evidence:group:* nodes');

  assert.ok(bodyGrouped.warnings_counters, 'expected warnings_counters');
  assert.equal(bodyGrouped.warnings_counters.word_members_skipped_empty, 1);
  assert.equal(bodyGrouped.warnings_counters.word_groups_skipped_empty, 0);

  for (const n of groupNodes) {
    assert.match(String(n.label ?? ''), /^product(?: \(part \d+\))?$/, 'expected group node label to be product or product (part N)');
    assert.ok(typeof n?.data?.page_label === 'string' && n.data.page_label.length > 0, 'expected group node data.page_label');
    assert.equal(n.data.page_label, n.label, 'expected data.page_label to equal node.label');
    assert.ok(typeof n?.data?.segment === 'string' && n.data.segment.length > 0, 'expected group node data.segment');
    assert.ok(
      typeof n?.data?.effective_segment === 'string' && n.data.effective_segment.length > 0,
      'expected group node data.effective_segment'
    );

    // Group-level segment + provenance comes from the enriched group object.
    assert.equal(n.data.segment, 'product');
    assert.equal(n.data.segment_source, 'persisted_v0');
  }

  const rawVisualNodes = nodesGrouped.filter((n: any) => String(n.type ?? n.kind ?? '').toLowerCase() === 'visual_asset');
  // Word blocks should be suppressed (non-word visuals absent in this fixture)
  assert.equal(rawVisualNodes.length, 0);

  const nodeIdSet = new Set(nodesGrouped.map((n: any) => String(n?.id ?? n?.node_id ?? '')));
  const dangling = edgesGrouped.filter((e: any) => !nodeIdSet.has(String(e?.source ?? '')) || !nodeIdSet.has(String(e?.target ?? '')));
  assert.equal(dangling.length, 0, 'expected zero dangling edges with group_word=1');

  const resWithRaw = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?group_word=1&debug_word_raw=1` });
  assert.equal(resWithRaw.statusCode, 200);
  const bodyWithRaw = resWithRaw.json() as any;
  const nodesWithRaw = Array.isArray(bodyWithRaw.nodes) ? bodyWithRaw.nodes : [];
  const rawNodes2 = nodesWithRaw.filter((n: any) => String(n.type ?? n.kind ?? '').toLowerCase() === 'visual_asset');
  assert.equal(rawNodes2.length, 25);

});

test('lineage defaults PPTX to JSON-first by grouping structured_native_v1 + vision_v1 slide assets', async () => {
  const dealId = 'deal-pptx-1';
  const docId = 'doc-pptx-1';

  const docs = [{ id: docId, title: 'Deck.pptx', type: 'pitch_deck', page_count: 12, uploaded_at: '2026-01-10T00:00:00.000Z' }];

  const visuals = [
    {
      id: 'va-pptx-structured-8',
      document_id: docId,
      page_index: 7,
      asset_type: 'image_text',
      bbox: null,
      image_uri: null,
      image_hash: null,
      extractor_version: 'structured_native_v1',
      confidence: '0.9',
      quality_flags: { source: 'structured_powerpoint' },
      created_at: '2026-01-10T00:00:00.000Z',
      evidence_count: 1,
      evidence_sample_snippets: ['Slide says risks are high'],
      ocr_text: null,
      ocr_blocks: null,
      structured_json: {
        kind: 'powerpoint_slide',
        title: 'Risks',
        bullets: ['Regulatory risk', 'Market risk'],
        text_snippet: 'Risks overview',
        notes: 'Add mitigation plan',
      },
      structured_summary: null,
      units: null,
      extraction_confidence: null,
      structured_kind: null,
      extraction_method: null,
    },
    {
      id: 'va-pptx-vision-8',
      document_id: docId,
      page_index: 7,
      asset_type: 'image',
      bbox: null,
      image_uri: '/tmp/page_008.png',
      image_hash: null,
      extractor_version: 'vision_v1',
      confidence: '0.7',
      quality_flags: { source: 'vision_rendered_slide' },
      created_at: '2026-01-10T00:00:01.000Z',
      evidence_count: 2,
      evidence_sample_snippets: ['OCR says risk', 'OCR says mitigation'],
      ocr_text: 'RISKS\nRegulatory risk\nMarket risk',
      ocr_blocks: null,
      structured_json: { segment_key: 'risks' },
      structured_summary: null,
      units: null,
      extraction_confidence: null,
      structured_kind: null,
      extraction_method: null,
    },
  ];

  const pool = buildMockPool(async (sql: string, params?: unknown[]) => {
    const q = String(sql);
    const p0 = Array.isArray(params) ? params[0] : undefined;

    if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };

    if (q.includes('information_schema.columns')) {
      const tableName = Array.isArray(params) ? params[0] : undefined;
      const columnName = Array.isArray(params) ? params[1] : undefined;
      if (tableName === 'documents' && (columnName === 'updated_at' || columnName === 'extraction_metadata')) return { rows: [] };
      if (tableName === 'deals' && (columnName === 'lifecycle_status' || columnName === 'score')) return { rows: [{ ok: 1 }] };
      if (tableName === 'visual_extractions') return { rows: [{ ok: 1 }] };
      return { rows: [] };
    }

    if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
      assert.equal(p0, dealId);
      return { rows: [{ id: dealId, name: 'Deal', lifecycle_status: 'under_review', score: 50 }] };
    }

    if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
      assert.equal(p0, dealId);
      return { rows: docs };
    }

    if (q.includes('FROM visual_assets va') && q.includes('latest_extractions')) {
      assert.equal(p0, dealId);
      return { rows: visuals };
    }

    return { rows: [] };
  });

  const app = Fastify({ logger: false });
  await registerDealRoutes(app as any, pool as any);

  const resGrouped = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(resGrouped.statusCode, 200);
  const bodyGrouped = resGrouped.json() as any;
  const nodesGrouped = Array.isArray(bodyGrouped.nodes) ? bodyGrouped.nodes : [];

  const pptxGroupNodes = nodesGrouped.filter((n: any) => String(n.type ?? n.kind ?? '').toLowerCase() === 'visual_asset_group');
  assert.equal(pptxGroupNodes.length, 1);
  assert.equal(pptxGroupNodes[0].node_type, 'VISUAL_ASSET_GROUP');
  assert.equal(pptxGroupNodes[0].data.asset_type, 'pptx_slide_group');
  assert.ok(Array.isArray(pptxGroupNodes[0].data.member_visual_asset_ids));
  assert.deepEqual(new Set(pptxGroupNodes[0].data.member_visual_asset_ids), new Set(['va-pptx-structured-8', 'va-pptx-vision-8']));
  assert.equal(pptxGroupNodes[0].data.structured_json?.kind, 'powerpoint_group');
  assert.equal(pptxGroupNodes[0].data.structured_json?.slide?.title, 'Risks');

  // Raw slide nodes should be suppressed by default.
  assert.ok(!nodesGrouped.some((n: any) => n.id === 'visual_asset:va-pptx-structured-8'));
  assert.ok(!nodesGrouped.some((n: any) => n.id === 'visual_asset:va-pptx-vision-8'));

  const resWithRaw = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_pptx_raw=1` });
  assert.equal(resWithRaw.statusCode, 200);
  const bodyWithRaw = resWithRaw.json() as any;
  const nodesWithRaw = Array.isArray(bodyWithRaw.nodes) ? bodyWithRaw.nodes : [];
  assert.ok(nodesWithRaw.some((n: any) => n.id === 'visual_asset:va-pptx-structured-8'));
  assert.ok(nodesWithRaw.some((n: any) => n.id === 'visual_asset:va-pptx-vision-8'));

  await app.close();
});
