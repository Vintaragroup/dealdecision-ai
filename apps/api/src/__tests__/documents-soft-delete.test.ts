process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDocumentRoutes } from '../routes/documents';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('DELETE /documents/:id performs soft-delete by default', async () => {
  const queries: string[] = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      queries.push(text);

      if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
        const col = String((params ?? [])[1] ?? '');
        if (col === 'created_by_user_id') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
        return { rows: [{ id: 'deal-1', created_by_user_id: null }] };
      }

      if (text.includes('SELECT id') && text.includes('FROM documents') && text.includes('deleted_at IS NULL')) {
        return { rows: [{ id: 'doc-1' }] };
      }

      if (text.includes('UPDATE documents') && text.includes('SET deleted_at = now()')) {
        return { rows: [{ id: 'doc-1' }] };
      }

      if (text === 'BEGIN' || text === 'COMMIT') {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool);

  const res = await app.inject({
    method: 'DELETE',
    url: '/api/v1/deals/deal-1/documents/doc-1',
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.delete_mode, 'soft');
  assert.ok(queries.some((q) => q.includes('SET deleted_at = now()')), 'expected soft-delete update query');

  await app.close();
});

test('DELETE /documents/:id?purge=1 requires admin-style destructive auth in production', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        const text = String(sql);

        if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
          const col = String((params ?? [])[1] ?? '');
          if (col === 'created_by_user_id') return { rows: [{ ok: 1 }] };
          return { rows: [] };
        }

        if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
          return { rows: [{ id: 'deal-1', created_by_user_id: null }] };
        }

        if (text.includes('SELECT id') && text.includes('FROM documents') && text.includes('deleted_at IS NULL')) {
          return { rows: [{ id: 'doc-1' }] };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    } as any;

    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as any).auth = { userId: 'user-1', orgId: 'org-1', orgRole: 'org:member' };
    });
    await registerDocumentRoutes(app, mockPool);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/deals/deal-1/documents/doc-1?purge=1',
    });

    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as any).error, 'Unauthorized destructive operation');

    await app.close();
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

test('POST /documents/:id/restore restores soft-deleted document for admin role', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        const text = String(sql);

        if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
          const col = String((params ?? [])[1] ?? '');
          if (col === 'created_by_user_id') return { rows: [{ ok: 1 }] };
          return { rows: [] };
        }

        if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
          return { rows: [{ id: 'deal-1', created_by_user_id: null }] };
        }

        if (text.includes('UPDATE documents') && text.includes('SET deleted_at = NULL')) {
          return { rows: [{ id: 'doc-1' }] };
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    } as any;

    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as any).auth = { userId: 'admin-user', orgId: 'org-1', orgRole: 'org:admin' };
    });
    await registerDocumentRoutes(app, mockPool);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/deal-1/documents/doc-1/restore',
    });

    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as any).ok, true);

    await app.close();
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});
