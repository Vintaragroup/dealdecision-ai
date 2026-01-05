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

  it("is non-neutral for execution_ready_v1 readiness signals without revenue", async () => {
    const text = "Pre-revenue. Signed LOI with distribution partner. Launch in 3 months. Pipeline $750K.";

    const result = await metricBenchmarkValidator.analyze({
      text,
      industry: "cpg",
      policy_id: "execution_ready_v1",
      evidence_ids: [],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score).not.toBe(50);

    const hasPolicyBench = (result.metrics_analyzed || []).some((m: any) => typeof m?.benchmark_source === "string" && m.benchmark_source.startsWith("policy:execution_ready_v1:"));
    expect(hasPolicyBench).toBe(true);
  });
});
