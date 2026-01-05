import type { DealPolicyId } from "../classification/deal-policy-registry";

export type KpiDirection = "higher_is_better" | "lower_is_better";

export type KpiBenchmarkBand = {
  min?: number;
  ideal: number;
  max?: number;
  direction?: KpiDirection;
  source: string;
};

export type PolicyKpiSpec = {
  kpi: string;
  synonyms: string[];
  benchmark?: KpiBenchmarkBand;
  // If true, values in (0,1] are interpreted as a fraction and converted to percent.
  fraction_to_percent?: boolean;
};

export type PolicyKpiRegistry = Record<DealPolicyId, PolicyKpiSpec[]>;

const normalizeKey = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

const mk = (spec: PolicyKpiSpec): PolicyKpiSpec => ({
  ...spec,
  kpi: normalizeKey(spec.kpi),
  synonyms: Array.from(new Set(spec.synonyms.map(normalizeKey).filter(Boolean))),
});

export const POLICY_KPI_REGISTRY: PolicyKpiRegistry = {
  unknown_generic: [
    mk({ kpi: "arr", synonyms: ["arr", "annual_recurring_revenue"], benchmark: { min: 1_000_000, ideal: 2_000_000, source: "generic" } }),
    mk({ kpi: "mrr", synonyms: ["mrr", "monthly_recurring_revenue"], benchmark: { min: 50_000, ideal: 100_000, source: "generic" } }),
    mk({ kpi: "growth_rate", synonyms: ["growth", "growth_rate", "yoy_growth"], benchmark: { min: 50, ideal: 100, source: "generic" }, fraction_to_percent: true }),
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm"], benchmark: { min: 50, ideal: 70, source: "generic" }, fraction_to_percent: true }),
  ],

  startup_raise: [
    mk({ kpi: "arr", synonyms: ["arr", "annual_recurring_revenue"], benchmark: { min: 1_000_000, ideal: 2_000_000, source: "startup_raise baseline" } }),
    mk({ kpi: "mrr", synonyms: ["mrr", "monthly_recurring_revenue"], benchmark: { min: 50_000, ideal: 100_000, source: "startup_raise baseline" } }),
    mk({ kpi: "growth_rate", synonyms: ["growth_rate", "growth", "yoy", "yoy_growth"], benchmark: { min: 50, ideal: 100, source: "startup_raise baseline" }, fraction_to_percent: true }),
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm"], benchmark: { min: 60, ideal: 75, source: "startup_raise baseline" }, fraction_to_percent: true }),
    mk({ kpi: "ndr", synonyms: ["ndr", "nrr", "net_dollar_retention"], benchmark: { min: 100, ideal: 120, source: "startup_raise baseline" }, fraction_to_percent: true }),
  ],

  execution_ready_v1: [
    // Readiness signals (pre-revenue): counts and values extracted from text.
    mk({ kpi: "loi_count", synonyms: ["loi", "lois", "letters_of_intent", "letter_of_intent"], benchmark: { min: 1, ideal: 2, source: "execution_ready_v1" } }),
    mk({ kpi: "partnership_count", synonyms: ["partnerships", "strategic_partners", "partners"], benchmark: { min: 1, ideal: 2, source: "execution_ready_v1" } }),
    mk({ kpi: "distribution_partners", synonyms: ["distribution_partners", "channel_partners", "resellers"], benchmark: { min: 1, ideal: 2, source: "execution_ready_v1" } }),
    mk({ kpi: "contract_value", synonyms: ["contract_value", "signed_contract_value"], benchmark: { min: 100_000, ideal: 500_000, source: "execution_ready_v1" } }),
    mk({ kpi: "pipeline_value", synonyms: ["pipeline", "pipeline_value", "booked_pipeline"], benchmark: { min: 250_000, ideal: 1_000_000, source: "execution_ready_v1" } }),
    mk({ kpi: "launch_timeline_months", synonyms: ["launch_timeline", "launch_in_months", "launch_timeline_months"], benchmark: { ideal: 6, max: 12, direction: "lower_is_better", source: "execution_ready_v1" } }),
    mk({ kpi: "manufacturing_capacity", synonyms: ["manufacturing_capacity", "units_per_month", "units_month"], benchmark: { min: 1000, ideal: 5000, source: "execution_ready_v1" } }),
    mk({ kpi: "regulatory_status", synonyms: ["regulatory", "regulatory_status", "compliance"], benchmark: { min: 60, ideal: 85, source: "execution_ready_v1" } }),
  ],

  operating_business: [
    mk({ kpi: "revenue", synonyms: ["revenue", "sales"], benchmark: { min: 1_000_000, ideal: 5_000_000, source: "operating_business" } }),
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm"], benchmark: { min: 30, ideal: 50, source: "operating_business" }, fraction_to_percent: true }),
    mk({ kpi: "churn", synonyms: ["churn", "churn_rate"], benchmark: { ideal: 5, max: 10, direction: "lower_is_better", source: "operating_business" }, fraction_to_percent: true }),
    mk({ kpi: "retention", synonyms: ["retention", "retention_rate", "ndr", "nrr"], benchmark: { min: 90, ideal: 110, source: "operating_business" }, fraction_to_percent: true }),
  ],

  real_estate_underwriting: [
    mk({ kpi: "dscr", synonyms: ["dscr", "debt_service_coverage_ratio"], benchmark: { min: 1.1, ideal: 1.25, source: "real_estate underwriting baseline" } }),
    mk({ kpi: "ltv", synonyms: ["ltv", "loan_to_value"], benchmark: { ideal: 65, max: 80, direction: "lower_is_better", source: "real_estate underwriting baseline" }, fraction_to_percent: true }),
    mk({ kpi: "cap_rate", synonyms: ["cap_rate", "caprate"], benchmark: { min: 4, ideal: 6, source: "real_estate underwriting baseline" }, fraction_to_percent: true }),
    mk({ kpi: "occupancy", synonyms: ["occupancy", "occupancy_rate"], benchmark: { min: 85, ideal: 95, source: "real_estate underwriting baseline" }, fraction_to_percent: true }),

    // Common underwriting signals often present in OMs / memos.
    mk({ kpi: "noi", synonyms: ["noi", "net_operating_income"], benchmark: { min: 500_000, ideal: 1_000_000, source: "real_estate underwriting baseline" } }),
    mk({ kpi: "lease_term_months", synonyms: ["lease_term", "lease_term_months", "weighted_average_lease_term", "walt"], benchmark: { min: 36, ideal: 60, source: "real_estate underwriting baseline" } }),
    mk({ kpi: "rent_escalation_rate", synonyms: ["rent_escalation", "rent_escalations", "annual_rent_escalation", "rent_bumps"], benchmark: { min: 2, ideal: 3, source: "real_estate underwriting baseline" }, fraction_to_percent: true }),
    mk({ kpi: "ltc", synonyms: ["ltc", "loan_to_cost"], benchmark: { ideal: 65, max: 80, direction: "lower_is_better", source: "real_estate underwriting baseline" }, fraction_to_percent: true }),
    mk({ kpi: "yield_on_cost", synonyms: ["yield_on_cost", "yoc", "build_to_cap", "build_to_cap_rate"], benchmark: { min: 5, ideal: 7, source: "real_estate underwriting baseline" }, fraction_to_percent: true }),
  ],

  fund_spv: [
    mk({ kpi: "aum", synonyms: ["aum", "assets_under_management"], benchmark: { min: 10_000_000, ideal: 100_000_000, source: "fund_spv baseline" } }),
    mk({ kpi: "irr", synonyms: ["irr", "internal_rate_of_return"], benchmark: { min: 10, ideal: 20, source: "fund_spv baseline" }, fraction_to_percent: true }),
    mk({ kpi: "moic", synonyms: ["moic", "multiple"], benchmark: { min: 1.5, ideal: 2.5, source: "fund_spv baseline" } }),
  ],

  acquisition_memo: [
    mk({ kpi: "revenue", synonyms: ["revenue", "sales"], benchmark: { min: 5_000_000, ideal: 20_000_000, source: "acquisition memo baseline" } }),
    mk({ kpi: "ebitda_margin", synonyms: ["ebitda_margin", "ebitda"], benchmark: { min: 10, ideal: 20, source: "acquisition memo baseline" }, fraction_to_percent: true }),
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm"], benchmark: { min: 30, ideal: 50, source: "acquisition memo baseline" }, fraction_to_percent: true }),
  ],

  credit_memo: [
    mk({ kpi: "dscr", synonyms: ["dscr", "debt_service_coverage_ratio"], benchmark: { min: 1.1, ideal: 1.25, source: "credit memo baseline" } }),
    mk({ kpi: "ltv", synonyms: ["ltv", "loan_to_value"], benchmark: { ideal: 65, max: 80, direction: "lower_is_better", source: "credit memo baseline" }, fraction_to_percent: true }),
    mk({ kpi: "interest_coverage", synonyms: ["interest_coverage", "icr"], benchmark: { min: 2, ideal: 3, source: "credit memo baseline" } }),
  ],
};

