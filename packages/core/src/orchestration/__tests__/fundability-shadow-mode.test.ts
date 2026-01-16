import { DealOrchestrator } from "../orchestrator";

describe("orchestrator: fundability shadow mode", () => {
  const now = new Date().toISOString();

  const mkAnalyzer = (result: any) =>
    ({
      metadata: {
        name: "test",
        version: "1.0.0",
        released_at: now,
        changelog: "",
      },
      analyze: async () => result,
      validateInput: () => ({ valid: true, errors: [], warnings: [] }),
      getInputHash: () => "hash",
    }) as any;

  const mkStorage = () =>
    ({
      saveDIO: async (dio: any) => ({ dio_id: dio.dio_id, version: 1, created_at: dio.created_at, is_duplicate: false }),
      getLatestDIO: async () => null,
      getDIOVersion: async () => null,
      getDIOHistory: async () => [],
      queryDIOs: async () => [],
      deleteDIO: async () => undefined,
    }) as any;

  const mkRegistry = () => {
    const base = {
      analyzer_version: "1.0.0",
      executed_at: now,
      status: "ok",
      coverage: 1,
      confidence: 1,
      evidence_ids: [],
    };

    return {
      slideSequence: mkAnalyzer({
        ...base,
        score: 60,
        pattern_match: "ok",
        sequence_detected: [],
        expected_sequence: [],
        deviations: [],
      }),
      metricBenchmark: mkAnalyzer({ ...base, metrics_analyzed: [], overall_score: 50 }),
      visualDesign: mkAnalyzer({
        ...base,
        design_score: 50,
        proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true },
        strengths: [],
        weaknesses: [],
        note: "",
      }),
      narrativeArc: mkAnalyzer({ ...base, archetype: "x", archetype_confidence: 1, pacing_score: 70, emotional_beats: [] }),
      financialHealth: mkAnalyzer({
        ...base,
        runway_months: null,
        burn_multiple: null,
        health_score: 50,
        metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null },
        risks: [],
      }),
      riskAssessment: mkAnalyzer({
        ...base,
        overall_risk_score: 50,
        risks_by_category: { market: [], team: [], financial: [], execution: [] },
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
      }),
    };
  };

  afterEach(() => {
    delete process.env.FUNDABILITY_SHADOW_MODE;
  });

  it("keeps legacy overall_score unchanged when shadow mode enabled", async () => {
    const orchestrator = new DealOrchestrator(mkRegistry(), mkStorage(), { debug: false });

    const input = {
      deal_id: "00000000-0000-4000-8000-000000000222",
      analysis_cycle: 1,
      input_data: {
        documents: [],
        evidence: [],
        config: { features: { debug_scoring: false } },
      },
    } as any;

    const off = await orchestrator.analyze(input);
    expect(off.success).toBe(true);
    const scoreOff = (off.dio as any)?.overall_score;

    process.env.FUNDABILITY_SHADOW_MODE = "1";
    const on = await orchestrator.analyze(input);
    expect(on.success).toBe(true);

    const scoreOn = (on.dio as any)?.overall_score;
    expect(scoreOn).toBe(scoreOff);

    expect((on.dio as any)?.dio?.phase_inference_v1).toBeDefined();
    expect((on.dio as any)?.dio?.fundability_assessment_v1).toBeDefined();

    expect((off.dio as any)?.dio?.phase_inference_v1).toBeUndefined();
    expect((off.dio as any)?.dio?.fundability_assessment_v1).toBeUndefined();
  });
});
