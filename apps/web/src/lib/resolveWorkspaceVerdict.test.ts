/**
 * resolveWorkspaceVerdict — unit tests
 *
 * Verifies the full priority chain:
 *   1. guardrail         → HARD_PASS (overrides everything)
 *   2. decision_v1.label → maps 6-band → 4-verdict
 *   3. phase1_signals    → keyword match and score fallback
 *   4. score_threshold   → ≥70 FUND, ≥55 CONSIDER, <55 PASS
 *   5. default           → PASS
 *
 * Required snapshot fields this covers:
 *   - workspace verdict (primary)
 *   - hard pass trigger state
 *   - decision_v1 label mapping
 */

import { describe, it, expect } from 'vitest';
import { resolveWorkspaceVerdict } from './resolveWorkspaceVerdict';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeReport(overrides: {
  guardrailTriggered?: boolean;
  decision_v1_label?: string;
} = {}) {
  return {
    overallScore: 62,
    metadata: {
      hard_pass_guardrail_v2: {
        triggered: overrides.guardrailTriggered ?? false,
      },
      decision_v1: overrides.decision_v1_label !== undefined
        ? { label: overrides.decision_v1_label }
        : undefined,
    },
  };
}

// ── Priority 1: guardrail ─────────────────────────────────────────────────────

describe('resolveWorkspaceVerdict — priority 1: guardrail', () => {
  it('returns HARD_PASS when guardrail is triggered, regardless of score or decision_v1', () => {
    const report = makeReport({ guardrailTriggered: true, decision_v1_label: 'fund_confident' });
    const result = resolveWorkspaceVerdict({ report, score: 90, phase1Signals: null });
    expect(result.verdict).toBe('HARD_PASS');
    expect(result.source).toBe('guardrail');
  });

  it('does NOT return HARD_PASS when guardrail is not triggered', () => {
    const report = makeReport({ guardrailTriggered: false, decision_v1_label: 'fund_confident' });
    const result = resolveWorkspaceVerdict({ report, score: 90, phase1Signals: null });
    expect(result.verdict).toBe('FUND');
    expect(result.source).toBe('decision_v1');
  });
});

// ── Priority 2: decision_v1 label mapping ─────────────────────────────────────

describe('resolveWorkspaceVerdict — priority 2: decision_v1.label', () => {
  const fundBands = ['fund_confident', 'fund_track', 'fund_caution'];
  for (const label of fundBands) {
    it(`maps ${label} → FUND`, () => {
      const result = resolveWorkspaceVerdict({
        report: makeReport({ decision_v1_label: label }),
        score: 40, // score would be PASS if used — confirms priority
        phase1Signals: null,
      });
      expect(result.verdict).toBe('FUND');
      expect(result.source).toBe('decision_v1');
    });
  }

  it('maps strong_consider → CONSIDER', () => {
    const result = resolveWorkspaceVerdict({
      report: makeReport({ decision_v1_label: 'strong_consider' }),
      score: 40,
      phase1Signals: null,
    });
    expect(result.verdict).toBe('CONSIDER');
    expect(result.source).toBe('decision_v1');
  });

  it('maps consider_caution → CONSIDER', () => {
    const result = resolveWorkspaceVerdict({
      report: makeReport({ decision_v1_label: 'consider_caution' }),
      score: 40,
      phase1Signals: null,
    });
    expect(result.verdict).toBe('CONSIDER');
    expect(result.source).toBe('decision_v1');
  });

  it('maps hard_pass → HARD_PASS (via decision_v1, not guardrail)', () => {
    const result = resolveWorkspaceVerdict({
      report: makeReport({ guardrailTriggered: false, decision_v1_label: 'hard_pass' }),
      score: 90,
      phase1Signals: null,
    });
    expect(result.verdict).toBe('HARD_PASS');
    expect(result.source).toBe('decision_v1');
  });

  it('falls through to next priority when decision_v1 label is missing', () => {
    const result = resolveWorkspaceVerdict({
      report: { overallScore: 80, metadata: { hard_pass_guardrail_v2: { triggered: false } } },
      score: 80,
      phase1Signals: null,
    });
    expect(result.source).toBe('score_threshold');
    expect(result.verdict).toBe('FUND');
  });
});

// ── Priority 3: phase1Signals ─────────────────────────────────────────────────

