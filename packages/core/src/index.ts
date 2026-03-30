/**
 * HRM-DD Core Package
 * Hierarchical Reasoning Model for Due Diligence
 */

// Export all HRM-DD types
export * from "./types/hrmdd";
export * from "./types/analysis";
export * from "./types/validation";

// Export services
export * from "./services/planner";
export * from "./services/cycle-analyzer";
export * from "./services/ledger";
export * from "./services/prompt-generator";

// Export utilities
export * from "./lib/sanitize";
export * from "./lib/document-capabilities";
export * from "./lib/fail-open-policy";
export * from "./lib/stable-uuid";
export * from "./lib/stable-json";
export * from "./queue-names";
export * from './config/segment-thresholds';
export * from './scoring/segment-coverage';
export * from './scoring/scoring-input-v0';
export * from './scoring/score-bands-v2';
export * from './scoring/decision-v1';
export * from './classification/content-archetypes';
export * from './classification/business-model-arbitrator';
export * from './classification/policy-aware-schema';
export * from './classification/get-selected-policy-id';
export * from "./classifiers/raise-detector";

// ============================================================================
// DIO / Orchestration (Phase 4)
// ============================================================================

// NOTE: Avoid `export * from "./types/dio"` because it conflicts with HRM-DD
// exports (e.g., PlannerState/FactRow/LedgerManifest/validatePlannerState).

// Orchestration (explicit exports to avoid AnalyzerRegistry name conflicts)
export {
	DealOrchestrator,
	OrchestratorConfigSchema,
	OrchestrationInputSchema,
	OrchestrationResultSchema,
	OrchestrationError,
	AnalyzerTimeoutError,
} from "./orchestration/orchestrator";
export type {
	OrchestratorConfig,
	OrchestrationInput,
	OrchestrationResult,
} from "./orchestration/orchestrator";

export {
	AnalysisPipeline,
	ConfidenceThresholdsSchema,
	PipelineConfigSchema,
	PipelineStateSchema,
	PipelineResultSchema,
	PipelineError,
	InsufficientConfidenceError,
} from "./orchestration/pipeline";
export type {
	ConfidenceThresholds,
	PipelineConfig,
	PipelineState,
	PipelineResult,
} from "./orchestration/pipeline";

// Orchestration helpers
export { createDealOrchestrator, runDealAnalysis } from "./orchestration/factory";

// Analyzers
export {
	BaseAnalyzer,
	AnalyzerValidationError,
	AnalyzerExecutionError,
	createResultMetadata,
} from "./analyzers/base";
export type {
	Analyzer,
	AnalyzerMetadata,
	AnalyzerResultBase,
} from "./analyzers/base";

export { createAnalyzerRegistry } from "./analyzers/registry";

// Fundability system (analysis foundation)
export {
	analysis_foundation_spec_version,
	isFundabilityShadowModeEnabled,
	isFundabilitySoftCapsEnabled,
	isFundabilityHardGatesEnabled,
} from "./config/analysis-foundation";
export type { AnalyzerRegistry as DealAnalyzerRegistry } from "./analyzers/registry";
export * from "./analyzers/slide-sequence";
export * from "./analyzers/metric-benchmark";
export * from "./analyzers/visual-design";
export * from "./analyzers/narrative-arc";
export * from "./analyzers/financial-health";
export * from "./analyzers/risk-assessment";
export * from "./analyzers/financial-integrity-analyzer-v1";
export * from "./types/financial-integrity-v1";

// Financial Semantics Layer (Phase 0)
export * from "./financial-semantics/index";

// Storage + services
export * from "./services/dio-storage";
export {
	MCPError,
	MCPTimeoutError,
	MCPProviderUnavailableError,
	MCPToolNotFoundError,
	MockMCPClient,
	createDefaultMCPConfig,
} from "./services/mcp/client";
export type { MCPClient, MCPClientConfig, MCPResponse } from "./services/mcp/client";

export {
	EvidenceServiceError,
	EvidenceNotFoundError,
	EvidenceExtractionError,
	MockEvidenceService,
	EvidenceServiceImpl,
} from "./services/evidence/service";
export type { EvidenceService } from "./services/evidence/service";

export {
	CanonicalEvidenceServiceImpl,
	EvidenceItemSchema,
	EvidencePacketSchema,
	computeEvidenceId,
	computePacketId,
	selectEvidenceForPacket,
	sha256Hex,
} from "./services/evidence/canonical-evidence";
export type { CanonicalEvidenceService, EvidenceItem, EvidencePacket } from "./services/evidence/canonical-evidence";

