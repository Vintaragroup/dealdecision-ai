/**
 * Contradiction Explainer
 *
 * Derives human-readable ContradictionExplanation items from evaluation flags
 * and FTRL-conflict missing_evidence items.
 *
 * Pure function: no I/O, no LLM.
 * Output is sorted by financial severity and capped at 3.
 */

import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type {
  ContradictionExplanation,
  ContradictionType,
  MissingEvidenceItem,
} from "./types.js";

// Severity ordering: financial-critical items first
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

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(ratio: number): string {
  return `${Math.round(Math.abs(ratio - 1) * 100)}%`;
}

/**
 * Build ContradictionExplanation[] from evaluation flags and missing_evidence CONFLICT items.
 * Returns top 3, sorted by financial severity.
 */
export function buildContradictionExplanations(
  flags: EvaluationFlag[],
  missingEvidence: MissingEvidenceItem[]
): ContradictionExplanation[] {
  const results: ContradictionExplanation[] = [];

  // ── 1. Revenue narrative vs structured (evaluation flag with actual values) ──
  for (const flag of flags) {
    if (flag.flag_type === "revenue_narrative_vs_structured") {
      const d = flag.detail as
        | { arr_narrative?: number; arr_structured?: number; ratio?: number }
        | null
        | undefined;
      if (d?.arr_narrative != null && d?.arr_structured != null && d?.ratio != null) {
        const deckVal = fmtMoney(d.arr_narrative);
        const modelVal = fmtMoney(d.arr_structured);
        results.push({
          type: "revenue_mismatch",
          title: "Revenue figures conflict between pitch deck and financial model",
          explanation: `The pitch deck claims ARR of ${deckVal}, while the financial model shows ${modelVal} — a ${fmtPct(d.ratio)} difference. Structured financial data takes priority over narrative claims.`,
          sources: [
            { document: "Pitch deck", location: "Narrative claims", value: `${deckVal} ARR` },
            { document: "Financial model", location: "Structured data", value: `${modelVal} ARR` },
          ],
        });
      } else {
        // Flag fired but no detail values — emit without source specifics
        results.push({
          type: "revenue_mismatch",
          title: "Revenue figures conflict between pitch deck and financial model",
          explanation:
            "The pitch deck revenue claim diverges significantly from the structured financial model. Structured financial data takes priority over narrative claims.",
          sources: [],
        });
      }
      break; // At most one revenue_narrative_vs_structured flag expected
    }
  }

  // ── 2. FTRL CONFLICT signals from missing_evidence ─────────────────────────
  // These are detected when the Financial Truth Resolution Layer cannot reconcile
  // values from multiple sources. No specific dollar values are available here.
  for (const item of missingEvidence) {
    if (item.evidence_type === "arr_conflict" || item.evidence_type === "revenue_conflict") {
      // Only add if not already covered by the narrative-vs-structured flag above
      const alreadyCovered = results.some((r) => r.type === "revenue_mismatch");
      if (!alreadyCovered) {
        results.push({
          type: "revenue_mismatch",
          title: "Revenue inconsistency across document sources",
          explanation: `${item.description} Different documents report different values that cannot be reconciled. The system cannot confirm a reliable revenue figure.`,
          sources: [],
        });
      }
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

  // ── Sort by severity and cap at 3 ──────────────────────────────────────────
  results.sort((a, b) => (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99));
  return results.slice(0, 3);
}
