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
    return { id: 1, job_id: 'job-123', status: 'queued' as const };
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
  await registerEvidenceRoutes(app, mockPool, async () => ({ id: 1, job_id: 'job-1', status: 'queued' as const }));

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

test('GET /api/v1/evidence/resolve handles doc:<uuid>:page:<n> format', async () => {
  const docId = 'd636df8d-de94-48bc-a0c3-aa55035548a4';
  const refId = `doc:${docId}:page:11`;
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('information_schema.columns') && sql.includes('evidence')) {
        return { rows: [{ oid: 'evidence' }] };
      }
      if (sql.includes('to_regclass') && (params as string[])[0] === 'evidence') {
        return { rows: [{ oid: 'evidence' }] };
      }
      if (sql.includes('to_regclass') && (params as string[])[0] === 'documents') {
        return { rows: [{ oid: 'documents' }] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ oid: null }] };
      }
      if (sql.includes('FROM documents') && sql.includes('deleted_at IS NULL')) {
        return { rows: [{ id: docId, title: 'Climatic PitchDeck (5).pdf' }] };
      }
      return { rows: [] };
    }
  } as any;

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool, async () => ({ id: 1, job_id: 'job-1', status: 'queued' as const }));

  const res = await app.inject({ method: 'GET', url: `/api/v1/evidence/resolve?ids=${encodeURIComponent(refId)}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.results.length, 1);
  const result = body.results[0];
  assert.equal(result.id, refId);
  assert.equal(result.ok, true);
  assert.equal(result.resolvable, true);
  assert.equal(result.document_id, docId);
  assert.equal(result.document_title, 'Climatic PitchDeck (5).pdf');
  assert.equal(result.page, 11);

  await app.close();
});

test('GET /api/v1/evidence/resolve handles doc:<uuid>:page_index:<n> format', async () => {
  const docId = 'f23ba1b8-85b8-4ce0-a8c6-ac3eaf22588b';
  const refId = `doc:${docId}:page_index:9`;
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('to_regclass') && (params as string[])[0] === 'documents') {
        return { rows: [{ oid: 'documents' }] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ oid: null }] };
      }
      if (sql.includes('FROM documents') && sql.includes('deleted_at IS NULL')) {
        return { rows: [{ id: docId, title: 'Allurion Deck.pdf' }] };
      }
      return { rows: [] };
    }
  } as any;

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool, async () => ({ id: 1, job_id: 'job-1', status: 'queued' as const }));

  const res = await app.inject({ method: 'GET', url: `/api/v1/evidence/resolve?ids=${encodeURIComponent(refId)}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const result = body.results[0];
  assert.equal(result.ok, true);
  assert.equal(result.document_title, 'Allurion Deck.pdf');
  assert.equal(result.page, 9);

  await app.close();
});

test('GET /api/v1/evidence/resolve falls back to evidence_items for unresolved bare UUID', async () => {
  const uuidRef = '523c18fb-1067-4b7a-bbde-81713bf4ecc4';
  const docId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const mockPool = {
    query: async (sql: string, _params: unknown[]) => {
      if (sql.includes('to_regclass') && (_params as string[])[0] === 'evidence') {
        return { rows: [{ oid: 'evidence' }] };
      }
      if (sql.includes('to_regclass') && (_params as string[])[0] === 'evidence_items') {
        return { rows: [{ oid: 'evidence_items' }] };
      }
      if (sql.includes('to_regclass') && (_params as string[])[0] === 'documents') {
        return { rows: [{ oid: 'documents' }] };
      }
      if (sql.includes('to_regclass')) return { rows: [{ oid: null }] };
      if (sql.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };
      if (sql.includes('data_type')) return { rows: [{ data_type: 'uuid' }] };
      // evidence table lookup: return empty (not found)
      if (sql.includes('FROM evidence e') && !sql.includes('information_schema')) {
        return { rows: [] };
      }
      // evidence_items fallback: return a match
      if (sql.includes('FROM evidence_items')) {
        return { rows: [{ evidence_id: uuidRef, source_document_id: docId, content_text: 'Some risk text', doc_title: 'Risk Report.pdf' }] };
      }
      return { rows: [] };
    }
  } as any;

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool, async () => ({ id: 1, job_id: 'job-1', status: 'queued' as const }));

  const res = await app.inject({ method: 'GET', url: `/api/v1/evidence/resolve?ids=${encodeURIComponent(uuidRef)}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const result = body.results[0];
  assert.equal(result.ok, true);
  assert.equal(result.document_title, 'Risk Report.pdf');
  assert.equal(result.snippet, 'Some risk text');

  await app.close();
});

test('GET /api/v1/evidence/resolve returns ok:false for unresolvable opaque ref', async () => {
  const opaqueRef = 'pdf_kpi_line source=pagev1:abc page=3 metric=cac';
  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('to_regclass') && (params as string[])[0] === 'documents') {
        return { rows: [{ oid: 'documents' }] };
      }
      if (sql.includes('to_regclass')) return { rows: [{ oid: null }] };
      return { rows: [] };
    }
  } as any;

  const app = Fastify();
  await registerEvidenceRoutes(app, mockPool, async () => ({ id: 1, job_id: 'job-1', status: 'queued' as const }));

  const res = await app.inject({ method: 'GET', url: `/api/v1/evidence/resolve?ids=${encodeURIComponent(opaqueRef)}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.results[0].ok, false);

  await app.close();
});
