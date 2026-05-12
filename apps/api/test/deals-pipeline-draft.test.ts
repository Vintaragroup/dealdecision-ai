process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

/**
 * GET /api/v1/deals?lifecycle=active must include draft deals.
 * Root cause fix: newly created deals start with lifecycle_status='draft' and must
 * be visible in the active pipeline immediately after creation.
 */
test('GET /api/v1/deals?lifecycle=active includes draft lifecycle_status deals', async () => {
  const now = new Date().toISOString();
  let capturedSql = '';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      // Schema presence checks
      if (q.includes('information_schema.columns')) {
        const col = params?.[1];
        if (col === 'lifecycle_status' || col === 'org_id') {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      // Main SELECT query — capture and return a draft deal
      if (q.includes('FROM deals d') && q.includes('LEFT JOIN LATERAL')) {
        capturedSql = q;
        return {
          rows: [
            {
              id: 'deal-draft-vis-1',
              name: 'Draft Visibility Deal',
              stage: 'intake',
              priority: 'medium',
              lifecycle_status: 'draft',
              llm_phase_mode: 'exploratory',
              trend: 'stable',
              score: null,
              owner: null,
              created_at: now,
              updated_at: now,
              deleted_at: null,
              // lateral join columns
              dio_id: null,
              analysis_version: null,
              recommendation: null,
              overall_score: null,
              overall_score_resolved: null,
              last_analyzed_at: null,
              run_count: null,
              selected_policy: null,
              policy_id: null,
              deal_classification_v1: null,
              executive_summary_v1: null,
              executive_summary_v2: null,
              decision_summary_v1: null,
              phase1_coverage: null,
              phase1_business_archetype_v1: null,
              phase1_deal_overview_v2: null,
              phase1_update_report_v1: null,
              deal_summary_v2: null,
              analysis_foundation_spec_version: null,
              phase_inference_v1: null,
              fundability_assessment_v1: null,
              fundability_decision_v1: null,
              phase_b_latest_run: null,
              phase_b_history: null,
              canonical_decision_v1: null,
            },
          ],
        };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deals?lifecycle=active',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any[];
    assert.ok(Array.isArray(body), 'Response should be an array');

    // The draft deal must be returned in the active pipeline
    const draftDeal = body.find((d: any) => d.id === 'deal-draft-vis-1');
    assert.ok(draftDeal, 'Draft deal must appear in active pipeline response');
    assert.equal(draftDeal.lifecycle_status, 'draft');

    // The WHERE clause must use IN ('active', 'draft'), not = 'active'
    assert.ok(
      capturedSql.includes(`IN ('active', 'draft')`),
      `Expected SQL to contain IN ('active', 'draft') but got: ${capturedSql.slice(capturedSql.indexOf('COALESCE'), capturedSql.indexOf('COALESCE') + 120)}`
    );
  } finally {
    await app.close();
  }
});

test('GET /api/v1/deals?lifecycle=archived does not include draft deals', async () => {
  const now = new Date().toISOString();
  let capturedSql = '';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('information_schema.columns')) {
        const col = params?.[1];
        if (col === 'lifecycle_status' || col === 'org_id') {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.includes('FROM deals d') && q.includes('LEFT JOIN LATERAL')) {
        capturedSql = q;
        return { rows: [] };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    await app.inject({
      method: 'GET',
      url: '/api/v1/deals?lifecycle=archived',
    });

    // For archived filter, must use = 'archived', not IN
    assert.ok(
      capturedSql.includes(`= $`) && !capturedSql.includes(`IN ('active', 'draft')`),
      `Archived filter should use = $param, not IN ('active', 'draft')`
    );
  } finally {
    await app.close();
  }
});

test('GET /api/v1/deals?lifecycle=active active deal is still returned', async () => {
  const now = new Date().toISOString();

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes('information_schema.columns')) {
        const col = params?.[1];
        if (col === 'lifecycle_status' || col === 'org_id') {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.includes('FROM deals d') && q.includes('LEFT JOIN LATERAL')) {
        return {
          rows: [
            {
              id: 'deal-active-1',
              name: 'Active Deal',
              stage: 'intake',
              priority: 'medium',
              lifecycle_status: 'active',
              llm_phase_mode: 'exploratory',
              trend: 'stable',
              score: null,
              owner: null,
              created_at: now,
              updated_at: now,
              deleted_at: null,
              dio_id: null, analysis_version: null, recommendation: null, overall_score: null,
              overall_score_resolved: null, last_analyzed_at: null, run_count: null,
              selected_policy: null, policy_id: null, deal_classification_v1: null,
              executive_summary_v1: null, executive_summary_v2: null, decision_summary_v1: null,
              phase1_coverage: null, phase1_business_archetype_v1: null, phase1_deal_overview_v2: null,
              phase1_update_report_v1: null, deal_summary_v2: null, analysis_foundation_spec_version: null,
              phase_inference_v1: null, fundability_assessment_v1: null, fundability_decision_v1: null,
              phase_b_latest_run: null, phase_b_history: null, canonical_decision_v1: null,
            },
          ],
        };
      }

      return { rows: [] };
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deals?lifecycle=active',
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any[];
    const activeDeal = body.find((d: any) => d.id === 'deal-active-1');
    assert.ok(activeDeal, 'Active deal must still appear in active pipeline');
  } finally {
    await app.close();
  }
});
