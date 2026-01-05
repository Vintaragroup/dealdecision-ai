import type { ScoreWeights } from "../reports/score-explanation";

export type DealPolicyId =
  | "unknown_generic"
  | "startup_raise"
  | "execution_ready_v1"
  | "operating_startup_revenue_v1"
  | "consumer_ecommerce_brand_v1"
  | "consumer_fintech_platform_v1"
  | "healthcare_biotech_v1"
  | "enterprise_saas_b2b_v1"
  | "media_entertainment_ip_v1"
  | "physical_product_cpg_spirits_v1"
  | "operating_business"
  | "real_estate_underwriting"
  | "fund_spv"
  | "acquisition_memo"
  | "credit_memo";

export type DealPolicyRubric = {
  id: DealPolicyId;
  required_signals: string[];
  positive_drivers: string[];
  acceptable_missing: string[];
  red_flags: string[];
};

export type AnalyzerKey =
  | "slide_sequence"
  | "metric_benchmark"
  | "visual_design"
  | "narrative_arc"
  | "financial_health"
  | "risk_assessment";

export type DealPolicy = {
  id: DealPolicyId;
  label: string;

  weights: ScoreWeights;
  required_analyzers: AnalyzerKey[];
  optional_analyzers: AnalyzerKey[];

  // Additive, policy-specific definition of what “75+” means.
  rubric?: DealPolicyRubric;

  domain_expectations?: string[];
};

