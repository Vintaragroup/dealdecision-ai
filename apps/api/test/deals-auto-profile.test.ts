process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { normalizeWarningsForPersistence } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('normalizeWarningsForPersistence splits bullet-separated warnings and always returns string[]|null', async () => {
  assert.deepEqual(normalizeWarningsForPersistence(undefined), null);
  assert.deepEqual(normalizeWarningsForPersistence(null), null);
  assert.deepEqual(normalizeWarningsForPersistence(''), null);

  assert.deepEqual(normalizeWarningsForPersistence('a'), ['a']);
  assert.deepEqual(normalizeWarningsForPersistence('a • b'), ['a', 'b']);
  assert.deepEqual(normalizeWarningsForPersistence(['a • b', 'c']), ['a', 'b', 'c']);
});

test('POST /api/v1/deals/:deal_id/auto-profile returns shaped response and persists proposal when columns exist', async () => {
  const dealId = 'deal-123';
  const seen: string[] = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      seen.push(q);

      if (q.includes('to_regclass')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        if (table === 'document_files') return { rows: [{ oid: 'document_files' }] };
        return { rows: [{ oid: null }] };
      }

      if (q.includes('FROM information_schema.columns')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        const col = Array.isArray(params) ? String((params as any)[1]) : '';
        if (table === 'deals' && ['proposed_profile', 'proposed_profile_confidence', 'proposed_profile_sources', 'proposed_profile_warnings', 'lifecycle_status', 'industry', 'investment_type', 'round'].includes(col)) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if ((q.includes('FROM documents d') || q.includes('FROM documents')) && q.includes('WHERE') && q.includes('deal_id = $1')) {
        assert.equal(Array.isArray(params) ? (params as any)[0] : undefined, dealId);
        return {
          rows: [
            {
              id: 'doc-1',
              title: 'Acme Pitch Deck.pdf',
              file_name: 'Acme Pitch Deck.pdf',
              full_text: 'Company Name: Acme Inc\nRound: Seed\nWe are raising a Seed round via SAFE.\nIndustry: FinTech\n',
              structured_data: null,
              full_content: null,
            },
          ],
        };
      }

      if (q.includes('UPDATE deals') && q.includes('SET proposed_profile')) {
        assert.equal(Array.isArray(params) ? (params as any)[0] : undefined, dealId);
        const proposed = (params as any)[1];
        assert.equal(proposed.company_name, 'Acme Inc');

        // proposed_profile_warnings must be persisted as a JSON array (never a single bullet-joined string)
        const warningsParam = (params as any)[4];
        assert.equal(typeof warningsParam, 'object');
        assert.ok(typeof warningsParam?.toPostgres === 'function');
        const serialized = warningsParam.toPostgres();
        assert.equal(typeof serialized, 'string');
        const decoded = JSON.parse(serialized);
        assert.ok(Array.isArray(decoded));

        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${dealId}/auto-profile`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;

    assert.equal(body.deal_id, dealId);
    assert.ok(body.proposed_profile);
    assert.equal(body.proposed_profile.company_name, 'Acme Inc');
    assert.equal(body.proposed_profile.round, 'seed');
    assert.equal(body.proposed_profile.investment_type, 'safe');
    assert.equal(body.proposed_profile.industry, 'FinTech');
    assert.ok(body.confidence);
    assert.ok(body.sources);
    assert.ok(Array.isArray(body.warnings));
  } finally {
    await app.close();
  }
});

test('auto-profile prefers early full_text over generic PD filename', async () => {
  const dealId = 'deal-456';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('to_regclass')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        if (table === 'document_files') return { rows: [{ oid: 'document_files' }] };
        return { rows: [{ oid: null }] };
      }

      if (q.includes('FROM information_schema.columns')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        const col = Array.isArray(params) ? String((params as any)[1]) : '';
        if (table === 'deals' && ['proposed_profile', 'proposed_profile_confidence', 'proposed_profile_sources', 'proposed_profile_warnings'].includes(col)) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.includes('FROM documents d') && q.includes('LEFT JOIN document_files')) {
        assert.equal(Array.isArray(params) ? (params as any)[0] : undefined, dealId);
        return {
          rows: [
            {
              id: 'doc-1',
              title: 'PD',
              file_name: 'PD.pdf',
              full_text: 'Webmax\nPitch Deck\nWe build infrastructure for X.\n',
              structured_data: null,
              full_content: null,
            },
          ],
        };
      }

      if (q.includes('UPDATE deals') && q.includes('SET proposed_profile')) {
        const proposed = (params as any)[1];
        assert.equal(proposed.company_name, 'Webmax');
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${dealId}/auto-profile`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.proposed_profile.company_name, 'Webmax');
  } finally {
    await app.close();
  }
});

test('auto-profile does not infer company_name from generic PD-only filename', async () => {
  const dealId = 'deal-789';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('to_regclass')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        if (table === 'document_files') return { rows: [{ oid: 'document_files' }] };
        return { rows: [{ oid: null }] };
      }

      if (q.includes('FROM information_schema.columns')) {
        const table = Array.isArray(params) ? String((params as any)[0]) : '';
        const col = Array.isArray(params) ? String((params as any)[1]) : '';
        if (table === 'deals' && ['proposed_profile', 'proposed_profile_confidence', 'proposed_profile_sources', 'proposed_profile_warnings'].includes(col)) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.includes('FROM documents d') && q.includes('LEFT JOIN document_files')) {
        assert.equal(Array.isArray(params) ? (params as any)[0] : undefined, dealId);
        return {
          rows: [
            {
              id: 'doc-1',
              title: 'PD',
              file_name: 'PD',
              full_text: 'Pitch Deck\n',
              structured_data: null,
              full_content: null,
            },
          ],
        };
      }

      if (q.includes('UPDATE deals') && q.includes('SET proposed_profile')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${dealId}/auto-profile`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;
    assert.equal(body.proposed_profile.company_name, null);
    assert.ok(Array.isArray(body.warnings));
    assert.ok(body.warnings.some((w: string) => w.toLowerCase().includes('company_name not inferred')));
  } finally {
    await app.close();
  }
});
