process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { registerVisualAssetRoutes } from '../src/routes/visual-assets';
import { closeQueues } from '../src/lib/queue';
import { computeSegmentCoverageSummary, getSegmentConfidenceThresholds } from '@dealdecision/core';

test.after(async () => {
  await closeQueues();
});

test('POST /visual-assets/:id/segment-override wins in lineage and counts as confident coverage', async () => {
  const dealId = 'deal-override-1';
  const docId = 'doc-override-1';
  const visualAssetId = 'va-override-1';

  const visualAssetRow: any = {
    id: visualAssetId,
    document_id: docId,
    page_index: 0,
    asset_type: 'image',
    structured_json: null,
    structured_kind: null,
    structured_summary: null,
    // Make computed segment likely 'unknown'
    ocr_text: '',
    ocr_blocks: [],
    quality_flags: {},
    extractor_version: 'test',
  };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('to_regclass')) return { rows: [{ oid: 'ok' }] };
      if (q.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      if (q.includes('FROM deals') && q.includes('WHERE') && q.includes('id = $1')) {
        return { rows: [{ id: dealId, name: 'Override Deal' }] };
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

      if (q.includes('SELECT id, quality_flags FROM visual_assets WHERE id = $1')) {
        const id = Array.isArray(params) ? params[0] : null;
        assert.equal(id, visualAssetId);
        return { rows: [{ id: visualAssetId, quality_flags: visualAssetRow.quality_flags }] };
      }

      if (q.includes('UPDATE visual_assets SET quality_flags = $2 WHERE id = $1 RETURNING id, quality_flags')) {
        const id = Array.isArray(params) ? params[0] : null;
        const flags = Array.isArray(params) ? params[1] : null;
        assert.equal(id, visualAssetId);
        visualAssetRow.quality_flags = flags;
        return { rows: [{ id: visualAssetId, quality_flags: visualAssetRow.quality_flags }], rowCount: 1 };
      }

      if (q.includes('FROM visual_assets') && q.includes('WHERE') && q.includes('deal_id')) {
        // Deal lineage visuals query.
        return {
          rows: [
            {
              ...visualAssetRow,
              // Some queries alias these:
              image_uri: null,
              evidence_sample_snippets: [],
              page_understanding: null,
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets') && q.includes('JOIN documents')) {
        // Some schemas join documents to get deal_id; return the same row.
        return {
          rows: [
            {
              ...visualAssetRow,
              image_uri: null,
              evidence_sample_snippets: [],
              page_understanding: null,
            },
          ],
        };
      }

      if (q.includes('FROM evidence_links')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);
  await registerVisualAssetRoutes(app, mockPool);

  const overrideRes = await app.inject({
    method: 'POST',
    url: `/visual-assets/${visualAssetId}/segment-override`,
    payload: { segment_key: 'financials', note: 'manual fix' },
  });
  assert.equal(overrideRes.statusCode, 200);
  const overrideBody = overrideRes.json() as any;
  assert.equal(overrideBody.ok, true);
  assert.equal(overrideBody.visual_asset_id, visualAssetId);
  assert.equal(overrideBody.quality_flags.segment_key, 'financials');
  assert.equal(overrideBody.quality_flags.segment_source, 'human_override');
  assert.equal(overrideBody.quality_flags.segment_confidence, 1.0);

  const lineageRes = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(lineageRes.statusCode, 200);
  const lineage = lineageRes.json() as any;

  const visualNode = (Array.isArray(lineage.nodes) ? lineage.nodes : []).find((n: any) => String(n?.id ?? '').includes(visualAssetId));
  assert.ok(visualNode, 'expected a visual_asset node');
  const data = (visualNode as any).data ?? visualNode;
  assert.equal(data.effective_segment, 'financials');
  assert.equal(data.segment_source, 'human_override');
  assert.equal(data.segment_confidence, 1.0);
  assert.ok(typeof data.computed_segment === 'string');

  const thresholds = getSegmentConfidenceThresholds({});
  const coverage = computeSegmentCoverageSummary(
    [{ kind: 'visual_asset', effective_segment: data.effective_segment, segment_confidence: data.segment_confidence }],
    thresholds
  );
  assert.equal(coverage.coverage_confident, 1);
  assert.equal(coverage.coverage_weak, 0);

  await app.close();
});
