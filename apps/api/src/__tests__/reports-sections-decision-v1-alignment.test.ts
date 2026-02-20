process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerReportRoutes } from '../routes/reports';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('Report sections use canonical decision_v1 (consider must not render as PASS) (latest + versioned)', async () => {
  const dealId = '00000000-0000-0000-0000-000000000123';

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
      if (sql.includes('FROM ingestion_reports') && sql.includes('analysis_version')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO ingestion_reports') && sql.includes('ON CONFLICT (deal_id, analysis_version)')) {
        return { rows: [{ report_id: 'ir-1' }] };
      }

      if (sql.includes('FROM deals') && sql.includes('WHERE id = $1') && sql.includes('deleted_at IS NULL')) {
        return { rows: [{ id: String(params[0] ?? dealId), llm_phase_mode: 'exploratory' }] };
      }

      if (sql.includes('FROM deal_intelligence_objects') && sql.includes('WHERE deal_id = $1') && !sql.includes('analysis_version = $2')) {
        return {
          rows: [
            {
              dio_id: 'dio-1',
              analysis_version: 1,
              recommendation: null,
              // 50 => score band v2 consider_caution => decision_v1.recommendation_key === "consider".
              overall_score: 50,
              updated_at: '2026-02-04T00:00:00.000Z',
              dio_data: dioData,
            },
          ],
        };
      }

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
    const sections: any[] = Array.isArray(body?.sections) ? body.sections : [];
    assert.ok(sections.length > 0, `url=${url} sections missing`);

    const executive = sections.find((s) => s && typeof s === 'object' && s.title === 'Executive Summary');
    assert.ok(executive && typeof executive === 'object', `url=${url} Executive Summary section missing`);

    const content = typeof executive.content === 'string' ? executive.content : '';
    assert.ok(content.length > 0, `url=${url} Executive Summary content missing`);

    assert.ok(!content.includes('PASS'), `url=${url} Executive Summary must not contain PASS; content=${JSON.stringify(content)}`);
    assert.ok(
      /Recommendation:\s*Consider/i.test(content),
      `url=${url} Executive Summary must contain consider/Consider; content=${JSON.stringify(content)}`
    );
  }

  await app.close();
});
