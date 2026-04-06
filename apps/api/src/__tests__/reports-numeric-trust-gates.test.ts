process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStructuredNumericTrustGates } from '../routes/reports';

test('applyStructuredNumericTrustGates suppresses suspicious promoted raise and falls back revenue candidate', () => {
  const report: any = {
    structured_summary: {
      raise: {
        value: '$230MM',
        confidence: 0.75,
        value_json: { amount: { amount: 230000000, currency: 'USD' } },
        sources: [
          {
            kind: 'promoted_fact',
            slide_title:
              'Cost to Acquire $230M fully guaranteed contract. Three first-round draft picks and game suspension context.',
          },
        ],
      },
      revenue: {
        value: { amount: 230000000, currency: 'USD', period: null, raw: '$230M' },
        confidence: 0.66,
        selection_reason: 'company_total_preferred',
        sources: [
          {
            kind: 'promoted_fact',
            note_snippet: 'Cost to Acquire $230M, fully guaranteed contract. Three first-round draft picks.',
          },
        ],
        candidates: [
          {
            selected: true,
            amount: 230000000,
            value_raw: '$230M',
            confidence: 0.66,
            sources: [
              {
                kind: 'promoted_fact',
                note_snippet: 'Cost to Acquire $230M, fully guaranteed contract. Three first-round draft picks.',
              },
            ],
          },
          {
            selected: false,
            amount: 1000000,
            value_raw: '$1MM',
            confidence: 0.45,
            sources: [{ kind: 'deck' }],
          },
        ],
      },
    },
  };

  applyStructuredNumericTrustGates(report);

  assert.equal(report.structured_summary.raise.value, null);
  assert.equal(report.structured_summary.raise.suppressed_reason, 'low_trust_raise_context');

  assert.equal(report.structured_summary.revenue.value.raw, '$1MM');
  assert.equal(report.structured_summary.revenue.value.amount, 1000000);
  assert.equal(report.structured_summary.revenue.selection_reason, 'trust_gate_fallback');
  assert.equal(report.structured_summary.revenue.candidates[1].selected, true);
});

test('applyStructuredNumericTrustGates suppresses weak-source kpi_tile outlier without corroboration', () => {
  const report: any = {
    structured_summary: {
      revenue: {
        value: { amount: 375000000, currency: 'USD', period: 'current', raw: '$375MM' },
        confidence: 0.65,
        selection_reason: 'financial_fact',
        sources: [{ kind: 'kpi_tile', metric_key: 'revenue' }],
        candidates: [
          {
            selected: true,
            amount: 375000000,
            value_raw: '$375MM',
            confidence: 0.65,
            sources: [{ kind: 'kpi_tile', metric_key: 'revenue' }],
          },
        ],
      },
    },
  };

  applyStructuredNumericTrustGates(report);

  assert.equal(report.structured_summary.revenue.value, null);
  assert.equal(report.structured_summary.revenue.selection_reason, 'suppressed_low_trust_revenue');
  assert.equal(report.structured_summary.revenue.candidates[0].selected, false);
});