// Document Intelligence (signals-only)
export * from "./services/document-intelligence/document-intelligence";

export {
	LLMServiceError,
	LLMTimeoutError,
	MockLLMService,
	LLMServiceImpl,
} from "./services/llm/service";
export type { LLMService } from "./services/llm/service";

// Deal lifecycle
export * from "./services/purge-deal-cascade";

// Reports
export { compileDIOToReport, compileDIOToReportWithPromotedFacts } from "./reports/compiler-simple";
export { buildConvictionV1 } from "./reports/conviction-v1";
export { detectFinancialSnapshotStaleness } from "./reports/financial-snapshot-staleness";
export type { FinancialSnapshotStalenessResult } from "./reports/financial-snapshot-staleness";
export type {
  ConvictionV1,
  ConvictionInputsV1,
  ConvictionInputFamilyV1,
  ConvictionInputFamilyKeyV1,
  ConvictionContributorV1,
  ConvictionContradictionV1,
  ConvictionRequiredCheckV1,
  ConvictionLineageV1,
} from "./models/conviction-v1";
export { buildDeterministicDealSummaryV1FromStructuredSummary } from "./reports/deal-summary-v1-deterministic";
export { buildInvestmentAnalysisOverviewV2 } from "./reports/investment-analysis-overview-v2";
export {
  buildDealDeepDiveV1,
  generateDeepDiveDiscoverySectionV1,
  generateDeepDiveGapSectionV1,
  generateDeepDiveMarketSectionV1,
  generateDeepDiveProductSectionV1,
  generateDeepDiveBusinessModelSectionV1,
  generateDeepDiveTractionSectionV1,
  generateDeepDiveFinancialsSectionV1,
  generateDeepDiveTeamSectionV1,
  generateDeepDiveRisksSectionV1,
  generateDeepDiveRedFlagsSectionV1,
  generateDeepDiveOpenQuestionsSectionV1,
  generateDeepDiveImplementationSectionV1,
} from "./reports/deep-dive-v1";
export { DealDeepDiveV1Schema } from "./reports/deep-dive-v1.schema";
export {
  toUniqueStrings as deepDiveToUniqueStrings,
  evidenceStrengthFromSignals,
  detectDeepDiveContradictionsV1,
  prioritizeDeepDiveQuestionsV1,
} from "./reports/deep-dive-reasoning-v1";
export { buildScoreExplanationFromDIO, buildScoringDiagnosticsFromDIO } from "./reports/score-explanation";
export type { ScoreExplanation } from "./reports/score-explanation";
export type { ScoringDiagnosticsV1 } from "./types/dio";

// Verticals
export { getVerticalContract } from "./verticals/vertical-contracts";
export type { VerticalKey, VerticalContract } from "./verticals/vertical-contracts";
export { validateReportAgainstContract } from "./verticals/validate-vertical-contract";
export type { ContractViolation } from "./verticals/validate-vertical-contract";

// Deterministic score bridge (API-side gating)
export { buildDeterministicScoreInputsV1 } from "./scoring/score-inputs-v1";
export type { ScoreInputsV1 } from "./scoring/score-inputs-v1";

// Phase 1 deterministic composer (used by worker for change acknowledgement)
export { generatePhase1DIOV1 } from "./phase1/phase1-dio-v1";

// Phase 1 deterministic KPI reconciliation (ARR/MRR)
export * from "./phase1/kpi-reconciliation-v1";

// LLM narration (API-side optional feature)
export { LlmNarrationV1Schema } from "./llm/narration-schema";
export type { LlmNarrationV1 } from "./llm/narration-schema";
export type { LlmNarrationV1 as LlmNarrationV1Type } from "./llm/narration-schema";

// LLM overview (API-side optional feature)
export { LlmOverviewV1Schema, LlmOverviewV1CitationSchema } from "./llm/overview-schema";
export type { LlmOverviewV1 } from "./llm/overview-schema";
export type { LlmOverviewV1 as LlmOverviewV1Type } from "./llm/overview-schema";
export { buildNarrationPrompt } from "./llm/build-narration-prompt";
export { buildOverviewPrompt } from "./llm/build-overview-prompt";
export { buildInvestmentAnalysisOverviewPrompt } from "./llm/build-investment-analysis-overview-prompt";
export { degradeNarrationV1, validateNoNewFacts } from "./llm/narration-guard";
export type { NarrationGuardResult, NarrationGuardViolation } from "./llm/narration-guard";
export { degradeOverviewV1 } from "./llm/overview-guard";
export type { OverviewDegradeResult, OverviewGuardError, OverviewGuardViolation } from "./llm/overview-guard";

