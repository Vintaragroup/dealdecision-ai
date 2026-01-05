import { MetricBenchmarkValidator } from "../../analyzers/metric-benchmark";
import { RiskAssessmentEngine } from "../../analyzers/risk-assessment";
import { buildScoreExplanationFromDIO, buildScoringDiagnosticsFromDIO } from "../score-explanation";

describe("real_estate_underwriting gold standard (CROSS Dev)", () => {
  it("scores >= 75 with no red flags and strong metric benchmark", async () => {
    const now = new Date().toISOString();

    const metricBenchmark = new MetricBenchmarkValidator();
    const riskAssessment = new RiskAssessmentEngine();

    const reText = [
      "Preferred equity investment in a long-term leased asset.",
      "Absolute NNN lease with corporate guaranty.",
      "Occupancy 97%. Lease term 10 years.",
      "NOI $1,200,000. DSCR 1.30.",
      "Contracted cash flows and downside protection via the lease/guarantees.",
    ].join(" ");

    // CROSS Dev–like fixture: preferred equity, long-term lease, NOI, DSCR.
    const mb = await metricBenchmark.analyze({
      text: reText,
      policy_id: "real_estate_underwriting",
      extracted_metrics: [
        { name: "NOI", value: "$1,200,000", source: "om" },
        { name: "DSCR", value: "1.30", source: "om" },
        { name: "Lease Term", value: "120 months", source: "om" },
        { name: "Occupancy", value: "97%", source: "om" },
        // Intentionally include a SaaS-style metric to prove it does not drag the score down under RE policy.
        { name: "Revenue", value: "$0", source: "deck" },
      ],
      evidence_ids: ["00000000-0000-4000-8000-00000000c001"],
    } as any);

    const ra = await riskAssessment.analyze({
      pitch_text: reText,
      documents: [{ full_text: reText }],
      evidence: [],
      headings: ["Overview", "Lease", "Financials"],
      policy_id: "real_estate_underwriting",
      metrics: {
        dscr: 1.3,
        occupancy: 97,
        lease_term_months: 120,
      },
      evidence_ids: ["00000000-0000-4000-8000-00000000c001"],
    } as any);

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-00000000d001",
      deal_id: "00000000-0000-4000-8000-00000000d002",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "business_plan_im",
        deal_type: "real_estate",
        vertical: "real_estate",
        stage: "operating",
        confidence: 0.95,
      },
      dio: {
        deal_classification_v1: {
          candidates: [
            {
              asset_class: "real_estate",
              deal_structure: "preferred_equity",
              strategy_subtype: "real_estate_preferred_equity",
              confidence: 0.9,
              signals: ["NOI", "DSCR", "long_term_lease"],
            },
          ],
          selected: {
            asset_class: "real_estate",
            deal_structure: "preferred_equity",
            strategy_subtype: "real_estate_preferred_equity",
            confidence: 0.9,
            signals: ["NOI", "DSCR", "long_term_lease"],
          },
          selected_policy: "real_estate_underwriting",
          routing_reason: ["gold fixture"],
        },
      },
      inputs: {
        documents: [
          {
            fileName: "CROSS Dev OM.pdf",
            page_count: 15,
            type: "business_plan_im",
            textSummary: reText,
            keyMetrics: [
              { key: "NOI", value: "$1,200,000", source: "om" },
              { key: "DSCR", value: "1.30", source: "om" },
              { key: "Lease Term", value: "120 months", source: "om" },
              { key: "Occupancy", value: "97%", source: "om" },
              { key: "Lease", value: "Absolute NNN with corporate guaranty", source: "om" },
            ],
          },
        ],
        evidence: [],
        config: { features: { debug_scoring: false } },
      },
      analyzer_results: {
        metric_benchmark: mb,
        narrative_arc: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.9,
          pacing_score: 80,
          archetype: "underwriting",
          archetype_confidence: 0.8,
          emotional_beats: [],
          evidence_ids: [],
        },
        risk_assessment: {
          ...ra,
          // Ensure deterministic protections aren't mistaken for missing signal.
          status: "ok",
        },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);
    const diagnostics = buildScoringDiagnosticsFromDIO(dio);

    expect(explanation.aggregation.policy_id).toBe("real_estate_underwriting");
    expect(explanation.totals.overall_score).not.toBeNull();
    expect(explanation.totals.overall_score as number).toBeGreaterThanOrEqual(75);

    expect(diagnostics.buckets.red_flags.length).toBe(0);

    expect(explanation.components.metric_benchmark.used_score).not.toBeNull();
    expect(explanation.components.metric_benchmark.used_score as number).toBeGreaterThan(70);

    // Gold-standard RE underwriting should also have strong raw metric benchmark.
    const rawMb = (dio.analyzer_results.metric_benchmark.overall_score ?? null) as number | null;
    expect(rawMb).not.toBeNull();
    expect(rawMb as number).toBeGreaterThanOrEqual(80);

    // Explicit “why >= 75” diagnostics (policy-scoped)
    const positiveTexts = diagnostics.buckets.positive_signals.map((b) => b.text);
    expect(positiveTexts).toEqual(expect.arrayContaining(["Contracted cash flows", "Downside protection via lease/guarantees"]));
  });
});
