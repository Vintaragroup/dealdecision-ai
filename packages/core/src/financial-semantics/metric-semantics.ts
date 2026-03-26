/**
 * Metric Semantics — Ontology-Delegating Helpers (Phase 0)
 *
 * Pure utility functions for querying semantic properties of financial metrics.
 * All logic delegates to METRIC_ONTOLOGY — this module is a stable public
 * adapter that shields consumers from the ontology's internal structure.
 *
 * Design rules:
 *  - No imports except from metric-ontology and semantic-types
 *  - All functions are pure and synchronous
 *  - Unknown metric keys return safe defaults (undefined, false, [])
 *  - Do not duplicate any logic from the ontology registry itself
 */

import type { FinancialSemanticFamily } from "./semantic-types.js";
import {
  lookupOntologyEntryByKey,
  lookupOntologyEntryByAlias,
  getMetricKeysForFamily,
  METRIC_ONTOLOGY,
} from "./metric-ontology.js";

// ─── Expense label patterns ───────────────────────────────────────────────────
// Recognizes common expense line-item labels that appear in OPEX schedules but
// do not map to a single canonical metric key in the ontology.
// Used for family inference when raw row labels are present without fact records.

const EXPENSE_LABEL_PATTERNS: RegExp[] = [
  /\bpayroll\b/i,
  /\bsalaries\b/i,
  /\bwages\b/i,
  /\brent\b/i,
  /\boffice\b/i,
  /\bsoftware\b/i,
  /\bsubscriptions?\b/i,
  /\bhosting\b/i,
  /\binfrastructure\b/i,
  /\bmarketing\b/i,
  /\badvertising\b/i,
  /\blegal\b/i,
  /\baccounting\b/i,
  /\binsurance\b/i,
  /\btravel\b/i,
  /\bcontractors?\b/i,
  /\bconsultants?\b/i,
  /\boverhead\b/i,
];

// ─── Family resolution ────────────────────────────────────────────────────────

/**
 * Returns the semantic family for a canonical metric key.
 * Returns undefined for unrecognized keys.
 */
export function getMetricFamily(
  metricKey: string,
): FinancialSemanticFamily | undefined {
  return lookupOntologyEntryByKey(metricKey)?.family;
}

/**
 * Returns the semantic family for a raw label string.
 * Uses alias matching — case-insensitive.
 * Returns undefined if the label cannot be resolved.
 */
export function getMetricFamilyFromLabel(
  label: string,
): FinancialSemanticFamily | undefined {
  return lookupOntologyEntryByAlias(label)?.family;
}

/**
 * Returns the canonical metric key for a raw label string.
 * Returns undefined if the label cannot be resolved.
 */
export function resolveMetricKeyFromLabel(
  label: string,
): string | undefined {
  return lookupOntologyEntryByAlias(label)?.metricKey;
}

// ─── Family membership checks ─────────────────────────────────────────────────

/** True if the metric belongs to the revenue family. */
export function isRevenueMetric(metricKey: string): boolean {
  return getMetricFamily(metricKey) === "revenue";
}

/** True if the metric belongs to the expense family. */
export function isExpenseMetric(metricKey: string): boolean {
  return getMetricFamily(metricKey) === "expense";
}

/** True if the metric belongs to the profitability family. */
export function isProfitabilityMetric(metricKey: string): boolean {
  return getMetricFamily(metricKey) === "profitability";
}

/** True if the metric belongs to the liquidity family. */
export function isLiquidityMetric(metricKey: string): boolean {
  return getMetricFamily(metricKey) === "liquidity";
}

/** True if the metric belongs to the capitalization family. */
export function isCapitalizationMetric(metricKey: string): boolean {
  return getMetricFamily(metricKey) === "capitalization";
}

/** True if the metric belongs to the unit_economics family. */
export function isUnitEconomicsMetric(metricKey: string): boolean {
  return getMetricFamily(metricKey) === "unit_economics";
}

// ─── Derivability ─────────────────────────────────────────────────────────────

/**
 * True if the metric can be deterministically derived from other metrics.
 * Returns false for unrecognized keys.
 */
export function canMetricBeDerived(metricKey: string): boolean {
  return lookupOntologyEntryByKey(metricKey)?.canBeDerived ?? false;
}

/**
 * Returns the metric keys required to derive the given metric.
 * Returns an empty array for non-derivable or unrecognized metrics.
 */
export function getDerivationDependencies(metricKey: string): string[] {
  return lookupOntologyEntryByKey(metricKey)?.derivationDependencies ?? [];
}

/**
 * True if the given set of available metric keys satisfies the derivation
 * dependencies for the target metric.
 *
 * @param targetMetricKey - The metric to potentially derive
 * @param availableKeys   - Set of metric keys currently present in the dataset
 */
export function canDeriveFromAvailableKeys(
  targetMetricKey: string,
  availableKeys: Set<string>,
): boolean {
  const deps = getDerivationDependencies(targetMetricKey);
  if (deps.length === 0) return false;
  return deps.every((dep) => availableKeys.has(dep));
}

// ─── Label → family inference ─────────────────────────────────────────────────

/**
 * Infer the most likely semantic family for a raw label string.
 *
 * Resolution order:
 *  1. Canonical metric key lookup (exact match)
 *  2. Ontology alias index (case-insensitive exact match)
 *  3. Expense label patterns (covers opex line items like "payroll", "rent")
 *
 * Returns undefined if no family can be determined.
 */
export function inferFamilyFromLabel(
  label: string,
): FinancialSemanticFamily | undefined {
  const entry =
    lookupOntologyEntryByKey(label) ?? lookupOntologyEntryByAlias(label);
  if (entry) return entry.family;

  for (const pattern of EXPENSE_LABEL_PATTERNS) {
    if (pattern.test(label)) return "expense";
  }
  return undefined;
}

// ─── Bulk queries ─────────────────────────────────────────────────────────────
export function getAllCanonicalMetricKeys(): string[] {
  return Object.keys(METRIC_ONTOLOGY);
}

/**
 * All metric keys for the given family.
 * Delegates directly to metric-ontology to keep logic in one place.
 */
export { getMetricKeysForFamily };
