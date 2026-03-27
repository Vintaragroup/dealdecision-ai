process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('PATCH /api/v1/deals/:deal_id/archive sets lifecycle_status=archived', async () => {
  const dealId = 'deal-archive-1';
  const now = new Date().toISOString();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (
        q.includes('information_schema.columns') &&
        params?.[0] === 'deals' &&
        params?.[1] === 'lifecycle_status'
      ) {
        return { rows: [{ ok: 1 }] };
      }

      if (q.includes('UPDATE deals') && q.includes("lifecycle_status = 'archived'")) {
        assert.equal(params?.[0], dealId);
        return {
          rows: [
            {
              id: dealId,
              name: 'Archive Test Deal',
              stage: 'intake',
              priority: 'medium',
              lifecycle_status: 'archived',
              llm_phase_mode: 'exploratory',
              trend: 'stable',
              score: null,
              owner: null,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            },
          ],
        };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${dealId}/archive`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.id, dealId);
    assert.equal(body.lifecycle_status, 'archived');
  } finally {
    await app.close();
  }
});

test('PATCH /api/v1/deals/:deal_id/unarchive sets lifecycle_status=active', async () => {
  const dealId = 'deal-archive-2';
  const now = new Date().toISOString();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (
        q.includes('information_schema.columns') &&
        params?.[0] === 'deals' &&
        params?.[1] === 'lifecycle_status'
      ) {
        return { rows: [{ ok: 1 }] };
      }

      if (q.includes('UPDATE deals') && q.includes("lifecycle_status = 'active'")) {
        assert.equal(params?.[0], dealId);
        return {
          rows: [
            {
              id: dealId,
              name: 'Unarchive Test Deal',
              stage: 'intake',
              priority: 'medium',
              lifecycle_status: 'active',
              llm_phase_mode: 'exploratory',
              trend: 'stable',
              score: null,
              owner: null,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            },
          ],
        };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${dealId}/unarchive`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.id, dealId);
    assert.equal(body.lifecycle_status, 'active');
  } finally {
    await app.close();
  }
});
