/**
 * Tests — Challenge Pass
 * Pure functions only (no DB).
 *
 * Validates:
 *   1. Resistance score differentiates meaningfully across deal quality
 *   2. Primary challenge reason reflects correct root cause
 *   3. Challenge factors are structured and ordered correctly
 *   4. Contradictions drive score harder than structural gaps
 *   5. Clean deals reach Robust even with some missing evidence
 *   6. Distribution: scoring covers full Robust/Moderate/Fragile/Very Fragile band
 */

import { describe, it, expect } from "vitest";
import { detectMissingEvidence, missingEvidencePenalty } from "../challenge-pass/missing-evidence-detector.js";
import { runChallengePass } from "../challenge-pass/service.js";
import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type { MissingEvidenceInput } from "../challenge-pass/missing-evidence-detector.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFlag(
  flag_type: EvaluationFlag["flag_type"],
  severity: EvaluationFlag["severity"],
  description = ""
): EvaluationFlag {
  return {
    flag_id: `test-${flag_type}`,
    deal_id: "deal-001",
    flag_type,
    severity,
    source_stage: "test",
    impacted_score: null,
    description: description || `Test flag: ${flag_type}`,
    detail: {},
    resolution_status: "open",
  };
}

function fullEvidence(): MissingEvidenceInput {
  return {
    arr_structured: 500_000,
    burn_rate_monthly: 50_000,
    runway_months: 18,
    cash_on_hand: 900_000,
    has_xlsx: true,
    has_cap_table: true,
    evidence_count: 15,
    evidence_sections_covered: 6,
  };
}

function emptyEvidence(): MissingEvidenceInput {
  return {
    arr_structured: null,
    burn_rate_monthly: null,
    runway_months: null,
    cash_on_hand: null,
    has_xlsx: false,
    has_cap_table: false,
    evidence_count: 0,
    evidence_sections_covered: 0,
  };
}

// ─── detectMissingEvidence ─────────────────────────────────────────────────

describe("detectMissingEvidence", () => {
  it("returns empty when all evidence is present", () => {
    const { missing_evidence } = detectMissingEvidence(fullEvidence());
    expect(missing_evidence).toHaveLength(0);
  });

  it("flags missing ARR as High sensitivity", () => {
    const { missing_evidence } = detectMissingEvidence({
      ...fullEvidence(),
      arr_structured: null,
    });
    const item = missing_evidence.find((e) => e.evidence_type === "structured_arr");
    expect(item).toBeDefined();
    expect(item!.verdict_sensitivity).toBe("High");
  });

  it("flags missing XLSX as High sensitivity", () => {
    const { missing_evidence } = detectMissingEvidence({
      ...fullEvidence(),
      has_xlsx: false,
    });
    const item = missing_evidence.find((e) => e.evidence_type === "xlsx_financial_model");
    expect(item).toBeDefined();
    expect(item!.verdict_sensitivity).toBe("High");
  });

  it("generates diligence gaps for each missing item", () => {
    const { missing_evidence, diligence_gaps } = detectMissingEvidence({
      ...fullEvidence(),
      arr_structured: null,
      has_xlsx: false,
    });
    expect(diligence_gaps.length).toBe(missing_evidence.length);
  });
});

describe("missingEvidencePenalty", () => {
  it("returns 0 for empty list", () => {
    expect(missingEvidencePenalty([])).toBe(0);
  });

  it("caps at 40 regardless of item count", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      evidence_type: `item_${i}`,
      description: "test",
      verdict_sensitivity: "High" as const,
      diligence_question: "?",
    }));
    expect(missingEvidencePenalty(items)).toBe(40);
  });
});

// ─── runChallengePass — baseline ───────────────────────────────────────────

describe("runChallengePass — baseline", () => {
  it("returns Robust (100) for a fully clean deal", () => {
    const result = runChallengePass({
      deal_id: "deal-001",
      deal_name: "TestCo",
      intelligence_run_id: "run-001",
      verdict: "GO",
      ors_score: 78,
      flags: [],
      evidence: fullEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 100,
      dci_score: 100,
      confidence_penalties: [],
    });
    expect(result.verdict_resistance_score).toBe(100);
    expect(result.verdict_resistance_label).toBe("Robust");
    expect(result.primary_challenge_reason.length).toBeGreaterThan(0);
    expect(result.challenge_factors).toHaveLength(0);
  });

  it("flag counts are accurate in result", () => {
    const result = runChallengePass({
      deal_id: "deal-001",
      deal_name: "TestCo",
      intelligence_run_id: "run-001",
      verdict: "GO",
      ors_score: 70,
      flags: [
        makeFlag("evidence_count_below_floor", "CRITICAL"),
        makeFlag("verdict_score_gap", "ERROR"),
        makeFlag("llm_cache_stale", "WARN"),
      ],
      evidence: fullEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 100,
      dci_score: 100,
    });
    expect(result.flag_count_critical).toBe(1);
    expect(result.flag_count_error).toBe(1);
    expect(result.flag_count_warn).toBe(1);
  });

  it("always returns a non-empty opposing_case_summary", () => {
    const result = runChallengePass({
      deal_id: "deal-001",
      deal_name: "CleanCo",
      intelligence_run_id: "run-001",
      verdict: "CONSIDER",
      ors_score: 60,
      flags: [],
      evidence: fullEvidence(),
    });
    expect(result.opposing_case_summary.length).toBeGreaterThan(10);
  });
});

