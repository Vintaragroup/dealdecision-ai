/**
 * packages/core/src/temporal/temporal-alignment.ts
 *
 * Phase 3: Temporal Alignment Engine for Financial Facts.
 *
 * Provides deterministic, fact-level temporal comparison logic that:
 *  - Classifies each fact into a rich TemporalReferenceClass
 *  - Determines whether two facts can be meaningfully compared
 *  - Classifies revenue-like metrics by definition family (booked/recognized/arr_mrr/cash)
 *  - Builds grouped mismatch flags instead of N per-metric flags
 *
 * Design constraints:
 *  - Pure functions only: no I/O, no side effects, no external calls.
 *  - Compatible with existing TemporalScope — additive, not a replacement.
 *  - All exports are stable public API (included in packages/core/src/index.ts).
 */

import type { FinancialFactV1 } from "../financial-facts/financial-fact-v1";
import type { IntegrityFlag } from "../types/financial-integrity-v1";

// ─── TemporalReferenceClass ────────────────────────────────────────────────────

/**
 * A finer-grained temporal classification than TemporalScope.
 *
 * Use this when you need to distinguish between a labeled historical period
 * (FY2024), a snapshot labeled "current", a YTD accumulation, or a TTM window.
 *
 * Relationship to TemporalScope:
 *   - "projected" | "scenario" | "target" map 1:1
 *   - "historical" + "current" scope expand into historical_actual / current_snapshot /
 *     current_partial / ytd / ttm
 *   - "unknown" maps 1:1
 */
export type TemporalReferenceClass =
  | "historical_actual"  // confirmed past performance with an explicit labeled period
  | "current_snapshot"   // workbook-sourced fact labeled "current" — point-in-time balance
  | "current_partial"    // deck-sourced or unlabeled "current" fact — period is ambiguous
  | "ytd"                // year-to-date accumulation (partial annual period)
  | "ttm"                // trailing twelve months (rolling annual window)
  | "projected"          // explicit forecast / guidance
  | "scenario"           // named scenario (Base / Upside / Downside)
  | "target"             // management target or goal
  | "unknown";           // cannot be classified with available metadata

// ─── MetricDefinitionFamily ───────────────────────────────────────────────────

/**
 * Revenue-like metrics can represent fundamentally different things.
 * Comparing booked_revenue to recognized_revenue is a definition mismatch,
 * even when the period labels match.
 */
export type MetricDefinitionFamily =
  | "booked"      // bookings / signed-contract value not yet recognized
  | "recognized"  // GAAP revenue recognition
  | "arr_mrr"     // annualized / monthly recurring revenue run-rate
  | "cash"        // cash-based receipts
  | "other";      // not a revenue-definition family (burn, EBITDA, CAC, etc.)

const METRIC_DEFINITION_FAMILIES: Readonly<Record<string, MetricDefinitionFamily>> = {
  revenue: "recognized",
  recognized_revenue: "recognized",
  ytd_revenue_recognized: "recognized",
  arr: "arr_mrr",
  mrr: "arr_mrr",
  annual_recurring_revenue: "arr_mrr",
  monthly_recurring_revenue: "arr_mrr",
  cash_received: "cash",
  ytd_cash_received: "cash",
  direct_cash_received: "cash",
  booked_revenue: "booked",
  direct_booked_revenue: "booked",
  direct_new_booked_revenue: "booked",
  bookings: "booked",
  new_bookings: "booked",
};

/**
 * Returns the revenue-definition family for a metric key.
 * Returns "other" for non-revenue metrics (burn_rate, EBITDA, etc.).
 */
export function getMetricDefinitionFamily(metricKey: string): MetricDefinitionFamily {
  return METRIC_DEFINITION_FAMILIES[metricKey] ?? "other";
}

// ─── TemporalComparisonReason ─────────────────────────────────────────────────

/**
 * Machine-readable reason for why two facts can or cannot be compared.
 *
 * Consumers can use this to:
 *  - Suppress invalid cross-source discrepancy flags
 *  - Surface meaningful explanations in the UI
 *  - Route mismatch findings to the appropriate flag group
 */
