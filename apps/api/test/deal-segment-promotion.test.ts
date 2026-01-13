process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('POST /api/v1/deals/:dealId/segments/promote promotes high-confidence deltas (product)', async () => {
  const dealId = 'deal-promote-1';
  let updateCount = 0;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-a',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 2,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('JOIN visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-product',
              document_id: 'doc-a',
              page_index: 1,
              asset_type: 'structured',
              extractor_version: 'structured_native_v1',
              quality_flags: { source: 'structured_powerpoint', segment_key: 'unknown' },
              ocr_text: null,
              ocr_blocks: null,
              structured_json: { kind: 'powerpoint_slide', title: 'Product', slide_number: 2 },
              structured_summary: null,
              units: null,
              extraction_confidence: null,
              structured_kind: null,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      if (q.startsWith('UPDATE visual_assets')) {
        updateCount += 1;
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/deals/${dealId}/segments/promote`,
    payload: {
      dry_run: false,
      auto_accept_threshold: 0.2,
      review_threshold: 0.1,
      reject_threshold: 0.05,
      persist_artifact: false,
    },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.ok(body.run_id);
  assert.equal(body.dry_run, false);
  assert.equal(body.counts.scanned, 1);
  assert.equal(body.counts.promoted, 1);
  assert.equal(updateCount, 1);

  const item = body.items.find((it: any) => it.visual_asset_id === 'va-product');
  assert.ok(item);
  assert.equal(item.action, 'promoted');
  assert.equal(item.computed_segment, 'product');
  assert.equal(item.did_update, true);

  await app.close();
});

test('POST /api/v1/deals/:dealId/segments/promote respects threshold gating (needs_review)', async () => {
  const dealId = 'deal-promote-2';
  let updateCount = 0;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-a',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 2,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('JOIN visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-product',
              document_id: 'doc-a',
              page_index: 1,
              asset_type: 'structured',
              extractor_version: 'structured_native_v1',
              quality_flags: { source: 'structured_powerpoint', segment_key: 'unknown' },
              ocr_text: null,
              ocr_blocks: null,
              structured_json: { kind: 'powerpoint_slide', title: 'Product', slide_number: 2 },
              structured_summary: null,
              units: null,
              extraction_confidence: null,
              structured_kind: null,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      if (q.startsWith('UPDATE visual_assets')) {
        updateCount += 1;
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/deals/${dealId}/segments/promote`,
    payload: { auto_accept_threshold: 0.95, persist_artifact: false },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.counts.scanned, 1);
  assert.equal(body.counts.promoted, 1);
  assert.equal(body.counts.needs_review, 0);
  assert.equal(updateCount, 1);

  const item = body.items.find((it: any) => it.visual_asset_id === 'va-product');
  assert.ok(item);
  assert.equal(item.action, 'promoted');
  assert.equal(item.computed_segment, 'product');

  await app.close();
});

test('POST /api/v1/deals/:dealId/segments/promote is idempotent with idempotency_key', async () => {
  const dealId = 'deal-promote-3';
  const idempotency_key = 'segment-promotion-test-key';
  let updateCount = 0;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-a',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 2,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('JOIN visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-product',
              document_id: 'doc-a',
              page_index: 1,
              asset_type: 'structured',
              extractor_version: 'structured_native_v1',
              quality_flags: { source: 'structured_powerpoint', segment_key: 'unknown' },
              ocr_text: null,
              ocr_blocks: null,
              structured_json: { kind: 'powerpoint_slide', title: 'Product', slide_number: 2 },
              structured_summary: null,
              units: null,
              extraction_confidence: null,
              structured_kind: null,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      if (q.startsWith('UPDATE visual_assets')) {
        updateCount += 1;
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res1 = await app.inject({
    method: 'POST',
    url: `/api/v1/deals/${dealId}/segments/promote`,
    payload: {
      idempotency_key,
      auto_accept_threshold: 0.2,
      review_threshold: 0.1,
      reject_threshold: 0.05,
      persist_artifact: true,
    },
  });
  assert.equal(res1.statusCode, 200);
  const body1 = res1.json() as any;
  assert.equal(body1.counts.promoted, 1);
  assert.equal(updateCount, 1);
  assert.ok(body1.artifact_path);

  const res2 = await app.inject({
    method: 'POST',
    url: `/api/v1/deals/${dealId}/segments/promote`,
    payload: {
      idempotency_key,
      auto_accept_threshold: 0.2,
      review_threshold: 0.1,
      reject_threshold: 0.05,
      persist_artifact: true,
    },
  });
  assert.equal(res2.statusCode, 200);
  const body2 = res2.json() as any;
  assert.equal(body2.idempotent_replay, true);
  assert.equal(updateCount, 1);

  // Cleanup artifact file to keep repo tidy during repeated local runs.
  try {
    const artifactPath = String(body1.artifact_path);
    if (artifactPath) {
      fs.rmSync(path.dirname(artifactPath), { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  await app.close();
});
