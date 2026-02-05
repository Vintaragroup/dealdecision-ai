import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDeterministicModifierV1 } from "../lib/deterministic-score-preview-v1";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

test("deterministic score v1 material impact: aligned + 2 KPIs triggers Δ>=1", () => {
  // This is a deterministic, no-DB test of the scoring bridge math.
  // Gate conditions (env enabled + drift aligned) are handled elsewhere;
  // here we demonstrate that the modifier policy can produce a material delta.

  const inputs = {
    segments: {
      counts: {
        market: 2,
        product: 2,
        traction: 1,
        financials: 1,
        team: 1,
        go_to_market: 1,
      },
      override_ratio: 0.0,
    },
    kpis: [
      { key: "revenue", confidence: 0.8, value_raw: "$1M ARR", sources: [{ document_id: "doc-1", page_index: 2 }] },
      { key: "customers", confidence: 0.8, value_raw: "100 customers", sources: [{ document_id: "doc-1", page_index: 4 }] },
    ],
  };

  const mod = computeDeterministicModifierV1(inputs);

  assert.equal(typeof mod.modifier, "number");
  assert.ok(mod.modifier >= 0.85 && mod.modifier <= 1.15);
  assert.ok(Array.isArray(mod.notes));
  assert.ok(mod.notes.some((n) => String(n).includes("kpi_bonus=1.03")));

  // Baseline totals: choose values where a small adj factor change results in at least 1 point after rounding.
  const baseUnadjusted = 80;
  const baseEvidence = 0.55;
  const baseDD = 1.0;
  const baseAdj = clamp01(baseEvidence * baseDD);
  const baselineOverall = Math.round(baseUnadjusted * baseAdj + 50 * (1 - baseAdj));

  const detEvidence = clamp01(baseEvidence * mod.modifier);
  const detAdj = clamp01(detEvidence * baseDD);
  const detOverall = Math.round(baseUnadjusted * detAdj + 50 * (1 - detAdj));

  const delta = detOverall - baselineOverall;
  assert.ok(delta >= 1);
});
