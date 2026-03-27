process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('DELETE /api/v1/deals/:deal_id performs soft delete by default', async () => {
  const dealId = 'deal-soft-1';
  const app = Fastify();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes('UPDATE deals') && q.includes('SET deleted_at = now()')) {
        assert.equal(params?.[0], dealId);
        return { rows: [{ id: dealId }], rowCount: 1 };
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
      method: 'DELETE',
      url: `/api/v1/deals/${dealId}`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.deal_id, dealId);
    assert.equal(body.delete_mode, 'soft');
  } finally {
    await app.close();
  }
});

test('PATCH /api/v1/deals/:deal_id/restore restores soft-deleted deal', async () => {
  const dealId = 'deal-restore-1';
  process.env.NODE_ENV = 'development';
  const now = new Date().toISOString();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes('UPDATE deals') && q.includes('SET deleted_at = NULL')) {
        assert.equal(params?.[0], dealId);
        return {
          rows: [
            {
              id: dealId,
              name: 'Restored Deal',
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
    connect: async () => {
      throw new Error('DB should not be called');
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${dealId}/restore`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.id, dealId);
    assert.equal(body.lifecycle_status, 'active');
  } finally {
    await app.close();
  }
});

test('DELETE /api/v1/deals/:deal_id?purge=true returns 200 and calls purge service', async () => {
  const dealId = 'deal-2';

  // Allow destructive auth in test environment
  delete process.env.ADMIN_TOKEN;
  process.env.NODE_ENV = 'development';

  const calls: Array<{ sql: string; params?: unknown[] }> = [];

  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql: String(sql), params: params as any });
      const q = String(sql);

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rows: [] };
      }

      if (q.includes('SELECT id FROM deals WHERE id = $1')) {
        return { rows: [{ id: dealId }] };
      }

      if (q.includes('SELECT COUNT(*)::text as count FROM documents')) {
        return { rows: [{ count: '2' }] };
      }
      if (q.includes('SELECT COUNT(*)::text as count FROM evidence')) {
        return { rows: [{ count: '3' }] };
      }
      if (q.includes('SELECT COUNT(*)::text as count FROM jobs')) {
        return { rows: [{ count: '1' }] };
      }
      if (q.includes('SELECT COUNT(*)::text as count FROM deal_intelligence_objects')) {
        return { rows: [{ count: '4' }] };
      }

      if (q.includes('SELECT DISTINCT df.sha256')) {
        return { rows: [{ sha256: 'sha-a' }, { sha256: 'sha-b' }] };
      }

      if (q.includes('DELETE FROM ingestion_reports')) {
        return { rows: [], rowCount: 1 };
      }
      if (q.includes('DELETE FROM deal_evidence')) {
        return { rows: [], rowCount: 2 };
      }

      if (q.includes('DELETE FROM deal_intelligence_objects')) {
        return { rows: [], rowCount: 4 };
      }

      if (q.includes('DELETE FROM deals WHERE id = $1')) {
        return { rows: [], rowCount: 1 };
      }

      if (q.includes('DELETE FROM document_file_blobs')) {
        return { rows: [{ sha256: 'sha-a' }], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
    release: () => {},
  };

  const mockPool = {
    connect: async () => client,
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/deals/${dealId}?purge=true`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.deal_id, dealId);
    assert.ok(body.purge);

    // Ensure we actually executed a deal delete.
    assert.ok(calls.some((c) => c.sql.includes('DELETE FROM deals WHERE id = $1')));
  } finally {
    await app.close();
  }
});
