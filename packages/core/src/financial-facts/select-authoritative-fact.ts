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

    // Guard 3 — year-integer-as-currency (year mismatch variant)
    // Extends Guard 2: when the period_label names a specific year but the value
    // is a *different* year integer on a currency-unit fact, the XLSX parser almost
    // certainly read a column-header cell as a data value.
    // E.g. value=2027, period_label='FY2026', unit='currency' → extraction artefact.
    // Guard only fires when period_label contains a year (prevents false positives on
    // period_label='current' / 'TTM' / etc. where a $2026 revenue is theoretically valid).
    if (fact.unit === 'currency' && yearMatch) {
      return { corrupted: true, reason: 'year_integer_as_currency' };
    }
  }

  // Guard 4 — column-index period label (spreadsheet coordinate artefact)
  // When the XLSX extractor uses Excel column letters or positional indices as
  // period headers (e.g. "col_A", "col_M", "col_Z", "col_13", "column_4"), the
  // resulting fact has no meaningful temporal scope and must be rejected.
  // No valid financial period is named "col_M" or "column_4".
  if (
    /^col_[A-Za-z]+$/i.test(fact.period_label) ||
    /^col_\d+$/i.test(fact.period_label) ||
    /^column_\d+$/i.test(fact.period_label)
  ) {
    return { corrupted: true, reason: 'invalid_column_index_period' };
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

/**
 * Returns true when the fact is provisional — i.e. a derived proxy or a
 * deck-sourced low-confidence claim.
 *
 * Provisional facts are not "current-state headline quality". When selecting
 * current_state fields (burn_rate, runway, cash), non-provisional facts are
 * always preferred. Provisional facts are still selectedwhen they are the only
 * available option.
 *
 * Provisional signals:
 *   - `is_derived: true`  — derived via a calculation rule, not directly stated
 *   - `source_kind === 'deck' && confidence === 'low'`  — unverified deck claim
 *
 * Note: `isProjectedFact` is a distinct guard applied before this one.
 */
export function isProvisionalFact(fact: FinancialFactV1): boolean {
  return (
    fact.is_derived === true ||
    (fact.source_kind === 'deck' && fact.confidence === 'low')
  );
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

// ─── Canonical revenue-fact selection ────────────────────────────────────────

/**
 * The ordered set of metric keys that represent current-state company revenue.
 * Used by both report paths to guarantee selection convergence.
 */
export const CANONICAL_REVENUE_KEYS: readonly string[] = ['revenue', 'arr', 'mrr'];

/**
 * Selects the single canonical current-state revenue FinancialFactV1 for a deal.
 *
 * This is the **shared selector** used by BOTH:
 *   - `financial_breakdown_v1.current_state.revenue`  (via buildFinancialBreakdownV1)
 *   - `structured_summary.revenue`  (via injectCanonicalRevenueIntoStructuredSummary)
 *
 * Selection contract (applied in order):
 *   1. Reject corrupted facts (isCorruptedFact Guards 1–4: non-finite, year-equals-value,
 *      year-integer-as-currency, column-index period label).
 *   2. Accept only revenue / arr / mrr metric keys with positive currency values.
 *   3. Monthly-only guard: if all non-corrupted revenue candidates are monthly-granularity
 *      (period_type === 'monthly'), return undefined.  A single month must not become
 *      the annual current-revenue headline.
 *   4. Prefer non-projected (current / historical) facts over projected ones.
 *   5. Apply selectAuthoritativeFact source/confidence/period ranking:
 *      xlsx (10) > pdf_table (5) > pdf_kpi_line (4) > kpi_tile (3) > deck (1).
 *
 * All source kinds are eligible — not just xlsx.  This ensures PDF-extracted
 * FinancialFactV1 records (source_kind='pdf_table' or 'pdf_kpi_line') participate,
 * fixing Qredible-type divergence where PDF revenue appears in financial_breakdown
 * but was previously missing from structured_summary.
 *
 * @param facts  All FinancialFactV1 records for a deal (raw or pre-filtered — both are safe).
 */
export function selectCanonicalRevenueFact(
  facts: FinancialFactV1[],
): FinancialFactV1 | undefined {
  const cleanFacts = filterCorruptedFacts(facts);

  const revenueFacts = cleanFacts.filter(
    (f) =>
      (CANONICAL_REVENUE_KEYS as string[]).includes(f.metric_key) &&
      f.unit === 'currency' &&
      f.value > 0,
  );

  if (revenueFacts.length === 0) return undefined;

  // Monthly-only guard: if every revenue candidate is monthly-granularity,
  // do not surface any of them as the annual current-revenue headline.
  const nonMonthlyFacts = revenueFacts.filter((f) => f.period_type !== 'monthly');
  if (nonMonthlyFacts.length === 0) return undefined;

  // Only select non-projected facts: projection-only deals must not leak a
  // projected value into the current-revenue headline.
  return selectAuthoritativeFact(CANONICAL_REVENUE_KEYS, nonMonthlyFacts, { requireNonProjected: true });
}

// ─── Alternative fact discovery ───────────────────────────────────────────────

/**
 * Selects the best "alternative" fact for a metric — the runner-up that provides
 * materially different or contrasting information beyond the already-selected primary.
 *
 * Used by the report compiler (Phase 2) to surface:
 * - A workbook-derived operating proxy when the primary is a weak deck claim.
 * - A projected alternative when the primary is a current/historical value,
 *   enabling the UI to distinguish "current 9.5%" from "projected 2028 64.8%".
 *
 * Selection strategy:
 * - **Weak primary** (deck-sourced, low confidence, or derived): return the
 *   strongest remaining candidate that differs in source_kind, derivation status,
 *   or confidence level.
 * - **Strong primary** (xlsx, high confidence, explicit, non-projected): only
 *   return a temporally-distinct fact (projected vs non-projected), if one exists.
 *
 * Returns undefined when:
 * - No alternative candidates exist.
 * - The primary is already strong AND no meaningful temporal contrast exists.
 * - The only alternative would duplicate information already conveyed by the primary.
 *
 * Design rules:
 * - Pure function — no side effects, no DB, no LLM.
 * - Never throws: returns undefined on any empty or degenerate input.
 * - Deterministic: same inputs always produce the same output.
 *
 * @param metricKeys   Same set of metric keys as passed to selectAuthoritativeFact.
 * @param facts        Full FinancialFactV1 list for the deal.
 * @param primaryFact  The already-selected primary fact. If undefined, returns undefined.
 */
export function selectAlternativeFact(
  metricKeys: string | string[],
  facts: FinancialFactV1[],
  primaryFact: FinancialFactV1 | undefined,
): FinancialFactV1 | undefined {
  if (!primaryFact) return undefined;

  const keys = new Set(Array.isArray(metricKeys) ? metricKeys : [metricKeys]);

  // Collect non-corrupted alternatives, excluding the primary itself.
  const candidates = facts.filter((f) => {
    if (!keys.has(f.metric_key)) return false;
    if (isCorruptedFact(f).corrupted) return false;
    if (f.fact_id === primaryFact.fact_id) return false;
    return true;
  });

  if (candidates.length === 0) return undefined;

  const primaryIsWeak =
    primaryFact.source_kind === 'deck' ||
    primaryFact.confidence === 'low' ||
    primaryFact.is_derived === true;

  const primaryIsProjected = isProjectedFact(primaryFact);

  // Strategy A: Primary is weak — find the strongest alternative that provides
  // additional value beyond what the deck-only / low-confidence primary offers.
  if (primaryIsWeak) {
    const ranked = candidates
      .map((f) => ({ f, score: rankScore(f, {}) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]?.f;
    if (!best) return undefined;

    // Only surface the alternative when it provides meaningfully different provenance.
    const isMeaningful =
      best.source_kind !== primaryFact.source_kind ||
      !!best.is_derived !== !!primaryFact.is_derived ||
      best.confidence !== primaryFact.confidence;

    return isMeaningful ? best : undefined;
  }

  // Strategy B: Primary is strong — surface a temporally-distinct fact only,
  // so the UI can present current vs projected context without merging them.
  const temporalAlternative = candidates.find(
    (c) => isProjectedFact(c) !== primaryIsProjected,
  );
  return temporalAlternative;
}
