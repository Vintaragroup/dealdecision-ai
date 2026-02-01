process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerEventRoutes } from '../src/routes/events';

test('GET /api/v1/events with deal_id does not emit uuid=text operator errors', async () => {
  // This mock reproduces the old backend failure mode deterministically:
  // if the SQL compares deal_id (uuid) to an uncasted text param, Postgres emits:
  //   "operator does not exist: uuid = text"
  const mockPool = {
    query: async (sql: string) => {
      const q = String(sql);
      if (q.includes('FROM jobs')) {
        // Ensure the implementation uses explicit uuid casts.
        assert.ok(q.includes('$1::uuid'), 'expected $1::uuid cast in jobs query');
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerEventRoutes(app, mockPool);

  const dealId = 'a596aae1-db29-4085-82d3-4dc07e918d7e';
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/events?deal_id=${dealId}`,
    headers: {
      // Causes the handler to auto-close quickly so inject() can finish.
      'x-ddai-test-mode': '1',
      origin: 'http://localhost:5199',
    },
  });

  assert.equal(response.statusCode, 200);
  const payload = response.payload;
  assert.ok(payload.includes('event: ready'), 'expected initial ready event');
  assert.ok(!payload.includes('event: error'), 'did not expect error events in SSE stream');
  assert.ok(!payload.includes('uuid = text'), 'did not expect uuid=text operator error');

  await app.close();
});

test('GET /api/v1/events rejects invalid deal_id with 400 (no DB query)', async () => {
  let jobsQueryCount = 0;
  const mockPool = {
    query: async (sql: string) => {
      if (String(sql).includes('FROM jobs')) jobsQueryCount += 1;
      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  await registerEventRoutes(app, mockPool);

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/events?deal_id=not-a-uuid',
    headers: { origin: 'http://localhost:5199' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(jobsQueryCount, 0);

  await app.close();
});
