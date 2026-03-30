import { deriveDeepDiveClassificationEnrichmentV1 } from "../deep-dive-classification-context-v1";

describe("deep-dive classification context v1", () => {
  it("keeps product-native model primary and adds taxonomy candidates as support", () => {
    const enrichment = deriveDeepDiveClassificationEnrichmentV1({
      dio: {
        phase1: {
          deal_classification_v1: { selected_policy: "enterprise_saas_b2b_v1" },
          business_model_arbitration_v1: { business_model: "saas", confidence: 0.82 },
          business_archetype_v1: { value: "saas", confidence: 0.8 },
        },
      },
      report: {
        structured_summary: {
          business_model: { value: "B2B SaaS" },
        },
      },
      orchestrator_report: {
        segments: {
          product_profile_v1: { product_type: "SaaS" },
        },
      },
    });

    expect(enrichment.inferredLabel).toBe("B2B SaaS");
    expect(enrichment.naicsCandidates.length).toBeGreaterThan(0);
    expect(enrichment.classificationConflict).toBe(false);
  });

  it("detects conflict when policy category materially diverges from native business model", () => {
    const enrichment = deriveDeepDiveClassificationEnrichmentV1({
      dio: {
        phase1: {
          deal_classification_v1: { selected_policy: "real_estate_underwriting" },
          business_model_arbitration_v1: { business_model: "saas", confidence: 0.9 },
        },
      },
      report: {
        structured_summary: {
          business_model: { value: "B2B SaaS" },
        },
      },
      orchestrator_report: {
        segments: {
          product_profile_v1: { product_type: "SaaS" },
        },
      },
    });

    expect(enrichment.classificationConflict).toBe(true);
    expect(enrichment.conflictReason).toContain("conflicts");
  });
});
