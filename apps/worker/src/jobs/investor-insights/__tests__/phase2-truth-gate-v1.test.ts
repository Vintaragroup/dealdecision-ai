/**
 * Phase 2 Fix #4 — Truth-state gating for scoring.
 *
 * Verifies that:
 *  1. applyTruthGatesV1 correctly blocks/allows canonical fields based on truth state.
 *  2. computeMarketScoreRaw does not credit truth-gated fields.
 *  3. formatCanonicalFieldLine serialises the truth-gate info.
 *  4. parseCanonicalFieldsBody round-trips truth_gate_blocked through text serialisation.
 */

import { describe, it, expect } from "vitest";
import { applyTruthGatesV1, formatCanonicalFieldLine } from "../stages/stage-2-deterministic.js";
import { computeMarketScoreRaw } from "../../../orchestrator/compute-ors.js";
import { parseCanonicalFieldsBody } from "../../../orchestrator/render-package-helpers.js";
import type { FinancialTruthMapV1 } from "../../../lib/financial-facts/build-financial-truth-v1.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

type TestCanonicalField = Parameters<typeof applyTruthGatesV1>[0][number];

function makeField(fieldName: string, overrides: Partial<TestCanonicalField> = {}): TestCanonicalField {
  return {
    category: "traction_signal",
    field: fieldName,
    computability: "Computable",
    value: `$500,000 ${fieldName.toUpperCase()} (latest, XLSX)`,
    evidenceRef: "dpu:doc:abcdef01:page:2",
    reasonCode: "DERIVED_FROM_SAAS_KPI",
    source: "xlsx",
    ...overrides,
  };
}

function makeTruthMap(overrides: Record<string, Partial<FinancialTruthMapV1[string]>>): FinancialTruthMapV1 {
  const base: FinancialTruthMapV1 = {};
  for (const [key, vals] of Object.entries(overrides)) {
    base[key] = {
      metric: key,
      state: "CONFIRMED",
      resolved_value: 500_000,
      resolved_source_kind: "xlsx",
      resolution_strategy: "single_source",
      disagreement: false,
      sources: [],
      source_count: 1,
      has_xlsx_source: true,
      has_deck_source: false,
      disagreement_pct: null,
      ...vals,
    };
  }
  return base;
}

// ─── Section 1: applyTruthGatesV1 — no truth map ────────────────────────────

describe("applyTruthGatesV1 — missing truth map", () => {
  it("no gate when financialTruth is undefined (permissive default)", () => {
    const arr = makeField("arr_value");
    applyTruthGatesV1([arr], undefined);
    expect(arr.truth_gate_blocked).toBeUndefined();
    expect(arr.truth_gate_reason).toBeUndefined();
  });

  it("no gate when financialTruth is null", () => {
    const mrr = makeField("mrr_value");
    applyTruthGatesV1([mrr], null);
    expect(mrr.truth_gate_blocked).toBeUndefined();
  });

  it("no gate when truth map has no entry for the metric", () => {
    const rev = makeField("revenue_value");
    applyTruthGatesV1([rev], {}); // empty map
    expect(rev.truth_gate_blocked).toBeUndefined();
  });
});

// ─── Section 2: applyTruthGatesV1 — CONFIRMED state ─────────────────────────

describe("applyTruthGatesV1 — CONFIRMED state (no gate)", () => {
  it("arr_value with CONFIRMED → not blocked", () => {
    const arr = makeField("arr_value");
    applyTruthGatesV1([arr], makeTruthMap({ arr: { state: "CONFIRMED" } }));
    expect(arr.truth_gate_blocked).toBeUndefined();
    expect(arr.truth_gate_reason).toBeUndefined();
  });

  it("mrr_value with CONFIRMED → not blocked", () => {
    const mrr = makeField("mrr_value");
    applyTruthGatesV1([mrr], makeTruthMap({ mrr: { state: "CONFIRMED" } }));
    expect(mrr.truth_gate_blocked).toBeUndefined();
  });

  it("revenue_value with CONFIRMED → not blocked", () => {
    const rev = makeField("revenue_value");
    applyTruthGatesV1([rev], makeTruthMap({ revenue: { state: "CONFIRMED" } }));
    expect(rev.truth_gate_blocked).toBeUndefined();
  });
});

