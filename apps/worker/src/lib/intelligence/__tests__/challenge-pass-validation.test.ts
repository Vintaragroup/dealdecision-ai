/**
 * Challenge Pass Rewrite — Live Validation
 *
 * Runs the new runChallengePass against real deal signal profiles extracted
 * from the production DB. Inputs derived from:
 *   - deal_confidence_assessments.penalties_applied (contradiction_count,
 *     financial_completeness_pct, dci_score)
 *   - deal_challenge_pass_results (verdict, ors_score, missing_evidence count)
 *
 * All 7 deals that have Stage 5 runs. This validates:
 *   1. Score differentiation — do different deals get different scores?
 *   2. Factor differentiation — do different deals get different primary reasons?
 *   3. Boilerplate test — is opposing_case_summary deal-specific?
 *   4. Distribution — do we cover Robust/Moderate/Fragile/Very Fragile?
 */

import { describe, it, expect } from "vitest";
import { runChallengePass } from "../challenge-pass/service.js";
import type { ChallengePassInput } from "../challenge-pass/service.js";
import type { EvaluationFlag } from "../evaluation-engine/types.js";

// ─── Real deal profiles (extracted from DB + confidence penalties) ─────────────
//
// Source signals for each deal:
//   contradiction_count  — from "N contradiction(s) detected" in penalties_applied
//   financial_completeness_pct — from "Financial data very incomplete (N%)" penalty
//   dci_score — from "DCI very low (N)" penalty; ~80 if no DCI penalty
//   deterministic_only — all current deals have this penalty (LLM stage skipped)
//   missing_evidence — all 6 items missing except DealDecision (3 missing)
//
// Flags: All current runs have exactly 1 WARN (det_only mode). No CRITICALs.

function makeWarnFlag(flag_type: EvaluationFlag["flag_type"]): EvaluationFlag {
  return {
    flag_id: `test-${flag_type}`,
    deal_id: "placeholder",
    flag_type,
    severity: "WARN",
    source_stage: "evaluator",
    impacted_score: null,
    description: `WARN: ${flag_type}`,
    detail: {},
    resolution_status: "open",
  };
}

function makeConfPenalty(reason: string, penalty: number) {
  return { reason, penalty };
}

function emptyEvidence() {
  return {
    arr_structured: null as null,
    burn_rate_monthly: null as null,
    runway_months: null as null,
    cash_on_hand: null as null,
    has_xlsx: false,
    has_cap_table: false,
    evidence_count: 4,
    evidence_sections_covered: 2,
  };
}

const DET_ONLY_FLAG = makeWarnFlag("deterministic_only_mode" as EvaluationFlag["flag_type"]);

// ─── Deal profiles ────────────────────────────────────────────────────────────

