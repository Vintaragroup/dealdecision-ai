process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDocumentRoutes } from '../routes/documents';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /documents/extraction-report returns report shape and excludes deleted docs in query', async () => {
  const queries: string[] = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      queries.push(text);

      if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
        const col = String((params ?? [])[1] ?? '');
        if (col === 'created_by_user_id') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
        return { rows: [{ id: 'deal-1', created_by_user_id: null }] };
      }

      if (text.includes('FROM documents') && text.includes('verification_result')) {
        return {
          rows: [
            {
              id: 'doc-1',
              title: 'Pitch Deck.pdf',
              type: 'pitch_deck',
              status: 'ready_for_analysis',
              verification_status: 'verified',
              verification_result: {
                overall_score: 0.92,
                warning_flags: [],
                recommendations: [],
              },
              page_count: 12,
              extraction_metadata: {
                extraction_confidence: 0.92,
              },
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
    url: '/api/v1/deals/deal-1/documents/extraction-report',
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.deal_id, 'deal-1');
  assert.equal(Array.isArray(body.documents), true);
  assert.equal(body.documents.length, 1);
  assert.equal(typeof body.extraction_report, 'object');

  const extractionQuery = queries.find((q) => q.includes('FROM documents') && q.includes('verification_result'));
  assert.ok(extractionQuery, 'expected extraction report query');
  assert.ok(extractionQuery?.includes('deleted_at IS NULL'), 'expected extraction report query to exclude soft-deleted docs');

  await app.close();
});
