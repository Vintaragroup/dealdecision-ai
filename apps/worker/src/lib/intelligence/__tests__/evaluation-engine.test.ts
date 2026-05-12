/**
 * Tests — Evaluation Engine
 * Pure functions only (no DB).
 */

import { describe, it, expect } from "vitest";

import { runContradictionChecker } from "../evaluation-engine/contradiction-checker.js";
import { runEvidenceCoverageChecker } from "../evaluation-engine/evidence-coverage-checker.js";
import { runScoreConsistencyChecker } from "../evaluation-engine/score-consistency-checker.js";
import { runStalenessChecker } from "../evaluation-engine/staleness-checker.js";
import { runFailOpenChecker } from "../evaluation-engine/fail-open-checker.js";
import { runEvaluatorPass } from "../evaluation-engine/service.js";
import type { EvaluatorInput } from "../evaluation-engine/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseInput(overrides: Partial<EvaluatorInput> = {}): EvaluatorInput {
  return {
    deal_id: "deal-test-001",
    run_id: "run-001",
    ors_score: 65,
    dci_score: 60,
    fhc_score: 55,
    urss_score: 40,
    verdict: "CONSIDER",
    scoreband_key: "consider_caution",
    evidence_count: 12,
    contradiction_count: 0,
    section_count: 6,
    dpu_provenance_missing: false,
    xlsx_extraction_had_llm_fallback: false,
    evidence_gate_passed: true,
    investor_insights_status: "complete",
    llm_cache_age_days: 3,
    arr_narrative: 500_000,
    arr_structured: 500_000,
    financial_completeness_pct: 70,
    ...overrides,
  };
}

// ─── Contradiction checker ─────────────────────────────────────────────────

describe("runContradictionChecker", () => {
  it("returns no flags when ARR matches within tolerance", () => {
    const flags = runContradictionChecker(baseInput({ arr_narrative: 500_000, arr_structured: 520_000 }));
    const arrFlags = flags.filter((f) => f.flag_type === "revenue_narrative_vs_structured");
    expect(arrFlags).toHaveLength(0);
  });

  it("returns ERROR when ARR diverges > 2x", () => {
    const flags = runContradictionChecker(
      baseInput({ arr_narrative: 1_000_000, arr_structured: 200_000 })
    );
    const errFlags = flags.filter((f) => f.flag_type === "revenue_narrative_vs_structured");
    expect(errFlags.length).toBeGreaterThan(0);
    expect(errFlags[0].severity).toBe("ERROR");
  });

  it("returns ERROR when ORS < 55 with GO verdict", () => {
    const flags = runContradictionChecker(baseInput({ ors_score: 45, verdict: "GO" }));
    const verdictFlags = flags.filter((f) => f.flag_type === "verdict_score_gap");
    expect(verdictFlags.length).toBeGreaterThan(0);
    expect(verdictFlags[0].severity).toBe("ERROR");
  });

  it("returns WARN when ORS > 70 with NO_GO verdict", () => {
    const flags = runContradictionChecker(baseInput({ ors_score: 78, verdict: "NO_GO" }));
    const verdictFlags = flags.filter((f) => f.flag_type === "verdict_score_gap");
    expect(verdictFlags.length).toBeGreaterThan(0);
    expect(verdictFlags[0].severity).toBe("WARN");
  });

  it("returns no flags for clean input", () => {
    const flags = runContradictionChecker(baseInput());
    expect(flags).toHaveLength(0);
  });
});

// ─── Evidence coverage checker ─────────────────────────────────────────────

