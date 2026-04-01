/**
 * Tests — Challenge Pass
 * Pure functions only (no DB).
 */

import { describe, it, expect } from "vitest";
import { buildOpposingCase } from "../challenge-pass/opposing-case-builder.js";
import { detectMissingEvidence, missingEvidencePenalty } from "../challenge-pass/missing-evidence-detector.js";
import { runChallengePass } from "../challenge-pass/service.js";
import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type { MissingEvidenceInput } from "../challenge-pass/missing-evidence-detector.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFlag(
  flag_type: EvaluationFlag["flag_type"],
  severity: EvaluationFlag["severity"]
): EvaluationFlag {
  return {
    flag_id: `test-${flag_type}`,
    deal_id: "deal-001",
    flag_type,
    severity,
    source_stage: "test",
    impacted_score: null,
    description: `Test flag: ${flag_type}`,
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

// ─── buildOpposingCase ─────────────────────────────────────────────────────

describe("buildOpposingCase", () => {
  it("returns non-empty summary for clean input", () => {
    const { opposing_case_summary } = buildOpposingCase({
      deal_name: "TestCo",
      verdict: "GO",
      ors_score: 70,
      flags: [],
    });
    expect(opposing_case_summary.length).toBeGreaterThan(0);
  });

  it("includes bear case sentence for CRITICAL flag", () => {
    const { opposing_case_summary } = buildOpposingCase({
      deal_name: "TestCo",
      verdict: "GO",
      ors_score: 70,
      flags: [makeFlag("evidence_count_below_floor", "CRITICAL")],
    });
    expect(opposing_case_summary.toLowerCase()).toContain("critical");
  });

  it("generates overconfident claims for ERROR flags", () => {
    const { overconfident_claims } = buildOpposingCase({
      deal_name: "TestCo",
      verdict: "GO",
      ors_score: 70,
      flags: [makeFlag("verdict_score_gap", "ERROR")],
    });
    expect(overconfident_claims.length).toBeGreaterThan(0);
    expect(overconfident_claims[0].source).toBe("score");
  });

  it("notes ORS < 55 with GO verdict", () => {
    const { opposing_case_summary } = buildOpposingCase({
      deal_name: "TestCo",
      verdict: "GO",
      ors_score: 45,
      flags: [],
    });
    expect(opposing_case_summary).toContain("45");
  });
});

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

  it("returns 10 per High-sensitivity item (capped at 40)", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      evidence_type: `item_${i}`,
      description: "test",
      verdict_sensitivity: "High" as const,
      diligence_question: "?",
    }));
    expect(missingEvidencePenalty(items)).toBe(40);
  });
});

// ─── runChallengePass ──────────────────────────────────────────────────────

describe("runChallengePass", () => {
  it("returns Robust for clean deal with no flags", () => {
    const result = runChallengePass({
      deal_id: "deal-001",
      deal_name: "TestCo",
      intelligence_run_id: "run-001",
      verdict: "GO",
      ors_score: 75,
      flags: [],
      evidence: fullEvidence(),
    });
    expect(result.verdict_resistance_label).toBe("Robust");
    expect(result.verdict_resistance_score).toBe(100);
  });

  it("reduces resistance by 25 per CRITICAL flag", () => {
    const result = runChallengePass({
      deal_id: "deal-001",
      deal_name: "TestCo",
      intelligence_run_id: "run-001",
      verdict: "GO",
      ors_score: 75,
      flags: [makeFlag("evidence_count_below_floor", "CRITICAL")],
      evidence: fullEvidence(),
    });
    expect(result.verdict_resistance_score).toBe(75);
    expect(result.verdict_resistance_label).toBe("Robust");
  });

  it("labels Very Fragile when resistance < 25", () => {
    const flags = [
      makeFlag("evidence_count_below_floor", "CRITICAL"),
      makeFlag("verdict_score_gap", "CRITICAL"),
      makeFlag("revenue_narrative_vs_structured", "CRITICAL"),
      makeFlag("zero_sections_produced", "CRITICAL"),
    ];
    const result = runChallengePass({
      deal_id: "deal-001",
      deal_name: "TestCo",
      intelligence_run_id: "run-001",
      verdict: "GO",
      ors_score: 45,
      flags,
      evidence: { ...fullEvidence(), arr_structured: null, burn_rate_monthly: null },
    });
    expect(result.verdict_resistance_label).toBe("Very Fragile");
  });

  it("counts flags correctly in result", () => {
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
    });
    expect(result.flag_count_critical).toBe(1);
    expect(result.flag_count_error).toBe(1);
    expect(result.flag_count_warn).toBe(1);
  });
});
