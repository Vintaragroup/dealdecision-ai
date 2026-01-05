import { buildScoreExplanationFromDIO } from "../score-explanation";

describe("score_explanation policy routing", () => {
  const now = new Date().toISOString();

  const mkBaseDio = (): any => ({
    schema_version: "1.0.0",
    dio_id: "00000000-0000-4000-8000-000000000111",
    deal_id: "00000000-0000-4000-8000-000000000222",
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: {
      primary_doc_type: "pitch_deck",
      deal_type: "startup_raise",
      vertical: "saas",
      stage: "seed",
      confidence: 0.9,
    },
    dio: {},
    inputs: {
      documents: [],
      evidence: [],
      config: {
        analyzer_versions: {
          slide_sequence: "1.0.0",
          metric_benchmark: "1.0.0",
          visual_design: "1.0.0",
          narrative_arc: "1.0.0",
          financial_health: "1.0.0",
          risk_assessment: "1.0.0",
        },
        features: {
          tavily_enabled: false,
          mcp_enabled: false,
          llm_synthesis_enabled: false,
          debug_scoring: false,
        },
        parameters: {
          max_cycles: 3,
          depth_threshold: 2,
          min_confidence: 0.7,
        },
      },
    },
    analyzer_results: {
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.8, score: 60, deviations: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, overall_score: 50, metrics_analyzed: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, design_score: 50, strengths: [], weaknesses: [] },
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, pacing_score: 70, emotional_beats: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, health_score: 50, metrics: {} },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, overall_risk_score: 50, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0 },
    },
    planner_state: { cycle: 0, goals: [], constraints: [], hypotheses: [], subgoals: [], focus: "", stop_reason: null },
    fact_table: [],
    ledger_manifest: { chains: [], latest_chain_id: null },
    risk_map: [],
    decision: { recommendation: "CONDITIONAL", confidence: 0.5, verification_checklist: [] },
    narrative: { executive_summary: "", investment_thesis: "", risks: [], strengths: [], recommendation_rationale: "", token_usage: null },
    execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [] },
  });

  it("uses policy weights when deal_classification_v1 exists", () => {
    const dio = mkBaseDio();
    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "real_estate", deal_structure: "preferred_equity", strategy_subtype: "real_estate_preferred_equity", confidence: 0.9, signals: ["NOI", "DSCR"] },
        ],
        selected: { asset_class: "real_estate", deal_structure: "preferred_equity", strategy_subtype: "real_estate_preferred_equity", confidence: 0.9, signals: ["NOI", "DSCR"] },
        selected_policy: "real_estate_underwriting",
        routing_reason: ["test"],
      },
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    // Real estate underwriting policy weight should override pitch_deck legacy (metric_benchmark would be 1.0 under legacy).
    expect(explanation.aggregation.weights.metric_benchmark).toBe(1.5);
    expect(explanation.aggregation.weights.slide_sequence).toBe(0);
    expect(explanation.aggregation.weights.narrative_arc).toBe(1.1);
    expect(explanation.aggregation.weights.financial_health).toBe(0);
    expect(explanation.aggregation.policy_id).toBe("real_estate_underwriting");
  });

  it("falls back to legacy context weights when classification missing", () => {
    const dio = mkBaseDio();
    dio.dio = {};

    const explanation = buildScoreExplanationFromDIO(dio);
    expect(explanation.aggregation.weights.metric_benchmark).toBe(1.0);
    expect(explanation.aggregation.weights.narrative_arc).toBe(1.5);
    expect(explanation.aggregation.policy_id).toBeNull();
  });

  it("unknown_generic never yields overall_score=0 for reasonable inputs", () => {
    const dio = mkBaseDio();
    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "unknown", deal_structure: "unknown", strategy_subtype: null, confidence: 0.5, signals: ["fallback"] },
        ],
        selected: { asset_class: "unknown", deal_structure: "unknown", strategy_subtype: null, confidence: 0.5, signals: ["fallback"] },
        selected_policy: "unknown_generic",
        routing_reason: ["test"],
      },
    };

    const explanation = buildScoreExplanationFromDIO(dio);
    expect(explanation.totals.overall_score).not.toBe(0);
    expect(explanation.totals.overall_score).not.toBeNull();
  });
});
