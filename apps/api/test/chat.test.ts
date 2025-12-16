import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerChatRoutes } from '../src/routes/chat';

const emptyPool = {
  query: async () => ({ rows: [{ oid: null }] }),
} as any;

test('POST /api/v1/chat/workspace returns a reply and actions array', async () => {
  const app = Fastify();
  await registerChatRoutes(app, emptyPool);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/workspace',
    payload: { message: 'Hello' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(typeof body.reply === 'string');
  assert.ok(Array.isArray(body.suggested_actions));
});

test('POST /api/v1/chat/deal returns suggested actions and citations when available', async () => {
  const app = Fastify();
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('to_regclass')) {
        const table = params[0] as string;
        return { rows: [{ oid: table }] };
      }
      if (sql.includes('FROM dio_versions')) {
        return { rows: [{ dio_version_id: 'v1' }] };
      }
      if (sql.includes('FROM evidence')) {
        return { rows: [{ evidence_id: 'ev-1', excerpt: 'Excerpt' }] };
      }
      return { rows: [] };
    },
  } as any;

  await registerChatRoutes(app, mockPool);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/deal',
    payload: { message: 'Summarize this deal', deal_id: 'deal-123' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(Array.isArray(body.suggested_actions));
  assert.ok(body.suggested_actions.find((a: any) => a.type === 'run_analysis'));
  assert.ok(body.suggested_actions.find((a: any) => a.type === 'fetch_evidence'));
  assert.ok(Array.isArray(body.citations));
  assert.equal(body.citations[0].evidence_id, 'ev-1');
});
