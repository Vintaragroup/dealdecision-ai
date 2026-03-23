/**
 * selectAuthoritativeFact — Unified, deterministic financial fact selector.
 *
 * Single source of truth for picking the most trustworthy financial fact when
 * multiple candidates exist for the same metric from different sources.
 *
 * Enforces, in priority order:
 *   1. Corruption rejection: year-header extraction artifacts, non-finite values.
 *   2. Temporal preference: historical/current facts before projected/scenario.
 *   3. Source-kind hierarchy: xlsx > pdf_table/kpi_tile > deck > unknown.
 *   4. Cross-source reconciliation: rewards corroborated facts, penalises conflicts.
 *   5. Confidence: high > medium > low.
 *   6. Period granularity: annual ≥ ttm > quarterly > monthly > unknown.
 *
 * Design rules:
 *   - Pure function — no DB, no LLM, no side effects.
 *   - Fail-open: never throws; an empty array simply returns undefined.
 *   - Deterministic: same inputs always produce the same output.
 *
 * Consumers:
 *   - packages/core/src/models/financial-breakdown-v1.ts
 *   - packages/core/src/reports/compiler-simple.ts (injectXlsxRevenueIntoStructuredSummary)
 */

import type { FinancialFactV1, CrossSourceReconciliationStatus } from './financial-fact-v1.js';

// ─── Corruption detection ─────────────────────────────────────────────────────

export interface CorruptionCheckResult {
  corrupted: boolean;
  /** Machine-readable code identifying the corruption pattern. */
  reason?: string;
}

/**
 * Detects known corruption patterns in a persisted FinancialFactV1.
 *
 * **Year-equals-value guard:**
 *   When an XLSX parser reads a column header row (e.g. "2026") as a data cell,
 *   the extracted `value` becomes the year integer (2026) and `period_label`
 *   also references that year ("FY2026", "2026", "Q1 2026").
 *   Detected by: value is in [1990, 2100] AND equals the year extracted from
 *   period_label AND unit is "currency" or "number".
 *
 * **Non-finite value guard:**
 *   NaN or Infinity indicate an extraction or normalisation failure.
 */
export function isCorruptedFact(fact: FinancialFactV1): CorruptionCheckResult {
  // Guard 1 — non-finite value
  if (!Number.isFinite(fact.value)) {
    return { corrupted: true, reason: 'non_finite_value' };
  }

  // Guard 2 — year-equals-value
  // Only applies when the value looks like a calendar year (integer in [1990, 2100]).
  const v = fact.value;
  if (Number.isInteger(v) && v >= 1990 && v <= 2100) {
    const yearMatch = fact.period_label.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/);
    if (yearMatch && Number(yearMatch[1]) === v) {
      return { corrupted: true, reason: 'year_equals_value' };
    }
  }

  return { corrupted: false };
}

// ─── Selector options ─────────────────────────────────────────────────────────

export interface SelectAuthoritativeFactOpts {
  /**
   * When true, only return facts that are NOT projected/scenario/target.
   * Mutually exclusive with requireProjected.
   */
  requireNonProjected?: boolean;
  /**
   * When true, only return projected/scenario/target facts.
   * Mutually exclusive with requireNonProjected.
   */
  requireProjected?: boolean;
}

// ─── Internal ranking tables ──────────────────────────────────────────────────

const SRC_RANK: Record<string, number> = {
  xlsx: 10,
  pdf_table: 5,
  pdf_kpi_line: 4,
  kpi_tile: 3,
  chart_pixel: 2,
  deck: 1,
  unknown: 0,
};

const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

const PERIOD_RANK: Record<string, number> = { annual: 4, ttm: 3, quarterly: 2, monthly: 1, unknown: 0 };

/**
 * Cross-source reconciliation ranking bonus/penalty.
 *
 * `supported`      → +2: corroborated by another source. High trust.
 * `workbook_only`  → +1: single-source but from workbook. Acceptable.
 * `unresolved`     → 0:  insufficient data to confirm.
 * `deck_only`      → -1: single-source deck claim. Lower trust.
 * `projected_only` → -1: only projected facts for this slot.
 * `conflicting`    → -3: in active conflict with another source. Prefer the
 *                        higher-ranked source over this one via source_kind.
 */
