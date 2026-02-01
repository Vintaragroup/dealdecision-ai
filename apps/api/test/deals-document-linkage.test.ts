process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { registerDocumentRoutes } from '../src/routes/documents';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('upload-first uploads always link documents to the deal_id (repair if needed)', async () => {
  const deals = new Set<string>();
  const documents = new Map<string, { deal_id: string | null; title: string }>();
  let docCounter = 0;
  let jobCounter = 0;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('INSERT INTO deals') && q.includes('RETURNING id')) {
        const id = 'draft-deal-1';
        deals.add(id);
        return { rows: [{ id }] };
      }

      if (q.includes('SELECT 1 FROM deals') && q.includes('WHERE id = $1')) {
        const dealId = Array.isArray(params) ? String((params as any)[0]) : '';
        return { rows: deals.has(dealId) ? [{ ok: 1 }] : [] };
      }

      if (q.includes('FROM documents') && q.includes('LOWER(title)') && q.includes('WHERE deal_id = $1')) {
        // duplicate-title check
        return { rows: [] };
      }

      if (q.includes('INSERT INTO documents') && q.includes('RETURNING id, deal_id')) {
        assert.ok(Array.isArray(params));
        assert.equal((params as any)[0], 'draft-deal-1');

        const id = `doc-${++docCounter}`;
        const title = String((params as any)[1] ?? '');
        // Simulate the buggy behavior: deal_id comes back null.
        documents.set(id, { deal_id: null, title });

        return {
          rows: [
            {
              id,
              deal_id: null,
              title,
              type: (params as any)[2] ?? 'other',
              status: (params as any)[3] ?? 'pending',
              uploaded_at: new Date().toISOString(),
            },
          ],
        };
      }

      if (q.includes('UPDATE documents') && q.includes('SET deal_id = $1') && q.includes('RETURNING deal_id')) {
        assert.ok(Array.isArray(params));
        const dealId = String((params as any)[0] ?? '');
        const docId = String((params as any)[1] ?? '');
        const existing = documents.get(docId);
        if (existing) existing.deal_id = dealId;
        return { rows: [{ deal_id: dealId }] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);
    await registerDocumentRoutes(app, mockPool, {
      enqueueJob: async () => ({ job_id: `job-${++jobCounter}`, status: 'queued' } as any),
      autoProgressDealStage: async () => ({ progressed: false } as any),
    });

    const draftRes = await app.inject({ method: 'POST', url: '/api/v1/deals/draft', payload: {} });
    assert.equal(draftRes.statusCode, 201);
    const draft = draftRes.json() as any;
    assert.equal(draft.deal_id, 'draft-deal-1');

    const upload1 = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${draft.deal_id}/documents/upload`,
      payload: {
        file_buffer: Buffer.from('file-1').toString('base64'),
        file_name: 'Acme Pitch Deck.pdf',
        type: 'other',
        title: 'Acme Pitch Deck.pdf',
      },
    });
    assert.equal(upload1.statusCode, 202);
    const body1 = upload1.json() as any;
    assert.equal(body1.document?.deal_id, 'draft-deal-1');

    const upload2 = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${draft.deal_id}/documents/upload`,
      payload: {
        file_buffer: Buffer.from('file-2').toString('base64'),
        file_name: 'Acme Financials.xlsx',
        type: 'financials',
        title: 'Acme Financials.xlsx',
      },
    });
    assert.equal(upload2.statusCode, 202);
    const body2 = upload2.json() as any;
    assert.equal(body2.document?.deal_id, 'draft-deal-1');

    const linked = Array.from(documents.values()).filter((d) => d.deal_id === 'draft-deal-1');
    assert.equal(linked.length, 2);
  } finally {
    await app.close();
  }
});

test('document upload returns 404 when deal_id does not exist', async () => {
  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes('SELECT 1 FROM deals') && q.includes('WHERE id = $1')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDocumentRoutes(app, mockPool, {
      enqueueJob: async () => ({ job_id: 'job-1', status: 'queued' } as any),
      autoProgressDealStage: async () => ({ progressed: false } as any),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/missing-deal/documents/upload',
      payload: {
        file_buffer: Buffer.from('file').toString('base64'),
        file_name: 'Doc.pdf',
        type: 'other',
        title: 'Doc.pdf',
      },
    });

    assert.equal(res.statusCode, 404);
    const body = res.json() as any;
    assert.equal(body.error, 'Deal not found');
  } finally {
    await app.close();
  }
});
