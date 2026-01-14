process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/v1/deals/:dealId/scoring-input returns v0 items derived from lineage', async () => {
  const dealId = 'deal-scoring-1';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        // Simulate missing visual tables (lineage returns deal+docs+warnings)
        return { rows: [{ oid: null }] };
      }

      if (q.includes('information_schema.columns')) {
        // Feature detection via hasColumn(...)
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Scoring Deal' }] };
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

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/scoring-input` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.ok(typeof body.generated_at === 'string');
  assert.ok(Array.isArray(body.items));

  // Deal + doc should be present even when visual tables are missing.
  const dealItem = body.items.find((i: any) => i.kind === 'deal');
  assert.ok(dealItem);

  const docItem = body.items.find((i: any) => i.kind === 'document' && i.document_id === 'doc-1');
  assert.ok(docItem);
  assert.ok(Array.isArray(docItem.locators));
  assert.equal(docItem.locators[0].document_id, 'doc-1');

  await app.close();
});
