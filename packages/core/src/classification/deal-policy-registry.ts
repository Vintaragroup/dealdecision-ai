import type { ScoreWeights } from "../reports/score-explanation";

export type DealPolicyId =
  | "unknown_generic"
  | "startup_raise"
  | "execution_ready_v1"
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
