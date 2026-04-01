/**
 * Fail-open Checker
 *
 * Flags places where pipeline components degraded silently (fail-open behavior).
 * Addresses gaps C2 and M5 from docs/system-discovery/09-risks-gaps-and-missing-capabilities.md.
 * Pure function: no I/O.
 */

import { createHash } from "crypto";
import type { EvaluationFlag } from "./types.js";

function flagId(dealId: string, type: string): string {
  return createHash("sha256").update(`${dealId}:${type}`).digest("hex").slice(0, 16);
}

export function runFailOpenChecker(opts: {
  deal_id: string;
  dpu_provenance_missing: boolean;
  xlsx_extraction_had_llm_fallback: boolean;
  evidence_gate_passed: boolean;
  investor_insights_status: string;
}): EvaluationFlag[] {
  const { deal_id, dpu_provenance_missing, xlsx_extraction_had_llm_fallback, evidence_gate_passed, investor_insights_status } = opts;
  const flags: EvaluationFlag[] = [];

  if (dpu_provenance_missing) {
    flags.push({
      flag_id: flagId(deal_id, "dpu_provenance_missing"),
      deal_id,
      flag_type: "dpu_provenance_missing",
      severity: "WARN",
      source_stage: "populate-document-page-understanding",
      impacted_score: "dci",
      description: "DPU provenance token was missing for one or more pages. DCI may be computed from unverified extraction data.",
      detail: { dpu_provenance_missing },
      resolution_status: "open",
    });
  }

  if (xlsx_extraction_had_llm_fallback) {
    flags.push({
      flag_id: flagId(deal_id, "xlsx_extraction_llm_fallback"),
      deal_id,
      flag_type: "xlsx_extraction_llm_fallback",
      severity: "WARN",
      source_stage: "extraction-xlsx",
      impacted_score: "fhc",
      description: "One or more XLSX sheets could not be parsed with structured detection and fell back to LLM extraction. Financial facts from these sheets are less reliable.",
      detail: { xlsx_extraction_had_llm_fallback },
      resolution_status: "open",
    });
  }

  if (!evidence_gate_passed) {
    flags.push({
      flag_id: flagId(deal_id, "evidence_gate_failed_open"),
      deal_id,
      flag_type: "evidence_gate_failed_open",
      severity: "WARN",
      source_stage: "stage-1-gates",
      impacted_score: "dci",
      description: "Evidence gate did not pass (coverage or evidence count below threshold). Analysis ran with degraded evidence quality.",
      detail: { evidence_gate_passed },
      resolution_status: "open",
    });
  }

  if (investor_insights_status === "deterministic_only") {
    flags.push({
      flag_id: flagId(deal_id, "deterministic_only_mode"),
      deal_id,
      flag_type: "deterministic_only_mode",
      severity: "WARN",
      source_stage: "stage-3-llm",
      impacted_score: null,
      description: "LLM stage was skipped (deterministic-only mode). Narration and LLM-derived insights are absent.",
      detail: { investor_insights_status },
      resolution_status: "open",
    });
  }

  return flags;
}
