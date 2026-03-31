/**
 * Unit tests for resolveScoreDivergence
 *
 * Regression anchor: 2026-03-30 scoring calibration (Fix B)
 *
 * Rules verified:
 *   B1. Returns null result when either side is absent
 *   B2. Rule 2: HARD_PASS + CONSIDER → opposite_signals (most dangerous Probility case)
 *   B3. Rule 2: HARD_PASS + GO → opposite_signals
 *   B4. Rule 3: FUND + NO_GO → opposite_signals (Albuquerque case)
 *   B5. Rule 1: large numeric gap >20 → large_numeric_gap
 *   B6. Rule 1: gap exactly 20 → NOT diverging (boundary)
 *   B7. CONSIDER + CONSIDER → no divergence (same polarity)
 *   B8. HARD_PASS + NO_GO → no divergence (aligned signals)
 *   B9. FUND + GO → no divergence (aligned)
 *   B10. FUND + CONSIDER → no divergence unless numeric gap >20
 *   B11. scoreDelta is signed (workspace above = positive)
 *   B12. scoreDelta is null when either numeric score is absent
 *   B13. Anchor Probility: workspace=42 verdict=HARD_PASS, ORS=60 decision=CONSIDER → opposite_signals
 *   B14. Anchor Palm: workspace=50 verdict=CONSIDER, ORS=37 decision=NO_GO → large_numeric_gap
 *   B15. Anchor Albuquerque: workspace=73 verdict=FUND, ORS=60 decision=NO_GO → opposite_signals
 */

