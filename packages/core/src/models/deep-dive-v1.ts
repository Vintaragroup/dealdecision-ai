export type DeepDiveActionPriorityV1 = "high" | "medium" | "low";
export type DeepDiveEvidenceStrengthV1 = "strong" | "moderate" | "weak" | "none";
export type DeepDiveQuestionPriorityV1 = "p0" | "p1" | "p2";

export type DeepDiveActionSourceV1 =
  | "structured_summary"
  | "underwriting_readiness_v1"
  | "score_explanation"
  | "orchestrator_report_v1";

export interface DeepDiveDiscoverySourceStatusV1 {
  dio_present: boolean;
  report_present: boolean;
  investor_orchestrator_present: boolean;
  financial_breakdown_present: boolean;
  underwriting_readiness_present: boolean;
}

export interface DeepDiveDiscoveryKeyFactsV1 {
  raise_present: boolean;
  business_model_present: boolean;
  revenue_present: boolean;
  customers_present: boolean;
  growth_present: boolean;
}

export interface DeepDiveDiscoverySectionV1 {
  section: "discovery";
  sources: DeepDiveDiscoverySourceStatusV1;
  key_facts: DeepDiveDiscoveryKeyFactsV1;
  diligence_open_items_count: number;
  verification_requests_count: number;
}

export interface DeepDiveGapSectionV1 {
  section: "gap";
  missing_critical_facts: string[];
  underwriting_gaps: string[];
  diligence_open_items: string[];
  verification_requests: string[];
}

export interface DeepDiveImplementationActionV1 {
  action_id: string;
  priority: DeepDiveActionPriorityV1;
  title: string;
  rationale: string;
  source: DeepDiveActionSourceV1;
}

export interface DeepDiveImplementationSectionV1 {
  section: "implementation";
  actions: DeepDiveImplementationActionV1[];
}

export interface DeepDiveMarketSectionV1 {
  section: "market";
  tam_reasoning: {
    status: "supported" | "partial" | "missing";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
  timing_logic: {
    status: "supported" | "partial" | "missing";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
}

export interface DeepDiveProductSectionV1 {
  section: "product";
  differentiation_detection: {
    status: "clear" | "mixed" | "unclear";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
  defensibility_logic: {
    status: "clear" | "partial" | "unclear";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
}

export interface DeepDiveBusinessModelSectionV1 {
  section: "business_model";
  revenue_model_inference: {
    inferred_model: string | null;
    status: "supported" | "partial" | "missing";
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
  scaling_logic: {
    status: "supported" | "partial" | "missing";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
}

export interface DeepDiveTractionSectionV1 {
  section: "traction";
  growth_validation: {
    status: "validated" | "partial" | "unvalidated";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
  proof_vs_promise_detection: {
    status: "proof_heavy" | "mixed" | "promise_heavy";
    notes: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
}

export interface DeepDiveFinancialsSectionV1 {
  section: "financials";
  interpretation_layer: {
    status: "supported" | "partial" | "missing";
    current_state_signals: string[];
    forward_view_signals: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
}

export interface DeepDiveTeamSectionV1 {
  section: "team";
  capability_inference: {
    status: "supported" | "partial" | "missing";
    inferred_capabilities: string[];
    evidence_refs: string[];
    evidence_strength: DeepDiveEvidenceStrengthV1;
  };
}

export interface DeepDiveRiskItemV1 {
  category: "market" | "product" | "execution" | "financial" | "team" | "other";
  severity: "critical" | "high" | "medium" | "low";
  risk: string;
  evidence_refs: string[];
}

export interface DeepDiveRisksSectionV1 {
  section: "risks";
  classification: DeepDiveRiskItemV1[];
}

export interface DeepDiveRedFlagV1 {
  flag: string;
  contradiction_type: "numeric_divergence" | "semantic_divergence" | "source_divergence" | "missing_critical";
  evidence_refs: string[];
}

export interface DeepDiveRedFlagsSectionV1 {
  section: "red_flags";
  items: DeepDiveRedFlagV1[];
}

export interface DeepDiveOpenQuestionV1 {
  question: string;
  priority: DeepDiveQuestionPriorityV1;
  reason: string;
  evidence_refs: string[];
}

export interface DeepDiveOpenQuestionsSectionV1 {
  section: "open_questions";
  prioritized: DeepDiveOpenQuestionV1[];
}

export interface DealDeepDiveV1 {
  schema_version: "deal_deep_dive_v1";
  deal_id: string;
  analysis_version: number | null;
  generated_at: string;
  discovery: DeepDiveDiscoverySectionV1;
  gap: DeepDiveGapSectionV1;
  market: DeepDiveMarketSectionV1;
  product: DeepDiveProductSectionV1;
  business_model: DeepDiveBusinessModelSectionV1;
  traction: DeepDiveTractionSectionV1;
  financials: DeepDiveFinancialsSectionV1;
  team: DeepDiveTeamSectionV1;
  risks: DeepDiveRisksSectionV1;
  red_flags: DeepDiveRedFlagsSectionV1;
  open_questions: DeepDiveOpenQuestionsSectionV1;
  implementation: DeepDiveImplementationSectionV1;
}
