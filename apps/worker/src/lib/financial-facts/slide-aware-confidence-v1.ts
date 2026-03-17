/**
 * slide-aware-confidence-v1.ts
 *
 * Pure helpers that apply slide-classification signals to FinancialFactV1 records.
 *
 * Design rules:
 *  - Pure functions — no DB, no LLM, no side effects.
 *  - Never throws.
 *  - Confidence is adjusted using the SLIDE_CONFIDENCE_BOOST map.
 *  - Slide metadata (slide_type, slide_title) is stamped on each emitted fact.
 *
 * Phase 10 — Slide-Aware Financial Extraction Integration.
 */

import type { FinancialFactV1, FinancialFactConfidence } from "@dealdecision/core";

// ─── Slide type scoring ───────────────────────────────────────────────────────

/**
 * Numeric boost applied to extracted financial facts based on the source slide type.
 *
 * Positive values improve confidence; negative values degrade it.
 *   +4  financials   — highest signal; metrics on dedicated financial slides are reliable
 *   +3  traction     — strong signal; KPI slides are explicitly financial
 *   +2  raise_terms  — moderate signal; ask slides often carry reliable unit economics
 *   +1  use_of_funds — weak positive; indirectly quantifies burn / allocation
 *   -2  team         — low signal; numeric mentions are often headcount, not financials
 *   -2  market       — low signal; numeric mentions are often TAM estimates, not actuals
 */
export const SLIDE_CONFIDENCE_BOOST: Readonly<Record<string, number>> = {
  financials:   4,
  traction:     3,
  raise_terms:  2,
  use_of_funds: 1,
  team:        -2,
  market:      -2,
};

/**
 * Slide types that indicate the page is primarily financial in nature.
 * Pages of these types bypass the `detectFinancialTableCandidate` guard
 * so no financial content is silently skipped.
 */
export const FINANCIAL_SLIDE_TYPES: ReadonlySet<string> = new Set([
  "financials",
  "traction",
  "raise_terms",
  "use_of_funds",
]);

// ─── Confidence adjustment ───────────────────────────────────────────────────

const CONFIDENCE_ORDER: FinancialFactConfidence[] = ["low", "medium", "high"];

/**
 * Upgrade or downgrade a confidence level based on a numeric boost score.
 *
 * Thresholds:
 *   boost >= 2 → upgrade by 1 level (low→medium, medium→high)
 *   boost <= -1 → downgrade by 1 level (high→medium, medium→low)
 *   otherwise → unchanged
 *
 * Never throws.
 */
export function applySlideConfidenceBoost(
  base: FinancialFactConfidence,
  boost: number,
): FinancialFactConfidence {
  const idx = CONFIDENCE_ORDER.indexOf(base);
  if (idx === -1) return base; // safety: unknown confidence level
  if (boost >= 2) return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.length - 1, idx + 1)];
  if (boost <= -1) return CONFIDENCE_ORDER[Math.max(0, idx - 1)];
  return base;
}

// ─── Batch application ───────────────────────────────────────────────────────

/**
 * Stamp slide_type + slide_title on each fact and adjust confidence.
 *
 * Returns new fact objects (does not mutate inputs).
 * Facts without a matching slide_type in SLIDE_CONFIDENCE_BOOST are tagged
 * but confidence is left unchanged.
 *
 * @param facts      Extracted facts to annotate
 * @param slide_type resolved_slide_type from DPU payload (may be null/undefined)
 * @param slide_title slide_title from DPU payload (may be null/undefined)
 */
export function applySlideAwareness(
  facts: FinancialFactV1[],
  slide_type: string | null | undefined,
  slide_title: string | null | undefined,
): FinancialFactV1[] {
  if (!facts.length) return facts;
  if (!slide_type) return facts; // no context — return unchanged

  try {
    const boost = SLIDE_CONFIDENCE_BOOST[slide_type] ?? 0;
    return facts.map((f) => ({
      ...f,
      slide_type,
      slide_title: slide_title ?? undefined,
      confidence: applySlideConfidenceBoost(f.confidence, boost),
    }));
  } catch {
    return facts; // pure helper — never rethrow
  }
}
