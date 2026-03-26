/**
 * Semantic Interpreter (Phase 0)
 *
 * Primary entry point for the financial semantics layer.
 *
 * `interpretFinancialSemantics()` takes a set of FinancialFactV1 records
 * (and optional supplementary signals) and returns a `SemanticInterpretation`
 * describing what kinds of financial coverage exist, what can be derived,
 * and what is missing.
 *
 * Design rules:
 *  - Pure / deterministic: same input → same output
 *  - No LLM, no DB, no async, no side effects
 *  - Never throws: all errors degrade gracefully to safe defaults
 *  - Does not mutate input facts
 *  - Additive: the output shape can only grow, never shrink
 */

import type { FinancialFactV1 } from "../financial-facts/financial-fact-v1.js";
import { isProjectedScope } from "../temporal/temporal-scope.js";
import type {
  SemanticInterpretation,
  FinancialSemanticFamily,
  FinancialTableSemanticType,
  MissingnessHint,
  MissingnessReason,
} from "./semantic-types.js";
import {
  METRIC_ONTOLOGY,
  lookupOntologyEntryByKey,
} from "./metric-ontology.js";
import { inferFamilyFromLabel } from "./metric-semantics.js";
import { inferAllTableSemanticTypes } from "./table-semantics.js";

// ─── Input type ───────────────────────────────────────────────────────────────

