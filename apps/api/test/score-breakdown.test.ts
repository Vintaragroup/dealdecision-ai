import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreBreakdownV1 } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('supported section without linked evidence is flagged as mismatch and degrades audit', () => {
  const res = buildScoreBreakdownV1({
    accountability: { support: { market: 'evidence' } },
    coverage: { sections: { market_icp: 'present' } },
    claims: [
      {
        category: 'market',
        claim_id: 'c1',
        text: 'Market signal present',
        evidence: [{ snippet: 'Signal noted but no evidence id' }],
      },
    ],
  });

  assert.ok(res, 'score breakdown should be built');
  const market = res!.sections.find((s) => s.key === 'market');
  assert.ok(market, 'market section should exist');
  assert.equal(market!.evidence_count_total, 1);
  assert.equal(market!.evidence_count_linked, 0);
  assert.equal(market!.mismatch, true);
  assert.equal(typeof market!.rule_key, 'string');
  assert.equal(typeof market!.support_reason, 'string');
  assert.ok(market!.support_reason && market!.support_reason.length > 0);

  const auditStatus = res!.trace_audit_v1?.status;
  assert.ok(auditStatus === 'partial' || auditStatus === 'poor');
});

test('linked evidence clears mismatch and improves audit status', () => {
  const res = buildScoreBreakdownV1({
    accountability: { support: { market: 'evidence', product: 'evidence', traction: 'inferred' } },
    claims: [
      { category: 'market', claim_id: 'm1', text: 'Market claim', evidence: [{ evidence_id: 'e1', snippet: 'x' }] },
      { category: 'product', claim_id: 'p1', text: 'Product claim', evidence: [{ evidence_id: 'e2', snippet: 'y' }] },
      { category: 'traction', claim_id: 't1', text: 'Traction claim', evidence: [{ evidence_id: 'e3', snippet: 'z' }] },
    ],
  });

  assert.ok(res, 'score breakdown should be built');
  const market = res!.sections.find((s) => s.key === 'market');
  assert.ok(market, 'market section should exist');
  assert.equal(market!.mismatch, false);
  assert.equal(market!.evidence_count_linked, 1);
  assert.ok(res!.trace_audit_v1);
  assert.ok(res!.trace_audit_v1!.sections_with_trace && res!.trace_audit_v1!.sections_with_trace >= 3);

  const auditStatus = res!.trace_audit_v1!.status;
  assert.ok(auditStatus === 'partial' || auditStatus === 'ok');
});