export type TemporalComparisonReason =
  | "same_period"               // identical period_label and temporal class → always comparable
  | "compatible_rollup"         // TTM vs annual — same window, slightly different boundary
  | "projected_vs_historical"   // projected fact compared to historical → invalid comparison
  | "current_vs_labeled_period" // "current" label vs explicit "FY2024" → ambiguous period
  | "definition_mismatch"       // booked vs recognized vs ARR/MRR → different revenue bases
  | "ambiguous_current"         // "current" facts with different temporal scopes
  | "unknown_periods";          // one or both facts have unknown period classification

// ─── Internal constants ───────────────────────────────────────────────────────

const WORKBOOK_SOURCE_KINDS = new Set(["xlsx", "pdf_table"]);

const PROJECTED_CLASSES = new Set<TemporalReferenceClass>([
  "projected",
  "scenario",
  "target",
]);

// ─── classifyFactTemporally ───────────────────────────────────────────────────

/**
 * Classifies a single FinancialFactV1 into a TemporalReferenceClass.
 *
 * Algorithm (rules evaluated in order):
 *  1. Projected / scenario / target scope → return immediately
 *  2. Period label heuristics: "current", TTM, YTD
 *  3. Known historical or current scope → historical_actual
 *  4. Non-empty period label (year / quarter) → historical_actual (assumed)
 *  5. Fallback → unknown
 */
export function classifyFactTemporally(fact: FinancialFactV1): TemporalReferenceClass {
  const scope = fact.temporal_scope ?? "unknown";

  // Rule 1: Projected / scenario / target scopes — return immediately
  if (scope === "projected") return "projected";
  if (scope === "scenario") return "scenario";
  if (scope === "target") return "target";

  const period = (fact.period_label ?? "").toLowerCase().trim();
  const type = fact.period_type ?? "unknown";

  // Rule 2a: "current" / "now" label — distinguish workbook snapshot from deck partial
  if (period === "current" || period === "now") {
    return WORKBOOK_SOURCE_KINDS.has(fact.source_kind)
      ? "current_snapshot"
      : "current_partial";
  }

  // Rule 2b: TTM pattern
  if (type === "ttm" || period === "ttm" || period.startsWith("trailing")) {
    return "ttm";
  }

  // Rule 2c: YTD pattern
  if (
    period.includes("ytd") ||
    period.includes("year to date") ||
    period.includes("year-to-date") ||
    period.includes("year_to_date")
  ) {
    return "ytd";
  }

  // Rule 3: Known historical or current scope → historical_actual
  if (scope === "historical" || scope === "current") {
    return "historical_actual";
  }

  // Rule 4: Non-empty, non-generic period label → assume historical_actual
  // (Projected scope is caught in Rule 1, so absence of that → not projected)
  if (period !== "" && period !== "unknown") {
    return "historical_actual";
  }

  return "unknown";
}

// ─── canCompareFactsTemporally ────────────────────────────────────────────────

/**
 * Determines whether two financial facts can be meaningfully compared.
 *
 * Returns:
 *  - `comparable`: true when the comparison is valid and the result is meaningful
 *  - `reason`: machine-readable explanation code
 *  - `severity`: importance of the incompatibility when comparable=false
 *
 * Rules (evaluated in priority order):
 *  1. Projected vs historical — NEVER comparable (critical)
 *  2. Revenue definition mismatch (booked vs recognized vs ARR) → NOT comparable (warning)
 *  3. Same temporal class + same period_label → always comparable (fast path)
 *  4. "current" vs explicit period label → NOT comparable (warning)
 *  5. TTM vs annual → comparable with caveat (compatible_rollup, info)
 *  6. One or both unknown → treat as comparable (unknown_periods, info)
 *  7. Default → comparable (same_period, info)
 *
 * Note: Rule 2 (definition mismatch) runs before Rule 3 (same-period fast path)
 * to handle the case where two different-family metrics share the same period
 * label but measure fundamentally different quantities.
 */
