/**
 * Evidence Coverage Checker
 *
 * Checks that major conclusions have supporting evidence.
 * Pure function: no I/O, no LLM.
 */

import { createHash } from "crypto";
import type { EvaluationFlag } from "./types.js";

const EVIDENCE_FLOOR = 5;     // below this is ERROR
const EVIDENCE_LOW = 10;      // below this is WARN

function flagId(dealId: string, type: string, stage: string): string {
  return createHash("sha256")
    .update(`${dealId}:${type}:${stage}`)
    .digest("hex")
    .slice(0, 16);
}

export function runEvidenceCoverageChecker(opts: {
  deal_id: string;
  evidence_count: number;
  section_count: number;
  section_evidence_counts?: Record<string, number>;
  financial_completeness_pct: number;
}): EvaluationFlag[] {
  const flags: EvaluationFlag[] = [];
  const { deal_id, evidence_count, section_count, section_evidence_counts, financial_completeness_pct } = opts;

  // Global evidence count too low
  if (evidence_count < EVIDENCE_FLOOR && section_count > 0) {
    flags.push({
      flag_id: flagId(deal_id, "evidence_count_below_floor", "stage-2-deterministic"),
      deal_id,
      flag_type: "evidence_count_below_floor",
      severity: "ERROR",
      source_stage: "stage-2-deterministic",
      impacted_score: "dci",
      description: `Only ${evidence_count} evidence items found (floor: ${EVIDENCE_FLOOR}). Conclusions have insufficient evidential support.`,
      detail: { evidence_count, floor: EVIDENCE_FLOOR },
      resolution_status: "open",
    });
  } else if (evidence_count < EVIDENCE_LOW && section_count > 0) {
    flags.push({
      flag_id: flagId(deal_id, "evidence_count_below_floor", "stage-2-deterministic"),
      deal_id,
      flag_type: "evidence_count_below_floor",
      severity: "WARN",
      source_stage: "stage-2-deterministic",
      impacted_score: "dci",
      description: `Only ${evidence_count} evidence items found (recommended minimum: ${EVIDENCE_LOW}).`,
      detail: { evidence_count, recommended_minimum: EVIDENCE_LOW },
      resolution_status: "open",
    });
  }

  // Zero sections produced
  if (section_count === 0) {
    flags.push({
      flag_id: flagId(deal_id, "zero_sections_produced", "stage-4-render-package"),
      deal_id,
      flag_type: "zero_sections_produced",
      severity: "CRITICAL",
      source_stage: "stage-4-render-package",
      impacted_score: "ors",
      description: `Report produced zero sections. Analysis is empty.`,
      detail: { section_count },
      resolution_status: "open",
    });
  }

  // Section-level evidence coverage
  if (section_evidence_counts) {
    const requiredSections = ["financial_analysis", "risk_assessment"];
    for (const required of requiredSections) {
      const count = section_evidence_counts[required] ?? -1;
      if (count === -1) {
        flags.push({
          flag_id: flagId(deal_id, "required_section_absent", `section:${required}`),
          deal_id,
          flag_type: "required_section_absent",
          severity: "WARN",
          source_stage: "stage-4-render-package",
          impacted_score: null,
          description: `Required section "${required}" is absent from the report.`,
          detail: { section: required },
          resolution_status: "open",
        });
      } else if (count === 0) {
        flags.push({
          flag_id: flagId(deal_id, "section_no_evidence", `section:${required}`),
          deal_id,
          flag_type: "section_no_evidence",
          severity: "WARN",
          source_stage: "stage-2-deterministic",
          impacted_score: null,
          description: `Section "${required}" has 0 evidence items — conclusions are unsupported.`,
          detail: { section: required, evidence_count: 0 },
          resolution_status: "open",
        });
      }
    }
  }

  return flags;
}
