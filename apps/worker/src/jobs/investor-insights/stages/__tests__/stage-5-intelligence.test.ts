/**
 * Tests — Stage 5 Intelligence Pass
 *
 * Covers:
 *   1. resolveRolloutMode() — env-var branch logic (8 cases)
 *   2. shouldPersist()      — tested indirectly: whether persist functions
 *                             are called depends on the resolved mode
 *   3. Non-blocking behavior — runIntelligenceStage never throws
 *   4. stage5_error semantics:
 *        • null on full success
 *        • null on persistence failure (inner try-catch, non-fatal)
 *        • set to error.message on hard (core-service) failure
 *   5. Log event shapes:
 *        • intelligence.stage5.completed has required fields
 *        • intelligence.evaluation.completed uses `total_flags`, not `flag_count`
 *        • `total_duration_ms` is never emitted (deprecated field name)
 *        • intelligence.stage5.skipped emitted with reason when disabled
 *        • intelligence.stage5.failed emitted with `error` on hard failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

import {
  resolveRolloutMode,
  runIntelligenceStage,
  type Stage5Inputs,
} from "../stage-5-intelligence.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────
//
// All four intelligence service modules are mocked so the tests exercise the
// Stage 5 orchestration logic (gating, logging, error isolation) without
// touching the DB or real algorithms.

vi.mock("../../../../lib/intelligence/decision-memory/service.js", () => ({
  buildMemorySnapshot: vi.fn(() => ({})),
  persistAndRecallMemory: vi.fn(async () => ({
    memory_snapshot_id: "mem-snap-001",
    similar_deals: [],
  })),
}));

vi.mock("../../../../lib/intelligence/evaluation-engine/service.js", () => ({
  runEvaluatorPass: vi.fn(() => ({
    deal_id: "deal-test",
    run_id: "",
    flags: [],
    summary: {
      total_flags: 2,
      critical_count: 0,
      error_count: 1,
      warn_count: 1,
      info_count: 0,
      clean: false,
    },
  })),
  persistEvaluationFlags: vi.fn(async () => {}),
}));

vi.mock("../../../../lib/intelligence/confidence-engine/service.js", () => ({
  computeConfidence: vi.fn(() => ({
    deal_id: "deal-test",
    intelligence_run_id: "",
    overall_confidence_score: 72,
    overall_confidence_band: "Medium",
    penalties_applied: [],
    conclusions: [],
    rationale: "Mock confidence.",
  })),
  persistConfidenceReport: vi.fn(async () => {}),
}));

vi.mock("../../../../lib/intelligence/challenge-pass/service.js", () => ({
  runChallengePass: vi.fn(() => ({
    deal_id: "deal-test",
    intelligence_run_id: "",
    verdict_resistance_score: 65,
    verdict_resistance_label: "Moderate",
    opposing_case_summary: "Mock challenge.",
    overconfident_claims: [],
    missing_evidence: [],
    diligence_gaps: [],
    flag_count_critical: 0,
    flag_count_error: 0,
    flag_count_warn: 0,
  })),
  persistChallengePassResult: vi.fn(async () => {}),
}));

vi.mock("../../../../lib/intelligence/metrics.js", () => ({
  intelligenceMetrics: {
    increment: vi.fn(),
    timing: vi.fn(),
    snapshot: vi.fn(() => ({})),
    emitSnapshot: vi.fn(),
    _reset: vi.fn(),
  },
}));

// ─── Import mocked functions for call assertions ───────────────────────────────

import {
  persistAndRecallMemory,
} from "../../../../lib/intelligence/decision-memory/service.js";
import {
  runEvaluatorPass,
  persistEvaluationFlags,
} from "../../../../lib/intelligence/evaluation-engine/service.js";
import {
  persistConfidenceReport,
} from "../../../../lib/intelligence/confidence-engine/service.js";
import {
  persistChallengePassResult,
} from "../../../../lib/intelligence/challenge-pass/service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fakePool = {} as Pool;

function baseInputs(overrides: Partial<Stage5Inputs> = {}): Stage5Inputs {
  return {
    deal_id: "deal-test-001",
    deal_name: "Test Deal",
    org_id: "org-001",
    engine_version: "1.0.0",
    upstream_fingerprint: "fp-abc",
    ors_score: 65,
    dci_score: 60,
    fhc_score: 55,
    urss_score: 30,
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
    burn_rate_monthly: 80_000,
    runway_months: 18,
    cash_on_hand: 1_440_000,
    financial_completeness_pct: 75,
    has_xlsx: true,
    has_cap_table: false,
    ...overrides,
  };
}

/**
 * Parse structured JSON log events from console.log spy calls.
 * Returns only objects that have an `event` string field.
 */
