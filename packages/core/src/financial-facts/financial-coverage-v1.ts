/**
 * financial-coverage-v1.ts — packages/core
 *
 * Pure financial coverage logic — no DB, no LLM, no side effects.
 *
 * Exports:
 *  - FinancialConflictV1       (type)
 *  - FinancialCoverageV1       (type)
 *  - detectFinancialFactConflictsV1  (pure fn)
 *  - buildFinancialCoverageV1        (pure fn)
 *  - INCOME_STATEMENT_METRICS / UNIT_ECONOMICS_METRICS / CASH_FLOW_METRICS
 *
 * Consumed by:
 *  - apps/api/src/routes/financial-facts.ts  (coverage endpoint)
 *  - apps/worker/src/lib/financial-facts/*   (worker pipeline)
 */

import type { FinancialFactV1 } from "./financial-fact-v1";

// ─── Metric groups ────────────────────────────────────────────────────────────

export const INCOME_STATEMENT_METRICS: string[] = [
  "revenue", "cogs", "gross_profit", "gross_margin",
  "opex", "ebitda", "net_income",
];

export const UNIT_ECONOMICS_METRICS: string[] = [
  "arr", "mrr", "cac", "ltv", "arpu", "churn_pct", "retention_pct",
];

export const CASH_FLOW_METRICS: string[] = [
  "cash", "burn_rate", "runway_months",
];

// ─── Conflict type ────────────────────────────────────────────────────────────

export interface FinancialConflictV1 {
  metric_key: string;
  period_label: string;
  fact_ids: string[];
  values: number[];
  /** Max relative divergence 0-1 */
  divergence_pct: number;
  source_kinds: string[];
}

// ─── Coverage type ────────────────────────────────────────────────────────────

export interface FinancialCoverageV1 {
  statements: {
    income_statement: boolean;
    balance_sheet: boolean;
    cash_flow: boolean;
    forecast: boolean;
  };
  periods: {
    yearly: string[];
    quarterly: string[];
    monthly: string[];
    ttm: string[];
  };
  /** Canonical metric keys present in the registry */
  metrics_present: string[];
  /** Expected-but-absent metrics (only when there is a clear expectation) */
  metrics_missing: string[];
  conflicts: Array<{
    metric: string;
    timeframe?: string;
    values: number[];
    fact_ids: string[];
  }>;
  confidence_distribution: { high: number; medium: number; low: number };
  total_facts: number;
}

// ─── Conflict detection ───────────────────────────────────────────────────────

/** Minimum relative divergence to declare a conflict */
const CONFLICT_THRESHOLD = 0.05;

/**
 * Detect conflicting FinancialFactV1 entries.
 * A conflict = same (metric_key, period_label), values diverge > 5 %.
 * Pure, never throws.
 */
export function detectFinancialFactConflictsV1(
  facts: FinancialFactV1[],
): FinancialConflictV1[] {
  if (!Array.isArray(facts) || facts.length < 2) return [];

  try {
    const groups = new Map<string, FinancialFactV1[]>();
    for (const fact of facts) {
      if (typeof fact.value !== "number" || !Number.isFinite(fact.value)) continue;
      const key = `${fact.metric_key}:${fact.period_label}`;
      const group = groups.get(key);
      if (group) group.push(fact);
      else groups.set(key, [fact]);
    }

    const conflicts: FinancialConflictV1[] = [];

    for (const [key, group] of groups.entries()) {
      if (group.length < 2) continue;
      const unique = dedupeByFactId(group);
      if (unique.length < 2) continue;
      const values = unique.map((f) => f.value);
      const divergence = maxRelativeDivergence(values);
      if (divergence <= CONFLICT_THRESHOLD) continue;
      const [metric_key, period_label] = key.split(":") as [string, string];
      conflicts.push({
        metric_key,
        period_label,
        fact_ids: unique.map((f) => f.fact_id),
        values,
        divergence_pct: Math.round(divergence * 1000) / 1000,
        source_kinds: [...new Set(unique.map((f) => f.source_kind))],
      });
    }

    return conflicts;
  } catch {
    return [];
  }
}

