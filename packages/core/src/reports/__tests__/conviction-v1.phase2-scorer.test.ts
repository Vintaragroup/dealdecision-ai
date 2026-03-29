import { buildConvictionV1 } from "../conviction-v1";

describe("conviction_v1 phase2 deterministic scorer", () => {
  const baseArgs = () => ({
    selected_policy_id: "operating_startup_revenue_v1",
    overall_score: 72,
    recommendation: "yes",
    funding_stage_v1: { funding_stage: "seed" },
    financial_coverage_v1: {
      confidence: "high",
      sources: [{ kind: "xlsx", document_id: "doc-fin" }],
      coverage: {
        historical_revenue_present: true,
        forecast_revenue_present: true,
        income_statement_present: true,
        burn_rate_present: true,
        runway_present: true,
        unit_economics_present: true,
        balance_sheet_present: true,
        cash_flow_present: true,
      },
      evidence: {
        historical_revenue_present: { document_id: "doc-fin", page_index: 2 },
        income_statement_present: { document_id: "doc-fin", page_index: 3 },
      },
      notes: [],
    },
    capital_logic_v1: {
      confidence: "high",
      raise: { present: true, sources: [{ document_id: "doc-deck", page_index: 5 }] },
      use_of_funds: { present: true },
      milestones: { present: true },
      notes: [],
    },
    business_model_signal_v1: {
      confidence: "high",
      pricing_present: true,
      revenue_model_present: true,
      customer_segment_present: true,
      notes: [],
    },
    market_accessibility_signal_v1: {
      confidence: "high",
      icp_defined: true,
      distribution_path_present: true,
      som_defined: true,
    },
    traction_signal_v1: {
      confidence: "high",
      historical_revenue_present: true,
      customer_evidence_present: true,
      growth_signal_present: true,
    },
    team_signal_v1: {
      confidence: "high",
      founder_count: 2,
      key_roles_present: { technical: true, gtm: true },
      domain_experience_present: true,
      signals: [{ code: "balanced_team", present: true }],
    },
    score_explanation: {
      totals: {
        overall_score: 72,
        confidence_score: 0.82,
        evidence_factor: 0.80,
        coverage_ratio: 0.84,
        unadjusted_missing_inputs: [],
      },
      components: {
        metric_benchmark: { evidence_ids: ["ev-metric"], gaps: [], red_flags: [], confidence: 0.8, coverage: 0.8 },
        slide_sequence: { evidence_ids: ["ev-slide"], gaps: [], red_flags: [], confidence: 0.8, coverage: 0.8 },
        narrative_arc: { evidence_ids: ["ev-arc"], gaps: [], red_flags: [], confidence: 0.8, coverage: 0.8 },
        risk_assessment: { evidence_ids: ["ev-risk"], gaps: [], red_flags: [], confidence: 0.8, coverage: 0.8 },
      },
      stage_weighted_v1: {
        dimensions: [
          { key: "traction", notes: [], evidence_ids: ["ev-tr"] },
          { key: "market", notes: [], evidence_ids: ["ev-mk"] },
        ],
      },
      understanding_v1: { diligence_open_items: [] },
    },
    underwriting_readiness_v1: { status: "sufficient", score: 80 },
    financial_breakdown_v1: { has_xlsx: true },
  });

  it("computes score from deterministic inputs, not legacy passthrough", () => {
    const strong = buildConvictionV1(baseArgs());

    const weak = buildConvictionV1({
      ...baseArgs(),
      overall_score: 72,
      recommendation: "yes",
      financial_coverage_v1: {
        ...baseArgs().financial_coverage_v1,
        coverage: {
          historical_revenue_present: false,
          forecast_revenue_present: true,
          income_statement_present: false,
          burn_rate_present: false,
          runway_present: false,
          unit_economics_present: false,
          balance_sheet_present: false,
          cash_flow_present: false,
        },
      },
      capital_logic_v1: {
        confidence: "low",
        raise: { present: false },
        use_of_funds: { present: false },
        milestones: { present: false },
        notes: ["missing_raise"],
      },
      traction_signal_v1: {
        confidence: "low",
        historical_revenue_present: false,
        customer_evidence_present: false,
        growth_signal_present: false,
      },
      market_accessibility_signal_v1: {
        confidence: "low",
        icp_defined: false,
        distribution_path_present: false,
        som_defined: false,
      },
      business_model_signal_v1: {
        confidence: "low",
        pricing_present: false,
        revenue_model_present: false,
        customer_segment_present: false,
        notes: ["business_model_absent"],
      },
      team_signal_v1: {
        confidence: "low",
        founder_count: 0,
        key_roles_present: { technical: false, gtm: false },
        domain_experience_present: false,
        signals: [{ code: "no_founder", present: true }],
      },
    });

    expect(strong.conviction_score_0_100).toBeGreaterThan(weak.conviction_score_0_100);
    // Both scenarios intentionally pass the same legacy overall/recommendation; conviction must diverge from deterministic inputs.
    expect(strong.conviction_score_0_100).not.toBe(72);
    expect(weak.conviction_score_0_100).not.toBe(72);
  });

  it("treats unknowns as confidence/coverage drag without catastrophic score collapse", () => {
    const unknownHeavy = buildConvictionV1({
      ...baseArgs(),
      financial_coverage_v1: {
        ...baseArgs().financial_coverage_v1,
        coverage: {
          historical_revenue_present: false,
          forecast_revenue_present: false,
          income_statement_present: false,
          burn_rate_present: false,
          runway_present: false,
          unit_economics_present: false,
          balance_sheet_present: false,
          cash_flow_present: false,
        },
      },
      capital_logic_v1: {
        confidence: "low",
        raise: { present: false },
        use_of_funds: { present: false },
        milestones: { present: false },
        notes: [],
      },
      score_explanation: {
        ...baseArgs().score_explanation,
        totals: {
          ...baseArgs().score_explanation.totals,
          confidence_score: 0.45,
          evidence_factor: 0.42,
          coverage_ratio: 0.30,
          unadjusted_missing_inputs: ["financial_health", "market_signal"],
        },
      },
    });

    expect(unknownHeavy.confidence_0_1).toBeLessThan(0.75);
    expect(unknownHeavy.coverage_ratio_0_1).toBeLessThan(0.65);
    expect(unknownHeavy.conviction_score_0_100).toBeGreaterThan(20);
    expect(unknownHeavy.unknowns.length).toBeGreaterThan(0);
  });

  it("applies contradiction penalty stronger than ordinary missingness", () => {
    const missingOnly = buildConvictionV1({
      ...baseArgs(),
      score_explanation: {
        ...baseArgs().score_explanation,
        totals: {
          ...baseArgs().score_explanation.totals,
          unadjusted_missing_inputs: ["retention"],
        },
      },
    });

    const contradicted = buildConvictionV1({
      ...baseArgs(),
      score_explanation: {
        ...baseArgs().score_explanation,
        components: {
          ...baseArgs().score_explanation.components,
          risk_assessment: {
            ...baseArgs().score_explanation.components.risk_assessment,
            red_flags: ["critical contractual inconsistency"],
          },
        },
        stage_weighted_v1: {
          dimensions: [
            { key: "traction", notes: ["forecast_without_history"], evidence_ids: ["ev-tr"] },
            { key: "market", notes: ["tam_without_traction"], evidence_ids: ["ev-mk"] },
          ],
        },
      },
    });

    expect(contradicted.contradiction_index_0_1).toBeGreaterThan(missingOnly.contradiction_index_0_1);
    expect(contradicted.conviction_score_0_100).toBeLessThan(missingOnly.conviction_score_0_100);
  });

  it("weights families differently across startup vs real-estate policies", () => {
    const startup = buildConvictionV1({
      ...baseArgs(),
      selected_policy_id: "operating_startup_revenue_v1",
    });

    const realEstate = buildConvictionV1({
      ...baseArgs(),
      selected_policy_id: "real_estate_underwriting",
    });

    expect(startup.selected_policy_id).toBe("operating_startup_revenue_v1");
    expect(realEstate.selected_policy_id).toBe("real_estate_underwriting");
    expect(startup.conviction_score_0_100).not.toBe(realEstate.conviction_score_0_100);

    const startupTop = startup.top_positive_contributors.map((x) => x.key);
    const realEstateTop = realEstate.top_positive_contributors.map((x) => x.key);
    expect(startupTop.join("|")).not.toBe(realEstateTop.join("|"));
  });
});
