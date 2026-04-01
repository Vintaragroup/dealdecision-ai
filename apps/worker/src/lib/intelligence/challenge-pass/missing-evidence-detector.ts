/**
 * Challenge Pass — Missing Evidence Detector
 *
 * Pure function. Maps missing financial/document evidence types to
 * MissingEvidenceItems with verdict sensitivity labels.
 */

import type { MissingEvidenceItem, DiligenceGap, EvidenceSensitivity } from "./types.js";

export interface MissingEvidenceInput {
  arr_structured: number | null;
  burn_rate_monthly: number | null;
  runway_months: number | null;
  cash_on_hand: number | null;
  has_xlsx: boolean;
  has_cap_table: boolean;
  evidence_count: number;
  evidence_sections_covered: number;
}

interface EvidenceSpec {
  evidence_type: string;
  description: string;
  verdict_sensitivity: EvidenceSensitivity;
  diligence_question: string;
  category: DiligenceGap["category"];
  gap_severity: DiligenceGap["severity"];
}

const EVIDENCE_SPECS: Array<{
  missing: (input: MissingEvidenceInput) => boolean;
  spec: EvidenceSpec;
}> = [
  {
    missing: (i) => i.arr_structured == null,
    spec: {
      evidence_type: "structured_arr",
      description: "No verified ARR figure from structured financial data",
      verdict_sensitivity: "High",
      diligence_question: "Provide an audited P&L or XLSX with ARR breakdown by cohort.",
      category: "financial",
      gap_severity: "Critical",
    },
  },
  {
    missing: (i) => i.burn_rate_monthly == null,
    spec: {
      evidence_type: "burn_rate",
      description: "Monthly burn rate unavailable",
      verdict_sensitivity: "High",
      diligence_question: "What is the current monthly cash burn? Provide a 12-month cash flow statement.",
      category: "financial",
      gap_severity: "Critical",
    },
  },
  {
    missing: (i) => i.runway_months == null,
    spec: {
      evidence_type: "runway",
      description: "Runway in months is not calculable from available data",
      verdict_sensitivity: "High",
      diligence_question: "What is current cash on hand and expected runway given stated burn rate?",
      category: "financial",
      gap_severity: "Major",
    },
  },
  {
    missing: (i) => i.cash_on_hand == null,
    spec: {
      evidence_type: "cash_on_hand",
      description: "Cash on hand figure is missing",
      verdict_sensitivity: "Medium",
      diligence_question: "Provide the most recent bank balance or treasury summary.",
      category: "financial",
      gap_severity: "Major",
    },
  },
  {
    missing: (i) => !i.has_xlsx,
    spec: {
      evidence_type: "xlsx_financial_model",
      description: "No structured XLSX financial model was provided",
      verdict_sensitivity: "High",
      diligence_question: "Provide a structured financial model (XLSX) with historical actuals and projections.",
      category: "financial",
      gap_severity: "Critical",
    },
  },
  {
    missing: (i) => !i.has_cap_table,
    spec: {
      evidence_type: "cap_table",
      description: "No cap table was provided",
      verdict_sensitivity: "Medium",
      diligence_question: "Provide a current cap table showing ownership percentages and option pool size.",
      category: "legal",
      gap_severity: "Major",
    },
  },
  {
    missing: (i) => i.evidence_count < 5,
    spec: {
      evidence_type: "evidence_base_critical",
      description: "Evidence base is critically thin (fewer than 5 sources)",
      verdict_sensitivity: "High",
      diligence_question: "What supporting documents are available? Minimum: deck, model, P&L, cap table.",
      category: "financial",
      gap_severity: "Critical",
    },
  },
  {
    missing: (i) => i.evidence_count >= 5 && i.evidence_count < 10,
    spec: {
      evidence_type: "evidence_base_low",
      description: "Evidence base is below recommended threshold (fewer than 10 sources)",
      verdict_sensitivity: "Medium",
      diligence_question: "Additional supporting documents are recommended for higher-confidence analysis.",
      category: "financial",
      gap_severity: "Minor",
    },
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function detectMissingEvidence(
  input: MissingEvidenceInput
): { missing_evidence: MissingEvidenceItem[]; diligence_gaps: DiligenceGap[] } {
  const missing_evidence: MissingEvidenceItem[] = [];
  const diligence_gaps: DiligenceGap[] = [];

  for (const { missing, spec } of EVIDENCE_SPECS) {
    if (missing(input)) {
      missing_evidence.push({
        evidence_type: spec.evidence_type,
        description: spec.description,
        verdict_sensitivity: spec.verdict_sensitivity,
        diligence_question: spec.diligence_question,
      });

      diligence_gaps.push({
        gap_id: spec.evidence_type,
        category: spec.category,
        description: spec.description,
        severity: spec.gap_severity,
        source_evidence_type: spec.evidence_type,
      });
    }
  }

  return { missing_evidence, diligence_gaps };
}

export function missingEvidencePenalty(missing: MissingEvidenceItem[]): number {
  let penalty = 0;
  for (const item of missing) {
    if (item.verdict_sensitivity === "High") penalty += 10;
    else if (item.verdict_sensitivity === "Medium") penalty += 5;
    else penalty += 2;
  }
  return Math.min(penalty, 40);
}
