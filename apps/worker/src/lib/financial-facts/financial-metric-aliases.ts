/**
 * financial-metric-aliases.ts
 *
 * Deterministic alias normalization for financial metric labels.
 *
 * Used by:
 *  - extract-financial-table-claims.ts  (PDF table → FinancialFactV1)
 *  - build-financial-fact-registry-v1.ts labelToMetricKey (re-uses this map)
 *
 * Rules:
 * - All lookups are lowercase + collapsed whitespace.
 * - Returns a canonical metric_key (snake_case) or a slugified fallback.
 * - Never guesses — if no alias matches, slug the raw label; caller must decide
 *   whether to accept an unknown key.
 */

// ─── Alias table ──────────────────────────────────────────────────────────────

/** Keys = lowercase normalized alias; values = canonical metric_key */
export const METRIC_ALIAS_MAP: Record<string, string> = {
  // ── Revenue ──────────────────────────────────────────────────────────────
  revenue:                              "revenue",
  revenues:                             "revenue",
  sales:                                "revenue",
  "total revenue":                      "revenue",
  "total revenues":                     "revenue",
  "total sales":                        "revenue",
  "net revenue":                        "revenue",
  "net revenues":                       "revenue",
  "net sales":                          "revenue",
  "gross revenue":                      "revenue",
  "top line":                           "revenue",
  "top-line":                           "revenue",
  // XLSX financial model variants
  "total revenue recognized":           "revenue",
  "revenue recognized":                 "revenue",
  "subscription revenue recognized":    "revenue",
  "subscription revenue":               "revenue",
  "total subscription revenue":         "revenue",
  "total recurring revenue":            "revenue",
  "recurring revenue":                  "revenue",
  // ── COGS ─────────────────────────────────────────────────────────────────
  cogs:                      "cogs",
  "cost of goods sold":      "cogs",
  "cost of revenue":         "cogs",
  "cost of sales":           "cogs",
  "total cogs":              "cogs",
  // ── Gross Profit ─────────────────────────────────────────────────────────
  "gross profit":            "gross_profit",
  "gross income":            "gross_profit",
  gp:                        "gross_profit",
  // ── Gross Margin ─────────────────────────────────────────────────────────
  "gross margin":            "gross_margin",
  "gross margin %":          "gross_margin",
  "gross margin pct":        "gross_margin",
  "gm%":                     "gross_margin",
  gm:                        "gross_margin",
  "gross margin percentage": "gross_margin",
  // ── Operating Expenses ───────────────────────────────────────────────────
  "operating expense":       "opex",
  "operating expenses":      "opex",
  "total operating expenses":"opex",
  opex:                      "opex",
  "op ex":                   "opex",
  "total opex":              "opex",
  // ── EBITDA ───────────────────────────────────────────────────────────────
  ebitda:                    "ebitda",
  "adjusted ebitda":         "ebitda",
  // ── Net Income ───────────────────────────────────────────────────────────
  "net income":              "net_income",
  "net profit":              "net_income",
  "net loss":                "net_income",
  "net income / loss":       "net_income",
  "net income/loss":         "net_income",
  "profit / loss":           "net_income",
  "profit/loss":             "net_income",
  "p&l":                     "net_income",
  // ── Cash ─────────────────────────────────────────────────────────────────
  cash:                      "cash",
  "cash balance":            "cash",
  "cash on hand":            "cash",
  "cash and cash equivalents": "cash",
  "ending cash":             "cash",
  "closing cash":            "cash",
  "cash position":           "cash",
  // ── Burn Rate ────────────────────────────────────────────────────────────
  burn:                      "burn_rate",
  "burn rate":               "burn_rate",
  "monthly burn":            "burn_rate",
  "monthly burn rate":       "burn_rate",
  "net burn":                "burn_rate",
  "cash burn":               "burn_rate",
  "net cash burn":           "burn_rate",
  "monthly cash burn":       "burn_rate",
  // ── Runway ───────────────────────────────────────────────────────────────
  runway:                    "runway_months",
  "cash runway":             "runway_months",
  "runway months":           "runway_months",
  "months runway":           "runway_months",
  "months of runway":        "runway_months",
  "months of cash":          "runway_months",
  "operating runway":        "runway_months",
  // ── ARR ──────────────────────────────────────────────────────────────────
  arr:                       "arr",
  "annual recurring revenue":"arr",
  "annual run rate":         "arr",
  // ── MRR ──────────────────────────────────────────────────────────────────
  mrr:                       "mrr",
  "monthly recurring revenue":"mrr",
  "monthly run rate":        "mrr",
  // ── CAC ──────────────────────────────────────────────────────────────────
  cac:                       "cac",
  "customer acquisition cost":"cac",
  "cost of acquisition":     "cac",
  "cost per acquisition":    "cac",
  // ── LTV ──────────────────────────────────────────────────────────────────
  ltv:                       "ltv",
  "lifetime value":          "ltv",
  "customer lifetime value": "ltv",
  clv:                       "ltv",
  lvcustomer:                "ltv",
  // ── ARPU ─────────────────────────────────────────────────────────────────
  arpu:                      "arpu",
  "average revenue per user":"arpu",
  "average revenue per account": "arpu",
  arpa:                      "arpu",
  // ── Churn ────────────────────────────────────────────────────────────────
  churn:                     "churn_pct",
  "churn rate":              "churn_pct",
  "monthly churn":           "churn_pct",
  "monthly churn rate":      "churn_pct",
  "annual churn":            "churn_pct",
  "customer churn":          "churn_pct",
  // ── Retention ────────────────────────────────────────────────────────────
  retention:                 "retention_pct",
  "retention rate":          "retention_pct",
  "net retention":           "retention_pct",
  "net revenue retention":   "net_revenue_retention",
  "net dollar retention":    "net_revenue_retention",
  nrr:                       "net_revenue_retention",
  ndr:                       "net_revenue_retention",
  "dollar-based net retention": "net_revenue_retention",
  // ── Headcount ────────────────────────────────────────────────────────────
  headcount:                 "headcount",
  employees:                 "headcount",
  "full-time employees":     "headcount",
  fte:                       "headcount",
  "team size":               "headcount",
  // ── Pre-Money Valuation (Ask slide) ──────────────────────────────────────
  valuation:                       "pre_money_valuation",
  "company valuation":             "pre_money_valuation",
  "pre-money valuation":           "pre_money_valuation",
  "pre money valuation":           "pre_money_valuation",
  "pre-money":                     "pre_money_valuation",
  "pre money":                     "pre_money_valuation",
  "current valuation":             "pre_money_valuation",
  "implied valuation":             "pre_money_valuation",
  "valuation cap":                 "pre_money_valuation",
  // ── Post-Money Valuation ──────────────────────────────────────────────────
  "post-money valuation":          "post_money_valuation",
  "post money valuation":          "post_money_valuation",
  "post-money":                    "post_money_valuation",
  "post money":                    "post_money_valuation",
  "post-money cap":                "post_money_valuation",
  // ── Raise Amount (Ask slide) ──────────────────────────────────────────────
  raise:                           "raise_amount",
  "raise amount":                  "raise_amount",
  "total raise":                   "raise_amount",
  "total fundraise":               "raise_amount",
  fundraise:                       "raise_amount",
  "raising":                       "raise_amount",
  "we are raising":                "raise_amount",
  "capital raise":                 "raise_amount",
  "capital ask":                   "raise_amount",
  "investment ask":                "raise_amount",
  "investment round":              "raise_amount",
  "round size":                    "raise_amount",
  "funding ask":                   "raise_amount",
  "funding amount":                "raise_amount",
  "seeking":                       "raise_amount",
  "amount sought":                 "raise_amount",
  "amount raising":                "raise_amount",
  "funding sought":                "raise_amount",
  "the ask":                       "raise_amount",
  "pre-seed raise":                "raise_amount",
  "pre seed raise":                "raise_amount",
  "seed round":                    "raise_amount",
  "seed funding":                  "raise_amount",
  "series a":                      "raise_amount",
  "series a round":                "raise_amount",
  "series b":                      "raise_amount",
  "series b round":                "raise_amount",
  // ── Traction / GMV ────────────────────────────────────────────────────────
  gmv:                             "gmv",
  "gross merchandise value":       "gmv",
  "gross merchandise volume":      "gmv",
  "total gmv":                     "gmv",
  tgmv:                            "gmv",
};

