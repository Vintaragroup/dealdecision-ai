import {
  detectDeepDiveContradictionsV1,
  evidenceStrengthFromSignals,
  prioritizeDeepDiveQuestionsV1,
} from "../deep-dive-reasoning-v1";

describe("deep-dive reasoning v1", () => {
  it("assigns evidence strength deterministically", () => {
    expect(evidenceStrengthFromSignals({ evidence_refs: ["e1", "e2", "e3"], supporting_signals: 2 })).toBe("strong");
    expect(evidenceStrengthFromSignals({ evidence_refs: ["e1", "e2"], supporting_signals: 1 })).toBe("moderate");
    expect(evidenceStrengthFromSignals({ evidence_refs: ["e1"], supporting_signals: 0 })).toBe("weak");
    expect(evidenceStrengthFromSignals({ evidence_refs: [], supporting_signals: 0 })).toBe("none");
  });

  it("detects semantic and missing-critical red flags", () => {
    const redFlags = detectDeepDiveContradictionsV1({
      report: {
        structured_summary: {
          business_model: { value: "Marketplace" },
          revenue: { value: { amount: 1_000_000 } },
        },
      },
      orchestrator_report: {
        segments: {
          product_profile_v1: { product_type: "SaaS" },
          financial: { benchmarks: [] },
          risk_verification: { data_issues: { conflicts: [] } },
        },
      },
      missing_critical_facts: ["growth"],
    });

    expect(redFlags.some((flag) => flag.contradiction_type === "semantic_divergence")).toBe(true);
    expect(redFlags.some((flag) => flag.contradiction_type === "missing_critical")).toBe(true);
  });

  it("prioritizes and deduplicates open questions", () => {
    const prioritized = prioritizeDeepDiveQuestionsV1({
      missing_critical_facts: ["raise", "growth"],
      verification_requests: ["Verify customer concentration"],
      diligence_open_items: ["Verify customer concentration"],
      executive_open_questions: ["What is the moat?"],
    });

    expect(prioritized.length).toBeGreaterThan(0);
    expect(prioritized[0].priority).toBe("p0");
    expect(prioritized.some((q) => q.question === "Verify customer concentration")).toBe(true);
    expect(prioritized.filter((q) => q.question === "Verify customer concentration")).toHaveLength(1);
  });
});
