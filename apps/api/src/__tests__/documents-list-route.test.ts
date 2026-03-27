process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDocumentRoutes } from '../routes/documents';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/v1/deals/:deal_id/documents returns size_bytes and canonical status vocabulary', async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      queries.push({ sql: text, params });

      if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
        const col = String((params ?? [])[1] ?? '');
        if (col === 'size_bytes' || col === 'extraction_metadata' || col === 'created_by_user_id') {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'deal-1',
              created_by_user_id: null,
            },
          ],
        };
      }

      if (text.includes('FROM documents') && text.includes('WHERE deal_id = $1')) {
        return {
          rows: [
            {
              id: 'doc-legacy',
              deal_id: 'deal-1',
              title: 'Legacy Deck',
              type: 'pitch_deck',
              status: 'completed',
              uploaded_at: new Date('2026-03-20T00:00:00.000Z').toISOString(),
              size_bytes: null,
              extraction_metadata: { fileSizeBytes: 1234 },
            },
            {
              id: 'doc-canonical',
              deal_id: 'deal-1',
              title: 'Canonical Deck',
              type: 'pitch_deck',
              status: 'ready_for_analysis',
              uploaded_at: new Date('2026-03-21T00:00:00.000Z').toISOString(),
              size_bytes: 2048,
              extraction_metadata: null,
            },
            {
              id: 'doc-unknown',
              deal_id: 'deal-1',
              title: 'Unknown Status Doc',
              type: 'other',
              status: 'mystery_status',
              uploaded_at: new Date('2026-03-22T00:00:00.000Z').toISOString(),
              size_bytes: null,
              extraction_metadata: null,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/deals/deal-1/documents',
  });

  assert.equal(res.statusCode, 200);

  const body = res.json() as any;
  assert.equal(Array.isArray(body.documents), true);
  assert.equal(body.documents.length, 3);

  const legacy = body.documents.find((d: any) => d.document_id === 'doc-legacy');
  assert.equal(legacy.status, 'ready_for_analysis');
  assert.equal(legacy.size_bytes, 1234);

  const canonical = body.documents.find((d: any) => d.document_id === 'doc-canonical');
  assert.equal(canonical.status, 'ready_for_analysis');
  assert.equal(canonical.size_bytes, 2048);

  const unknown = body.documents.find((d: any) => d.document_id === 'doc-unknown');
  assert.equal(unknown.status, 'needs_review');
  assert.equal(typeof unknown.size_bytes, 'undefined');

  const docsQuery = queries.find((q) => q.sql.includes('FROM documents') && q.sql.includes('size_bytes'));
  assert.ok(docsQuery, 'expected list query to include size_bytes');
  assert.ok(docsQuery?.sql.includes('deleted_at IS NULL'), 'expected list query to exclude soft-deleted documents');

  await app.close();
});
