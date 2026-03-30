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

  it("suppresses explicit taxonomy assertions in market/business model/financials when classification conflicts", () => {
    const deepDive = buildDealDeepDiveV1({
      deal_id: "00000000-0000-4000-8000-00000000dd12",
      dio: {
        phase1: {
          deal_classification_v1: {
            selected_policy: "real_estate_underwriting",
            selected: { confidence: 0.95 },
          },
          business_model_arbitration_v1: { business_model: "B2B SaaS", confidence: 0.9 },
          business_archetype_v1: { value: "saas", confidence: 0.9 },
        },
      },
      report: {
        structured_summary: {
          business_model: { value: "B2B SaaS" },
          revenue: { value: { amount: 250000 } },
          customers: { value: { count: 10 } },
          growth: { value: { percent: 30 } },
          raise: { value: "$1M" },
        },
        financial_breakdown_v1: {
          current_state: { summary: "Financials partially available." },
          projections: { periods: [], path_to_profitability_label: null },
        },
      },
      orchestrator_report: {
        segments: {
          market: { kpis: [], strengths: [], missing_inputs: [], evidence_refs: [] },
          product_profile_v1: { product_type: "SaaS", sources: [] },
          financial: { benchmarks: [], reconciliation: { flags: [] } },
          risk_verification: { top_risks: [], verification_requests: [], data_issues: { conflicts: [] } },
          executive_summary: { strengths: [], open_questions: [] },
        },
      },
    });

    expect(
      deepDive.market.tam_reasoning.notes.some((note) =>
        note.includes("Best-fit industry category context points to")
      )
    ).toBe(false);
    expect(
      deepDive.business_model.scaling_logic.notes.some((note) =>
        note.includes("Best-fit industry category context")
      )
    ).toBe(false);
    expect(
      deepDive.financials.interpretation_layer.forward_view_signals.some((note) =>
        note.includes("secondary benchmark")
      )
    ).toBe(false);
    expect(
      deepDive.risks.classification.some((item) => item.risk.startsWith("Classification conflict:"))
    ).toBe(true);
    expect(
      deepDive.red_flags.items.some((item) => item.flag.includes("Classification conflict detected"))
    ).toBe(true);
  });

  it("uses provisional taxonomy wording when confidence is weak or unresolved", () => {
    const deepDive = buildDealDeepDiveV1({
      deal_id: "00000000-0000-4000-8000-00000000dd13",
      report: {
        structured_summary: {
          business_model: { value: "Operating company" },
          raise: { value: "$500k" },
          revenue: { value: { amount: 1000 } },
        },
        financial_breakdown_v1: {
          current_state: { summary: "Sparse current signals." },
          projections: { periods: [], path_to_profitability_label: null },
        },
      },
      orchestrator_report: {
        segments: {
          market: { kpis: [], strengths: [], missing_inputs: [], evidence_refs: [] },
          product_profile_v1: { product_type: "unknown", sources: [] },
          financial: { benchmarks: [], reconciliation: { flags: [] } },
          risk_verification: { top_risks: [], verification_requests: [], data_issues: { conflicts: [] } },
          executive_summary: { strengths: [], open_questions: [] },
        },
      },
    });

    expect(
      deepDive.market.tam_reasoning.notes.some((note) =>
        note.includes("Directional classification context is available, but remains provisional")
      )
    ).toBe(true);
    expect(
      deepDive.financials.interpretation_layer.forward_view_signals.some((note) =>
        note.includes("remains provisional for financial interpretation")
      )
    ).toBe(true);
  });

  it("keeps native business model primary when native confidence is high and aligned", () => {
    const deepDive = buildDealDeepDiveV1({
      deal_id: "00000000-0000-4000-8000-00000000dd14",
      dio: {
        phase1: {
          deal_classification_v1: {
            selected_policy: "enterprise_saas_b2b_v1",
            selected: { confidence: 0.92 },
          },
          business_model_arbitration_v1: { business_model: "B2B SaaS", confidence: 0.91 },
          business_archetype_v1: { value: "saas", confidence: 0.9 },
        },
      },
      report: {
        structured_summary: {
          business_model: { value: "B2B SaaS" },
          raise: { value: "$2M" },
          revenue: { value: { amount: 2000000 } },
          customers: { value: { count: 20 } },
          growth: { value: { percent: 40 } },
        },
      },
      orchestrator_report: {
        segments: {
          market: {
            kpis: [{ label: "TAM", value: "$5B", evidence_refs: ["ev1"] }],
            strengths: ["Enterprise expansion"],
            missing_inputs: [],
            evidence_refs: ["ev2"],
          },
          product_profile_v1: { product_type: "SaaS", sources: [] },
          financial: { benchmarks: [{ evidence_refs: ["ev3"] }], reconciliation: { flags: [] } },
          risk_verification: { top_risks: [], verification_requests: [], data_issues: { conflicts: [] } },
          executive_summary: { strengths: [], open_questions: [] },
        },
      },
    });

    expect(deepDive.business_model.revenue_model_inference.inferred_model).toBe("B2B SaaS");
    expect(
      deepDive.business_model.scaling_logic.notes.some((note) =>
        note.includes("Primary business model remains B2B SaaS")
      )
    ).toBe(true);
  });
});
