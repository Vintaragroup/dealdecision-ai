/**
 * Orchestration Layer Unit Tests (Schema v1.0.0)
 *
 * Fast, targeted confidence tests for edge cases:
 * - Insufficient input short-circuits analyzers
 * - continueOnError behavior for failures/timeouts
 * - Retry accounting (execution.retry_count)
 */

import { DealOrchestrator } from '../orchestrator';
import type { OrchestrationInput } from '../orchestrator';
import type { DealIntelligenceObject } from '../../types/dio';
import type { DIOStorage, DIOStorageResult } from '../../services/dio-storage';

type AnyAnalyzer = { analyze: jest.Mock<Promise<any>, any[]> };

function nowIso(): string {
  return new Date().toISOString();
}

function okSlideSequence(overrides: Record<string, unknown> = {}) {
  return {
    analyzer_version: '1.0.0',
    executed_at: nowIso(),
    status: 'ok',
    coverage: 1,
    confidence: 0.8,
    score: 80,
    pattern_match: 'Problem-First',
    sequence_detected: [],
    expected_sequence: [],
    deviations: [],
    evidence_ids: [],
    ...overrides,
  };
}

function okMetricBenchmark(overrides: Record<string, unknown> = {}) {
  return {
    analyzer_version: '1.0.0',
    executed_at: nowIso(),
    status: 'ok',
    coverage: 1,
    confidence: 0.8,
    metrics_analyzed: [],
    overall_score: 70,
    evidence_ids: [],
    ...overrides,
  };
}

function okVisualDesign(overrides: Record<string, unknown> = {}) {
  return {
    analyzer_version: '1.0.0',
    executed_at: nowIso(),
    status: 'ok',
    coverage: 1,
    confidence: 0.8,
    design_score: 60,
    proxy_signals: {
      page_count_appropriate: true,
      image_to_text_ratio_balanced: true,
      consistent_formatting: true,
    },
    strengths: [],
    weaknesses: [],
    note: 'ok',
    evidence_ids: [],
    ...overrides,
  };
}

function okNarrativeArc(overrides: Record<string, unknown> = {}) {
  return {
    analyzer_version: '1.0.0',
    executed_at: nowIso(),
    status: 'ok',
    coverage: 1,
    confidence: 0.8,
    archetype: 'hero',
    archetype_confidence: 0.6,
    pacing_score: 65,
    emotional_beats: [],
    evidence_ids: [],
    ...overrides,
  };
}

function okFinancialHealth(overrides: Record<string, unknown> = {}) {
  return {
    analyzer_version: '1.0.0',
    executed_at: nowIso(),
    status: 'ok',
    coverage: 1,
    confidence: 0.8,
    runway_months: 12,
    burn_multiple: 1.2,
    health_score: 55,
    metrics: {
      revenue: 1000,
      expenses: null,
      cash_balance: null,
      burn_rate: null,
      growth_rate: null,
    },
    risks: [],
    evidence_ids: [],
    ...overrides,
  };
}

function okRiskAssessment(overrides: Record<string, unknown> = {}) {
  return {
    analyzer_version: '1.0.0',
    executed_at: nowIso(),
    status: 'ok',
    coverage: 1,
    confidence: 0.8,
    overall_risk_score: 40,
    risks_by_category: {
      market: [],
      team: [],
      financial: [],
      execution: [],
    },
    total_risks: 0,
    critical_count: 0,
    high_count: 0,
    evidence_ids: [],
    ...overrides,
  };
}

function createStorage(): DIOStorage & { saved: DealIntelligenceObject[]; saveDIO: jest.Mock } {
  const saved: DealIntelligenceObject[] = [];

  const saveDIO = jest.fn(async (dio: DealIntelligenceObject): Promise<DIOStorageResult> => {
    saved.push(dio);
    return {
      dio_id: dio.dio_id,
      version: saved.length,
      created_at: nowIso(),
      is_duplicate: false,
    };
  });

  return {
    saved,
    saveDIO,
    getLatestDIO: jest.fn(async () => saved[saved.length - 1] ?? null),
    getDIOVersion: jest.fn(async () => null),
    getDIOHistory: jest.fn(async () => []),
    queryDIOs: jest.fn(async () => []),
    deleteDIOs: jest.fn(async () => 0),
    findByInputHash: jest.fn(async () => null),
  };
}

