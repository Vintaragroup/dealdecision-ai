import {
  getSelectedPolicyIdFromAny,
  resolveSelectedPolicyIdFromAny,
} from "../get-selected-policy-id";

describe("get-selected-policy-id", () => {
  test("prioritizes explicitly passed selectedPolicyId", () => {
    const out = resolveSelectedPolicyIdFromAny({
      selectedPolicyId: "real_estate_underwriting",
      selected_policy: "startup_raise",
      policy_id: "fund_spv",
      deal_classification_v1: { selected_policy: "credit_memo" },
    });

    expect(out.policyId).toBe("real_estate_underwriting");
    expect(out.source).toBe("selectedPolicyId");
    expect(out.usedFallback).toBe(false);
  });

  test("resolves top-level selected_policy before policy_id", () => {
    const out = resolveSelectedPolicyIdFromAny({
      selected_policy: "real_estate_underwriting",
      policy_id: "startup_raise",
      deal_classification_v1: { selected_policy: "fund_spv" },
    });

    expect(out.policyId).toBe("real_estate_underwriting");
    expect(out.source).toBe("selected_policy");
  });

  test("resolves policy_id when selected_policy is absent", () => {
    const out = resolveSelectedPolicyIdFromAny({
      policy_id: "real_estate_underwriting",
    });

    expect(out.policyId).toBe("real_estate_underwriting");
    expect(out.source).toBe("policy_id");
    expect(out.usedFallback).toBe(false);
  });

  test("resolves nested classification in existing report/envelope-like shapes", () => {
    const out = resolveSelectedPolicyIdFromAny({
      report: {
        dio: {
          deal_classification_v1: {
            selected_policy: "real_estate_underwriting",
          },
        },
      },
      dio: {
        deal_classification_v1: {
          selected_policy: "real_estate_underwriting",
        },
      },
    });

    expect(out.policyId).toBe("real_estate_underwriting");
    expect(out.source).toBe("dio.deal_classification_v1.selected_policy");
  });

  test("uses deep-search fallback only for structured classification path", () => {
    const out = resolveSelectedPolicyIdFromAny({
      envelope: {
        payload: {
          nested: {
            deal_classification_v1: {
              selected_policy: "fund_spv",
            },
          },
        },
      },
    });

    expect(out.policyId).toBe("fund_spv");
    expect(out.source).toBe("deep_search.deal_classification_v1.selected_policy");
    expect(out.usedFallback).toBe(true);
  });

  test("returns null when policy cannot be resolved from deterministic fields", () => {
    expect(getSelectedPolicyIdFromAny({ model_text: "probably real estate" })).toBeNull();

    const out = resolveSelectedPolicyIdFromAny({ model_text: "probably real estate" });
    expect(out.policyId).toBeNull();
    expect(out.source).toBe("not_found");
    expect(out.usedFallback).toBe(true);
  });
});
