/**
 * Tests — Decision Memory: Influence Service
 * Pure functions only (no DB).
 *
 * Covers:
 *   A. No-memory cases (empty pool, too few neighbors, weak similarity)
 *   B. Supportive-memory cases (majority agree with current verdict)
 *   C. Contradictory-memory cases (majority oppose current verdict)
 *   D. Guardrails (bounds, no ORS mutation, no fake outcomes)
 */

import { describe, it, expect } from "vitest";
import {
  deriveMemoryInfluence,
  MEMORY_MIN_NEIGHBORS,
  MEMORY_MIN_AVG_SIMILARITY,
  MEMORY_MAX_CONFIDENCE_BOOST,
  MEMORY_MAX_CONFIDENCE_PENALTY,
} from "../decision-memory/influence.js";
import type { SimilarDeal } from "../decision-memory/types.js";
import { computeConfidence } from "../confidence-engine/service.js";
import type { ConfidenceInput } from "../confidence-engine/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDeal(
  id: string,
  verdict: string,
  ors: number,
  similarity_pct: number
): SimilarDeal {
  return {
    deal_id: id,
    distance: 1 - similarity_pct / 100,
    similarity_pct,
    match_reasons: ["similar ors_score"],
    score_snapshot: { ors, dci: 50, fhc: 30, urss: 0 },
    verdict,
    scoreband_key: ors >= 70 ? "strong" : ors >= 50 ? "mid" : "weak",
  };
}

function baseConfInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    deal_id: "deal-test",
    intelligence_run_id: "run-test",
    evidence_count: 12,
    contradiction_count: 0,
    dpu_provenance_missing: false,
    xlsx_extraction_had_llm_fallback: false,
    llm_cache_age_days: 3,
    financial_completeness_pct: 70,
    dci_score: 65,
    investor_insights_status: "complete",
    has_reconciliation_conflict: false,
    evaluator_error_count: 0,
    evaluator_critical_count: 0,
    arr_structured: 500_000,
    burn_rate_monthly: 50_000,
    ...overrides,
  };
}

// ─── A. No-memory cases ────────────────────────────────────────────────────

describe("deriveMemoryInfluence — no-memory cases", () => {
  it("returns zero influence when pool is empty", () => {
    const result = deriveMemoryInfluence([], "CONSIDER");
    expect(result.confidence_adjustment).toBe(0);
    expect(result.memory_support_signal).toBe(false);
    expect(result.memory_fragility_signal).toBe(false);
    expect(result.challenge_memory_used).toBe(false);
    expect(result.challenge_memory_summary).toBeNull();
    expect(result.confidence_adjustment_reason).toMatch(/no similar deals/i);
  });

  it("returns zero influence when pool has fewer than MEMORY_MIN_NEIGHBORS", () => {
    const tooFew: SimilarDeal[] = [];
    for (let i = 0; i < MEMORY_MIN_NEIGHBORS - 1; i++) {
      tooFew.push(makeDeal(`deal-0${i}`, "CONSIDER", 60, 80));
    }
    const result = deriveMemoryInfluence(tooFew, "CONSIDER");
    expect(result.confidence_adjustment).toBe(0);
    expect(result.memory_support_signal).toBe(false);
    expect(result.confidence_adjustment_reason).toMatch(/pool too small/i);
  });

  it("returns zero influence when average similarity is below threshold", () => {
    const weakSim = [
      makeDeal("deal-01", "CONSIDER", 60, MEMORY_MIN_AVG_SIMILARITY - 1),
      makeDeal("deal-02", "CONSIDER", 55, MEMORY_MIN_AVG_SIMILARITY - 1),
      makeDeal("deal-03", "CONSIDER", 58, MEMORY_MIN_AVG_SIMILARITY - 1),
    ];
    const result = deriveMemoryInfluence(weakSim, "CONSIDER");
    expect(result.confidence_adjustment).toBe(0);
    expect(result.memory_support_signal).toBe(false);
    expect(result.confidence_adjustment_reason).toMatch(/average similarity too low/i);
  });

  it("similar_deal_count reflects actual pool size even when influence is zero", () => {
    const result0 = deriveMemoryInfluence([], "CONSIDER");
    expect(result0.similar_deal_count).toBe(0);

    const result2 = deriveMemoryInfluence(
      [makeDeal("d1", "CONSIDER", 60, 80), makeDeal("d2", "CONSIDER", 55, 80)],
      "CONSIDER"
    );
    expect(result2.similar_deal_count).toBe(2);
  });

  it("returns targeted NO_GO reason when current verdict is not positive but pool is valid", () => {
    // 5 NO_GO neighbors at strong similarity — pool and similarity guards pass,
    // but the non-positive verdict guard fires and returns the targeted reason string.
    const validPool = [
      makeDeal("deal-01", "NO_GO", 20, 80),
      makeDeal("deal-02", "NO_GO", 18, 82),
      makeDeal("deal-03", "NO_GO", 22, 78),
      makeDeal("deal-04", "NO_GO", 17, 80),
      makeDeal("deal-05", "NO_GO", 19, 81),
    ];
    const result = deriveMemoryInfluence(validPool, "NO_GO");

    expect(result.confidence_adjustment).toBe(0);
    expect(result.memory_support_signal).toBe(false);
    expect(result.memory_fragility_signal).toBe(false);
    expect(result.challenge_memory_used).toBe(false);
    expect(result.challenge_memory_summary).toBeNull();

    // Targeted reason — must NOT say "inconclusive" (that path is for genuinely
    // mixed pools, not for non-positive verdicts)
    expect(result.confidence_adjustment_reason).not.toMatch(/inconclusive/i);
    expect(result.confidence_adjustment_reason).toMatch(/only applied to positive verdicts/i);
    expect(result.confidence_adjustment_reason).toMatch(/NO_GO/i);
  });
});

