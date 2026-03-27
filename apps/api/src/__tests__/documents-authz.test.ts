process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDocumentRoutes } from '../routes/documents';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('deal-scoped document routes reject cross-deal access for non-owner user', async () => {
  const queries: string[] = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      queries.push(text);

      if (text.includes('information_schema.columns') && text.includes("table_name = $1") && text.includes("column_name = $2")) {
        const table = String((params ?? [])[0] ?? '');
        const column = String((params ?? [])[1] ?? '');

        if (table === 'deals' && column === 'created_by_user_id') {
          return { rows: [{ ok: 1 }] };
        }

        return { rows: [] };
      }

      if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'deal-1',
              created_by_user_id: 'owner-user',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = { userId: 'other-user' };
  });
  await registerDocumentRoutes(app, mockPool);

  const calls = [
    app.inject({ method: 'GET', url: '/api/v1/deals/deal-1/documents' }),
    app.inject({
      method: 'POST',
      url: '/api/v1/deals/deal-1/documents/upload',
      payload: { file_buffer: Buffer.from('abc').toString('base64'), file_name: 'a.pdf', title: 'A' },
    }),
    app.inject({ method: 'POST', url: '/api/v1/deals/deal-1/documents/doc-1/retry' }),
    app.inject({ method: 'DELETE', url: '/api/v1/deals/deal-1/documents/doc-1' }),
    app.inject({ method: 'GET', url: '/api/v1/deals/deal-1/documents/extraction-report' }),
  ];

  const responses = await Promise.all(calls);

  for (const response of responses) {
    assert.equal(response.statusCode, 403);
    const body = response.json() as any;
    assert.equal(body.error, 'Forbidden: deal access denied');
  }

  const dealAuthChecks = queries.filter((q) => q.includes('FROM deals') && q.includes('WHERE id = $1'));
  assert.ok(dealAuthChecks.length >= 5, `expected auth check on each route, got ${dealAuthChecks.length}`);

  await app.close();
});

test('deal-scoped document route rejects authenticated user without org in production', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
          const col = String((params ?? [])[1] ?? '');
          if (col === 'created_by_user_id') {
            return { rows: [{ ok: 1 }] };
          }
          return { rows: [] };
        }
        if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
          return {
            rows: [
              {
                id: 'deal-1',
                created_by_user_id: 'owner-user',
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
    } as any;

    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as any).auth = { userId: 'owner-user' };
    });
    await registerDocumentRoutes(app, mockPool);

    const res = await app.inject({ method: 'GET', url: '/api/v1/deals/deal-1/documents' });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as any).error, 'Forbidden: no organization found in token');

    await app.close();
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

test('deal-scoped document route allows org admin role to access non-owned deal', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
          const col = String((params ?? [])[1] ?? '');
          if (col === 'created_by_user_id') {
            return { rows: [{ ok: 1 }] };
          }
          if (col === 'size_bytes' || col === 'extraction_metadata') {
            return { rows: [{ ok: 1 }] };
          }
          return { rows: [] };
        }
        if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
          return {
            rows: [
              {
                id: 'deal-1',
                created_by_user_id: 'owner-user',
              },
            ],
          };
        }
        if (text.includes('FROM documents') && text.includes('WHERE deal_id = $1')) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
    } as any;

    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as any).auth = {
        userId: 'other-user',
        orgId: 'org-1',
        orgRole: 'org:admin',
      };
    });
    await registerDocumentRoutes(app, mockPool);

    const res = await app.inject({ method: 'GET', url: '/api/v1/deals/deal-1/documents' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { documents: [] });

    await app.close();
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});