// ─── runChallengePass — differentiation across deal quality ───────────────

describe("runChallengePass — differentiation", () => {
  it("contradiction cluster causes larger deduction than single contradiction", () => {
    const singleContradiction = runChallengePass({
      deal_id: "d1",
      deal_name: "SingleContra",
      intelligence_run_id: "r1",
      verdict: "CONSIDER",
      ors_score: 60,
      flags: [],
      evidence: fullEvidence(),
      contradiction_count: 1,
      financial_completeness_pct: 100,
      dci_score: 100,
    });
    const clusterContradiction = runChallengePass({
      deal_id: "d2",
      deal_name: "Cluster",
      intelligence_run_id: "r2",
      verdict: "CONSIDER",
      ors_score: 60,
      flags: [],
      evidence: fullEvidence(),
      contradiction_count: 3,
      financial_completeness_pct: 100,
      dci_score: 100,
    });
    expect(clusterContradiction.verdict_resistance_score).toBeLessThan(
      singleContradiction.verdict_resistance_score
    );
    const clusterFactor = clusterContradiction.challenge_factors.find(
      (f) => f.code === "contradiction_cluster"
    );
    expect(clusterFactor).toBeDefined();
    expect(clusterFactor!.severity).toBe("Critical");
  });

  it("structural-gaps-only deal scores higher than contradiction deal", () => {
    const missingDataOnly = runChallengePass({
      deal_id: "d3",
      deal_name: "MissingDocs",
      intelligence_run_id: "r3",
      verdict: "CONSIDER",
      ors_score: 60,
      flags: [],
      evidence: emptyEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 80,
      dci_score: 80,
    });
    const contradictionDeal = runChallengePass({
      deal_id: "d4",
      deal_name: "ContraData",
      intelligence_run_id: "r4",
      verdict: "CONSIDER",
      ors_score: 60,
      flags: [],
      evidence: emptyEvidence(),
      contradiction_count: 3,
      financial_completeness_pct: 80,
      dci_score: 80,
    });
    expect(missingDataOnly.verdict_resistance_score).toBeGreaterThan(
      contradictionDeal.verdict_resistance_score
    );
  });

  it("financial completeness below 30% triggers financial_evidence_weak factor", () => {
    const result = runChallengePass({
      deal_id: "d5",
      deal_name: "WeakFinancials",
      intelligence_run_id: "r5",
      verdict: "GO",
      ors_score: 65,
      flags: [],
      evidence: fullEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 20,
      dci_score: 80,
    });
    const factor = result.challenge_factors.find(
      (f) => f.code === "financial_evidence_weak"
    );
    expect(factor).toBeDefined();
    expect(factor!.severity).toBe("High");
    expect(result.verdict_resistance_score).toBeLessThan(100);
  });

  it("low DCI triggers document_quality_low factor", () => {
    const result = runChallengePass({
      deal_id: "d6",
      deal_name: "PoorDocs",
      intelligence_run_id: "r6",
      verdict: "CONSIDER",
      ors_score: 55,
      flags: [],
      evidence: fullEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 90,
      dci_score: 20,
    });
    const factor = result.challenge_factors.find((f) => f.code === "document_quality_low");
    expect(factor).toBeDefined();
  });

  it("critical flag triggers evaluator_critical_flag factor", () => {
    const result = runChallengePass({
      deal_id: "d7",
      deal_name: "CriticalFlag",
      intelligence_run_id: "r7",
      verdict: "GO",
      ors_score: 70,
      flags: [
        makeFlag("evidence_count_below_floor", "CRITICAL", "Insufficient evidence."),
      ],
      evidence: fullEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 100,
      dci_score: 100,
    });
    // evidence_count_below_floor triggers both evaluator_critical_flag and evidence_base_thin
    const critFactor = result.challenge_factors.find(
      (f) => f.code === "evaluator_critical_flag"
    );
    const thinFactor = result.challenge_factors.find(
      (f) => f.code === "evidence_base_thin"
    );
    expect(critFactor).toBeDefined();
    expect(thinFactor).toBeDefined();
    expect(result.verdict_resistance_score).toBeLessThan(100);
  });
});

