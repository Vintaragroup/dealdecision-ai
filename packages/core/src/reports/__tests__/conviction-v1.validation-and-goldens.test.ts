import { buildConvictionV1 } from "../conviction-v1";

type ConvictionArgs = Parameters<typeof buildConvictionV1>[0];

function baseArgs(policyId = "operating_startup_revenue_v1"): ConvictionArgs {
  return {
    selected_policy_id: policyId,
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
        evidence_factor: 0.8,
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
  } as any;
}

function weakStartupArgs(): ConvictionArgs {
  const base = baseArgs("operating_startup_revenue_v1");
  return {
    ...base,
    financial_coverage_v1: {
      ...base.financial_coverage_v1,
      confidence: "low",
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
      raise: { present: false, sources: [] },
      use_of_funds: { present: false },
      milestones: { present: false },
      notes: ["missing_raise_logic"],
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
    score_explanation: {
      ...base.score_explanation,
      totals: {
        ...base.score_explanation?.totals,
        confidence_score: 0.45,
        evidence_factor: 0.42,
        coverage_ratio: 0.3,
        unadjusted_missing_inputs: ["traction", "market_signal", "capital_plan"],
      },
    },
  } as any;
}

function withContradictions(args: ConvictionArgs): ConvictionArgs {
  return {
    ...args,
    score_explanation: {
      ...args.score_explanation,
      components: {
        ...(args.score_explanation as any)?.components,
        risk_assessment: {
          ...((args.score_explanation as any)?.components?.risk_assessment ?? {}),
          red_flags: ["material discrepancy in claims"],
          gaps: ["conflicting assumptions"],
        },
      },
      stage_weighted_v1: {
        dimensions: [
          { key: "traction", notes: ["forecast_without_history"], evidence_ids: ["ev-tr"] },
          { key: "market", notes: ["tam_without_traction"], evidence_ids: ["ev-mk"] },
        ],
      },
    },
  } as any;
}

function normalizeForSnapshot<T extends { lineage?: { generated_at?: string } }>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  if (clone?.lineage && typeof clone.lineage === "object") {
    clone.lineage.generated_at = "<generated_at>";
  }
  return clone;
}