// ─── Coverage builder ─────────────────────────────────────────────────────────

/**
 * Build a FinancialCoverageV1 from FinancialFactV1[] entries.
 * Pure function — no DB, no LLM. Never throws.
 */
export function buildFinancialCoverageV1(
  _dealId: string,
  facts: FinancialFactV1[],
): FinancialCoverageV1 {
  const empty = emptyProfile();
  if (!Array.isArray(facts) || facts.length === 0) return empty;

  try {
    const metricsPresent = new Set<string>();
    const yearly   = new Set<string>();
    const quarterly = new Set<string>();
    const monthly  = new Set<string>();
    const ttm      = new Set<string>();
    let high = 0, medium = 0, low = 0;

    for (const fact of facts) {
      metricsPresent.add(fact.metric_key);
      switch (fact.period_type) {
        case "annual":    yearly.add(fact.period_label);    break;
        case "quarterly": quarterly.add(fact.period_label); break;
        case "monthly":   monthly.add(fact.period_label);  break;
        case "ttm":       ttm.add(fact.period_label);      break;
        default: break;
      }
      switch (fact.confidence) {
        case "high":   high++;   break;
        case "medium": medium++; break;
        case "low":    low++;    break;
      }
    }

    const statements = {
      income_statement: INCOME_STATEMENT_METRICS.some((m) => metricsPresent.has(m)),
      balance_sheet:    ["cash", "total_assets", "total_liabilities", "equity"].some(
        (m) => metricsPresent.has(m)
      ),
      cash_flow:  CASH_FLOW_METRICS.some((m) => metricsPresent.has(m)),
      forecast:   ["projected_revenue", "forecast_revenue", "projected_arr",
                    "projected_ebitda"].some((m) => metricsPresent.has(m)),
    };

    const metrics_missing = inferMissingMetrics(metricsPresent);

    const rawConflicts = detectFinancialFactConflictsV1(facts);
    const conflicts = rawConflicts.map((c) => ({
      metric: c.metric_key,
      timeframe: c.period_label !== "current" ? c.period_label : undefined,
      values: c.values,
      fact_ids: c.fact_ids,
    }));

    return {
      statements,
      periods: {
        yearly:    [...yearly].sort(),
        quarterly: [...quarterly].sort(),
        monthly:   [...monthly].sort(),
        ttm:       [...ttm].sort(),
      },
      metrics_present: [...metricsPresent].sort(),
      metrics_missing,
      conflicts,
      confidence_distribution: { high, medium, low },
      total_facts: facts.length,
    };
  } catch {
    return empty;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferMissingMetrics(present: Set<string>): string[] {
  const missing: string[] = [];
  const expect = (trigger: string, expected: string) => {
    if (present.has(trigger) && !present.has(expected)) missing.push(expected);
  };
  expect("revenue",     "gross_margin");
  expect("revenue",     "opex");
  expect("arr",         "mrr");
  expect("cac",         "ltv");
  expect("cash",        "burn_rate");
  expect("burn_rate",   "runway_months");
  expect("gross_profit","gross_margin");
  return missing;
}

function emptyProfile(): FinancialCoverageV1 {
  return {
    statements: {
      income_statement: false, balance_sheet: false,
      cash_flow: false, forecast: false,
    },
    periods: { yearly: [], quarterly: [], monthly: [], ttm: [] },
    metrics_present: [],
    metrics_missing: [],
    conflicts: [],
    confidence_distribution: { high: 0, medium: 0, low: 0 },
    total_facts: 0,
  };
}

function dedupeByFactId(facts: FinancialFactV1[]): FinancialFactV1[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    if (seen.has(f.fact_id)) return false;
    seen.add(f.fact_id);
    return true;
  });
}

function maxRelativeDivergence(values: number[]): number {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === 0) return 0;
  return Math.abs(max - min) / Math.abs(max);
}