function createAnalyzer(result: any): AnyAnalyzer {
  return {
    analyze: jest.fn(async () => result),
  };
}

function baseInputWithDocuments(): OrchestrationInput {
  return {
    deal_id: '11111111-1111-1111-1111-111111111111',
    analysis_cycle: 1,
    input_data: {
      documents: [
        {
          fileName: 'Test Deck.pdf',
          totalPages: 12,
          fileSizeBytes: 1000,
          totalWords: 400,
          mainHeadings: ['Problem', 'Solution', 'Traction', 'Team'],
          keyMetrics: [{ key: 'revenue', value: 'Revenue: $1,000', source: 'deck' }],
          textSummary: 'We have traction and early revenue.',
        },
      ],
    },
  };
}

it('prefers canonical financial metrics over keyFinancialMetrics when building extracted_metrics', async () => {
  const storage = createStorage();

  const seen: { finInput?: any } = {};
  const finAnalyzer: AnyAnalyzer = {
    analyze: jest.fn(async (input: any) => {
      seen.finInput = input;
      return okFinancialHealth();
    }),
  };

  const analyzers = {
    slideSequence: createAnalyzer(okSlideSequence()),
    metricBenchmark: createAnalyzer(okMetricBenchmark()),
    visualDesign: createAnalyzer(okVisualDesign()),
    narrativeArc: createAnalyzer(okNarrativeArc()),
    financialHealth: finAnalyzer,
    riskAssessment: createAnalyzer(okRiskAssessment()),
  };

  const orchestrator = new DealOrchestrator(analyzers as any, storage, { debug: false });

  const input: OrchestrationInput = {
    deal_id: '33333333-3333-3333-3333-333333333333',
    analysis_cycle: 1,
    input_data: {
      documents: [
        {
          fileName: 'Financials.xlsx',
          totalPages: 1,
          fileSizeBytes: 1000,
          totalWords: 10,
          mainHeadings: ['Financials'],
          keyMetrics: [],
          keyFinancialMetrics: { revenue: 999 },
          structured_data: {
            canonical: {
              financials: {
                canonical_metrics: {
                  revenue: 100,
                  expenses: 130,
                  cogs: 50,
                  cash_balance: 520,
                  burn_rate: 30,
                  runway_months: 17.3333,
                  gross_margin: 50,
                },
              },
            },
          },
          textSummary: 'Financial spreadsheet',
        },
      ],
    },
  };

  const result = await orchestrator.analyze(input);
  expect(result.success).toBe(true);
  expect(finAnalyzer.analyze).toHaveBeenCalledTimes(1);
  expect(seen.finInput).toBeTruthy();

  const extracted = Array.isArray(seen.finInput.extracted_metrics) ? seen.finInput.extracted_metrics : [];
  const revenueEntries = extracted.filter((m: any) => m?.name === 'revenue').map((m: any) => m.value);

  // Canonical should appear before any legacy keyFinancialMetrics-derived value.
  expect(revenueEntries[0]).toBe(100);
});

