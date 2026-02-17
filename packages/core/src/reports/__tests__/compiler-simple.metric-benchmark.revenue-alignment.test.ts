import { compileDIOToReportWithPromotedFacts } from "../compiler-simple";

describe("compileDIOToReportWithPromotedFacts metric-benchmark revenue alignment", () => {
  it("does not mark revenue as Missing when forecast revenue is present in promoted facts", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000001101",
      deal_id: "00000000-0000-4000-8000-000000001102",
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
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.7,
          overall_score: 80,
          metrics_analyzed: [
            {
              metric: "revenue",
              value: 0,
              benchmark_value: 0,
              benchmark_source: "No benchmark available",
              rating: "Missing",
              deviation_pct: 0,
              evidence_id: "00000000-0000-4000-8000-000000001103",
            },
          ],
          evidence_ids: [],
        },

        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0 },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          health_score: null,
          runway_months: null,
          burn_multiple: null,
          risks: [],
          evidence_ids: [],
        },
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

    const promotedFacts: any[] = [
      {
        fact_type: "revenue_v1",
        confidence: 0.82,
        extracted_at: now,
        content_json: {
          fact_type: "revenue_v1",
          value_json: {
            display: "$40k",
            raw: "$40k",
            subtype: "forecast",
            scope: "company_total",
            amount: { amount: 40000 },
            year: new Date().getFullYear(),
          },
          provenance: { source_document_id: "doc-1", page_index: 0 },
        },
        meta: { document_id: "doc-1", page_index: 0 },
      },
    ];

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });

    // Canonical structured_summary excludes forecast revenue, but Business Metrics should still treat it as present.
    expect(report.structured_summary.revenue.value).toBeNull();

    const section = report.sections.find((s: any) => s.id === "metric-benchmark");
    expect(section).toBeTruthy();

    const content = String(section.content);
    expect(content).toContain("• revenue: $40k");
    expect(content).toMatch(/•\s*revenue:.*\(Adequate\)/i);
    expect(content).not.toMatch(/•\s*revenue:.*\(Missing\)/i);
  });
});
