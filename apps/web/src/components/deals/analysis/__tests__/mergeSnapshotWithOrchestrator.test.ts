/**
 * Unit tests for mergeSnapshotWithOrchestrator
 *
 * Fixtures are minimal and inline — no heavy component or report builders.
 * Tests cover every mapping rule and all hardening invariants (dedup, sort, cap, safe fallback).
 */

import { describe, it, expect } from 'vitest';
import { mergeSnapshotWithOrchestrator } from '../mergeSnapshotWithOrchestrator';
import type { DealAnalysis, CategoryScore } from '../AnalysisSnapshotDashboard';
import type { OrchestratorReportV1 } from '../../../../lib/apiClient';

// ── Fixture helpers ────────────────────────────────────────────────────────

function noop() {}

function makeCategory(name: string, score: number): CategoryScore {
  return {
    name,
    score,
    maxScore: 100,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: noop as any,
    color: '#000',
    issues: [],
    strengths: [],
    recommendations: [],
  };
}

function makeLocalAnalysis(overrides?: Partial<DealAnalysis>): DealAnalysis {
  return {
    overallScore: 50,
    previousScore: null,
    grade: 'Fair',
    completeness: 60,
    categories: [
      makeCategory('Market Opportunity', 40),
      makeCategory('Team Strength', 55),
      makeCategory('Financial Health', 30),
      makeCategory('Traction & Growth', 45),
    ],
    redFlags: [{ severity: 'medium', message: 'local flag', action: 'fix it' }],
    greenFlags: ['local green flag'],
    quickWins: [],
    achievements: [],
    ...overrides,
  };
}

