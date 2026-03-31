/**
 * Unit tests for compute-ors.ts scoring functions
 *
 * Regression anchor: 2026-03-30 scoring calibration (Fix D)
 * Fix D: when market_score_raw === 0, computeMarketScorePersisted returns 0.
 * DCI smoothing floor is NOT applied for zero-raw-signal deals.
 *
 * Also covers:
 * - Non-zero raw scores still receive DCI blending (existing formula preserved)
 * - computeMarketScoreRaw field coverage
 * - computeOverallRecommendationScore proxy logic
 */

import { describe, it, expect } from "vitest";
import {
  computeMarketScorePersisted,
  computeMarketScoreRaw,
  computeOverallRecommendationScore,
} from "../compute-ors.js";
import type { OrsInputs } from "../compute-ors.js";

// ─── Fix D: computeMarketScorePersisted ──────────────────────────────────────

describe("computeMarketScorePersisted — Fix D", () => {

  // D1 — Raw = 0, DCI = 80 → 0 (previously returned 12)
  it("D1: raw=0, dci=80 → 0 [Fix D: no DCI floor for zero-signal deals]", () => {
    expect(computeMarketScorePersisted(0, 80)).toBe(0);
  });

  // D2 — Raw = 0, DCI = 100 → 0 (any DCI value: floor removed)
  it("D2: raw=0, dci=100 → 0 (DCI does not matter when raw=0)", () => {
    expect(computeMarketScorePersisted(0, 100)).toBe(0);
  });

  // D3 — Raw = 0, DCI = 0 → 0
  it("D3: raw=0, dci=0 → 0", () => {
    expect(computeMarketScorePersisted(0, 0)).toBe(0);
  });

  // D4 — Non-zero raw: existing formula preserved. raw=30, dci=80
  // Expected: round(0.85*30 + 0.15*80) = round(25.5 + 12) = round(37.5) = 38
  it("D4: raw=30, dci=80 → 38 (existing formula unchanged for non-zero raw)", () => {
    expect(computeMarketScorePersisted(30, 80)).toBe(38);
  });

  // D5 — Non-zero raw with DCI=0
  // Expected: round(0.85*55 + 0.15*0) = round(46.75) = 47
  it("D5: raw=55, dci=0 → 47", () => {
    expect(computeMarketScorePersisted(55, 0)).toBe(47);
  });

  // D6 — High raw score: clamp ceiling
  // round(0.85*100 + 0.15*100) = 100
  it("D6: raw=100, dci=100 → 100 (ceiling clamp)", () => {
    expect(computeMarketScorePersisted(100, 100)).toBe(100);
  });

  // D7 — Anchor Vermont: raw=0, dci=80 → 0 (was 12 before Fix D)
  it("D7: anchor Vermont — raw=0, dci=80 → 0 (was 12, Fix D corrects)", () => {
    expect(computeMarketScorePersisted(0, 80)).toBe(0);
  });

  // D8 — Anchor 3ICE: raw=0, dci=80 → 0 (was 12 before Fix D)
  it("D8: anchor 3ICE — raw=0, dci=80 → 0 (was 12, Fix D corrects)", () => {
    expect(computeMarketScorePersisted(0, 80)).toBe(0);
  });

  // D9 — Boundary: raw=1 → DCI blending resumes
  // round(0.85*1 + 0.15*80) = round(0.85 + 12) = round(12.85) = 13
  it("D9: raw=1 (minimum non-zero) → DCI blending applied, not 0", () => {
    expect(computeMarketScorePersisted(1, 80)).toBeGreaterThan(0);
    expect(computeMarketScorePersisted(1, 80)).toBe(13);
  });

  // D10 — ORS impact for Vermont-style deal: market contributes 0.35 * 0 = 0 instead of 0.35 * 12 = 4.2
  it("D10: ORS Vermont-style — market=0, financial proxy active, URSS=35, DCI=80", () => {
    const result = computeOverallRecommendationScore({
      market_score_persisted: computeMarketScorePersisted(0, 80), // 0 after Fix D
      fhc_score: null,
      fhc_status: "insufficient_data",
      urss: 35,
      dci: 80,
      deck_has_strong_financial_signals: false,
    });
    // proxy = round(0.6*80 + 0.4*65) = round(48+26) = 74
    // ORS = round(0.35*0 + 0.30*74 + 0.25*65 + 0.10*80)
    //     = round(0 + 22.2 + 16.25 + 8) = round(46.45) = 46
    // (Before Fix D: ORS = round(0.35*12 + ...) = round(4.2+22.2+16.25+8) = 51)
    expect(result.ors).toBe(46);
    // Verify market inputs drove the change
    expect(computeMarketScorePersisted(0, 80)).toBe(0);
  });
});

