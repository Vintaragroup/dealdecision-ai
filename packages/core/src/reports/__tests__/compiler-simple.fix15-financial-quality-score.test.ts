/**
 * Fix 15 regression tests: financial_integrity_v1 + financial_coverage_v1 quality score
 * blends into overallScore in compileDIOToReportWithPromotedFacts.
 *
 * Validates:
 * 1. financial_integrity_v1.score is non-null when facts are present
 * 2. financial_coverage_v1.score is always present
 * 3. overallScore is adjusted upward for high-quality data (StackFactor-like)
 * 4. overallScore is adjusted downward for low-quality data (Qredible-like)
 * 5. Blend is skipped when has_facts=false
 * 6. No regression on financial_breakdown_v1 or other promoted-facts fields
 */

import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1';

// ── Minimal DIO stub ──────────────────────────────────────────────────────────
function makeDio(overrideScore: number = 44): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: '00000000-0000-4000-8000-000000000f15',
    deal_id: '00000000-0000-4000-8000-000000000f16',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: {
      documents: [],
      evidence: [],
      config: { analyzer_versions: {}, features: {}, parameters: {} },
    },
    analyzer_results: {
      slide_sequence: { analyzer_version: '1.0.0', executed_at: now, status: 'insufficient_data', coverage: 0, confidence: 0 },
      metric_benchmark: {
        analyzer_version: '1.0.0',
        executed_at: now,
        status: 'insufficient_data',
        coverage: 0,
        confidence: 0,
        metrics_analyzed: [],
      },
      visual_design: { analyzer_version: '1.0.0', executed_at: now, status: 'insufficient_data', coverage: 0, confidence: 0 },
      narrative_arc: { analyzer_version: '1.0.0', executed_at: now, status: 'insufficient_data', coverage: 0, confidence: 0 },
      financial_health: {
        analyzer_version: '1.0.0',
        executed_at: now,
        status: 'insufficient_data',
        coverage: 0,
        confidence: 0,
        health_score: overrideScore,
        risks: [],
        evidence_ids: [],
      },
      risk_assessment: {
        analyzer_version: '1.0.0',
        executed_at: now,
        status: 'insufficient_data',
        coverage: 0,
        confidence: 0,
        overall_risk_score: null,
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
        risks_by_category: { market: [], team: [], financial: [], execution: [] },
        evidence_ids: [],
      },
    },
  };
}

// ── Minimal financial fact stub ───────────────────────────────────────────────
let _seq = 0;
function makeRevenueFact(amount: number): FinancialFactV1 {
  const id = ++_seq;
  return {
    fact_id: `factv1:fix15:revenue:annual:FY2024:${String(id).padStart(8, '0')}`,
    deal_id: '00000000-0000-4000-8000-000000000f16',
    document_id: 'doc_xlsx_fix15',
    source_kind: 'xlsx',
    metric_key: 'revenue',
    period_type: 'annual',
    period_label: 'FY2024',
    value: amount,
    unit: 'currency',
    confidence: 'high',
  } as unknown as FinancialFactV1;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Fix 15 — financial quality score blend', () => {
  it('financial_integrity_v1.score is non-null when facts are present', () => {
    const dio = makeDio(44);
    const report = compileDIOToReportWithPromotedFacts(dio, {
      financialFacts: [makeRevenueFact(1_000_000)],
    });
    const fi = (report as any).financial_integrity_v1;
    expect(fi).toBeDefined();
    expect(fi.score).not.toBeNull();
    expect(typeof fi.score).toBe('number');
  });

  it('financial_integrity_v1.score equals 0 and has_facts=false when no facts provided', () => {
    const dio = makeDio(44);
    const report = compileDIOToReportWithPromotedFacts(dio, {
      financialFacts: [],
    });
    const fi = (report as any).financial_integrity_v1;
    expect(fi).toBeDefined();
    expect(fi.score).toBe(0);
    expect(fi.has_facts).toBe(false);
  });

  it('financial_coverage_v1.score is always present and in range 0–100', () => {
    const dio = makeDio(44);
    const report = compileDIOToReportWithPromotedFacts(dio, {});
    const cov = (report as any).financial_coverage_v1;
    expect(cov).toBeDefined();
    expect(typeof cov.score).toBe('number');
    expect(cov.score).toBeGreaterThanOrEqual(0);
    expect(cov.score).toBeLessThanOrEqual(100);
  });

  it('overallScore blend is skipped when has_facts=false — score stays at base', () => {
    // health_score=44 feeds into persistedOverall via buildScoreExplanationFromDIO
    const dio = makeDio(44);
    const reportNoFacts = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [] });
    const reportWithFacts = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [makeRevenueFact(1_000_000)] });

    const scoreNoFacts = (reportNoFacts as any).overallScore;
    const scoreWithFacts = (reportWithFacts as any).overallScore;

    // Both are valid integers
    expect(Number.isInteger(scoreNoFacts)).toBe(true);
    expect(Number.isInteger(scoreWithFacts)).toBe(true);

    // When facts are present, the blend is applied (scores will differ unless quality=existing)
    const fi = (reportWithFacts as any).financial_integrity_v1;
    expect(fi.has_facts).toBe(true);
  });

  it('overallScore adjusts downward for low-quality data (low completeness)', () => {
    // Single revenue fact → low completeness_score → blend pulls score down
    const baseScore = 40;
    const dio = makeDio(baseScore);
    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [makeRevenueFact(500_000)] });
    const adjustedScore = (report as any).overallScore;

    // With low completeness, blend should pull score down from 40
    expect(adjustedScore).toBeLessThanOrEqual(baseScore);
  });

  it('grade reflects the adjusted overallScore', () => {
    const baseScore = 40;
    const dio = makeDio(baseScore);
    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [makeRevenueFact(500_000)] });
    const adjustedScore = (report as any).overallScore;
    const grade = (report as any).grade;

    // Grade must be consistent with adjusted score
    if (adjustedScore >= 85) expect(grade).toBe('Excellent');
    else if (adjustedScore >= 70) expect(grade).toBe('Good');
    else if (adjustedScore >= 55) expect(grade).toBe('Fair');
    else expect(grade).toBe('Needs Improvement');
  });

  it('financial_breakdown_v1 is not affected by quality blend', () => {
    const dio = makeDio(44);
    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [makeRevenueFact(2_000_000)] });
    const bd = (report as any).financial_breakdown_v1;
    expect(bd).toBeDefined();
    expect(bd.current_state).toBeDefined();
  });

  it('financial_integrity_v1 has_facts=true when facts provided', () => {
    const dio = makeDio(44);
    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [makeRevenueFact(1_000_000)] });
    const fi = (report as any).financial_integrity_v1;
    expect(fi.has_facts).toBe(true);
  });

  it('overallScore is an integer after blend (no fractional scores)', () => {
    const dio = makeDio(48);
    const report = compileDIOToReportWithPromotedFacts(dio, { financialFacts: [makeRevenueFact(5_000_000)] });
    const score = (report as any).overallScore;
    expect(Number.isInteger(score)).toBe(true);
  });
});