export function canCompareFactsTemporally(
  a: FinancialFactV1,
  b: FinancialFactV1,
): { comparable: boolean; reason: TemporalComparisonReason; severity: "info" | "warning" | "critical" } {
  const refA = classifyFactTemporally(a);
  const refB = classifyFactTemporally(b);

  // Rule 1: Projected vs historical — NEVER comparable (highest priority)
  const aIsProjected = PROJECTED_CLASSES.has(refA);
  const bIsProjected = PROJECTED_CLASSES.has(refB);
  if (aIsProjected !== bIsProjected) {
    return { comparable: false, reason: "projected_vs_historical", severity: "critical" };
  }

  // Rule 2: Revenue definition mismatch (booked vs recognized vs ARR/MRR vs cash).
  // Evaluated before the same-period fast path: two metrics CAN share the same
  // period_label while measuring fundamentally different quantities.
  const famA = getMetricDefinitionFamily(a.metric_key);
  const famB = getMetricDefinitionFamily(b.metric_key);
  if (famA !== "other" && famB !== "other" && famA !== famB) {
    return { comparable: false, reason: "definition_mismatch", severity: "warning" };
  }

  // Rule 3: Same temporal class + same period_label → always comparable (fast path)
  if (refA === refB && a.period_label === b.period_label) {
    return { comparable: true, reason: "same_period", severity: "info" };
  }

  // Rule 4: "current" label vs explicit period label — ambiguous period
  const aIsCurrent = refA === "current_snapshot" || refA === "current_partial";
  const bIsCurrent = refB === "current_snapshot" || refB === "current_partial";
  if (aIsCurrent !== bIsCurrent) {
    return { comparable: false, reason: "current_vs_labeled_period", severity: "warning" };
  }

  // Rule 4b: Both have "current" period label but different temporal classes
  // (e.g. current_snapshot vs current_partial) — still ambiguous
  if (aIsCurrent && bIsCurrent && refA !== refB) {
    return { comparable: false, reason: "ambiguous_current", severity: "warning" };
  }

  // Rule 5: TTM vs annual — approximately comparable (rolling vs calendar year boundary)
  const ttmAndAnnual =
    (refA === "ttm" && refB === "historical_actual") ||
    (refA === "historical_actual" && refB === "ttm");
  if (ttmAndAnnual) {
    return { comparable: true, reason: "compatible_rollup", severity: "info" };
  }

  // Rule 6: One or both unknown → treat as comparable (don't suppress on missing metadata)
  if (refA === "unknown" || refB === "unknown") {
    return { comparable: true, reason: "unknown_periods", severity: "info" };
  }

  // Default: comparable
  return { comparable: true, reason: "same_period", severity: "info" };
}

// ─── buildGroupedTemporalMismatchFlag ─────────────────────────────────────────

/**
 * Builds a single grouped integrity flag for multiple metrics that mix
 * projected and historical facts.
 *
 * Use this instead of emitting N individual `temporal_scope_mismatch:{metric}`
 * flags — one grouped flag is more readable and does not inflate the conflict
 * count with temporal noise.
 *
 * @param affectedMetrics - metric_key values that have a projected/historical mix
 * @param reasons - human-readable reason strings (one per affected metric, deduped)
 */
export function buildGroupedTemporalMismatchFlag(
  affectedMetrics: string[],
  reasons: string[],
): IntegrityFlag {
  const uniqueMetrics = [...new Set(affectedMetrics)].sort();
  const metricList = uniqueMetrics.join(", ");
  const uniqueReasons = [...new Set(reasons)].join("; ");
  const n = uniqueMetrics.length;

  return {
    flag_key: "period_alignment:grouped_temporal_mismatch",
    status: "FAIL",
    severity: "high",
    note: `${n} metric(s) mix projected and historical facts — cross-source comparison excluded from numeric conflict count: ${metricList}. Reason(s): ${uniqueReasons}. Filter by temporal_scope before comparing projected facts to realized values.`,
  };
}
