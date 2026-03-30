export type DeepDiveActionPriorityV1 = "high" | "medium" | "low";

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

export interface DealDeepDiveV1 {
  schema_version: "deal_deep_dive_v1";
  deal_id: string;
  analysis_version: number | null;
  generated_at: string;
  discovery: DeepDiveDiscoverySectionV1;
  gap: DeepDiveGapSectionV1;
  implementation: DeepDiveImplementationSectionV1;
}