describe('resolveWorkspaceVerdict — priority 3: phase1Signals', () => {
  it('maps "pass" recommendation → PASS', () => {
    const result = resolveWorkspaceVerdict({
      report: null,
      score: 75, // score would be FUND
      phase1Signals: { recommendation: 'PASS', score: null },
    });
    expect(result.verdict).toBe('PASS');
    expect(result.source).toBe('phase1_signals');
  });

  it('maps "reject" recommendation → PASS', () => {
    const result = resolveWorkspaceVerdict({
      report: null,
      score: 75,
      phase1Signals: { recommendation: 'reject', score: null },
    });
    expect(result.verdict).toBe('PASS');
  });

  it('maps "go" recommendation → FUND', () => {
    const result = resolveWorkspaceVerdict({
      report: null,
      score: 30, // would be PASS via score
      phase1Signals: { recommendation: 'Go', score: null },
    });
    expect(result.verdict).toBe('FUND');
    expect(result.source).toBe('phase1_signals');
  });

  it('maps "invest" → FUND, "proceed" → FUND, "fund" → FUND', () => {
    for (const rec of ['invest', 'proceed', 'fund']) {
      const result = resolveWorkspaceVerdict({
        report: null,
        score: null,
        phase1Signals: { recommendation: rec, score: null },
      });
      expect(result.verdict).toBe('FUND');
    }
  });

  it('maps "consider" → CONSIDER', () => {
    const result = resolveWorkspaceVerdict({
      report: null,
      score: 30,
      phase1Signals: { recommendation: 'consider', score: null },
    });
    expect(result.verdict).toBe('CONSIDER');
  });

  it('uses phase1 numeric score when recommendation is absent', () => {
    const result = resolveWorkspaceVerdict({
      report: null,
      score: null,
      phase1Signals: { recommendation: null, score: 72 },
    });
    expect(result.verdict).toBe('FUND');
    expect(result.source).toBe('phase1_signals');
  });
});

// ── Priority 4: score threshold ───────────────────────────────────────────────

describe('resolveWorkspaceVerdict — priority 4: score_threshold', () => {
  it('score 70 → FUND', () => {
    const result = resolveWorkspaceVerdict({ report: null, score: 70, phase1Signals: null });
    expect(result.verdict).toBe('FUND');
    expect(result.source).toBe('score_threshold');
  });

  it('score 69 → CONSIDER', () => {
    const result = resolveWorkspaceVerdict({ report: null, score: 69, phase1Signals: null });
    expect(result.verdict).toBe('CONSIDER');
  });

  it('score 55 → CONSIDER', () => {
    const result = resolveWorkspaceVerdict({ report: null, score: 55, phase1Signals: null });
    expect(result.verdict).toBe('CONSIDER');
  });

  it('score 54 → PASS', () => {
    const result = resolveWorkspaceVerdict({ report: null, score: 54, phase1Signals: null });
    expect(result.verdict).toBe('PASS');
  });
});

// ── Priority 5: default ───────────────────────────────────────────────────────

describe('resolveWorkspaceVerdict — priority 5: default', () => {
  it('returns PASS with source=default when nothing is available', () => {
    const result = resolveWorkspaceVerdict({ report: null, score: null, phase1Signals: null });
    expect(result.verdict).toBe('PASS');
    expect(result.source).toBe('default');
  });
});

// ── Anchor scenarios ──────────────────────────────────────────────────────────

describe('resolveWorkspaceVerdict — anchor deal scenarios', () => {
  /**
   * Anchor A: XLSX-heavy deal, score=78, band=fund_track, guardrail=false
   * Before: outer decisionLabel derived from score threshold → FUND
   * After:  sourced from decision_v1.label (fund_track) → FUND (same, but now traceable)
   */
  it('anchor A: XLSX deal, score 78, fund_track band → FUND via decision_v1', () => {
    const report = {
      overallScore: 78,
      metadata: {
        score_band_v2: { overall_score: 78 },
        hard_pass_guardrail_v2: { triggered: false },
        decision_v1: { label: 'fund_track' },
      },
    };
    const result = resolveWorkspaceVerdict({ report, score: 78, phase1Signals: null });
    expect(result.verdict).toBe('FUND');
    expect(result.source).toBe('decision_v1');
  });

  /**
   * Anchor B: Low-signal deck-only deal, score=42, guardrail NOT triggered (coverage too low),
   *           band=hard_pass → verdict HARD_PASS via decision_v1
   * Before: outer decisionLabel from score threshold → PASS
   * After:  sourced from decision_v1.label (hard_pass) → HARD_PASS (more accurate)
   */
  it('anchor B: low-signal deck deal, score 42, hard_pass band → HARD_PASS via decision_v1', () => {
    const report = {
      overallScore: 42,
      metadata: {
        hard_pass_guardrail_v2: { triggered: false },
        decision_v1: { label: 'hard_pass' },
      },
    };
    const result = resolveWorkspaceVerdict({ report, score: 42, phase1Signals: null });
    expect(result.verdict).toBe('HARD_PASS');
    expect(result.source).toBe('decision_v1');
  });

  /**
   * Anchor C: High-signal deal, guardrail triggered despite good score — structural HARD_PASS
   * Before: vmVerdict derived from (guardrail || decisionLabel) — same result
   * After:  single resolver, single code path
   */
  it('anchor C: guardrail triggered forces HARD_PASS even when decision_v1=fund_track', () => {
    const report = {
      overallScore: 76,
      metadata: {
        hard_pass_guardrail_v2: { triggered: true },
        decision_v1: { label: 'fund_track' },
      },
    };
    const result = resolveWorkspaceVerdict({ report, score: 76, phase1Signals: null });
    expect(result.verdict).toBe('HARD_PASS');
    expect(result.source).toBe('guardrail');
  });
});

