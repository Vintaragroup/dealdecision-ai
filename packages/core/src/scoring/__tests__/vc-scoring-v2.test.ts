import {
  computeVCScoringV2,
  type VCScoringV2Inputs,
} from "../vc-scoring-v2";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInputs(overrides: Partial<VCScoringV2Inputs> = {}): VCScoringV2Inputs {
  return {
    market_score_raw: 50,
    dimension_scores: {
      solution_product: 50,
      problem_clarity: 50,
      team: 50,
      traction: 50,
      business_model: 50,
    },
    gtm_signal: { present: true, confidence: 0.6 },
    traction_signals: {
      tam_present: true,
      growth_rate_present: false,
      arr_or_mrr_present: false,
      revenue_present: true,
    },
    dci_score: 60,
    fhc_score: 55,
    fhc_status: "ok",
    fhc_has_structured_sources: true,
    reconciliation_confidence: 0.65,
    kpi_count: 2,
    kpi_avg_confidence: 0.65,
    extraction_modifier: 1.0,
    conflict_count: 1,
    urss_components: {
      transparency: 30,
      consistency: 25,
      coverage: 20,
      financial_reliability: 30,
      gate: 20,
    },
    team_penalty_codes: [],
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("computeVCScoringV2", () => {
  // ── Test 1: high opportunity + low confidence → INVESTIGATE ─────────────
  it("returns INVESTIGATE when opportunity is high but confidence is low", () => {
    const inputs = makeInputs({
      // High opportunity: all dimensions strong, all traction signals present
      market_score_raw: 85,
      dimension_scores: {
        solution_product: 88,
        problem_clarity: 82,
        team: 80,
        traction: 87,
        business_model: 82,
      },
      gtm_signal: { present: true, confidence: 0.85 },
      traction_signals: {
        tam_present: true,
        growth_rate_present: true,
        arr_or_mrr_present: true,
        revenue_present: true,
      },
      // Low confidence: poor document coverage, no KPIs, no XLSX financials
      dci_score: 18,
      fhc_score: null,
      fhc_status: "insufficient_data",
      fhc_has_structured_sources: false,
      reconciliation_confidence: null,
      kpi_count: 0,
      kpi_avg_confidence: 0,
      extraction_modifier: 0.85,
      conflict_count: 3,
      // Low-severity risk so opportunity clearly dominates
      urss_components: {
        transparency: 20,
        consistency: 15,
        coverage: 10,
        financial_reliability: 25,
        gate: 10,
      },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    expect(result.opportunity_score).toBeGreaterThanOrEqual(60);
    expect(result.confidence_score).toBeLessThan(45);
    expect(result.investment_posture).toBe("INVESTIGATE");
  });

  // ── Test 2: high opportunity + high confidence + low risk → HIGH_PRIORITY_DILIGENCE ─
  it("returns HIGH_PRIORITY_DILIGENCE when opportunity strong, confidence adequate, risk manageable", () => {
    const inputs = makeInputs({
      // Good opportunity — above 60 but intentionally below 75 to avoid INVESTABLE
      market_score_raw: 60,
      dimension_scores: {
        solution_product: 70,
        problem_clarity: 65,
        team: 68,
        traction: 72,
        business_model: 66,
      },
      gtm_signal: { present: true, confidence: 0.7 },
      traction_signals: {
        tam_present: true,
        growth_rate_present: true,
        arr_or_mrr_present: false,
        revenue_present: true,
      },
      // Adequate confidence
      dci_score: 70,
      fhc_score: 65,
      fhc_status: "ok",
      fhc_has_structured_sources: true,
      reconciliation_confidence: 0.70,
      kpi_count: 3,
      kpi_avg_confidence: 0.72,
      extraction_modifier: 1.03,
      conflict_count: 1,
      // Manageable risk
      urss_components: {
        transparency: 32,
        consistency: 28,
        coverage: 22,
        financial_reliability: 38,
        gate: 18,
      },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    expect(result.opportunity_score).toBeGreaterThanOrEqual(60);
    expect(result.opportunity_score).toBeLessThan(75); // below INVESTABLE floor
    expect(result.confidence_score).toBeGreaterThanOrEqual(45);
    expect(result.risk_score).toBeLessThan(55);
    expect(result.investment_posture).toBe("HIGH_PRIORITY_DILIGENCE");
  });

  // ── Test 3: elite profile → INVESTABLE ──────────────────────────────────
  it("returns INVESTABLE when all three axes are elite", () => {
    const inputs = makeInputs({
      // Elite opportunity
      market_score_raw: 92,
      dimension_scores: {
        solution_product: 92,
        problem_clarity: 88,
        team: 90,
        traction: 94,
        business_model: 88,
      },
      gtm_signal: { present: true, confidence: 0.95 },
      traction_signals: {
        tam_present: true,
        growth_rate_present: true,
        arr_or_mrr_present: true,
        revenue_present: true,
      },
      // Elite confidence
      dci_score: 92,
      fhc_score: 88,
      fhc_status: "ok",
      fhc_has_structured_sources: true,
      reconciliation_confidence: 0.92,
      kpi_count: 6,
      kpi_avg_confidence: 0.92,
      extraction_modifier: 1.14,
      conflict_count: 0,
      // Low risk
      urss_components: {
        transparency: 8,
        consistency: 6,
        coverage: 5,
        financial_reliability: 10,
        gate: 8,
      },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    expect(result.opportunity_score).toBeGreaterThanOrEqual(75);
    expect(result.confidence_score).toBeGreaterThanOrEqual(65);
    expect(result.risk_score).toBeLessThan(35);
    expect(result.vc_composite_score).toBeGreaterThanOrEqual(72);
    expect(result.investment_posture).toBe("INVESTABLE");
  });

  // ── Test 4: low opportunity → PASS ──────────────────────────────────────
  it("returns PASS when opportunity is below threshold regardless of other signals", () => {
    const inputs = makeInputs({
      // Minimal market: only one field present
      market_score_raw: 10,
      dimension_scores: {
        solution_product: 25,
        problem_clarity: 22,
        team: 30,
        traction: 20,
        business_model: 28,
      },
      gtm_signal: { present: false, confidence: 0 },
      traction_signals: {
        tam_present: false,
        growth_rate_present: false,
        arr_or_mrr_present: false,
        revenue_present: false,
      },
      // High confidence wouldn't matter — but set it high to prove PASS is opportunity-driven
      dci_score: 90,
      fhc_score: 85,
      fhc_status: "ok",
      fhc_has_structured_sources: true,
      reconciliation_confidence: 0.90,
      kpi_count: 5,
      kpi_avg_confidence: 0.90,
      extraction_modifier: 1.12,
      conflict_count: 0,
      urss_components: {
        transparency: 5,
        consistency: 5,
        coverage: 5,
        financial_reliability: 5,
        gate: 0,
      },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    expect(result.opportunity_score).toBeLessThan(35);
    expect(result.investment_posture).toBe("PASS");
  });

  // ── Test 5: all outputs clamped to [0, 100] ──────────────────────────────
  it("clamps all scores to [0, 100] with extreme inputs", () => {
    // Pass extreme / out-of-range values that should all be handled gracefully
    const inputs = makeInputs({
      market_score_raw: 999,     // should clamp to 100
      dimension_scores: {
        solution_product: -50,   // negative → treated as very low
        problem_clarity: 200,    // over 100 → clamp to 100
        team: -10,
        traction: 150,
        business_model: -999,
      },
      gtm_signal: { present: true, confidence: 5 },  // confidence > 1, clamp to 1
      kpi_count: -5,             // negative → treated as 0
      kpi_avg_confidence: 10,    // > 1 after clamp01
      extraction_modifier: 5,    // >> 1.15, clamp to 1.15
      conflict_count: -2,        // negative, treated as 0
      urss_components: {
        transparency: 200,       // >> 100
        consistency: -10,
        coverage: 999,
        financial_reliability: -50,
        gate: 200,
      },
      team_penalty_codes: ["no_founder", "no_technical_lead", "no_gtm_lead", "no_domain_experience"],
    });

    const result = computeVCScoringV2(inputs);

    // All top-level scores must be in [0, 100]
    expect(result.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(result.opportunity_score).toBeLessThanOrEqual(100);
    expect(result.confidence_score).toBeGreaterThanOrEqual(0);
    expect(result.confidence_score).toBeLessThanOrEqual(100);
    expect(result.risk_score).toBeGreaterThanOrEqual(0);
    expect(result.risk_score).toBeLessThanOrEqual(100);
    expect(result.vc_composite_score).toBeGreaterThanOrEqual(0);
    expect(result.vc_composite_score).toBeLessThanOrEqual(100);

    // All breakdown components must be in [0, 100]
    for (const val of Object.values(result.breakdown.opportunity)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
    for (const val of Object.values(result.breakdown.confidence)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
    for (const val of Object.values(result.breakdown.risk)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }

    // All scores must be integers
    expect(Number.isInteger(result.opportunity_score)).toBe(true);
    expect(Number.isInteger(result.confidence_score)).toBe(true);
    expect(Number.isInteger(result.risk_score)).toBe(true);
    expect(Number.isInteger(result.vc_composite_score)).toBe(true);
  });

  // ── Additional: reasoning array is always non-empty ──────────────────────
  it("always produces at least one reasoning bullet", () => {
    const result = computeVCScoringV2(makeInputs());
    expect(result.reasoning).toBeInstanceOf(Array);
    expect(result.reasoning.length).toBeGreaterThanOrEqual(1);
    for (const bullet of result.reasoning) {
      expect(typeof bullet).toBe("string");
      expect(bullet.trim().length).toBeGreaterThan(0);
    }
  });

  // ── Additional: MONITOR for moderate opportunity ─────────────────────────
  it("returns MONITOR when opportunity is moderate and confidence is decent", () => {
    const inputs = makeInputs({
      market_score_raw: 45,
      dimension_scores: {
        solution_product: 55,
        problem_clarity: 50,
        team: 52,
        traction: 48,
        business_model: 50,
      },
      gtm_signal: { present: true, confidence: 0.5 },
      traction_signals: {
        tam_present: true,
        growth_rate_present: false,
        arr_or_mrr_present: false,
        revenue_present: true,
      },
      dci_score: 55,
      fhc_score: 52,
      fhc_status: "ok",
      fhc_has_structured_sources: true,
      reconciliation_confidence: 0.55,
      kpi_count: 1,
      kpi_avg_confidence: 0.6,
      extraction_modifier: 0.98,
      conflict_count: 2,
      urss_components: {
        transparency: 40,
        consistency: 35,
        coverage: 30,
        financial_reliability: 35,
        gate: 20,
      },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    expect(result.opportunity_score).toBeGreaterThanOrEqual(35);
    expect(result.opportunity_score).toBeLessThan(60);
    expect(result.investment_posture).toBe("MONITOR");
  });

  // ── Additional: composite formula math is exact ──────────────────────────
  it("composite score equals the correct weighted formula", () => {
    const result = computeVCScoringV2(makeInputs());
    const { opportunity_score, confidence_score, risk_score, vc_composite_score } = result;
    const expected = Math.round(
      0.50 * opportunity_score +
      0.25 * confidence_score +
      0.25 * (100 - risk_score)
    );
    expect(vc_composite_score).toBe(expected);
  });

  // ── Inference: strong signals with null dimension scores → boosted opp ───
  // A deal that looks weak structurally (null dimensions) but has strong
  // commercial signals must score higher than the raw penalty floor.
  it("inference boosts opportunity when signals are strong but dimension scores are null", () => {
    const inputs = makeInputs({
      // Null all dimension scores — simulates orchestrator pipeline output
      // with no structured KPI extraction (no XLSX)
      dimension_scores: {
        solution_product: null,
        problem_clarity: null,
        team: null,
        traction: null,
        business_model: null,
      },
      market_score_raw: 55,
      // Strong commercial traction signals
      traction_signals: {
        revenue_present: true,
        arr_or_mrr_present: true,
        growth_rate_present: true,
        tam_present: false,
      },
      gtm_signal: { present: true, confidence: 0.71 },
      team_penalty_codes: [],
    });

    const withoutInference = makeInputs({
      // Same signals but same null dimensions — pre-inference baseline was ~46
      dimension_scores: {
        solution_product: null,
        problem_clarity: null,
        team: null,
        traction: null,
        business_model: null,
      },
    });

    const result = computeVCScoringV2(inputs);
    const baseline = computeVCScoringV2(withoutInference);

    // Inference should lift opportunity materially above the null-penalty floor
    expect(result.opportunity_score).toBeGreaterThan(baseline.opportunity_score);
    // With strong revenue+ARR+growth+GTM, opportunity should reach at least 55
    expect(result.opportunity_score).toBeGreaterThanOrEqual(55);
    // Inference traces should show boosted=true on at least product and traction
    expect(result.inference.product.boosted).toBe(true);
    expect(result.inference.traction.boosted).toBe(true);
  });

  // ── Inference: no commercial signals → no material boost ─────────────────
  it("inference does not boost opportunity when no commercial signals exist", () => {
    const inputs = makeInputs({
      dimension_scores: {
        solution_product: null,
        problem_clarity: null,
        team: null,
        traction: null,
        business_model: null,
      },
      market_score_raw: 30,
      traction_signals: {
        revenue_present: false,
        arr_or_mrr_present: false,
        growth_rate_present: false,
        tam_present: false,
      },
      gtm_signal: { present: false, confidence: 0 },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    // Without any signals, inference should not push above 45
    expect(result.opportunity_score).toBeLessThan(46);
    // Product and traction inference traces should not be boosted above base floors
    expect(result.inference.product.boosted).toBe(false);
    expect(result.inference.traction.boosted).toBe(false);
    // Market should not boost beyond base because no traction signals
    expect(result.inference.market.boosted).toBe(false);
  });

  // ── Inference: team penalty codes still penalize neutral-floor team ───────
  it("inference applies team penalty codes even when no structured team score exists", () => {
    const inputsNoPenalty = makeInputs({
      dimension_scores: { ...makeInputs().dimension_scores, team: null },
      team_penalty_codes: [],
    });
    const inputsWithPenalty = makeInputs({
      dimension_scores: { ...makeInputs().dimension_scores, team: null },
      team_penalty_codes: ["no_founder"],
    });

    const resultNoPenalty = computeVCScoringV2(inputsNoPenalty);
    const resultWithPenalty = computeVCScoringV2(inputsWithPenalty);

    // no_founder is a severe penalty — team trace should reflect lower score
    expect(resultWithPenalty.inference.team.inferred_score).toBeLessThan(
      resultNoPenalty.inference.team.inferred_score
    );
    // The penalty should drive opportunity down (or at least not up)
    expect(resultWithPenalty.opportunity_score).toBeLessThanOrEqual(
      resultNoPenalty.opportunity_score
    );
  });

  // ── Inference: inference score never exceeds 95 cap ──────────────────────
  it("inference final scores are capped and never produce scores above 95", () => {
    const inputs = makeInputs({
      dimension_scores: {
        solution_product: null,
        problem_clarity: null,
        team: null,
        traction: null,
        business_model: null,
      },
      market_score_raw: 80,
      traction_signals: {
        revenue_present: true,
        arr_or_mrr_present: true,
        growth_rate_present: true,
        tam_present: true,
      },
      gtm_signal: { present: true, confidence: 0.99 },
      team_penalty_codes: [],
    });

    const result = computeVCScoringV2(inputs);

    // Each inference trace final_score must honor the cap
    for (const trace of Object.values(result.inference)) {
      expect(trace.final_score).toBeLessThanOrEqual(95);
      // Also verify inferred_score is a valid number
      expect(typeof trace.inferred_score).toBe("number");
      expect(isNaN(trace.inferred_score)).toBe(false);
    }
    // Inference output shape: all four dimensions present
    expect(result.inference).toHaveProperty("market");
    expect(result.inference).toHaveProperty("product");
    expect(result.inference).toHaveProperty("team");
    expect(result.inference).toHaveProperty("traction");
  });

  // ── Inference: return type includes inference field with correct shape ────
  it("result always includes an inference object with the correct shape", () => {
    const result = computeVCScoringV2(makeInputs());

    expect(result).toHaveProperty("inference");
    const { market, product, team, traction } = result.inference;
    for (const trace of [market, product, team, traction]) {
      expect(typeof trace.boosted).toBe("boolean");
      expect(typeof trace.inferred_score).toBe("number");
      expect(typeof trace.final_score).toBe("number");
      expect(Array.isArray(trace.reasons)).toBe(true);
      expect(trace.reasons.length).toBeGreaterThan(0);
    }
  });
});
