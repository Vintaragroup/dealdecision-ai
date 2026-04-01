/**
 * Contradiction Checker
 *
 * Checks for material contradictions between narrative/structured data.
 * Pure function: no I/O, no LLM.
 */

import { createHash } from "crypto";
import type { EvaluationFlag } from "./types.js";

function flagId(dealId: string, type: string, stage: string): string {
  return createHash("sha256")
    .update(`${dealId}:${type}:${stage}`)
    .digest("hex")
    .slice(0, 16);
}

export function runContradictionChecker(opts: {
  deal_id: string;
  verdict: string;
  ors_score: number;
  arr_narrative: number | null;
  arr_structured: number | null;
  contradiction_count: number;
}): EvaluationFlag[] {
  const flags: EvaluationFlag[] = [];
  const { deal_id, verdict, ors_score, arr_narrative, arr_structured, contradiction_count } = opts;

  // Revenue contradiction: narrative vs structured, divergence > 50%
  if (
    arr_narrative != null &&
    arr_structured != null &&
    arr_structured > 0
  ) {
    const ratio = arr_narrative / arr_structured;
    if (ratio > 2.0 || ratio < 0.5) {
      flags.push({
        flag_id: flagId(deal_id, "revenue_narrative_vs_structured", "stage-3-llm"),
        deal_id,
        flag_type: "revenue_narrative_vs_structured",
        severity: "ERROR",
        source_stage: "stage-3-llm",
        impacted_score: "fhc",
        description: `Narrative ARR ($${(arr_narrative / 1e6).toFixed(1)}M) diverges from structured ARR ($${(arr_structured / 1e6).toFixed(1)}M) by ${Math.round(Math.abs(ratio - 1) * 100)}%. Structured data takes priority.`,
        detail: { arr_narrative, arr_structured, ratio },
        resolution_status: "open",
      });
    }
  }

  // Verdict vs ORS gap: ORS says GO but score is low, or vice versa
  if (verdict === "GO" && ors_score < 55) {
    flags.push({
      flag_id: flagId(deal_id, "verdict_score_gap", "stage-4-render-package"),
      deal_id,
      flag_type: "verdict_score_gap",
      severity: "ERROR",
      source_stage: "stage-4-render-package",
      impacted_score: "ors",
      description: `Verdict is GO but ORS score is ${ors_score} (below 55 threshold). Score-verdict alignment check failed.`,
      detail: { verdict, ors_score },
      resolution_status: "open",
    });
  }

  if (verdict === "NO_GO" && ors_score > 70) {
    flags.push({
      flag_id: flagId(deal_id, "verdict_score_gap", "stage-4-render-package"),
      deal_id,
      flag_type: "verdict_score_gap",
      severity: "WARN",
      source_stage: "stage-4-render-package",
      impacted_score: "ors",
      description: `Verdict is NO_GO but ORS score is ${ors_score} (above 70). Score-verdict alignment warrants review.`,
      detail: { verdict, ors_score },
      resolution_status: "open",
    });
  }

  return flags;
}