// ── P0.5: mapDecisionV1LabelToVerdict public export ───────────────────────────

import { mapDecisionV1LabelToVerdict } from './resolveWorkspaceVerdict';

describe('mapDecisionV1LabelToVerdict — all 6 backend bands', () => {
  it('fund_confident → FUND', () => {
    expect(mapDecisionV1LabelToVerdict('fund_confident')).toBe('FUND');
  });

  it('fund_track → FUND', () => {
    expect(mapDecisionV1LabelToVerdict('fund_track')).toBe('FUND');
  });

  it('fund_caution → FUND', () => {
    expect(mapDecisionV1LabelToVerdict('fund_caution')).toBe('FUND');
  });

  it('strong_consider → CONSIDER', () => {
    expect(mapDecisionV1LabelToVerdict('strong_consider')).toBe('CONSIDER');
  });

  it('consider → CONSIDER (actual recommendation_key emitted by computeDecisionV1)', () => {
    expect(mapDecisionV1LabelToVerdict('consider')).toBe('CONSIDER');
  });

  it('consider_caution → CONSIDER (legacy band key, backward compat)', () => {
    expect(mapDecisionV1LabelToVerdict('consider_caution')).toBe('CONSIDER');
  });

  it('hard_pass → HARD_PASS', () => {
    expect(mapDecisionV1LabelToVerdict('hard_pass')).toBe('HARD_PASS');
  });

  it('unknown band → null', () => {
    expect(mapDecisionV1LabelToVerdict('invalid_band')).toBeNull();
    expect(mapDecisionV1LabelToVerdict('')).toBeNull();
  });
});

// ── P0.5: tile-verdict consistency contract ───────────────────────────────────

describe('resolveWorkspaceVerdict — verdict is usable as tile label', () => {
  /**
   * Verifies that when a score is present, the verdict returned by the resolver
   * is always a display-safe 4-verdict. This is the contract that lets DealWorkspace.tsx
   * use _workspaceVerdict.verdict directly as decisionTileLabel without a separate
   * threshold function.
   */
  const scenarios: Array<{ label: string; score: number; expected: 'HARD_PASS' | 'FUND' | 'CONSIDER' | 'PASS' }> = [
    { label: 'fund_confident', score: 85, expected: 'FUND' },
    { label: 'fund_track', score: 72, expected: 'FUND' },
    { label: 'fund_caution', score: 68, expected: 'FUND' },
    { label: 'strong_consider', score: 58, expected: 'CONSIDER' },
    { label: 'consider_caution', score: 52, expected: 'CONSIDER' },
    { label: 'hard_pass', score: 40, expected: 'HARD_PASS' },
  ];

  for (const { label, score, expected } of scenarios) {
    it(`decision_v1.label=${label} + score=${score} → tile label ${expected}`, () => {
      const result = resolveWorkspaceVerdict({
        report: makeReport({ decision_v1_label: label }),
        score,
        phase1Signals: null,
      });
      // The verdict must equal the expected tile label in all cases.
      expect(result.verdict).toBe(expected);
      expect(result.source).toBe('decision_v1');
      // Verdict must be a member of the 4-verdict union (never a raw 6-band key).
      expect(['HARD_PASS', 'FUND', 'CONSIDER', 'PASS']).toContain(result.verdict);
    });
  }

  it('null score still yields a safe verdict (never undefined or raw key)', () => {
    // The _workspaceVerdict.verdict is used directly; this test ensures null score
    // does not cause DealWorkspace.tsx to render raw internal keys.
    const result = resolveWorkspaceVerdict({
      report: makeReport({ decision_v1_label: 'strong_consider' }),
      score: null,
      phase1Signals: null,
    });
    expect(['HARD_PASS', 'FUND', 'CONSIDER', 'PASS']).toContain(result.verdict);
  });
});

