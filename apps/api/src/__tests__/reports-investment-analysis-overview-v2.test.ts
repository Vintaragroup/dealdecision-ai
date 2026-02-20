process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerReportRoutes } from '../routes/reports';
import { closeQueues } from '../lib/queue';

test.after(async () => {
  await closeQueues();
});

test('Report attaches deterministic investment_analysis_overview_v2 (latest + versioned)', async () => {
  const dealId = '00000000-0000-0000-0000-000000000099';

  const dioData = {
    deal_id: dealId,
    analysis_version: 1,
    inputs: {
      documents: [],
      evidence: [],
    },
    analyzer_results: {
      financial_health: {
        analyzer_version: '1.0.0',
        executed_at: '2026-02-04T00:00:00.000Z',
        status: 'ok',
        coverage: 0.8,
        confidence: 0.75,
        runway_months: 12.3,
        burn_multiple: null,
        health_score: 72,
        metrics: {
          revenue: null,
          expenses: null,
          cash_balance: null,
          burn_rate: null,
          growth_rate: null,
        },
        risks: [],
        evidence_ids: [],
      },
      risk_assessment: {
        analyzer_version: '1.0.0',
        executed_at: '2026-02-04T00:00:00.000Z',
        status: 'ok',
        coverage: 0.8,
        confidence: 0.75,
        overall_risk_score: 70,
        risks_by_category: {
          market: [
            {
              risk_id: '00000000-0000-0000-0000-000000000001',
              category: 'market',
              severity: 'high',
              description: 'Crowded category with well-funded incumbents',
              evidence_id: '00000000-0000-0000-0000-000000000011',
            },
          ],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 1,
        critical_count: 0,
        high_count: 1,
        evidence_ids: [],
      },
    },
    dio: {
      phase1: {
        business_archetype_v1: { value: 'saas', confidence: 0.82 },
        deal_overview_v2: {
          traction_signals: ['ARR mentioned', 'Customers mentioned'],
          traction_metrics: ['ARR: $1.2M'],
          key_risks_detected: ['Regulatory / compliance', 'Capital intensity'],
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
    assert.ok(!body?.error && !body?.message, `url=${url} returned error payload body=${res.body}`);
    const meta = body?.metadata;
    assert.ok(meta && typeof meta === 'object', `url=${url} metadata missing`);

    const v2 = meta.investment_analysis_overview_v2;
    assert.ok(v2 && typeof v2 === 'object', `url=${url} investment_analysis_overview_v2 missing`);

    assert.equal(v2.version, 'investment_analysis_overview_v2');
    assert.equal(v2.archetype?.value, 'saas');

    assert.equal(v2.traction?.present, true);
    assert.deepEqual(v2.traction?.signals, ['ARR mentioned', 'Customers mentioned']);

    assert.deepEqual(v2.top_risks?.items, ['Crowded category with well-funded incumbents']);
    assert.equal(v2.capital_profile?.runway_months, 12.3);
  }

  await app.close();
});
