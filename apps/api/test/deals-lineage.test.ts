process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/deals/:dealId/lineage returns deal+docs and warnings when visual tables missing', async () => {
  const dealId = 'deal-1';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        // Simulate missing visual tables
        return { rows: [{ oid: null }] };
      }

      if (q.includes('information_schema.columns')) {
        // Feature detection via hasColumn(...)
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && columnName === 'ocr_blocks') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (q.includes('SELECT id, name FROM deals WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Demo Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-1',
              title: 'Pitch Deck',
              type: 'pitch_deck',
              page_count: 12,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        throw new Error('visual_assets should not be queried when tables missing');
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.ok(Array.isArray(body.nodes));
  assert.ok(Array.isArray(body.edges));
  assert.ok(Array.isArray(body.warnings));
  assert.ok(body.warnings.length >= 1);

  // Deal + 1 doc
  assert.ok(body.nodes.find((n: any) => n.id === `deal:${dealId}` && n.type === 'deal' && n.node_type === 'DEAL'));
  assert.ok(body.nodes.find((n: any) => n.id === 'document:doc-1' && n.type === 'document' && n.node_type === 'DOCUMENT'));

  const dealToDocEdges = body.edges.filter((e: any) => e.source === `deal:${dealId}` && e.target === 'document:doc-1');
  assert.equal(dealToDocEdges.length, 1);
  assert.equal(dealToDocEdges[0].edge_type, 'HAS_DOCUMENT');

  await app.close();
});