// ─── runChallengePass — label distribution ─────────────────────────────────

describe("runChallengePass — label distribution", () => {
  it("Very Fragile: contradiction cluster + CRITICAL flag + weak financials", () => {
    const result = runChallengePass({
      deal_id: "vf1",
      deal_name: "VeryFragileCo",
      intelligence_run_id: "vfr1",
      verdict: "GO",
      ors_score: 45,
      flags: [
        makeFlag("evidence_count_below_floor", "CRITICAL"),
        makeFlag("verdict_score_gap", "CRITICAL"),
      ],
      evidence: emptyEvidence(),
      contradiction_count: 3,
      financial_completeness_pct: 15,
      dci_score: 20,
    });
    expect(result.verdict_resistance_label).toBe("Very Fragile");
    expect(result.verdict_resistance_score).toBeLessThan(25);
  });

  it("Fragile: moderate analytical pressure", () => {
    const result = runChallengePass({
      deal_id: "fr1",
      deal_name: "FragileCo",
      intelligence_run_id: "frr1",
      verdict: "CONSIDER",
      ors_score: 55,
      flags: [makeFlag("evidence_count_below_floor", "CRITICAL")],
      // No missing evidence items — structural gap deduction would push score below 25
      evidence: fullEvidence(),
      contradiction_count: 2,
      financial_completeness_pct: 25,
      dci_score: 28,
    });
    // CRITICAL(-22) + EVIDENCE_BASE_THIN(-12) + CONTRADICTION_SINGLE(-18) + FINANCIAL_WEAK(-10) + DCI_LOW(-8) = -70 → 30
    expect(result.verdict_resistance_score).toBeGreaterThanOrEqual(25);
    expect(result.verdict_resistance_score).toBeLessThan(50);
    expect(result.verdict_resistance_label).toBe("Fragile");
  });

  it("Moderate: single contradiction + partial financials", () => {
    const result = runChallengePass({
      deal_id: "mo1",
      deal_name: "ModerateCo",
      intelligence_run_id: "mor1",
      verdict: "CONSIDER",
      ors_score: 58,
      flags: [],
      // One missing High-sensitivity item gives -4; combined with single contradiction it crosses below 75
      evidence: { ...fullEvidence(), arr_structured: null },
      contradiction_count: 1,
      financial_completeness_pct: 45,
      dci_score: 70,
    });
    // SINGLE_CONTRADICTION(-18) + FINANCIAL_PARTIAL(-5) + MISSING_HIGH_1(-4) = -27 → 73
    expect(result.verdict_resistance_score).toBeGreaterThanOrEqual(50);
    expect(result.verdict_resistance_score).toBeLessThan(75);
    expect(result.verdict_resistance_label).toBe("Moderate");
  });

  it("Robust: clean deal, minor warn flag only", () => {
    const result = runChallengePass({
      deal_id: "ro1",
      deal_name: "CleanCo",
      intelligence_run_id: "ror1",
      verdict: "GO",
      ors_score: 82,
      flags: [makeFlag("llm_cache_stale", "WARN")],
      evidence: fullEvidence(),
      contradiction_count: 0,
      financial_completeness_pct: 95,
      dci_score: 85,
    });
    expect(result.verdict_resistance_label).toBe("Robust");
    expect(result.verdict_resistance_score).toBeGreaterThanOrEqual(75);
  });
});

// ─── runChallengePass — challenge_factors ordering ────────────────────────

describe("runChallengePass — challenge_factors ordering", () => {
  it("Critical factors appear before High factors", () => {
    const result = runChallengePass({
      deal_id: "ord1",
      deal_name: "OrderTest",
      intelligence_run_id: "ordr1",
      verdict: "GO",
      ors_score: 55,
      flags: [
        makeFlag("evidence_count_below_floor", "CRITICAL"),
        makeFlag("verdict_score_gap", "ERROR"),
      ],
      evidence: fullEvidence(),
      contradiction_count: 1,
      financial_completeness_pct: 40,
      dci_score: 80,
    });
    const severities = result.challenge_factors.map((f) => f.severity);
    const ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    for (let i = 1; i < severities.length; i++) {
      expect(ORDER[severities[i]]).toBeGreaterThanOrEqual(ORDER[severities[i - 1]]);
    }
  });

  it("challenge_factors has unique codes", () => {
    const result = runChallengePass({
      deal_id: "uniq1",
      deal_name: "UniqTest",
      intelligence_run_id: "uniqr1",
      verdict: "CONSIDER",
      ors_score: 55,
      flags: [makeFlag("evidence_count_below_floor", "CRITICAL")],
      evidence: fullEvidence(),
      contradiction_count: 2,
      financial_completeness_pct: 20,
      dci_score: 25,
    });
    const codes = result.challenge_factors.map((f) => f.code);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });
});

