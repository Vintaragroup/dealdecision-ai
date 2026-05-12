/**
 * Tests — Decision Memory: Fragility End-to-End Validation
 *
 * Validates the full fragility code path from neighbor similarity through to
 * the challenge pass output. This path was unit-tested at each layer but had
 * never been exercised as a complete chain before this test suite.
 *
 * All functions are pure (no DB). The test constructs a synthetic pool of
 * similar deals that triggers the fragility signal and asserts every field
 * downstream.
 *
 * Chain:
 *   deriveMemoryInfluence  →  computeConfidence  →  runChallengePass
 *
 * Covers:
 *   E1. Full fragility chain (majority NO_GO neighbors vs CONSIDER verdict)
 *   E2. Confidence reduction propagates correctly through computeConfidence
 *   E3. Challenge pass enriches opposing_case_summary with memory signal
 *   E4. No support signal fires when fragility is active
 *   E5. All fragility fields are populated (no nulls, no false positives)
 */

import { describe, it, expect } from "vitest";
import {
  deriveMemoryInfluence,
  MEMORY_MAX_CONFIDENCE_PENALTY,
  MEMORY_MAX_CONFIDENCE_BOOST,
} from "../decision-memory/influence.js";
import type { SimilarDeal } from "../decision-memory/types.js";
import { computeConfidence } from "../confidence-engine/service.js";
import type { ConfidenceInput } from "../confidence-engine/types.js";
import { runChallengePass } from "../challenge-pass/service.js";
import type { ChallengePassInput } from "../challenge-pass/service.js";
import type { Stage5StartedEvent, IntelligenceRolloutMode } from "../../../jobs/investor-insights/stages/stage-5-intelligence.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNoGoDeal(id: string, ors: number, similarity_pct: number): SimilarDeal {
  return {
    deal_id: id,
    distance: 1 - similarity_pct / 100,
    similarity_pct,
    match_reasons: ["similar ors_score"],
    score_snapshot: { ors, dci: 25, fhc: 15, urss: 0 },
    verdict: "NO_GO",
    scoreband_key: "weak",
  };
}

function makeConsiderDeal(id: string, ors: number, similarity_pct: number): SimilarDeal {
  return {
    deal_id: id,
    distance: 1 - similarity_pct / 100,
    similarity_pct,
    match_reasons: ["similar ors_score", "similar dci"],
    score_snapshot: { ors, dci: 55, fhc: 40, urss: 0 },
    verdict: "CONSIDER",
    scoreband_key: "mid",
  };
}

/**
 * Fragility pool: 4 NO_GO neighbors (≥ 60% threshold on 5-deal pool)
 * + 1 CONSIDER neighbor. Avg similarity ~77% (well above 40% minimum).
 */
const FRAGILITY_NEIGHBORS: SimilarDeal[] = [
  makeNoGoDeal("ng-deal-a1b2c3d4", 18, 82),
  makeNoGoDeal("ng-deal-e5f6g7h8", 22, 78),
  makeNoGoDeal("ng-deal-i9j0k1l2", 15, 80),
  makeNoGoDeal("ng-deal-m3n4o5p6", 20, 75),
  makeConsiderDeal("co-deal-q7r8s9t0", 58, 71),
];

const CURRENT_VERDICT = "CONSIDER";

function baseConfInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    deal_id: "deal-fragility-test-001",
    intelligence_run_id: "run-fragility-test-001",
    evidence_count: 10,
    contradiction_count: 1,
    dpu_provenance_missing: false,
    xlsx_extraction_had_llm_fallback: false,
    llm_cache_age_days: 2,
    financial_completeness_pct: 65,
    dci_score: 60,
    investor_insights_status: "complete",
    has_reconciliation_conflict: false,
    evaluator_error_count: 0,
    evaluator_critical_count: 0,
    arr_structured: 400_000,
    burn_rate_monthly: 45_000,
    ...overrides,
  };
}

