/**
 * DDAI Orchestrator Report — Type Definitions
 *
 * Schema: ddai_orchestrator_report_v1
 * Authoritative contract: docs/Active/orchestractor/DDAI_JSON_CONTRACT_v1.md
 *
 * All numeric scores are 0–100 unless otherwise noted.
 * risk_severity_score (URSS): 0–100 where HIGHER is WORSE.
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

export type DciBand = "Strong" | "Good" | "Partial" | "Weak";
export type StageLabel = "Seed" | "SeriesA" | "Growth" | "Unknown";
export type DecisionLabel = "GO" | "CONSIDER" | "NO_GO";
export type ConfidenceBand = "High" | "Medium" | "Low";
export type StructureRating = "High" | "Medium" | "Low";
export type RiskSeverityLabel = "Low" | "Medium" | "High" | "Critical";
export type RequestPriority = "P0" | "P1" | "P2";
export type FhcStatus = "ok" | "insufficient_data";
export type EvidenceKind =
  | "display_fact"
  | "visual_asset"
  | "extraction"
  | "phase1_claim"
  | "metric"
  | "section";
export type SourceType = "xlsx" | "deck" | "other" | "unknown";

// ─── Product profile primitives ──────────────────────────────────────────────

export type ProductType =
  | "SaaS"
  | "Marketplace"
  | "API"
  | "Services"
  | "Hardware"
  | "Hybrid"
  | "Unknown";

export type DeliveryModel =
  | "B2B SaaS"
  | "PLG"
  | "Enterprise"
  | "Services"
  | "Unknown";

export type ProductMaturity =
  | "Concept"
  | "MVP"
  | "Beta"
  | "Live"
  | "Scaling"
  | "Unknown";

export type AiUsageType =
  | "Generative"
  | "Predictive"
  | "Recommender"
  | "Automation"
  | "Other"
  | "Unknown"
  | "None";

export type AiEvidenceStrength = "strong" | "weak" | "marketing_only" | "none";

// ─── Sub-structures ──────────────────────────────────────────────────────────

export interface DocumentConfidenceInputs {
  text_coverage_pct: number;
  layout_coverage_pct: number;
  dpu_integrity_score: number;
  expected_pages_total: number;
  dpu_rows_total: number;
  missing_pages_total: number;
  hard_missing_pages_total: number;
}

export interface DocumentConfidence {
  score: number;
  band: DciBand;
  inputs: DocumentConfidenceInputs;
  notes: string[];
}

export interface StageContext {
  stage: StageLabel;
  raise_amount: string | null;
  instrument: string | null;
  valuation_pre: string | null;
  valuation_post: string | null;
  missing_critical_terms: string[];
}

export interface MarketScore {
  raw: number;
  persisted: number;
  missing_inputs: string[];
}

export interface FinancialHealthScoreInputs {
  fsi_evidence_strength: number;
  reconciliation_confidence_pct: number | null;
  has_income_statement: boolean;
  has_cash_flow: boolean;
  has_balance_sheet: boolean;
  has_saas_kpis: boolean;
  has_use_of_funds: boolean;
  has_budget_model: boolean;
  deck_has_revenue: boolean;
  deck_has_burn: boolean;
  deck_has_runway: boolean;
  deck_has_growth: boolean;
  deck_has_margin: boolean;
}

export interface FinancialHealthScore {
  status: FhcStatus;
  /** null only when status === "insufficient_data" */
  score: number | null;
  is_proxy: boolean;
  missing_sections: string[];
  inputs: FinancialHealthScoreInputs;
}

export interface OrchestratorScores {
  overall_recommendation_score: number;
  risk_severity_score: number;
  market_score: MarketScore;
  financial_health_score: FinancialHealthScore;
}

export interface DecisionThresholdsUsed {
  stage: StageLabel;
  go_min_ors: number;
  max_acceptable_risk: number;
}

export interface OrchestratorDecision {
  label: DecisionLabel;
  confidence_band: ConfidenceBand;
  rationale_bullets: string[];
  thresholds_used: DecisionThresholdsUsed;
}

// ─── Segment types ───────────────────────────────────────────────────────────

export interface ExecutiveSummarySegment {
  headline: string;
  summary_paragraphs: string[];
  strengths: string[];
  risks: string[];
  open_questions: string[];
  evidence_refs: string[];
}

export interface StructureAssessment {
  simplicity: StructureRating;
  dilution_visibility: StructureRating;
  valuation_clarity: StructureRating;
  downside_protection: StructureRating;
}

export interface CanonicalFieldSnapshot {
  field: string;
  value: string | null;
  source: SourceType;
  evidence_refs: string[];
}

export interface DealTermsSegment {
  narrative: string;
  structure_assessment: StructureAssessment;
  missing_terms: string[];
  canonical_fields_snapshot: CanonicalFieldSnapshot[];
}

export interface MarketKpi {
  label: string;
  value: string;
  evidence_refs: string[];
}

export interface MarketSegment {
  narrative: string;
  score: number;
  kpis: MarketKpi[];
  strengths: string[];
  concerns: string[];
  ai_insight: string;
  missing_inputs: string[];
  evidence_refs: string[];
}

export interface FinancialBenchmark {
  label: string;
  value: string;
  basis: "direct" | "implied" | "deck_signal";
  evidence_refs: string[];
}

export interface FinancialLayoutClassification {
  layout_coverage_pct: number;
  has_income_statement: boolean;
  has_use_of_funds: boolean;
  has_budget_model: boolean;
  has_cap_table: boolean;
  has_cash_flow: boolean;
  has_balance_sheet: boolean;
  has_saas_kpis: boolean;
}

