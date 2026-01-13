process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/v1/deals/:dealId/visual-assets matches lineage effective_segment + segment_source', async () => {
  const dealId = 'deal-parity-1';
  const docId = 'doc-parity-1';
  const visualAssetId = 'va-parity-1';

  const visualRow: any = {
    id: visualAssetId,
    visual_asset_id: visualAssetId,
    document_id: docId,
    deal_id: dealId,
    page_index: 0,
    asset_type: 'image',
    bbox: null,
    image_uri: null,
    image_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    confidence: 1,
    quality_flags: {},
    extractor_version: 'test',
    evidence_count: 0,
    evidence_sample_snippets: [],
    has_extraction: true,
    structured_kind: null,
    structured_summary: null,
    structured_json: null,
    ocr_text: 'Revenue grew 300% year over year. ARR 2.5M. CAC payback 4 months.',
    ocr_blocks: [],
    units: null,
    document_title: 'Pitch Deck',
    document_type: 'pitch_deck',
    document_status: 'uploaded',
    document_page_count: 1,
    page_understanding: null,
  };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('SELECT id FROM deals') && q.includes('WHERE id = $1')) {
        return { rows: [{ id: dealId }] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE') && q.includes('id = $1')) {
        return { rows: [{ id: dealId, name: 'Parity Deal' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            {
              id: docId,
              title: 'Pitch Deck',
              type: 'pitch_deck',
              page_count: 1,
              uploaded_at: '2026-01-01T00:00:00.000Z',
              extraction_metadata: {},
            },
          ],
        };
      }

      if (q.includes('WITH latest_extraction AS') && q.includes('FROM visual_assets va') && q.includes('JOIN documents')) {
        // /api/v1/deals/:dealId/visual-assets query.
        return { rows: [{ ...visualRow }] };
      }

      if (q.includes('FROM visual_assets') && q.includes('WHERE') && q.includes('deal_id')) {
        // Deal lineage visuals query.
        return { rows: [{ ...visualRow }] };
      }

      if (q.includes('FROM visual_assets') && q.includes('JOIN documents')) {
        // Some lineage schemas join documents to get deal_id.
        return { rows: [{ ...visualRow }] };
      }

      if (q.includes('FROM evidence_links')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const visualAssetsRes = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/visual-assets` });
  assert.equal(visualAssetsRes.statusCode, 200);
  const visualAssetsBody = visualAssetsRes.json() as any;
  const assets = Array.isArray(visualAssetsBody?.visual_assets) ? visualAssetsBody.visual_assets : [];
  assert.equal(assets.length, 1);
  const asset = assets[0];
  assert.equal(asset.visual_asset_id, visualAssetId);
  assert.ok(asset.document && asset.document.id === docId);

  assert.ok(typeof asset.effective_segment === 'string');
  assert.ok(typeof asset.segment_source === 'string');
  assert.ok(typeof asset.computed_segment === 'string');

  const lineageRes = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(lineageRes.statusCode, 200);
  const lineage = lineageRes.json() as any;

  const visualNode = (Array.isArray(lineage.nodes) ? lineage.nodes : []).find((n: any) =>
    String(n?.id ?? '').includes(visualAssetId)
  );
  assert.ok(visualNode, 'expected a visual_asset node');
  const data = (visualNode as any).data ?? visualNode;

  assert.equal(asset.effective_segment, data.effective_segment);
  assert.equal(asset.segment_source, data.segment_source);
  assert.equal(asset.segment_confidence, data.segment_confidence);
  assert.equal(asset.computed_segment, data.computed_segment);

  await app.close();
});
