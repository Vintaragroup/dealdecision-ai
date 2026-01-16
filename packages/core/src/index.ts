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
export * from './config/segment-thresholds';
export * from './scoring/segment-coverage';
export * from './scoring/scoring-input-v0';

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
	LLMServiceError,
	LLMTimeoutError,
	MockLLMService,
	LLMServiceImpl,
} from "./services/llm/service";
export type { LLMService } from "./services/llm/service";

// Deal lifecycle
export * from "./services/purge-deal-cascade";

// Reports
export { compileDIOToReport } from "./reports/compiler-simple";
export { buildScoreExplanationFromDIO, buildScoringDiagnosticsFromDIO } from "./reports/score-explanation";
export type { ScoreExplanation } from "./reports/score-explanation";
export type { ScoringDiagnosticsV1 } from "./types/dio";

// Phase 1 deterministic composer (used by worker for change acknowledgement)
export { generatePhase1DIOV1 } from "./phase1/phase1-dio-v1";
