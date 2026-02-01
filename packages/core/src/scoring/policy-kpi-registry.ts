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

  operating_startup_revenue_v1: [
    // Revenue-generating startups: emphasize revenue + unit economics + retention signals.
    mk({ kpi: "revenue", synonyms: ["revenue", "sales", "bookings"], benchmark: { min: 250_000, ideal: 1_000_000, source: "operating_startup_revenue_v1" } }),
    mk({ kpi: "mrr", synonyms: ["mrr", "monthly_recurring_revenue"], benchmark: { min: 25_000, ideal: 100_000, source: "operating_startup_revenue_v1" } }),
    mk({ kpi: "arr", synonyms: ["arr", "annual_recurring_revenue"], benchmark: { min: 300_000, ideal: 1_200_000, source: "operating_startup_revenue_v1" } }),
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm", "contribution_margin"], benchmark: { min: 40, ideal: 65, source: "operating_startup_revenue_v1" }, fraction_to_percent: true }),
    mk({ kpi: "growth_rate", synonyms: ["growth_rate", "growth", "yoy", "yoy_growth"], benchmark: { min: 30, ideal: 80, source: "operating_startup_revenue_v1" }, fraction_to_percent: true }),
    mk({ kpi: "churn", synonyms: ["churn", "churn_rate"], benchmark: { ideal: 5, max: 10, direction: "lower_is_better", source: "operating_startup_revenue_v1" }, fraction_to_percent: true }),
    mk({ kpi: "retention", synonyms: ["retention", "retention_rate", "ndr", "nrr", "net_dollar_retention"], benchmark: { min: 90, ideal: 110, source: "operating_startup_revenue_v1" }, fraction_to_percent: true }),
  ],

  consumer_ecommerce_brand_v1: [
    // DTC / ecommerce brands: focus on unit economics + conversion + repeat purchase.
    mk({ kpi: "gross_margin_pct", synonyms: ["gross_margin", "gross_margin_pct", "gross_margin_percent", "gm"], benchmark: { min: 40, ideal: 60, source: "consumer_ecommerce_brand_v1" }, fraction_to_percent: true }),
    mk({ kpi: "contribution_margin_pct", synonyms: ["contribution_margin", "contribution_margin_pct", "contribution_margin_percent", "cm"], benchmark: { min: 20, ideal: 35, source: "consumer_ecommerce_brand_v1" }, fraction_to_percent: true }),

    mk({ kpi: "aov", synonyms: ["aov", "average_order_value"], benchmark: { min: 50, ideal: 100, source: "consumer_ecommerce_brand_v1" } }),
    mk({ kpi: "ltv", synonyms: ["ltv", "customer_lifetime_value", "lifetime_value"], benchmark: { min: 150, ideal: 300, source: "consumer_ecommerce_brand_v1" } }),
    mk({ kpi: "cac", synonyms: ["cac", "customer_acquisition_cost"], benchmark: { ideal: 40, max: 80, direction: "lower_is_better", source: "consumer_ecommerce_brand_v1" } }),
    mk({ kpi: "ltv_to_cac", synonyms: ["ltv_to_cac", "ltv_cac", "ltv:cac", "ltv/cac"], benchmark: { min: 3, ideal: 4, source: "consumer_ecommerce_brand_v1" } }),

    mk({ kpi: "roas", synonyms: ["roas", "return_on_ad_spend"], benchmark: { min: 2, ideal: 3, source: "consumer_ecommerce_brand_v1" } }),
    mk({ kpi: "conversion_rate", synonyms: ["conversion_rate", "cvr", "cvr_percent"], benchmark: { min: 2.0, ideal: 3.5, source: "consumer_ecommerce_brand_v1" }, fraction_to_percent: true }),
    mk({ kpi: "repeat_purchase_rate", synonyms: ["repeat_purchase_rate", "repeat_rate", "reorder_rate", "repurchase_rate"], benchmark: { min: 20, ideal: 35, source: "consumer_ecommerce_brand_v1" }, fraction_to_percent: true }),

    // Subscription brands may report churn; treat as optional but benchmarkable.
    mk({ kpi: "churn", synonyms: ["churn", "churn_rate", "subscription_churn"], benchmark: { ideal: 5, max: 10, direction: "lower_is_better", source: "consumer_ecommerce_brand_v1" }, fraction_to_percent: true }),

    mk({ kpi: "revenue_growth_rate", synonyms: ["revenue_growth_rate", "revenue_growth", "growth_rate", "growth", "yoy", "yoy_growth"], benchmark: { min: 30, ideal: 80, source: "consumer_ecommerce_brand_v1" }, fraction_to_percent: true }),
  ],

  consumer_fintech_platform_v1: [
    // Consumer fintech platforms: emphasize growth + volume/adoption + take-rate/unit economics.
    // Revenue may be absent early; do not rely on it as the sole traction signal.
    mk({ kpi: "growth_rate", synonyms: ["growth_rate", "growth", "yoy", "yoy_growth", "mom_growth"], benchmark: { min: 30, ideal: 80, source: "consumer_fintech_platform_v1" }, fraction_to_percent: true }),

    // Volume proxies (TPV/GTV/processed volume). Units can vary; benchmarks are intentionally coarse.
    mk({ kpi: "tpv", synonyms: ["tpv", "total_payment_volume", "total_processed_volume", "payment_volume", "processed_volume"], benchmark: { min: 1_000_000, ideal: 10_000_000, source: "consumer_fintech_platform_v1" } }),
    mk({ kpi: "gtv", synonyms: ["gtv", "gross_transaction_value", "gross_volume", "transaction_value"], benchmark: { min: 1_000_000, ideal: 10_000_000, source: "consumer_fintech_platform_v1" } }),
    mk({ kpi: "transaction_volume", synonyms: ["transaction_volume", "txn_volume", "transactions_volume"], benchmark: { min: 1_000_000, ideal: 10_000_000, source: "consumer_fintech_platform_v1" } }),
    mk({ kpi: "transaction_count", synonyms: ["transaction_count", "transactions", "txn_count", "monthly_transactions"], benchmark: { min: 10_000, ideal: 250_000, source: "consumer_fintech_platform_v1" } }),

    // Adoption
    mk({ kpi: "active_users", synonyms: ["active_users", "monthly_active_users", "mau", "dau", "users"], benchmark: { min: 10_000, ideal: 100_000, source: "consumer_fintech_platform_v1" } }),

    // Unit economics
    mk({ kpi: "take_rate", synonyms: ["take_rate", "interchange_rate", "net_take_rate"], benchmark: { min: 0.5, ideal: 1.5, source: "consumer_fintech_platform_v1" }, fraction_to_percent: true }),

    // Optional risk control metrics
    mk({ kpi: "fraud_rate", synonyms: ["fraud_rate", "fraud", "fraud_percent"], benchmark: { ideal: 0.3, max: 1.0, direction: "lower_is_better", source: "consumer_fintech_platform_v1" }, fraction_to_percent: true }),
    mk({ kpi: "chargeback_rate", synonyms: ["chargeback_rate", "chargebacks", "chargeback_percent"], benchmark: { ideal: 0.5, max: 1.0, direction: "lower_is_better", source: "consumer_fintech_platform_v1" }, fraction_to_percent: true }),
    mk({ kpi: "default_rate", synonyms: ["default_rate", "defaults", "delinquency", "delinquency_rate"], benchmark: { ideal: 2.0, max: 5.0, direction: "lower_is_better", source: "consumer_fintech_platform_v1" }, fraction_to_percent: true }),
  ],

  enterprise_saas_b2b_v1: [
    // Enterprise B2B SaaS: recurring revenue + retention + unit economics + sales motion.
    mk({ kpi: "arr", synonyms: ["arr", "annual_recurring_revenue"], benchmark: { min: 1_000_000, ideal: 2_000_000, source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "mrr", synonyms: ["mrr", "monthly_recurring_revenue"], benchmark: { min: 50_000, ideal: 100_000, source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "bookings", synonyms: ["bookings", "new_bookings"], benchmark: { min: 500_000, ideal: 1_500_000, source: "enterprise_saas_b2b_v1" } }),

    mk({ kpi: "growth_rate", synonyms: ["growth_rate", "growth", "yoy", "yoy_growth", "mom_growth", "revenue_growth", "revenue_growth_rate"], benchmark: { min: 50, ideal: 100, source: "enterprise_saas_b2b_v1" }, fraction_to_percent: true }),
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm"], benchmark: { min: 70, ideal: 80, source: "enterprise_saas_b2b_v1" }, fraction_to_percent: true }),

    mk({ kpi: "nrr", synonyms: ["nrr", "ndr", "net_dollar_retention", "net_revenue_retention", "net_retention"], benchmark: { min: 100, ideal: 120, source: "enterprise_saas_b2b_v1" }, fraction_to_percent: true }),
    mk({ kpi: "grr", synonyms: ["grr", "gross_revenue_retention", "gross_dollar_retention"], benchmark: { min: 85, ideal: 95, source: "enterprise_saas_b2b_v1" }, fraction_to_percent: true }),
    mk({ kpi: "churn_logo", synonyms: ["logo_churn", "customer_churn", "churn_logo", "churn"], benchmark: { ideal: 2.0, max: 5.0, direction: "lower_is_better", source: "enterprise_saas_b2b_v1" }, fraction_to_percent: true }),
    mk({ kpi: "churn_revenue", synonyms: ["revenue_churn", "churn_revenue"], benchmark: { ideal: 5.0, max: 10.0, direction: "lower_is_better", source: "enterprise_saas_b2b_v1" }, fraction_to_percent: true }),

    mk({ kpi: "cac", synonyms: ["cac", "customer_acquisition_cost"], benchmark: { ideal: 10_000, max: 20_000, direction: "lower_is_better", source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "ltv", synonyms: ["ltv", "customer_lifetime_value", "lifetime_value", "clv"], benchmark: { min: 30_000, ideal: 60_000, source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "ltv_to_cac", synonyms: ["ltv_to_cac", "ltv_cac", "ltv:cac", "ltv/cac", "ltv_cac_ratio"], benchmark: { min: 3, ideal: 5, source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "payback_months", synonyms: ["payback_months", "cac_payback", "cac_payback_months"], benchmark: { ideal: 12, max: 18, direction: "lower_is_better", source: "enterprise_saas_b2b_v1" } }),

    mk({ kpi: "magic_number", synonyms: ["magic_number", "saas_magic_number"], benchmark: { min: 0.5, ideal: 1.0, source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "pipeline_coverage", synonyms: ["pipeline_coverage", "pipeline_multiple"], benchmark: { min: 3, ideal: 5, source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "sales_cycle_days", synonyms: ["sales_cycle", "sales_cycle_days", "deal_cycle", "deal_cycle_days"], benchmark: { ideal: 45, max: 90, direction: "lower_is_better", source: "enterprise_saas_b2b_v1" } }),
    mk({ kpi: "acv", synonyms: ["acv", "annual_contract_value"], benchmark: { min: 10_000, ideal: 25_000, source: "enterprise_saas_b2b_v1" } }),
  ],

  healthcare_biotech_v1: [
    // Healthcare / biotech: regulatory path + validation + reimbursement + runway.
    // Note: several KPIs here are categorical/scoring proxies; benchmarks are intentionally coarse.
    mk({ kpi: "trial_phase", synonyms: ["trial_phase", "clinical_phase", "phase", "phase_i", "phase_ii", "phase_iii", "phase_1", "phase_2", "phase_3"], benchmark: undefined }),
    mk({ kpi: "time_to_clearance_months", synonyms: ["time_to_clearance_months", "time_to_clearance", "time_to_fda_clearance", "time_to_approval_months", "months_to_clearance"], benchmark: { ideal: 12, max: 24, direction: "lower_is_better", source: "healthcare_biotech_v1" } }),

    mk({ kpi: "sensitivity", synonyms: ["sensitivity", "sens", "clinical_sensitivity"], benchmark: { min: 85, ideal: 95, source: "healthcare_biotech_v1" }, fraction_to_percent: true }),
    mk({ kpi: "specificity", synonyms: ["specificity", "spec", "clinical_specificity"], benchmark: { min: 85, ideal: 95, source: "healthcare_biotech_v1" }, fraction_to_percent: true }),

    // Services / provider workflow businesses may report gross margin.
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm", "gross_margin_pct", "gross_margin_percent"], benchmark: { min: 40, ideal: 60, source: "healthcare_biotech_v1" }, fraction_to_percent: true }),

    // Provider workflow unit economics (optional).
    mk({ kpi: "cac", synonyms: ["cac", "customer_acquisition_cost", "provider_acquisition_cost"], benchmark: undefined }),
    mk({ kpi: "ltv", synonyms: ["ltv", "customer_lifetime_value", "lifetime_value", "clv"], benchmark: undefined }),
    mk({ kpi: "ltv_to_cac", synonyms: ["ltv_to_cac", "ltv_cac", "ltv:cac", "ltv/cac"], benchmark: { min: 3, ideal: 4, source: "healthcare_biotech_v1" } }),

    // Reimbursement (0-100 proxy).
    mk({ kpi: "reimbursement_status", synonyms: ["reimbursement_status", "reimbursement", "cpt", "drg", "payer", "payer_coverage"], benchmark: { min: 60, ideal: 85, source: "healthcare_biotech_v1" } }),

    // Burn / runway (when available).
    mk({ kpi: "burn_rate", synonyms: ["burn_rate", "monthly_burn", "net_burn"], benchmark: undefined }),
    mk({ kpi: "runway_months", synonyms: ["runway_months", "runway", "cash_runway_months"], benchmark: { min: 12, ideal: 18, source: "healthcare_biotech_v1" } }),
  ],

  media_entertainment_ip_v1: [
    // Media / entertainment / IP: contracts, package strength, and distribution economics.
    mk({ kpi: "contracted_revenue", synonyms: ["contracted_revenue", "contracted_rev", "contract_revenue", "signed_revenue", "guaranteed_revenue"], benchmark: { min: 250_000, ideal: 1_000_000, source: "media_entertainment_ip_v1" } }),

    // Minimum guarantee (MG) from distributors/sales agents.
    mk({ kpi: "mg_amount", synonyms: ["mg", "minimum_guarantee", "min_guarantee", "mg_amount", "minimum_guarantee_amount"], benchmark: { min: 100_000, ideal: 500_000, source: "media_entertainment_ip_v1" } }),

    // Pre-sales / pre-sales amount.
    mk({ kpi: "presales_amount", synonyms: ["presales", "pre_sales", "presales_amount", "pre_sales_amount", "pre_sales_revenue"], benchmark: { min: 250_000, ideal: 1_000_000, source: "media_entertainment_ip_v1" } }),

    // Recoupment multiple (cash-on-cash) for investors.
    mk({ kpi: "recoupment_multiple", synonyms: ["recoupment_multiple", "recoup_multiple", "investor_multiple", "moic", "multiple"], benchmark: { min: 1.5, ideal: 2.5, source: "media_entertainment_ip_v1" } }),

    // Distribution term (years). Benchmarks are intentionally coarse.
    mk({ kpi: "distribution_term_years", synonyms: ["distribution_term_years", "distribution_term", "term_years", "license_term_years", "deal_term_years"], benchmark: { min: 3, ideal: 7, source: "media_entertainment_ip_v1" } }),

    // Slate size (count). For single-title projects, expect 1.
    mk({ kpi: "slate_count", synonyms: ["slate_count", "slate", "projects", "titles", "title_count"], benchmark: { min: 1, ideal: 3, source: "media_entertainment_ip_v1" } }),

    // Attachment strength (0-100 proxy): talent package quality, distribution interest, etc.
    mk({ kpi: "attachment_strength", synonyms: ["attachment_strength", "attachments", "talent_attachments", "package_strength", "packaging_strength"], benchmark: { min: 60, ideal: 85, source: "media_entertainment_ip_v1" } }),

    // Marketing commitment (0-100 proxy): P&A/marketing spend commitments, distributor marketing terms.
    mk({ kpi: "marketing_commitment", synonyms: ["marketing_commitment", "marketing", "p_and_a", "panda", "prints_and_advertising", "marketing_spend"], benchmark: { min: 50, ideal: 80, source: "media_entertainment_ip_v1" } }),
  ],

  physical_product_cpg_spirits_v1: [
    // Spirits / CPG physical products: unit economics + distribution + working capital.
    mk({ kpi: "gross_margin", synonyms: ["gross_margin", "gm", "gross_margin_pct", "gross_margin_percent"], benchmark: { min: 50, ideal: 65, source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),
    mk({ kpi: "contribution_margin", synonyms: ["contribution_margin", "cm", "contribution_margin_pct", "contribution_margin_percent"], benchmark: { min: 25, ideal: 40, source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),

    // Cost structure (units vary; benchmarks intentionally omitted).
    mk({ kpi: "cogs", synonyms: ["cogs", "cost_of_goods_sold", "cost_of_goods"], benchmark: undefined }),
    mk({ kpi: "landed_cost", synonyms: ["landed_cost", "landed_cost_per_unit", "unit_landed_cost"], benchmark: undefined }),

    mk({ kpi: "aov", synonyms: ["aov", "average_order_value"], benchmark: { min: 30, ideal: 60, source: "physical_product_cpg_spirits_v1" } }),
    mk({ kpi: "repeat_rate", synonyms: ["repeat_rate", "repeat_purchase_rate", "repeat_purchase", "repurchase_rate", "reorder_rate"], benchmark: { min: 20, ideal: 35, source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),
    mk({ kpi: "retention_90d", synonyms: ["retention_90d", "90_day_retention", "d90_retention"], benchmark: { min: 25, ideal: 40, source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),

    mk({ kpi: "sell_through", synonyms: ["sell_through", "sellthrough", "sell-through"], benchmark: { min: 60, ideal: 80, source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),
    mk({ kpi: "distribution_points", synonyms: ["distribution_points", "points_of_distribution", "pod", "distribution_pod"], benchmark: { min: 1, ideal: 5, source: "physical_product_cpg_spirits_v1" } }),
    mk({ kpi: "doors", synonyms: ["doors", "retail_doors", "store_doors"], benchmark: { min: 50, ideal: 200, source: "physical_product_cpg_spirits_v1" } }),
    mk({ kpi: "velocity", synonyms: ["velocity", "retail_velocity", "units_per_store_per_week", "upsw"], benchmark: { min: 2, ideal: 5, source: "physical_product_cpg_spirits_v1" } }),

    mk({ kpi: "promo_rate", synonyms: ["promo_rate", "promotion_rate", "discount_rate"], benchmark: { ideal: 20, max: 35, direction: "lower_is_better", source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),
    mk({ kpi: "chargebacks", synonyms: ["chargebacks", "chargeback_rate", "returns", "return_rate"], benchmark: { ideal: 0.5, max: 2.0, direction: "lower_is_better", source: "physical_product_cpg_spirits_v1" }, fraction_to_percent: true }),

    mk({ kpi: "inventory_turns", synonyms: ["inventory_turns", "inv_turns", "inventory_turnover"], benchmark: { min: 4, ideal: 8, source: "physical_product_cpg_spirits_v1" } }),
    mk({ kpi: "cash_conversion_cycle", synonyms: ["cash_conversion_cycle", "ccc", "cash_cycle_days"], benchmark: { ideal: 60, max: 90, direction: "lower_is_better", source: "physical_product_cpg_spirits_v1" } }),
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
