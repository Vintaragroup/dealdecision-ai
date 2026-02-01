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

test('GET /api/v1/deals/:deal_id/jobs preserves succeeded_with_warnings status (no collapse)', async () => {
  const mockDealId = '00000000-0000-0000-0000-000000000001';
  const now = '2026-01-28T00:00:00.000Z';

  const columns = [
    'job_id',
    'queue',
    'type',
    'status',
    'stage',
    'progress_current',
    'progress_total',
    'progress_pct',
    'message',
    'deal_id',
    'document_id',
    'parent_job_id',
    'page_start',
    'page_end',
    'error',
    'created_at',
    'updated_at',
    'started_at',
    'finished_at',
    'status_detail',
  ];

  const mockRow: any = {
    job_id: 'job-warn-1',
    queue: 'extract_visuals',
    type: 'extract_visuals',
    status: 'succeeded_with_warnings',
    stage: 'finalize',
    progress_current: null,
    progress_total: null,
    progress_pct: 100,
    message: 'Visual extraction succeeded with warnings',
    deal_id: mockDealId,
    document_id: null,
    parent_job_id: null,
    page_start: null,
    page_end: null,
    error: null,
    created_at: now,
    updated_at: now,
    started_at: now,
    finished_at: now,
    status_detail: { progress: { stage: 'finalize', percent: 100, message: 'Done (warn)' } },
  };

  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('information_schema.columns') && sql.includes("table_name = 'jobs'")) {
        return { rows: columns.map((c) => ({ column_name: c })) };
      }
      assert.equal(params[0], mockDealId, 'deal_id should be forwarded');
      return { rows: [mockRow] };
    },
  } as any;

  const app = Fastify();
  await registerJobRoutes(app, mockPool);

  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/deals/${mockDealId}/jobs?limit=10&type=extract_visuals`,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(Array.isArray(body));
  assert.equal(body[0].job_id, mockRow.job_id);
  assert.equal(body[0].status, 'succeeded_with_warnings');
  assert.equal(body[0].progress_pct, 100);
  assert.equal(body[0].status_detail?.progress?.percent, 100);
});