function baseChallengeInput(
  memInfluence: ReturnType<typeof deriveMemoryInfluence>
): ChallengePassInput {
  return {
    deal_id: "deal-fragility-test-001",
    deal_name: "Fragility Test Co.",
    intelligence_run_id: "run-fragility-test-001",
    verdict: CURRENT_VERDICT,
    ors_score: 58,
    flags: [],
    deck_risk_items: ["Market size claim unsubstantiated", "Revenue projection aggressive"],
    evidence: {
      arr_structured: 400_000,
      burn_rate_monthly: 45_000,
      runway_months: null,
      cash_on_hand: null,
      has_xlsx: true,
      has_cap_table: false,
      evidence_count: 10,
      evidence_sections_covered: 6,
    },
    memory_influence: memInfluence,
  };
}

// ─── E1. Full fragility chain ─────────────────────────────────────────────────

describe("decision-memory fragility — full chain", () => {
  it("fragility signal fires with 4/5 NO_GO neighbors and CONSIDER current verdict", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    expect(influence.memory_fragility_signal).toBe(true);
    expect(influence.memory_support_signal).toBe(false);
    expect(influence.similar_deal_count).toBe(5);
    expect(influence.avg_similarity_pct).toBeGreaterThan(40);
  });

  it("confidence adjustment is -MEMORY_MAX_CONFIDENCE_PENALTY for fragility case", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    expect(influence.confidence_adjustment).toBe(-MEMORY_MAX_CONFIDENCE_PENALTY);
    expect(influence.confidence_adjustment_reason).toMatch(/confidence reduced/i);
    expect(influence.confidence_adjustment_reason).toMatch(/NO_GO/i);
  });

  it("challenge memory is used and summary is populated for fragility case", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    expect(influence.challenge_memory_used).toBe(true);
    expect(influence.challenge_memory_summary).not.toBeNull();
    expect(influence.challenge_memory_summary).toMatch(/NO_GO/i);
    expect(influence.challenge_memory_summary).toMatch(/structural similarity/i);
    // Must not claim confirmed outcomes
    expect(influence.challenge_memory_summary).not.toMatch(
      /confirmed (failure|success)|known outcome|actual outcome|labeled outcome/i
    );
  });

  it("verdict_agreement_fraction reflects NO_GO majority (< 1/5 matching CONSIDER)", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    // 1 CONSIDER out of 5 = 0.2 agreement fraction
    expect(influence.verdict_agreement_fraction).toBeCloseTo(0.2);
    expect(influence.neighbor_verdict_mix.no_go).toBe(4);
    expect(influence.neighbor_verdict_mix.consider).toBe(1);
    expect(influence.neighbor_verdict_mix.go).toBe(0);
  });
});

// ─── E2. Confidence reduction propagates ──────────────────────────────────────

describe("decision-memory fragility — confidence engine propagation", () => {
  it("confidence score is reduced by MEMORY_MAX_CONFIDENCE_PENALTY", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);
    const base = computeConfidence(baseConfInput());
    const withMem = computeConfidence(baseConfInput({ memory_influence: influence }));

    expect(withMem.overall_confidence_score).toBe(
      Math.max(10, base.overall_confidence_score - MEMORY_MAX_CONFIDENCE_PENALTY)
    );
  });

  it("memory_adjustment is -MEMORY_MAX_CONFIDENCE_PENALTY in confidence report", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);
    const result = computeConfidence(baseConfInput({ memory_influence: influence }));

    expect(result.memory_adjustment).toBe(-MEMORY_MAX_CONFIDENCE_PENALTY);
    expect(result.memory_adjustment_reason).toMatch(/confidence reduced/i);
  });

  it("fragility adjustment is strictly negative (not support boost)", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    expect(influence.confidence_adjustment).toBeLessThan(0);
    expect(influence.confidence_adjustment).not.toBe(MEMORY_MAX_CONFIDENCE_BOOST);
  });
});

// ─── E3. Challenge pass enrichment ────────────────────────────────────────────

