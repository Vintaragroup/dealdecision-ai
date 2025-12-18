import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerJobRoutes } from '../src/routes/jobs';

type MockRow = {
  job_id: string;
  type: string | null;
  status: string;
  progress_pct: number | null;
  message: string | null;
  deal_id: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
};

test('GET /api/v1/jobs/:job_id returns job data with progress and message', async () => {
  const mockRow: MockRow = {
    job_id: 'job-123',
    type: 'ingest_document',
    status: 'running',
    progress_pct: 45,
    message: 'Processing documents',
    deal_id: 'deal-abc',
    document_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:05.000Z',
  };

  const mockPool = {
    query: async (_sql: string, params: unknown[]) => {
      assert.equal(params[0], mockRow.job_id, 'job_id parameter should be forwarded');
      return { rows: [mockRow] };
    }
  } as any;

  const app = Fastify();
  await registerJobRoutes(app, mockPool);

  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${mockRow.job_id}`,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  assert.equal(body.job_id, mockRow.job_id);
  assert.equal(body.type, mockRow.type ?? undefined);
  assert.equal(body.status, mockRow.status);
  assert.equal(body.progress_pct, mockRow.progress_pct);
  assert.equal(body.message, mockRow.message ?? undefined);
  assert.equal(body.deal_id, mockRow.deal_id ?? undefined);
  assert.equal(body.document_id, mockRow.document_id ?? undefined);
  assert.equal(body.created_at, mockRow.created_at);
  assert.equal(body.updated_at, mockRow.updated_at);
});

test('GET /api/v1/jobs/:job_id returns 404 when missing', async () => {
  const mockPool = {
    query: async () => ({ rows: [] })
  } as any;

  const app = Fastify();
  await registerJobRoutes(app, mockPool);

  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/not-found`,
  });

  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.error, 'Job not found');
});
