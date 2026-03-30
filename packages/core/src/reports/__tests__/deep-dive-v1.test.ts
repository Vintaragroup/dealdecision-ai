import { buildDealDeepDiveV1 } from "../deep-dive-v1";

describe("deep-dive v1 builder", () => {
  it("builds structured sections from normalized facts and signals", () => {
    const deepDive = buildDealDeepDiveV1({
      deal_id: "00000000-0000-4000-8000-00000000dd01",
      analysis_version: 3,
      dio: { dio_id: "00000000-0000-4000-8000-00000000dd02" },
      report: {
        structured_summary: {
          raise: { value: "$2.5M" },
          business_model: { value: "B2B SaaS", sources: [{ evidence_id: "ev-bm-1" }] },
          revenue: { value: { amount: 1200000 } },
          customers: { value: { count: 45 } },
          growth: { value: { percent: 62 } },
        },
        underwriting_readiness_v1: { gaps: ["no_cap_table"] },
        financial_breakdown_v1: {
          current_state: { summary: "Revenue and burn are visible." },
          projections: { periods: [{ period_label: "2027", period_type: "year", is_projected: true }], path_to_profitability_label: "Q4 2027" },
        },
        metadata: {
          score_explanation: {
            understanding_v1: {
              diligence_open_items: [{ text: "Validate churn assumptions" }],
            },
          },
        },
      },
      orchestrator_report: {
        segments: {
          market: {
            narrative: "Large market with clear expansion path.",
            kpis: [{ label: "TAM", value: "$4B", evidence_refs: ["ev-market-1"] }],
            strengths: ["Distribution leverage"],
            missing_inputs: [],
            evidence_refs: ["ev-market-2"],
          },
          product_profile_v1: {
            product_type: "SaaS",
            differentiation_claims: ["Workflow-first vertical product"],
            ai_claims_present: true,
            ai_defensibility_notes: "Domain-specific labeled dataset",
            integrations_or_dependencies: ["QuickBooks", "Stripe"],
            sources: ["ev-product-1"],
          },
          financial: {
            benchmarks: [{ label: "Gross Margin", value: "68%", evidence_refs: ["ev-fin-1"] }],
            reconciliation: { flags: [{ name: "revenue_recon", status: "PASS", evidence_refs: ["ev-fin-2"], note: null }] },
          },
          risk_verification: {
            top_risks: [{ risk: "Customer concentration risk", severity: "high", evidence_refs: ["ev-risk-1"] }],
            verification_requests: [{ request: "Verify concentration trend over 12 months" }],
            data_issues: { conflicts: [] },
          },
          executive_summary: {
            strengths: ["Strong operator bench"],
            open_questions: ["What is expansion CAC by segment?"],
          },
        },
      },
    });

    expect(deepDive.schema_version).toBe("deal_deep_dive_v1");
    expect(deepDive.market.section).toBe("market");
    expect(deepDive.product.section).toBe("product");
    expect(deepDive.business_model.section).toBe("business_model");
    expect(deepDive.traction.section).toBe("traction");
    expect(deepDive.financials.section).toBe("financials");
    expect(deepDive.team.section).toBe("team");
    expect(deepDive.risks.section).toBe("risks");
    expect(deepDive.red_flags.section).toBe("red_flags");
    expect(deepDive.open_questions.section).toBe("open_questions");
    expect(Array.isArray(deepDive.implementation.actions)).toBe(true);
  });

  it("surfaces contradiction-derived red flags and implementation actions", () => {
    const deepDive = buildDealDeepDiveV1({
      deal_id: "00000000-0000-4000-8000-00000000dd11",
      report: {
        structured_summary: {
          business_model: { value: "Marketplace" },
          revenue: { value: { amount: 500000 } },
          customers: { value: { count: 10 } },
          growth: { value: { percent: 20 } },
          raise: { value: null },
        },
        underwriting_readiness_v1: { gaps: ["no_runway"] },
        metadata: { score_explanation: { understanding_v1: { diligence_open_items: [] } } },
      },
      orchestrator_report: {
        segments: {
          product_profile_v1: { product_type: "SaaS", sources: [] },
          market: { kpis: [], strengths: [], missing_inputs: ["timing"], evidence_refs: [] },
          financial: { benchmarks: [], reconciliation: { flags: [] } },
          risk_verification: { top_risks: [], verification_requests: [], data_issues: { conflicts: [] } },
          executive_summary: { strengths: [], open_questions: [] },
        },
      },
    });

    expect(deepDive.red_flags.items.length).toBeGreaterThan(0);
    expect(deepDive.red_flags.items.some((x) => x.contradiction_type === "semantic_divergence")).toBe(true);
    expect(deepDive.implementation.actions.some((x) => x.source === "structured_summary")).toBe(true);
  });
});