describe("decision-memory fragility — challenge pass enrichment", () => {
  it("opposing_case_summary contains the memory signal appended after base opposing case", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);
    const cpResult = runChallengePass(baseChallengeInput(influence));

    expect(cpResult.opposing_case_summary).toContain("\n\nMemory signal:");
    expect(cpResult.opposing_case_summary).toMatch(/NO_GO/i);
    expect(cpResult.opposing_case_summary).toMatch(/structural similarity/i);
  });

  it("memory_challenge_used is true on the challenge pass result", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);
    const cpResult = runChallengePass(baseChallengeInput(influence));

    expect(cpResult.memory_challenge_used).toBe(true);
  });

  it("memory_challenge_summary is populated on the challenge pass result", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);
    const cpResult = runChallengePass(baseChallengeInput(influence));

    expect(cpResult.memory_challenge_summary).not.toBeNull();
    expect(cpResult.memory_challenge_summary).toMatch(/NO_GO/i);
    expect(cpResult.memory_challenge_summary).toMatch(/structural similarity/i);
  });

  it("opposing_case_summary base text is still present before memory signal", () => {
    // The memory signal appends to, never replaces, the base opposing case.
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    const cpWithMem = runChallengePass(baseChallengeInput(influence));
    const cpWithoutMem = runChallengePass({
      ...baseChallengeInput(influence),
      memory_influence: null,
    });

    // Base opposing case text should appear in both versions
    const memIndex = cpWithMem.opposing_case_summary.indexOf("\n\nMemory signal:");
    expect(memIndex).toBeGreaterThan(0);

    const baseTextWithMem = cpWithMem.opposing_case_summary.slice(0, memIndex);
    expect(baseTextWithMem.length).toBeGreaterThan(0);
    expect(cpWithoutMem.opposing_case_summary).toBe(baseTextWithMem);
  });
});

// ─── E4. Support signal is suppressed when fragility is active ────────────────

describe("decision-memory fragility — signal exclusivity", () => {
  it("support and fragility signals are mutually exclusive in fragility scenario", () => {
    const influence = deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT);

    expect(influence.memory_fragility_signal).toBe(true);
    expect(influence.memory_support_signal).toBe(false);
    // Exactly one of the two directional signals can be true at any time
    expect(
      influence.memory_fragility_signal && influence.memory_support_signal
    ).toBe(false);
  });

  it("challenge pass without memory_influence does NOT fire memory_challenge_used", () => {
    const cpResult = runChallengePass({
      ...baseChallengeInput(deriveMemoryInfluence(FRAGILITY_NEIGHBORS, CURRENT_VERDICT)),
      memory_influence: null,
    });

    expect(cpResult.memory_challenge_used).toBe(false);
    expect(cpResult.memory_challenge_summary).toBeNull();
    expect(cpResult.opposing_case_summary).not.toContain("\n\nMemory signal:");
  });
});

// ─── E5. Stage5StartedEvent wiring markers ────────────────────────────────────
//
// This type-level test documents and enforces that any process running Stage 5
// emits both wiring markers. If the interface fields are removed or their
// literal types change, this test fails at TypeScript compilation time.

describe("Stage5StartedEvent — wiring markers", () => {
  it("event interface requires has_memory_influence_wiring: true and memory_influence_version: v1", () => {
    // Constructing a value of type Stage5StartedEvent is a compile-time assertion:
    // TypeScript will error if either field is absent or has the wrong literal type.
    const event: Stage5StartedEvent = {
      event: "intelligence.stage5.started",
      deal_id: "deal-test-wiring-001",
      run_id: "run-test-wiring-001",
      rollout_mode: "full" as IntelligenceRolloutMode,
      has_memory_influence_wiring: true,
      memory_influence_version: "v1",
      ts: new Date().toISOString(),
    };

    // Runtime assertions for the wiring diagnostic fields.
    expect(event.has_memory_influence_wiring).toBe(true);
    expect(event.memory_influence_version).toBe("v1");
  });
});
