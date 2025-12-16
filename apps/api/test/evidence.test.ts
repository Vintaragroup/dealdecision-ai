process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerEvidenceRoutes } from '../src/routes/evidence';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('POST /api/v1/evidence/fetch validates payload and queues job', async () => {
  let enqueuedPayload: any = null;
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM deals')) {
        assert.equal(params[0], 'deal-1');
        return { rows: [{ id: 'deal-1' }] };
      }
      throw new Error('Unexpected query');
    }
  } as any;

  const enqueue = async (input: any) => {
    enqueuedPayload = input;
    return { job_id: 'job-123', status: 'queued' };
  };

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool, enqueue);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/evidence/fetch',
    payload: { deal_id: 'deal-1', filter: 'financial' },
  });

  assert.equal(response.statusCode, 202);
  const body = response.json();
  assert.equal(body.job_id, 'job-123');
  assert.equal(enqueuedPayload?.deal_id, 'deal-1');
  assert.equal(enqueuedPayload?.type, 'fetch_evidence');
  assert.deepEqual(enqueuedPayload?.payload, { filter: 'financial' });

  await app.close();
});

test('POST /api/v1/evidence/fetch rejects invalid or missing deal', async () => {
  const mockPool = {
    query: async (sql: string) => {
      if (sql.includes('FROM deals')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  } as any;

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool, async () => ({ job_id: 'job-1', status: 'queued' }));

  const badBody = await app.inject({ method: 'POST', url: '/api/v1/evidence/fetch', payload: { deal_id: '' } });
  assert.equal(badBody.statusCode, 400);

  const missingDeal = await app.inject({ method: 'POST', url: '/api/v1/evidence/fetch', payload: { deal_id: 'missing' } });
  assert.equal(missingDeal.statusCode, 404);

  await app.close();
});

test('GET /api/v1/deals/:deal_id/evidence returns evidence or empty', async () => {
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM deals')) {
        return { rows: params[0] === 'deal-1' ? [{ id: 'deal-1' }] : [] };
      }
      if (sql.includes('FROM evidence')) {
        return { rows: [{ evidence_id: 'ev-1', deal_id: 'deal-1', document_id: null, source: 'fetch_evidence', kind: 'document', text: 'Title', excerpt: 'Excerpt', created_at: new Date().toISOString() }] };
      }
      return { rows: [] };
    }
  } as any;

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool);

  const ok = await app.inject({ method: 'GET', url: '/api/v1/deals/deal-1/evidence' });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.evidence.length, 1);

  const missing = await app.inject({ method: 'GET', url: '/api/v1/deals/absent/evidence' });
  assert.equal(missing.statusCode, 200);
  const missingBody = missing.json();
  assert.equal(missingBody.evidence.length, 0);

  await app.close();
});
