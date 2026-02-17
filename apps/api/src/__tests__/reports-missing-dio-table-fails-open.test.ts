process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerReportRoutes } from '../routes/reports';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/v1/deals/:deal_id/report fails open when deal_intelligence_objects table is missing', async () => {
  const dealId = '00000000-0000-0000-0000-000000000199';

  const missingTable = () => {
    const err: any = new Error('missing table');
    err.code = '42P01';
    throw err;
  };

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM deals') && sql.includes('WHERE id = $1') && sql.includes('deleted_at IS NULL')) {
        return { rows: [{ id: String(params[0] ?? dealId), llm_phase_mode: 'exploratory' }] };
      }

      // Missing canonical DIO table
      if (sql.includes('FROM deal_intelligence_objects')) return missingTable();

      return missingTable();
    },
  } as any;

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/report` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  assert.equal(body?.ready, false);
  assert.equal(body?.reason, 'db_missing_table');
  assert.equal(body?.missing_table, 'deal_intelligence_objects');
  assert.ok(!body?.error && !body?.message, `unexpected error payload body=${res.body}`);

  await app.close();
});