export interface SemanticInterpreterInput {
  /** Financial facts from the registry — may be empty but not null/undefined. */
  facts: FinancialFactV1[];
  /**
   * SheetKind values for sheets in scope for this dataset.
   * Optional — enables better table type inference.
   */
  sheetKinds?: string[];
  /**
   * LayoutType values for tables in scope.
   * Optional — enables better table type inference.
   */
  layoutTypes?: string[];
  /**
   * Raw row label strings (e.g. "payroll", "rent", "software subscriptions")
   * from tables that did not produce FinancialFactV1 records.
   * These are used for family inference and missingness hints.
   */
  rowMetricKeys?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isHistoricalOrCurrent(fact: FinancialFactV1): boolean {
  if (!fact.temporal_scope) return true; // absence = assume historical/current
  return !isProjectedScope(fact.temporal_scope);
}

function isProjectedFact(fact: FinancialFactV1): boolean {
  if (!fact.temporal_scope) return false;
  return isProjectedScope(fact.temporal_scope);
}

/** Build a Set of (metric_key:period_label) combos for period-match checks. */
function buildPeriodKeySet(
  facts: FinancialFactV1[],
  predicate: (f: FinancialFactV1) => boolean = () => true,
): Set<string> {
  const s = new Set<string>();
  for (const f of facts) {
    if (predicate(f)) s.add(`${f.metric_key}:${f.period_label}`);
  }
  return s;
}

/** Extract all distinct period_label values from a filtered fact set. */
function distinctPeriodLabels(
  facts: FinancialFactV1[],
  metricsFilter?: Set<string>,
): Set<string> {
  const s = new Set<string>();
  for (const f of facts) {
    if (!metricsFilter || metricsFilter.has(f.metric_key)) {
      s.add(f.period_label);
    }
  }
  return s;
}

// ─── Main interpreter ─────────────────────────────────────────────────────────

/**
 * interpretFinancialSemantics
 *
 * Produces a deterministic `SemanticInterpretation` from:
 *  - A set of `FinancialFactV1` records
 *  - Optional sheet/layout classifier signals
 *  - Optional raw row label strings
 *
 * This function is safe to call in any context — it never throws,
 * never mutates its input, and always returns a fully-populated result.
 */
export function interpretFinancialSemantics(
  input: SemanticInterpreterInput,
): SemanticInterpretation {
  try {
    return _interpret(input);
  } catch {
    // Defensive: return a safe zero-state result if anything goes wrong.
    return _zeroState();
  }
}

function _interpret(input: SemanticInterpreterInput): SemanticInterpretation {
  const { facts, sheetKinds = [], layoutTypes = [], rowMetricKeys = [] } = input;

  // ── Step 1: Build lookup structures ─────────────────────────────────────

  // All metric keys present — both historical and projected
  const allPresentKeys = new Set(facts.map((f) => f.metric_key));

  // Historical/current metric keys (non-projected)
  const historicalFacts = facts.filter(isHistoricalOrCurrent);
  const historicalKeys = new Set(historicalFacts.map((f) => f.metric_key));

  // Projected-only metric keys (present projected but NOT historical)
  const projectedFacts = facts.filter(isProjectedFact);
  const projectedOnlyKeys = new Set(
    Array.from(projectedFacts.map((f) => f.metric_key)).filter(
      (k) => !historicalKeys.has(k),
    ),
  );

  // ── Step 2: Family coverage ──────────────────────────────────────────────

  const explicitFamilySet = new Set<FinancialSemanticFamily>();
  const inferredFamilySet = new Set<FinancialSemanticFamily>();

  // From historical/current facts
  for (const mk of historicalKeys) {
    const entry = lookupOntologyEntryByKey(mk);
    if (entry) explicitFamilySet.add(entry.family);
  }

  // From projected-only facts (counted as inferred coverage)
  for (const mk of projectedOnlyKeys) {
    const entry = lookupOntologyEntryByKey(mk);
    if (entry && !explicitFamilySet.has(entry.family)) {
      inferredFamilySet.add(entry.family);
    }
  }

  // From raw row labels that didn't produce canonical facts
  for (const label of rowMetricKeys) {
    const family = inferFamilyFromLabel(label);
    if (family && !explicitFamilySet.has(family)) {
      inferredFamilySet.add(family);
    }
  }

  const explicitFamilies = Array.from(explicitFamilySet);
  const inferredFamilies = Array.from(inferredFamilySet);

  // ── Step 3: Presence signals ─────────────────────────────────────────────

  const hasRevenueModel =
    historicalKeys.has("revenue") ||
    historicalKeys.has("arr") ||
    historicalKeys.has("mrr") ||
    historicalKeys.has("gmv");

  // Expense coverage: either explicit opex/cogs/burn key, or
  // expense family from raw labels, or expense in inferred families.
  // total_expenses is the canonical key used by build-financial-fact-registry-v1.
  const hasExplicitExpenseFact =
    historicalKeys.has("opex") ||
    historicalKeys.has("cogs") ||
    historicalKeys.has("burn_rate") ||
    historicalKeys.has("total_expenses");
  const hasExpenseFromLabels =
    explicitFamilySet.has("expense") || inferredFamilySet.has("expense");
  const hasExpenseCoverage = hasExplicitExpenseFact || hasExpenseFromLabels;

  const hasOperatingModel = hasRevenueModel && hasExpenseCoverage;

  const hasCashModel =
    historicalKeys.has("cash") &&
    (historicalKeys.has("burn_rate") || hasExpenseCoverage);

  const hasCapTableModel =
    historicalKeys.has("raise_amount") ||
    historicalKeys.has("pre_money_valuation") ||
    historicalKeys.has("shares_outstanding") ||
    historicalKeys.has("option_pool");

  const hasForecastModel = projectedFacts.length > 0;

  // ── Step 4: Table semantic types ─────────────────────────────────────────

  const tableSemanticTypeInputs = [
    // One input per sheetKind
    ...sheetKinds.map((sk) => ({ sheetKind: sk })),
    // One input per layoutType
    ...layoutTypes.map((lt) => ({ layoutType: lt })),
    // One combined input for row metric keys
    ...(rowMetricKeys.length > 0 ? [{ rowMetricKeys }] : []),
  ];

  let tableSemanticTypes: FinancialTableSemanticType[] =
    tableSemanticTypeInputs.length > 0
      ? inferAllTableSemanticTypes(tableSemanticTypeInputs)
      : [];

  // Remove "unknown" from the results unless it's the only value
  const definiteTypes = tableSemanticTypes.filter((t) => t !== "unknown");
  tableSemanticTypes = definiteTypes.length > 0 ? definiteTypes : tableSemanticTypes;

  // ── Step 5: Derivability signals ─────────────────────────────────────────

  // burn_rate derivability: missing burn_rate + expense coverage (historical)
  const canDeriveBurnRate =
    !historicalKeys.has("burn_rate") && hasExpenseCoverage;

  // runway_months derivability: cash + burn_rate present, same period label
  let canDeriveRunway = false;
  if (!historicalKeys.has("runway_months")) {
    const cashPeriods = distinctPeriodLabels(
      historicalFacts,
      new Set(["cash"]),
    );
    const burnPeriods = distinctPeriodLabels(
      historicalFacts,
      new Set(["burn_rate"]),
    );
    // At least one overlapping period label
    for (const pl of cashPeriods) {
      if (burnPeriods.has(pl)) {
        canDeriveRunway = true;
        break;
      }
    }
  }

  // gross_margin derivability: revenue + gross_profit present, same period
  let canDeriveGrossMargin = false;
  if (!historicalKeys.has("gross_margin")) {
    const revPeriods = distinctPeriodLabels(
      historicalFacts,
      new Set(["revenue"]),
    );
    const gpPeriods = distinctPeriodLabels(
      historicalFacts,
      new Set(["gross_profit"]),
    );
    for (const pl of revPeriods) {
      if (gpPeriods.has(pl)) {
        canDeriveGrossMargin = true;
        break;
      }
    }
  }

  // ARR from MRR: MRR present (any scope) and ARR absent from all facts
  const canDeriveArrFromMrr =
    !allPresentKeys.has("arr") && allPresentKeys.has("mrr");

  // ── Step 6: Missingness hints ─────────────────────────────────────────────

  const missingnessHints: MissingnessHint[] = [];

  // Evaluate a short list of high-value metrics for missingness.
  // These are the metrics most relevant to underwriting decisions.
  const priorityMetrics = [
    "revenue",
    "arr",
    "mrr",
    "gross_margin",
    "burn_rate",
    "cash",
    "runway_months",
    "raise_amount",
    "pre_money_valuation",
    "cac",
    "ltv",
  ];

  for (const mk of priorityMetrics) {
    if (allPresentKeys.has(mk)) continue; // present — no hint needed

    const entry = METRIC_ONTOLOGY[mk];
    if (!entry) continue;

    let reason: MissingnessReason = "not_provided";
    let derivableFrom: string[] | undefined;

    if (entry.canBeDerived && entry.derivationDependencies) {
      const deps = entry.derivationDependencies;
      const allDepsPresent = deps.every((d) => allPresentKeys.has(d));
      if (allDepsPresent) {
        reason = "derivable_if_dependencies_exist";
        derivableFrom = deps;
      }
    }

    missingnessHints.push({ metricKey: mk, reason, derivableFrom });
  }

  return {
    hasOperatingModel,
    hasRevenueModel,
    hasCashModel,
    hasCapTableModel,
    hasForecastModel,
    explicitFamilies,
    inferredFamilies,
    tableSemanticTypes,
    canDeriveBurnRate,
    canDeriveRunway,
    canDeriveGrossMargin,
    canDeriveArrFromMrr,
    missingnessHints,
  };
}

// ─── Zero-state fallback ──────────────────────────────────────────────────────

function _zeroState(): SemanticInterpretation {
  return {
    hasOperatingModel: false,
    hasRevenueModel: false,
    hasCashModel: false,
    hasCapTableModel: false,
    hasForecastModel: false,
    explicitFamilies: [],
    inferredFamilies: [],
    tableSemanticTypes: [],
    canDeriveBurnRate: false,
    canDeriveRunway: false,
    canDeriveGrossMargin: false,
    canDeriveArrFromMrr: false,
    missingnessHints: [],
  };
}
