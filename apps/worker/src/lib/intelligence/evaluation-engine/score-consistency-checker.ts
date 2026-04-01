/**
 * Score Consistency Checker
 * Pure function: no I/O.
 */

import { createHash } from "crypto";
import type { EvaluationFlag } from "./types.js";

function flagId(dealId: string, type: string): string {
  return createHash("sha256").update(`${dealId}:${type}`).digest("hex").slice(0, 16);
}

export function runScoreConsistencyChecker(opts: {
  deal_id: string;
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  verdict: string;
}): EvaluationFlag[] {
  const { deal_id, ors_score, dci_score, fhc_score, urss_score, verdict } = opts;
  const flags: EvaluationFlag[] = [];

  // URSS critical but verdict is GO
  if (urss_score > 80 && verdict === "GO") {
    flags.push({
      flag_id: flagId(deal_id, "urss_verdict_mismatch"),
      deal_id,
      flag_type: "urss_verdict_mismatch",
      severity: "ERROR",
      source_stage: "stage-4-render-package",
      impacted_score: "ors",
      description: `URSS risk score is ${urss_score} (critical range >80) but verdict is GO. High risk + GO recommendation requires review.`,
      detail: { urss_score, verdict },
      resolution_status: "open",
    });
  }

  // DCI excellent (>80) but FHC very poor (<25) — gap worth flagging
  if (dci_score > 80 && fhc_score < 25) {
    flags.push({
      flag_id: flagId(deal_id, "dci_fhc_gap"),
      deal_id,
      flag_type: "dci_fhc_gap",
      severity: "WARN",
      source_stage: "stage-4-render-package",
      impacted_score: "fhc",
      description: `DCI=${dci_score} (strong documents) but FHC=${fhc_score} (very poor financials). Document quality does not compensate for financial weakness.`,
      detail: { dci_score, fhc_score },
      resolution_status: "open",
    });
  }

  return flags;
}
