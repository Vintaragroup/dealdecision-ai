/**
 * Financial Metric Ontology (Phase 0)
 *
 * Canonical registry of all recognized financial metric keys with their:
 *  - semantic family
 *  - known aliases (label strings that map to this key)
 *  - derivability rules (can this metric be computed from others?)
 *
 * Design rules:
 *  - All metric_key values here MUST match those used in FinancialFactV1
 *  - Aliases are lower-cased, trimmed; matching is case-insensitive
 *  - This is the single source of truth for metric identity — no duplication
 *    in table-semantics, metric-semantics, or the interpreter
 *  - Additive only — extend, never rename existing entries
 */

import type { FinancialSemanticFamily } from "./semantic-types.js";

// ─── Entry type ───────────────────────────────────────────────────────────────

export interface MetricOntologyEntry {
  /** Canonical snake_case metric key — must match FinancialFactV1.metric_key */
  metricKey: string;
  /** High-level domain family for grouping and presence detection */
  family: FinancialSemanticFamily;
  /**
   * Lower-cased label aliases that should map to this metric.
   * Matching performed case-insensitively against label strings.
   */
  aliases: string[];
  /** Whether this metric can be deterministically derived from other metrics. */
  canBeDerived: boolean;
  /**
   * The metric keys required to derive this one.
   * Only meaningful when canBeDerived = true.
   */
  derivationDependencies?: string[];
  /**
   * When true, projected-only presence of this metric still counts as coverage.
   * Default: false (projected-only triggers a different missingness reason).
   */
  supportsProjectedOnly?: boolean;
}

// ─── Ontology registry ────────────────────────────────────────────────────────

/**
 * METRIC_ONTOLOGY
 *
 * Keyed by canonical metric_key string. All metric family resolution,
 * alias matching, and derivability checks should delegate here.
 */
