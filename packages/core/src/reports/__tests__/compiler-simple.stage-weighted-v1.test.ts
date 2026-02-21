import { compileDIOToReport } from "../compiler-simple";

describe("compileDIOToReport stage_weighted_v1", () => {
  it("attaches stage_weighted_v1 under metadata.score_explanation", () => {
    const now = new Date().toISOString();
    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000901",
      deal_id: "00000000-0000-4000-8000-000000000902",
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
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          metrics_analyzed: [],
        },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
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

    const report: any = compileDIOToReport(dio);
    expect(report?.metadata?.score_explanation?.stage_weighted_v1).toBeTruthy();
    expect(typeof report.metadata.score_explanation.stage_weighted_v1.score_0_100).toBe("number");
    expect(Array.isArray(report.metadata.score_explanation.stage_weighted_v1.dimensions)).toBe(true);
  });
});
