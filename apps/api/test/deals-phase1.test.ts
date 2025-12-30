process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

// Minimal contract: Phase 1 mode omits legacy scoring fields and includes phase1 executive + decision summaries.

test('GET /api/v1/deals/:deal_id?mode=phase1 returns phase1 payload and omits score/dioStatus', async () => {
  const dealId = 'deal-1';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      // Deal row fetch
      if (q.includes('SELECT * FROM deals WHERE id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: dealId,
              name: 'Demo Deal',
              stage: 'intake',
              priority: 'medium',
              trend: null,
              score: 88,
              owner: null,
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-02T00:00:00.000Z',
              deleted_at: null,
            },
          ],
        };
      }

      // DIO aggregate fetch
      if (q.includes('FROM deal_intelligence_objects') && q.includes("dio_data #> '{dio,phase1,executive_summary_v1}'")) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              dio_id: 'dio-1',
              analysis_version: 1,
              recommendation: 'SCREEN_WATCH',
              overall_score: 12,
              last_analyzed_at: '2024-01-03T00:00:00.000Z',
              run_count: 1,
              executive_summary_v1: {
                title: 'Demo Deal — Executive Summary',
                one_liner: 'Demo Deal: We are building a product for customers. Documents present: 1.',
                deal_type: 'Unknown',
                raise: 'Unknown',
                business_model: 'Unknown',
                traction_signals: [],
                key_risks_detected: [],
                unknowns: ['deal_type'],
                confidence: { overall: 'low' },
                evidence: [
                  { claim_id: 'c1', document_id: 'doc-1', snippet: 'x' },
                ],
              },
              decision_summary_v1: {
                score: 42,
                recommendation: 'CONSIDER',
                reasons: [
                  'Financial readiness data is missing (burn, runway, cash, margins).',
                  'Traction metrics are not disclosed (revenue/users/customers/growth/retention).',
                ],
                blockers: ['Financial readiness data is missing (burn, runway, cash, margins).'],
                next_requests: ['Add burn, runway, cash balance, and margin profile (or a simple P&L).'],
                confidence: 'low',
              },
              phase1_coverage: {
                sections: {
                  documents: 'present',
                  product: 'missing',
                  market: 'missing',
                  business_model: 'missing',
                  traction: 'missing',
                  terms: 'missing',
                  financials: 'missing',
                  risks: 'missing',
                },
              },
              phase1_claims: [
                {
                  claim_id: 'p1_other_1',
                  category: 'other',
                  text: 'Documents provided for analysis (1 total).',
                  evidence: [{ document_id: 'doc-1', snippet: 'x' }],
                },
              ],
            },
          ],
        };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerDealRoutes(app, mockPool);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deals/${dealId}?mode=phase1`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as any;

    assert.equal(body.id, dealId);

    // Phase 1 response should not expose legacy scoring fields.
    assert.equal('score' in body, false);
    assert.equal('dioStatus' in body, false);

    // Phase 1 payload should exist.
    assert.ok(body.phase1);
    assert.ok(body.phase1.executive_summary_v1);

    // Decision summary must exist in Phase 1 payload.
    assert.ok(body.phase1.decision_summary_v1);
    assert.equal(typeof body.phase1.decision_summary_v1.score, 'number');
    assert.ok(['PASS', 'CONSIDER', 'GO'].includes(String(body.phase1.decision_summary_v1.recommendation)));

    // Coverage must include the required keys.
    assert.ok(body.phase1.coverage);
    assert.ok(body.phase1.coverage.sections);
    for (const key of ['product', 'market', 'business_model', 'traction', 'terms', 'financials', 'risks']) {
      assert.ok(key in body.phase1.coverage.sections, `missing coverage.sections.${key}`);
    }

    // Blockers must not be identical to reasons.
    assert.notDeepEqual(body.phase1.decision_summary_v1.blockers, body.phase1.decision_summary_v1.reasons);

    // Evidence must be stripped.
    assert.equal('evidence' in body.phase1.executive_summary_v1, false);
    assert.ok(Array.isArray(body.phase1.top_claims));
    if (body.phase1.top_claims.length > 0) {
      assert.equal('evidence' in body.phase1.top_claims[0], false);
    }
  } finally {
    await app.close();
  }
});
