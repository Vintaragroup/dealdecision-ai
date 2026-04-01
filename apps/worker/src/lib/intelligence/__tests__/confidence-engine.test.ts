/**
 * Tests — Confidence Engine
 * Pure functions only (no DB).
 */

import { describe, it, expect } from "vitest";
import { computePenalties } from "../confidence-engine/rules.js";
import { computeConfidence } from "../confidence-engine/service.js";
import type { ConfidenceInput } from "../confidence-engine/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    deal_id: "deal-001",
    intelligence_run_id: "run-001",
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

// ─── computePenalties ──────────────────────────────────────────────────────

describe("computePenalties", () => {
  it("returns zero penalty for clean input", () => {
    const { total_penalty, penalties } = computePenalties(baseInput());
    expect(total_penalty).toBe(0);
    expect(penalties).toHaveLength(0);
  });

  it("applies -20 penalty for a single contradiction", () => {
    const { total_penalty } = computePenalties(baseInput({ contradiction_count: 1 }));
    expect(total_penalty).toBe(20);
  });

  it("applies -35 penalty (capped) for 3+ contradictions", () => {
    const { total_penalty } = computePenalties(baseInput({ contradiction_count: 3 }));
    expect(total_penalty).toBe(35);
  });

  it("applies -15 penalty for DPU fail-open", () => {
    const { total_penalty } = computePenalties(baseInput({ dpu_provenance_missing: true }));
    expect(total_penalty).toBe(15);
  });

  it("applies -35 per CRITICAL flag (max 70)", () => {
    const { total_penalty } = computePenalties(baseInput({ evaluator_critical_count: 1 }));
    expect(total_penalty).toBe(35);
  });

  it("caps CRITICAL flags at 70", () => {
    const { total_penalty } = computePenalties(baseInput({ evaluator_critical_count: 5 }));
    expect(total_penalty).toBe(70);
  });

  it("applies -20 per ERROR flag (max 40)", () => {
    const { total_penalty } = computePenalties(baseInput({ evaluator_error_count: 1 }));
    expect(total_penalty).toBe(20);
  });

  it("caps ERROR flags at 40", () => {
    const { total_penalty } = computePenalties(baseInput({ evaluator_error_count: 5 }));
    expect(total_penalty).toBe(40);
  });

  it("applies -20 when deterministic-only mode", () => {
    const { total_penalty } = computePenalties(
      baseInput({ investor_insights_status: "deterministic_only" })
    );
    expect(total_penalty).toBe(20);
  });
});

// ─── computeConfidence ─────────────────────────────────────────────────────

describe("computeConfidence", () => {
  it("returns High band for clean input", () => {
    const report = computeConfidence(baseInput());
    expect(report.overall_confidence_band).toBe("High");
    expect(report.overall_confidence_score).toBe(100);
  });

  it("score is clamped to 10 minimum", () => {
    const report = computeConfidence(
      baseInput({
        evaluator_critical_count: 3,  // 70 penalty
        evaluator_error_count: 2,     // 40 penalty
        contradiction_count: 3,       // 35 penalty
        dpu_provenance_missing: true, // 15 penalty
        investor_insights_status: "deterministic_only", // 20 penalty
      })
    );
    expect(report.overall_confidence_score).toBeGreaterThanOrEqual(10);
  });

  it("band is Medium when score is 45–69", () => {
    // Force ~50 score: one error (20) + det-only (20) = 40 penalty → 60
    const report = computeConfidence(
      baseInput({ evaluator_error_count: 1, investor_insights_status: "deterministic_only" })
    );
    // 100 - 40 = 60 → High (still ≥70? No — 60 < 70 → Medium)
    expect(report.overall_confidence_band).toBe("Medium");
  });

  it("band is Low when score < 45", () => {
    // Force <45: 3 criticals (70) + dpu (15) = 85 penalty → 15
    const report = computeConfidence(
      baseInput({ evaluator_critical_count: 3, dpu_provenance_missing: true })
    );
    expect(report.overall_confidence_band).toBe("Low");
    expect(report.overall_confidence_score).toBeLessThan(45);
  });

  it("includes at least 3 conclusions", () => {
    const report = computeConfidence(baseInput());
    expect(report.conclusions.length).toBeGreaterThanOrEqual(3);
  });

  it("rationale is a non-empty string", () => {
    const report = computeConfidence(baseInput());
    expect(typeof report.rationale).toBe("string");
    expect(report.rationale.length).toBeGreaterThan(0);
  });
});