// ─── Section 3: applyTruthGatesV1 — CONFLICT state ──────────────────────────

describe("applyTruthGatesV1 — CONFLICT state", () => {
  it("arr_value with CONFLICT → blocked with reason TRUTH_CONFLICT:ARR", () => {
    const arr = makeField("arr_value");
    applyTruthGatesV1([arr], makeTruthMap({ arr: { state: "CONFLICT" } }));
    expect(arr.truth_gate_blocked).toBe(true);
    expect(arr.truth_gate_reason).toBe("TRUTH_CONFLICT:ARR");
  });

  it("mrr_value with CONFLICT → blocked with reason TRUTH_CONFLICT:MRR", () => {
    const mrr = makeField("mrr_value");
    applyTruthGatesV1([mrr], makeTruthMap({ mrr: { state: "CONFLICT" } }));
    expect(mrr.truth_gate_blocked).toBe(true);
    expect(mrr.truth_gate_reason).toBe("TRUTH_CONFLICT:MRR");
  });

  it("revenue_value with CONFLICT → blocked with reason TRUTH_CONFLICT:REVENUE", () => {
    const rev = makeField("revenue_value");
    applyTruthGatesV1([rev], makeTruthMap({ revenue: { state: "CONFLICT" } }));
    expect(rev.truth_gate_blocked).toBe(true);
    expect(rev.truth_gate_reason).toBe("TRUTH_CONFLICT:REVENUE");
  });
});

// ─── Section 4: applyTruthGatesV1 — INSUFFICIENT state ──────────────────────

describe("applyTruthGatesV1 — INSUFFICIENT state", () => {
  it("arr_value with INSUFFICIENT → blocked with reason TRUTH_INSUFFICIENT:ARR", () => {
    const arr = makeField("arr_value");
    applyTruthGatesV1([arr], makeTruthMap({ arr: { state: "INSUFFICIENT" } }));
    expect(arr.truth_gate_blocked).toBe(true);
    expect(arr.truth_gate_reason).toBe("TRUTH_INSUFFICIENT:ARR");
  });

  it("mrr_value with INSUFFICIENT → blocked", () => {
    const mrr = makeField("mrr_value");
    applyTruthGatesV1([mrr], makeTruthMap({ mrr: { state: "INSUFFICIENT" } }));
    expect(mrr.truth_gate_blocked).toBe(true);
    expect(mrr.truth_gate_reason).toBe("TRUTH_INSUFFICIENT:MRR");
  });

  it("revenue_value with INSUFFICIENT → blocked", () => {
    const rev = makeField("revenue_value");
    applyTruthGatesV1([rev], makeTruthMap({ revenue: { state: "INSUFFICIENT" } }));
    expect(rev.truth_gate_blocked).toBe(true);
    expect(rev.truth_gate_reason).toBe("TRUTH_INSUFFICIENT:REVENUE");
  });
});

// ─── Section 5: applyTruthGatesV1 — projected_only_dataset ──────────────────

describe("applyTruthGatesV1 — projected_only_dataset=true", () => {
  it("arr_value with projected_only_dataset=true → blocked with TRUTH_PROJECTED_ONLY:ARR", () => {
    const arr = makeField("arr_value");
    applyTruthGatesV1([arr], makeTruthMap({ arr: { state: "CONFIRMED", projected_only_dataset: true } }));
    expect(arr.truth_gate_blocked).toBe(true);
    expect(arr.truth_gate_reason).toBe("TRUTH_PROJECTED_ONLY:ARR");
  });

  it("mrr_value with projected_only_dataset=true → blocked", () => {
    const mrr = makeField("mrr_value");
    applyTruthGatesV1([mrr], makeTruthMap({ mrr: { state: "CONFIRMED", projected_only_dataset: true } }));
    expect(mrr.truth_gate_blocked).toBe(true);
    expect(mrr.truth_gate_reason).toBe("TRUTH_PROJECTED_ONLY:MRR");
  });

  it("revenue_value with projected_only_dataset=true → blocked", () => {
    const rev = makeField("revenue_value");
    applyTruthGatesV1([rev], makeTruthMap({ revenue: { state: "CONFIRMED", projected_only_dataset: true } }));
    expect(rev.truth_gate_blocked).toBe(true);
    expect(rev.truth_gate_reason).toBe("TRUTH_PROJECTED_ONLY:REVENUE");
  });

  it("projected_only_dataset=false and CONFIRMED → no gate", () => {
    const arr = makeField("arr_value");
    applyTruthGatesV1([arr], makeTruthMap({ arr: { state: "CONFIRMED", projected_only_dataset: false } }));
    expect(arr.truth_gate_blocked).toBeUndefined();
  });
});