export const DEAL_POLICIES: Record<DealPolicyId, DealPolicy> = {
  unknown_generic: {
    id: "unknown_generic",
    label: "Unknown / Generic",
    // Keep every component in play to avoid overall_score collapsing.
    weights: {
      slide_sequence: 1.0,
      metric_benchmark: 1.0,
      visual_design: 1.0,
      narrative_arc: 1.0,
      financial_health: 1.0,
      risk_assessment: 1.0,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment", "narrative_arc"],
    optional_analyzers: ["slide_sequence", "visual_design", "financial_health"],
  },

  startup_raise: {
    id: "startup_raise",
    label: "Startup Raise",
    weights: {
      narrative_arc: 1.5,
      slide_sequence: 1.0,
      visual_design: 1.0,
      metric_benchmark: 1.0,
      financial_health: 0.6,
      risk_assessment: 1.0,
    },
    required_analyzers: ["narrative_arc", "metric_benchmark", "risk_assessment"],
    optional_analyzers: ["slide_sequence", "visual_design", "financial_health"],
    domain_expectations: ["ARR/CAC/LTV where applicable", "round terms (SAFE / priced round)", "stage (seed/series)"],
    rubric: {
      id: "startup_raise",
      required_signals: ["team", "gtm", "traction_or_pipeline"],
      positive_drivers: ["strong_unit_economics", "fast_growth", "strong_distribution"],
      acceptable_missing: ["profitability"],
      red_flags: ["fraud", "ownership_unclear", "regulatory_blocker"],
    },
  },

  execution_ready_v1: {
    id: "execution_ready_v1",
    label: "Execution-Ready (Pre-Revenue)",
    // Pre-revenue but execution-ready: do not auto-fail on revenue missing.
    // Emphasize readiness + risk.
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.4,
      metric_benchmark: 1.3,
      financial_health: 0.0,
      risk_assessment: 1.4,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment", "narrative_arc"],
    optional_analyzers: [],
    domain_expectations: ["LOIs/contracts", "partnerships/distribution", "launch plan", "manufacturing/regulatory readiness"],
    rubric: {
      id: "execution_ready_v1",
      required_signals: ["loi_or_contract", "partnership_or_distribution", "launch_timeline", "product_ready"],
      positive_drivers: ["contract_value", "pipeline_value", "multiple_partners"],
      acceptable_missing: ["revenue", "arr", "mrr"],
      red_flags: ["fraud", "ownership_unclear", "regulatory_blocker"],
    },
  },

  operating_startup_revenue_v1: {
    id: "operating_startup_revenue_v1",
    label: "Operating Startup (Revenue-Generating)",
    // Revenue is present, but we require execution + risk controls for 75+.
    // Emphasize fundamentals; do not reward slide/visual heuristics.
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.1,
      metric_benchmark: 1.4,
      financial_health: 1.2,
      risk_assessment: 1.4,
    },
    required_analyzers: ["metric_benchmark", "financial_health", "risk_assessment", "narrative_arc"],
    optional_analyzers: [],
    domain_expectations: ["revenue", "margins or unit economics", "retention/churn if applicable", "risk controls"],
    rubric: {
      id: "operating_startup_revenue_v1",
      required_signals: ["revenue", "gross_margin_or_unit_economics", "risk_controls"],
      positive_drivers: ["retention_or_churn", "efficient_growth"],
      acceptable_missing: ["profitability"],
      red_flags: ["fraud", "ownership_unclear", "regulatory_blocker"],
    },
  },

  consumer_ecommerce_brand_v1: {
    id: "consumer_ecommerce_brand_v1",
    label: "Consumer Ecommerce Brand (DTC)",
    // Ecommerce brand decks: prioritize unit economics + risk.
    // Avoid noisy slide/visual heuristics; avoid financial health unless we have reliable extraction.
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 0.6,
      metric_benchmark: 1.6,
      financial_health: 0.0,
      risk_assessment: 1.5,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment"],
    optional_analyzers: ["narrative_arc"],
    domain_expectations: [
      "unit economics (CAC, LTV, AOV, contribution margin)",
      "repeat purchase / cohorts / retention",
      "channel mix (Shopify/Amazon)",
      "risk controls",
    ],
    rubric: {
      id: "consumer_ecommerce_brand_v1",
      required_signals: ["unit_economics", "risk_controls"],
      positive_drivers: ["strong_ltv_to_cac", "high_margin", "repeat_purchase_or_cohorts"],
      acceptable_missing: ["profitability", "revenue"],
      red_flags: ["fraud", "ownership_unclear", "regulatory_blocker"],
    },
  },

  consumer_fintech_platform_v1: {
    id: "consumer_fintech_platform_v1",
    label: "Consumer Fintech Platform",
    // Consumer fintech platforms: prioritize metrics + risk + narrative clarity.
    // Optional slide/visual/financial-health can help, but should not dominate.
    weights: {
      slide_sequence: 0.3,
      visual_design: 0.2,
      narrative_arc: 1.2,
      metric_benchmark: 1.7,
      financial_health: 0.0,
      risk_assessment: 1.6,
    },
    required_analyzers: ["narrative_arc", "metric_benchmark", "risk_assessment"],
    optional_analyzers: ["slide_sequence", "visual_design", "financial_health"],
    domain_expectations: [
      "transaction volume (TPV/GTV) or adoption (users/transactions)",
      "growth rate",
      "unit economics (take rate / interchange / contribution margin)",
      "compliance posture (KYC/AML, licensing, regulatory readiness)",
      "fraud/chargeback controls",
    ],
    rubric: {
      id: "consumer_fintech_platform_v1",
      required_signals: ["transaction_volume_or_gtv", "compliance_controls", "risk_controls"],
      positive_drivers: ["fast_growth", "strong_unit_economics", "low_fraud_or_chargebacks"],
      acceptable_missing: ["revenue", "arr", "mrr"],
      red_flags: ["ownership_unclear"],
    },
  },

  healthcare_biotech_v1: {
    id: "healthcare_biotech_v1",
    label: "Healthcare / Biotech",
    // Healthcare/biotech: regulatory path + validation evidence + risk controls.
    // Avoid slide/visual heuristics; keep financial_health optional (burn/runway when available).
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.2,
      metric_benchmark: 1.4,
      financial_health: 0.6,
      risk_assessment: 1.6,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment", "narrative_arc"],
    optional_analyzers: ["financial_health"],
    domain_expectations: [
      "clear regulatory path (FDA/IND/IDE/510(k)/PMA)",
      "validation signal (trial phase/IRB/data, endpoints, sensitivity/specificity)",
      "reimbursement plan (CPT/DRG/payer) when applicable",
      "realistic timeline + costs (clearance timeline, burn/runway)",
    ],
    rubric: {
      id: "healthcare_biotech_v1",
      required_signals: ["regulatory_path_clear", "validation_signal", "team_credibility", "timeline_costs_realistic"],
      positive_drivers: ["reimbursement_path", "strong_validation_metrics"],
      acceptable_missing: ["revenue", "arr", "mrr"],
      red_flags: ["safety_ethics_risk"],
    },
  },

  enterprise_saas_b2b_v1: {
    id: "enterprise_saas_b2b_v1",
    label: "Enterprise SaaS (B2B)",
    // Enterprise SaaS: prioritize benchmarkable SaaS KPIs + risk controls.
    // Avoid noisy slide/visual heuristics.
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.0,
      metric_benchmark: 1.7,
      financial_health: 1.1,
      risk_assessment: 1.4,
    },
    required_analyzers: ["metric_benchmark", "financial_health", "risk_assessment", "narrative_arc"],
    optional_analyzers: [],
    domain_expectations: [
      "ARR/MRR and growth",
      "retention (NRR/GRR) and churn",
      "unit economics (payback, magic number)",
      "pipeline health (coverage, sales cycle)",
      "security/enterprise readiness (SOC2/SSO/procurement)",
    ],
    rubric: {
      id: "enterprise_saas_b2b_v1",
      required_signals: ["revenue", "retention_or_churn", "unit_economics", "risk_controls"],
      positive_drivers: ["high_nrr", "high_gross_margin", "low_payback", "healthy_pipeline"],
      acceptable_missing: ["profitability"],
      // Keep policy gating out of rubric red-flags unless explicitly configured.
      red_flags: ["ownership_unclear"],
    },
  },

  media_entertainment_ip_v1: {
    id: "media_entertainment_ip_v1",
    label: "Media / Entertainment / IP",
    // Media/IP deals: emphasize rights/distribution/recoupment structure and risk controls.
    // Avoid noisy slide/visual heuristics; keep financial_health optional (budget/runway when available).
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.2,
      metric_benchmark: 1.3,
      financial_health: 0.6,
      risk_assessment: 1.6,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment", "narrative_arc"],
    optional_analyzers: ["financial_health"],
    domain_expectations: [
      "verifiable rights (option/chain of title)",
      "distribution path (distribution/MG/pre-sales)",
      "attachments and packaging (talent, union status)",
      "completion bond and credible financing plan",
      "waterfall/recoupment clarity",
    ],
    rubric: {
      id: "media_entertainment_ip_v1",
      // Implemented policy-locally as: rights + (distribution/MG/pre-sales OR (strong attachments + financing + completion bond)).
      required_signals: ["rights_verifiable", "financeable_structure"],
      positive_drivers: ["distribution_package", "strong_attachments", "marketing_commitment"],
      acceptable_missing: ["revenue", "arr", "mrr"],
      red_flags: ["rights_unclear", "no_distribution_path", "aggressive_assumptions_no_comps", "recoupment_waterfall_unclear"],
    },
  },

  physical_product_cpg_spirits_v1: {
    id: "physical_product_cpg_spirits_v1",
    label: "Physical Product / CPG / Spirits",
    // Spirits/CPG: prioritize unit economics + repeat/velocity + distribution traction + compliance.
    // Avoid noisy slide/visual heuristics.
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 0.6,
      metric_benchmark: 1.7,
      financial_health: 0.5,
      risk_assessment: 1.5,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment", "narrative_arc"],
    optional_analyzers: ["financial_health"],
    domain_expectations: [
      "gross margin / contribution margin and COGS/landed cost",
      "repeat/retention and retail velocity or sell-through",
      "distribution traction (doors/POD) or signed distribution agreements",
      "working capital plan (inventory turns / cash conversion cycle)",
      "TTB/state alcohol licensing and regulatory posture",
    ],
    rubric: {
      id: "physical_product_cpg_spirits_v1",
      required_signals: [
        "gross_margin_or_unit_economics",
        "repeat_or_velocity",
        "distribution_traction_or_agreements",
        "risk_controls",
        "regulatory_compliance",
      ],
      positive_drivers: ["high_margin", "repeat_purchase_or_cohorts", "strong_distribution", "execution_ready_distribution"],
      acceptable_missing: ["revenue"],
      red_flags: ["negative_unit_margins", "severe_chargebacks_or_returns", "ttb_compliance_unclear", "no_distribution_path"],
    },
  },

  operating_business: {
    id: "operating_business",
    label: "Operating Business",
    weights: {
      slide_sequence: 0.2,
      visual_design: 0.2,
      narrative_arc: 0.8,
      metric_benchmark: 1.3,
      financial_health: 1.5,
      risk_assessment: 1.2,
    },
    required_analyzers: ["financial_health", "risk_assessment"],
    optional_analyzers: ["metric_benchmark", "narrative_arc", "slide_sequence", "visual_design"],
    domain_expectations: ["revenue", "margins", "retention/churn if applicable", "unit economics"],
    rubric: {
      id: "operating_business",
      required_signals: ["revenue", "gross_margin_or_unit_economics", "risk_controls"],
      positive_drivers: ["strong_margins", "low_churn", "efficient_growth"],
      acceptable_missing: ["growth_rate"],
      red_flags: ["fraud", "ownership_unclear", "regulatory_blocker"],
    },
  },

  real_estate_underwriting: {
    id: "real_estate_underwriting",
    label: "Real Estate Underwriting",
    // Mirrors business-plan/IM weighting: downweight slide/visual; emphasize fundamentals.
    weights: {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.1,
      metric_benchmark: 1.5,
      financial_health: 0.0,
      risk_assessment: 1.3,
    },
    required_analyzers: ["metric_benchmark", "risk_assessment"],
    optional_analyzers: ["narrative_arc"],
    domain_expectations: ["LTV", "DSCR", "NOI", "cap rate", "lease terms"],
  },

  fund_spv: {
    id: "fund_spv",
    label: "Fund / SPV Vehicle",
    weights: {
      slide_sequence: 0.2,
      visual_design: 0.2,
      narrative_arc: 0.8,
      metric_benchmark: 1.0,
      financial_health: 1.3,
      risk_assessment: 1.2,
    },
    required_analyzers: ["risk_assessment", "financial_health"],
    optional_analyzers: ["metric_benchmark", "narrative_arc", "slide_sequence", "visual_design"],
    domain_expectations: ["management fee", "carried interest", "capital commitments", "GP/LP"],
  },

  acquisition_memo: {
    id: "acquisition_memo",
    label: "Acquisition Memo",
    weights: {
      slide_sequence: 0.4,
      visual_design: 0.3,
      narrative_arc: 1.0,
      metric_benchmark: 1.2,
      financial_health: 1.4,
      risk_assessment: 1.3,
    },
    required_analyzers: ["financial_health", "risk_assessment"],
    optional_analyzers: ["metric_benchmark", "narrative_arc", "slide_sequence", "visual_design"],
    domain_expectations: ["LOI / purchase agreement", "working capital peg", "earnout", "QoE"],
  },

  credit_memo: {
    id: "credit_memo",
    label: "Credit Memo",
    weights: {
      slide_sequence: 0.1,
      visual_design: 0.1,
      narrative_arc: 0.4,
      metric_benchmark: 1.2,
      financial_health: 1.6,
      risk_assessment: 1.4,
    },
    required_analyzers: ["financial_health", "risk_assessment"],
    optional_analyzers: ["metric_benchmark", "narrative_arc", "slide_sequence", "visual_design"],
    domain_expectations: ["interest rate", "collateral", "covenants", "senior/mezz"],
  },
};

export function getDealPolicy(policyId: string | null | undefined): DealPolicy {
  const id = (policyId || "unknown_generic") as DealPolicyId;
  return DEAL_POLICIES[id] ?? DEAL_POLICIES.unknown_generic;
}
