/**
 * Contradiction Explainer
 *
 * Derives human-readable ContradictionExplanation items from three sources,
 * in priority order:
 *   1. financial_conflicts (FinancialConflictSignal[]) — primary, richest data
 *   2. evaluation flags (revenue_narrative_vs_structured) — fallback
 *   3. missing_evidence CONFLICT items — last-resort fallback
 *
 * Pure function: no I/O, no LLM.
 * Output is sorted by financial severity and capped at 3.
 */

import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type {
  ContradictionExplanation,
  ContradictionType,
  FinancialConflictSignal,
  MissingEvidenceItem,
} from "./types.js";

// ─── Severity ordering ────────────────────────────────────────────────────────

const TYPE_RANK: Record<ContradictionType, number> = {
  revenue_mismatch: 0,
  burn_inconsistency: 1,
  growth_conflict: 2,
  margin_conflict: 3,
  valuation_conflict: 4,
  timeline_inconsistency: 5,
  unresolved_conflict: 6,
  other: 7,
};

// ─── Fusion field → label + ContradictionType ─────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  arr_value:          "ARR",
  mrr_value:          "MRR",
  revenue_value:      "Revenue",
  raise_amount:       "Raise amount",
  raise_cap:          "Valuation cap",
  raise_round:        "Funding round",
  valuation_pre:      "Pre-money valuation",
  valuation_post:     "Post-money valuation",
  valuation_safe_cap: "SAFE cap",
  tam_value:          "TAM",
  sam_value:          "SAM",
  som_value:          "SOM",
  growth_rate:        "Growth rate",
  customer_count:     "Customer count",
};

function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key.replace(/_/g, " ");
}

function fieldType(key: string): ContradictionType {
  if (key === "arr_value" || key === "mrr_value" || key === "revenue_value") {
    return "revenue_mismatch";
  }
  if (key === "raise_amount" || key === "raise_cap" || key === "valuation_pre" ||
      key === "valuation_post" || key === "valuation_safe_cap") {
    return "valuation_conflict";
  }
  if (key === "growth_rate" || key === "customer_count") {
    return "growth_conflict";
  }
  return "other";
}

// ─── Primary path: FinancialConflictSignal[] → ContradictionExplanation[] ─────

function fromFusedConflicts(
  conflicts: FinancialConflictSignal[]
): ContradictionExplanation[] {
  const results: ContradictionExplanation[] = [];

  for (const conflict of conflicts) {
    const label = fieldLabel(conflict.field);
    const type = fieldType(conflict.field);

    const sources = conflict.candidates.map((c, i) => ({
      document: `Document ${i + 1}`,
      location: "Extracted value",
      value: c.value,
    }));

    let explanation: string;
    if (conflict.candidates.length >= 2) {
      const v1 = conflict.candidates[0].value;
      const v2 = conflict.candidates[1].value;
      explanation = `${label} is reported as ${v1} in one document and ${v2} in another. These figures conflict and cannot both be correct.`;
    } else {
      explanation = `Conflicting ${label} values detected across document sources. The system cannot confirm a reliable figure.`;
    }

    results.push({
      type,
      title: `${label} figures conflict across documents`,
      explanation,
      sources,
    });
  }

  return results;
}

// ─── Fallback: evaluation flags ───────────────────────────────────────────────

function fromEvaluationFlags(flags: EvaluationFlag[]): ContradictionExplanation[] {
  const results: ContradictionExplanation[] = [];

  for (const flag of flags) {
    if (flag.flag_type === "revenue_narrative_vs_structured") {
      const d = flag.detail as
        | { arr_narrative?: number; arr_structured?: number; ratio?: number }
        | null
        | undefined;
      if (d?.arr_narrative != null && d?.arr_structured != null && d?.ratio != null) {
        const fmt = (n: number) => {
          const abs = Math.abs(n);
          if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
          if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
          return `$${n.toFixed(0)}`;
        };
        const deckVal = fmt(d.arr_narrative);
        const modelVal = fmt(d.arr_structured);
        const divergePct = Math.round(Math.abs(d.ratio - 1) * 100);
        results.push({
          type: "revenue_mismatch",
          title: "ARR figures conflict between pitch deck and financial model",
          explanation: `The pitch deck claims ARR of ${deckVal}, while the financial model shows ${modelVal} — a ${divergePct}% discrepancy. Structured financial data takes priority over narrative claims.`,
          sources: [
            { document: "Pitch deck", location: "Narrative claims", value: `${deckVal} ARR` },
            { document: "Financial model", location: "Structured data", value: `${modelVal} ARR` },
          ],
        });
      } else {
        results.push({
          type: "revenue_mismatch",
          title: "ARR figures conflict between pitch deck and financial model",
          explanation:
            "The pitch deck revenue claim diverges significantly from the structured financial model. Structured financial data takes priority over narrative claims.",
          sources: [],
        });
      }
      break;
    }
  }

  return results;
}

// ─── Fallback: missing_evidence CONFLICT items ────────────────────────────────

function fromMissingEvidence(missingEvidence: MissingEvidenceItem[]): ContradictionExplanation[] {
  const results: ContradictionExplanation[] = [];

  for (const item of missingEvidence) {
    if (item.evidence_type === "arr_conflict" || item.evidence_type === "revenue_conflict") {
      results.push({
        type: "revenue_mismatch",
        title: "Revenue inconsistency across document sources",
        explanation: `${item.description} Different documents report different values that cannot be reconciled. The system cannot confirm a reliable revenue figure.`,
        sources: [],
      });
    }
    if (item.evidence_type === "burn_rate_conflict") {
      results.push({
        type: "burn_inconsistency",
        title: "Burn rate figures are inconsistent across sources",
        explanation: `${item.description} Conflicting burn figures make runway calculations unreliable and reduce confidence in cash-based projections.`,
        sources: [],
      });
    }
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build ContradictionExplanation[] from available contradiction signals.
 *
 * Priority:
 *   1. financial_conflicts (FinancialConflictSignal[]) — primary
 *   2. evaluation flags — fallback when financial_conflicts absent
 *   3. missing_evidence CONFLICT items — last-resort fallback
 *
 * Returns top 3, sorted by financial severity.
 */
export function buildContradictionExplanations(
  flags: EvaluationFlag[],
  missingEvidence: MissingEvidenceItem[],
  financialConflicts?: FinancialConflictSignal[]
): ContradictionExplanation[] {
  let results: ContradictionExplanation[];

  if (financialConflicts && financialConflicts.length > 0) {
    results = fromFusedConflicts(financialConflicts);
  } else {
    results = [
      ...fromEvaluationFlags(flags),
      ...fromMissingEvidence(missingEvidence),
    ];
  }

  results.sort((a, b) => (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99));
  return results.slice(0, 3);
}