describe("conviction_v1 phase3 validation harness", () => {
  it("runs representative multi-policy deal matrix and exposes the required diagnostics", () => {
    const matrix = {
      strong_startup: buildConvictionV1(baseArgs("operating_startup_revenue_v1")),
      weak_startup: buildConvictionV1(weakStartupArgs()),
      strong_real_estate: buildConvictionV1({
        ...baseArgs("real_estate_underwriting"),
        funding_stage_v1: { funding_stage: "growth" },
      }),
      weak_real_estate: buildConvictionV1({
        ...weakStartupArgs(),
        selected_policy_id: "real_estate_underwriting",
        funding_stage_v1: { funding_stage: "growth" },
      }),
      mixed_contradictory: buildConvictionV1(withContradictions(baseArgs("operating_startup_revenue_v1"))),
    };

    for (const [name, c] of Object.entries(matrix)) {
      expect(c.schema_version).toBe("conviction_v1");
      expect(typeof c.conviction_score_0_100).toBe("number");
      expect(typeof c.confidence_0_1).toBe("number");
      expect(typeof c.coverage_ratio_0_1).toBe("number");
      expect(typeof c.contradiction_index_0_1).toBe("number");
      expect(Array.isArray(c.top_positive_contributors)).toBe(true);
      expect(Array.isArray(c.top_negative_contributors)).toBe(true);
      expect(Array.isArray(c.unknowns)).toBe(true);
      expect(Array.isArray(c.contradictions)).toBe(true);

      // Required harness output fields encoded into one deterministic payload for easy test failures/debugging.
      const harnessRow = {
        conviction_score_0_100: c.conviction_score_0_100,
        confidence_0_1: c.confidence_0_1,
        coverage_ratio_0_1: c.coverage_ratio_0_1,
        contradiction_index_0_1: c.contradiction_index_0_1,
        top_positive_contributors: c.top_positive_contributors.map((x) => x.key),
        top_negative_contributors: c.top_negative_contributors.map((x) => x.key),
        unknowns: c.unknowns.map((x) => x.code),
        contradictions: c.contradictions.map((x) => x.text),
      };
      expect(harnessRow).toBeDefined();
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("asserts score drift invariants across signals, contradictions, coverage, and unknown handling", () => {
    const strong = buildConvictionV1(baseArgs());
    const weak = buildConvictionV1(weakStartupArgs());

    expect(strong.conviction_score_0_100).toBeGreaterThan(weak.conviction_score_0_100);

    const lowCoverage = buildConvictionV1({
      ...baseArgs(),
      score_explanation: {
        ...(baseArgs().score_explanation as any),
        totals: {
          ...((baseArgs().score_explanation as any)?.totals ?? {}),
          confidence_score: 0.55,
          evidence_factor: 0.5,
          coverage_ratio: 0.35,
        },
      },
      financial_coverage_v1: {
        ...(baseArgs().financial_coverage_v1 as any),
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
    } as any);

    expect(lowCoverage.coverage_ratio_0_1).toBeLessThan(strong.coverage_ratio_0_1);
    expect(lowCoverage.conviction_score_0_100).toBeLessThan(strong.conviction_score_0_100);
    expect(lowCoverage.conviction_score_0_100).toBeGreaterThan(20);

    const contradicted = buildConvictionV1(withContradictions(baseArgs()));
    expect(contradicted.contradiction_index_0_1).toBeGreaterThan(strong.contradiction_index_0_1);
    expect(contradicted.conviction_score_0_100).toBeLessThan(strong.conviction_score_0_100);

    const unknownOnly = buildConvictionV1({
      ...baseArgs(),
      score_explanation: {
        ...(baseArgs().score_explanation as any),
        totals: {
          ...((baseArgs().score_explanation as any)?.totals ?? {}),
          // Adds unknowns list only, without changing confidence/coverage math inputs.
          unadjusted_missing_inputs: ["optional_field_alpha", "optional_field_beta"],
        },
      },
    } as any);

    expect(unknownOnly.conviction_score_0_100).toBe(strong.conviction_score_0_100);
    expect(unknownOnly.unknowns.length).toBeGreaterThan(strong.unknowns.length);
  });
});

describe("conviction_v1 phase3 golden snapshots", () => {
  it("locks startup_raise golden behavior", () => {
    const conviction = buildConvictionV1(baseArgs("operating_startup_revenue_v1"));
    const score = conviction.conviction_score_0_100;

    expect(Math.abs(score - 80)).toBeLessThanOrEqual(2);
    expect(conviction.top_positive_contributors.length).toBeGreaterThan(0);
    expect(conviction.recommendation_posture).toBe("yes");
    expect(normalizeForSnapshot(conviction)).toMatchSnapshot("startup_raise");
  });

  it("locks real_estate_preferred_equity golden behavior", () => {
    const conviction = buildConvictionV1({
      ...baseArgs("real_estate_underwriting"),
      funding_stage_v1: { funding_stage: "growth" },
    } as any);
    const score = conviction.conviction_score_0_100;

    expect(Math.abs(score - 79)).toBeLessThanOrEqual(2);
    expect(conviction.top_positive_contributors.length).toBeGreaterThan(0);
    expect(conviction.recommendation_posture).toBe("yes");
    expect(normalizeForSnapshot(conviction)).toMatchSnapshot("real_estate_preferred_equity");
  });

  it("locks execution_ready_startup golden behavior", () => {
    const conviction = buildConvictionV1({
      ...baseArgs("execution_ready_v1"),
      funding_stage_v1: { funding_stage: "series_a" },
      team_signal_v1: {
        confidence: "high",
        founder_count: 3,
        key_roles_present: { technical: true, gtm: true },
        domain_experience_present: true,
        signals: [{ code: "exec_depth", present: true }],
      },
    } as any);
    const score = conviction.conviction_score_0_100;

    expect(Math.abs(score - 80)).toBeLessThanOrEqual(2);
    expect(conviction.top_positive_contributors.length).toBeGreaterThan(0);
    expect(conviction.recommendation_posture).toBe("yes");
    expect(normalizeForSnapshot(conviction)).toMatchSnapshot("execution_ready_startup");
  });
});
