process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/v1/deals/:deal_id exposes additive fundability_v1 when present in latest DIO', async () => {
  const dealId = 'deal-fundability-1';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        // Simulate missing evidence table to keep the handler on the no-op path.
        return { rows: [{ oid: null }] };
      }

      if (q.includes('information_schema.columns')) {
        // Feature detection via hasColumn(...)
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: dealId,
              name: 'Fundability Deal',
              stage: 'intake',
              priority: 'medium',
              trend: null,
              score: null,
              owner: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-02T00:00:00.000Z',
              deleted_at: null,
            },
          ],
        };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [] };
      }

      if (q.includes('FROM deal_intelligence_objects') && q.includes('ORDER BY analysis_version DESC') && q.includes('LIMIT 1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              dio_id: '11111111-1111-1111-1111-111111111111',
              analysis_version: 123,
              recommendation: 'CONSIDER',
              overall_score: 81,
              updated_at: '2026-01-02T00:00:00.000Z',
              dio_data: {
                dio: {
                  spec_versions: { analysis_foundation: '0.1.0' },
                  phase_inference_v1: {
                    company_phase: 'SEED',
                    confidence: 0.7,
                    supporting_evidence: [{ signal: 'traction', source: 'doc', note: 'MRR mentioned' }],
                    missing_evidence: [],
                    rationale: ['Some traction signals present'],
                  },
                  fundability_assessment_v1: {
                    outcome: 'CONDITIONAL',
                    reasons: ['Need clearer GTM metrics'],
                    legacy_overall_score_0_100: 81,
                    fundability_score_0_100: 75,
                    caps: { max_fundability_score_0_100: 80 },
                  },
                  fundability_decision_v1: {
                    outcome: 'CONDITIONAL',
                    should_block_investment: false,
                    missing_required_signals: ['revenue_retention'],
                    next_requests: ['provide_evidence:revenue_retention'],
                  },
                  phase1: {
                    claims: [],
                  },
                },
              },
            },
          ],
        };
      }

      if (q.includes('SELECT COUNT(*)::int AS run_count') && q.includes('FROM deal_intelligence_objects')) {
        assert.equal(p0, dealId);
        return { rows: [{ run_count: 1, last_analyzed_at: '2026-01-02T00:00:00.000Z' }] };
      }

      if (q.includes('FROM deal_phase_b_runs') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

  const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}` });
  assert.equal(res.statusCode, 200);

  const body = res.json() as any;
  assert.equal(body.id, dealId);

  assert.ok(body.fundability_v1);
  assert.equal(body.fundability_v1.spec_version, '0.1.0');
  assert.equal(body.fundability_v1.phase_inference_v1.company_phase, 'SEED');
  assert.equal(body.fundability_v1.fundability_assessment_v1.fundability_score_0_100, 75);
  assert.equal(body.fundability_v1.fundability_decision_v1.should_block_investment, false);

  // Legacy score stays where it was (no migration in this change).
  assert.equal(body.score ?? null, 81);

  await app.close();
});
