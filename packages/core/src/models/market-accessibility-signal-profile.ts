export type MarketAccessibilitySignalProfileV1 = {
  tam_present: boolean;
  sam_present: boolean;
  som_present: boolean;
  icp_defined: boolean;              // ideal customer profile defined
  target_segment_defined: boolean;   // vertical / niche identified
  distribution_channel_defined: boolean;
  wedge_defined: boolean;            // narrow entry strategy
  confidence: "low" | "medium" | "high";
  signals: Array<{ code: string; present: boolean }>;
};

import { FACT_TYPE, FACT_TYPE_UNIVERSE, factTypeIn } from "../classifiers/fact-type-registry.js";

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

const hasAnyValue = (v: any): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return !!asNonEmptyString(v);
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") {
    const text = asNonEmptyString(v?.value ?? v?.display ?? v?.raw ?? null);
    if (text) return true;
    return Object.keys(v).length > 0;
  }
  return false;
};

const hasMarketField = (market: any, keys: string[]): boolean => {
  if (!market || typeof market !== "object") return false;

  for (const k of keys) {
    if (hasAnyValue((market as any)[k])) return true;
  }

  const vj = (market as any)?.value_json ?? (market as any)?.valueJson ?? null;
  if (vj && typeof vj === "object") {
    for (const k of keys) {
      if (hasAnyValue((vj as any)[k])) return true;
    }
  }

  const text = asNonEmptyString((market as any)?.value ?? (market as any)?.raw ?? (market as any)?.display ?? null);
  if (text) {
    const tokens = keys
      .map((x) => x.replace(/_/g, " "))
      .filter(Boolean)
      .join("|");
    if (tokens) {
      const re = new RegExp(`\\b(${tokens})\\b`, "i");
      if (re.test(text)) return true;
    }
    if (/\b(tam|sam|som|market\s*(size|sizing)|total\s+addressable\s+market|serviceable\s+available\s+market|serviceable\s+obtainable\s+market)\b/i.test(text)) return true;
  }

  return false;
};

const hasGoToMarketFields = (structured: StructuredSummaryLike): boolean => {
  const gtm = structured?.go_to_market ?? structured?.goToMarket ?? structured?.gtm ?? null;
  return hasAnyValue(gtm);
};

const hasMarketSegmentFields = (market: any): boolean => {
  if (!market || typeof market !== "object") return false;
  const keys = [
    "segment",
    "segments",
    "target_segment",
    "targetSegment",
    "vertical",
    "industry",
    "niche",
    "persona",
  ];
  for (const k of keys) {
    if (hasAnyValue((market as any)[k])) return true;
  }
  const vj = (market as any)?.value_json ?? (market as any)?.valueJson ?? null;
  if (vj && typeof vj === "object") {
    for (const k of keys) {
      if (hasAnyValue((vj as any)[k])) return true;
    }
  }
  return false;
};