// ============================================================================
// DDAI Orchestrator Composition Layer (v1)
// ============================================================================
// Deterministic report builder that composes existing render_package data
// into the ddai_orchestrator_report_v1 schema. No new LLM calls. No DB writes.
export { buildOrchestratorReportV1, type InvestorInsightsRenderPackage } from "./orchestrator/build-orchestrator-report-v1";
export type { OrchestratorRenderPackageInput } from "./orchestrator/render-package-input";
export type {
  OrchestratorReportV1,
  OrchestratorDecision,
  OrchestratorScores,
  DocumentConfidence,
  StageContext,
  DecisionLabel,
  StageLabel,
  DciBand,
  FinancialHealthScore,
  MarketScore,
  // Product profile types
  ProductProfileV1,
  ProductProfileEvidence,
  ProductType,
  DeliveryModel,
  ProductMaturity,
  AiUsageType,
  AiEvidenceStrength,
  // Financial segment types
  FinancialSegment,
  FinancialBenchmark,
  FinancialLayoutClassification,
  FinancialReconciliation,
} from "./orchestrator/types";
// ============================================================================
// Financial Fact Registry (v1)
// ============================================================================
// Persisted granular financial datapoints (metric × period × provenance).
// Consumed by: deal chat (read), orchestrator (read-only).
export type {
  FinancialFactV1,
  FinancialFactUnit,
  FinancialFactSourceKind,
  FinancialFactPeriodType,
  FinancialFactConfidence,
  FinancialFactReconciliationStatus,
  CrossSourceReconciliationStatus,
  ResolvedCrossSheetValue,
  CellDependency,
} from "./financial-facts/financial-fact-v1";
export type {
  DealDeepDiveV1,
  DeepDiveDiscoverySectionV1,
  DeepDiveGapSectionV1,
  DeepDiveMarketSectionV1,
  DeepDiveProductSectionV1,
  DeepDiveBusinessModelSectionV1,
  DeepDiveTractionSectionV1,
  DeepDiveFinancialsSectionV1,
  DeepDiveTeamSectionV1,
  DeepDiveRisksSectionV1,
  DeepDiveRedFlagsSectionV1,
  DeepDiveOpenQuestionsSectionV1,
  DeepDiveRiskItemV1,
  DeepDiveRedFlagV1,
  DeepDiveOpenQuestionV1,
  DeepDiveImplementationSectionV1,
  DeepDiveImplementationActionV1,
  DeepDiveActionPriorityV1,
  DeepDiveActionSourceV1,
  DeepDiveEvidenceStrengthV1,
  DeepDiveQuestionPriorityV1,
} from "./models/deep-dive-v1";
export {
  isFiniteFactValue,
  capFactExcerpt,
  computeFactId,
  validateFinancialFact,
  inferPeriodType,
} from "./financial-facts/financial-fact-v1";

// ============================================================================
// Financial Coverage v1
// ============================================================================
// Registry-based coverage profile: which statements / periods / metrics are
// present, any conflicts detected, and expected-but-missing metrics.
// Pure functions — no DB, no LLM. Used by both API and worker.
export type {
  FinancialConflictV1,
  FinancialCoverageV1,
} from "./financial-facts/financial-coverage-v1";
export {
  INCOME_STATEMENT_METRICS,
  UNIT_ECONOMICS_METRICS,
  CASH_FLOW_METRICS,
  detectFinancialFactConflictsV1,
  buildFinancialCoverageV1,
} from "./financial-facts/financial-coverage-v1";

// ============================================================================
// Page Registry (v1)
// ============================================================================
// Persisted per-page index: type classification, numeric claims, entities,
// key claims, and evidence linkage. Consumed by: deal chat, API.
export type {
  PageTypeV1,
  PageEntityKindV1,
  PageEntityV1,
  NumericClaimUnitV1,
  NumericClaimV1,
  PageClaimV1,
  PageConfidenceV1,
  PageRegistryRowV1,
} from "./page-registry/page-registry-v1";
export {
  PAGE_TYPES_V1,
  isPageTypeV1,
  computePageId,
  capPageExcerpt,
  capClaimText,
  capContext,
  validatePageRegistryRow,
} from "./page-registry/page-registry-v1";

