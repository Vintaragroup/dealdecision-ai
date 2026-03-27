/**
 * Financial Semantics — Canonical Type Definitions (Phase 0)
 *
 * All types in this module are pure definitions — no logic, no imports.
 * These are the stable public contract for the financial semantics layer.
 *
 * Design rules:
 *  - Discriminated unions preferred over open strings
 *  - No optional fields where a sentinel value (e.g. "unknown") is clearer
 *  - Additive only: extend these types, never narrow them
 */

// ─── Semantic families ─────────────────────────────────────────────────────────

/**
 * High-level financial domain family for a metric or table.
 *
 * Families are mutually exclusive at the metric level but a table may span
 * multiple families (e.g. a metrics dashboard covers unit_economics + liquidity).
 */
export type FinancialSemanticFamily =
  | "revenue"        // top-line income metrics (revenue, ARR, MRR, GMV)
  | "expense"        // operating cost metrics (COGS, OPEX, payroll, rent)
  | "profitability"  // margin / earnings (gross_profit, gross_margin, EBITDA, net_income)
  | "liquidity"      // cash position and burn (cash, burn_rate, runway_months)
  | "capitalization" // ownership structure (raise_amount, valuation, cap table fields)
  | "unit_economics" // per-customer economics (CAC, LTV, ARPU, churn, retention)
  | "growth"         // rate-of-change metrics (revenue_growth_rate, NRR)
  | "headcount"      // people metrics (headcount, FTE, contractors)
  | "forecast"       // forward-looking projections with no historical equivalent
  | "other";         // recognized but uncategorized

// ─── Semantic roles ────────────────────────────────────────────────────────────

/**
 * How a metric value was produced within the dataset.
 *
 * - explicit   — directly stated in a source document (highest trust)
 * - derived    — calculated deterministically from other explicit metrics
 * - inferred   — estimated from context (lower confidence)
 * - supporting — metadata/label field — not a primary financial signal
 * - unknown    — provenance could not be determined
 */
export type FinancialSemanticRole =
  | "explicit"
  | "derived"
  | "inferred"
  | "supporting"
  | "unknown";

// ─── Table semantic types ──────────────────────────────────────────────────────

/**
 * The functional type of a financial table / sheet.
 *
 * Maps to SheetKind and LayoutType from existing classifiers but uses
 * semantics-layer naming to remain independent of their internal details.
 */
export type FinancialTableSemanticType =
  | "income_statement"   // P&L: revenue, COGS, gross profit, EBITDA, net income
  | "opex_schedule"      // Detailed operating expense breakdown
  | "revenue_model"      // Revenue build-up / ARR waterfall
  | "cash_flow"          // Cash movements: operating, investing, financing
  | "balance_sheet"      // Assets, liabilities, equity
  | "cap_table"          // Ownership: shares, investors, option pool
  | "saas_kpi_table"     // SaaS-specific KPIs: churn, NRR, CAC, LTV, ARPU
  | "use_of_funds"       // Raised capital allocation plan
  | "forecast_model"     // Forward-looking projections (monthly/quarterly/annual)
  | "metrics_dashboard"  // Mixed KPI summary — no single canonical structure
  | "unknown";

// ─── Missingness diagnostics ───────────────────────────────────────────────────

/**
 * Why a metric that should be present in the dataset is absent.
 *
 * Used to produce actionable hints for the underwriting analyst, not just
 * "we don't have it" — but WHY, and what it would take to get it.
 */
export type MissingnessReason =
  | "not_provided"                       // document never mentioned this metric
  | "not_extracted"                      // likely present but extraction failed
  | "extracted_but_rejected"             // extracted but failed confidence/validation
  | "derivable_if_dependencies_exist"    // could be computed if other facts are present
  | "projected_only"                     // only projected values found; no historical
  | "low_confidence_only"               // only low-confidence extractions available
  | "unknown";

export interface MissingnessHint {
  /** Canonical metric key (e.g. "burn_rate", "gross_margin"). */
  metricKey: string;
  /** Why this metric is missing from the dataset. */
  reason: MissingnessReason;
  /** Metric keys that, if present, would allow this metric to be derived. */
  derivableFrom?: string[];
}

// ─── Primary output type ──────────────────────────────────────────────────────

/**
 * The full semantic interpretation of a financial dataset.
 *
 * This is the stable output contract for `interpretFinancialSemantics()`.
 * All boolean flags default to false; arrays default to empty.
 *
 * Design intent:
 *  - Additive — new fields may be added in future phases without breaking consumers
 *  - Deterministic — same input always produces same output
 *  - No LLM, no async, no DB
 */
export interface SemanticInterpretation {
  // ── Operating model presence signals ──────────────────────────────────────

  /** True if revenue + at least one expense metric exist (non-projected). */
  hasOperatingModel: boolean;
  /** True if ARR, MRR, or revenue exists (non-projected). */
  hasRevenueModel: boolean;
  /** True if cash + burn_rate or cash + any expense metric exists. */
  hasCashModel: boolean;
  /** True if cap table fields (raise_amount, valuation, shares) exist. */
  hasCapTableModel: boolean;
  /** True if any projected-scope facts exist. */
  hasForecastModel: boolean;

  // ── Family coverage ────────────────────────────────────────────────────────

  /** Families with at least one explicit historical/current fact. */
  explicitFamilies: FinancialSemanticFamily[];
  /** Families with only inferred or projected coverage. */
  inferredFamilies: FinancialSemanticFamily[];

  // ── Table type coverage ────────────────────────────────────────────────────

  /** All distinct table semantic types detected across the input. */
  tableSemanticTypes: FinancialTableSemanticType[];

  // ── Derivability signals ───────────────────────────────────────────────────

  /**
   * True if burn_rate is absent BUT expense-family facts exist that could be
   * summed to estimate it. Only true when the prerequisite metrics are
   * non-projected.
   */
  canDeriveBurnRate: boolean;

  /**
   * True if both cash and burn_rate are present (same period_label,
   * non-projected) and runway_months is absent.
   */
  canDeriveRunway: boolean;

  /**
   * True if revenue and gross_profit are present (same period_label,
   * non-projected) and gross_margin (%) is absent.
   */
  canDeriveGrossMargin: boolean;

  /**
   * True if MRR is present and ARR is absent — ARR = MRR × 12.
   */
  canDeriveArrFromMrr: boolean;

  // ── Missingness diagnostics ────────────────────────────────────────────────

  /**
   * Structured hints for metrics that are absent, including the likely reason
   * and what prerequisites exist for derivation.
   */
  missingnessHints: MissingnessHint[];
}
