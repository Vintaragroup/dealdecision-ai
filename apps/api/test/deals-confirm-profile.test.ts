process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('POST /api/v1/deals/:deal_id/confirm-profile updates canonical fields and marks active when column exists', async () => {
  const dealId = 'deal-555';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('FROM information_schema.columns')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        const col = Array.isArray(params) ? String((params as any)[1]) : '';
        if (table === 'deals' && ['lifecycle_status', 'investment_type', 'round', 'proposed_profile', 'proposed_profile_confidence', 'proposed_profile_sources', 'proposed_profile_warnings', 'industry'].includes(col)) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.startsWith('UPDATE deals SET') && q.includes('RETURNING *')) {
        assert.ok(Array.isArray(params));
        assert.equal((params as any)[0], dealId);
        return {
          rows: [
            {
              id: dealId,
              name: 'Acme — seed',
              stage: 'intake',
              priority: 'medium',
              trend: null,
              score: null,
              owner: 'Acme Inc',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-02T00:00:00.000Z',
              deleted_at: null,
            },
          ],
        };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${dealId}/confirm-profile`,
      payload: {
        company_name: 'Acme Inc',
        deal_name: 'Acme — seed',
        investment_type: 'safe',
        round: 'seed',
        industry: 'FinTech',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.id, dealId);
    assert.equal(body.name, 'Acme — seed');
    assert.equal(body.owner, 'Acme Inc');
  } finally {
    await app.close();
  }
});