import { describe, it, expect } from 'vitest';
import { resolveScoreDivergence } from '../lib/resolveScoreDivergence';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveScoreDivergence', () => {

  // B1 — Absent workspace verdict → no divergence
  it('B1: workspaceVerdict null → not diverging', () => {
    const result = resolveScoreDivergence(50, null, 60, 'CONSIDER');
    expect(result.isDiverging).toBe(false);
  });

  it('B1b: orsDecision null → not diverging', () => {
    const result = resolveScoreDivergence(50, 'CONSIDER', null, null);
    expect(result.isDiverging).toBe(false);
  });

  it('B1c: both null → not diverging', () => {
    const result = resolveScoreDivergence(null, null, null, null);
    expect(result.isDiverging).toBe(false);
  });

  // B2 — HARD_PASS + CONSIDER → opposite_signals
  it('B2: HARD_PASS workspace + ORS CONSIDER → opposite_signals', () => {
    const result = resolveScoreDivergence(42, 'HARD_PASS', 60, 'CONSIDER');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('opposite_signals');
    expect(result.workspaceVerdict).toBe('HARD_PASS');
    expect(result.orsDecision).toBe('CONSIDER');
  });

  // B3 — HARD_PASS + GO → opposite_signals
  it('B3: HARD_PASS workspace + ORS GO → opposite_signals', () => {
    const result = resolveScoreDivergence(42, 'HARD_PASS', 75, 'GO');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('opposite_signals');
  });

  // B4 — FUND + NO_GO → opposite_signals
  it('B4: FUND workspace + ORS NO_GO → opposite_signals', () => {
    const result = resolveScoreDivergence(73, 'FUND', 60, 'NO_GO');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('opposite_signals');
    expect(result.workspaceVerdict).toBe('FUND');
    expect(result.orsDecision).toBe('NO_GO');
  });

  // B5 — Large numeric gap > 20 → large_numeric_gap
  it('B5: |workspaceScore - orsScore| = 21 → large_numeric_gap', () => {
    const result = resolveScoreDivergence(71, 'CONSIDER', 50, 'CONSIDER');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('large_numeric_gap');
    expect(result.scoreDelta).toBe(21);
  });

  // B6 — Exactly 20 gap → NOT diverging (boundary: rule is >20 not >=20)
  it('B6: |workspaceScore - orsScore| = 20 → NOT diverging (boundary)', () => {
    const result = resolveScoreDivergence(70, 'FUND', 50, 'NO_GO');
    // This hits B4 (FUND+NO_GO) which IS opposite_signals — test with aligned verdicts instead
    const result2 = resolveScoreDivergence(70, 'CONSIDER', 50, 'CONSIDER');
    expect(result2.isDiverging).toBe(false);
  });

  // B7 — Same polarity, small gap → no divergence
  it('B7: CONSIDER + CONSIDER, gap=9 → not diverging', () => {
    const result = resolveScoreDivergence(50, 'CONSIDER', 59, 'CONSIDER');
    expect(result.isDiverging).toBe(false);
  });

  // B8 — HARD_PASS + NO_GO → no divergence (aligned)
  it('B8: HARD_PASS workspace + ORS NO_GO → not diverging (aligned signals)', () => {
    const result = resolveScoreDivergence(42, 'HARD_PASS', 45, 'NO_GO');
    expect(result.isDiverging).toBe(false);
    expect(result.kind).toBeNull();
  });

  // B9 — FUND + GO → no divergence (aligned)
  it('B9: FUND workspace + ORS GO → not diverging', () => {
    const result = resolveScoreDivergence(75, 'FUND', 80, 'GO');
    expect(result.isDiverging).toBe(false);
  });

  // B10 — FUND + CONSIDER, gap=12 → no divergence
  it('B10: FUND + CONSIDER, gap=12 → not diverging (gap insufficient)', () => {
    const result = resolveScoreDivergence(72, 'FUND', 60, 'CONSIDER');
    expect(result.isDiverging).toBe(false);
  });

  // B10b — FUND + CONSIDER, gap=22 → large_numeric_gap (but not opposite_signals)
  it('B10b: FUND + CONSIDER, gap=22 → large_numeric_gap', () => {
    const result = resolveScoreDivergence(72, 'FUND', 50, 'CONSIDER');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('large_numeric_gap');
  });

  // B11 — scoreDelta sign: workspace above ORS → positive
  it('B11: workspace=70 ors=40 → scoreDelta=+30 (workspace above)', () => {
    const result = resolveScoreDivergence(70, 'CONSIDER', 40, 'CONSIDER');
    expect(result.scoreDelta).toBe(30);
  });

  // B11b — workspace below ORS → negative
  it('B11b: workspace=40 ors=70 → scoreDelta=-30 (workspace below)', () => {
    const result = resolveScoreDivergence(40, 'HARD_PASS', 70, 'CONSIDER');
    // hits opposite_signals first, but scoreDelta should still be computed
    expect(result.scoreDelta).toBe(-30);
  });

  // B12 — scoreDelta is null when either score is absent
  it('B12: workspaceScore=null → scoreDelta=null', () => {
    const result = resolveScoreDivergence(null, 'HARD_PASS', 60, 'CONSIDER');
    expect(result.scoreDelta).toBeNull();
    // Still diverges on opposite_signals
    expect(result.isDiverging).toBe(true);
  });

  // B13 — Anchor Probility: HARD_PASS + CONSIDER → opposite_signals
  it('B13: anchor Probility (workspace HARD_PASS/42 vs ORS CONSIDER/60) → opposite_signals', () => {
    const result = resolveScoreDivergence(42, 'HARD_PASS', 60, 'CONSIDER');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('opposite_signals');
    expect(result.scoreDelta).toBe(-18); // workspace below ORS
  });

  // B14 — Anchor Palm: workspace CONSIDER/50 vs ORS NO_GO/37 → large_numeric_gap (gap=13, <20)
  // Actually gap = |50-37| = 13 → NOT large_numeric_gap
  // CONSIDER vs NO_GO is NOT in opposite_signals rules → NOT diverging
  it('B14: anchor Palm (CONSIDER/50 vs NO_GO/37) — gap=13, not opposite_signal → not diverging', () => {
    const result = resolveScoreDivergence(50, 'CONSIDER', 37, 'NO_GO');
    expect(result.isDiverging).toBe(false);
  });

  // B14b — Palm but with gap>20 threshold check: what if scores were 50 vs 25 (gap=25)?
  it('B14b: CONSIDER vs NO_GO, gap=25 → large_numeric_gap', () => {
    const result = resolveScoreDivergence(50, 'CONSIDER', 25, 'NO_GO');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('large_numeric_gap');
  });

  // B15 — Anchor Albuquerque: FUND + NO_GO → opposite_signals
  it('B15: anchor Albuquerque (FUND/73 vs NO_GO/60) → opposite_signals', () => {
    const result = resolveScoreDivergence(73, 'FUND', 60, 'NO_GO');
    expect(result.isDiverging).toBe(true);
    expect(result.kind).toBe('opposite_signals');
    expect(result.scoreDelta).toBe(13); // workspace above ORS
  });

  // B16 — Returns all fields for aligned (not diverging) result
  it('B16: non-diverging result has isDiverging=false, kind=null', () => {
    const result = resolveScoreDivergence(55, 'CONSIDER', 50, 'CONSIDER');
    expect(result.isDiverging).toBe(false);
    expect(result.kind).toBeNull();
    expect(result.workspaceVerdict).toBeNull();
    expect(result.orsDecision).toBeNull();
    expect(result.scoreDelta).toBeNull();
  });
});