export interface ReconciliationFlag {
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "WARN";
  evidence_refs: string[];
  note: string | null;
}

export interface FinancialReconciliation {
  confidence_score: number;
  flags: ReconciliationFlag[];
}

export interface FinancialSegment {
  narrative_paragraphs: string[];
  strengths: string[];
  considerations: string[];
  benchmarks: FinancialBenchmark[];
  layout_classification: FinancialLayoutClassification;
  reconciliation: FinancialReconciliation;
}

export interface TopRisk {
  risk: string;
  severity: RiskSeverityLabel;
  drivers: string[];
  evidence_refs: string[];
}

export interface VerificationRequest {
  request: string;
  priority: RequestPriority;
  why: string;
  evidence_refs: string[];
}

export interface ConflictEntry {
  field: string;
  a: string | null;
  b: string | null;
  source_a: "xlsx" | "deck" | "other";
  source_b: "xlsx" | "deck" | "other";
  evidence_refs: string[];
}

export interface DataIssues {
  missing_critical_terms: string[];
  conflicts: ConflictEntry[];
  coverage_pct: number;
  gates_failed: number;
}

export interface RiskVerificationSegment {
  summary_paragraphs: string[];
  top_risks: TopRisk[];
  verification_requests: VerificationRequest[];
  data_issues: DataIssues;
}

// ─── Product profile segment ─────────────────────────────────────────────────

/** Per-field evidence references for the product profile. */
export interface ProductProfileEvidence {
  company_description?: string[];
  problem_statement?: string[];
  solution_summary?: string[];
  ai_usage_summary?: string[];
}

/**
 * Structured product & technology profile extracted from pitch materials.
 * Populated by product_profile_v1 governed LLM synthesis.
 */
export interface ProductProfileV1 {
  schema_version: "product_profile_v1";
  /** 1–2 sentence company description. */
  company_description: string;
  /** 1–2 sentence problem being solved. */
  problem_statement: string;
  /** 1–2 sentence solution / product summary. */
  solution_summary: string;
  product_type: ProductType;
  delivery_model: DeliveryModel;
  target_customer: string;
  buyer_persona: string | null;
  /** 3–6 core workflow steps, stored as string array. */
  core_workflow: string[];
  /** 3–10 core product features. */
  core_features: string[];
  /** 0–8 claimed differentiators. */
  differentiation_claims: string[];
  /** 0–10 integrations or dependencies. */
  integrations_or_dependencies: string[];
  product_maturity: ProductMaturity;
  // ─── AI-specific ─────────────────────────────────────────────────────────
  /** true only when AI/ML is explicitly mentioned in documentation. */
  ai_claims_present: boolean;
  /** Null when ai_claims_present is false. */
  ai_usage_summary: string | null;
  ai_usage_type: AiUsageType;
  /** Data moat / workflow moat description, or null when absent. */
  ai_defensibility_notes: string | null;
  ai_evidence_strength: AiEvidenceStrength;
  // ─── Evidence ─────────────────────────────────────────────────────────────
  /** Per-field evidence references for auditability. */
  evidence: ProductProfileEvidence;
  /** Segment-level source evidence IDs cited from documentation. */
  sources: string[];
}

export interface OrchestratorSegments {
  executive_summary: ExecutiveSummarySegment;
  deal_terms: DealTermsSegment;
  market: MarketSegment;
  financial: FinancialSegment;
  risk_verification: RiskVerificationSegment;
  product_profile_v1: ProductProfileV1;
}

// ─── Evidence Registry ───────────────────────────────────────────────────────

export interface EvidenceRegistryItem {
  evidence_id: string;
  kind: EvidenceKind;
  document_id: string;
  page_index: number;
  snippet: string;
  confidence: number;
  tags: string[];
}

export interface EvidenceRegistryIndexes {
  by_segment: {
    executive_summary: string[];
    deal_terms: string[];
    market: string[];
    financial: string[];
    risk_verification: string[];
    product_profile_v1: string[];
  };
}

export interface EvidenceRegistry {
  items: EvidenceRegistryItem[];
  indexes: EvidenceRegistryIndexes;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface InputsPresent {
  gate_state: boolean;
  canonical_fields: boolean;
  coverage_snapshot: boolean;
  financial_layout_classifier_v1: boolean;
  financial_reconciliation_v1: boolean;
  market_analysis: boolean;
}

export interface TimingsMs {
  compose_total: number;
  market_call: number;
  deal_terms_call: number;
  financial_call: number;
  risk_call: number;
}

export interface OrchestratorDiagnostics {
  inputs_present: InputsPresent;
  warnings: string[];
  timings_ms: TimingsMs;
}

// ─── Source versions ─────────────────────────────────────────────────────────

export interface SourceVersions {
  page_understanding_version: string;
  investor_insights_version: string;
  deterministic_pipeline_version: string;
}

// ─── Root type ───────────────────────────────────────────────────────────────

export interface OrchestratorReportV1 {
  schema_version: "ddai_orchestrator_report_v1";
  deal_id: string;
  created_at: string;
  input_fingerprint: string;
  source_versions: SourceVersions;
  document_confidence: DocumentConfidence;
  stage_context: StageContext;
  scores: OrchestratorScores;
  decision: OrchestratorDecision;
  segments: OrchestratorSegments;
  evidence_registry: EvidenceRegistry;
  diagnostics: OrchestratorDiagnostics;
}
