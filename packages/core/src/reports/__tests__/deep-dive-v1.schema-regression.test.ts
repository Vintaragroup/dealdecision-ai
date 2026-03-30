import { buildDealDeepDiveV1 } from "../deep-dive-v1";
import { DealDeepDiveV1Schema } from "../deep-dive-v1.schema";

describe("deep-dive v1 schema regression", () => {
  it("locks top-level and section key contracts", () => {
    const deepDive = buildDealDeepDiveV1({
      deal_id: "00000000-0000-4000-8000-00000000dd21",
      analysis_version: 8,
      dio: { dio_id: "00000000-0000-4000-8000-00000000dd22" },
      report: {
        structured_summary: {
          raise: { value: "$3M" },
          business_model: { value: "B2B SaaS", sources: [{ evidence_id: "ev-bm-21" }] },
          revenue: { value: { amount: 2100000 } },
          customers: { value: { count: 73 } },
          growth: { value: { percent: 44 } },
        },
        underwriting_readiness_v1: { gaps: ["no_cap_table"] },
        financial_breakdown_v1: {
          current_state: { summary: "Current state is partially complete." },
          projections: { periods: [{ period_label: "2028", period_type: "year", is_projected: true }] },
        },
        metadata: {
          score_explanation: {
            understanding_v1: {
              diligence_open_items: [{ text: "Validate gross margin bridge" }],
            },
          },
        },
      },
      orchestrator_report: {
        segments: {
          market: {
            narrative: "Clear demand signal.",
            kpis: [{ label: "TAM", value: "$5B", evidence_refs: ["ev-market-21"] }],
            strengths: ["Strong wedge"],
            concerns: ["Crowded segment"],
            missing_inputs: ["timing clarity"],
            evidence_refs: ["ev-market-22"],
          },
          product_profile_v1: {
            product_type: "SaaS",
            differentiation_claims: ["Vertical workflow system"],
            ai_claims_present: false,
            ai_defensibility_notes: null,
            integrations_or_dependencies: ["Salesforce"],
            sources: ["ev-product-21"],
          },
          financial: {
            benchmarks: [{ label: "ARR", value: "$2.1M", evidence_refs: ["ev-fin-21"] }],
            reconciliation: { flags: [{ name: "arr_recon", status: "PASS", evidence_refs: ["ev-fin-22"], note: null }] },
          },
          risk_verification: {
            top_risks: [{ risk: "Execution risk", severity: "medium", evidence_refs: ["ev-risk-21"] }],
            verification_requests: [{ request: "Verify enterprise sales cycle assumptions" }],
            data_issues: { conflicts: [] },
          },
          executive_summary: {
            strengths: ["Focused operator team"],
            open_questions: ["How quickly can onboarding be automated?"],
          },
        },
      },
    });

    const parsed = DealDeepDiveV1Schema.parse(deepDive);
    expect(parsed).toBeDefined();

    expect(Object.keys(parsed).sort()).toEqual([
      "analysis_version",
      "business_model",
      "deal_id",
      "discovery",
      "financials",
      "gap",
      "generated_at",
      "implementation",
      "market",
      "open_questions",
      "product",
      "red_flags",
      "risks",
      "schema_version",
      "team",
      "traction",
    ]);

    expect(Object.keys(parsed.discovery).sort()).toEqual([
      "diligence_open_items_count",
      "key_facts",
      "section",
      "sources",
      "verification_requests_count",
    ]);

    expect(Object.keys(parsed.gap).sort()).toEqual([
      "diligence_open_items",
      "missing_critical_facts",
      "section",
      "underwriting_gaps",
      "verification_requests",
    ]);

    expect(Object.keys(parsed.market).sort()).toEqual(["section", "tam_reasoning", "timing_logic"]);
    expect(Object.keys(parsed.product).sort()).toEqual(["defensibility_logic", "differentiation_detection", "section"]);
    expect(Object.keys(parsed.business_model).sort()).toEqual(["revenue_model_inference", "scaling_logic", "section"]);
    expect(Object.keys(parsed.traction).sort()).toEqual(["growth_validation", "proof_vs_promise_detection", "section"]);
    expect(Object.keys(parsed.financials).sort()).toEqual(["interpretation_layer", "section"]);
    expect(Object.keys(parsed.team).sort()).toEqual(["capability_inference", "section"]);
    expect(Object.keys(parsed.risks).sort()).toEqual(["classification", "section"]);
    expect(Object.keys(parsed.red_flags).sort()).toEqual(["items", "section"]);
    expect(Object.keys(parsed.open_questions).sort()).toEqual(["prioritized", "section"]);
    expect(Object.keys(parsed.implementation).sort()).toEqual(["actions", "section"]);
  });
});
