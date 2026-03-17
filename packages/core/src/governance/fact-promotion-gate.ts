/**
 * fact-promotion-gate.ts
 *
 * Fact Promotion Gate — PR36.6 (Phase 3)
 *
 * Governs which canonical facts are allowed to surface in investor-facing
 * outputs based on their EvidenceConfidenceLevel.
 *
 * Promotion policy:
 *
 *  VERIFIED        → always promotable; no uncertainty label
 *  STRONG_EVIDENCE → promotable; no uncertainty label
 *  WEAK_EVIDENCE   → promotable only with "limited evidence" label
 *  CONFLICTING     → NOT promotable as a definitive fact; surface as "conflicting signals"
 *  PROVISIONAL     → suppressed from summary cards; may appear in data tab only
 *  SUPPRESSED      → never shown in any investor-facing surface
 *
 * Promotion surfaces:
 *  deal_overview_v2       → VERIFIED + STRONG_EVIDENCE only
 *  display_facts_v1       → VERIFIED + STRONG_EVIDENCE + WEAK_EVIDENCE (with label)
 *  governed summaries     → VERIFIED + STRONG_EVIDENCE only
 *  llm_interpretation_v1  → VERIFIED + STRONG_EVIDENCE (WEAK with caveat instruction to LLM)
 *  investor insights UI   → VERIFIED + STRONG_EVIDENCE + WEAK_EVIDENCE (with label)
 *  data tab               → all except SUPPRESSED
 */

import {
  EVIDENCE_CONFIDENCE_LEVEL,
  type EvidenceConfidenceLevel,
} from "../evidence/evidence-confidence";

// ─── Promotion surface types ──────────────────────────────────────────────────

/**
 * Named surfaces that canonical facts may be promoted to.
 * Each surface has its own promotion threshold.
 */
export type PromotionSurface =
  | "deal_overview"       // High-level overview card (strict: VERIFIED + STRONG only)
  | "display_facts"       // Detailed fact list (permissive: includes WEAK with label)
  | "governed_summary"    // LLM-governed narrative summaries (strict)
  | "llm_interpretation"  // LLM interpretation input corpus (WEAK allowed with caveat)
  | "investor_insights"   // Investor Insights tab decision surface (permissive with labels)
  | "data_tab";           // Data tab (all except SUPPRESSED)

// ─── Promotion policy ─────────────────────────────────────────────────────────

export interface FactPromotionPolicy {
  /** Whether the fact may be shown on this surface at all. */
  promotable: boolean;
  /**
   * When non-null, this label must accompany the fact in the UI.
   * The label communicates the evidence quality to the investor.
   */
  uncertainty_label: string | null;
  /**
   * When true, the fact should instead appear as a "conflicting signals" entry
   * rather than a definitive value.
   */
  show_as_conflict: boolean;
}

/**
 * Returns the promotion policy for a given confidence level and surface.
 *
 * @example
 * ```ts
 * const policy = getFactPromotionPolicy('WEAK_EVIDENCE', 'investor_insights');
 * // policy.promotable         === true
 * // policy.uncertainty_label  === 'limited evidence'
 * // policy.show_as_conflict   === false
 * ```
 */
export function getFactPromotionPolicy(
  level: EvidenceConfidenceLevel,
  surface: PromotionSurface,
): FactPromotionPolicy {
  switch (level) {
    case EVIDENCE_CONFIDENCE_LEVEL.VERIFIED:
      return { promotable: true, uncertainty_label: null, show_as_conflict: false };

    case EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE:
      return { promotable: true, uncertainty_label: null, show_as_conflict: false };

    case EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE:
      // Strict surfaces block WEAK_EVIDENCE
      if (surface === "deal_overview" || surface === "governed_summary") {
        return { promotable: false, uncertainty_label: null, show_as_conflict: false };
      }
      // LLM interpretation allows WEAK but signals it as an uncertainty caveat
      if (surface === "llm_interpretation") {
        return {
          promotable: true,
          uncertainty_label: "limited evidence",
          show_as_conflict: false,
        };
      }
      // UI surfaces show with label
      return {
        promotable: true,
        uncertainty_label: "limited evidence",
        show_as_conflict: false,
      };

    case EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING:
      // CONFLICTING is never promotable as a definitive fact on any surface,
      // but it must surface as a "conflicting signals" indicator (not suppressed).
      return {
        promotable: false,
        uncertainty_label: "conflicting signals",
        show_as_conflict: true,
      };

    case EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL:
      // Only the data tab shows PROVISIONAL facts; all other surfaces suppress them.
      if (surface === "data_tab") {
        return {
          promotable: true,
          uncertainty_label: "inferred",
          show_as_conflict: false,
        };
      }
      return { promotable: false, uncertainty_label: null, show_as_conflict: false };

    case EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED:
      return { promotable: false, uncertainty_label: null, show_as_conflict: false };

    default: {
      // Exhaustive guard — should never reach here with a valid level
      const _: never = level;
      void _;
      return { promotable: false, uncertainty_label: null, show_as_conflict: false };
    }
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Returns true when a fact at the given confidence level is promotable to
 * the specified surface.
 *
 * @example
 * ```ts
 * isFactPromotable('CONFLICTING', 'investor_insights') // false
 * isFactPromotable('STRONG_EVIDENCE', 'deal_overview') // true
 * ```
 */
export function isFactPromotable(
  level: EvidenceConfidenceLevel,
  surface: PromotionSurface,
): boolean {
  return getFactPromotionPolicy(level, surface).promotable;
}

/**
 * Returns the UI uncertainty label for a confidence level, or null when no
 * label is needed (VERIFIED / STRONG_EVIDENCE / SUPPRESSED / NOT promotable).
 *
 * This is the label shown inline next to a fact value in the investor-facing UI:
 *  - "limited evidence"    → WEAK_EVIDENCE
 *  - "conflicting signals" → CONFLICTING (show_as_conflict = true)
 *  - "inferred"            → PROVISIONAL (data tab only)
 *  - null                  → all others
 *
 * @example
 * ```ts
 * getUncertaintyLabel('WEAK_EVIDENCE')   // "limited evidence"
 * getUncertaintyLabel('CONFLICTING')     // "conflicting signals"
 * getUncertaintyLabel('VERIFIED')        // null
 * getUncertaintyLabel('SUPPRESSED')      // null
 * ```
 */
export function getUncertaintyLabel(level: EvidenceConfidenceLevel): string | null {
  switch (level) {
    case EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE:
      return "limited evidence";
    case EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING:
      return "conflicting signals";
    case EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL:
      return "inferred";
    default:
      return null;
  }
}

/**
 * Returns true when the confidence level is strong enough to be used in
 * an LLM prompt without special uncertainty caveats.
 * (VERIFIED or STRONG_EVIDENCE)
 */
export function isDefinitiveFact(level: EvidenceConfidenceLevel): boolean {
  return (
    level === EVIDENCE_CONFIDENCE_LEVEL.VERIFIED ||
    level === EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE
  );
}
