import { metricBenchmarkValidator } from "../metric-benchmark";

function ltvOnlyText(): string {
  return "LTV: 75%";
}

describe("MetricBenchmarkValidator policy routing", () => {
  it("is neutral (50) for RE metrics without RE policy", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: ltvOnlyText(),
      industry: "real estate",
      evidence_ids: [],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.overall_score).toBe(50);
  });

  it("is non-neutral for RE metrics with real_estate_underwriting policy", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: ltvOnlyText(),
      industry: "real estate",
      policy_id: "real_estate_underwriting",
      evidence_ids: [],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score).not.toBe(50);

    expect(Array.isArray(result.metrics_analyzed)).toBe(true);
    expect(result.metrics_analyzed.length).toBeGreaterThan(0);
    expect(result.metrics_analyzed[0].metric).toBe("ltv");
    expect(result.metrics_analyzed[0].benchmark_source.startsWith("policy:")).toBe(true);
    expect(result.metrics_analyzed[0].benchmark_source).not.toBe("No benchmark available");
    expect(result.metrics_analyzed[0].rating).not.toBe("Missing");
  });
});
