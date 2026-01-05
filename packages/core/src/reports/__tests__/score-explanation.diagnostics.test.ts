import { buildScoringDiagnosticsFromDIO } from "../score-explanation";

const now = new Date().toISOString();

const baseDio = (): any => ({
  schema_version: "1.0.0",
  dio_id: "00000000-0000-4000-8000-000000009001",
  deal_id: "00000000-0000-4000-8000-000000009002",
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
  planner_state: { cycle: 0, goals: [], constraints: [], hypotheses: [], subgoals: [], focus: "", stop_reason: null },
  fact_table: [],
  ledger_manifest: { cycles: 0, depth_delta: [], subgoals: 0, constraints: 0, dead_ends: 0, paraphrase_invariance: 0, calibration: { brier: 0 }, total_facts_added: 0, total_evidence_cited: 0, uncertain_claims: 0 },
  risk_map: [],
  decision: { recommendation: "CONDITIONAL", confidence: 0.5, tranche_plan: { t0_amount: null, milestones: [] }, verification_checklist: [], key_strengths: [], key_weaknesses: [], evidence_ids: [] },
  narrative: { llm_version: "", generated_at: now, token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 }, executive_summary: "" },
  execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [], analyzer_execution: [] },
});

describe("scoring_diagnostics_v1", () => {
  it("populates coverage gaps vs red flags deterministically", () => {
    const dio = baseDio();

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 70, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 50, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.75, overall_risk_score: 50, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, note: "No explicit risk signals detected; using neutral baseline=50", evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 50, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const scoring_diagnostics_v1 = buildScoringDiagnosticsFromDIO(dio);

    expect(scoring_diagnostics_v1).toBeDefined();
    expect(scoring_diagnostics_v1.components).toBeDefined();

    // Must bucket coverage gaps for insufficient_data components.
    const gapComponents = new Set(scoring_diagnostics_v1.buckets.coverage_gaps.map((b) => b.component));
    expect(gapComponents.has("slide_sequence")).toBe(true);
    expect(gapComponents.has("financial_health")).toBe(true);

    // Only neutrals + insufficient_data => no red flags.
    expect(scoring_diagnostics_v1.buckets.red_flags).toEqual([]);

    // Each expected component must have stable fields.
    for (const key of [
      "slide_sequence",
      "metric_benchmark",
      "visual_design",
      "narrative_arc",
      "financial_health",
      "risk_assessment",
    ] as const) {
      const c = scoring_diagnostics_v1.components[key];
      expect(typeof c.reason).toBe("string");
      expect(c.reason.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(c.gaps)).toBe(true);
      expect(Array.isArray(c.red_flags)).toBe(true);
      expect(Array.isArray(c.evidence_ids)).toBe(true);
    }
  });

  it("buckets red flags with evidence ids when critical risks exist", () => {
    const dio = baseDio();

    const riskEvidenceId = "00000000-0000-4000-8000-000000009999";

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 70, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 50, metrics_analyzed: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.8, score: 60, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, runway_months: 6, burn_multiple: 3.2, health_score: 25, metrics: { revenue: 100000, expenses: 200000, cash_balance: 300000, burn_rate: 200000, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 50, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
      risk_assessment: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.8,
        confidence: 0.75,
        overall_risk_score: 90,
        risks_by_category: {
          market: [
            {
              risk_id: "00000000-0000-4000-8000-000000009998",
              category: "market",
              severity: "critical",
              description: "Single customer concentration > 80% revenue",
              mitigation: "Diversify customer base",
              evidence_id: riskEvidenceId,
            },
          ],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 1,
        critical_count: 1,
        high_count: 0,
        evidence_ids: [riskEvidenceId],
      },
    };

    const scoring_diagnostics_v1 = buildScoringDiagnosticsFromDIO(dio);

    expect(scoring_diagnostics_v1.buckets.red_flags.length).toBeGreaterThan(0);
    expect(scoring_diagnostics_v1.buckets.red_flags.some((b) => b.component === "risk_assessment")).toBe(true);
    expect(scoring_diagnostics_v1.buckets.red_flags.some((b) => b.evidence_ids.includes(riskEvidenceId))).toBe(true);
  });

  it("execution_ready_v1: strong readiness (no revenue) can score >= 75 and rubric treats revenue as acceptable missing", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "execution_ready_v1", confidence: 0.85, signals: ["product_ready"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "execution_ready_v1", confidence: 0.85, signals: ["product_ready"] },
        selected_policy: "execution_ready_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 85, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 90,
        metrics_analyzed: [
          { metric: "loi_count", value: 3, benchmark_value: 1, benchmark_source: "policy:execution_ready_v1:loi_count", rating: "Strong", deviation_pct: 200, evidence_id: "00000000-0000-4000-8000-000000001001" },
          { metric: "partnership_count", value: 2, benchmark_value: 1, benchmark_source: "policy:execution_ready_v1:partnership_count", rating: "Strong", deviation_pct: 100, evidence_id: "00000000-0000-4000-8000-000000001002" },
          { metric: "launch_timeline_months", value: 3, benchmark_value: 6, benchmark_source: "policy:execution_ready_v1:launch_timeline_months", rating: "Strong", deviation_pct: -50, evidence_id: "00000000-0000-4000-8000-000000001003" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 55, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("execution_ready_v1");
    expect(diagnostics.overall_score).toBeGreaterThanOrEqual(75);
    expect(diagnostics.rubric).toBeDefined();
    expect(diagnostics.rubric?.id).toBe("execution_ready_v1");
    expect(diagnostics.rubric?.missing_required ?? []).toHaveLength(0);
    expect(diagnostics.rubric?.acceptable_missing_present ?? []).toEqual(expect.arrayContaining(["revenue"]));
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "rubric")).toBe(false);
  });

  it("execution_ready_v1: missing readiness keeps score near neutral and surfaces rubric coverage gaps", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "execution_ready_v1", confidence: 0.8, signals: [] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "execution_ready_v1", confidence: 0.8, signals: [] },
        selected_policy: "execution_ready_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 85, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 90,
        metrics_analyzed: [
          { metric: "revenue", value: 10000, benchmark_value: 5000, benchmark_source: "policy:execution_ready_v1:revenue", rating: "Strong", deviation_pct: 100, evidence_id: "00000000-0000-4000-8000-000000002001" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 12, burn_multiple: 1.2, health_score: 60, metrics: { revenue: 10000, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 55, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("execution_ready_v1");
    expect(diagnostics.overall_score).toBeLessThanOrEqual(60);
    expect(diagnostics.rubric).toBeDefined();
    expect((diagnostics.rubric?.missing_required ?? []).length).toBeGreaterThan(0);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "rubric")).toBe(true);
  });
});
