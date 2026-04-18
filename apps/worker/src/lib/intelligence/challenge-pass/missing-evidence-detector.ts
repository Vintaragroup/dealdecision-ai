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
  // FTRL truth states — when present, distinguish INSUFFICIENT from CONFLICT
  arr_truth_state?: string | null;
  burn_truth_state?: string | null;
  runway_truth_state?: string | null;
  cash_truth_state?: string | null;
  revenue_truth_state?: string | null;
  // Narrative mention presence — true when the metric is referenced in deck/text
  // even though no structured numeric fact was successfully extracted.
  // Enables context-aware descriptions instead of generic "unavailable" messages.
  arr_has_narrative_mention?: boolean;
  burn_has_narrative_mention?: boolean;
  runway_has_narrative_mention?: boolean;
  // Non-financial signal scores for category-balanced gap detection.
  // Optional — when absent, the corresponding specs are skipped (no false positives).
  /** 0 when limitedScoringResult.market_presence_score is 0 (no market evidence detected). */
  market_presence_score?: number | null;
  /** 0 when limitedScoringResult.traction_signal_score is 0 (no traction evidence detected). */
  traction_signal_score?: number | null;
  /** true when insightSlotInputs.saasKpis is non-null (SaaS KPI data present). */
  has_saas_kpis?: boolean;
  /** true when insightSlotInputs.dealTractionFacts is non-empty (structured traction facts present). */
  has_traction_facts?: boolean;
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
    // ARR mentioned in deck/text but not verified from structured financial data.
    // Fires when: arr_structured null + no conflict + narrative mention present.
    // Lower sensitivity than fully-missing because the data point is at least referenced.
    missing: (i) =>
      i.arr_structured == null &&
      i.arr_truth_state !== "CONFLICT" &&
      i.arr_has_narrative_mention === true,
    spec: {
      evidence_type: "arr_mentioned",
      description: "ARR is referenced in submitted materials but not verified from structured financial data",
      verdict_sensitivity: "Medium" as EvidenceSensitivity,
      diligence_question: "ARR figures were detected in deck language. Provide an audited P&L or XLSX with ARR breakdown by cohort to verify.",
      category: "financial" as DiligenceGap["category"],
      gap_severity: "Major" as DiligenceGap["severity"],
    },
  },
  {
    // INSUFFICIENT only — CONFLICT means data exists but is contradictory (handled below)
    missing: (i) =>
      i.arr_structured == null &&
      i.arr_truth_state !== "CONFLICT" &&
      i.arr_has_narrative_mention !== true,
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
    // CONFLICT: ARR/revenue figures exist but are contradictory across sources
    missing: (i) => i.arr_truth_state === "CONFLICT",
    spec: {
      evidence_type: "arr_conflict",
      description: "ARR/revenue figures are contradictory across data sources",
      verdict_sensitivity: "High",
      diligence_question: "Multiple revenue figures found that cannot be reconciled. Provide a single authoritative financial statement.",
      category: "financial",
      gap_severity: "Critical",
    },
  },
  {
    // CONFLICT: revenue figures disagree across structured and narrative sources
    missing: (i) => i.revenue_truth_state === "CONFLICT",
    spec: {
      evidence_type: "revenue_conflict",
      description: "Revenue figures are contradictory across data sources",
      verdict_sensitivity: "High",
      diligence_question: "Conflicting revenue data detected across documents. Provide a single authoritative P&L or revenue schedule.",
      category: "financial",
      gap_severity: "Critical",
    },
  },
  {
    // Burn mentioned in deck/text but not verified from structured financial data.
    missing: (i) =>
      i.burn_rate_monthly == null &&
      i.burn_truth_state !== "CONFLICT" &&
      i.burn_has_narrative_mention === true,
    spec: {
      evidence_type: "burn_rate_mentioned",
      description: "Monthly burn rate is referenced in submitted materials but not verified from structured financial data",
      verdict_sensitivity: "Medium" as EvidenceSensitivity,
      diligence_question: "Burn rate language was detected in the deck. Provide a 12-month cash flow statement to verify the figure.",
      category: "financial" as DiligenceGap["category"],
      gap_severity: "Major" as DiligenceGap["severity"],
    },
  },
  {
    // INSUFFICIENT only — CONFLICT means data exists but is contradictory
    missing: (i) =>
      i.burn_rate_monthly == null &&
      i.burn_truth_state !== "CONFLICT" &&
      i.burn_has_narrative_mention !== true,
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
    // CONFLICT: burn rate figures exist but are contradictory
    missing: (i) => i.burn_truth_state === "CONFLICT",
    spec: {
      evidence_type: "burn_rate_conflict",
      description: "Burn rate figures are contradictory across data sources",
      verdict_sensitivity: "High",
      diligence_question: "Contradictory burn rate data found. Provide a reconciled 12-month cash flow statement.",
      category: "financial",
      gap_severity: "Major",
    },
  },
  {
    // Runway calculable from narrative burn/cash signals but not from structured data.
    // Fires when: runway null + no conflict + burn or cash mentioned in deck.
    missing: (i) =>
      i.runway_months == null &&
      i.runway_truth_state !== "CONFLICT" &&
      (i.runway_has_narrative_mention === true ||
        i.burn_has_narrative_mention === true),
    spec: {
      evidence_type: "runway_unverified",
      description: "Runway is not calculable from verified data — burn rate or cash figures are mentioned but unverified",
      verdict_sensitivity: "Medium" as EvidenceSensitivity,
      diligence_question: "Burn rate or cash language was detected. Provide verified cash on hand and a 12-month burn schedule to confirm runway.",
      category: "financial" as DiligenceGap["category"],
      gap_severity: "Major" as DiligenceGap["severity"],
    },
  },
  {
    missing: (i) =>
      i.runway_months == null &&
      i.runway_truth_state !== "CONFLICT" &&
      i.runway_has_narrative_mention !== true &&
      i.burn_has_narrative_mention !== true,
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
    missing: (i) => i.cash_on_hand == null && i.cash_truth_state !== "CONFLICT",
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
  // ── Non-financial gap specs ───────────────────────────────────────────────
  // These only fire when the relevant optional signal is explicitly provided and
  // confirms absence. When the field is undefined/null, the spec is skipped.
  {
    // Market: no market evidence detected in DPU text (market_presence_score === 0 exactly)
    missing: (i) => i.market_presence_score === 0,
    spec: {
      evidence_type: "market_validation",
      description: "No market validation evidence detected — ICP, TAM/SAM/SOM, and customer segment data absent",
      verdict_sensitivity: "High",
      diligence_question:
        "Provide ICP definition with TAM/SAM sizing methodology and at least one validated customer segment.",
      category: "market",
      gap_severity: "Major",
    },
  },
  {
    // Market weak-but-present: market sizing figures found but below full market structure
    // (TAM-only = 45, no SAM/SOM). Fires when score is non-null, non-zero, and below TAM+SAM threshold.
    // Does NOT fire for null (not_scoreable) or scores >= 75 (TAM+SAM or better).
    missing: (i) =>
      i.market_presence_score !== null &&
      i.market_presence_score !== undefined &&
      i.market_presence_score > 0 &&
      i.market_presence_score < 75,
    spec: {
      evidence_type: "weak_market_validation",
      description:
        "Market sizing figures detected but ICP definition and customer segment validation not evidenced",
      verdict_sensitivity: "Medium",
      diligence_question:
        "Market sizing figures present. Provide ICP definition with target customer segments, competitive differentiation, and evidence of demand validation.",
      category: "market",
      gap_severity: "Major",
    },
  },
  {
    // Customer traction: no traction signals AND no structured traction data
    missing: (i) =>
      i.traction_signal_score === 0 &&
      i.has_saas_kpis === false &&
      i.has_traction_facts === false,
    spec: {
      evidence_type: "customer_traction",
      description:
        "No customer traction evidence — MRR/ARR history, cohort retention, and customer contracts absent",
      verdict_sensitivity: "High",
      diligence_question:
        "Provide MRR/ARR schedule with cohort retention data, customer count with growth trajectory, and any signed LOIs or customer contracts.",
      category: "traction",
      gap_severity: "Major",
    },
  },
  {
    // Traction weak-but-present: revenue/growth language detected but only from text (no structured data).
    // Score > 0 means some signal exists; score <= 40 means text-mention or projected-only (no deal_facts).
    // has_saas_kpis + has_traction_facts = false confirms no structured traction source.
    missing: (i) =>
      i.traction_signal_score !== null &&
      i.traction_signal_score !== undefined &&
      i.traction_signal_score > 0 &&
      i.traction_signal_score <= 40 &&
      i.has_saas_kpis === false &&
      i.has_traction_facts === false,
    spec: {
      evidence_type: "weak_traction_signal",
      description:
        "Revenue or growth language detected but no verified customer metrics, cohort data, or signed agreements",
      verdict_sensitivity: "Medium",
      diligence_question:
        "Revenue or growth signals detected. Provide verified MRR/ARR schedule with cohort retention data, customer count growth trajectory, and any signed LOIs or customer contracts.",
      category: "traction",
      gap_severity: "Major",
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
