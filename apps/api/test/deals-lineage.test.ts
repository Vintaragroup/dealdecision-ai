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

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.ok(Array.isArray(body.nodes));
  assert.ok(Array.isArray(body.edges));
  assert.ok(Array.isArray(body.warnings));
  assert.ok(body.warnings.length >= 1);

  // Deal + 1 doc
  assert.ok(body.nodes.find((n: any) => n.id === `deal:${dealId}` && n.type === 'deal'));
  assert.ok(body.nodes.find((n: any) => n.id === 'doc:doc-1' && n.type === 'document'));
  assert.ok(body.edges.find((e: any) => e.id === `e:deal-doc:${dealId}:doc-1`));

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

      if (q.includes('SELECT id, name FROM deals WHERE id = $1')) {
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

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/lineage` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.equal(body.warnings.length, 0);

  assert.ok(body.nodes.find((n: any) => n.id === `deal:${dealId}`));
  assert.ok(body.nodes.find((n: any) => n.id === 'doc:doc-2'));

  // No visual asset nodes
  assert.equal(body.nodes.filter((n: any) => String(n.id).startsWith('va:')).length, 0);
  assert.equal(body.nodes.filter((n: any) => String(n.id).startsWith('evagg:')).length, 0);

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

      if (q.includes('SELECT id, name FROM deals WHERE id = $1')) {
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
              evidence_count: 3,
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

  assert.equal(body.deal_id, dealId);
  assert.equal(body.warnings.length, 0);

  assert.ok(body.nodes.find((n: any) => n.id === `va:va-1` && n.type === 'visual_asset'));
  assert.ok(body.nodes.find((n: any) => n.id === `evagg:va-1` && n.type === 'evidence'));

  assert.ok(body.edges.find((e: any) => e.id === `e:doc-va:doc-3:va-1`));
  assert.ok(body.edges.find((e: any) => e.id === `e:va-evagg:va-1`));

  await app.close();
});
