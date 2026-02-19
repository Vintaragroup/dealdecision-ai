export type TractionSignalProfileV1 = {
  historical_revenue_present: boolean;
  forecast_revenue_present: boolean;
  user_metrics_present: boolean;
  growth_rate_present: boolean;
  recurring_revenue_present: boolean;
  bookings_present: boolean;
  tam_only: boolean;
  confidence: "low" | "medium" | "high";
  signals: Array<{ code: string; present: boolean }>;
};

type FinancialCoverageLike = any;

type PromotedFactLike = any;

type StructuredSummaryLike = any;

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const promotedFactTypeOf = (pf: PromotedFactLike): string => {
  const root = asNonEmptyString(pf?.fact_type);
  if (root) return root;
  const nested = asNonEmptyString(pf?.content_json?.fact_type);
  return nested ?? "";
};

const hasTamLikeMarketFields = (market: any): boolean => {
  if (!market || typeof market !== "object") return false;

  const hasVal = (v: any): boolean => {
    if (v == null) return false;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") return !!asNonEmptyString(v);
    if (typeof v === "object") {
      const text = asNonEmptyString(v?.value ?? v?.display ?? v?.raw ?? null);
      if (text) return true;
      return Object.keys(v).length > 0;
    }
    return false;
  };

  const keys = [
    "tam",
    "sam",
    "som",
    "market_size",
    "marketSize",
    "total_addressable_market",
    "totalAddressableMarket",
    "serviceable_available_market",
    "serviceableAvailableMarket",
    "serviceable_obtainable_market",
    "serviceableObtainableMarket",
  ];

  for (const k of keys) {
    if (hasVal((market as any)[k])) return true;
  }

  // Accept nested value_json (common promoted-fact-like shape).
  const vj = (market as any)?.value_json ?? (market as any)?.valueJson ?? null;
  if (vj && typeof vj === "object") {
    for (const k of keys) {
      if (hasVal((vj as any)[k])) return true;
    }
  }

  const text = asNonEmptyString((market as any)?.value ?? (market as any)?.raw ?? (market as any)?.display ?? null);
  if (text) {
    return /\b(tam|sam|som|total\s+addressable\s+market|serviceable\s+available\s+market|serviceable\s+obtainable\s+market|market\s*(size|sizing))\b/i.test(text);
  }

  return false;
};

const recurringSignalsFromStructuredSummary = (structured: StructuredSummaryLike): boolean => {
  const bm = asNonEmptyString(structured?.business_model?.value ?? structured?.business_model ?? null) ?? "";
  const revLabel = asNonEmptyString(structured?.revenue?.label ?? null) ?? "";
  const revRaw = asNonEmptyString(structured?.revenue?.value?.raw ?? null) ?? "";
  const combined = `${bm} ${revLabel} ${revRaw}`.trim();
  if (!combined) return false;
  return /\b(recurring|subscription|subscribe|saas|mrr|arr|acv|annual\s+contract)\b/i.test(combined);
};

const isMarketSizingFact = (ft: string, pf: any): boolean => {
  const s = ft.toLowerCase();
  if (s.includes("market_size") || s.includes("market") || s.includes("tam") || s.includes("sam") || s.includes("som")) return true;
  const scope = asNonEmptyString(pf?.content_json?.value_json?.scope ?? pf?.content_json?.provenance?.scope ?? null);
  if (scope && scope.toLowerCase().includes("market")) return true;
  return false;
};

const hasPercentGrowthEvidence = (pf: any): boolean => {
  const cj = pf?.content_json && typeof pf.content_json === "object" ? pf.content_json : null;
  const vj = cj && typeof (cj as any).value_json === "object" ? (cj as any).value_json : null;
  const percent = vj ? (vj as any).percent ?? (vj as any).growth_percent ?? (vj as any).pct : null;
  if (typeof percent === "number" && Number.isFinite(percent)) return true;
  const display = asNonEmptyString(vj?.display ?? vj?.raw ?? (cj as any)?.text ?? (cj as any)?.raw ?? null);
  if (!display) return false;

  // Require explicit percent and a growth-ish token to reduce false positives.
  if (!/%/.test(display)) return false;
  if (!/\b(growth|yoy|y\/y|mom|m\/m|cagr|increase|up)\b/i.test(display)) return false;
  return true;
};

export function inferTractionSignalProfileV1(input: {
  financial_coverage_v1?: any;
  structured_summary?: any;
  promoted_facts?: any[] | null;
}): TractionSignalProfileV1 {
  const fc: FinancialCoverageLike = input.financial_coverage_v1 ?? null;
  const structured: StructuredSummaryLike = input.structured_summary ?? null;
  const promoted = Array.isArray(input.promoted_facts) ? input.promoted_facts : [];

  const historical_revenue_present = fc?.coverage?.historical_revenue_present === true;
  const forecast_revenue_present = fc?.coverage?.forecast_revenue_present === true;

  const tamOnlyMarket = hasTamLikeMarketFields(structured?.market);
  const tam_only = !historical_revenue_present && !forecast_revenue_present && tamOnlyMarket;

  const userMetricsFromStructured = (() => {
    const users = structured?.users ?? structured?.user_metrics ?? structured?.userMetrics;
    if (!users) return false;
    if (typeof users === "string") return !!asNonEmptyString(users);
    if (typeof users === "number") return Number.isFinite(users);
    if (typeof users === "object") return Object.keys(users).length > 0;
    return false;
  })();

  const userMetricsFromFacts = promoted.some((pf) => {
    const ft = promotedFactTypeOf(pf).toLowerCase();
    if (!ft) return false;
    return (
      ft === "user_growth_v1" ||
      ft === "users_v1" ||
      ft === "active_users_v1" ||
      ft === "mau_v1" ||
      ft === "dau_v1" ||
      (ft.includes("user") && ft.includes("_v1"))
    );
  });

  const user_metrics_present = userMetricsFromStructured || userMetricsFromFacts;

  const growth_rate_present = promoted.some((pf) => {
    const ft = promotedFactTypeOf(pf);
    if (!ft) return false;
    if (isMarketSizingFact(ft, pf)) return false;
    return hasPercentGrowthEvidence(pf);
  });

  const recurring_revenue_present = recurringSignalsFromStructuredSummary(structured);

  const bookings_present = promoted.some((pf) => {
    const ft = promotedFactTypeOf(pf).toLowerCase();
    return ft === "bookings_v1" || ft.includes("bookings");
  });

  const confidence: TractionSignalProfileV1["confidence"] =
    historical_revenue_present || (recurring_revenue_present && growth_rate_present)
      ? "high"
      : (user_metrics_present || bookings_present)
        ? "medium"
        : "low";

  const signals: TractionSignalProfileV1["signals"] = [
    { code: "historical_revenue_present", present: historical_revenue_present },
    { code: "forecast_revenue_present", present: forecast_revenue_present },
    { code: "user_metrics_present", present: user_metrics_present },
    { code: "growth_rate_present", present: growth_rate_present },
    { code: "recurring_revenue_present", present: recurring_revenue_present },
    { code: "bookings_present", present: bookings_present },
    { code: "tam_only", present: tam_only },
  ];

  return {
    historical_revenue_present,
    forecast_revenue_present,
    user_metrics_present,
    growth_rate_present,
    recurring_revenue_present,
    bookings_present,
    tam_only,
    confidence,
    signals,
  };
}
