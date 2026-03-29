import { describe, expect, it } from "vitest";

import {
  composePolicyAwareSystemPrompt,
  loadPolicyPromptRuntimePacket,
  validatePolicyAwareOutputTemplateV2,
} from "../policy-aware-prompt-runtime";

describe("policy-aware prompt runtime integration", () => {
  it("startup policy composition includes startup-required metrics and artifact metadata", () => {
    const packet = loadPolicyPromptRuntimePacket({ forceReload: true });
    expect(packet.artifacts.system_audit_prompt_pack_v1.version).toBe("v1");
    expect(packet.artifacts.policy_aware_output_template_v2.version).toBe("v2");

    const composed = composePolicyAwareSystemPrompt({
      kind: "deal_summary_v2",
      selectedPolicyId: "operating_startup_revenue_v1",
    });

    expect(composed.runtimeMetadata.selected_policy_id).toBe("operating_startup_revenue_v1");
    expect(composed.runtimeMetadata.policy_requirements.required_metrics).toContain("cac");
    expect(composed.systemPrompt.toLowerCase()).toContain("selected_policy_id=operating_startup_revenue_v1");
    expect(composed.systemPrompt.toLowerCase()).toContain("required_metrics=icp,cac,ltv,payback_period,revenue_growth");
    expect(composed.runtimeMetadata.prompt_artifacts.length).toBe(4);
    expect(composed.runtimeMetadata.prompt_artifacts.every((a) => a.sha256.length === 64)).toBe(true);
  });

  it("real estate policy excludes startup metrics like CAC/ICP from required set", () => {
    const composed = composePolicyAwareSystemPrompt({
      kind: "governed_ui_copy_v1",
      selectedPolicyId: "real_estate_underwriting",
    });

    expect(composed.runtimeMetadata.selected_policy_id).toBe("real_estate_underwriting");
    expect(composed.runtimeMetadata.policy_requirements.required_metrics).toContain("noi");
    expect(composed.runtimeMetadata.policy_requirements.required_metrics).toContain("cap_rate");
    expect(composed.runtimeMetadata.policy_requirements.required_metrics).not.toContain("cac");
    expect(composed.runtimeMetadata.policy_requirements.not_applicable_metrics).toContain("cac");

    const validation = validatePolicyAwareOutputTemplateV2({
      kind: "governed_ui_copy_v1",
      selectedPolicyId: "real_estate_underwriting",
      output: {
        hero_summary: "Multifamily acquisition strategy focused on NOI improvement and occupancy stabilization.",
        product_solution: "The platform acquires under-managed properties and executes targeted capex plans.",
        market_icp: "Target assets are value-add multifamily in supply-constrained submarkets.",
        business_model: "Returns are generated from rent growth, NOI expansion, and cap-rate compression.",
        raise_terms: "Seeking equity capital for acquisition and renovation pipeline.",
      },
    });

    expect(validation.ok).toBe(true);
    expect(validation.degraded).toBe(false);
  });
});
