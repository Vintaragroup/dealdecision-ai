export const FACT_TYPE = {
  ICP: new Set<string>([
    // Observed in core code (string literals in models/scorers)
    "icp_v1",
  ]),
  DISTRIBUTION: new Set<string>([
    // Observed in core code (string literals in models/scorers)
    "distribution_channel_v1",
  ]),
  WEDGE: new Set<string>([
    // Observed in core code (string literals in models/scorers)
    "wedge_strategy_v1",
  ]),
} as const;

// Universe of known fact_type-like strings referenced in code/tests.
// Used to gate heuristic fallback matching to UNKNOWN fact types only.
export const FACT_TYPE_UNIVERSE = new Set<string>([
  ...FACT_TYPE.ICP,
  ...FACT_TYPE.DISTRIBUTION,
  ...FACT_TYPE.WEDGE,

  // Observed in tests and/or code paths that consume promoted facts
  "business_model_v1",
  "customers_v1",
  "growth_outlook_v1",
  "growth_v1",
  "market_size_v1",
  "milestones_v1",
  "note",
  "pricing_model_v1",
  "raise_terms_v1",
  "revenue_v1",
  "unit_economics_v1",
  "use_of_funds_distribution_v1",
  "use_of_funds_v1",
  "valuation_v1",

  // Additional *_v1 identifiers referenced in core code (conservative inclusion)
  "active_users_v1",
  "bookings_v1",
  "dau_v1",
  "forecast_revenue_v1",
  "marketing_attributed_revenue_v1",
  "mau_v1",
  "pipeline_metric_v1",
  "user_growth_v1",
  "users_v1",
  "vision_v1",
  "other_metric_v1",
]);

export function factTypeIn(set: Set<string>, factType: unknown): boolean {
  const ft = typeof factType === "string" ? factType.trim() : "";
  if (!ft) return false;
  return set.has(ft);
}