// ─── Normalizer ───────────────────────────────────────────────────────────────

/**
 * Set of all valid canonical metric keys — the range of METRIC_ALIAS_MAP.
 *
 * Used by extractors to distinguish "alias-mapped" keys (clean) from
 * "slugified fallback" keys (potentially noisy).  Any key emitted by
 * `normalizeMetricKey` that is NOT in this set originated from a raw label
 * that had no alias match and was simply slugified.
 */
export const KNOWN_CANONICAL_METRIC_KEYS: ReadonlySet<string> = new Set(
  Object.values(METRIC_ALIAS_MAP),
);

/**
 * Returns true when `key` is a canonical metric key from the alias map —
 * i.e. it was produced by an alias match, not a slug fallback.
 */
export function isKnownMetricKey(key: string): boolean {
  return KNOWN_CANONICAL_METRIC_KEYS.has(key);
}

/**
 * Financial signal keywords.  Used as a secondary acceptance criterion when a
 * raw label does not map to any alias: the label must contain at least one of
 * these words to be considered a plausible (if non-canonical) financial metric.
 */
export const FINANCIAL_SIGNAL_KEYWORDS_RE =
  /\b(revenue|sales|income|profit|loss|cost|expense|margin|burn|runway|cash|arr|mrr|gmv|ebitda|arpu|cac|ltv|nrr|churn|retention|raise|ask|valuation|funding|budget|forecast|opex|headcount|employees)\b/i;

/**
 * Normalize a raw metric label to a canonical metric_key.
 *
 * 1. Lowercase + collapse whitespace.
 * 2. Strip trailing punctuation (%, :, /, $).
 * 3. Alias lookup.
 * 4. If no alias: slug the raw label (lowercase + underscores).
 *
 * Never throws.
 */
export function normalizeMetricKey(rawLabel: string): string {
  try {
    const normalized = rawLabel
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[%:$/]+$/, "")
      .replace(/^\s+|\s+$/g, "");

    return METRIC_ALIAS_MAP[normalized]
      ?? normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  } catch {
    return "unknown";
  }
}

/**
 * "Core" metric keys — ones that are commonly expected when certain others
 * are present. Used for metrics_missing inference in the coverage report.
 *
 * Canonical definitions live in @dealdecision/core; re-exported here for
 * convenience within the worker.
 */
export {
  INCOME_STATEMENT_METRICS,
  UNIT_ECONOMICS_METRICS,
  CASH_FLOW_METRICS,
} from "@dealdecision/core";