export function inferMarketAccessibilitySignalProfileV1(input: {
  structured_summary?: any;
  promoted_facts?: any[] | null;
}): MarketAccessibilitySignalProfileV1 {
  const structured: StructuredSummaryLike = input.structured_summary ?? null;
  const promoted = Array.isArray(input.promoted_facts) ? input.promoted_facts : [];

  const market = structured?.market ?? null;

  const tam_present = hasMarketField(market, [
    "tam",
    "total_addressable_market",
    "totalAddressableMarket",
  ]);

  const sam_present = hasMarketField(market, [
    "sam",
    "serviceable_available_market",
    "serviceableAvailableMarket",
  ]);

  const som_present = hasMarketField(market, [
    "som",
    "serviceable_obtainable_market",
    "serviceableObtainableMarket",
  ]);

  const customerKind = asNonEmptyString(structured?.customers?.value?.kind ?? null);
  const icpFromFactsAllowlist = promoted.some((pf) => factTypeIn(FACT_TYPE.ICP, promotedFactTypeOf(pf)));

  const targetFromStructured = hasMarketSegmentFields(market);
  const targetFromFacts = promoted.some((pf) => {
    const ft = promotedFactTypeOf(pf).toLowerCase();
    if (!ft) return false;
    if (ft.includes("vertical") || ft.includes("industry") || ft.includes("segment") || ft.includes("niche")) return true;
    const vj = pf?.content_json?.value_json;
    const label = asNonEmptyString(vj?.vertical ?? vj?.industry ?? vj?.segment ?? vj?.niche ?? null);
    return !!label;
  });
  const target_segment_defined = targetFromStructured || targetFromFacts;

  const distFromStructured = hasGoToMarketFields(structured);
  const distributionFromFactsAllowlist = promoted.some((pf) => factTypeIn(FACT_TYPE.DISTRIBUTION, promotedFactTypeOf(pf)));
  const wedgeFromFactsAllowlist = promoted.some((pf) => factTypeIn(FACT_TYPE.WEDGE, promotedFactTypeOf(pf)));

  const anyAllowlistMatch = icpFromFactsAllowlist || distributionFromFactsAllowlist || wedgeFromFactsAllowlist;

  let icpFromFactsHeuristic = false;
  let distributionFromFactsHeuristic = false;
  let wedgeFromFactsHeuristic = false;
  let heuristic_fact_type_match = false;

  // Optional controlled fallback heuristic matching ONLY when:
  // - We have no allowlist matches at all, and
  // - The fact_type is not in the known universe (unknown/new types only).
  if (!anyAllowlistMatch) {
    for (const pf of promoted) {
      const ftRaw = promotedFactTypeOf(pf);
      if (!ftRaw) continue;
      if (factTypeIn(FACT_TYPE_UNIVERSE, ftRaw)) continue;

      const ft = ftRaw.trim().toLowerCase();

      // Tight, version-aware patterns (avoid broad substring matching).
      if (!icpFromFactsHeuristic && /^(icp_v\d+|ideal_customer_profile_v\d+|ideal_customer_v\d+)$/.test(ft)) {
        icpFromFactsHeuristic = true;
        heuristic_fact_type_match = true;
      }
      if (!distributionFromFactsHeuristic && /^(distribution_channel_v\d+|go_to_market_v\d+|gtm_v\d+)$/.test(ft)) {
        distributionFromFactsHeuristic = true;
        heuristic_fact_type_match = true;
      }
      if (!wedgeFromFactsHeuristic && /^(wedge_strategy_v\d+|beachhead_strategy_v\d+|entry_strategy_v\d+)$/.test(ft)) {
        wedgeFromFactsHeuristic = true;
        heuristic_fact_type_match = true;
      }
    }
  }

  const icp_defined = !!customerKind || icpFromFactsAllowlist || icpFromFactsHeuristic;
  const distribution_channel_defined = distFromStructured || distributionFromFactsAllowlist || distributionFromFactsHeuristic;
  const wedge_defined =
    wedgeFromFactsAllowlist ||
    wedgeFromFactsHeuristic ||
    (target_segment_defined && distribution_channel_defined);

  const count = [icp_defined, target_segment_defined, distribution_channel_defined, wedge_defined].filter(Boolean).length;

  const confidence: MarketAccessibilitySignalProfileV1["confidence"] =
    (icp_defined && distribution_channel_defined && wedge_defined)
      ? "high"
      : (count >= 2)
        ? "medium"
        : "low";

  const signals: MarketAccessibilitySignalProfileV1["signals"] = [
    { code: "tam_present", present: tam_present },
    { code: "sam_present", present: sam_present },
    { code: "som_present", present: som_present },
    { code: "icp_defined", present: icp_defined },
    { code: "target_segment_defined", present: target_segment_defined },
    { code: "distribution_channel_defined", present: distribution_channel_defined },
    { code: "wedge_defined", present: wedge_defined },
    { code: "heuristic_fact_type_match", present: heuristic_fact_type_match },
  ];

  return {
    tam_present,
    sam_present,
    som_present,
    icp_defined,
    target_segment_defined,
    distribution_channel_defined,
    wedge_defined,
    confidence,
    signals,
  };
}
