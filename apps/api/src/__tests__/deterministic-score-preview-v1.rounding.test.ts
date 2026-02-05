import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDeterministicScorePreviewV1Diagnostics } from "../lib/deterministic-score-preview-v1";

test("deterministic_score_preview_v1: rounding_note appears when unrounded delta non-zero but rounded delta is 0", () => {
  const diag = computeDeterministicScorePreviewV1Diagnostics({
    applied: true,
    delta_overall_score: 0,
    base_unadjusted_overall_score: 60,
    base_adjustment_factor: 0.5,
    det_adjustment_factor: 0.508,
    base_evidence_factor: 0.5,
    det_evidence_factor: 0.508,
  });

  assert.equal(typeof diag.delta_unrounded_overall, "number");
  assert.ok(Math.abs((diag.delta_unrounded_overall as number) - 0.08) < 1e-9);
  assert.equal(diag.rounding_note, "Applied; final score unchanged due to rounding.");
});
