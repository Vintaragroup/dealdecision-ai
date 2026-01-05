import { compileDIOToReport } from "../compiler-simple";

describe("compileDIOToReport grade cap", () => {
  it("uses 'Insufficient Information' when <3 components included", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000201",
      deal_id: "00000000-0000-4000-8000-000000000202",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: { primary_doc_type: "pitch_deck" },
      inputs: {
        documents: [],
        evidence: [],
        config: { analyzer_versions: {}, features: {}, parameters: {} },
      },
      analyzer_results: {
        // Only two contributing components
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.7, pacing_score: 80 },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.7, overall_score: 80, metrics_analyzed: [] },

        // Everything else non-contributing
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0, risks: [], evidence_ids: [] },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          overall_risk_score: null,
          total_risks: 0,
          critical_count: 0,
          high_count: 0,
          risks_by_category: { market: [], team: [], financial: [], execution: [] },
          evidence_ids: [],
        },
      },
    };

    const report = compileDIOToReport(dio);
    expect(report.grade).toBe("Insufficient Information");
  });


  it("does not force overallScore to 0 when ok_count===0 and score_explanation totals are missing", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000301",
      deal_id: "00000000-0000-4000-8000-000000000302",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: { primary_doc_type: "pitch_deck" },
      inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
      analyzer_results: {
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0, metrics_analyzed: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0, risks: [], evidence_ids: [] },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          overall_risk_score: 0,
          total_risks: 0,
          critical_count: 0,
          high_count: 0,
          risks_by_category: { market: [], team: [], financial: [], execution: [] },
          evidence_ids: [],
        },
      },
      // Simulate an older / incomplete explanation payload that still contains enough data to derive a score.
      score_explanation: {
        aggregation: {
          method: "weighted_mean",
          weights: {
            slide_sequence: 0,
            metric_benchmark: 0,
            visual_design: 0,
            narrative_arc: 0,
            financial_health: 0,
            risk_assessment: 0,
          },
          included_components: [
            "slide_sequence",
            "metric_benchmark",
            "visual_design",
            "narrative_arc",
            "financial_health",
            "risk_assessment",
          ],
          excluded_components: [],
        },
        components: {
          slide_sequence: { status: "penalized_non_ok", used_score: 50, penalty: 6 },
          metric_benchmark: { status: "penalized_non_ok", used_score: 50, penalty: 6 },
          visual_design: { status: "penalized_non_ok", used_score: 50, penalty: 6 },
          narrative_arc: { status: "penalized_non_ok", used_score: 50, penalty: 6 },
          financial_health: { status: "penalized_non_ok", used_score: 50, penalty: 6 },
          risk_assessment: { status: "penalized_non_ok", used_score: 50, penalty: 6, inverted_investment_score: 50 },
        },
        totals: {
          overall_score: null,
          unadjusted_overall_score: null,
          coverage_ratio: 0,
          confidence_score: 0,
          evidence_factor: 0.5,
          due_diligence_factor: 1,
          adjustment_factor: 0.5,
        },
      },
    };

    const report = compileDIOToReport(dio);
    expect(report.grade).toBe("Insufficient Information");
    expect(report.overallScore).toBeGreaterThan(0);
    // used_score=50, penalty=6 across 6 components => effective 44.
    // weights sum to 0 => equal-weight fallback => 44.
    expect(report.overallScore).toBe(44);
  });
});