const CROSS_SOURCE_RANK: Record<CrossSourceReconciliationStatus, number> = {
  supported: 2,
  workbook_only: 1,
  unresolved: 0,
  deck_only: -1,
  projected_only: -1,
  conflicting: -3,
};

// ─── Temporal projection check ────────────────────────────────────────────────

/**
 * Returns true when the fact represents a forward-looking (projected/scenario/target)
 * data point rather than a historical or current-period actual.
 */
export function isProjectedFact(fact: FinancialFactV1): boolean {
  const scope = fact.temporal_scope;
  if (scope === 'projected' || scope === 'scenario' || scope === 'target') return true;
  // Use digit-boundary lookahead/lookbehind so "FY2027" matches but "2024-2027" doesn't
  // spuriously match on "2024" when the current year is 2026.
  const yr = fact.period_label.match(/(?<!\d)(20\d{2})(?!\d)/);
  return yr != null && Number(yr[1]) > new Date().getFullYear();
}

// ─── Composite rank score ─────────────────────────────────────────────────────

/** Higher score = more authoritative. */
function rankScore(fact: FinancialFactV1, opts: SelectAuthoritativeFactOpts): number {
  // Tier 1: temporal preference (only relevant when not filtering by projection status)
  const temporalBonus = opts.requireProjected ? 0 : (isProjectedFact(fact) ? 0 : 1000);

  // Tier 2: source kind
  const srcScore = SRC_RANK[fact.source_kind] ?? 0;

  // Tier 3: cross-source reconciliation (integer bonus/penalty)
  const crossScore = fact.cross_source_status != null
    ? (CROSS_SOURCE_RANK[fact.cross_source_status] ?? 0)
    : 0;

  // Tier 4: confidence
  const confScore = CONF_RANK[fact.confidence] ?? 0;

  // Tier 5: period granularity
  const periodScore = PERIOD_RANK[fact.period_type] ?? 0;

  return temporalBonus * 1000 + srcScore * 100 + crossScore * 10 + confScore * 4 + periodScore;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Selects the single most authoritative FinancialFactV1 for one or more metric keys.
 *
 * @param metricKeys  One metric key string or an ordered list of equivalent keys
 *                    (e.g. ['revenue', 'arr', 'mrr']). All are treated equally.
 * @param facts       All FinancialFactV1 records available for the deal.
 * @param opts        Optional filters (requireNonProjected / requireProjected).
 * @returns           The highest-ranked non-corrupted fact, or undefined when none pass.
 */
export function selectAuthoritativeFact(
  metricKeys: string | string[],
  facts: FinancialFactV1[],
  opts: SelectAuthoritativeFactOpts = {},
): FinancialFactV1 | undefined {
  const keys = new Set(Array.isArray(metricKeys) ? metricKeys : [metricKeys]);

  const candidates = facts.filter((f) => {
    // Metric key match
    if (!keys.has(f.metric_key)) return false;

    // Corruption filter
    if (isCorruptedFact(f).corrupted) return false;

    // Temporal filters
    if (opts.requireNonProjected && isProjectedFact(f)) return false;
    if (opts.requireProjected && !isProjectedFact(f)) return false;

    return true;
  });

  if (candidates.length === 0) return undefined;

  // Sort descending by composite rank. Stable sort ensures determinism on ties.
  const ranked = candidates
    .map((f) => ({ f, score: rankScore(f, opts) }))
    .sort((a, b) => b.score - a.score);

  return ranked[0].f;
}

/**
 * Filters a list of facts, removing any that fail corruption checks.
 *
 * Convenience function for callers that need to strip bad facts before
 * iterating (e.g. projection period collectors).
 */
export function filterCorruptedFacts(facts: FinancialFactV1[]): FinancialFactV1[] {
  return facts.filter((f) => !isCorruptedFact(f).corrupted);
}
