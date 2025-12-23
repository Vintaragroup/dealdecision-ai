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
});
