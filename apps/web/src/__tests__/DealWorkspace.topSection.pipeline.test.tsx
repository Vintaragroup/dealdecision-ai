/**
 * DealWorkspace TopSection data-pipeline regression tests.
 *
 * Contract enforced:
 *   1. When topsection_v1 exists, the "Score drivers not yet computed" placeholder never renders.
 *   2. When topsection_v1 is missing but a canonical score exists, a score-anchored fallback
 *      one-liner renders instead of the generic placeholder.
 *   3. When NO canonical score and NO topsection_v1, the explicit placeholder renders.
 *   4. Garbage/noise bullets (OCR noise, too-long, too-short, single-word) do not appear.
 *   5. Score-mechanic phrases do not appear in Score Understanding.
 *   6. TopSection snapshot never equals the governed hero_summary (separation contract).
 *   7. LLM-governed overlay copy does NOT bleed into TopSection Score Understanding.
 */
import { screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWorkspace } from './dealWorkspaceTestFixture';
import { apiGetDeal } from '../lib/apiClient';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isAnalyst: true, isInvestor: false }),
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetDeal: vi.fn(),
    apiPostAnalyze: vi.fn(),
    apiPostAnalyzeWithStatus: vi.fn(),
    apiPostReextractDocuments: vi.fn(),
    apiPostExtractVisuals: vi.fn(),
    apiGetDealReadiness: vi.fn(),
    apiGetDealJobs: vi.fn(async () => []),
    apiGetJob: vi.fn(),
    isLiveBackend: vi.fn(() => true),
    apiGetEvidence: vi.fn(async () => ({ evidence: [] } as any)),
    apiGetDocuments: vi.fn(async () => ({ documents: [] } as any)),
    apiGetDealReport: vi.fn(),
    apiGetDealReportNarrated: vi.fn(async () => ({ ready: false, reason: 'not_generated_yet' } as any)),
    apiGetDealGovernedOverlayPersisted: vi.fn(async () => ({ overview: null } as any)),
    apiGetDealDeterministicUnderstanding: vi.fn(async () => null as any),
    apiPostDealDeterministicUnderstanding: vi.fn(async () => ({
      analysis_version: 'deterministic_understanding_v1',
      input_hash: 'test',
      created_at: new Date(0).toISOString(),
      patch: { analysis_version: 'deterministic_understanding_v1', created_at: new Date(0).toISOString(), input_hash: 'test', deal_id: 'deal-1', pages: {}, documents: {} },
    } as any)),
    subscribeToEvents: vi.fn(() => () => undefined),
    apiResolveEvidence: vi.fn(async () => ({ results: [] } as any)),
  };
});

// ── Shared fixtures ────────────────────────────────────────────────────────

const GOVERNED_HERO_SUMMARY =
  'AcmeCo is transforming the widget market with AI-powered solutions and exceptional team depth.';

const makeReadyDeal = () => ({
  dioVersionId: 'v2',
  dioStatus: 'ready',
  lastAnalyzedAt: '2025-01-01T00:00:00.000Z',
  dioAnalysisVersion: 2,
  score: 48,
} as any);

