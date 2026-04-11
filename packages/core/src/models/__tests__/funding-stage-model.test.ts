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

  // ── RC-004: IPO / public_company via doc type hints ────────────────────

  it("RC-004: sec_filing_s1 hint -> ipo, confidence 0.9", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["sec_filing_s1"],
    });

    expect(out.funding_stage).toBe("ipo");
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.signals.some((s) => s.label === "sec_filing_s1_detected")).toBe(true);
  });

  it("RC-004: sec_filing_s1 hint only (no 10-K) -> ipo", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["sec_filing_s1"],
    });

    // No 10-K present, so S-1 wins -> ipo
    expect(out.funding_stage).toBe("ipo");
  });

  it("RC-004: 10-K beats S-1 when both present (annual filer priority)", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["sec_filing_s1", "sec_filing_10k"],
    });

    // 10-K takes priority over S-1 — already-public annual filings win
    expect(out.funding_stage).toBe("public_company");
  });

  it("RC-004: sec_filing_10k hint -> public_company", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["sec_filing_10k"],
    });

    expect(out.funding_stage).toBe("public_company");
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.signals.some((s) => s.label === "sec_filing_10k_detected")).toBe(true);
  });

  it("RC-004: sec_filing_10q hint -> public_company", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["sec_filing_10q"],
    });

    expect(out.funding_stage).toBe("public_company");
    expect(out.signals.some((s) => s.label === "sec_filing_10q_detected")).toBe(true);
  });

  it("RC-004: sec_filing_8k hint -> public_company", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: null,
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["sec_filing_8k"],
    });

    expect(out.funding_stage).toBe("public_company");
    expect(out.confidence).toBeCloseTo(0.85);
    expect(out.signals.some((s) => s.label === "sec_filing_8k_detected")).toBe(true);
  });

  it("RC-004: SEC hint overrides label signals (S-1 beats 'pre-seed' label)", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: "seed",
      company_phase_label: "pre-seed",
      raise_amount: 500_000,
      raise_sources: null,
      doc_type_hints: ["sec_filing_s1"],
    });

    // S-1 signals IPO regardless of label-based signals
    expect(out.funding_stage).toBe("ipo");
  });

  it("RC-004: empty doc_type_hints array falls back to label/raise logic", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: "Series A",
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: [],
    });

    expect(out.funding_stage).toBe("series_a");
  });

  it("RC-004: non-SEC doc_type_hints (pitch_deck) falls back to label logic", () => {
    const out = inferFundingStageModelV1({
      funding_round_label: "seed",
      company_phase_label: null,
      raise_amount: null,
      raise_sources: null,
      doc_type_hints: ["pitch_deck"],
    });

    expect(out.funding_stage).toBe("seed");
  });
});
