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

test('POST /api/v1/chat/deal returns DealChatResponseV1 shape', async () => {
  const app = Fastify();
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('to_regclass')) {
        const table = params[0] as string;
        return { rows: [{ oid: table }] };
      }
      if (sql.includes('FROM dio_versions')) {
        // Return correct column name so hasDio is true if needed; no API key so LLM won't run
        return { rows: [{ id: 'v1' }] };
      }
      if (sql.includes('FROM evidence')) {
        return { rows: [] };
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
  // DealChatResponseV1 shape
  assert.ok(typeof body.message === 'string', 'message should be a string');
  assert.ok(typeof body.confidence === 'string', 'confidence should be a string');
  assert.ok(Array.isArray(body.suggested_actions), 'suggested_actions should be an array');
  // Without OPENAI_API_KEY the route returns a no-key advisory with RUN_ANALYZE
  assert.ok(
    body.suggested_actions.some((a: any) => a.type === 'RUN_ANALYZE'),
    'should include RUN_ANALYZE action when no API key is configured',
  );
});
