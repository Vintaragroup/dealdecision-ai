process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.R2_ENDPOINT = process.env.R2_ENDPOINT || 'https://example.r2.cloudflarestorage.com';
process.env.R2_BUCKET = process.env.R2_BUCKET || 'test-bucket';
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'test-access';
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'test-secret';
process.env.R2_REGION = process.env.R2_REGION || 'auto';
process.env.R2_SIGNED_URL_TTL_SECONDS = process.env.R2_SIGNED_URL_TTL_SECONDS || '3600';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { registerDocumentRoutes } from '../src/routes/documents';
import { closeQueues } from '../src/lib/queue';

function buildMultipartBody(args: {
  boundary: string;
  fields: Record<string, string>;
  file: { fieldname: string; filename: string; contentType: string; bytes: Buffer };
}): Buffer {
  const CRLF = '\r\n';
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(args.fields)) {
    parts.push(
      Buffer.from(
        `--${args.boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
          `${value}${CRLF}`
      )
    );
  }

  parts.push(
    Buffer.from(
      `--${args.boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${args.file.fieldname}"; filename="${args.file.filename}"${CRLF}` +
        `Content-Type: ${args.file.contentType}${CRLF}${CRLF}`
    )
  );
  parts.push(args.file.bytes);
  parts.push(Buffer.from(CRLF));
  parts.push(Buffer.from(`--${args.boundary}--${CRLF}`));

  return Buffer.concat(parts);
}

test.after(async () => {
  await closeQueues();
});

test('multipart upload streams to R2 and enqueues from_storage ingest', async () => {
  const calls: { inserts: number; updates: number; selects: number } = { inserts: 0, updates: 0, selects: 0 };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('SELECT 1 FROM deals') && q.includes('WHERE id = $1')) {
        calls.selects += 1;
        return { rows: [{ ok: 1 }] };
      }

      if (q.includes("information_schema.columns")) {
        return { rows: [{ ok: 1 }] };
      }

      if (q.includes('BEGIN') || q.includes('COMMIT') || q.includes('ROLLBACK')) {
        return { rows: [] };
      }

      if (q.includes('INSERT INTO documents') && q.includes('RETURNING id')) {
        calls.inserts += 1;
        assert.ok(Array.isArray(params));
        const id = String((params as any)[0]);
        const dealId = String((params as any)[1]);
        return {
          rows: [
            {
              id,
              deal_id: dealId,
              title: (params as any)[2] ?? 'Doc',
              type: (params as any)[3] ?? 'other',
              status: (params as any)[4] ?? 'pending',
              uploaded_at: new Date().toISOString(),
            },
          ],
        };
      }

      if (q.trim().startsWith('UPDATE documents')) {
        calls.updates += 1;
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const enqueued: any[] = [];

  const r2 = {
    getR2Config: () => ({ bucket: 'test-bucket', signedUrlTtlSeconds: 3600 }),
    getPublicUrlForKey: () => null,
    deleteFromR2: async () => {},
    getSignedDownloadUrl: async ({ key }: { key: string }) => `https://signed.example/${encodeURIComponent(key)}`,
    uploadToR2: async ({ key, body }: { key: string; body: any }) => {
      let bytes = 0;
      for await (const chunk of body) bytes += Buffer.byteLength(chunk);
      return { bucket: 'test-bucket', key, etag: 'etag-test', size_bytes: bytes };
    },
  };

  const app = Fastify({ logger: false });
  try {
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

    await registerDocumentRoutes(app, mockPool, {
      enqueueJob: async (args: any) => {
        enqueued.push(args);
        return { job_id: 'job-1', status: 'queued' } as any;
      },
      autoProgressDealStage: async () => ({ progressed: false } as any),
      r2: r2 as any,
    });

    const boundary = '----dealdecision-test-boundary';
    const fileBytes = Buffer.from('%PDF-1.4 test pdf bytes');
    const payload = buildMultipartBody({
      boundary,
      fields: { type: 'other', title: 'Acme Pitch Deck.pdf' },
      file: { fieldname: 'file', filename: 'Acme Pitch Deck.pdf', contentType: 'application/pdf', bytes: fileBytes },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/deal-1/documents',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    assert.equal(res.statusCode, 202);
    const body = res.json() as any;
    assert.equal(body.upload?.provider, 'r2');
    assert.equal(body.upload?.bucket, 'test-bucket');
    assert.ok(typeof body.upload?.key === 'string' && body.upload.key.includes('deals/deal-1/documents/'));
    assert.equal(body.upload?.size_bytes, fileBytes.length);

    assert.equal(calls.inserts, 1);
    assert.ok(calls.updates >= 1);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0]?.payload?.mode, 'from_storage');
  } finally {
    await app.close();
  }
});

test('multipart upload returns 500 and does not insert document when R2 upload fails', async () => {
  let inserted = 0;

  const mockPool = {
    query: async (sql: string) => {
      const q = String(sql);
      if (q.includes('SELECT 1 FROM deals') && q.includes('WHERE id = $1')) {
        return { rows: [{ ok: 1 }] };
      }
      if (q.includes("information_schema.columns")) {
        return { rows: [{ ok: 1 }] };
      }
      if (q.includes('INSERT INTO documents')) {
        inserted += 1;
        return { rows: [] };
      }
      if (q.includes('BEGIN') || q.includes('COMMIT') || q.includes('ROLLBACK')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as any;

  const r2 = {
    getR2Config: () => ({ bucket: 'test-bucket', signedUrlTtlSeconds: 3600 }),
    getPublicUrlForKey: () => null,
    deleteFromR2: async () => {},
    getSignedDownloadUrl: async () => 'https://signed.example/fake',
    uploadToR2: async () => {
      throw Object.assign(new Error('PutObject failed'), { name: 'PutObjectError', $metadata: { httpStatusCode: 500 } });
    },
  };

  const app = Fastify({ logger: false });
  try {
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

    await registerDocumentRoutes(app, mockPool, {
      enqueueJob: async () => ({ job_id: 'job-1', status: 'queued' } as any),
      autoProgressDealStage: async () => ({ progressed: false } as any),
      r2: r2 as any,
    });

    const boundary = '----dealdecision-test-boundary-2';
    const payload = buildMultipartBody({
      boundary,
      fields: { type: 'other', title: 'Acme Pitch Deck.pdf' },
      file: { fieldname: 'file', filename: 'Acme Pitch Deck.pdf', contentType: 'application/pdf', bytes: Buffer.from('pdf') },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/deal-1/documents',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    assert.equal(res.statusCode, 500);
    assert.equal(inserted, 0);
  } finally {
    await app.close();
  }
});
