process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('POST /api/v1/deals/draft returns {deal_id}', async () => {
  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('INSERT INTO deals') && q.includes('RETURNING id')) {
        assert.ok(Array.isArray(params));
        // name, stage, priority, owner
        assert.equal(typeof (params as any)[0], 'string');
        assert.ok(['intake', 'under_review', 'in_diligence', 'ready_decision', 'pitched'].includes(String((params as any)[1])));
        assert.ok(['high', 'medium', 'low'].includes(String((params as any)[2])));
        return { rows: [{ id: 'draft-deal-1' }] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/draft',
      payload: {},
    });

    assert.equal(response.statusCode, 201);
    const body = response.json() as any;
    assert.equal(body.deal_id, 'draft-deal-1');
  } finally {
    await app.close();
  }
});