/** Minimal valid OrchestratorReportV1 with sensible defaults. */
function makeOrch(overrides?: Partial<OrchestratorReportV1>): OrchestratorReportV1 {
  return {
    schema_version: 'ddai_orchestrator_report_v1',
    deal_id: 'test-deal',
    created_at: '2026-01-01T00:00:00Z',
    input_fingerprint: 'fp-test',
    document_confidence: {
      score: 0.8,
      band: 'Good',
      notes: [],
    },
    stage_context: {
      stage: 'Seed',
      raise_amount: null,
      instrument: null,
      valuation_pre: null,
      valuation_post: null,
      missing_critical_terms: [],
    },
    scores: {
      overall_recommendation_score: 75,
      risk_severity_score: 30,
      market_score: { raw: 80, persisted: 80, missing_inputs: [] },
      financial_health_score: { status: 'ok', score: 70, is_proxy: false, missing_sections: [] },
    },
    decision: {
      label: 'GO',
      confidence_band: 'High',
      rationale_bullets: ['Strong market', 'Experienced team'],
      thresholds_used: { stage: 'Seed', go_min_ors: 60, max_acceptable_risk: 50 },
    },
    diagnostics: { warnings: [], inputs_present: {} },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('mergeSnapshotWithOrchestrator', () => {
  // ── 1. No report → local unchanged ─────────────────────────────────────

  it('returns local unchanged when orch is undefined', () => {
    const local = makeLocalAnalysis();
    const result = mergeSnapshotWithOrchestrator(local, undefined);
    expect(result).toBe(local); // strict reference equality — no copy
  });

  it('returns local unchanged when orch is null', () => {
    const local = makeLocalAnalysis();
    const result = mergeSnapshotWithOrchestrator(local, null);
    expect(result).toBe(local);
  });

  // ── 2. Overall score override ───────────────────────────────────────────

  it('overrides overallScore from server ORS', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis({ overallScore: 50 }),
      makeOrch({ scores: { ...makeOrch().scores, overall_recommendation_score: 87 } })
    );
    expect(result.overallScore).toBe(87);
  });

  it('rounds fractional ORS', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis(),
      makeOrch({ scores: { ...makeOrch().scores, overall_recommendation_score: 72.6 } })
    );
    expect(result.overallScore).toBe(73);
  });

  it('leaves overallScore unchanged when ORS is missing', () => {
    const orch = makeOrch();
    // @ts-expect-error — intentionally removing field to test fallback
    delete orch.scores.overall_recommendation_score;
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis({ overallScore: 42 }), orch);
    expect(result.overallScore).toBe(42);
  });

  // ── 3. Decision label → grade mapping ──────────────────────────────────

  it('maps GO → grade GO (canonical, Policy A)', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis({ grade: 'Fair' }),
      makeOrch({ decision: { ...makeOrch().decision, label: 'GO' } })
    );
    expect(result.grade).toBe('GO');
  });

  it('maps CONSIDER → grade CONSIDER (canonical, Policy A)', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis({ grade: 'Fair' }),
      makeOrch({ decision: { ...makeOrch().decision, label: 'CONSIDER' } })
    );
    expect(result.grade).toBe('CONSIDER');
  });

  it('maps NO_GO → grade NO_GO (canonical, Policy A)', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis({ grade: 'Excellent' }),
      makeOrch({ decision: { ...makeOrch().decision, label: 'NO_GO' } })
    );
    expect(result.grade).toBe('NO_GO');
  });

  it('keeps local grade when decision is absent', () => {
    const orch = makeOrch();
    // @ts-expect-error — intentionally removing field to test fallback
    delete orch.decision;
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis({ grade: 'Fair' }), orch);
    expect(result.grade).toBe('Fair');
  });

  // ── 4. Market Opportunity category score override ───────────────────────

  it('overrides Market Opportunity score from market_score.raw', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis(),
      makeOrch({ scores: { ...makeOrch().scores, market_score: { raw: 91, persisted: 91, missing_inputs: [] } } })
    );
    const market = result.categories.find((c) => c.name === 'Market Opportunity');
    expect(market?.score).toBe(91);
  });

  it('does NOT touch Team Strength or Traction when market score is provided', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis(),
      makeOrch({ scores: { ...makeOrch().scores, market_score: { raw: 99, persisted: 99, missing_inputs: [] } } })
    );
    const team = result.categories.find((c) => c.name === 'Team Strength');
    expect(team?.score).toBe(55); // unchanged from fixture
  });

  it('leaves Market Opportunity unchanged when market_score.raw is missing', () => {
    const orch = makeOrch();
    orch.scores = {
      ...orch.scores,
      market_score: { ...orch.scores.market_score, raw: undefined as unknown as number },
    };
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    const market = result.categories.find((c) => c.name === 'Market Opportunity');
    expect(market?.score).toBe(40); // local fixture value
  });

  // ── 5. Financial Health category score override ─────────────────────────

  it('overrides Financial Health score', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis(),
      makeOrch({ scores: { ...makeOrch().scores, financial_health_score: { status: 'ok', score: 65, is_proxy: false, missing_sections: [] } } })
    );
    const fin = result.categories.find((c) => c.name === 'Financial Health');
    expect(fin?.score).toBe(65);
  });

  it('leaves Financial Health unchanged when score is null (insufficient_data)', () => {
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis(),
      makeOrch({
        scores: {
          ...makeOrch().scores,
          financial_health_score: { status: 'insufficient_data', score: null, is_proxy: false, missing_sections: [] },
        },
      })
    );
    const fin = result.categories.find((c) => c.name === 'Financial Health');
    expect(fin?.score).toBe(30); // local fixture value
  });

  it('does not throw when category name is not found in local categories', () => {
    const local = makeLocalAnalysis({ categories: [] });
    expect(() => mergeSnapshotWithOrchestrator(local, makeOrch())).not.toThrow();
  });

  // ── 6. Red flags ────────────────────────────────────────────────────────

  it('includes only P0 and P1 flags, excludes P2', () => {
    const orch = makeOrch({
      segments: {
        risk_verification: {
          verification_requests: [
            { request: 'P0 issue', priority: 'P0', why: 'critical' },
            { request: 'P1 issue', priority: 'P1', why: 'important' },
            { request: 'P2 issue', priority: 'P2', why: 'minor' },
          ],
        },
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.redFlags).toHaveLength(2);
    expect(result.redFlags.every((f) => f.severity !== 'low')).toBe(true);
    expect(result.redFlags.some((f) => f.message === 'P2 issue')).toBe(false);
  });

  it('maps P0 → severity high, P1 → severity medium', () => {
    const orch = makeOrch({
      segments: {
        risk_verification: {
          verification_requests: [
            { request: 'A', priority: 'P0', why: 'why A' },
            { request: 'B', priority: 'P1', why: 'why B' },
          ],
        },
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.redFlags.find((f) => f.message === 'A')?.severity).toBe('high');
    expect(result.redFlags.find((f) => f.message === 'B')?.severity).toBe('medium');
  });

  it('sorts P0 before P1, then alphabetically within each priority', () => {
    const orch = makeOrch({
      segments: {
        risk_verification: {
          verification_requests: [
            { request: 'Zebra', priority: 'P1', why: '' },
            { request: 'Apple', priority: 'P1', why: '' },
            { request: 'Middle', priority: 'P0', why: '' },
            { request: 'Alpha', priority: 'P0', why: '' },
          ],
        },
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    const messages = result.redFlags.map((f) => f.message);
    expect(messages).toEqual(['Alpha', 'Middle', 'Apple', 'Zebra']);
  });

  it('deduplicates red flags by request string', () => {
    const orch = makeOrch({
      segments: {
        risk_verification: {
          verification_requests: [
            { request: 'Dup issue', priority: 'P0', why: 'first' },
            { request: 'Dup issue', priority: 'P0', why: 'duplicate' },
            { request: 'Unique', priority: 'P1', why: 'other' },
          ],
        },
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.redFlags).toHaveLength(2);
    const dups = result.redFlags.filter((f) => f.message === 'Dup issue');
    expect(dups).toHaveLength(1);
  });

  it('caps red flags at 8 items', () => {
    const requests = Array.from({ length: 12 }, (_, i) => ({
      request: `Issue ${String(i).padStart(2, '0')}`,
      priority: 'P0' as const,
      why: '',
    }));
    const orch = makeOrch({
      segments: { risk_verification: { verification_requests: requests } },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.redFlags.length).toBeLessThanOrEqual(8);
  });

  it('keeps local red flags when no server P0/P1 requests exist', () => {
    const orch = makeOrch({
      segments: {
        risk_verification: {
          verification_requests: [{ request: 'Minor', priority: 'P2', why: 'low' }],
        },
      },
    });
    const local = makeLocalAnalysis({
      redFlags: [{ severity: 'high', message: 'local only', action: 'do something' }],
    });
    const result = mergeSnapshotWithOrchestrator(local, orch);
    expect(result.redFlags).toEqual(local.redFlags);
  });

  // ── 7. Green flags ─────────────────────────────────────────────────────

  it('replaces local green flags with server rationale bullets', () => {
    const orch = makeOrch({
      decision: {
        ...makeOrch().decision,
        rationale_bullets: ['Server flag 1', 'Server flag 2'],
      },
    });
    const result = mergeSnapshotWithOrchestrator(
      makeLocalAnalysis({ greenFlags: ['local green'] }),
      orch
    );
    expect(result.greenFlags).toEqual(['Server flag 1', 'Server flag 2']);
  });

  it('deduplicates green flags preserving first occurrence order', () => {
    const orch = makeOrch({
      decision: {
        ...makeOrch().decision,
        rationale_bullets: ['A', 'B', 'A', 'C', 'B'],
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.greenFlags).toEqual(['A', 'B', 'C']);
  });

  it('strips empty / whitespace-only green flag bullets', () => {
    const orch = makeOrch({
      decision: {
        ...makeOrch().decision,
        rationale_bullets: ['Valid', '', '   ', 'Also valid'],
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.greenFlags).toEqual(['Valid', 'Also valid']);
  });

  it('caps green flags at 8 items', () => {
    const orch = makeOrch({
      decision: {
        ...makeOrch().decision,
        rationale_bullets: Array.from({ length: 15 }, (_, i) => `Bullet ${i}`),
      },
    });
    const result = mergeSnapshotWithOrchestrator(makeLocalAnalysis(), orch);
    expect(result.greenFlags.length).toBeLessThanOrEqual(8);
  });

  it('keeps local green flags when server bullets array is empty', () => {
    const orch = makeOrch({
      decision: { ...makeOrch().decision, rationale_bullets: [] },
    });
    const local = makeLocalAnalysis({ greenFlags: ['keep me'] });
    const result = mergeSnapshotWithOrchestrator(local, orch);
    expect(result.greenFlags).toEqual(['keep me']);
  });

  it('keeps local green flags when server bullets all blank', () => {
    const orch = makeOrch({
      decision: { ...makeOrch().decision, rationale_bullets: ['', '   '] },
    });
    const local = makeLocalAnalysis({ greenFlags: ['keep me'] });
    const result = mergeSnapshotWithOrchestrator(local, orch);
    expect(result.greenFlags).toEqual(['keep me']);
  });

  // ── 8. Local fields never removed ──────────────────────────────────────

  it('never removes completeness, quickWins, or achievements', () => {
    const local = makeLocalAnalysis({
      completeness: 77,
      quickWins: [{ title: 'do X', impact: 20, effort: 'low' }],
      achievements: [{ id: 'first-analysis', title: 'First Analysis', unlocked: true }],
    });
    const result = mergeSnapshotWithOrchestrator(local, makeOrch());
    expect(result.completeness).toBe(77);
    expect(result.quickWins).toEqual(local.quickWins);
    expect(result.achievements).toEqual(local.achievements);
  });

  // ── 9. Immutability — local not mutated ────────────────────────────────

  it('does not mutate the local DealAnalysis object', () => {
    const local = makeLocalAnalysis();
    const originalScore = local.overallScore;
    const originalGrade = local.grade;
    mergeSnapshotWithOrchestrator(local, makeOrch());
    expect(local.overallScore).toBe(originalScore);
    expect(local.grade).toBe(originalGrade);
  });
});