// ─── Section 6: applyTruthGatesV1 — non-gated fields ────────────────────────

describe("applyTruthGatesV1 — non-gated fields pass through unchanged", () => {
  it("growth_rate is not in TRUTH_GATED_FIELDS → never blocked", () => {
    const gt = makeField("growth_rate");
    applyTruthGatesV1([gt], makeTruthMap({ revenue: { state: "CONFLICT" } }));
    expect(gt.truth_gate_blocked).toBeUndefined();
  });

  it("customer_count is not in TRUTH_GATED_FIELDS → never blocked", () => {
    const cc = makeField("customer_count");
    applyTruthGatesV1([cc], makeTruthMap({ arr: { state: "INSUFFICIENT" } }));
    expect(cc.truth_gate_blocked).toBeUndefined();
  });

  it("tam_value is not in TRUTH_GATED_FIELDS → never blocked", () => {
    const tam = makeField("tam_value");
    applyTruthGatesV1([tam], makeTruthMap({ revenue: { state: "CONFLICT" } }));
    expect(tam.truth_gate_blocked).toBeUndefined();
  });

  it("NotComputable fields are skipped even if in TRUTH_GATED_FIELDS", () => {
    const arr = makeField("arr_value", { computability: "NotComputable", value: null, evidenceRef: null });
    applyTruthGatesV1([arr], makeTruthMap({ arr: { state: "CONFLICT" } }));
    // Gate never runs on NotComputable — no change needed since they don't score anyway
    expect(arr.truth_gate_blocked).toBeUndefined();
  });
});

// ─── Section 7: applyTruthGatesV1 — mixed field array ───────────────────────

describe("applyTruthGatesV1 — mixed field array", () => {
  it("gates only the fields with bad truth states, leaves others intact", () => {
    const arrConflict = makeField("arr_value");
    const mrrConfirmed = makeField("mrr_value");
    const revInsufficient = makeField("revenue_value");
    const growthRate = makeField("growth_rate");

    const truth = makeTruthMap({
      arr: { state: "CONFLICT" },
      mrr: { state: "CONFIRMED" },
      revenue: { state: "INSUFFICIENT" },
    });

    applyTruthGatesV1([arrConflict, mrrConfirmed, revInsufficient, growthRate], truth);

    expect(arrConflict.truth_gate_blocked).toBe(true);
    expect(arrConflict.truth_gate_reason).toBe("TRUTH_CONFLICT:ARR");

    expect(mrrConfirmed.truth_gate_blocked).toBeUndefined();

    expect(revInsufficient.truth_gate_blocked).toBe(true);
    expect(revInsufficient.truth_gate_reason).toBe("TRUTH_INSUFFICIENT:REVENUE");

    expect(growthRate.truth_gate_blocked).toBeUndefined();
  });
});

// ─── Section 8: computeMarketScoreRaw — truth-gate integration ───────────────