// ─── B. Supportive-memory cases ───────────────────────────────────────────

describe("deriveMemoryInfluence — supportive memory", () => {
  it("fires support signal when majority of neighbors match current CONSIDER", () => {
    const neighbors = [
      makeDeal("deal-01", "CONSIDER", 65, 75),
      makeDeal("deal-02", "CONSIDER", 70, 80),
      makeDeal("deal-03", "CONSIDER", 68, 72),
      makeDeal("deal-04", "NO_GO", 20, 70),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(result.memory_support_signal).toBe(true);
    expect(result.memory_fragility_signal).toBe(false);
    expect(result.confidence_adjustment).toBe(MEMORY_MAX_CONFIDENCE_BOOST);
    expect(result.confidence_adjustment_reason).toMatch(/confidence increased/i);
  });

  it("fires support signal for GO verdict with majority GO neighbors", () => {
    const neighbors = [
      makeDeal("deal-01", "GO", 80, 85),
      makeDeal("deal-02", "GO", 82, 88),
      makeDeal("deal-03", "GO", 79, 80),
    ];
    const result = deriveMemoryInfluence(neighbors, "GO");
    expect(result.memory_support_signal).toBe(true);
    expect(result.confidence_adjustment).toBe(MEMORY_MAX_CONFIDENCE_BOOST);
  });

  it("confidence engine applies memory boost correctly", () => {
    const neighbors = [
      makeDeal("deal-01", "CONSIDER", 65, 75),
      makeDeal("deal-02", "CONSIDER", 70, 80),
      makeDeal("deal-03", "CONSIDER", 68, 72),
    ];
    const influence = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(influence.confidence_adjustment).toBe(MEMORY_MAX_CONFIDENCE_BOOST);

    const base = computeConfidence(baseConfInput());
    const withMem = computeConfidence(baseConfInput({ memory_influence: influence }));
    expect(withMem.overall_confidence_score).toBe(
      Math.min(100, base.overall_confidence_score + MEMORY_MAX_CONFIDENCE_BOOST)
    );
    expect(withMem.memory_adjustment).toBe(MEMORY_MAX_CONFIDENCE_BOOST);
    expect(withMem.memory_adjustment_reason).toMatch(/confidence increased/i);
  });

  it("does NOT fire challenge memory for supportive case", () => {
    const neighbors = [
      makeDeal("deal-01", "CONSIDER", 65, 75),
      makeDeal("deal-02", "CONSIDER", 70, 80),
      makeDeal("deal-03", "CONSIDER", 68, 72),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(result.challenge_memory_used).toBe(false);
    expect(result.challenge_memory_summary).toBeNull();
  });
});

// ─── C. Contradictory-memory cases ────────────────────────────────────────

describe("deriveMemoryInfluence — contradictory memory (fragility signal)", () => {
  it("fires fragility signal when majority of neighbors are NO_GO but current is CONSIDER", () => {
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 18, 75),
      makeDeal("deal-02", "NO_GO", 22, 80),
      makeDeal("deal-03", "NO_GO", 15, 72),
      makeDeal("deal-04", "CONSIDER", 55, 70),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(result.memory_fragility_signal).toBe(true);
    expect(result.memory_support_signal).toBe(false);
    expect(result.confidence_adjustment).toBe(-MEMORY_MAX_CONFIDENCE_PENALTY);
    expect(result.confidence_adjustment_reason).toMatch(/confidence reduced/i);
  });

  it("fires challenge memory when fragility signal is active", () => {
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 18, 75),
      makeDeal("deal-02", "NO_GO", 22, 80),
      makeDeal("deal-03", "NO_GO", 15, 72),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(result.challenge_memory_used).toBe(true);
    expect(result.challenge_memory_summary).not.toBeNull();
    expect(result.challenge_memory_summary).toMatch(/NO_GO/i);
    expect(result.challenge_memory_summary).toMatch(/structural similarity/i);
  });

  it("challenge memory summary does NOT claim outcome data when none exists", () => {
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 18, 75),
      makeDeal("deal-02", "NO_GO", 22, 80),
      makeDeal("deal-03", "NO_GO", 15, 72),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    const summary = result.challenge_memory_summary ?? "";
    // Must not claim labeled outcomes are known (e.g. "confirmed failure", "known outcome",
    // "actual outcome verified"). Using "outcome" to *disclaim* is acceptable and expected.
    expect(summary).not.toMatch(/confirmed (failure|success)|known outcome|actual outcome|labeled outcome|verified outcome/i);
    // Must explicitly note this is structural similarity only
    expect(summary).toMatch(/structural similarity/i);
    // Must not assert an outcome happened — only verdicts were recorded
    expect(summary).not.toMatch(/failed|went bankrupt|shut down|exited/i);
  });

  it("confidence engine applies memory penalty correctly", () => {
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 18, 75),
      makeDeal("deal-02", "NO_GO", 22, 80),
      makeDeal("deal-03", "NO_GO", 15, 72),
    ];
    const influence = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(influence.confidence_adjustment).toBe(-MEMORY_MAX_CONFIDENCE_PENALTY);

    const base = computeConfidence(baseConfInput());
    const withMem = computeConfidence(baseConfInput({ memory_influence: influence }));
    expect(withMem.overall_confidence_score).toBe(
      Math.max(10, base.overall_confidence_score - MEMORY_MAX_CONFIDENCE_PENALTY)
    );
    expect(withMem.memory_adjustment).toBe(-MEMORY_MAX_CONFIDENCE_PENALTY);
    expect(withMem.memory_adjustment_reason).toMatch(/confidence reduced/i);
  });

  it("does NOT fire fragility signal for NO_GO current verdict (no positive verdict to contradict)", () => {
    // If current deal is already NO_GO, neighbors matching NO_GO are "supportive" not contradictory
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 18, 75),
      makeDeal("deal-02", "NO_GO", 22, 80),
      makeDeal("deal-03", "NO_GO", 15, 72),
    ];
    const result = deriveMemoryInfluence(neighbors, "NO_GO");
    expect(result.memory_fragility_signal).toBe(false);
    // No_GO current + NO_GO neighbors → no fragility, possible support
    expect(result.challenge_memory_used).toBe(false);
  });
});

