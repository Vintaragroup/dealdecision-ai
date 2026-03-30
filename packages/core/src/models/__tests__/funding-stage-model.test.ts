import { inferFundingStageModelV1 } from "../funding-stage-model";

describe("FundingStageModel v1", () => {
  it("roundLabel = 'Series A' -> series_a (confidence high)", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: "Series A",
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
    });

    expect(out.funding_stage).toBe("series_a");
    expect(out.confidence).toBeGreaterThanOrEqual(0.6);
    expect(out.signals.map((s) => s.label)).toContain("funding_round_label:series_a");
  });

  it("raiseAmount = 2_000_000 without labels -> unknown (conservative)", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: 2_000_000,
      raise_sources: null,
    });

    expect(out.funding_stage).toBe("unknown");
    expect(out.confidence).toBeCloseTo(0.3, 6);
    expect(out.signals.map((s) => s.label)).toContain("raise_amount_band:seed");
    expect(out.notes ?? []).toContain("raise_amount_only_signal");
  });

  it("raiseAmount = 800_000 without labels -> unknown (conservative)", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: 800_000,
      raise_sources: null,
    });

    expect(out.funding_stage).toBe("unknown");
    expect(out.signals.map((s) => s.label)).toContain("raise_amount_band:pre_seed");
    expect(out.notes ?? []).toContain("raise_amount_only_signal");
  });

  it("roundLabel = 'Series A', raiseAmount = 1_000_000 -> conflict -> unknown", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: "Series A",
      company_phase_label: null,
      raise_amount: 1_000_000,
      raise_sources: null,
    });

    expect(out.funding_stage).toBe("unknown");
    expect(out.confidence).toBeLessThanOrEqual(0.6);
    expect(out.notes ?? []).toContain("conflicting_signals");
  });

  it("no inputs -> unknown, low confidence", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
    });

    expect(out.funding_stage).toBe("unknown");
    expect(out.confidence).toBe(0);
    expect(out.signals).toEqual([]);
  });
});
