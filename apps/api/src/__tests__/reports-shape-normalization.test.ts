process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerReportRoutes } from '../routes/reports';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('Report shape normalization ensures kpis.revenue.selection_reason (latest + versioned)', async () => {
  const dealId = '00000000-0000-0000-0000-000000000042';

  const dioData = {
    deal_id: dealId,
    analysis_version: 1,
    inputs: {
      documents: [],
      evidence: [],
    },
    analyzer_results: {},
    dio: {
      phase1: {
        deal_overview_v2: {
          raise: '$10M',
          business_model: 'DTC + wholesale',
          revenue: '$2.476M',
          customers: '100k customers',
          growth: '20% MoM',
          sources: [{ document_id: 'doc-1', page: 1, note: 'fixture' }],
        },
      },
    },
  };

  const missingTable = () => {
    const err: any = new Error('missing table');
    err.code = '42P01';
    throw err;
  };

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      // Deal existence check
      if (sql.includes('SELECT id FROM deals') && sql.includes('deleted_at IS NULL')) {
        return { rows: [{ id: String(params[0] ?? dealId) }] };
      }

      // Latest DIO lookup
      if (sql.includes('FROM deal_intelligence_objects') && sql.includes('WHERE deal_id = $1') && !sql.includes('analysis_version = $2')) {
        return {
          rows: [
            {
              dio_id: 'dio-1',
              analysis_version: 1,
              recommendation: null,
              overall_score: 50,
              updated_at: '2026-02-04T00:00:00.000Z',
              dio_data: dioData,
            },
          ],
        };
      }

      // Versioned DIO lookup
      if (sql.includes('FROM deal_intelligence_objects') && sql.includes('analysis_version = $2')) {
        return {
          rows: [
            {
              dio_data: dioData,
            },
          ],
        };
      }

      // Avoid promoted facts + DPU tables in this unit test.
      if (sql.includes('SELECT 1 FROM evidence_items')) return missingTable();
      if (sql.includes('SELECT 1 FROM document_page_understanding')) return missingTable();

      // Anything else is best-effort in route code; simulate missing tables.
      return missingTable();
    },
  } as any;

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  for (const url of [`/api/v1/deals/${dealId}/report`, `/api/v1/deals/${dealId}/report/1`]) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, `url=${url} status=${res.statusCode} body=${res.body}`);

    const body = res.json() as any;
    const structured = body.structured_summary;
    assert.ok(structured && typeof structured === 'object', `url=${url} structured_summary missing`);

    const kpis = structured.kpis;
    assert.ok(kpis && typeof kpis === 'object', `url=${url} structured_summary.kpis missing`);

    const kpiRevenue = kpis.revenue;
    assert.ok(kpiRevenue && typeof kpiRevenue === 'object', `url=${url} kpis.revenue missing`);

    assert.ok(typeof kpiRevenue.selection_reason === 'string' && kpiRevenue.selection_reason.length > 0, `url=${url} selection_reason missing`);

    // Must match the normalized structured_summary.revenue selection_reason.
    assert.equal(kpiRevenue.selection_reason, structured.revenue?.selection_reason);
  }

  await app.close();
});