describe("computeMarketScoreRaw — truth_gate_blocked excludes fields from score", () => {
  it("arr_value truth_gate_blocked=false (or absent) → gets scoring credit", () => {
    const fields = [
      { field: "arr_value", computability: "Computable" },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(15); // ARR/MRR bucket = 15pts
  });

  it("arr_value truth_gate_blocked=true → no scoring credit", () => {
    const fields = [
      { field: "arr_value", computability: "Computable", truth_gate_blocked: true },
    ];
    const { market_score_raw, missing_inputs } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(0);
    expect(missing_inputs).toContain("arr_value_or_mrr_value");
  });

  it("mrr_value truth_gate_blocked=true → no scoring credit", () => {
    const fields = [
      { field: "mrr_value", computability: "Computable", truth_gate_blocked: true },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(0);
  });

  it("revenue_value truth_gate_blocked=true → no scoring credit", () => {
    const fields = [
      { field: "revenue_value", computability: "Computable", truth_gate_blocked: true },
    ];
    const { market_score_raw, missing_inputs } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(0);
    expect(missing_inputs).toContain("revenue_value");
  });

  it("arr_value truth_gate_blocked=false → same as no flag", () => {
    const withFalse = computeMarketScoreRaw([{ field: "arr_value", computability: "Computable", truth_gate_blocked: false }]);
    const withoutFlag = computeMarketScoreRaw([{ field: "arr_value", computability: "Computable" }]);
    expect(withFalse.market_score_raw).toBe(withoutFlag.market_score_raw);
  });

  it("arr CONFIRMED + mrr CONFLICT → only mrr is blocked, arr still scores", () => {
    const fields = [
      { field: "arr_value", computability: "Computable", truth_gate_blocked: false },
      { field: "mrr_value", computability: "Computable", truth_gate_blocked: true },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    // arr_value passes, mrr_value is blocked → arr/mrr bucket = 15
    expect(market_score_raw).toBe(15);
  });

  it("both arr and mrr truth-gated → no ARR/MRR credit even with other fields present", () => {
    const fields = [
      { field: "arr_value", computability: "Computable", truth_gate_blocked: true },
      { field: "mrr_value", computability: "Computable", truth_gate_blocked: true },
      { field: "tam_value", computability: "Computable" },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    // TAM = 20, ARR/MRR bucket = 0 (both gated)
    expect(market_score_raw).toBe(20);
  });

  it("full score with all fields Computable and no gates", () => {
    const fields = [
      { field: "tam_value", computability: "Computable" },
      { field: "sam_value", computability: "Computable" },
      { field: "som_value", computability: "Computable" },
      { field: "arr_value", computability: "Computable" },
      { field: "revenue_value", computability: "Computable" },
      { field: "growth_rate", computability: "Computable" },
      { field: "customer_count", computability: "Computable" },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(100);
  });

  it("full score drops by 15 when arr is truth-gated (no mrr fallback)", () => {
    const fields = [
      { field: "tam_value", computability: "Computable" },
      { field: "sam_value", computability: "Computable" },
      { field: "som_value", computability: "Computable" },
      { field: "arr_value", computability: "Computable", truth_gate_blocked: true },
      { field: "revenue_value", computability: "Computable" },
      { field: "growth_rate", computability: "Computable" },
      { field: "customer_count", computability: "Computable" },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(85); // 100 - 15 (ARR/MRR bucket)
  });

  it("full score drops by 10 when revenue is truth-gated", () => {
    const fields = [
      { field: "tam_value", computability: "Computable" },
      { field: "sam_value", computability: "Computable" },
      { field: "som_value", computability: "Computable" },
      { field: "arr_value", computability: "Computable" },
      { field: "revenue_value", computability: "Computable", truth_gate_blocked: true },
      { field: "growth_rate", computability: "Computable" },
      { field: "customer_count", computability: "Computable" },
    ];
    const { market_score_raw } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(90); // 100 - 10 (revenue bucket)
  });
});

// ─── Section 9: formatCanonicalFieldLine — truth_gate serialisation ───────────

describe("formatCanonicalFieldLine — truth_gate serialisation", () => {
  it("Computable field with no gate → no truth_gate suffix in output", () => {
    const field = makeField("arr_value");
    const line = formatCanonicalFieldLine(field as Parameters<typeof formatCanonicalFieldLine>[0]);
    expect(line).toContain("computability=Computable");
    expect(line).not.toContain("truth_gate=");
  });

  it("Computable field with truth_gate_blocked=true → emits truth_gate=blocked", () => {
    const field = makeField("arr_value");
    field.truth_gate_blocked = true;
    field.truth_gate_reason = "TRUTH_CONFLICT:ARR";
    const line = formatCanonicalFieldLine(field as Parameters<typeof formatCanonicalFieldLine>[0]);
    expect(line).toContain("computability=Computable");
    expect(line).toContain("truth_gate=blocked");
    expect(line).toContain("truth_gate_reason=TRUTH_CONFLICT:ARR");
  });

  it("Computable field with projected_only gate → emits correct reason", () => {
    const field = makeField("mrr_value");
    field.truth_gate_blocked = true;
    field.truth_gate_reason = "TRUTH_PROJECTED_ONLY:MRR";
    const line = formatCanonicalFieldLine(field as Parameters<typeof formatCanonicalFieldLine>[0]);
    expect(line).toContain("truth_gate=blocked");
    expect(line).toContain("truth_gate_reason=TRUTH_PROJECTED_ONLY:MRR");
  });

  it("NotComputable field → no truth_gate even if truth_gate_blocked is set", () => {
    const field = makeField("arr_value", {
      computability: "NotComputable",
      value: null,
      evidenceRef: null,
    });
    field.truth_gate_blocked = true;
    const line = formatCanonicalFieldLine(field as Parameters<typeof formatCanonicalFieldLine>[0]);
    expect(line).toContain("computability=NotComputable");
    expect(line).not.toContain("truth_gate=");
  });
});

// ─── Section 10: parseCanonicalFieldsBody — round-trip ──────────────────────

describe("parseCanonicalFieldsBody — truth_gate round-trip", () => {
  it("parses truth_gate=blocked correctly from a serialised line", () => {
    const body =
      'category=traction_signal | field=arr_value | computability=Computable | value="$500,000 ARR (latest, XLSX)" | evidence=dpu:doc:abcdef01:page:2 | reason=DERIVED_FROM_SAAS_KPI | source=xlsx | confidence=STRONG_EVIDENCE | truth_gate=blocked | truth_gate_reason=TRUTH_CONFLICT:ARR';
    const fields = parseCanonicalFieldsBody(body);
    expect(fields).toHaveLength(1);
    const f = fields[0]!;
    expect(f.field).toBe("arr_value");
    expect(f.computability).toBe("Computable");
    expect(f.truth_gate_blocked).toBe(true);
    expect(f.truth_gate_reason).toBe("TRUTH_CONFLICT:ARR");
  });

  it("parses projected_only reason correctly", () => {
    const body =
      'category=traction_signal | field=mrr_value | computability=Computable | value="$50,000 MRR" | evidence=dpu:doc:ab12:page:1 | reason=none | source=xlsx | confidence=MODERATE_EVIDENCE | truth_gate=blocked | truth_gate_reason=TRUTH_PROJECTED_ONLY:MRR';
    const fields = parseCanonicalFieldsBody(body);
    expect(fields[0]?.truth_gate_blocked).toBe(true);
    expect(fields[0]?.truth_gate_reason).toBe("TRUTH_PROJECTED_ONLY:MRR");
  });

  it("line without truth_gate key → truth_gate_blocked is undefined", () => {
    const body =
      'category=traction_signal | field=arr_value | computability=Computable | value="$500,000" | evidence=dpu:doc:abcdef01:page:2 | reason=none | source=xlsx | confidence=STRONG_EVIDENCE';
    const fields = parseCanonicalFieldsBody(body);
    expect(fields[0]?.truth_gate_blocked).toBeUndefined();
    expect(fields[0]?.truth_gate_reason).toBeUndefined();
  });

  it("does not credit truth-gated field in computeMarketScoreRaw after round-trip parse", () => {
    const body =
      'category=traction_signal | field=arr_value | computability=Computable | value="$500,000 ARR" | evidence=dpu:doc:ab:page:1 | reason=none | source=xlsx | confidence=STRONG_EVIDENCE | truth_gate=blocked | truth_gate_reason=TRUTH_INSUFFICIENT:ARR';
    const fields = parseCanonicalFieldsBody(body);
    const { market_score_raw, missing_inputs } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(0);
    expect(missing_inputs).toContain("arr_value_or_mrr_value");
  });

  it("credits field after round-trip when no truth_gate is present", () => {
    const body =
      'category=traction_signal | field=arr_value | computability=Computable | value="$500,000 ARR" | evidence=dpu:doc:ab:page:1 | reason=none | source=xlsx | confidence=STRONG_EVIDENCE';
    const fields = parseCanonicalFieldsBody(body);
    const { market_score_raw } = computeMarketScoreRaw(fields);
    expect(market_score_raw).toBe(15);
  });
});
