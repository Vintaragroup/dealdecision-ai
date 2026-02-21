/**
 * Tests for topsection_v1 — score-driver deterministic summary.
 *
 * Design contract enforced here:
 *   - TopSection = score-driver summary (deterministic, never LLM governed)
 *   - Overview tab = company summary (governed overlay — NOT tested here)
 *
 * These tests verify:
 *   1. topsection_v1 is embedded in structured_summary when a score explanation exists
 *   2. score_driver_one_liner mentions the score number, never a company description
 *   3. score_driver_one_liner shows a neutral-baseline message when pinned
 *   4. Score-mechanic phrases are filtered from strengths/weaknesses
 *   5. Raw snake_case internal keys are filtered from strengths/weaknesses
 */
import { makeFixture } from './helpers/makeFixtureReport';
import {
  buildTopSectionV1FromScoreExplanation,
  type TopSectionV1,
} from '../topsection-v1-deterministic';
import type { ScoreExplanation } from '../score-explanation';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal ScoreExplanation with one high-scoring component. */
const makeExplanation = (
  overrides: Partial<{
    overall_score: number;
    unadjusted_pinned: boolean;
    components: Record<string, any>;
    strengths: Array<{ text: string; evidence_ids: string[]; component_keys: string[] }>;
    diligence_open_items: Array<{ text: string; evidence_ids: string[]; component_keys: string[] }>;
    execution_dependencies: Array<{ text: string; evidence_ids: string[]; component_keys: string[] }>;
  }> = {},
): ScoreExplanation => {
  const overall = overrides.overall_score ?? 65;
  return {
    context: { primary_doc_type: 'pitch_deck' } as any,
    aggregation: {
      method: 'weighted_mean',
      policy_id: null,
      weights: {
        slide_sequence: 1,
        metric_benchmark: 1,
        visual_design: 1,
        narrative_arc: 1,
        financial_health: 1,
        risk_assessment: 1,
      },
      included_components: ['financial_health'],
      excluded_components: [],
    },
    components: overrides.components ?? {
      slide_sequence: { status: 'ok', used_score: 70, penalty: 0, reason: 'Good structure', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.8, confidence: 0.8, raw_score: 70, weighted_contribution: 20, notes: [] },
      metric_benchmark: { status: 'ok', used_score: 60, penalty: 0, reason: 'Adequate metrics', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.7, confidence: 0.7, raw_score: 60, weighted_contribution: 10, notes: [] },
      visual_design: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
      narrative_arc: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
      financial_health: { status: 'ok', used_score: 80, penalty: 0, reason: 'Strong cash position', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.9, confidence: 0.9, raw_score: 80, weighted_contribution: 30, notes: [] },
      risk_assessment: { status: 'ok', used_score: 55, penalty: 0, reason: 'Moderate risk', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.6, confidence: 0.6, raw_score: 55, weighted_contribution: 5, notes: [], inverted_investment_score: 45 } as any,
    },
    totals: {
      overall_score: overall,
      unadjusted_overall_score: overall,
      unadjusted_pinned: overrides.unadjusted_pinned ?? false,
      unadjusted_reason: null,
      unadjusted_missing_inputs: [],
      coverage_ratio: 0.8,
      confidence_score: 0.8,
      evidence_factor: 0.9,
      due_diligence_factor: 0.8,
      adjustment_factor: 0.85,
    },
    understanding_v1: {
      summary: 'Strengths and open items explain the score.',
      strengths: overrides.strengths ?? [
        { text: 'Revenue KPI extracted: $1.2M ARR.', evidence_ids: ['ev-1'], component_keys: ['metric_benchmark'] },
      ],
      execution_dependencies: overrides.execution_dependencies ?? [
        { text: 'Confirm revenue basis (cash vs accrual) from multi-year financials.', evidence_ids: [], component_keys: ['financial_health'] },
      ],
      diligence_open_items: overrides.diligence_open_items ?? [
        { text: 'Provide gross margin and unit economics (CAC/LTV).', evidence_ids: [], component_keys: ['metric_benchmark'] },
      ],
    },
  };
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('topsection_v1: embedded in structured_summary', () => {
  test('topsection_v1 is present and has the correct schema_version', () => {
    const { report } = makeFixture({
      pages: [
        {
          document_id: '00000000-0000-4000-8000-00000000d001',
          page_index: 0,
          page: 1,
          text: 'Raising $2M Seed SAFE. ARR $1.2M.',
        },
      ],
    });

    expect(report.structured_summary?.topsection_v1).toBeTruthy();
    const v1 = report.structured_summary?.topsection_v1 as TopSectionV1;
    expect(v1.schema_version).toBe('topsection_v1');
    expect(typeof v1.score_driver_one_liner).toBe('string');
    expect(v1.score_driver_one_liner.length).toBeGreaterThan(0);
    expect(Array.isArray(v1.strengths)).toBe(true);
    expect(Array.isArray(v1.weaknesses)).toBe(true);
    expect(Array.isArray(v1.actions_to_improve)).toBe(true);
  });
});

describe('buildTopSectionV1FromScoreExplanation: score_driver_one_liner', () => {
  test('mentions the score number', () => {
    const se = makeExplanation({ overall_score: 72 });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.score_driver_one_liner).toMatch(/Score of 72/);
  });

  test('never mentions company / product / market language', () => {
    const se = makeExplanation({ overall_score: 68 });
    const result = buildTopSectionV1FromScoreExplanation(se);
    const line = result.score_driver_one_liner.toLowerCase();
    expect(line).not.toMatch(/\b(company|product|market|raises|the company|solution)\b/);
  });

  test('shows neutral-baseline message when unadjusted_pinned is true', () => {
    const se = makeExplanation({ overall_score: 50, unadjusted_pinned: true });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.score_driver_one_liner).toMatch(/neutral baseline/i);
    // Must NOT say "Score of 50 — led by..." when pinned
    expect(result.score_driver_one_liner).not.toMatch(/led by/i);
  });

  test('shows fallback when overall_score is null', () => {
    const se = makeExplanation({ overall_score: undefined as any });
    (se.totals as any).overall_score = null;
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.score_driver_one_liner).toMatch(/not yet available/i);
  });

  test('mentions a positive driver when top component is above neutral', () => {
    // financial_health = 80, well above 50
    const se = makeExplanation({ overall_score: 65 });
    const result = buildTopSectionV1FromScoreExplanation(se);
    // Should mention financial health as a driver
    expect(result.score_driver_one_liner).toMatch(/financial health/i);
  });

  test('produces different one-liners for high-score vs low-score deals', () => {
    const highSe = makeExplanation({
      overall_score: 80,
      components: {
        financial_health: { status: 'ok', used_score: 85, penalty: 0, reason: 'Strong', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.9, confidence: 0.9, raw_score: 85, weighted_contribution: 35, notes: [] },
        metric_benchmark: { status: 'ok', used_score: 75, penalty: 0, reason: 'Good', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.8, confidence: 0.8, raw_score: 75, weighted_contribution: 25, notes: [] },
        slide_sequence: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
        visual_design: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
        narrative_arc: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
        risk_assessment: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [], inverted_investment_score: null } as any,
      },
    });
    const lowSe = makeExplanation({
      overall_score: 35,
      components: {
        financial_health: { status: 'ok', used_score: 30, penalty: 0, reason: 'Weak', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.4, confidence: 0.4, raw_score: 30, weighted_contribution: -20, notes: [] },
        metric_benchmark: { status: 'ok', used_score: 25, penalty: 0, reason: 'Missing', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: 0.3, confidence: 0.3, raw_score: 25, weighted_contribution: -25, notes: [] },
        slide_sequence: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
        visual_design: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
        narrative_arc: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [] },
        risk_assessment: { status: 'null_score', used_score: null, penalty: 0, reason: '', reasons: [], evidence_ids: [], gaps: [], red_flags: [], coverage: null, confidence: null, raw_score: null, weighted_contribution: null, notes: [], inverted_investment_score: null } as any,
      },
    });

    const highResult = buildTopSectionV1FromScoreExplanation(highSe);
    const lowResult = buildTopSectionV1FromScoreExplanation(lowSe);

    // High score should mention positive drivers
    expect(highResult.score_driver_one_liner).toMatch(/Score of 80/);
    expect(highResult.score_driver_one_liner).toMatch(/led by|strength/i);

    // Low score should mention held back
    expect(lowResult.score_driver_one_liner).toMatch(/Score of 35/);
    expect(lowResult.score_driver_one_liner).toMatch(/held back/i);
  });
});

