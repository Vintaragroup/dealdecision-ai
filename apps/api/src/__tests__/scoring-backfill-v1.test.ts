/**
 * P0-2 backfill — unit tests for shouldPinUnadjusted
 *
 * Verifies that the backfill logic produces correct pin/reason for older DIOs
 * where `unadjusted_pinned` was not persisted in score_explanation.totals.
 *
 * Required snapshot fields this covers:
 *   - unadjusted_pinned (backfilled)
 *   - unadjusted_reason (backfilled)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPinUnadjusted } from '../lib/deterministic-score-preview-v1';

describe('shouldPinUnadjusted — backfill for stale DIOs', () => {
  test('pins when drift is misaligned, regardless of other inputs', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.90,   // high coverage — would otherwise not pin
      kpiCount: 4,           // kpis present
      driftAssessment: 'misaligned',
      scoreConfidence: 0.85,
    });
    assert.equal(result.pinned, true);
    assert.equal(result.reason, 'drift_misaligned');
  });

  test('pins when coverage_ratio < 0.65', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.60,
      kpiCount: 3,
      driftAssessment: 'aligned',
      scoreConfidence: 0.80,
    });
    assert.equal(result.pinned, true);
    assert.equal(result.reason, 'low_coverage');
  });

  test('pins when kpiCount === 0 (no KPIs)', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.80,
      kpiCount: 0,
      driftAssessment: 'aligned',
      scoreConfidence: 0.75,
    });
    assert.equal(result.pinned, true);
    assert.equal(result.reason, 'no_kpis');
  });

  test('pins when scoreConfidence < 0.4', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.80,
      kpiCount: 2,
      driftAssessment: 'aligned',
      scoreConfidence: 0.35,
    });
    assert.equal(result.pinned, true);
    assert.equal(result.reason, 'low_confidence');
  });

  test('does NOT pin when all conditions are healthy', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.80,
      kpiCount: 3,
      driftAssessment: 'aligned',
      scoreConfidence: 0.75,
    });
    assert.equal(result.pinned, false);
    assert.equal(result.reason, null);
  });

  test('handles null/missing inputs gracefully (old DIO pattern — kpiCount=0 → no_kpis)', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: null,
      kpiCount: 0,
      driftAssessment: null,
      scoreConfidence: null,
    });
    assert.equal(result.pinned, true);
    assert.equal(result.reason, 'no_kpis');
  });

  test('drift_misaligned fires before low_coverage', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.40,
      kpiCount: 0,
      driftAssessment: 'misaligned',
      scoreConfidence: 0.10,
    });
    assert.equal(result.reason, 'drift_misaligned');
  });

  test('low_coverage fires before no_kpis', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.50,
      kpiCount: 0,
      driftAssessment: 'aligned',
      scoreConfidence: 0.80,
    });
    assert.equal(result.reason, 'low_coverage');
  });

  test('no_kpis fires before low_confidence', () => {
    const result = shouldPinUnadjusted({
      coverageRatio: 0.80,
      kpiCount: 0,
      driftAssessment: 'aligned',
      scoreConfidence: 0.30,
    });
    assert.equal(result.reason, 'no_kpis');
  });

  // ── Contract: missing totals edge case ─────────────────────────────────────
  // When the ingestion_reports.summary has no score_explanation.totals object
  // (older DIOs before the totals field was introduced), enrichReportMetadata()
  // supplies null for all inputs. This test pins the expected behavior:
  // shouldPinUnadjusted must not throw and must produce a deterministic result.
  test('all-null inputs (totals object entirely absent) — no_kpis fires, no throw', () => {
    // All inputs null simulates the case where totals is missing from an old DIO.
    // kpiCount=0 is the only evaluable condition, so no_kpis should fire.
    assert.doesNotThrow(() => {
      const result = shouldPinUnadjusted({
        coverageRatio: null,
        kpiCount: 0,
        driftAssessment: null,
        scoreConfidence: null,
      });
      assert.equal(result.pinned, true);
      assert.equal(result.reason, 'no_kpis');
    });
  });

  test('all-null inputs with kpiCount=1 — result is not pinned (no condition fires)', () => {
    // kpiCount > 0 and all other inputs null: no pin condition is evaluable,
    // so the contract is that pinned=false and reason=null (no false positive).
    const result = shouldPinUnadjusted({
      coverageRatio: null,
      kpiCount: 1,
      driftAssessment: null,
      scoreConfidence: null,
    });
    // With null coverage, null drift, null confidence, and kpiCount=1:
    // - drift_misaligned: null !== 'misaligned' → does not fire
    // - low_coverage: null < 0.65 → null comparison → does not fire  
    // - no_kpis: 1 === 0 → false → does not fire
    // - low_confidence: null < 0.4 → null comparison → does not fire
    assert.equal(result.pinned, false);
    assert.equal(result.reason, null);
  });
});