// ─── computeMarketScoreRaw: field coverage ────────────────────────────────────

describe("computeMarketScoreRaw", () => {
  it("returns 0 when no computable fields", () => {
    const result = computeMarketScoreRaw([]);
    expect(result.market_score_raw).toBe(0);
    expect(result.missing_inputs.length).toBeGreaterThan(0);
  });

  it("returns 100 when all signals computable (TAM+SAM+SOM+ARR+revenue+growth+customers)", () => {
    const result = computeMarketScoreRaw([
      { field: "tam_value", computability: "Computable" },
      { field: "sam_value", computability: "Computable" },
      { field: "som_value", computability: "Computable" },
      { field: "arr_value", computability: "Computable" },
      { field: "revenue_value", computability: "Computable" },
      { field: "growth_rate", computability: "Computable" },
      { field: "customer_count", computability: "Computable" },
    ]);
    expect(result.market_score_raw).toBe(100);
    expect(result.missing_inputs).toHaveLength(0);
  });

  it("TAM alone = 20", () => {
    const result = computeMarketScoreRaw([
      { field: "tam_value", computability: "Computable" },
    ]);
    expect(result.market_score_raw).toBe(20);
  });

  it("MRR counts as ARR slot (not double-counted)", () => {
    const result = computeMarketScoreRaw([
      { field: "mrr_value", computability: "Computable" },
      { field: "arr_value", computability: "Computable" },
    ]);
    // both present → ARR slot = 15 (only credited once), no double-count
    expect(result.market_score_raw).toBe(15);
  });
});

// ─── computeOverallRecommendationScore proxy logic ────────────────────────────

describe("computeOverallRecommendationScore — financial proxy behavior", () => {
  function baseOrsInputs(overrides: Partial<OrsInputs> = {}): OrsInputs {
    return {
      market_score_persisted: 40,
      fhc_score: null,
      fhc_status: "insufficient_data",
      urss: 30,
      dci: 75,
      deck_has_strong_financial_signals: false,
      ...overrides,
    };
  }

  it("uses proxy when fhc_score is null", () => {
    const result = computeOverallRecommendationScore(baseOrsInputs({ fhc_score: null }));
    expect(result.financial_proxy_used).toBe(true);
  });

  it("uses proxy when fhc_status is insufficient_data (even if score non-null)", () => {
    const result = computeOverallRecommendationScore(
      baseOrsInputs({ fhc_status: "insufficient_data", fhc_score: 50 })
    );
    expect(result.financial_proxy_used).toBe(true);
  });

  it("uses proxy when fhc_is_deck_only_fsi=true", () => {
    const result = computeOverallRecommendationScore(
      baseOrsInputs({ fhc_score: 30, fhc_status: "ok", fhc_is_deck_only_fsi: true })
    );
    expect(result.financial_proxy_used).toBe(true);
  });

  it("uses real FHC when fhc_status=ok and not deck-only", () => {
    const result = computeOverallRecommendationScore(
      baseOrsInputs({ fhc_score: 55, fhc_status: "ok", fhc_is_deck_only_fsi: false })
    );
    expect(result.financial_proxy_used).toBe(false);
    expect(result.financial_proxy_value).toBe(55);
  });

  it("ORS is always 0-100", () => {
    const extremeHigh = computeOverallRecommendationScore(
      baseOrsInputs({ market_score_persisted: 100, fhc_score: 100, fhc_status: "ok", urss: 0, dci: 100 })
    );
    const extremeLow = computeOverallRecommendationScore(
      baseOrsInputs({ market_score_persisted: 0, urss: 100, dci: 0 })
    );
    expect(extremeHigh.ors).toBeLessThanOrEqual(100);
    expect(extremeLow.ors).toBeGreaterThanOrEqual(0);
  });
});