describe('buildTopSectionV1FromScoreExplanation: guardrails', () => {
  test('score-mechanic phrases are filtered from strengths', () => {
    const se = makeExplanation({
      strengths: [
        { text: 'Narrative pacing score computed from slide cadence', evidence_ids: [], component_keys: [] },
        { text: 'Score computed via risk analyzer', evidence_ids: [], component_keys: [] },
        { text: 'Revenue KPI extracted: $1.2M ARR.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).not.toContain('Narrative pacing score computed from slide cadence');
    expect(result.strengths).not.toContain('Score computed via risk analyzer');
    // The legitimate item should survive
    expect(result.strengths).toContain('Revenue KPI extracted: $1.2M ARR.');
  });

  test('score-mechanic phrases are filtered from weaknesses', () => {
    const se = makeExplanation({
      diligence_open_items: [
        { text: 'Analyzer scored this as insufficient', evidence_ids: [], component_keys: [] },
        { text: 'Provide gross margin and unit economics (CAC/LTV).', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.weaknesses).not.toContain('Analyzer scored this as insufficient');
    expect(result.weaknesses).toContain('Provide gross margin and unit economics (CAC/LTV).');
  });

  test('raw snake_case internal keys are filtered from strengths', () => {
    const se = makeExplanation({
      strengths: [
        { text: 'key_risks_detected', evidence_ids: [], component_keys: [] },
        { text: 'business_model_label', evidence_ids: [], component_keys: [] },
        { text: 'Revenue KPI confirmed.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).not.toContain('key_risks_detected');
    expect(result.strengths).not.toContain('business_model_label');
    expect(result.strengths).toContain('Revenue KPI confirmed.');
  });

  test('raw snake_case internal keys are filtered from weaknesses', () => {
    const se = makeExplanation({
      diligence_open_items: [
        { text: 'unit_economics_v1', evidence_ids: [], component_keys: [] },
        { text: 'Confirm revenue basis.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.weaknesses).not.toContain('unit_economics_v1');
    expect(result.weaknesses).toContain('Confirm revenue basis.');
  });

  test('strengths and weaknesses are deduplicated', () => {
    const se = makeExplanation({
      strengths: [
        { text: 'Revenue KPI confirmed.', evidence_ids: [], component_keys: [] },
        { text: 'Revenue KPI confirmed.', evidence_ids: [], component_keys: [] }, // duplicate
        { text: 'REVENUE KPI CONFIRMED.', evidence_ids: [], component_keys: [] }, // case duplicate
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).toHaveLength(1);
  });

  test('strengths capped at 4 items', () => {
    const se = makeExplanation({
      strengths: [
        { text: 'Item one.', evidence_ids: [], component_keys: [] },
        { text: 'Item two.', evidence_ids: [], component_keys: [] },
        { text: 'Item three.', evidence_ids: [], component_keys: [] },
        { text: 'Item four.', evidence_ids: [], component_keys: [] },
        { text: 'Item five.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths.length).toBeLessThanOrEqual(4);
  });

  test('actions_to_improve comes from execution_dependencies', () => {
    const se = makeExplanation({
      execution_dependencies: [
        { text: 'Confirm revenue basis (cash vs accrual).', evidence_ids: [], component_keys: [] },
        { text: 'Provide cohort retention data.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.actions_to_improve).toContain('Confirm revenue basis (cash vs accrual).');
    expect(result.actions_to_improve).toContain('Provide cohort retention data.');
  });
});

describe('buildTopSectionV1FromScoreExplanation: enhanced sanitization (length + quality)', () => {
  test('bullets exceeding 250 chars are filtered out', () => {
    const longBullet = 'This is a very detailed reason that goes on and on past the maximum bullet length limit of two hundred and fifty characters. '.padEnd(260, 'x');
    const se = makeExplanation({
      strengths: [
        { text: longBullet, evidence_ids: [], component_keys: [] },
        { text: 'Good financial health signal.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).not.toContain(longBullet);
    expect(result.strengths).toContain('Good financial health signal.');
  });

  test('bullets shorter than 10 chars are filtered out', () => {
    const se = makeExplanation({
      strengths: [
        { text: 'OK', evidence_ids: [], component_keys: [] },
        { text: 'Yes', evidence_ids: [], component_keys: [] },
        { text: 'Strong MRR growth and positive unit economics.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).not.toContain('OK');
    expect(result.strengths).not.toContain('Yes');
    expect(result.strengths).toContain('Strong MRR growth and positive unit economics.');
  });

  test('single-word bullets (< 2 words) are filtered out', () => {
    const se = makeExplanation({
      strengths: [
        { text: 'Profitable', evidence_ids: [], component_keys: [] },
        { text: 'StrongMetrics', evidence_ids: [], component_keys: [] },
        { text: 'Revenue growth is strong and sustained.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).not.toContain('Profitable');
    expect(result.strengths).not.toContain('StrongMetrics');
    expect(result.strengths).toContain('Revenue growth is strong and sustained.');
  });

  test('high-symbol / OCR-noise strings (letter ratio < 0.55) are filtered out', () => {
    // OCR noise: mostly numbers and noise chars, well below 55% letters
    const ocrNoise = '3.7 / 4.5 => 82% || [[col:4]] 98 pts ** 2.1x';
    const se = makeExplanation({
      strengths: [
        { text: ocrNoise, evidence_ids: [], component_keys: [] },
        { text: 'Gross margin of 72% supports unit economics.', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).not.toContain(ocrNoise);
    expect(result.strengths).toContain('Gross margin of 72% supports unit economics.');
  });

  test('a legitimate bullet with dollar amounts passes the letter-ratio check', () => {
    // "$1.2M ARR" is borderline but "Revenue KPI extracted: $1.2M ARR." has enough letters
    const se = makeExplanation({
      strengths: [
        { text: 'Revenue KPI extracted: $1.2M ARR (12-month trailing).', evidence_ids: [], component_keys: [] },
      ],
    });
    const result = buildTopSectionV1FromScoreExplanation(se);
    expect(result.strengths).toContain('Revenue KPI extracted: $1.2M ARR (12-month trailing).');
  });
});
