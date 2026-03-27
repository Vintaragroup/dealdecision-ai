process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('POST /api/v1/deals/:deal_id/view increments views and returns count', async () => {
  const dealId = 'deal-view-1';
  const app = Fastify();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes('information_schema.columns')) {
        assert.equal(params?.[0], 'deals');
        assert.equal(params?.[1], 'views');
        return { rows: [{ ok: 1 }] };
      }
      if (q.includes('UPDATE deals') && q.includes('SET views = COALESCE(views, 0) + 1')) {
        assert.equal(params?.[0], dealId);
        return { rows: [{ id: dealId, views: 7 }], rowCount: 1 };
      }
      return { rows: [] };
    },
    connect: async () => {
      throw new Error('DB should not be called');
    },
  } as any;

  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${dealId}/view`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.deal_id, dealId);
    assert.equal(body.views, 7);
  } finally {
    await app.close();
  }
});

test('POST /api/v1/deals/:deal_id/view returns 501 when views column missing', async () => {
  const app = Fastify();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes('information_schema.columns')) {
        assert.equal(params?.[0], 'deals');
        assert.equal(params?.[1], 'views');
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
    connect: async () => {
      throw new Error('DB should not be called');
    },
  } as any;

  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/deal-view-2/view',
    });

    assert.equal(response.statusCode, 501);
    const body = response.json() as any;
    assert.equal(body.error, 'views_not_supported');
  } finally {
    await app.close();
  }
});