test('GET /api/deals/:dealId/lineage returns deal+docs when visuals tables exist but no assets', async () => {
  const dealId = 'deal-2';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && columnName === 'ocr_blocks') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        return { rows: [{ id: dealId, name: 'No Visuals Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            {
              id: 'doc-2',
              title: 'Financials',
              type: 'financials',
              page_count: 3,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.warnings.length, 0, `unexpected warnings: ${JSON.stringify(body.warnings)}`);

  assert.ok(body.nodes.find((n: any) => n.id === `deal:${dealId}` && n.node_type === 'DEAL'));
  assert.ok(body.nodes.find((n: any) => n.id === 'document:doc-2' && n.node_type === 'DOCUMENT'));

  const dealToDocEdges = body.edges.filter((e: any) => e.source === `deal:${dealId}` && e.target === 'document:doc-2');
  assert.equal(dealToDocEdges.length, 1);
  assert.equal(dealToDocEdges[0].edge_type, 'HAS_DOCUMENT');

  // No visual asset nodes
  assert.equal(body.nodes.filter((n: any) => String(n.id).startsWith('visual_asset:')).length, 0);
  assert.equal(body.nodes.filter((n: any) => String(n.id).startsWith('evidence:')).length, 0);

  await app.close();
});

test('GET /api/deals/:dealId/lineage returns visuals + evidence aggregate nodes', async () => {
  const dealId = 'deal-3';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && columnName === 'ocr_blocks') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        return { rows: [{ id: dealId, name: 'Visual Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            {
              id: 'doc-3',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 10,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-1',
              document_id: 'doc-3',
              page_index: 0,
              asset_type: 'chart',
              bbox: { x: 0, y: 0, w: 1, h: 1 },
              image_uri: '/tmp/page_001_raw.png',
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.7',
              quality_flags: {},
              created_at: '2026-01-05T00:00:00.000Z',
              ocr_text: 'Revenue growth accelerated across 2024 and 2025, with strong net retention and improving gross margin.',
              structured_json: JSON.stringify({
                table: {
                  rows: [
                    ['Year', 'Revenue'],
                    ['2024', '10'],
                    ['2025', '18'],
                  ],
                  method: 'grid_lines_v1',
                  confidence: 0.9,
                },
              }),
              units: 'USD',
              extraction_confidence: '0.65',
              extraction_method: 'vision_v1',
              evidence_count: 2,
              evidence_sample_snippets: ['Snippet 1', 'Snippet 2'],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.warnings.length, 0, `unexpected warnings: ${JSON.stringify(body.warnings)}`);

  const visualNode = body.nodes.find((n: any) => n.id === `visual_asset:va-1` && n.type === 'visual_asset' && n.node_type === 'VISUAL_ASSET');
  assert.ok(visualNode);
  assert.ok(typeof visualNode.data?.ocr_text_snippet === 'string');
  assert.ok(visualNode.data.ocr_text_snippet.length <= 140);
  assert.equal(visualNode.data.structured_kind, 'table');
  assert.equal(visualNode.data.structured_summary?.table?.rows, 3);
  assert.equal(visualNode.data.structured_summary?.table?.cols, 2);
  assert.equal(visualNode.data.structured_summary?.method, 'grid_lines_v1');
  assert.equal(visualNode.data.structured_summary?.confidence, 0.9);
  assert.equal(visualNode.data.evidence_count, 2);
  assert.ok(Array.isArray(visualNode.data.evidence_snippets));
  assert.equal(visualNode.data.evidence_snippets.length, 2);
  // Prefer structured_json.table.confidence over ve.confidence
  assert.equal(visualNode.data.extraction_confidence, 0.9);
  assert.equal(visualNode.data.extraction_method, 'vision_v1');
  assert.ok(visualNode.data.page_understanding);

  // Segment provenance is always present (debug-only details remain gated).
  assert.equal(visualNode.data.segment, visualNode.data.effective_segment);
  assert.ok(typeof visualNode.data.computed_segment === 'string');
  assert.equal(visualNode.data.computed_segment, visualNode.data.segment);
  assert.ok(typeof visualNode.data.segment_source === 'string');
  assert.equal(visualNode.data.persisted_segment_key ?? null, null);
  assert.ok(typeof visualNode.data.page_understanding.summary === 'string');
  assert.ok(visualNode.data.page_understanding.summary.length > 0);
  assert.ok(Array.isArray(visualNode.data.page_understanding.key_points));
  assert.ok(Array.isArray(visualNode.data.page_understanding.extracted_signals));
  assert.ok(Array.isArray(visualNode.data.page_understanding.score_contributions));

  assert.ok(body.nodes.find((n: any) => n.id === `evidence:va-1` && n.type === 'evidence' && n.node_type === 'EVIDENCE'));

  const segKey = visualNode.data.segment;
  const segNodeId = `segment:${dealId}:doc-3:${segKey}`;
  assert.ok(body.nodes.find((n: any) => n.id === segNodeId && n.type === 'segment' && n.node_type === 'SEGMENT'));
  assert.ok(body.edges.find((e: any) => e.source === `document:doc-3` && e.target === segNodeId && e.edge_type === 'HAS_SEGMENT'));
  assert.ok(body.edges.find((e: any) => e.source === segNodeId && e.target === `visual_asset:va-1` && e.edge_type === 'HAS_VISUAL_ASSET'));
  assert.ok(body.edges.find((e: any) => e.source === `visual_asset:va-1` && e.target === `evidence:va-1` && e.edge_type === 'HAS_EVIDENCE'));

  await app.close();
});

test('GET /api/deals/:dealId/lineage derives slide_title from OCR blocks and avoids brand lines', async () => {
  const dealId = 'deal-3-title';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && columnName === 'ocr_blocks') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        // Deal name intentionally matches the brand line in OCR.
        return { rows: [{ id: dealId, name: 'WebMax Digital Mortgage Solutions' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-title-1',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 3,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-title-1',
              document_id: 'doc-title-1',
              page_index: 0,
              asset_type: 'slide',
              bbox: { x: 0, y: 0, w: 1, h: 1 },
              image_uri: '/tmp/page_001_raw.png',
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.7',
              quality_flags: {},
              created_at: '2026-01-05T00:00:00.000Z',

              ocr_text: 'WebMax DIGITAL MORTGAGE SOLUTIONS\nMARKET PROBLEM\nInterest rates are volatile',
              ocr_blocks: [
                { text: 'WebMax', bbox: { x: 0.05, y: 0.04, w: 0.2, h: 0.03 } },
                { text: 'DIGITAL', bbox: { x: 0.26, y: 0.04, w: 0.18, h: 0.03 } },
                { text: 'MORTGAGE', bbox: { x: 0.45, y: 0.04, w: 0.22, h: 0.03 } },
                { text: 'SOLUTIONS', bbox: { x: 0.68, y: 0.04, w: 0.25, h: 0.03 } },
                { text: 'MARKET', bbox: { x: 0.10, y: 0.11, w: 0.30, h: 0.06 } },
                { text: 'PROBLEM', bbox: { x: 0.42, y: 0.11, w: 0.34, h: 0.06 } },
              ],
              structured_json: null,
              units: null,
              extraction_confidence: '0.65',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find(
    (n: any) => n.id === `visual_asset:va-title-1` && n.type === 'visual_asset' && n.node_type === 'VISUAL_ASSET'
  );
  assert.ok(visualNode);
  assert.equal(visualNode.data.slide_title, 'MARKET PROBLEM');
  assert.equal(visualNode.data.slide_title_source, 'ocr_layout_v1');

  await app.close();
});

test('classifies early brand-only slide as overview (not solution)', async () => {
  const dealId = 'deal-seg-1';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'WebMax Digital Mortgage Solutions' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-seg-1', title: 'Deck', type: 'pitch_deck', page_count: 5, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        return {
          rows: [
            {
              id: 'va-seg-1',
              document_id: 'doc-seg-1',
              page_index: 0,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.5',
              quality_flags: {},
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: 'WebMax Digital Mortgage Solutions',
              ocr_blocks: null,
              structured_json: null,
              units: null,
              extraction_confidence: '0.4',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find((n: any) => n.id === 'visual_asset:va-seg-1');
  assert.ok(visualNode, 'visual node missing');
  assert.equal(visualNode.data.segment, 'unknown');

  await app.close();
});

test('early generic platform wording stays overview unless reinforced', async () => {
  const dealId = 'deal-seg-2';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Demo Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-seg-2', title: 'Deck', type: 'pitch_deck', page_count: 5, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        return {
          rows: [
            {
              id: 'va-seg-2',
              document_id: 'doc-seg-2',
              page_index: 1,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.5',
              quality_flags: {},
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: 'Our platform workflow enables better collaboration',
              ocr_blocks: null,
              structured_json: null,
              units: null,
              extraction_confidence: '0.4',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find((n: any) => n.id === 'visual_asset:va-seg-2');
  assert.ok(visualNode, 'visual node missing');
  assert.equal(visualNode.data.segment, 'unknown');

  await app.close();
});

test('early market slide with TAM wins over solution bias', async () => {
  const dealId = 'deal-seg-3';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Demo Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-seg-3', title: 'Deck', type: 'pitch_deck', page_count: 8, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        return {
          rows: [
            {
              id: 'va-seg-3',
              document_id: 'doc-seg-3',
              page_index: 1,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.5',
              quality_flags: {},
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: 'Market TAM $10B with SAM $2B and SOM $400M',
              ocr_blocks: null,
              structured_json: null,
              units: null,
              extraction_confidence: '0.4',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find((n: any) => n.id === 'visual_asset:va-seg-3');
  assert.ok(visualNode, 'visual node missing');
  assert.equal(visualNode.data.segment, 'market');

  await app.close();
});

test('table slides map to financials even with solution words', async () => {
  const dealId = 'deal-seg-4';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Demo Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-seg-4', title: 'Deck', type: 'pitch_deck', page_count: 8, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        return {
          rows: [
            {
              id: 'va-seg-4',
              document_id: 'doc-seg-4',
              page_index: 4,
              asset_type: 'chart',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.5',
              quality_flags: {},
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: 'Platform revenue forecast and margin',
              ocr_blocks: null,
              structured_json: JSON.stringify({ table: { rows: [['Year', 'Revenue'], ['2025', '10']], method: 'grid_lines_v1', confidence: 0.9 } }),
              units: 'USD',
              extraction_confidence: '0.4',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find((n: any) => n.id === 'visual_asset:va-seg-4');
  assert.ok(visualNode, 'visual node missing');
  assert.equal(visualNode.data.segment, 'financials');

  await app.close();
});

test('ambiguous later slide becomes overview when only a title is present', async () => {
  const dealId = 'deal-seg-5';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Demo Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-seg-5', title: 'Deck', type: 'pitch_deck', page_count: 8, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        return {
          rows: [
            {
              id: 'va-seg-5',
              document_id: 'doc-seg-5',
              page_index: 5,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.5',
              quality_flags: {},
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: 'Section header and intro',
              ocr_blocks: null,
              structured_json: null,
              units: null,
              extraction_confidence: '0.4',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find((n: any) => n.id === 'visual_asset:va-seg-5');
  assert.ok(visualNode, 'visual node missing');
  assert.equal(visualNode.data.segment, 'unknown');

  await app.close();
});

  test('repeating brand headers are blacklisted; real slide headers are chosen', async () => {
    const dealId = 'deal-brand-1';

    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        const q = String(sql);
        const p0 = Array.isArray(params) ? params[0] : undefined;

        if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
        if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

        if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
          assert.equal(p0, dealId);
          return { rows: [{ id: dealId, name: 'WebMax Digital Mortgage Solutions' }] };
        }

        if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
          return {
            rows: [
              { id: 'doc-brand-1', title: 'Deck', type: 'pitch_deck', page_count: 5, uploaded_at: '2026-01-01T00:00:00.000Z' },
            ],
          };
        }

        if (q.includes('FROM visual_assets')) {
          return {
            rows: [
              {
                id: 'va-brand-0',
                document_id: 'doc-brand-1',
                page_index: 0,
                asset_type: 'slide',
                bbox: {},
                image_uri: null,
                image_hash: null,
                extractor_version: 'vision_v1',
                confidence: '0.5',
                quality_flags: {},
                created_at: '2026-01-01T00:00:00.000Z',
                ocr_text: 'Digital Mortgage Solutions\nwww.WebMaxCo.com',
                ocr_blocks: null,
                structured_json: null,
                units: null,
                extraction_confidence: '0.4',
                extraction_method: 'vision_v1',
                evidence_count: 0,
                evidence_sample_snippets: [],
              },
              {
                id: 'va-brand-1',
                document_id: 'doc-brand-1',
                page_index: 1,
                asset_type: 'slide',
                bbox: {},
                image_uri: null,
                image_hash: null,
                extractor_version: 'vision_v1',
                confidence: '0.5',
                quality_flags: {},
                created_at: '2026-01-01T00:00:00.000Z',
                ocr_text: 'Digital Mortgage Solutions',
                ocr_blocks: null,
                structured_json: null,
                units: null,
                extraction_confidence: '0.4',
                extraction_method: 'vision_v1',
                evidence_count: 0,
                evidence_sample_snippets: [],
              },
              {
                id: 'va-brand-2',
                document_id: 'doc-brand-1',
                page_index: 2,
                asset_type: 'slide',
                bbox: {},
                image_uri: null,
                image_hash: null,
                extractor_version: 'vision_v1',
                confidence: '0.5',
                quality_flags: {},
                created_at: '2026-01-01T00:00:00.000Z',
                ocr_text: 'WHY THIS MATTERS\nDigital Mortgage Solutions',
                ocr_blocks: null,
                structured_json: null,
                units: null,
                extraction_confidence: '0.4',
                extraction_method: 'vision_v1',
                evidence_count: 0,
                evidence_sample_snippets: [],
              },
              {
                id: 'va-brand-3',
                document_id: 'doc-brand-1',
                page_index: 3,
                asset_type: 'slide',
                bbox: {},
                image_uri: null,
                image_hash: null,
                extractor_version: 'vision_v1',
                confidence: '0.5',
                quality_flags: {},
                created_at: '2026-01-01T00:00:00.000Z',
                ocr_text: 'MARKET PROBLEM\nDigital Mortgage Solutions',
                ocr_blocks: null,
                structured_json: null,
                units: null,
                extraction_confidence: '0.4',
                extraction_method: 'vision_v1',
                evidence_count: 0,
                evidence_sample_snippets: [],
              },
              {
                id: 'va-brand-4',
                document_id: 'doc-brand-1',
                page_index: 4,
                asset_type: 'chart',
                bbox: {},
                image_uri: null,
                image_hash: null,
                extractor_version: 'vision_v1',
                confidence: '0.5',
                quality_flags: {},
                created_at: '2026-01-01T00:00:00.000Z',
                ocr_text: 'Revenue forecast table\nDigital Mortgage Solutions',
                ocr_blocks: null,
                structured_json: JSON.stringify({ table: { rows: [['Year', 'Revenue'], ['2025', '10']], method: 'grid_lines_v1', confidence: 0.9 } }),
                units: 'USD',
                extraction_confidence: '0.4',
                extraction_method: 'vision_v1',
                evidence_count: 0,
                evidence_sample_snippets: [],
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${q}`);
      },
    } as any;

    const app = Fastify();
    await registerDealRoutes(app, mockPool);

    const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    const getNode = (vid: string) => body.nodes.find((n: any) => n.id === `visual_asset:${vid}`);
    assert.equal(getNode('va-brand-0').data.slide_title, null);
    assert.equal(getNode('va-brand-1').data.slide_title, null);
    assert.equal(getNode('va-brand-2').data.slide_title, 'WHY THIS MATTERS');
    assert.equal(getNode('va-brand-3').data.slide_title, 'MARKET PROBLEM');
    assert.equal(getNode('va-brand-4').data.slide_title, 'Revenue forecast table');

    await app.close();
  });

test('layout-aware titles ignore repeated logo and drive segments', async () => {
  const dealId = 'deal-brand-layout';

  const makeSlide = (id: string, page_index: number, title?: string) => {
    const brandBlock = { text: 'Acme Corp', bbox: { x: 0.82, y: 0.03, w: 0.14, h: 0.03 } };
    const titleBlock = title ? { text: title, bbox: { x: 0.18, y: 0.12, w: 0.62, h: 0.08 } } : null;
    const ocr_blocks = titleBlock ? [brandBlock, titleBlock] : [brandBlock];
    const ocr_text = title ? `${title}\nAcme Corp` : 'Acme Corp';
    return {
      id,
      document_id: 'doc-brand-layout',
      page_index,
      asset_type: 'slide',
      bbox: {},
      image_uri: null,
      image_hash: null,
      extractor_version: 'vision_v1',
      confidence: '0.7',
      quality_flags: {},
      created_at: '2026-01-05T00:00:00.000Z',
      ocr_text,
      ocr_blocks,
      structured_json: null,
      units: null,
      extraction_confidence: '0.5',
      extraction_method: 'vision_v1',
      evidence_count: 0,
      evidence_sample_snippets: [],
    };
  };

  const slides = [
    makeSlide('va-layout-0', 0),
    makeSlide('va-layout-1', 1, 'Market Problem'),
    makeSlide('va-layout-2', 2, 'Solution'),
    makeSlide('va-layout-3', 3, 'Traction'),
    makeSlide('va-layout-4', 4, 'Business Model'),
    makeSlide('va-layout-5', 5, 'Exit Strategy'),
    makeSlide('va-layout-6', 6, 'Call to Action'),
    makeSlide('va-layout-7', 7),
    makeSlide('va-layout-8', 8),
    makeSlide('va-layout-9', 9, 'Financials Overview'),
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Acme Corp' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-brand-layout', title: 'Deck', type: 'pitch_deck', page_count: 10, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return { rows: slides };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const getNode = (vid: string) => body.nodes.find((n: any) => n.id === `visual_asset:${vid}`);

  const brandOnly = getNode('va-layout-0');
  assert.ok(brandOnly);
  assert.equal(brandOnly.data.slide_title, null);

  const problemNode = getNode('va-layout-1');
  assert.ok(problemNode.data.slide_title_confidence >= 0.6);
  assert.ok(['problem', 'market'].includes(problemNode.data.segment));

  const solutionNode = getNode('va-layout-2');
  assert.equal(solutionNode.data.slide_title, 'Solution');
  assert.ok(solutionNode.data.slide_title_confidence >= 0.6);
  assert.equal(solutionNode.data.segment, 'solution');

  const tractionNode = getNode('va-layout-3');
  assert.equal(tractionNode.data.slide_title, 'Traction');
  assert.ok(tractionNode.data.segment === 'traction');

  const businessModelNode = getNode('va-layout-4');
  assert.equal(businessModelNode.data.slide_title, 'Business Model');
  assert.equal(businessModelNode.data.segment, 'business_model');

  const exitNode = getNode('va-layout-5');
  assert.equal(exitNode.data.segment, 'exit');
  assert.ok(exitNode.data.slide_title_confidence >= 0.6);

  const ctaNode = getNode('va-layout-6');
  assert.equal(ctaNode.data.slide_title, 'Call to Action');
  assert.ok(ctaNode.data.slide_title_confidence >= 0.5);

  await app.close();
});

test('GET /api/deals/:dealId/lineage falls back to OCR when evidence links have no snippet', async () => {
  const dealId = 'deal-4';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && columnName === 'ocr_blocks') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        return { rows: [{ id: dealId, name: 'Evidence Snippet Fallback Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            {
              id: 'doc-4',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 2,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-2',
              document_id: 'doc-4',
              page_index: 0,
              asset_type: 'table',
              bbox: { x: 0, y: 0, w: 1, h: 1 },
              image_uri: '/tmp/page_001_raw.png',
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.7',
              quality_flags: {},
              created_at: '2026-01-05T00:00:00.000Z',
              ocr_text: 'This is OCR text that should be used as evidence fallback when snippet is missing.',
              structured_json: JSON.stringify({}),
              units: null,
              extraction_confidence: '0.65',
              extraction_method: 'vision_v1',
              evidence_count: 1,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const visualNode = body.nodes.find((n: any) => n.id === `visual_asset:va-2`);
  assert.ok(visualNode);
  assert.equal(visualNode.data.evidence_count, 1);
  assert.ok(Array.isArray(visualNode.data.evidence_snippets));
  assert.ok(visualNode.data.evidence_snippets.length >= 1);
  assert.ok(typeof visualNode.data.evidence_snippets[0] === 'string');
  assert.ok(visualNode.data.evidence_snippets[0].length > 0);

  await app.close();
});

test('GET /api/deals/:dealId/lineage includes one DEAL node and N DEAL->DOCUMENT edges', async () => {
  const dealId = 'deal-edges';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        // Simulate missing visual tables (edge behavior should still hold)
        return { rows: [{ oid: null }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && columnName === 'ocr_blocks') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (q.includes('SELECT') && q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Edge Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            { id: 'doc-a', title: 'A', type: 'memo', page_count: 1, uploaded_at: '2026-01-02T00:00:00.000Z' },
            { id: 'doc-b', title: 'B', type: 'memo', page_count: 1, uploaded_at: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const dealNodes = body.nodes.filter((n: any) => n.id === `deal:${dealId}` && n.node_type === 'DEAL');
  assert.equal(dealNodes.length, 1);

  const docNodes = body.nodes.filter((n: any) => String(n.id).startsWith('document:'));
  assert.equal(docNodes.length, 2);

  const dealDocEdges = body.edges.filter((e: any) => e.source === `deal:${dealId}` && String(e.target).startsWith('document:'));
  assert.equal(dealDocEdges.length, 2);
  for (const e of dealDocEdges) assert.equal(e.edge_type, 'HAS_DOCUMENT');

  await app.close();
});

test('segment classifier promotes well-labeled headings and limits unknown', async () => {
  const dealId = 'deal-seg-headings';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;
        if (tableName === 'visual_extractions' && ['ocr_blocks', 'units', 'extraction_confidence', 'structured_kind', 'structured_summary'].includes(String(columnName))) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Seg Demo' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-seg', title: 'Deck', type: 'pitch_deck', page_count: 6, uploaded_at: '2026-01-02T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-dist',
              document_id: 'doc-seg',
              page_index: 0,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.8',
              quality_flags: {},
              created_at: '2026-01-05T00:00:00.000Z',
              ocr_text: 'Distribution and GTM channels for enterprise',
              structured_json: {},
              units: null,
              extraction_confidence: '0.7',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 1,
              evidence_sample_snippets: ['Distribution plan and go-to-market channels'],
            },
            {
              id: 'va-bm',
              document_id: 'doc-seg',
              page_index: 1,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.8',
              quality_flags: {},
              created_at: '2026-01-05T00:00:01.000Z',
              ocr_text: 'Business Model and pricing tiers',
              structured_json: {},
              units: null,
              extraction_confidence: '0.7',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 1,
              evidence_sample_snippets: ['Business model and revenue model overview'],
            },
            {
              id: 'va-exit',
              document_id: 'doc-seg',
              page_index: 2,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.8',
              quality_flags: {},
              created_at: '2026-01-05T00:00:02.000Z',
              ocr_text: 'Exit Strategy and M&A options',
              structured_json: {},
              units: null,
              extraction_confidence: '0.7',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 1,
              evidence_sample_snippets: ['Exit strategy with strategic acquisition paths'],
            },
            {
              id: 'va-why',
              document_id: 'doc-seg',
              page_index: 3,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.8',
              quality_flags: {},
              created_at: '2026-01-05T00:00:03.000Z',
              ocr_text: 'Why this matters: our solution solves compliance gaps for banks',
              structured_json: {},
              units: null,
              extraction_confidence: '0.7',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 1,
              evidence_sample_snippets: ['Why this matters: solving a critical compliance problem'],
            },
            {
              id: 'va-brand',
              document_id: 'doc-seg',
              page_index: 4,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.8',
              quality_flags: {},
              created_at: '2026-01-05T00:00:04.000Z',
              ocr_text: 'ACME ACME',
              structured_json: {},
              units: null,
              extraction_confidence: '0.7',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-table',
              document_id: 'doc-seg',
              page_index: 5,
              asset_type: 'chart',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.8',
              quality_flags: {},
              created_at: '2026-01-05T00:00:05.000Z',
              ocr_text: 'Income statement table',
              structured_json: {
                table: {
                  rows: [
                    ['Year', 'Revenue'],
                    ['2024', '10'],
                    ['2025', '20'],
                  ],
                  method: 'grid',
                  confidence: 0.9,
                },
              },
              units: 'USD',
              extraction_confidence: '0.7',
              structured_kind: 'table',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  // By default, segment_debug is omitted (even in dev) to keep payloads small.
  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const getSeg = (id: string) => {
    const node = body.nodes.find((n: any) => n.id === `visual_asset:${id}`);
    return node?.data?.segment;
  };

  assert.equal(getSeg('va-dist'), 'distribution');
  assert.equal(getSeg('va-bm'), 'business_model');
  assert.equal(getSeg('va-exit'), 'exit');
  assert.equal(getSeg('va-why'), 'solution');

  const brandSeg = getSeg('va-brand');
  assert.ok(['overview', 'unknown'].includes(brandSeg));

  assert.equal(getSeg('va-table'), 'financials');

  // Even without debug flags, computed/effective/provenance fields should exist.
  const sampleNode = body.nodes.find((n: any) => n.id === 'visual_asset:va-dist')?.data;
  assert.ok(sampleNode);
  assert.equal(sampleNode.segment, sampleNode.effective_segment);
  assert.ok(typeof sampleNode.computed_segment === 'string');
  assert.ok(typeof sampleNode.segment_source === 'string');

  const debugFieldDefault = body.nodes.find((n: any) => n.id === 'visual_asset:va-dist')?.data?.segment_debug;
  assert.equal(debugFieldDefault, undefined);

  // When explicitly requested, include minimal debug fields.
  const resDebug = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(resDebug.statusCode, 200);
  const bodyDebug = resDebug.json() as any;
  const debugField = bodyDebug.nodes.find((n: any) => n.id === 'visual_asset:va-dist')?.data?.segment_debug;
  assert.ok(debugField);
  assert.ok(['vision', 'structured'].includes(debugField.classification_source));
  assert.ok(typeof debugField.classification_text_len === 'number');
  assert.ok(Array.isArray(debugField.top_scores));

  await app.close();
});

test('segment classifier handles noisy titles, heading preservation, and hard synonyms', async () => {
  const dealId = 'deal-seg-hard';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        return { rows: [{ ok: 1 }] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'WebMax Digital Mortgage Solutions' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            { id: 'doc-hard', title: 'Deck', type: 'pitch_deck', page_count: 8, uploaded_at: '2026-01-02T00:00:00.000Z' },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        return {
          rows: [
            {
              id: 'va-brand',
              document_id: 'doc-hard',
              page_index: 0,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:00.000Z',
              ocr_text: 'WebMax DIGITAL MORTGAGE SOLUTIONS',
              structured_json: {},
              units: null,
              extraction_confidence: '0.6',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-gibberish',
              document_id: 'doc-hard',
              page_index: 1,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:01.000Z',
              ocr_text: 'PoSOP O6',
              structured_json: {},
              units: null,
              extraction_confidence: '0.6',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 1,
              evidence_sample_snippets: ['Reseller partnerships drive pipeline'],
            },
            {
              id: 'va-traction',
              document_id: 'doc-hard',
              page_index: 2,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:02.000Z',
              ocr_text: 'Traction DIGITAL MORTGAGE SOLUTIONS',
              structured_json: {},
              units: null,
              extraction_confidence: '0.6',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-saas',
              document_id: 'doc-hard',
              page_index: 3,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:03.000Z',
              ocr_text: 'SaaS Platform, Add-Ons',
              structured_json: {},
              units: null,
              extraction_confidence: '0.6',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-fin',
              document_id: 'doc-hard',
              page_index: 4,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:04.000Z',
              ocr_text: 'Financial Strategy and Forecast',
              structured_json: {},
              units: null,
              extraction_confidence: '0.6',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-exit',
              document_id: 'doc-hard',
              page_index: 5,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:05.000Z',
              ocr_text: 'Primary Acquirers and strategic buyers',
              structured_json: {},
              units: null,
              extraction_confidence: '0.6',
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-team',
              document_id: 'doc-hard',
              page_index: 6,
              asset_type: 'slide',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.6',
              quality_flags: {},
              created_at: '2026-01-05T00:00:06.000Z',
              ocr_text: 'Meet our team',
              structured_json: {
                table: {
                  rows: [
                    ['Name', 'Role'],
                    ['Jane', 'CEO'],
                  ],
                  method: 'grid_lines_v1',
                  confidence: 0.9,
                },
              },
              units: null,
              extraction_confidence: '0.6',
              structured_kind: 'table',
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage?debug_segments=1` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const getSeg = (id: string) => {
    const node = body.nodes.find((n: any) => n.id === `visual_asset:${id}`);
    return node?.data?.segment;
  };

  assert.equal(getSeg('va-gibberish'), 'distribution');
  const gibberishDebug = body.nodes.find((n: any) => n.id === 'visual_asset:va-gibberish')?.data?.segment_debug;
  assert.ok(gibberishDebug);
  assert.equal(gibberishDebug.classification_source, 'vision');
  assert.ok(typeof gibberishDebug.classification_text_len === 'number');

  assert.equal(getSeg('va-traction'), 'traction');
  const tractionDebug = body.nodes.find((n: any) => n.id === 'visual_asset:va-traction')?.data?.segment_debug;
  assert.ok(tractionDebug);
  assert.equal(tractionDebug.classification_source, 'vision');
  assert.ok(typeof tractionDebug.classification_text_len === 'number');

  assert.equal(getSeg('va-saas'), 'business_model');
  assert.equal(getSeg('va-fin'), 'financials');
  assert.equal(getSeg('va-exit'), 'exit');
  assert.equal(getSeg('va-team'), 'team');

  await app.close();
});

test('structured_native_v1 assets ignore page_index heuristics and classify from structured_json text', async () => {
  const dealId = 'deal-structured-seg';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        return { rows: [{ ok: 1 }] };
      }

      if (q.includes('SELECT id, name FROM deals WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Structured Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-structured-1',
              title: 'PPTX',
              type: 'pitch_deck',
              page_count: 2,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-structured-pptx',
              document_id: 'doc-structured-1',
              // IMPORTANT: this is an element index for structured_native_v1, not a real page number.
              page_index: 25,
              asset_type: 'image_text',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'structured_native_v1',
              confidence: '0.85',
              quality_flags: { source: 'structured_powerpoint' },
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: null,
              ocr_blocks: null,
              structured_json: {
                kind: 'powerpoint_slide',
                title: 'Traction',
                bullets: ['ARR growth', 'Customers: 120', 'Retention 95%'],
                text_snippet: 'Traction and growth metrics',
                notes: null,
              },
              units: null,
              extraction_confidence: '0.85',
              structured_kind: null,
              structured_summary: null,
              extraction_method: 'structured_native_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-structured-empty',
              document_id: 'doc-structured-1',
              page_index: 99,
              asset_type: 'image_text',
              bbox: {},
              image_uri: null,
              image_hash: null,
              extractor_version: 'structured_native_v1',
              confidence: '0.85',
              quality_flags: { source: 'structured_word' },
              created_at: '2026-01-01T00:00:00.000Z',
              ocr_text: null,
              ocr_blocks: null,
              structured_json: {
                kind: 'word_section',
                heading: null,
                text_snippet: '',
                paragraphs: [],
                table_rows: [],
              },
              units: null,
              extraction_confidence: '0.85',
              structured_kind: null,
              structured_summary: null,
              extraction_method: 'structured_native_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  const segPptx = body.nodes.find((n: any) => n.id === 'visual_asset:va-structured-pptx')?.data?.segment;
  assert.equal(segPptx, 'traction');

  const segEmpty = body.nodes.find((n: any) => n.id === 'visual_asset:va-structured-empty')?.data?.segment;
  assert.equal(segEmpty, 'unknown');

  await app.close();
});