export function getPolicyKpiSpecs(policyId: string | null | undefined): PolicyKpiSpec[] {
  const id = (policyId || "unknown_generic") as DealPolicyId;
  return POLICY_KPI_REGISTRY[id] ?? POLICY_KPI_REGISTRY.unknown_generic;
}

export function buildPolicyBenchmarkMap(policyId: string | null | undefined): Record<string, KpiBenchmarkBand> {
  const specs = getPolicyKpiSpecs(policyId);
  const out: Record<string, KpiBenchmarkBand> = {};
  for (const s of specs) {
    if (s.benchmark) {
      const id = (policyId || "unknown_generic").toString();
      out[s.kpi] = {
        ...s.benchmark,
        source: `policy:${id}:${s.kpi}`,
      };
    }
  }
  return out;
}

export function mapMetricNameToPolicyKpi(policyId: string | null | undefined, rawName: string): string | null {
  const n = normalizeKey(rawName);
  if (!n) return null;

  const specs = getPolicyKpiSpecs(policyId);

  for (const spec of specs) {
    if (spec.kpi === n) return spec.kpi;
    if (spec.synonyms.includes(n)) return spec.kpi;
  }

  return null;
}

export function maybeNormalizePolicyKpiValue(policyId: string | null | undefined, kpi: string, value: number): number {
  const specs = getPolicyKpiSpecs(policyId);
  const spec = specs.find((s) => s.kpi === normalizeKey(kpi));
  if (!spec) return value;

  if (spec.fraction_to_percent && value > 0 && value <= 1) {
    return value * 100;
  }

  return value;
}