describe("runEvidenceCoverageChecker", () => {
  it("returns ERROR when evidence count < 5", () => {
    const flags = runEvidenceCoverageChecker(baseInput({ evidence_count: 3 }));
    const f = flags.filter((f) => f.flag_type === "evidence_count_below_floor");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("ERROR");
  });

  it("returns WARN when evidence count between 5 and 9", () => {
    const flags = runEvidenceCoverageChecker(baseInput({ evidence_count: 7 }));
    const f = flags.filter((f) => f.flag_type === "evidence_count_below_floor");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("WARN");
  });

  it("returns no evidence-count flag when count >= 10", () => {
    const flags = runEvidenceCoverageChecker(baseInput({ evidence_count: 15 }));
    const f = flags.filter((f) => f.flag_type === "evidence_count_below_floor");
    expect(f).toHaveLength(0);
  });

  it("returns CRITICAL when section_count is 0", () => {
    const flags = runEvidenceCoverageChecker(baseInput({ section_count: 0 }));
    const f = flags.filter((f) => f.flag_type === "zero_sections_produced");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("CRITICAL");
  });
});

// ─── Score consistency checker ─────────────────────────────────────────────

describe("runScoreConsistencyChecker", () => {
  it("returns ERROR when URSS > 80 with GO verdict", () => {
    const flags = runScoreConsistencyChecker(baseInput({ urss_score: 85, verdict: "GO" }));
    const f = flags.filter((f) => f.flag_type === "urss_verdict_mismatch");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("ERROR");
  });

  it("returns no flags for clean scores", () => {
    const flags = runScoreConsistencyChecker(baseInput());
    expect(flags).toHaveLength(0);
  });
});

// ─── Staleness checker ─────────────────────────────────────────────────────

describe("runStalenessChecker", () => {
  it("returns WARN when cache age > 14 days", () => {
    const flags = runStalenessChecker(baseInput({ llm_cache_age_days: 20 }));
    const f = flags.filter((f) => f.flag_type === "llm_cache_stale");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("WARN");
  });

  it("returns no flag when cache age <= 14 days", () => {
    const flags = runStalenessChecker(baseInput({ llm_cache_age_days: 10 }));
    const f = flags.filter((f) => f.flag_type === "llm_cache_stale");
    expect(f).toHaveLength(0);
  });

  it("returns no flag when cache age is null", () => {
    const flags = runStalenessChecker(baseInput({ llm_cache_age_days: null }));
    const f = flags.filter((f) => f.flag_type === "llm_cache_stale");
    expect(f).toHaveLength(0);
  });
});

// ─── Fail-open checker ─────────────────────────────────────────────────────

describe("runFailOpenChecker", () => {
  it("returns WARN when DPU provenance is missing", () => {
    const flags = runFailOpenChecker(baseInput({ dpu_provenance_missing: true }));
    const f = flags.filter((f) => f.flag_type === "dpu_provenance_missing");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("WARN");
  });

  it("returns WARN when XLSX used LLM fallback", () => {
    const flags = runFailOpenChecker(baseInput({ xlsx_extraction_had_llm_fallback: true }));
    const f = flags.filter((f) => f.flag_type === "xlsx_extraction_llm_fallback");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].severity).toBe("WARN");
  });

  it("returns no flags for a clean pipeline run", () => {
    const flags = runFailOpenChecker(baseInput());
    expect(flags).toHaveLength(0);
  });
});

// ─── Full evaluator pass ───────────────────────────────────────────────────

describe("runEvaluatorPass", () => {
  it("returns clean summary for clean input", () => {
    const report = runEvaluatorPass(baseInput());
    expect(report.summary.clean).toBe(true);
    expect(report.summary.total_flags).toBe(0);
  });

  it("counts flags correctly across severities", () => {
    const input = baseInput({
      dpu_provenance_missing: true,
      xlsx_extraction_had_llm_fallback: true,
      arr_narrative: 2_000_000,
      arr_structured: 100_000,
    });
    const report = runEvaluatorPass(input);
    expect(report.summary.total_flags).toBeGreaterThan(0);
    expect(report.summary.clean).toBe(false);
  });

  it("all flag_ids are non-empty strings", () => {
    const input = baseInput({ dpu_provenance_missing: true });
    const report = runEvaluatorPass(input);
    for (const flag of report.flags) {
      expect(typeof flag.flag_id).toBe("string");
      expect(flag.flag_id.length).toBeGreaterThan(0);
    }
  });
});
