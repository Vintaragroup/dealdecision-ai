import { inferMarketAccessibilitySignalProfileV1 } from "../market-accessibility-signal-profile";

describe("MarketAccessibilitySignalProfileV1", () => {
  it("uses allowlist fact types for ICP/distribution/wedge (no heuristic)", () => {
    const out = inferMarketAccessibilitySignalProfileV1({
      structured_summary: {
        customers: { value: null },
        go_to_market: null,
        market: {},
      },
      promoted_facts: [
        { fact_type: "icp_v1", content_json: { value_json: { display: "ICP: mid-market retailers" } } },
        { fact_type: "distribution_channel_v1", content_json: { value_json: { display: "Channel partnerships" } } },
        { fact_type: "wedge_strategy_v1", content_json: { value_json: { display: "Beachhead: Shopify apps" } } },
      ],
    });

    expect(out.icp_defined).toBe(true);
    expect(out.distribution_channel_defined).toBe(true);
    expect(out.wedge_defined).toBe(true);

    const heuristic = out.signals.find((s) => s.code === "heuristic_fact_type_match")?.present;
    expect(heuristic).toBe(false);
  });

  it("uses heuristic only when no allowlist matches (unknown version bump)", () => {
    const out = inferMarketAccessibilitySignalProfileV1({
      structured_summary: { customers: { value: null }, go_to_market: null, market: {} },
      promoted_facts: [
        { fact_type: "icp_v2", content_json: { value_json: { display: "ICP v2" } } },
      ],
    });

    expect(out.icp_defined).toBe(true);
    expect(out.distribution_channel_defined).toBe(false);
    expect(out.wedge_defined).toBe(false);

    const heuristic = out.signals.find((s) => s.code === "heuristic_fact_type_match")?.present;
    expect(heuristic).toBe(true);
  });

  it("does not use heuristic when any allowlist match exists", () => {
    const out = inferMarketAccessibilitySignalProfileV1({
      structured_summary: { customers: { value: null }, go_to_market: null, market: {} },
      promoted_facts: [
        { fact_type: "icp_v1", content_json: { value_json: { display: "ICP v1" } } },
        { fact_type: "icp_v2", content_json: { value_json: { display: "ICP v2" } } },
      ],
    });

    expect(out.icp_defined).toBe(true);

    const heuristic = out.signals.find((s) => s.code === "heuristic_fact_type_match")?.present;
    expect(heuristic).toBe(false);
  });

  it("does not false-positive on unrelated known fact types", () => {
    const out = inferMarketAccessibilitySignalProfileV1({
      structured_summary: { customers: { value: null }, go_to_market: null, market: {} },
      promoted_facts: [
        { fact_type: "revenue_v1", content_json: { value_json: { display: "$1M ARR" } } },
      ],
    });

    expect(out.icp_defined).toBe(false);
    expect(out.distribution_channel_defined).toBe(false);
    expect(out.wedge_defined).toBe(false);

    const heuristic = out.signals.find((s) => s.code === "heuristic_fact_type_match")?.present;
    expect(heuristic).toBe(false);
  });
});