export const METRIC_ONTOLOGY: Record<string, MetricOntologyEntry> = {

  // ── Revenue ─────────────────────────────────────────────────────────────────

  revenue: {
    metricKey: "revenue",
    family: "revenue",
    aliases: [
      "revenue", "total revenue", "net revenue", "net sales", "sales", "income",
      "total sales", "total income", "top line", "topline", "total net revenue",
      "product revenue", "service revenue",
    ],
    canBeDerived: false,
  },

  arr: {
    metricKey: "arr",
    family: "revenue",
    aliases: [
      "arr", "annual recurring revenue", "annualized recurring revenue",
      "annual run rate", "annualized run rate",
    ],
    canBeDerived: true,
    derivationDependencies: ["mrr"],
    supportsProjectedOnly: true,
  },

  mrr: {
    metricKey: "mrr",
    family: "revenue",
    aliases: [
      "mrr", "monthly recurring revenue", "monthly run rate",
      "recurring revenue", "monthly recurring",
    ],
    canBeDerived: true,
    derivationDependencies: ["arr"],
    supportsProjectedOnly: true,
  },

  gmv: {
    metricKey: "gmv",
    family: "revenue",
    aliases: [
      "gmv", "gross merchandise value", "gross merchandise volume",
      "total transaction value", "transaction volume",
    ],
    canBeDerived: false,
    supportsProjectedOnly: true,
  },

  // ── Expense ─────────────────────────────────────────────────────────────────

  cogs: {
    metricKey: "cogs",
    family: "expense",
    aliases: [
      "cogs", "cost of goods sold", "cost of revenue", "cost of sales",
      "direct costs", "cost of services", "cost of products",
    ],
    canBeDerived: false,
  },

  opex: {
    metricKey: "opex",
    family: "expense",
    aliases: [
      "opex", "operating expenses", "total operating expenses", "operating costs",
      "total opex", "sg&a", "general and administrative", "g&a", "total expenses",
    ],
    canBeDerived: true,
    derivationDependencies: ["cogs"], // opex can be inferred as revenue - gross_profit - cogs context
  },

  // ── Profitability ────────────────────────────────────────────────────────────

  gross_profit: {
    metricKey: "gross_profit",
    family: "profitability",
    aliases: [
      "gross profit", "gross income", "gross earnings",
    ],
    canBeDerived: true,
    derivationDependencies: ["revenue", "cogs"],
  },

  gross_margin: {
    metricKey: "gross_margin",
    family: "profitability",
    aliases: [
      "gross margin", "gross margin %", "gross margin percentage",
      "gm %", "gm%", "gross margin pct",
    ],
    canBeDerived: true,
    derivationDependencies: ["revenue", "gross_profit"],
  },

  ebitda: {
    metricKey: "ebitda",
    family: "profitability",
    aliases: [
      "ebitda", "earnings before interest taxes depreciation amortization",
      "adjusted ebitda", "adj ebitda",
    ],
    canBeDerived: true,
    derivationDependencies: ["revenue", "opex"],
  },

  net_income: {
    metricKey: "net_income",
    family: "profitability",
    aliases: [
      "net income", "net profit", "net earnings", "net loss",
      "bottom line", "net income (loss)", "net profit (loss)",
    ],
    canBeDerived: true,
    derivationDependencies: ["revenue", "opex"],
  },

  // ── Liquidity ────────────────────────────────────────────────────────────────

  cash: {
    metricKey: "cash",
    family: "liquidity",
    aliases: [
      "cash", "cash on hand", "cash and cash equivalents", "cash balance",
      "total cash", "ending cash", "beginning cash", "cash position",
      "current cash", "bank balance", "cash in bank",
    ],
    canBeDerived: false,
  },

  burn_rate: {
    metricKey: "burn_rate",
    family: "liquidity",
    aliases: [
      "burn rate", "monthly burn", "monthly burn rate", "net burn",
      "cash burn", "burn", "monthly cash burn", "gross burn",
      "net cash burn",
    ],
    canBeDerived: true,
    derivationDependencies: ["opex"], // opex-family fallback derivation
  },

  runway_months: {
    metricKey: "runway_months",
    family: "liquidity",
    aliases: [
      "runway", "runway months", "months of runway", "cash runway",
      "months runway", "runway (months)", "months of cash",
    ],
    canBeDerived: true,
    derivationDependencies: ["cash", "burn_rate"],
  },

  // ── Capitalization ─────────────────────────────────────────────────────────

  raise_amount: {
    metricKey: "raise_amount",
    family: "capitalization",
    aliases: [
      "raise", "raise amount", "raising", "funding amount", "round size",
      "investment amount", "target raise", "total raise", "seeking",
      "raising $", "current round", "amount raised", "ask",
    ],
    canBeDerived: false,
  },

  pre_money_valuation: {
    metricKey: "pre_money_valuation",
    family: "capitalization",
    aliases: [
      "pre-money valuation", "pre money valuation", "pre-money",
      "pre money", "valuation", "company valuation", "current valuation",
    ],
    canBeDerived: false,
  },

  post_money_valuation: {
    metricKey: "post_money_valuation",
    family: "capitalization",
    aliases: [
      "post-money valuation", "post money valuation", "post-money",
      "post money",
    ],
    canBeDerived: true,
    derivationDependencies: ["pre_money_valuation", "raise_amount"],
  },

  shares_outstanding: {
    metricKey: "shares_outstanding",
    family: "capitalization",
    aliases: [
      "shares outstanding", "total shares", "shares issued",
      "total shares outstanding", "common shares",
    ],
    canBeDerived: false,
  },

  option_pool: {
    metricKey: "option_pool",
    family: "capitalization",
    aliases: [
      "option pool", "esop", "employee stock option plan", "option pool %",
      "equity pool", "stock option pool",
    ],
    canBeDerived: false,
  },

  // ── Unit Economics ──────────────────────────────────────────────────────────

  cac: {
    metricKey: "cac",
    family: "unit_economics",
    aliases: [
      "cac", "customer acquisition cost", "cost per acquisition", "cpa",
      "avg cac", "average cac",
    ],
    canBeDerived: false,
  },

  ltv: {
    metricKey: "ltv",
    family: "unit_economics",
    aliases: [
      "ltv", "lifetime value", "customer lifetime value", "clv",
      "avg ltv", "average ltv",
    ],
    canBeDerived: false,
  },

  arpu: {
    metricKey: "arpu",
    family: "unit_economics",
    aliases: [
      "arpu", "average revenue per user", "average revenue per account",
      "arpa", "avg revenue per user",
    ],
    canBeDerived: true,
    derivationDependencies: ["mrr"], // arpu = mrr / active_customers (approximate)
  },

  churn_pct: {
    metricKey: "churn_pct",
    family: "unit_economics",
    aliases: [
      "churn", "churn rate", "monthly churn", "annual churn", "customer churn",
      "churn %", "churn pct", "logo churn", "revenue churn",
    ],
    canBeDerived: false,
  },

  retention_pct: {
    metricKey: "retention_pct",
    family: "unit_economics",
    aliases: [
      "retention", "retention rate", "customer retention", "retention %",
      "retention pct", "logo retention",
    ],
    canBeDerived: true,
    derivationDependencies: ["churn_pct"],
  },

  net_revenue_retention: {
    metricKey: "net_revenue_retention",
    family: "growth",
    aliases: [
      "nrr", "net revenue retention", "net dollar retention", "ndr",
      "net dollar retention rate", "net revenue retention rate",
    ],
    canBeDerived: false,
    supportsProjectedOnly: true,
  },

  // ── Growth ──────────────────────────────────────────────────────────────────

  revenue_growth_rate: {
    metricKey: "revenue_growth_rate",
    family: "growth",
    aliases: [
      "revenue growth", "revenue growth rate", "yoy revenue growth",
      "arr growth", "arr growth rate", "revenue cagr",
    ],
    canBeDerived: true,
    derivationDependencies: ["revenue"],
    supportsProjectedOnly: true,
  },

  // ── Headcount ───────────────────────────────────────────────────────────────

  headcount: {
    metricKey: "headcount",
    family: "headcount",
    aliases: [
      "headcount", "employees", "team size", "fte", "full-time employees",
      "full time employees", "staff", "total employees", "employee count",
      "number of employees",
    ],
    canBeDerived: false,
  },
};

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Resolve a raw label string to a canonical MetricOntologyEntry.
 * Returns undefined if no entry matches.
 *
 * Matching is exact, lower-cased, and trimmed.
 * For fuzzy/partial matching, use inferFamilyFromLabel() in the interpreter.
 */
export function lookupOntologyEntryByAlias(
  label: string,
): MetricOntologyEntry | undefined {
  const normalized = label.toLowerCase().trim();
  for (const entry of Object.values(METRIC_ONTOLOGY)) {
    if (entry.aliases.includes(normalized)) return entry;
  }
  return undefined;
}

/**
 * Resolve a canonical metric_key to its OntologyEntry.
 * Returns undefined for unrecognized keys.
 */
export function lookupOntologyEntryByKey(
  metricKey: string,
): MetricOntologyEntry | undefined {
  return METRIC_ONTOLOGY[metricKey];
}

/**
 * All canonical metric keys that belong to the given family.
 */
export function getMetricKeysForFamily(
  family: FinancialSemanticFamily,
): string[] {
  return Object.values(METRIC_ONTOLOGY)
    .filter((e) => e.family === family)
    .map((e) => e.metricKey);
}
