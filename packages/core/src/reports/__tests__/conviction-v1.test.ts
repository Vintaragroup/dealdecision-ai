import { compileDIOToReport } from "../compiler-simple";

describe("conviction_v1 contract", () => {
  const now = new Date().toISOString();

  function makeDio(policyId: string): any {
    return {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-00000000d901",
      deal_id: "00000000-0000-4000-8000-00000000d902",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      policy_id: policyId,
      dio_context: { primary_doc_type: "pitch_deck" },
      inputs: {
        documents: [],
        evidence: [],
        config: {
          analyzer_versions: {},
          features: {},
          parameters: {},
        },
      },
      analyzer_results: {
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.9, confidence: 0.8, score: 72, pattern_match: "ok", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: ["ev-slide"] },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, overall_score: 74, metrics_analyzed: [], evidence_ids: ["ev-metric"] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.7, design_score: 69, proxy_signals: {}, strengths: [], weaknesses: [], evidence_ids: ["ev-visual"] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.7, pacing_score: 71, archetype: "", archetype_confidence: 0, emotional_beats: [], evidence_ids: ["ev-arc"] },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.6, confidence: 0.7, runway_months: 12, burn_multiple: 1.5, health_score: 73, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: ["ev-fin"] },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.6,
          confidence: 0.7,
          overall_risk_score: 30,
          risks_by_category: { market: [], team: [], financial: [], execution: [] },
          total_risks: 1,
          critical_count: 0,
          high_count: 0,
          evidence_ids: ["ev-risk"],
        },
      },
    };
  }

  it("emits required conviction_v1 shape with lineage", () => {
    const report: any = compileDIOToReport(makeDio("operating_startup_revenue_v1"));
    const c = report?.conviction_v1;

    expect(c).toBeTruthy();
    expect(c.schema_version).toBe("conviction_v1");
    expect(typeof c.selected_policy_id === "string" || c.selected_policy_id === null).toBe(true);
    expect(typeof c.conviction_score_0_100).toBe("number");
    expect(typeof c.conviction_band).toBe("string");
    expect(typeof c.recommendation_posture).toBe("string");
    expect(typeof c.confidence_0_1).toBe("number");
    expect(typeof c.coverage_ratio_0_1).toBe("number");
    expect(typeof c.contradiction_index_0_1).toBe("number");
    expect(c.inputs && typeof c.inputs === "object").toBe(true);
    expect(Array.isArray(c.top_positive_contributors)).toBe(true);
    expect(Array.isArray(c.top_negative_contributors)).toBe(true);
    expect(Array.isArray(c.unknowns)).toBe(true);
    expect(Array.isArray(c.contradictions)).toBe(true);
    expect(Array.isArray(c.required_next_checks)).toBe(true);
    expect(c.lineage?.mapping_version).toBe("phase2_deterministic_v1");
    expect(Array.isArray(c.lineage?.source_artifacts)).toBe(true);
    expect(c.lineage.source_artifacts.some((x: any) => x.artifact === "score_explanation" && x.used === true)).toBe(true);
    expect(typeof c.inputs.financial_truth.signal_strength).toBe("number");
    expect(typeof c.inputs.financial_truth.confidence).toBe("number");
    expect(typeof c.inputs.financial_truth.coverage).toBe("number");
  });

  it("preserves selected_policy_id across startup and real-estate policies", () => {
    const startup: any = compileDIOToReport(makeDio("operating_startup_revenue_v1"));
    const realEstate: any = compileDIOToReport(makeDio("real_estate_underwriting"));

    expect(startup?.conviction_v1?.selected_policy_id).toBe("operating_startup_revenue_v1");
    expect(realEstate?.conviction_v1?.selected_policy_id).toBe("real_estate_underwriting");
  });

  it("is additive and keeps legacy report outputs intact", () => {
    const report: any = compileDIOToReport(makeDio("operating_startup_revenue_v1"));

    expect(report?.conviction_v1).toBeTruthy();
    expect(report?.metadata?.score_explanation).toBeTruthy();
    expect(typeof report?.overallScore).toBe("number");
    expect(typeof report?.recommendation).toBe("string");
    expect(Array.isArray(report?.sections)).toBe(true);
  });
});