describe('DealOrchestrator (unit)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.useRealTimers();
  });

  it('composes executive_summary_v2 from worker phase1_deal_overview_v2 extras', async () => {
    const storage = createStorage();

    const analyzers = {
      slideSequence: createAnalyzer(okSlideSequence()),
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, { debug: false });

    const input: OrchestrationInput = {
      ...baseInputWithDocuments(),
      deal_id: '44444444-4444-4444-4444-444444444444',
      analysis_cycle: 1,
      input_data: {
        ...(baseInputWithDocuments().input_data as any),
        phase1_deal_overview_v2: {
          product_solution: 'We provide a platform that automates investor deal screening for teams.',
          market_icp: 'Built for venture funds and angel syndicates.',
          raise: '$2.5M seed',
          business_model: 'SaaS / subscription',
          traction_signals: ['Revenue mentioned', 'Customers mentioned'],
          key_risks_detected: ['Competition'],
        },
      },
    };

    const result = await orchestrator.analyze(input);
    expect(result.success).toBe(true);

    const saved = storage.saved[storage.saved.length - 1] as any;
    expect(saved?.dio?.phase1?.deal_overview_v2).toBeTruthy();
    const es2 = saved?.dio?.phase1?.executive_summary_v2;
    expect(es2).toBeTruthy();

    const missing = Array.isArray(es2?.missing) ? es2.missing : [];
    for (const key of ['raise', 'business_model', 'traction_signals', 'key_risks_detected']) {
      expect(missing).not.toContain(key);
    }
  });

  it('short-circuits analyzers when documents are missing (insufficient_data)', async () => {
    const storage = createStorage();

    const analyzers = {
      slideSequence: createAnalyzer(okSlideSequence()),
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, { debug: false });

    const input: OrchestrationInput = {
      deal_id: '22222222-2222-2222-2222-222222222222',
      analysis_cycle: 1,
      input_data: { documents: [] },
    };

    const result = await orchestrator.analyze(input);
    expect(result.success).toBe(true);
    expect(result.dio).toBeDefined();

    // Phase 1 deterministic slices are always present.
    expect((result.dio as any).dio?.phase1?.executive_summary_v1).toBeTruthy();
    expect((result.dio as any).dio?.phase1?.decision_summary_v1).toBeTruthy();

    // No analyzers should be invoked.
    expect(analyzers.slideSequence.analyze).not.toHaveBeenCalled();
    expect(analyzers.metricBenchmark.analyze).not.toHaveBeenCalled();
    expect(analyzers.visualDesign.analyze).not.toHaveBeenCalled();
    expect(analyzers.narrativeArc.analyze).not.toHaveBeenCalled();
    expect(analyzers.financialHealth.analyze).not.toHaveBeenCalled();
    expect(analyzers.riskAssessment.analyze).not.toHaveBeenCalled();

    expect(result.dio!.analyzer_results.slide_sequence.status).toBe('insufficient_data');
    expect(result.dio!.analyzer_results.metric_benchmark.status).toBe('insufficient_data');
    expect(result.dio!.analyzer_results.visual_design.status).toBe('insufficient_data');
    expect(result.dio!.analyzer_results.narrative_arc.status).toBe('insufficient_data');
    expect(result.dio!.analyzer_results.financial_health.status).toBe('insufficient_data');
    expect(result.dio!.analyzer_results.risk_assessment.status).toBe('insufficient_data');

    expect(result.execution.analyzers_failed).toBe(0);
    expect(result.execution.retry_count).toBe(0);
    expect(storage.saveDIO).toHaveBeenCalledTimes(1);
  });

  it('continues on analyzer failure when continueOnError=true and records failures', async () => {
    const storage = createStorage();

    const failingSlideSequence: AnyAnalyzer = {
      analyze: jest.fn(async () => {
        throw new Error('boom');
      }),
    };

    const analyzers = {
      slideSequence: failingSlideSequence,
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, {
      maxRetries: 0,
      continueOnError: true,
      analyzerTimeout: 1000,
      debug: false,
    });

    const result = await orchestrator.analyze(baseInputWithDocuments());
    expect(result.success).toBe(true);
    expect(result.dio).toBeDefined();
    expect(result.dio!.analyzer_results.slide_sequence.status).toBe('extraction_failed');

    expect(result.execution.analyzers_failed).toBe(1);
    expect(result.execution.retry_count).toBe(0);
    expect(result.failures).toEqual([
      expect.objectContaining({ analyzer: 'slideSequence', retry_attempts: 0 }),
    ]);
  });

  it('uses a single primary pitch deck for deck-sensitive analyzer inputs (no multi-deck page inflation)', async () => {
    const storage = createStorage();

    const analyzers = {
      slideSequence: createAnalyzer(okSlideSequence()),
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, { debug: true });

    const input: OrchestrationInput = {
      deal_id: '33333333-3333-3333-3333-333333333333',
      analysis_cycle: 1,
      input_data: {
        documents: [
          {
            fileName: 'WebMax Pitch Deck.pdf',
            contentType: 'application/pdf',
            totalPages: 14,
            fileSizeBytes: 2000,
            totalWords: 500,
            textItems: 900,
            mainHeadings: ['Problem', 'Solution', 'Traction', 'Market', 'Team', 'Ask'],
            textSummary: 'Deck A summary',
            extractionMetadata: {
              completeness: { score: 0.9 },
              textItems: 900,
              headingsCount: 6,
              needsOcr: false,
            },
          },
          {
            fileName: 'WebMax Pitch Deck v2 edits.pdf',
            contentType: 'application/pdf',
            totalPages: 16,
            fileSizeBytes: 2100,
            totalWords: 520,
            textItems: 950,
            mainHeadings: ['Problem', 'Solution', 'Traction', 'Market', 'Team', 'Ask'],
            textSummary: 'Deck B summary',
            extractionMetadata: {
              completeness: { score: 0.6 },
              textItems: 950,
              headingsCount: 6,
              needsOcr: false,
            },
          },
          {
            fileName: 'WebMax Financial Model.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            totalPages: 0,
            mainHeadings: ['P&L', 'Cash Flow', 'Forecast'],
            keyFinancialMetrics: { revenue: '$1000000', burn_rate: '$50000' },
          },
        ],
      },
    };

    const result = await orchestrator.analyze(input);
    expect(result.success).toBe(true);

    // pickPrimaryDeck should log the chosen doc id/title when debug is enabled.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[DealOrchestrator\] Selected primary pitch deck \(pickPrimaryDeck\)/),
      expect.objectContaining({ doc_id: 'idx_0', title: 'WebMax Pitch Deck.pdf' })
    );

    // Slide sequence should only see the selected primary deck headings.
    expect(analyzers.slideSequence.analyze).toHaveBeenCalledTimes(1);
    const slideSeqInput = (analyzers.slideSequence.analyze as jest.Mock).mock.calls[0][0];
    expect(slideSeqInput.headings).toEqual(['Problem', 'Solution', 'Traction', 'Market', 'Team', 'Ask']);

    // Visual design should only see the selected primary deck page count (14), not 14+16.
    expect(analyzers.visualDesign.analyze).toHaveBeenCalledTimes(1);
    const visualInput = (analyzers.visualDesign.analyze as jest.Mock).mock.calls[0][0];
    expect(visualInput.page_count).toBe(14);
    expect(visualInput.headings).toEqual(['Problem', 'Solution', 'Traction', 'Market', 'Team', 'Ask']);

    // Narrative arc slides should be built from the selected primary deck only.
    expect(analyzers.narrativeArc.analyze).toHaveBeenCalledTimes(1);
    const narrativeInput = (analyzers.narrativeArc.analyze as jest.Mock).mock.calls[0][0];
    expect(narrativeInput.slides.map((s: any) => s.heading)).toEqual(['Problem', 'Solution', 'Traction', 'Market', 'Team', 'Ask']);
  });

  it('extracts numeric metrics from Excel keyFinancialMetrics {avg,max,min} objects for financialHealth', async () => {
    const storage = createStorage();

    const analyzers = {
      slideSequence: createAnalyzer(okSlideSequence()),
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, { debug: false });

    const input: OrchestrationInput = {
      deal_id: '44444444-4444-4444-4444-444444444444',
      analysis_cycle: 1,
      input_data: {
        documents: [
          {
            fileName: 'WebMax Pitch Deck.pdf',
            contentType: 'application/pdf',
            totalPages: 12,
            fileSizeBytes: 1000,
            totalWords: 400,
            mainHeadings: ['Problem', 'Solution', 'Traction', 'Team'],
            textSummary: 'We have traction and early revenue.',
          },
          {
            fileName: 'WebMax Financial Model.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            totalPages: 0,
            keyFinancialMetrics: {
              'Ending Cash Balance': { avg: '$1.2M', max: '$1.3M', min: '$1.1M' },
              'Monthly Burn Rate': { avg: '$100k', max: '$120k', min: '$80k' },
              'Revenue (Annual)': { avg: '$2.4M', max: '$3.0M', min: '$2.0M' },
            },
          },
        ],
      },
    };

    const result = await orchestrator.analyze(input);
    expect(result.success).toBe(true);

    expect(analyzers.financialHealth.analyze).toHaveBeenCalledTimes(1);
    const finInput = (analyzers.financialHealth.analyze as jest.Mock).mock.calls[0][0];
    const extracted = Array.isArray(finInput?.extracted_metrics) ? finInput.extracted_metrics : [];

    expect(extracted.length).toBeGreaterThan(0);
    expect(extracted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cash_balance', value: expect.any(Number) }),
        expect.objectContaining({ name: 'burn_rate', value: expect.any(Number) }),
        expect.objectContaining({ name: 'revenue', value: expect.any(Number) }),
      ])
    );
  });

  it('infers financial metric names from keyMetrics.source when key is generic (numeric_value)', async () => {
    const storage = createStorage();

    const analyzers = {
      slideSequence: createAnalyzer(okSlideSequence()),
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, { debug: false });

    const input: OrchestrationInput = {
      deal_id: '55555555-5555-5555-5555-555555555555',
      analysis_cycle: 1,
      input_data: {
        documents: [
          {
            fileName: 'Generic Metrics Deck.pdf',
            contentType: 'application/pdf',
            totalPages: 12,
            fileSizeBytes: 1000,
            totalWords: 400,
            mainHeadings: ['Traction'],
            textSummary: 'Key metrics summary.',
            keyMetrics: [
              { key: 'numeric_value', value: '18', source: 'Runway: 18 months' },
              { key: 'numeric_value', value: '$500k', source: 'Cash on hand' },
              { key: 'numeric_value', value: '$50k', source: 'Monthly burn rate' },
            ],
          },
        ],
      },
    };

    const result = await orchestrator.analyze(input);
    expect(result.success).toBe(true);

    expect(analyzers.financialHealth.analyze).toHaveBeenCalledTimes(1);
    const finInput = (analyzers.financialHealth.analyze as jest.Mock).mock.calls[0][0];
    const extracted = Array.isArray(finInput?.extracted_metrics) ? finInput.extracted_metrics : [];

    expect(extracted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'runway_months', value: 18 }),
        expect.objectContaining({ name: 'cash_balance', value: expect.any(Number) }),
        expect.objectContaining({ name: 'burn_rate', value: expect.any(Number) }),
      ])
    );

    expect(extracted.some((m: any) => m?.name === 'numeric_value')).toBe(false);
  });

  it('fails the orchestration when continueOnError=false', async () => {
    const storage = createStorage();

    const analyzers = {
      slideSequence: {
        analyze: jest.fn(async () => {
          throw new Error('boom');
        }),
      },
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, {
      maxRetries: 0,
      continueOnError: false,
      analyzerTimeout: 1000,
      debug: false,
    });

    const result = await orchestrator.analyze(baseInputWithDocuments());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed/i);
  });

  it('enforces analyzer timeout and records a failure (continueOnError=true)', async () => {
    jest.useFakeTimers();

    const storage = createStorage();

    const neverResolves: AnyAnalyzer = {
      analyze: jest.fn(() => new Promise(() => {})),
    };

    const analyzers = {
      slideSequence: neverResolves,
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, {
      maxRetries: 0,
      analyzerTimeout: 1000,
      continueOnError: true,
      debug: false,
    });

    const promise = orchestrator.analyze(baseInputWithDocuments());
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1001);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.dio!.analyzer_results.slide_sequence.status).toBe('extraction_failed');
    expect(result.execution.analyzers_failed).toBe(1);
    expect(result.execution.retry_count).toBe(0);
    expect(result.failures?.[0]?.error).toMatch(/timed out/i);
  });

  it('increments execution.retry_count when a transient failure is retried and then succeeds', async () => {
    jest.useFakeTimers();

    const storage = createStorage();

    const flakySlideSequence: AnyAnalyzer = {
      analyze: jest
        .fn()
        .mockRejectedValueOnce(new Error('flaky'))
        .mockResolvedValueOnce(okSlideSequence({ score: 77 })),
    };

    const analyzers = {
      slideSequence: flakySlideSequence,
      metricBenchmark: createAnalyzer(okMetricBenchmark()),
      visualDesign: createAnalyzer(okVisualDesign()),
      narrativeArc: createAnalyzer(okNarrativeArc()),
      financialHealth: createAnalyzer(okFinancialHealth()),
      riskAssessment: createAnalyzer(okRiskAssessment()),
    };

    const orchestrator = new DealOrchestrator(analyzers as any, storage, {
      maxRetries: 1,
      analyzerTimeout: 1000,
      continueOnError: true,
      debug: false,
    });

    const promise = orchestrator.analyze(baseInputWithDocuments());
    await Promise.resolve();

    // Backoff after first failure (1000ms)
    await jest.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.execution.retry_count).toBe(1);
    expect(result.execution.analyzers_failed).toBe(0);
    expect(result.failures).toBeUndefined();
    expect(result.dio!.analyzer_results.slide_sequence.status).toBe('ok');
    expect(result.dio!.analyzer_results.slide_sequence.score).toBe(77);
  });
});
