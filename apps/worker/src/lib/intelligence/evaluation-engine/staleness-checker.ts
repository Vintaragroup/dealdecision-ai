/**
 * Staleness Checker
 * Pure function: no I/O.
 */

import { createHash } from "crypto";
import type { EvaluationFlag } from "./types.js";

/** LLM cache age above which we flag staleness (days). */
export const LLM_CACHE_STALE_DAYS = 14;

function flagId(dealId: string, type: string): string {
  return createHash("sha256").update(`${dealId}:${type}`).digest("hex").slice(0, 16);
}

export function runStalenessChecker(opts: {
  deal_id: string;
  llm_cache_age_days: number | null;
}): EvaluationFlag[] {
  const flags: EvaluationFlag[] = [];
  const { deal_id, llm_cache_age_days } = opts;

  if (llm_cache_age_days != null && llm_cache_age_days > LLM_CACHE_STALE_DAYS) {
    flags.push({
      flag_id: flagId(deal_id, "llm_cache_stale"),
      deal_id,
      flag_type: "llm_cache_stale",
      severity: "WARN",
      source_stage: "report-compiler",
      impacted_score: null,
      description: `LLM narration is ${llm_cache_age_days} days old (threshold: ${LLM_CACHE_STALE_DAYS}d). Narration may not reflect most recent documents.`,
      detail: { llm_cache_age_days, threshold: LLM_CACHE_STALE_DAYS },
      resolution_status: "open",
    });
  }

  return flags;
}