// ============================================================================
// Deal Fact Registry (v1)
// ============================================================================
// Persisted, evidence-backed non-financial canonical deal facts.
// Covers: raise_amount, valuation, round_stage, traction_metric, team_key_role, etc.
// Financial facts (ARR, burn, etc. sourced from financial statements) live in
// FinancialFactV1. This registry is extractive + conflict-aware.
export type {
  DealFactTypeV1,
  DealFactValueKind,
  DealFactValueString,
  DealFactValueNumber,
  DealFactValueMoney,
  DealFactValueRange,
  DealFactValueList,
  DealFactValueEntity,
  DealFactValueUnknown,
  DealFactValueV1,
  DealFactEvidenceV1,
  DealFactConfidence,
  DealFactPageRef,
  DealFactV1,
} from "./deal-facts/deal-fact-v1";
export {
  DEAL_FACT_TYPES_V1,
  isDealFactTypeV1,
  capDealFactExcerpt,
  capDealFactLabel,
  computeDealFactIdV1,
  validateDealFact,
} from "./deal-facts/deal-fact-v1";

// ============================================================================
// Deal Assistant Answer Policy (v1)
// ============================================================================
// Deterministic intent classification + prompt policy block + sanity filter.
// No LLM calls. Pure, unit-testable.
export type {
  QuestionIntent,
  AnswerBasis,
  SanityCheckResult,
  EnforceAnswerSanityOpts,
} from "./chat/answer-policy-v1";
export {
  classifyQuestionIntent,
  buildPromptPolicyBlock,
  enforceAnswerSanity,
} from "./chat/answer-policy-v1";

// ============================================================================
// Evidence Confidence Layer (PR36.6)
// ============================================================================
// Classifies every canonical fact with a confidence level before promotion to
// investor-facing output surfaces. Pure, deterministic, no LLM calls.
export {
  EVIDENCE_CONFIDENCE_LEVEL,
  ALL_CONFIDENCE_LEVELS,
} from "./evidence/evidence-confidence";
export type {
  EvidenceConfidenceLevel,
  EvidenceConfidenceSignals,
  FactConfidenceState,
} from "./evidence/evidence-confidence";

export {
  computeEvidenceConfidence,
  buildConfidenceSignals,
} from "./evidence/evidence-confidence-evaluator";

export {
  EvidenceSourceStrength,
  classifySourceStrength,
  isSourceTainted,
  isStrongSource,
} from "./evidence/evidence-source-strength";

// ============================================================================
// Fact Plausibility Guards
// ============================================================================
// Page-level context guards for canonical field extraction.
// Guards reject facts when source page lacks appropriate semantic context.
export type {
  FactPlausibilityResult,
  FactPlausibilityGuard,
} from "./fact-plausibility-guards";
export { FACT_PLAUSIBILITY_GUARDS } from "./fact-plausibility-guards";

// ============================================================================
// Fact Promotion Gate (PR36.6)
// ============================================================================
// Per-surface promotion rules: determines if a confidence level permits
// promotion to deal_overview, display_facts, governed_summary etc.
export {
  getFactPromotionPolicy,
  isFactPromotable,
  getUncertaintyLabel,
  isDefinitiveFact,
} from "./governance/fact-promotion-gate";
export type {
  PromotionSurface,
  FactPromotionPolicy,
} from "./governance/fact-promotion-gate";

// ============================================================================
// Temporal Scope (Phase 1 — pipeline hardening)
// ============================================================================
// Canonical temporal classification primitive. Replaces scattered
// looksLikeFutureYear / isForecast logic across financial-statement-parser,
// deal-fusion, and stage-2-deterministic.
export type { TemporalScope } from "./temporal/temporal-scope";
export {
  classifyTemporalScope,
  extractYearFromLabel,
  isProjectedScope,
  temporalScopeLabel,
} from "./temporal/temporal-scope";

// ── Temporal Alignment Engine (Phase 3) ──────────────────────────────────────
// Deterministic fact-level temporal comparison: TemporalReferenceClass,
// canCompareFactsTemporally, MetricDefinitionFamily, grouped mismatch flags.
export type {
  TemporalReferenceClass,
  MetricDefinitionFamily,
  TemporalComparisonReason,
} from "./temporal/temporal-alignment";
export {
  classifyFactTemporally,
  getMetricDefinitionFamily,
  canCompareFactsTemporally,
  buildGroupedTemporalMismatchFlag,
} from "./temporal/temporal-alignment";

// ============================================================================
// Field Typing Rules / TypedMetric (Phase 1 — now wired)
// ============================================================================
// Previously orphaned. Now has temporal_scope threaded through it and is
// exported for use in investor-insights extraction.
export type { FieldTypeV1, TypedMetric, EvidenceRef } from "./fields/field-typing-rules";