function parseLogCalls(calls: unknown[][]): Record<string, unknown>[] {
  return calls
    .map(([first]) => {
      if (typeof first !== "string") return null;
      try {
        const parsed = JSON.parse(first) as Record<string, unknown>;
        return typeof parsed.event === "string" ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

// ─── Env var lifecycle ────────────────────────────────────────────────────────

let savedEnabled: string | undefined;
let savedMode: string | undefined;

beforeEach(() => {
  savedEnabled = process.env.DDAI_INTELLIGENCE_LAYER_ENABLED;
  savedMode = process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE;
  delete process.env.DDAI_INTELLIGENCE_LAYER_ENABLED;
  delete process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE;
  vi.clearAllMocks();
});

afterEach(() => {
  if (savedEnabled !== undefined) {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = savedEnabled;
  } else {
    delete process.env.DDAI_INTELLIGENCE_LAYER_ENABLED;
  }
  if (savedMode !== undefined) {
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = savedMode;
  } else {
    delete process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE;
  }
  vi.restoreAllMocks(); // restore any console spies
});

// ─── 1. resolveRolloutMode() ──────────────────────────────────────────────────

describe("resolveRolloutMode()", () => {
  it('returns "off" when DDAI_INTELLIGENCE_LAYER_ENABLED is unset', () => {
    expect(resolveRolloutMode()).toBe("off");
  });

  it('returns "off" when DDAI_INTELLIGENCE_LAYER_ENABLED = "0"', () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "0";
    expect(resolveRolloutMode()).toBe("off");
  });

  it('returns "off" when DDAI_INTELLIGENCE_LAYER_ENABLED = "false"', () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "false";
    expect(resolveRolloutMode()).toBe("off");
  });

  it('returns "full" when ENABLED = "1" and MODE is unset', () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    expect(resolveRolloutMode()).toBe("full");
  });

  it('returns "shadow" when ENABLED = "1" and MODE = "shadow"', () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";
    expect(resolveRolloutMode()).toBe("shadow");
  });

  it('returns "persist_only" when ENABLED = "1" and MODE = "persist_only"', () => {
    // Note: "active" is not a valid IntelligenceRolloutMode.
    // Valid persist=true modes are: "persist_only", "internal_expose", "full".
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "persist_only";
    expect(resolveRolloutMode()).toBe("persist_only");
  });

  it('returns "off" when ENABLED = "1" and MODE = "off"', () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "off";
    expect(resolveRolloutMode()).toBe("off");
  });

  it('returns "full" when ENABLED = "1" and MODE is an unrecognized string', () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "active"; // not a valid mode → fallback
    expect(resolveRolloutMode()).toBe("full");
  });
});

// ─── 2. shouldPersist() — via observed call behavior ─────────────────────────
//
// shouldPersist() is a private function. We verify it indirectly by checking
// whether the four persist functions are called (or not) per mode.

describe("shouldPersist() — indirectly via persist call behavior", () => {
  it("does NOT call any persist function in shadow mode", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";

    await runIntelligenceStage(fakePool, baseInputs());

    expect(vi.mocked(persistAndRecallMemory)).not.toHaveBeenCalled();
    expect(vi.mocked(persistEvaluationFlags)).not.toHaveBeenCalled();
    expect(vi.mocked(persistConfidenceReport)).not.toHaveBeenCalled();
    expect(vi.mocked(persistChallengePassResult)).not.toHaveBeenCalled();
  });

  it("calls all four persist functions in persist_only mode", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "persist_only";

    await runIntelligenceStage(fakePool, baseInputs());

    expect(vi.mocked(persistAndRecallMemory)).toHaveBeenCalledOnce();
    expect(vi.mocked(persistEvaluationFlags)).toHaveBeenCalledOnce();
    expect(vi.mocked(persistConfidenceReport)).toHaveBeenCalledOnce();
    expect(vi.mocked(persistChallengePassResult)).toHaveBeenCalledOnce();
  });

  it("calls all four persist functions in full mode", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "full";

    await runIntelligenceStage(fakePool, baseInputs());

    expect(vi.mocked(persistAndRecallMemory)).toHaveBeenCalledOnce();
    expect(vi.mocked(persistEvaluationFlags)).toHaveBeenCalledOnce();
    expect(vi.mocked(persistConfidenceReport)).toHaveBeenCalledOnce();
    expect(vi.mocked(persistChallengePassResult)).toHaveBeenCalledOnce();
  });
});

// ─── 3. Non-blocking behavior ─────────────────────────────────────────────────
//
// runIntelligenceStage must never throw — errors are captured in stage5_error.

describe("non-blocking behavior", () => {
  it("resolves (does not throw) when a core service function throws", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";

    vi.mocked(runEvaluatorPass).mockImplementationOnce(() => {
      throw new Error("evaluator exploded");
    });

    await expect(runIntelligenceStage(fakePool, baseInputs())).resolves.toBeDefined();
  });

  it("resolves (does not throw) when a persistence function rejects", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "full";

    vi.mocked(persistConfidenceReport).mockRejectedValueOnce(new Error("DB write failed"));

    await expect(runIntelligenceStage(fakePool, baseInputs())).resolves.toBeDefined();
  });
});

