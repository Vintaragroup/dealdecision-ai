/**
 * @dealdecision/core — Financial Semantics Module (Phase 0)
 *
 * Public surface area for the deterministic financial semantics layer.
 * All consumers should import from this index — not from individual files.
 *
 * Stable exports (safe to depend on):
 *  - interpretFinancialSemantics()   — primary API
 *  - inferTableSemanticType()        — table type resolution
 *  - inferAllTableSemanticTypes()    — multi-table type resolution
 *  - metric-semantics helpers        — family queries and derivability checks
 *  - metric-ontology queries         — low-level ontology lookup
 *  - All types from semantic-types   — SemanticInterpretation, etc.
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  FinancialSemanticFamily,
  FinancialSemanticRole,
  FinancialTableSemanticType,
  MissingnessReason,
  MissingnessHint,
  SemanticInterpretation,
} from "./semantic-types.js";

// ── Ontology ──────────────────────────────────────────────────────────────────
export type { MetricOntologyEntry } from "./metric-ontology.js";
export {
  METRIC_ONTOLOGY,
  lookupOntologyEntryByKey,
  lookupOntologyEntryByAlias,
  getMetricKeysForFamily,
} from "./metric-ontology.js";

// ── Table semantics ───────────────────────────────────────────────────────────
export type { InferTableSemanticTypeInput } from "./table-semantics.js";
export {
  inferTableSemanticType,
  inferAllTableSemanticTypes,
} from "./table-semantics.js";

// ── Metric semantics helpers ──────────────────────────────────────────────────
export {
  getMetricFamily,
  getMetricFamilyFromLabel,
  inferFamilyFromLabel,
  resolveMetricKeyFromLabel,
  isRevenueMetric,
  isExpenseMetric,
  isProfitabilityMetric,
  isLiquidityMetric,
  isCapitalizationMetric,
  isUnitEconomicsMetric,
  canMetricBeDerived,
  getDerivationDependencies,
  canDeriveFromAvailableKeys,
  getAllCanonicalMetricKeys,
  getMetricKeysForFamily as getMetricKeysForFamilyHelper,
} from "./metric-semantics.js";

// ── Primary interpreter ───────────────────────────────────────────────────────
export type { SemanticInterpreterInput } from "./semantic-interpreter.js";
export { interpretFinancialSemantics } from "./semantic-interpreter.js";
