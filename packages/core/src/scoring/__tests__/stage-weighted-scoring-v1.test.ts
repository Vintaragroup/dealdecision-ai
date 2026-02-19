import { getStageWeightMatrix } from "../stage-weight-matrix";
import { buildStageWeightedScoreInputsV1 } from "../stage-weighted-score-inputs-v1";
import { scoreStageWeightedV1 } from "../dimension-scorer-v1";

describe("stage-weighted deterministic scoring v1", () => {
  it("uses equal weights for unknown stage", () => {
    const w = getStageWeightMatrix("unknown");
    const values = Object.values(w);
    expect(values.length).toBe(8);
    for (const v of values) expect(v).toBeCloseTo(1 / 8, 8);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 8);
  });

  it("seed: missing traction yields low traction dimension score", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      stage_expectations_v1: {
        observed: { traction_evidence_present: false },
        gaps: [{ code: "missing_traction_evidence" }],
      } as any,
      structured_summary: {
        revenue: { value: null },
        customers: { value: null },
        growth: { value: null },
      },
    });

    expect(inputs.stage).toBe("seed");
    expect(inputs.signals.traction.present).toBe(false);

    const scored = scoreStageWeightedV1(inputs);
    const traction = scored.dimensions.find((d) => d.key === "traction")!;
    expect(traction.weight).toBeCloseTo(0.22, 6);
    expect(traction.score_0_100).toBeLessThan(50);
  });

  it("growth: missing XLSX/financials yields low financial_profile dimension score", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "growth", confidence: 0.8, signals: [] } as any,
      financial_coverage_v1: {
        confidence: "low",
        sources: [{ kind: "deck" }],
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
      } as any,
      structured_summary: { revenue: { value: null } },
    });

    expect(inputs.stage).toBe("growth");
    expect(inputs.signals.financial_profile.present).toBe(false);

    const scored = scoreStageWeightedV1(inputs);
    const fin = scored.dimensions.find((d) => d.key === "financial_profile")!;
    expect(fin.weight).toBeCloseTo(0.22, 6);
    expect(fin.score_0_100).toBeLessThan(50);
  });

  it("missing capital_logic_v1 yields missing use_of_funds_raise_logic signal", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "series_a", confidence: 0.8, signals: [] } as any,
      structured_summary: { revenue: { value: null } },
    });

    expect(inputs.signals.use_of_funds_raise_logic.present).toBe(false);
    expect(inputs.signals.use_of_funds_raise_logic.confidence).toBe(0);

    const scored = scoreStageWeightedV1(inputs);
    const uof = scored.dimensions.find((d) => d.key === "use_of_funds_raise_logic")!;
    expect(uof.score_0_100).toBeGreaterThanOrEqual(0);
  });

  it("seed: business_model_signal_v1.present=false applies >=20 penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      // Force high confidence even when absent to make the penalty observable.
      business_model_signal_v1: {
        present: false,
        pricing_present: false,
        revenue_model_present: false,
        customer_segment_present: false,
        monetization_mechanics_present: false,
        confidence: "high",
        signals: [],
      } as any,
      structured_summary: {
        business_model: { value: null },
      },
    });

    const scored = scoreStageWeightedV1(inputs);
    const bm = scored.dimensions.find((d) => d.key === "business_model")!;

    // Without the penalty, missing+high-conf base score would be ~45.5.
    // With seed absent penalty (-20), score should be <= ~25.5.
    expect(bm.score_0_100).toBeLessThanOrEqual(30);
    expect(bm.notes ?? []).toContain("business_model_absent");
    expect(scored.signals_used ?? []).toContain("business_model_signal_v1");
  });

  it("series_a: present but pricing missing applies -8 penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "series_a", confidence: 0.8, signals: [] } as any,
      business_model_signal_v1: {
        present: true,
        pricing_present: false,
        revenue_model_present: true,
        customer_segment_present: true,
        monetization_mechanics_present: true,
        confidence: "high",
        signals: [],
      } as any,
      structured_summary: {
        business_model: { value: "SaaS" },
      },
    });

    const scored = scoreStageWeightedV1(inputs);
    const bm = scored.dimensions.find((d) => d.key === "business_model")!;
    expect(bm.notes ?? []).toContain("bm_pricing_missing");

    // Base present+high score is ~93.25; series_a missing-sub-signal penalty is -8 => ~85.25.
    expect(bm.score_0_100).toBeLessThanOrEqual(86);
    expect(bm.score_0_100).toBeGreaterThanOrEqual(83);
  });

  it("pre_seed: present but missing monetization applies smaller penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "pre_seed", confidence: 0.8, signals: [] } as any,
      business_model_signal_v1: {
        present: true,
        pricing_present: true,
        revenue_model_present: true,
        customer_segment_present: true,
        monetization_mechanics_present: false,
        confidence: "high",
        signals: [],
      } as any,
      structured_summary: {
        business_model: { value: "Marketplace" },
      },
    });

    const scored = scoreStageWeightedV1(inputs);
    const bm = scored.dimensions.find((d) => d.key === "business_model")!;
    expect(bm.notes ?? []).toContain("bm_monetization_missing");

    // Base present+high ~93.25; pre_seed missing-sub-signal penalty is -4 => ~89.25.
    expect(bm.score_0_100).toBeLessThanOrEqual(91);
    expect(bm.score_0_100).toBeGreaterThanOrEqual(87);
  });

  it("seed: TAM only => heavy traction penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      traction_signal_v1: {
        historical_revenue_present: false,
        forecast_revenue_present: false,
        user_metrics_present: false,
        growth_rate_present: false,
        recurring_revenue_present: false,
        bookings_present: false,
        tam_only: true,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tr = scored.dimensions.find((d) => d.key === "traction")!;
    expect(tr.notes ?? []).toContain("tam_without_traction");
    // Missing+high base score ~45.5; seed TAM-only penalty -20 => ~25.5
    expect(tr.score_0_100).toBeLessThanOrEqual(30);
  });

  it("seed/series_a: forecast-only revenue => traction penalty", () => {
    const mk = (stage: any) => buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: stage, confidence: 0.8, signals: [] } as any,
      traction_signal_v1: {
        historical_revenue_present: false,
        forecast_revenue_present: true,
        user_metrics_present: false,
        growth_rate_present: false,
        recurring_revenue_present: false,
        bookings_present: false,
        tam_only: false,
        confidence: "low",
        signals: [],
      } as any,
    });

    for (const st of ["seed", "series_a"] as const) {
      const scored = scoreStageWeightedV1(mk(st));
      const tr = scored.dimensions.find((d) => d.key === "traction")!;
      expect(tr.notes ?? []).toContain("forecast_without_history");
      // Present+low base ~70.75; penalty -15 => ~55.75
      expect(tr.score_0_100).toBeLessThanOrEqual(60);
      expect(tr.score_0_100).toBeGreaterThanOrEqual(45);
    }
  });

  it("seed: historical revenue present => no forecast/TAM penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      traction_signal_v1: {
        historical_revenue_present: true,
        forecast_revenue_present: false,
        user_metrics_present: false,
        growth_rate_present: false,
        recurring_revenue_present: false,
        bookings_present: false,
        tam_only: false,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tr = scored.dimensions.find((d) => d.key === "traction")!;
    expect(tr.notes ?? []).not.toContain("tam_without_traction");
    expect(tr.notes ?? []).not.toContain("forecast_without_history");
    expect(tr.score_0_100).toBeGreaterThanOrEqual(80);
  });

  it("growth: no recurring revenue => traction penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "growth", confidence: 0.8, signals: [] } as any,
      traction_signal_v1: {
        historical_revenue_present: true,
        forecast_revenue_present: false,
        user_metrics_present: false,
        growth_rate_present: false,
        recurring_revenue_present: false,
        bookings_present: false,
        tam_only: false,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tr = scored.dimensions.find((d) => d.key === "traction")!;
    expect(tr.notes ?? []).toContain("growth_without_recurring_revenue");
    // Present+high base ~93.25; penalty -15 => ~78.25
    expect(tr.score_0_100).toBeLessThanOrEqual(82);
    expect(tr.score_0_100).toBeGreaterThanOrEqual(70);
  });

  it("seed: TAM without ICP/distribution and missing SOM => market penalties", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      market_accessibility_signal_v1: {
        tam_present: true,
        sam_present: false,
        som_present: false,
        icp_defined: false,
        target_segment_defined: false,
        distribution_channel_defined: false,
        wedge_defined: false,
        confidence: "low",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const mk = scored.dimensions.find((d) => d.key === "market")!;
    expect(mk.notes ?? []).toContain("tam_without_icp");
    expect(mk.notes ?? []).toContain("tam_without_distribution");
    expect(mk.notes ?? []).toContain("missing_som");
    expect(mk.score_0_100).toBeLessThanOrEqual(40);
    expect(scored.signals_used ?? []).toContain("market_accessibility_signal_v1");
  });

  it("seed: TAM + ICP + distribution + SOM => no market penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      market_accessibility_signal_v1: {
        tam_present: true,
        sam_present: true,
        som_present: true,
        icp_defined: true,
        target_segment_defined: true,
        distribution_channel_defined: true,
        wedge_defined: true,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const mk = scored.dimensions.find((d) => d.key === "market")!;
    expect(mk.notes ?? []).not.toContain("tam_without_icp");
    expect(mk.notes ?? []).not.toContain("tam_without_distribution");
    expect(mk.notes ?? []).not.toContain("missing_som");
    expect(mk.score_0_100).toBeGreaterThanOrEqual(90);
  });

  it("series_a: missing SOM => market penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "series_a", confidence: 0.8, signals: [] } as any,
      market_accessibility_signal_v1: {
        tam_present: false,
        sam_present: false,
        som_present: false,
        icp_defined: true,
        target_segment_defined: true,
        distribution_channel_defined: true,
        wedge_defined: true,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const mk = scored.dimensions.find((d) => d.key === "market")!;
    expect(mk.notes ?? []).toContain("missing_som");
    // Base present+high ~93.25; missing_som penalty -8 => ~85.25.
    expect(mk.score_0_100).toBeLessThanOrEqual(86);
    expect(mk.score_0_100).toBeGreaterThanOrEqual(83);
  });

  it("pre_seed: TAM without ICP => smaller market penalty (no distribution/missing_som codes)", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "pre_seed", confidence: 0.8, signals: [] } as any,
      market_accessibility_signal_v1: {
        tam_present: true,
        sam_present: false,
        som_present: false,
        icp_defined: false,
        target_segment_defined: false,
        distribution_channel_defined: false,
        wedge_defined: false,
        confidence: "low",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const mk = scored.dimensions.find((d) => d.key === "market")!;
    expect(mk.notes ?? []).toContain("tam_without_icp");
    expect(mk.notes ?? []).not.toContain("tam_without_distribution");
    expect(mk.notes ?? []).not.toContain("missing_som");
    // Base present+low ~70.75; pre_seed tam_without_icp penalty -8 => ~62.75.
    expect(mk.score_0_100).toBeLessThanOrEqual(70);
    expect(mk.score_0_100).toBeGreaterThanOrEqual(55);
  });

  it("No founders => heavy team penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      team_signal_v1: {
        founder_count: 0,
        key_roles_present: { ceo: false, technical: false, gtm: false },
        prior_startup_experience_present: false,
        prior_exit_present: false,
        domain_experience_present: false,
        team_size_known: false,
        confidence: "low",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tm = scored.dimensions.find((d) => d.key === "team")!;
    expect(tm.notes ?? []).toContain("no_founder");
    expect(tm.score_0_100).toBeLessThanOrEqual(15);
    expect(scored.signals_used ?? []).toContain("team_signal_v1");
  });

  it("Solo founder pre-seed => moderate penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "pre_seed", confidence: 0.8, signals: [] } as any,
      team_signal_v1: {
        founder_count: 1,
        key_roles_present: { ceo: true, technical: true, gtm: false },
        prior_startup_experience_present: false,
        prior_exit_present: false,
        domain_experience_present: true,
        team_size_known: true,
        confidence: "medium",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tm = scored.dimensions.find((d) => d.key === "team")!;
    expect(tm.notes ?? []).toContain("solo_founder");
    expect(tm.score_0_100).toBeLessThanOrEqual(80);
    expect(tm.score_0_100).toBeGreaterThanOrEqual(60);
  });

  it("Balanced founding team => no penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      team_signal_v1: {
        founder_count: 2,
        key_roles_present: { ceo: true, technical: true, gtm: true },
        prior_startup_experience_present: true,
        prior_exit_present: false,
        domain_experience_present: true,
        team_size_known: true,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tm = scored.dimensions.find((d) => d.key === "team")!;
    expect(tm.notes ?? []).toContain("balanced_team");
    expect(tm.notes ?? []).not.toContain("no_technical_lead");
    expect(tm.notes ?? []).not.toContain("no_gtm_lead");
    expect(tm.score_0_100).toBeGreaterThanOrEqual(90);
  });

  it("Prior exit => small boost", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      team_signal_v1: {
        founder_count: 2,
        key_roles_present: { ceo: true, technical: true, gtm: true },
        prior_startup_experience_present: true,
        prior_exit_present: true,
        domain_experience_present: true,
        team_size_known: true,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tm = scored.dimensions.find((d) => d.key === "team")!;
    expect(tm.notes ?? []).toContain("prior_exit_present");
    expect(tm.score_0_100).toBeGreaterThanOrEqual(95);
  });

  it("Seed stage: no technical lead => penalty", () => {
    const inputs = buildStageWeightedScoreInputsV1({
      funding_stage_v1: { funding_stage: "seed", confidence: 0.8, signals: [] } as any,
      team_signal_v1: {
        founder_count: 2,
        key_roles_present: { ceo: true, technical: false, gtm: true },
        prior_startup_experience_present: true,
        prior_exit_present: false,
        domain_experience_present: true,
        team_size_known: true,
        confidence: "high",
        signals: [],
      } as any,
    });

    const scored = scoreStageWeightedV1(inputs);
    const tm = scored.dimensions.find((d) => d.key === "team")!;
    expect(tm.notes ?? []).toContain("no_technical_lead");
    // Base present+high ~93.25; penalty -12 => ~81.25.
    expect(tm.score_0_100).toBeLessThanOrEqual(88);
    expect(tm.score_0_100).toBeGreaterThanOrEqual(70);
  });
});