// ─── 4. stage5_error semantics ────────────────────────────────────────────────

describe("stage5_error semantics", () => {
  it("is null on a fully successful run", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "full";

    const result = await runIntelligenceStage(fakePool, baseInputs());

    expect(result.stage5_error).toBeNull();
  });

  it("is null when a persistence function rejects (inner try-catch, non-fatal)", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "full";

    // Persistence failures are caught in per-subsystem inner try-catch blocks.
    // The outer catch is never reached → stage5_error stays null.
    vi.mocked(persistConfidenceReport).mockRejectedValueOnce(new Error("DB write failed"));

    const result = await runIntelligenceStage(fakePool, baseInputs());

    expect(result.stage5_error).toBeNull();
  });

  it("is set to error.message when a core service function throws", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";

    vi.mocked(runEvaluatorPass).mockImplementationOnce(() => {
      throw new Error("evaluator exploded");
    });

    const result = await runIntelligenceStage(fakePool, baseInputs());

    expect(result.stage5_error).toBe("evaluator exploded");
  });

  it("is null on the disabled (skipped) path", async () => {
    // ENABLED unset → mode = "off" → disabledResult() → stage5_error: null
    const result = await runIntelligenceStage(fakePool, baseInputs());

    expect(result.stage5_error).toBeNull();
  });
});

// ─── 5. Log event shapes ──────────────────────────────────────────────────────

describe("log event shapes", () => {
  it("emits intelligence.stage5.skipped with reason when the layer is disabled", async () => {
    // ENABLED is unset (deleted in beforeEach) → mode resolves to "off"
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runIntelligenceStage(fakePool, baseInputs({ deal_id: "deal-skipped" }));

    const events = parseLogCalls(logSpy.mock.calls);
    const skippedEvent = events.find((e) => e.event === "intelligence.stage5.skipped");

    expect(skippedEvent).toBeDefined();
    expect(skippedEvent?.deal_id).toBe("deal-skipped");
    // reason is intentionally coarse — covers both ENABLED unset and MODE=off
    expect(skippedEvent?.reason).toBe("feature_flag_off");
  });

  it("emits intelligence.stage5.completed with all required fields", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runIntelligenceStage(fakePool, baseInputs());

    const events = parseLogCalls(logSpy.mock.calls);
    const completed = events.find((e) => e.event === "intelligence.stage5.completed");

    expect(completed).toBeDefined();
    expect(typeof completed?.run_id).toBe("string");
    expect(completed?.rollout_mode).toBe("shadow");
    expect(typeof completed?.duration_ms).toBe("number");
    expect(typeof completed?.total_flags).toBe("number");
    expect(typeof completed?.confidence_score).toBe("number");
    expect(typeof completed?.confidence_band).toBe("string");
    expect(typeof completed?.verdict_resistance).toBe("number");
    expect(typeof completed?.persisted).toBe("boolean");
    // shadow mode → shouldPersist = false
    expect(completed?.persisted).toBe(false);
  });

  it("emits intelligence.evaluation.completed with total_flags (not flag_count)", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runIntelligenceStage(fakePool, baseInputs());

    const events = parseLogCalls(logSpy.mock.calls);
    const evalEvent = events.find((e) => e.event === "intelligence.evaluation.completed");

    expect(evalEvent).toBeDefined();
    // Correct field name
    expect(typeof evalEvent?.total_flags).toBe("number");
    // flag_count is a deprecated alias that was never emitted by this stage
    expect(evalEvent?.flag_count).toBeUndefined();
  });

  it("never emits total_duration_ms in any log event (deprecated field name)", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "full";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runIntelligenceStage(fakePool, baseInputs());

    const events = parseLogCalls(logSpy.mock.calls);
    for (const event of events) {
      // Correct field name is duration_ms — total_duration_ms was never emitted
      expect(event.total_duration_ms).toBeUndefined();
    }
  });

  it("emits intelligence.stage5.failed with error field on a hard failure", async () => {
    process.env.DDAI_INTELLIGENCE_LAYER_ENABLED = "1";
    process.env.DDAI_INTELLIGENCE_ROLLOUT_MODE = "shadow";

    vi.mocked(runEvaluatorPass).mockImplementationOnce(() => {
      throw new Error("hard failure");
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runIntelligenceStage(fakePool, baseInputs());

    const errorEvents = parseLogCalls(errSpy.mock.calls);
    const failedEvent = errorEvents.find((e) => e.event === "intelligence.stage5.failed");

    expect(failedEvent).toBeDefined();
    expect(failedEvent?.error).toBe("hard failure");
    expect(typeof failedEvent?.duration_ms).toBe("number");
    // total_duration_ms is the deprecated name — never emitted
    expect(failedEvent?.total_duration_ms).toBeUndefined();
  });
});