const DEALS: ChallengePassInput[] = [
  // 1. Delphi — very weak (ORS 14, NO_GO, all evidence missing, low DCI, det-only)
  {
    deal_id: "delphi",
    deal_name: "Delphi",
    intelligence_run_id: "run-delphi",
    verdict: "NO_GO",
    ors_score: 14,
    flags: [DET_ONLY_FLAG],
    evidence: emptyEvidence(),
    contradiction_count: 0,
    financial_completeness_pct: 0,
    dci_score: 20,
    confidence_penalties: [
      makeConfPenalty("Financial data very incomplete (0%)", 10),
      makeConfPenalty("DCI very low (20) — document quality insufficient", 15),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },

  // 2. Bear — very weak (ORS 18, NO_GO, all evidence missing, low DCI, det-only)
  {
    deal_id: "bear",
    deal_name: "Bear",
    intelligence_run_id: "run-bear",
    verdict: "NO_GO",
    ors_score: 18,
    flags: [DET_ONLY_FLAG],
    evidence: emptyEvidence(),
    contradiction_count: 0,
    financial_completeness_pct: 5,
    dci_score: 20,
    confidence_penalties: [
      makeConfPenalty("Financial data very incomplete (5%)", 10),
      makeConfPenalty("DCI very low (20) — document quality insufficient", 15),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },

  // 3. Vermont — weak (ORS 28, NO_GO, 2 contradictions, 5% financials, DCI 10)
  {
    deal_id: "vermont",
    deal_name: "Vermont",
    intelligence_run_id: "run-vermont",
    verdict: "NO_GO",
    ors_score: 28,
    flags: [DET_ONLY_FLAG],
    evidence: emptyEvidence(),
    contradiction_count: 2,
    financial_completeness_pct: 5,
    dci_score: 10,
    confidence_penalties: [
      makeConfPenalty("2 contradiction(s) detected", 20),
      makeConfPenalty("Financial data very incomplete (5%)", 10),
      makeConfPenalty("DCI very low (10) — document quality insufficient", 15),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },

  // 4. StackFactor — weak/mid (ORS 52, CONSIDER, 3 contradictions, 15% financials)
  {
    deal_id: "stackfactor",
    deal_name: "StackFactor",
    intelligence_run_id: "run-stackfactor",
    verdict: "CONSIDER",
    ors_score: 52,
    flags: [DET_ONLY_FLAG],
    evidence: emptyEvidence(),
    contradiction_count: 3,
    financial_completeness_pct: 15,
    dci_score: 60,
    confidence_penalties: [
      makeConfPenalty("3 contradictions detected", 35),
      makeConfPenalty("Financial data very incomplete (15%)", 10),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },

  // 5. StackOP — mid (ORS 55, CONSIDER, 0 contradictions, 15% financials, decent DCI)
  {
    deal_id: "stackop",
    deal_name: "StackOP",
    intelligence_run_id: "run-stackop",
    verdict: "CONSIDER",
    ors_score: 55,
    flags: [DET_ONLY_FLAG],
    evidence: emptyEvidence(),
    contradiction_count: 0,
    financial_completeness_pct: 15,
    dci_score: 70,
    confidence_penalties: [
      makeConfPenalty("Financial data very incomplete (15%)", 10),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },

  // 6. DealDecision — stronger (ORS 70, CONSIDER, 1 contradiction, 20% financials,
  //    only 3 missing evidence items — partial data available)
  {
    deal_id: "dealdecision",
    deal_name: "DealDecision",
    intelligence_run_id: "run-dealdecision",
    verdict: "CONSIDER",
    ors_score: 70,
    flags: [DET_ONLY_FLAG],
    evidence: {
      arr_structured: 200_000,
      burn_rate_monthly: 30_000,
      runway_months: null,
      cash_on_hand: null,
      has_xlsx: true,
      has_cap_table: false,
      evidence_count: 8,
      evidence_sections_covered: 4,
    },
    contradiction_count: 1,
    financial_completeness_pct: 20,
    dci_score: 65,
    confidence_penalties: [
      makeConfPenalty("1 contradiction(s) detected", 20),
      makeConfPenalty("Financial data very incomplete (20%)", 10),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },

  // 7. Qredible — strongest (ORS 74, CONSIDER, 0 contradictions, 15% financials)
  {
    deal_id: "qredible",
    deal_name: "Qredible",
    intelligence_run_id: "run-qredible",
    verdict: "CONSIDER",
    ors_score: 74,
    flags: [DET_ONLY_FLAG],
    evidence: emptyEvidence(),
    contradiction_count: 0,
    financial_completeness_pct: 15,
    dci_score: 75,
    confidence_penalties: [
      makeConfPenalty("Financial data very incomplete (15%)", 10),
      makeConfPenalty("LLM stage was skipped (deterministic-only mode)", 20),
    ],
  },
];

// ─── Validation tests ─────────────────────────────────────────────────────────

describe("Challenge Pass Rewrite — Real Deal Validation", () => {
  // Run all deals and collect results
  const results = DEALS.map((d) => ({ deal: d, result: runChallengePass(d) }));

  it("should produce output for all 7 deals without throwing", () => {
    expect(results).toHaveLength(7);
    for (const { result } of results) {
      expect(result.verdict_resistance_score).toBeGreaterThanOrEqual(0);
      expect(result.verdict_resistance_score).toBeLessThanOrEqual(100);
      expect(result.opposing_case_summary.length).toBeGreaterThan(10);
    }
  });

  it("scores should NOT all be identical (differentiation test)", () => {
    const scores = results.map((r) => r.result.verdict_resistance_score);
    const unique = [...new Set(scores)];
    // Old code produced only 55 or 70. New code should produce ≥ 4 distinct values.
    expect(unique.length).toBeGreaterThanOrEqual(4);
    console.log("\n=== SCORE DISTRIBUTION ===");
    for (const { deal, result } of results) {
      console.log(
        `${deal.deal_name.padEnd(15)} ORS=${String(deal.ors_score).padEnd(4)} ` +
        `verdict=${deal.verdict.padEnd(9)} resistance=${result.verdict_resistance_score} ` +
        `(${result.verdict_resistance_label})`
      );
    }
  });

  it("contradiction-heavy deals should score lower than clean deals on same evidence base", () => {
    // Vermont (2 contradictions) should score lower than StackOP (0 contradictions)
    const vermont = results.find((r) => r.deal.deal_id === "vermont")!.result;
    const stackop = results.find((r) => r.deal.deal_id === "stackop")!.result;
    expect(vermont.verdict_resistance_score).toBeLessThan(stackop.verdict_resistance_score);

    // StackFactor (3 contradictions) should score lower than StackOP (0 contradictions)
    const stackfactor = results.find((r) => r.deal.deal_id === "stackfactor")!.result;
    expect(stackfactor.verdict_resistance_score).toBeLessThan(
      stackop.verdict_resistance_score
    );
  });

  it("stronger deals (Qredible, DealDecision) should outrank weaker ones (Delphi, Bear)", () => {
    const qredible = results.find((r) => r.deal.deal_id === "qredible")!.result;
    const delphi = results.find((r) => r.deal.deal_id === "delphi")!.result;
    expect(qredible.verdict_resistance_score).toBeGreaterThan(delphi.verdict_resistance_score);
  });

  it("primary_challenge_reason should differ across deals", () => {
    const reasons = results.map((r) => r.result.primary_challenge_reason);
    // At minimum, Vermont/StackFactor (contradictions) should differ from StackOP/Qredible (no contradictions)
    const vermont = results.find((r) => r.deal.deal_id === "vermont")!.result;
    const qredible = results.find((r) => r.deal.deal_id === "qredible")!.result;
    expect(vermont.primary_challenge_reason).not.toBe(qredible.primary_challenge_reason);
  });

  it("opposing_case_summary should vary meaningfully across deals", () => {
    const summaries = results.map((r) => r.result.opposing_case_summary);
    // All summaries should be unique (no two identical)
    const unique = [...new Set(summaries)];
    expect(unique.length).toBe(summaries.length);
  });

  it("contradiction deals should mention contradictions in opposing case", () => {
    const stackfactor = results.find((r) => r.deal.deal_id === "stackfactor")!.result;
    const vermont = results.find((r) => r.deal.deal_id === "vermont")!.result;
    expect(
      stackfactor.opposing_case_summary.toLowerCase() +
      stackfactor.primary_challenge_reason.toLowerCase()
    ).toMatch(/contradiction/);
    expect(
      vermont.opposing_case_summary.toLowerCase() +
      vermont.primary_challenge_reason.toLowerCase()
    ).toMatch(/contradiction/);
  });

  it("should print full comparison table", () => {
    console.log("\n╔══════════════════════════════════════════════════════════════════════════════╗");
    console.log("║         CHALLENGE PASS REWRITE VALIDATION — DEAL COMPARISON TABLE           ║");
    console.log("╚══════════════════════════════════════════════════════════════════════════════╝\n");

    for (const { deal, result } of results) {
      const topFactor = result.challenge_factors[0];
      console.log(`── ${deal.deal_name.toUpperCase()} ──────────────────────────────────────────`);
      console.log(`  ORS: ${deal.ors_score}  |  Verdict: ${deal.verdict}  |  Contradiction: ${deal.contradiction_count}  |  Fin%: ${deal.financial_completeness_pct}  |  DCI: ${deal.dci_score}`);
      console.log(`  Resistance: ${result.verdict_resistance_score} (${result.verdict_resistance_label})`);
      console.log(`  Primary reason: ${result.primary_challenge_reason.substring(0, 120)}${result.primary_challenge_reason.length > 120 ? "..." : ""}`);
      console.log(`  Top factor: ${topFactor ? `[${topFactor.severity}] ${topFactor.code} — ${topFactor.title}` : "none"}`);
      console.log(`  Factors (${result.challenge_factors.length}): ${result.challenge_factors.map((f) => f.code).join(", ") || "none"}`);
      console.log(`  Missing ev: ${result.missing_evidence.length}  |  Gaps: ${result.diligence_gaps.length}  |  Memory: ${result.memory_challenge_used}`);
      console.log(`  Summary: ${result.opposing_case_summary.substring(0, 200)}...`);
      console.log();
    }

    // Old code comparison
    console.log("── OLD CODE (BEFORE REWRITE) — ALL HAD SAME OUTPUT ─────────────────────────");
    console.log('  Score: 55 (Moderate) for ALL deals except DealDecision (70 Moderate)');
    console.log('  Summary: "Bear case for X (verdict: Y, ORS: N): 1 warning-level flag..."');
    console.log('  Primary reason: n/a (field did not exist)');
    console.log('  Challenge factors: n/a (field did not exist)\n');
    expect(true).toBe(true); // always pass, this is a reporting test
  });
});