// ─── D. Guardrails ────────────────────────────────────────────────────────

describe("deriveMemoryInfluence — guardrails", () => {
  it("adjustment is always within [-MEMORY_MAX_CONFIDENCE_PENALTY, +MEMORY_MAX_CONFIDENCE_BOOST]", () => {
    const testCases: Array<[SimilarDeal[], string]> = [
      // All NO_GO, max fragility
      [
        Array.from({ length: 5 }, (_, i) =>
          makeDeal(`ng-0${i}`, "NO_GO", 10 + i, 90)
        ),
        "CONSIDER",
      ],
      // All CONSIDER, max support
      [
        Array.from({ length: 5 }, (_, i) =>
          makeDeal(`co-0${i}`, "CONSIDER", 60 + i, 90)
        ),
        "CONSIDER",
      ],
      // Mixed
      [
        [
          makeDeal("d1", "NO_GO", 20, 75),
          makeDeal("d2", "CONSIDER", 55, 75),
          makeDeal("d3", "NO_GO", 18, 80),
        ],
        "CONSIDER",
      ],
    ];

    for (const [deals, verdict] of testCases) {
      const result = deriveMemoryInfluence(deals, verdict);
      expect(result.confidence_adjustment).toBeGreaterThanOrEqual(
        -MEMORY_MAX_CONFIDENCE_PENALTY
      );
      expect(result.confidence_adjustment).toBeLessThanOrEqual(
        MEMORY_MAX_CONFIDENCE_BOOST
      );
    }
  });

  it("memory influence never alters ORS in the influence summary itself", () => {
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 18, 75),
      makeDeal("deal-02", "NO_GO", 22, 80),
      makeDeal("deal-03", "NO_GO", 15, 72),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    // Influence summary has no ors_score field for the current deal —
    // it only tracks avg_neighbor_ors (read-only reference data)
    expect("ors_score" in result).toBe(false);
    expect(typeof result.avg_neighbor_ors).toBe("number");
  });

  it("confidence engine does NOT apply memory when memory_influence is null", () => {
    const base = computeConfidence(baseConfInput());
    const withNull = computeConfidence(baseConfInput({ memory_influence: null }));
    expect(withNull.overall_confidence_score).toBe(base.overall_confidence_score);
    expect(withNull.memory_adjustment).toBe(0);
    expect(withNull.memory_adjustment_reason).toMatch(/not provided/i);
  });

  it("confidence engine does NOT apply memory when memory_influence is undefined", () => {
    const base = computeConfidence(baseConfInput());
    const withUndefined = computeConfidence(baseConfInput());
    // Omitting memory_influence (undefined) must be identical to base
    expect(withUndefined.overall_confidence_score).toBe(base.overall_confidence_score);
    expect(withUndefined.memory_adjustment).toBe(0);
  });

  it("inconclusive neighbor mix produces zero adjustment with explanatory reason", () => {
    // 2 CONSIDER + 2 NO_GO + enough similarity: neither threshold is met for 4 neighbors
    // Agreement fraction = 0.5, below MEMORY_AGREEMENT_THRESHOLD (0.6)
    const neighbors = [
      makeDeal("deal-01", "CONSIDER", 60, 75),
      makeDeal("deal-02", "CONSIDER", 58, 72),
      makeDeal("deal-03", "NO_GO", 20, 76),
      makeDeal("deal-04", "NO_GO", 18, 73),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    expect(result.confidence_adjustment).toBe(0);
    expect(result.memory_support_signal).toBe(false);
    expect(result.memory_fragility_signal).toBe(false);
    expect(result.confidence_adjustment_reason).toMatch(/inconclusive/i);
  });

  it("neighbor_snapshots are ordered by descending similarity_pct", () => {
    const neighbors = [
      makeDeal("deal-01", "NO_GO", 20, 60),
      makeDeal("deal-02", "NO_GO", 22, 90),
      makeDeal("deal-03", "NO_GO", 18, 75),
    ];
    const result = deriveMemoryInfluence(neighbors, "CONSIDER");
    const pcts = result.neighbor_snapshots.map((n) => n.similarity_pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
  });
});
