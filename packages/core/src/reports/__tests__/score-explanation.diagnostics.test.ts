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

  it("operating_startup_revenue_v1: strong execution + acceptable risk can score > 75", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "operating_startup_revenue_v1", confidence: 0.85, signals: ["revenue", "gross_margin_or_unit_economics", "risk_controls", "retention_or_churn"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "operating_startup_revenue_v1", confidence: 0.85, signals: ["revenue", "gross_margin_or_unit_economics", "risk_controls", "retention_or_churn"] },
        selected_policy: "operating_startup_revenue_v1",
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
        overall_score: 92,
        metrics_analyzed: [
          { metric: "revenue", value: 120000, benchmark_value: 80000, benchmark_source: "policy:operating_startup_revenue_v1:revenue", rating: "Strong", deviation_pct: 50, evidence_id: "00000000-0000-4000-8000-000000003001" },
          { metric: "gross_margin", value: 0.7, benchmark_value: 0.5, benchmark_source: "policy:operating_startup_revenue_v1:gross_margin", rating: "Strong", deviation_pct: 40, evidence_id: "00000000-0000-4000-8000-000000003002" },
          { metric: "churn", value: 0.04, benchmark_value: 0.06, benchmark_source: "policy:operating_startup_revenue_v1:churn", rating: "Strong", deviation_pct: -33, evidence_id: "00000000-0000-4000-8000-000000003003" },
        ],
        evidence_ids: [],
      },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 10, burn_multiple: 1.8, health_score: 78, metrics: { revenue: 120000, expenses: 90000, cash_balance: 500000, burn_rate: 50000, growth_rate: 0.15 }, risks: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 25, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 55, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("operating_startup_revenue_v1");
    expect(diagnostics.overall_score).toBeGreaterThan(75);
    expect(diagnostics.rubric?.id).toBe("operating_startup_revenue_v1");
    expect(diagnostics.rubric?.missing_required ?? []).toHaveLength(0);
    expect(diagnostics.buckets.positive_signals.some((b) => b.component === "policy")).toBe(true);
  });

  it("operating_startup_revenue_v1: revenue alone cannot exceed 70 and surfaces an explicit policy cap diagnostic", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "operating_startup_revenue_v1", confidence: 0.8, signals: ["revenue"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "operating_startup_revenue_v1", confidence: 0.8, signals: ["revenue"] },
        selected_policy: "operating_startup_revenue_v1",
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
        overall_score: 95,
        metrics_analyzed: [
          { metric: "revenue", value: 150000, benchmark_value: 80000, benchmark_source: "policy:operating_startup_revenue_v1:revenue", rating: "Strong", deviation_pct: 88, evidence_id: "00000000-0000-4000-8000-000000004001" },
        ],
        evidence_ids: [],
      },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 12, burn_multiple: 1.5, health_score: 80, metrics: { revenue: 150000, expenses: 100000, cash_balance: 600000, burn_rate: 50000, growth_rate: 0.2 }, risks: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 55, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("operating_startup_revenue_v1");
    expect(diagnostics.overall_score).toBe(70);
    expect(diagnostics.rubric?.score_cap_applied).toBe(70);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /capped at 70/i.test(b.text))).toBe(true);
  });

  it("operating_startup_revenue_v1: strong execution but unacceptable risk caps at 75 and surfaces gating diagnostic", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "operating_startup_revenue_v1", confidence: 0.85, signals: ["revenue", "gross_margin_or_unit_economics", "risk_controls"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "operating_startup_revenue_v1", confidence: 0.85, signals: ["revenue", "gross_margin_or_unit_economics", "risk_controls"] },
        selected_policy: "operating_startup_revenue_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 100, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 100,
        metrics_analyzed: [
          { metric: "revenue", value: 200000, benchmark_value: 80000, benchmark_source: "policy:operating_startup_revenue_v1:revenue", rating: "Strong", deviation_pct: 150, evidence_id: "00000000-0000-4000-8000-000000005001" },
          { metric: "gross_margin", value: 0.65, benchmark_value: 0.5, benchmark_source: "policy:operating_startup_revenue_v1:gross_margin", rating: "Strong", deviation_pct: 30, evidence_id: "00000000-0000-4000-8000-000000005002" },
        ],
        evidence_ids: [],
      },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 100, metrics: { revenue: 200000, expenses: 150000, cash_balance: 400000, burn_rate: 50000, growth_rate: 0.1 }, risks: [], evidence_ids: [] },
      // Unacceptable risk: high risk score and explicit high/critical risks in risk_map.
      risk_assessment: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_risk_score: 80,
        risks_by_category: {
          market: [
            {
              risk_id: "00000000-0000-4000-8000-000000005998",
              category: "market",
              severity: "high",
              description: "Customer concentration > 80% revenue",
              mitigation: "Diversify customer base",
              evidence_id: "00000000-0000-4000-8000-000000005999",
            },
          ],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 1,
        critical_count: 0,
        high_count: 1,
        evidence_ids: ["00000000-0000-4000-8000-000000005999"],
      },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 55, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    // Also provide risk_map because the gating logic checks it for high/critical severities.
    dio.risk_map = [
      {
        risk_id: "00000000-0000-4000-8000-000000005998",
        category: "market",
        severity: "high",
        title: "Customer concentration",
        description: "Customer concentration > 80% revenue",
        mitigation: "Diversify customer base",
        evidence_id: "00000000-0000-4000-8000-000000005999",
      },
    ];

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("operating_startup_revenue_v1");
    expect(diagnostics.overall_score).toBe(75);
    expect(diagnostics.rubric?.score_cap_applied).toBe(75);
    expect(diagnostics.rubric?.red_flags_triggered ?? []).toHaveLength(0);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && />75 requires/i.test(b.text))).toBe(true);
  });

  it("consumer_ecommerce_brand_v1: strong unit economics + acceptable risk scores >= 75 and emits policy positive signals", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_ecommerce_brand_v1", confidence: 0.9, signals: ["unit_economics", "risk_controls"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_ecommerce_brand_v1", confidence: 0.9, signals: ["unit_economics", "risk_controls"] },
        selected_policy: "consumer_ecommerce_brand_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 80, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 92,
        metrics_analyzed: [
          { metric: "ltv_to_cac", value: 4.2, benchmark_value: 3, benchmark_source: "policy:consumer_ecommerce_brand_v1:ltv_to_cac", rating: "Strong", deviation_pct: 40, evidence_id: "00000000-0000-4000-8000-000000006001" },
          { metric: "gross_margin_pct", value: 0.62, benchmark_value: 0.5, benchmark_source: "policy:consumer_ecommerce_brand_v1:gross_margin_pct", rating: "Strong", deviation_pct: 24, evidence_id: "00000000-0000-4000-8000-000000006002" },
          { metric: "cac", value: 35, benchmark_value: 40, benchmark_source: "policy:consumer_ecommerce_brand_v1:cac", rating: "Strong", deviation_pct: -12.5, evidence_id: "00000000-0000-4000-8000-000000006003" },
          { metric: "aov", value: 95, benchmark_value: 75, benchmark_source: "policy:consumer_ecommerce_brand_v1:aov", rating: "Strong", deviation_pct: 26, evidence_id: "00000000-0000-4000-8000-000000006004" },
          { metric: "repeat_purchase_rate", value: 0.4, benchmark_value: 0.25, benchmark_source: "policy:consumer_ecommerce_brand_v1:repeat_purchase_rate", rating: "Strong", deviation_pct: 60, evidence_id: "00000000-0000-4000-8000-000000006005" },
          { metric: "conversion_rate", value: 0.035, benchmark_value: 0.025, benchmark_source: "policy:consumer_ecommerce_brand_v1:conversion_rate", rating: "Strong", deviation_pct: 40, evidence_id: "00000000-0000-4000-8000-000000006006" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 30, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("consumer_ecommerce_brand_v1");
    expect(diagnostics.overall_score).toBeGreaterThanOrEqual(75);
    expect(diagnostics.buckets.positive_signals.some((b) => b.component === "policy" && /unit economics/i.test(b.text))).toBe(true);
    expect(diagnostics.buckets.red_flags).toEqual([]);
  });

  it("consumer_ecommerce_brand_v1: missing core KPIs stays near neutral and surfaces coverage gaps (not red flags)", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_ecommerce_brand_v1", confidence: 0.85, signals: [] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_ecommerce_brand_v1", confidence: 0.85, signals: [] },
        selected_policy: "consumer_ecommerce_brand_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 95, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 30, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("consumer_ecommerce_brand_v1");
    expect(diagnostics.overall_score).toBeLessThanOrEqual(60);
    expect(diagnostics.buckets.red_flags).toEqual([]);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /unit economics/i.test(b.text))).toBe(true);
  });

  it("consumer_ecommerce_brand_v1: strong unit economics but unacceptable risk caps at 75 and does NOT populate rubric.red_flags_triggered", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_ecommerce_brand_v1", confidence: 0.9, signals: ["unit_economics", "risk_controls"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_ecommerce_brand_v1", confidence: 0.9, signals: ["unit_economics", "risk_controls"] },
        selected_policy: "consumer_ecommerce_brand_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "ltv_to_cac", value: 4.1, benchmark_value: 3, benchmark_source: "policy:consumer_ecommerce_brand_v1:ltv_to_cac", rating: "Strong", deviation_pct: 36, evidence_id: "00000000-0000-4000-8000-000000007001" },
          { metric: "gross_margin_pct", value: 0.6, benchmark_value: 0.5, benchmark_source: "policy:consumer_ecommerce_brand_v1:gross_margin_pct", rating: "Strong", deviation_pct: 20, evidence_id: "00000000-0000-4000-8000-000000007002" },
          { metric: "cac", value: 38, benchmark_value: 40, benchmark_source: "policy:consumer_ecommerce_brand_v1:cac", rating: "Strong", deviation_pct: -5, evidence_id: "00000000-0000-4000-8000-000000007003" },
          { metric: "aov", value: 90, benchmark_value: 75, benchmark_source: "policy:consumer_ecommerce_brand_v1:aov", rating: "Strong", deviation_pct: 20, evidence_id: "00000000-0000-4000-8000-000000007004" },
        ],
        evidence_ids: [],
      },
      risk_assessment: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_risk_score: 20,
        risks_by_category: {
          market: [
            {
              risk_id: "00000000-0000-4000-8000-000000007998",
              category: "market",
              severity: "high",
              description: "Platform risk: channel policy change could reduce performance",
              mitigation: "Diversify channels",
              evidence_id: "00000000-0000-4000-8000-000000007999",
            },
          ],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 1,
        critical_count: 0,
        high_count: 1,
        evidence_ids: ["00000000-0000-4000-8000-000000007999"],
      },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    // Unacceptable risk gating uses risk_map high/critical severities; keep rubric red flags empty by avoiding fraud/ownership/regulatory keywords.
    dio.risk_map = [
      {
        risk_id: "00000000-0000-4000-8000-000000007998",
        category: "market",
        severity: "high",
        title: "Channel policy risk",
        description: "Platform policy change could reduce ROAS",
        mitigation: "Diversify channels",
        evidence_id: "00000000-0000-4000-8000-000000007999",
      },
    ];

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("consumer_ecommerce_brand_v1");
    expect(diagnostics.overall_score).toBe(75);
    expect(diagnostics.rubric?.score_cap_applied).toBe(75);
    expect(diagnostics.rubric?.red_flags_triggered ?? []).toHaveLength(0);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /75\+ requires/i.test(b.text))).toBe(true);
  });

  it("enterprise_saas_b2b_v1: strong SaaS signals can score >= 75 and emits policy positive signals", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "enterprise_saas_b2b_v1", confidence: 0.9, signals: ["ARR/MRR/Bookings", "NRR/NDR/Churn", "ACV / pipeline"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "enterprise_saas_b2b_v1", confidence: 0.9, signals: ["ARR/MRR/Bookings", "NRR/NDR/Churn", "ACV / pipeline"] },
        selected_policy: "enterprise_saas_b2b_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 92,
        metrics_analyzed: [
          { metric: "arr", value: 1500000, benchmark_value: 1000000, benchmark_source: "policy:enterprise_saas_b2b_v1:arr", rating: "Strong", deviation_pct: 50, evidence_id: "00000000-0000-4000-8000-000000008001" },
          { metric: "nrr", value: 125, benchmark_value: 120, benchmark_source: "policy:enterprise_saas_b2b_v1:nrr", rating: "Strong", deviation_pct: 4.2, evidence_id: "00000000-0000-4000-8000-000000008002" },
          { metric: "gross_margin", value: 0.8, benchmark_value: 0.75, benchmark_source: "policy:enterprise_saas_b2b_v1:gross_margin", rating: "Strong", deviation_pct: 6.7, evidence_id: "00000000-0000-4000-8000-000000008003" },
          { metric: "payback_months", value: 12, benchmark_value: 12, benchmark_source: "policy:enterprise_saas_b2b_v1:payback_months", rating: "Strong", deviation_pct: 0, evidence_id: "00000000-0000-4000-8000-000000008004" },
          { metric: "pipeline_coverage", value: 4, benchmark_value: 3, benchmark_source: "policy:enterprise_saas_b2b_v1:pipeline_coverage", rating: "Strong", deviation_pct: 33.3, evidence_id: "00000000-0000-4000-8000-000000008005" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 30, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 80, metrics: { revenue: 1500000, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("enterprise_saas_b2b_v1");
    expect(diagnostics.overall_score).toBeGreaterThanOrEqual(75);
    expect(diagnostics.buckets.positive_signals.some((b) => b.component === "policy" && /recurring revenue/i.test(b.text))).toBe(true);
  });

  it("enterprise_saas_b2b_v1: revenue-only caps at 70", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "enterprise_saas_b2b_v1", confidence: 0.85, signals: ["ARR/MRR/Bookings"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "enterprise_saas_b2b_v1", confidence: 0.85, signals: ["ARR/MRR/Bookings"] },
        selected_policy: "enterprise_saas_b2b_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 92, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "arr", value: 2000000, benchmark_value: 1000000, benchmark_source: "policy:enterprise_saas_b2b_v1:arr", rating: "Strong", deviation_pct: 100, evidence_id: "00000000-0000-4000-8000-000000009001" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 30, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 80, metrics: { revenue: 2000000, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("enterprise_saas_b2b_v1");
    expect(diagnostics.overall_score).toBeLessThanOrEqual(70);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /revenue-only/i.test(b.text))).toBe(true);
  });

  it("enterprise_saas_b2b_v1: bad retention caps at 60", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "enterprise_saas_b2b_v1", confidence: 0.85, signals: ["ARR/MRR/Bookings", "NRR/NDR/Churn"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "enterprise_saas_b2b_v1", confidence: 0.85, signals: ["ARR/MRR/Bookings", "NRR/NDR/Churn"] },
        selected_policy: "enterprise_saas_b2b_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 92, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "arr", value: 2000000, benchmark_value: 1000000, benchmark_source: "policy:enterprise_saas_b2b_v1:arr", rating: "Strong", deviation_pct: 100, evidence_id: "00000000-0000-4000-8000-000000010001" },
          { metric: "nrr", value: 0.85, benchmark_value: 1.0, benchmark_source: "policy:enterprise_saas_b2b_v1:nrr", rating: "Weak", deviation_pct: -15, evidence_id: "00000000-0000-4000-8000-000000010002" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 30, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 80, metrics: { revenue: 2000000, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("enterprise_saas_b2b_v1");
    expect(diagnostics.overall_score).toBeLessThanOrEqual(60);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /retention\/churn/i.test(b.text))).toBe(true);
  });

  it("physical_product_cpg_spirits_v1: strong unit economics + velocity + distribution can score >= 75 and emits policy positive signals", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "cpg",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          {
            asset_class: "venture",
            deal_structure: "equity",
            strategy_subtype: "physical_product_cpg_spirits_v1",
            confidence: 0.9,
            signals: ["production_ready", "signed_distribution_agreement", "working_capital_plan", "regulatory_compliance"],
          },
        ],
        selected: {
          asset_class: "venture",
          deal_structure: "equity",
          strategy_subtype: "physical_product_cpg_spirits_v1",
          confidence: 0.9,
          signals: ["production_ready", "signed_distribution_agreement", "working_capital_plan", "regulatory_compliance"],
        },
        selected_policy: "physical_product_cpg_spirits_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "gross_margin", value: 0.62, benchmark_value: 0.55, benchmark_source: "policy:physical_product_cpg_spirits_v1:gross_margin", rating: "Strong", deviation_pct: 12.7, evidence_id: "00000000-0000-4000-8000-000000011001" },
          { metric: "contribution_margin", value: 0.35, benchmark_value: 0.3, benchmark_source: "policy:physical_product_cpg_spirits_v1:contribution_margin", rating: "Strong", deviation_pct: 16.7, evidence_id: "00000000-0000-4000-8000-000000011002" },
          { metric: "repeat_rate", value: 0.3, benchmark_value: 0.25, benchmark_source: "policy:physical_product_cpg_spirits_v1:repeat_rate", rating: "Strong", deviation_pct: 20, evidence_id: "00000000-0000-4000-8000-000000011003" },
          { metric: "velocity", value: 4.2, benchmark_value: 3, benchmark_source: "policy:physical_product_cpg_spirits_v1:velocity", rating: "Strong", deviation_pct: 40, evidence_id: "00000000-0000-4000-8000-000000011004" },
          { metric: "doors", value: 150, benchmark_value: 50, benchmark_source: "policy:physical_product_cpg_spirits_v1:doors", rating: "Strong", deviation_pct: 200, evidence_id: "00000000-0000-4000-8000-000000011005" },
          { metric: "cash_conversion_cycle", value: 45, benchmark_value: 60, benchmark_source: "policy:physical_product_cpg_spirits_v1:cash_conversion_cycle", rating: "Strong", deviation_pct: -25, evidence_id: "00000000-0000-4000-8000-000000011006" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 25, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 75, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("physical_product_cpg_spirits_v1");
    expect(diagnostics.overall_score).toBeGreaterThanOrEqual(75);
    expect(diagnostics.buckets.positive_signals.some((b) => b.component === "policy" && /spirits\/cpg/i.test(b.text))).toBe(true);
  });

  it("physical_product_cpg_spirits_v1: >75 gating requires velocity/repeat + distribution; caps at 75 when missing", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "cpg",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "physical_product_cpg_spirits_v1", confidence: 0.85, signals: ["gross_margin_or_unit_economics"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "physical_product_cpg_spirits_v1", confidence: 0.85, signals: ["gross_margin_or_unit_economics"] },
        selected_policy: "physical_product_cpg_spirits_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "gross_margin", value: 0.6, benchmark_value: 0.55, benchmark_source: "policy:physical_product_cpg_spirits_v1:gross_margin", rating: "Strong", deviation_pct: 9.1, evidence_id: "00000000-0000-4000-8000-000000012001" },
          { metric: "contribution_margin", value: 0.32, benchmark_value: 0.3, benchmark_source: "policy:physical_product_cpg_spirits_v1:contribution_margin", rating: "Strong", deviation_pct: 6.7, evidence_id: "00000000-0000-4000-8000-000000012002" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 25, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 75, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("physical_product_cpg_spirits_v1");
    expect(diagnostics.overall_score).toBe(75);
    expect(diagnostics.rubric?.score_cap_applied).toBe(75);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /score >75 requires/i.test(b.text))).toBe(true);
  });

  it("physical_product_cpg_spirits_v1: negative unit margins caps at 55 and surfaces rubric red flag", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "cpg",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "physical_product_cpg_spirits_v1", confidence: 0.85, signals: ["gross_margin_or_unit_economics"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "physical_product_cpg_spirits_v1", confidence: 0.85, signals: ["gross_margin_or_unit_economics"] },
        selected_policy: "physical_product_cpg_spirits_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "contribution_margin", value: -0.1, benchmark_value: 0.3, benchmark_source: "policy:physical_product_cpg_spirits_v1:contribution_margin", rating: "Weak", deviation_pct: -133.3, evidence_id: "00000000-0000-4000-8000-000000013001" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 25, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.2, health_score: 75, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("physical_product_cpg_spirits_v1");
    expect(diagnostics.overall_score).toBeLessThanOrEqual(55);
    expect(diagnostics.rubric?.red_flags_triggered ?? []).toEqual(expect.arrayContaining(["negative_unit_margins"]));
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /negative unit margins/i.test(b.text))).toBe(true);
  });

  it("healthcare_biotech_v1: strong regulatory + validation + team + timeline can score >= 75 and emits policy positive signals", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "healthcare",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          {
            asset_class: "venture",
            deal_structure: "equity",
            strategy_subtype: "healthcare_biotech_v1",
            confidence: 0.9,
            signals: ["regulatory_path_clear", "validation_signal", "team_credibility", "timeline_costs_realistic", "reimbursement_path"],
          },
        ],
        selected: {
          asset_class: "venture",
          deal_structure: "equity",
          strategy_subtype: "healthcare_biotech_v1",
          confidence: 0.9,
          signals: ["regulatory_path_clear", "validation_signal", "team_credibility", "timeline_costs_realistic", "reimbursement_path"],
        },
        selected_policy: "healthcare_biotech_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 88, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "sensitivity", value: 0.94, benchmark_value: 0.9, benchmark_source: "policy:healthcare_biotech_v1:sensitivity", rating: "Strong", deviation_pct: 4.4, evidence_id: "00000000-0000-4000-8000-000000021001" },
          { metric: "specificity", value: 0.92, benchmark_value: 0.9, benchmark_source: "policy:healthcare_biotech_v1:specificity", rating: "Strong", deviation_pct: 2.2, evidence_id: "00000000-0000-4000-8000-000000021002" },
          { metric: "time_to_clearance_months", value: 12, benchmark_value: 12, benchmark_source: "policy:healthcare_biotech_v1:time_to_clearance_months", rating: "Strong", deviation_pct: 0, evidence_id: "00000000-0000-4000-8000-000000021003" },
          { metric: "runway_months", value: 18, benchmark_value: 18, benchmark_source: "policy:healthcare_biotech_v1:runway_months", rating: "Strong", deviation_pct: 0, evidence_id: "00000000-0000-4000-8000-000000021004" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("healthcare_biotech_v1");
    expect(diagnostics.overall_score).toBeGreaterThanOrEqual(75);
    expect(diagnostics.buckets.positive_signals.some((b) => b.component === "policy" && /Healthcare\/Biotech/i.test(b.text))).toBe(true);
  });

  it("healthcare_biotech_v1: >75 gating caps at 75 when missing team/timeline", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "healthcare",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "healthcare_biotech_v1", confidence: 0.85, signals: ["regulatory_path_clear", "validation_signal"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "healthcare_biotech_v1", confidence: 0.85, signals: ["regulatory_path_clear", "validation_signal"] },
        selected_policy: "healthcare_biotech_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 88, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "sensitivity", value: 0.94, benchmark_value: 0.9, benchmark_source: "policy:healthcare_biotech_v1:sensitivity", rating: "Strong", deviation_pct: 4.4, evidence_id: "00000000-0000-4000-8000-000000022001" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("healthcare_biotech_v1");
    expect(diagnostics.overall_score).toBe(75);
    expect(diagnostics.rubric?.score_cap_applied).toBe(75);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /score >75 requires/i.test(b.text))).toBe(true);
  });

  it("healthcare_biotech_v1: regulatory pathway unclear caps at 60 with explicit diagnostic", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "healthcare",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "healthcare_biotech_v1", confidence: 0.85, signals: ["regulatory_path_unclear", "validation_signal"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "healthcare_biotech_v1", confidence: 0.85, signals: ["regulatory_path_unclear", "validation_signal"] },
        selected_policy: "healthcare_biotech_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 88, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 95, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("healthcare_biotech_v1");
    expect(diagnostics.overall_score).toBe(60);
    expect(diagnostics.rubric?.score_cap_applied).toBe(60);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /regulatory pathway appears unclear/i.test(b.text))).toBe(true);
  });

  it("healthcare_biotech_v1: safety/ethics risk caps at 50 and is emitted in red_flags bucket", () => {
    const dio = baseDio();

    dio.dio_context = {
      ...dio.dio_context,
      vertical: "healthcare",
    };

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "healthcare_biotech_v1", confidence: 0.85, signals: ["regulatory_path_clear", "validation_signal", "safety_ethics_risk"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "healthcare_biotech_v1", confidence: 0.85, signals: ["regulatory_path_clear", "validation_signal", "safety_ethics_risk"] },
        selected_policy: "healthcare_biotech_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 88, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 95, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("healthcare_biotech_v1");
    expect(diagnostics.overall_score).toBe(50);
    expect(diagnostics.rubric?.score_cap_applied).toBe(50);
    expect(diagnostics.buckets.red_flags.some((b) => b.component === "policy" && /safety\/ethics\/compliance risk/i.test(b.text))).toBe(true);
  });

  it("media_entertainment_ip_v1: financeable package without revenue emits positive diagnostics and does not apply a cap", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          {
            asset_class: "venture",
            deal_structure: "equity",
            strategy_subtype: "media_entertainment_ip_v1",
            confidence: 0.85,
            signals: ["rights_verifiable", "distribution_package", "waterfall_recoupment_clarity"],
          },
        ],
        selected: {
          asset_class: "venture",
          deal_structure: "equity",
          strategy_subtype: "media_entertainment_ip_v1",
          confidence: 0.85,
          signals: ["rights_verifiable", "distribution_package", "waterfall_recoupment_clarity"],
        },
        selected_policy: "media_entertainment_ip_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 95, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("media_entertainment_ip_v1");
    expect(diagnostics.overall_score).toBeGreaterThan(75);
    expect(diagnostics.rubric?.score_cap_applied ?? null).toBeNull();
    expect(
      diagnostics.buckets.positive_signals.some((b) =>
        b.component === "policy" && /missing revenue is acceptable/i.test(b.text)
      )
    ).toBe(true);
    expect(
      diagnostics.buckets.positive_signals.some((b) =>
        b.component === "policy" && /rights verified/i.test(b.text)
      )
    ).toBe(true);
  });

  it("media_entertainment_ip_v1: score >75 without required gating signals is capped at 75 with an explicit diagnostic", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "media_entertainment_ip_v1", confidence: 0.85, signals: ["rights_verifiable"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "media_entertainment_ip_v1", confidence: 0.85, signals: ["rights_verifiable"] },
        selected_policy: "media_entertainment_ip_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 95, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("media_entertainment_ip_v1");
    expect(diagnostics.overall_score).toBe(75);
    expect(diagnostics.rubric?.score_cap_applied).toBe(75);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /score >75 requires verifiable rights/i.test(b.text))).toBe(true);
  });

  it("media_entertainment_ip_v1: rights unclear caps at 60 and is emitted in red_flags bucket", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "media_entertainment_ip_v1", confidence: 0.85, signals: ["rights_unclear"] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "media_entertainment_ip_v1", confidence: 0.85, signals: ["rights_unclear"] },
        selected_policy: "media_entertainment_ip_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 95, metrics_analyzed: [], evidence_ids: [] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, runway_months: 18, burn_multiple: 1.5, health_score: 70, metrics: { revenue: null, expenses: 0, cash_balance: 0, burn_rate: 0, growth_rate: null }, risks: [], evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);
    expect(diagnostics.policy_id).toBe("media_entertainment_ip_v1");
    expect(diagnostics.overall_score).toBe(60);
    expect(diagnostics.rubric?.score_cap_applied).toBe(60);
    expect(diagnostics.buckets.red_flags.some((b) => b.component === "policy" && /rights\/chain-of-title appears unclear/i.test(b.text))).toBe(true);
  });

  it("consumer_fintech_platform_v1: revenue-only is capped at 70 and surfaces a clear policy cap diagnostic", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_fintech_platform_v1", confidence: 0.9, signals: [] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_fintech_platform_v1", confidence: 0.9, signals: [] },
        selected_policy: "consumer_fintech_platform_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "revenue", value: 500000, benchmark_value: 100000, benchmark_source: "policy:consumer_fintech_platform_v1:revenue", rating: "Strong", deviation_pct: 400, evidence_id: "00000000-0000-4000-8000-000000008001" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 25, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 60, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("consumer_fintech_platform_v1");
    expect(diagnostics.overall_score).toBe(70);
    expect(diagnostics.rubric?.score_cap_applied).toBe(70);
    expect(diagnostics.rubric?.red_flags_triggered ?? []).toHaveLength(0);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /revenue-only is capped at 70/i.test(b.text))).toBe(true);
  });

  it("consumer_fintech_platform_v1: strong adoption/volume + growth with acceptable risk can exceed 75", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_fintech_platform_v1", confidence: 0.9, signals: [] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_fintech_platform_v1", confidence: 0.9, signals: [] },
        selected_policy: "consumer_fintech_platform_v1",
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
        overall_score: 92,
        metrics_analyzed: [
          { metric: "tpv", value: 12000000, benchmark_value: 1000000, benchmark_source: "policy:consumer_fintech_platform_v1:tpv", rating: "Strong", deviation_pct: 1100, evidence_id: "00000000-0000-4000-8000-000000009001" },
          { metric: "growth_rate", value: 0.6, benchmark_value: 0.3, benchmark_source: "policy:consumer_fintech_platform_v1:growth_rate", rating: "Strong", deviation_pct: 100, evidence_id: "00000000-0000-4000-8000-000000009002" },
          { metric: "active_users", value: 150000, benchmark_value: 100000, benchmark_source: "policy:consumer_fintech_platform_v1:active_users", rating: "Strong", deviation_pct: 50, evidence_id: "00000000-0000-4000-8000-000000009003" },
          { metric: "take_rate", value: 0.012, benchmark_value: 0.005, benchmark_source: "policy:consumer_fintech_platform_v1:take_rate", rating: "Strong", deviation_pct: 140, evidence_id: "00000000-0000-4000-8000-000000009004" },
          { metric: "regulatory_status", value: 85, benchmark_value: 70, benchmark_source: "policy:consumer_fintech_platform_v1:regulatory_status", rating: "Strong", deviation_pct: 21, evidence_id: "00000000-0000-4000-8000-000000009005" },
        ],
        evidence_ids: [],
      },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 40, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 60, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
    };

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("consumer_fintech_platform_v1");
    expect(diagnostics.overall_score).toBeGreaterThan(75);
    expect(diagnostics.rubric?.score_cap_applied ?? null).toBeNull();
    expect(diagnostics.buckets.positive_signals.some((b) => b.component === "policy" && /adoption\/volume evidence/i.test(b.text))).toBe(true);
  });

  it("consumer_fintech_platform_v1: unmitigated regulatory/fraud risk caps final score at 70 and does not populate rubric.red_flags_triggered", () => {
    const dio = baseDio();

    dio.dio = {
      deal_classification_v1: {
        candidates: [
          { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_fintech_platform_v1", confidence: 0.9, signals: [] },
        ],
        selected: { asset_class: "venture", deal_structure: "equity", strategy_subtype: "consumer_fintech_platform_v1", confidence: 0.9, signals: [] },
        selected_policy: "consumer_fintech_platform_v1",
        routing_reason: ["test"],
      },
    };

    dio.analyzer_results = {
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 90, archetype: "test", archetype_confidence: 0.8, emotional_beats: [], evidence_ids: [] },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_score: 95,
        metrics_analyzed: [
          { metric: "gtv", value: 25000000, benchmark_value: 1000000, benchmark_source: "policy:consumer_fintech_platform_v1:gtv", rating: "Strong", deviation_pct: 2400, evidence_id: "00000000-0000-4000-8000-000000010001" },
          { metric: "growth_rate", value: 0.8, benchmark_value: 0.3, benchmark_source: "policy:consumer_fintech_platform_v1:growth_rate", rating: "Strong", deviation_pct: 166, evidence_id: "00000000-0000-4000-8000-000000010002" },
          { metric: "active_users", value: 200000, benchmark_value: 100000, benchmark_source: "policy:consumer_fintech_platform_v1:active_users", rating: "Strong", deviation_pct: 100, evidence_id: "00000000-0000-4000-8000-000000010003" },
          { metric: "regulatory_status", value: 80, benchmark_value: 70, benchmark_source: "policy:consumer_fintech_platform_v1:regulatory_status", rating: "Strong", deviation_pct: 14, evidence_id: "00000000-0000-4000-8000-000000010004" },
        ],
        evidence_ids: [],
      },
      risk_assessment: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.9,
        overall_risk_score: 25,
        risks_by_category: { market: [], team: [], financial: [], execution: [] },
        total_risks: 1,
        critical_count: 0,
        high_count: 1,
        evidence_ids: ["00000000-0000-4000-8000-000000010999"],
      },
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: 70, pattern_match: "problem_first", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 60, proxy_signals: { page_count_appropriate: true, image_to_text_ratio_balanced: true, consistent_formatting: true }, strengths: [], weaknesses: [], evidence_ids: [] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
    };

    dio.risk_map = [
      {
        risk_id: "00000000-0000-4000-8000-000000010998",
        category: "regulatory",
        severity: "high",
        title: "AML / licensing gaps",
        description: "AML program not clearly defined; licensing status unclear",
        mitigation: "",
        evidence_id: "00000000-0000-4000-8000-000000010999",
      },
    ];

    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(diagnostics.policy_id).toBe("consumer_fintech_platform_v1");
    expect(diagnostics.overall_score).toBe(70);
    expect(diagnostics.rubric?.score_cap_applied).toBe(70);
    expect(diagnostics.rubric?.red_flags_triggered ?? []).toHaveLength(0);
    expect(diagnostics.buckets.coverage_gaps.some((b) => b.component === "policy" && /unmitigated regulatory\/fraud risk/i.test(b.text))).toBe(true);
  });
});
