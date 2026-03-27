process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDocumentRoutes } from '../routes/documents';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('POST /documents/upload returns 409 when content hash already exists and duplicate policy is skip', async () => {
  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql);

      if (text.includes('information_schema.columns') && text.includes("column_name = $2")) {
        const col = String((params ?? [])[1] ?? '');
        if (col === 'created_by_user_id') return { rows: [{ ok: 1 }] };
        return { rows: [] };
      }

      if (text.includes('FROM deals') && text.includes('WHERE id = $1')) {
        return { rows: [{ id: 'deal-1', created_by_user_id: null }] };
      }

      if (text.includes("extraction_metadata->>'original_bytes_sha256' = $2")) {
        return {
          rows: [
            {
              id: 'existing-doc-1',
              title: 'pitch.pdf',
              status: 'ready_for_analysis',
              uploaded_at: new Date('2026-03-27T00:00:00.000Z').toISOString(),
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;

  const app = Fastify();
  await registerDocumentRoutes(app, mockPool);

  const payload = {
    file_name: 'pitch.pdf',
    title: 'pitch.pdf',
    type: 'pitch_deck',
    duplicate_policy: 'skip',
    file_buffer: Buffer.from('same-content').toString('base64'),
  };

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/deals/deal-1/documents/upload',
    payload,
  });

  assert.equal(res.statusCode, 409);
  const body = res.json() as any;
  assert.equal(body.error, 'Duplicate document detected for this deal');
  assert.equal(body.duplicate_policy, 'skip');
  assert.equal(Array.isArray(body.duplicates), true);
  assert.equal(body.duplicates.length, 1);

  await app.close();
});