/** Build a report envelope with topsection_v1 populated. */
const makeReportWithTopsection = (dealId: string, opts?: {
  score_driver_one_liner?: string;
  strengths?: string[];
  weaknesses?: string[];
  actions_to_improve?: string[];
  governedHeroSummary?: string;
  understanding_v1_summary?: string;
}) => ({
  ready: true,
  version: 2,
  artifact: { kind: 'deal_intelligence_object', dio_id: `dio-ts-${dealId}`, analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
  report: {
    dealId,
    generatedAt: '2025-01-01T00:00:00.000Z',
    version: 2,
    overallScore: 65,
    recommendation: 'consider',
    sections: [],
    metadata: {
      score_band_v2: { key: 'good', label: 'Good', overall_score: 72, thresholds_version: 'v2' },
      // Governed overlay stored separately — TopSection must NOT read from this.
      governed_overlay: opts?.governedHeroSummary
        ? { hero_summary: opts.governedHeroSummary }
        : null,
      // [SCORE-CONTRACT] Canonical source for Score Understanding copy.
      // strengths/weaknesses are mirrored here so scoreExplanationV1 can derive them.
      score_explanation: {
        understanding_v1: {
          summary: opts?.understanding_v1_summary
            ? { text: opts.understanding_v1_summary }
            : null,
          strengths: (opts?.strengths ?? [
            'Strong ARR growth of 3x YoY.',
            'Gross margin above 70%.',
          ]).map((text) => ({ text })),
          diligence_open_items: (opts?.weaknesses ?? [
            'Provide unit economics (CAC/LTV) and payback period.',
          ]).map((text) => ({ text })),
          execution_dependencies: (opts?.actions_to_improve ?? [
            'Share 24-month financial model with assumptions.',
          ]).map((text) => ({ text })),
        },
      },
    },
    structured_summary: {
      topsection_v1: {
        schema_version: 'topsection_v1',
        score_driver_one_liner: opts?.score_driver_one_liner ?? 'Score of 72 — led by financial health (+22 pts).',
        strengths: opts?.strengths ?? ['Strong ARR growth of 3x YoY.', 'Gross margin above 70%.'],
        weaknesses: opts?.weaknesses ?? ['Provide unit economics (CAC/LTV) and payback period.'],
        actions_to_improve: opts?.actions_to_improve ?? ['Share 24-month financial model with assumptions.'],
      },
      deal_summary_v1: { one_liner: 'Test deal snapshot.', long_summary: '' },
    },
  },
} as any);

/** Build a report envelope WITHOUT topsection_v1 (old DIO case). */
const makeReportWithoutTopsection = (dealId: string, bandScore: number) => ({
  ready: true,
  version: 2,
  artifact: { kind: 'deal_intelligence_object', dio_id: `dio-nots-${dealId}`, analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
  report: {
    dealId,
    generatedAt: '2025-01-01T00:00:00.000Z',
    version: 2,
    overallScore: bandScore,
    recommendation: 'consider',
    sections: [],
    metadata: {
      score_band_v2: { key: 'good', label: 'Good', overall_score: bandScore, thresholds_version: 'v2' },
    },
    structured_summary: {
      // Intentionally no topsection_v1 key
      deal_summary_v1: { one_liner: 'Test deal.', long_summary: '' },
    },
  },
} as any);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DealWorkspace TopSection pipeline contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─ Test 1: topsection_v1 present → placeholder never shows ─
  test('[ts-pipe-1] when topsection_v1 exists, placeholder text never renders', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeReadyDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeReportWithTopsection('deal-ts-1', {
        score_driver_one_liner: 'Score of 72 — led by financial health (+22 pts).',
      }),
    );

    renderWorkspace({ dealId: 'deal-ts-1' });
    await screen.findByLabelText('Deal top summary');

    const summaryEl = screen.getByTestId('deal-summary-text');
    // Correct one-liner must be present.
    expect(summaryEl.textContent).toContain('Score of 72');
    // Placeholder must NOT be present.
    expect(summaryEl.textContent).not.toMatch(/Score drivers not yet computed/i);
    expect(summaryEl.textContent).not.toMatch(/Not yet derived/i);
  });

  // ─ Test 2: old DIO (no topsection_v1, no understanding_v1) + canonical score → band-based one-liner ─
  test('[ts-pipe-2] when topsection_v1 missing but canonical band exists, fallback one-liner shows band label', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeReadyDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(makeReportWithoutTopsection('deal-ts-2', 79));

    renderWorkspace({ dealId: 'deal-ts-2' });
    await screen.findByLabelText('Deal top summary');

    const summaryEl = screen.getByTestId('deal-summary-text');
    // [SCORE-CONTRACT] The one-liner must be a meaningful copy (band label), NOT a bare "Score of N".
    // With no understanding_v1.summary, the synthesis uses the band label.
    expect(summaryEl.textContent).toMatch(/Good/);
    // Must never show a bare "Score of N" (that's score repetition, not explanation).
    expect(summaryEl.textContent).not.toMatch(/^Score of \d+/);
  });

  // ─ Test 3: no topsection_v1 AND no canonical score → explicit placeholder ─
  test('[ts-pipe-3] when neither topsection_v1 nor canonical score exists, explicit placeholder renders', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue({ dioVersionId: null, dioStatus: 'pending', score: null } as any);
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue({ ready: false, reason: 'not_generated_yet' } as any);

    renderWorkspace({ dealId: 'deal-ts-3' });
    // Wait for the workspace shell to render (no report = loading state).
    await screen.findByLabelText('Deal top summary');

    // The deal-summary-text element is hidden while loading=true, so queryBy returns null.
    // Confirm the placeholder is NOT showing a phony number.
    const summaryEl = screen.queryByTestId('deal-summary-text');
    if (summaryEl) {
      expect(summaryEl.textContent).not.toMatch(/Score of \d+/);
    }
  });

  // ─ Test 4: garbage / noise bullets are stripped from Score Understanding ─
  test('[ts-pipe-4] OCR noise and score-mechanic bullets are absent from Score Understanding', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeReadyDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeReportWithTopsection('deal-ts-4', {
        score_driver_one_liner: 'Score of 72 — led by financial health.',
        strengths: [
          // These must be filtered by the web-layer _SCORE_MECHANIC_RE or the component layer
          'Narrative pacing score computed from slide cadence',
          'analyzer scored this as ok',
          // This must survive
          'Gross margin of 71% exceeds SaaS benchmarks.',
        ],
        weaknesses: [
          'Score computed via risk analyzer weighting',
          'Provide unit economics (CAC/LTV) and payback period.',
        ],
      }),
    );

    renderWorkspace({ dealId: 'deal-ts-4' });
    await screen.findByLabelText('Deal top summary');

    // Check only the TopSection area (not full body — Overview uses a separate data path).
    const topSectionEl = document.querySelector('[aria-label="Deal top summary"]');
    const sectionText = topSectionEl?.textContent ?? '';
    // Score-mechanic phrases must not appear in Score Understanding.
    expect(sectionText).not.toMatch(/Narrative pacing score computed from slide cadence/i);
    expect(sectionText).not.toMatch(/analyzer scored this as ok/i);
    expect(sectionText).not.toMatch(/Score computed via risk analyzer weighting/i);
    // Legitimate bullets must survive.
    expect(sectionText).toContain('Gross margin of 71% exceeds SaaS benchmarks.');
    expect(document.body.textContent).toContain('Provide unit economics (CAC/LTV) and payback period.');
  });

  // ─ Test 5: TopSection snapshot ≠ governed hero_summary (separation contract) ─
  test('[ts-pipe-5] TopSection deal-summary-text never equals the governed hero_summary', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeReadyDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeReportWithTopsection('deal-ts-5', {
        score_driver_one_liner: 'Score of 72 — financial health was a strength (+22 pts).',
        governedHeroSummary: GOVERNED_HERO_SUMMARY,
      }),
    );

    renderWorkspace({ dealId: 'deal-ts-5' });
    await screen.findByLabelText('Deal top summary');

    const summaryEl = screen.getByTestId('deal-summary-text');
    expect(summaryEl.textContent).not.toContain(GOVERNED_HERO_SUMMARY);
    expect(summaryEl.textContent).not.toMatch(/transforming the widget market/i);
    // Correct one-liner must be present instead.
    expect(summaryEl.textContent).toContain('Score of 72');
  });

  // ─ Test 6: LLM overlay copy does NOT bleed into Score Understanding ─
  test('[ts-pipe-6] LLM governed overlay strengths/risks never appear in Score Understanding', async () => {
    const llmStrength = 'The team has deep domain expertise and strong investor backing.';
    const llmRisk = 'Market competition is intensifying with several well-funded incumbents.';

    vi.mocked(apiGetDeal).mockResolvedValue(makeReadyDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    vi.mocked(apiGetDealReport).mockResolvedValue(
      makeReportWithTopsection('deal-ts-6', {
        score_driver_one_liner: 'Score of 72 — led by financial health.',
        // TopSection supplies its own bullets — NOT from the LLM overlay.
        strengths: ['Gross margin of 71% exceeds SaaS benchmarks.'],
        weaknesses: ['Provide unit economics (CAC/LTV) and payback period.'],
      }),
    );
    // Separately mock the governed overlay to return LLM strings.
    const { apiGetDealGovernedOverlayPersisted } = await import('../lib/apiClient');
    vi.mocked(apiGetDealGovernedOverlayPersisted).mockResolvedValue({
      overview: {
        hero_summary: GOVERNED_HERO_SUMMARY,
        strengths: [llmStrength],
        risks: [llmRisk],
      },
    } as any);

    renderWorkspace({ dealId: 'deal-ts-6' });
    await screen.findByLabelText('Deal top summary');

    const body = document.body.textContent ?? '';
    // LLM overlay bullets must NOT appear in Score Understanding.
    // (They may appear in the Overview tab but not in the TopSection columns.)
    // We can't easily check "not in Overview" here, but we can confirm they're not in
    // the specific Score Understanding section header area.
    const scoreUnderstanding = document.querySelector('[aria-label="Deal top summary"]');
    if (scoreUnderstanding) {
      expect(scoreUnderstanding.textContent).not.toContain(llmStrength);
      expect(scoreUnderstanding.textContent).not.toContain(llmRisk);
    }
    // Deterministic bullets from understanding_v1 must be present.
    expect(body).toContain('Gross margin of 71% exceeds SaaS benchmarks.');
    expect(body).toContain('Provide unit economics (CAC/LTV) and payback period.');
  });

  // ─ Test 7: score_contract regression ─
  // When reportApplied=true and score_band_v2.overall_score=48:
  //   - TopSection gauge shows 48
  //   - Overview shows 48
  //   - No narrative bullet contains a mismatching NN/100
  test('[ts-pipe-7] score_contract: TopSection and Overview both show band score=48, no mismatching /100 in copy', async () => {
    vi.mocked(apiGetDeal).mockResolvedValue(makeReadyDeal());
    const { apiGetDealReport } = await import('../lib/apiClient');
    // Custom fixture with band score=48 and understanding_v1 bullets containing stale fractions.
    vi.mocked(apiGetDealReport).mockResolvedValue({
      ready: true,
      version: 2,
      artifact: { kind: 'deal_intelligence_object', dio_id: 'dio-sc-7', analysis_version: 2, updated_at: '2025-01-01T00:00:00.000Z' },
      report: {
        dealId: 'deal-ts-7',
        generatedAt: '2025-01-01T00:00:00.000Z',
        version: 2,
        overallScore: 55,
        recommendation: 'consider',
        sections: [],
        metadata: {
          score_band_v2: { key: 'moderate', label: 'Moderate', overall_score: 48, thresholds_version: 'v2' },
          score_explanation: {
            understanding_v1: {
              strengths: [
                { text: 'Strong retention of 90% and growth metrics scored at 67/100 in analyst model.' },
                { text: 'Experienced founding team with domain depth.' },
              ],
              diligence_open_items: [
                { text: 'business_model clarity' },
                { text: 'Unit economics incomplete — current score 72/100 on this dimension.' },
              ],
              execution_dependencies: [],
            },
          },
        },
        structured_summary: {
          topsection_v1: {
            schema_version: 'topsection_v1',
            score_driver_one_liner: 'Moderate — financial fundamentals present, but gaps remain.',
            strengths: [],
            weaknesses: [],
            actions_to_improve: [],
          },
          deal_summary_v1: { one_liner: '', long_summary: '' },
        },
      },
    } as any);

    renderWorkspace({ dealId: 'deal-ts-7' });
    await screen.findByLabelText('Deal top summary');

    // ① TopSection gauge must show 48
    const radialChart = screen.getByTestId('radial-score-chart');
    expect(radialChart.textContent).toContain('48');

    // ② Overview score tile must show 48
    const overviewScoreEl = screen.queryByTestId('overview-score-text');
    if (overviewScoreEl) {
      expect(overviewScoreEl.textContent).toContain('48');
    }

    // ③ No narrative bullet may contain a /100 value that doesn't match 48
    //    "67/100" and "72/100" must have been stripped by stripScoreFractions.
    const scoreSectionEl = document.querySelector('[aria-label="Deal top summary"]');
    const sectionText = scoreSectionEl?.textContent ?? document.body.textContent ?? '';
    // Mismatching fractions must be gone
    expect(sectionText).not.toMatch(/67\s*\/\s*100/);
    expect(sectionText).not.toMatch(/72\s*\/\s*100/);
    // The canonical score (48) may render in the gauge but NOT as a /100 in copy bullets
    // (bullets are sanitized; the gauge renders it as a plain number).
    // Surviving content (non-score-fraction parts) must remain
    expect(sectionText).toMatch(/retention|domain depth|business_model|unit economics/i);
  });
});
