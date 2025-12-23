/**
 * Deal Intelligence Object (DIO) Schema v1.0.0
 * 
 * Canonical, versioned schema for investment analysis outputs.
 * Based on HRM-DD SOP and Full System Architecture.
 * 
 * Key principles:
 * - Immutable inputs (snapshot of what was analyzed)
 * - Deterministic analyzer outputs
 * - Full audit trail
 * - Versioned evolution
 */

import { z } from "zod";

// ============================================================================
// Schema Version
// ============================================================================

export const SCHEMA_VERSION = "1.0.0";

export const SchemaVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  released_at: z.string().datetime(),
  breaking_changes: z.boolean(),
});

export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;

// ============================================================================
// Analysis Inputs (Immutable Snapshot)
// ============================================================================

export const ExtractedMetricSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.union([z.string(), z.number()]),
  unit: z.string().nullable(),
  page: z.union([z.number(), z.string()]),
  confidence: z.number().min(0).max(1),
});

export type ExtractedMetric = z.infer<typeof ExtractedMetricSchema>;

export const DocumentSnapshotSchema = z.object({
  document_id: z.string().uuid(),
  title: z.string(),
  type: z.string(),
  version_hash: z.string().length(64), // SHA-256
  extracted_at: z.string().datetime(),
  page_count: z.number().int().nonnegative(),
  
  metrics: z.array(ExtractedMetricSchema),
  headings: z.array(z.string()),
  summary: z.string(),
});

export type DocumentSnapshot = z.infer<typeof DocumentSnapshotSchema>;

export const EvidenceSnapshotSchema = z.object({
  evidence_id: z.string().uuid(),
  source: z.enum(["extraction", "tavily", "mcp"]),
  kind: z.string(),
  text: z.string(),
  url: z.string().url().optional(),
  confidence: z.number().min(0).max(1),
  created_at: z.string().datetime(),
});

export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;

export const AnalysisConfigSchema = z.object({
  analyzer_versions: z.object({
    slide_sequence: z.string(),
    metric_benchmark: z.string(),
    visual_design: z.string(),
    narrative_arc: z.string(),
    financial_health: z.string(),
    risk_assessment: z.string(),
  }),
  
  features: z.object({
    tavily_enabled: z.boolean().default(false),
    mcp_enabled: z.boolean().default(true),
    llm_synthesis_enabled: z.boolean().default(true),
    debug_scoring: z.boolean().default(false),
  }),
  
  parameters: z.object({
    max_cycles: z.number().int().positive().default(3),
    depth_threshold: z.number().int().positive().default(2),
    min_confidence: z.number().min(0).max(1).default(0.7),
  }),
});

export type AnalysisConfig = z.infer<typeof AnalysisConfigSchema>;

export const AnalysisInputsSchema = z.object({
  documents: z.array(DocumentSnapshotSchema),
  evidence: z.array(EvidenceSnapshotSchema),
  config: AnalysisConfigSchema,
});

export type AnalysisInputs = z.infer<typeof AnalysisInputsSchema>;

// ============================================================================
// Analyzer Inputs
// ============================================================================

export const SlideSequenceInputSchema = z.object({
  headings: z.array(z.string()),
  slides: z.array(z.object({
    heading: z.string().optional(),
    text: z.string().optional(),
  })).optional(),
  evidence_ids: z.array(z.string().uuid()).optional(),
  debug_scoring: z.boolean().optional(),
});

export type SlideSequenceInput = z.infer<typeof SlideSequenceInputSchema>;

export const ExtractedMetricInputSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  period: z.string().optional(),
  unit: z.string().optional(),
  source_doc_id: z.string().min(1),
});

export type ExtractedMetricInput = z.infer<typeof ExtractedMetricInputSchema>;

export const MetricBenchmarkInputSchema = z.object({
  text: z.string(),
  industry: z.string().optional(),
  extracted_metrics: z.array(ExtractedMetricInputSchema).optional(),
  evidence_ids: z.array(z.string().uuid()).optional(),
  debug_scoring: z.boolean().optional(),
});

export type MetricBenchmarkInput = z.infer<typeof MetricBenchmarkInputSchema>;

export const VisualDesignInputSchema = z.object({
  page_count: z.number().int().positive(),
  file_size_bytes: z.number().int().positive(),
  total_text_chars: z.number().int().nonnegative(),
  headings: z.array(z.string()),
  primary_doc_type: z.string().optional(),
  text_summary: z.string().optional(),
  text_items_count: z.number().int().nonnegative().optional(),
  evidence_ids: z.array(z.string().uuid()).optional(),
  debug_scoring: z.boolean().optional(),
});

export type VisualDesignInput = z.infer<typeof VisualDesignInputSchema>;

export const NarrativeArcInputSchema = z.object({
  slides: z.array(z.object({
    heading: z.string(),
    text: z.string(),
  })),
  evidence_ids: z.array(z.string().uuid()).optional(),
  debug_scoring: z.boolean().optional(),
});

export type NarrativeArcInput = z.infer<typeof NarrativeArcInputSchema>;

export const FinancialHealthInputSchema = z.object({
  revenue: z.number().optional(),
  expenses: z.number().optional(),
  cash_balance: z.number().optional(),
  burn_rate: z.number().optional(),
  growth_rate: z.number().optional(),
  extracted_metrics: z.array(ExtractedMetricInputSchema).optional(),
  evidence_ids: z.array(z.string().uuid()).optional(),
  debug_scoring: z.boolean().optional(),
});

export type FinancialHealthInput = z.infer<typeof FinancialHealthInputSchema>;

export const RiskAssessmentInputSchema = z.object({
  pitch_text: z.string(),
  headings: z.array(z.string()),
  metrics: z.record(z.number()).optional(),
  team_size: z.number().int().nonnegative().optional(),
  evidence_ids: z.array(z.string().uuid()).optional(),
  debug_scoring: z.boolean().optional(),
});

export type RiskAssessmentInput = z.infer<typeof RiskAssessmentInputSchema>;

// ============================================================================
// Analyzer Results (Deterministic Outputs)
// ============================================================================

const DebugScoringValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const DebugScoringItemSchema = z.object({
  key: z.string(),
  value: DebugScoringValueSchema.optional(),
  weight: z.number().optional(),
  points: z.number().optional(),
  note: z.string().optional(),
});

const DebugScoringRuleSchema = z.object({
  rule_id: z.string(),
  description: z.string(),
  delta: z.number(),
  running_total: z.number(),
});

export const DebugScoringTraceSchema = z.object({
  // Deterministic transparency fields (preferred)
  inputs_used: z.array(z.string()).optional(),
  rules: z.array(DebugScoringRuleSchema).optional(),
  exclusion_reason: z.string().nullable().optional(),

  input_summary: z.object({
    completeness: z.object({
      score: z.number().min(0).max(1),
      notes: z.array(z.string()),
    }),
    signals_count: z.number().int().nonnegative(),
  }),
  signals: z.array(DebugScoringItemSchema),
  penalties: z.array(DebugScoringItemSchema),
  bonuses: z.array(DebugScoringItemSchema),
  final: z.object({
    score: z.number().min(0).max(100).nullable(),
    formula: z.string().optional(),
  }),
});

export type DebugScoringTrace = z.infer<typeof DebugScoringTraceSchema>;

const AnalyzerMetaSchema = z.object({
  status: z.enum(["ok", "insufficient_data", "extraction_failed"]).optional(),
  coverage: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

// Slide Sequence Analyzer
export const DeviationSchema = z.object({
  position: z.number().int().nonnegative(),
  expected: z.string(),
  actual: z.string(),
  severity: z.enum(["critical", "moderate", "minor"]),
});

export type Deviation = z.infer<typeof DeviationSchema>;

export const SlideSequenceResultSchema = z.object({
  analyzer_version: z.string(),
  executed_at: z.string().datetime(),

  ...AnalyzerMetaSchema.shape,
  debug_scoring: DebugScoringTraceSchema.optional(),
  
  score: z.number().min(0).max(100).nullable(),
  notes: z.array(z.string()).optional(),
  pattern_match: z.string(),
  sequence_detected: z.array(z.string()),
  expected_sequence: z.array(z.string()),
  deviations: z.array(DeviationSchema),
  
  evidence_ids: z.array(z.string().uuid()),
});

export type SlideSequenceResult = z.infer<typeof SlideSequenceResultSchema>;

// Metric Benchmark Validator
export const MetricValidationSchema = z.object({
  metric: z.string(),
  value: z.number(),
  benchmark_value: z.number(),
  benchmark_source: z.string(),
  
  rating: z.enum(["Strong", "Adequate", "Weak", "Missing"]),
  deviation_pct: z.number(),
  
  evidence_id: z.string().uuid(),
});

export type MetricValidation = z.infer<typeof MetricValidationSchema>;

export const MetricBenchmarkResultSchema = z.object({
  analyzer_version: z.string(),
  executed_at: z.string().datetime(),

  ...AnalyzerMetaSchema.shape,
  debug_scoring: DebugScoringTraceSchema.optional(),
  
  metrics_analyzed: z.array(MetricValidationSchema),
  overall_score: z.number().min(0).max(100).nullable(),

  note: z.string().optional(),
  
  evidence_ids: z.array(z.string().uuid()),
});

export type MetricBenchmarkResult = z.infer<typeof MetricBenchmarkResultSchema>;

// Visual Design Scorer
export const VisualDesignResultSchema = z.object({
  analyzer_version: z.string(),
  executed_at: z.string().datetime(),

  ...AnalyzerMetaSchema.shape,
  debug_scoring: DebugScoringTraceSchema.optional(),
  
  design_score: z.number().min(0).max(100).nullable(),
  
  proxy_signals: z.object({
    page_count_appropriate: z.boolean(),
    image_to_text_ratio_balanced: z.boolean(),
    consistent_formatting: z.boolean(),
  }),
  
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  
  evidence_ids: z.array(z.string().uuid()),
  
  note: z.string().default("Using proxy heuristics - full visual analysis requires layout extraction"),
});

export type VisualDesignResult = z.infer<typeof VisualDesignResultSchema>;

// Narrative Arc Detector
export const EmotionalBeatSchema = z.object({
  section: z.string(),
  emotion: z.enum(["urgency", "hope", "credibility", "excitement"]),
  strength: z.number().min(0).max(1),
});

export type EmotionalBeat = z.infer<typeof EmotionalBeatSchema>;

export const NarrativeArcResultSchema = z.object({
  analyzer_version: z.string(),
  executed_at: z.string().datetime(),

  ...AnalyzerMetaSchema.shape,
  debug_scoring: DebugScoringTraceSchema.optional(),
  
  archetype: z.string(),
  archetype_confidence: z.number().min(0).max(1),
  
  pacing_score: z.number().min(0).max(100).nullable(),
  emotional_beats: z.array(EmotionalBeatSchema),
  
  evidence_ids: z.array(z.string().uuid()),
});

export type NarrativeArcResult = z.infer<typeof NarrativeArcResultSchema>;

// Financial Health Calculator
export const FinancialRiskSchema = z.object({
  category: z.enum(["runway", "burn", "growth", "unit_economics"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  description: z.string(),
  evidence_id: z.string().uuid(),
});

export type FinancialRisk = z.infer<typeof FinancialRiskSchema>;

export const FinancialHealthResultSchema = z.object({
  analyzer_version: z.string(),
  executed_at: z.string().datetime(),

  ...AnalyzerMetaSchema.shape,
  debug_scoring: DebugScoringTraceSchema.optional(),
  
  runway_months: z.number().nullable(),
  burn_multiple: z.number().nullable(),
  health_score: z.number().min(0).max(100).nullable(),
  
  metrics: z.object({
    revenue: z.number().nullable(),
    expenses: z.number().nullable(),
    cash_balance: z.number().nullable(),
    burn_rate: z.number().nullable(),
    growth_rate: z.number().nullable(),
  }),
  
  risks: z.array(FinancialRiskSchema),
  
  evidence_ids: z.array(z.string().uuid()),
});

export type FinancialHealthResult = z.infer<typeof FinancialHealthResultSchema>;

// Risk Assessment Engine
export const RiskSchema = z.object({
  risk_id: z.string().uuid(),
  category: z.enum(["market", "team", "financial", "execution"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  description: z.string(),
  mitigation: z.string().optional(),
  evidence_id: z.string().uuid(),
});

export type Risk = z.infer<typeof RiskSchema>;

export const RiskAssessmentResultSchema = z.object({
  analyzer_version: z.string(),
  executed_at: z.string().datetime(),

  ...AnalyzerMetaSchema.shape,
  debug_scoring: DebugScoringTraceSchema.optional(),
  
  overall_risk_score: z.number().min(0).max(100).nullable(),
  
  risks_by_category: z.object({
    market: z.array(RiskSchema),
    team: z.array(RiskSchema),
    financial: z.array(RiskSchema),
    execution: z.array(RiskSchema),
  }),
  
  total_risks: z.number().int().nonnegative(),
  critical_count: z.number().int().nonnegative(),
  high_count: z.number().int().nonnegative(),

  note: z.string().optional(),
  
  evidence_ids: z.array(z.string().uuid()),
});

export type RiskAssessmentResult = z.infer<typeof RiskAssessmentResultSchema>;

// Combined Analyzer Results
export const AnalyzerResultsSchema = z.object({
  slide_sequence: SlideSequenceResultSchema,
  metric_benchmark: MetricBenchmarkResultSchema,
  visual_design: VisualDesignResultSchema,
  narrative_arc: NarrativeArcResultSchema,
  financial_health: FinancialHealthResultSchema,
  risk_assessment: RiskAssessmentResultSchema,
});

export type AnalyzerResults = z.infer<typeof AnalyzerResultsSchema>;

// ============================================================================
// HRM-DD Artifacts (from SOP)
// ============================================================================

export const PlannerStateSchema = z.object({
  cycle: z.number().int().nonnegative(),
  goals: z.array(z.string()),
  constraints: z.array(z.string()),
  hypotheses: z.array(z.string()),
  subgoals: z.array(z.string()),
  focus: z.string(),
  stop_reason: z.enum(["depth_converged", "max_cycles", "error"]).nullable(),
});

export type PlannerState = z.infer<typeof PlannerStateSchema>;

export const FactRowSchema = z.object({
  id: z.string().uuid(),
  claim: z.string().max(200),
  source: z.string(),
  page: z.union([z.number(), z.string()]),
  confidence: z.number().min(0).max(1),
  created_cycle: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  evidence_id: z.string().uuid(),
});

export type FactRow = z.infer<typeof FactRowSchema>;

export const LedgerManifestSchema = z.object({
  cycles: z.number().int().nonnegative(),
  depth_delta: z.array(z.number().int()),
  subgoals: z.number().int().nonnegative(),
  constraints: z.number().int().nonnegative(),
  dead_ends: z.number().int().nonnegative(),
  paraphrase_invariance: z.number().min(0).max(1),
  calibration: z.object({
    brier: z.number(),
  }),
  total_facts_added: z.number().int().nonnegative(),
  total_evidence_cited: z.number().int().nonnegative(),
  uncertain_claims: z.number().int().nonnegative(),
});

export type LedgerManifest = z.infer<typeof LedgerManifestSchema>;

// ============================================================================
// Investment Decision
// ============================================================================

export const MilestoneSchema = z.object({
  name: z.string(),
  description: z.string(),
  target_date: z.string().datetime().nullable(),
  amount: z.number().nullable(),
  conditions: z.array(z.string()),
});

export type Milestone = z.infer<typeof MilestoneSchema>;

export const TranchePlanSchema = z.object({
  t0_amount: z.number().nullable(),
  milestones: z.array(MilestoneSchema),
});

export type TranchePlan = z.infer<typeof TranchePlanSchema>;

export const InvestmentDecisionSchema = z.object({
  recommendation: z.enum(["GO", "NO-GO", "CONDITIONAL"]),
  confidence: z.number().min(0).max(1),
  
  tranche_plan: TranchePlanSchema,
  verification_checklist: z.array(z.string()),
  
  key_strengths: z.array(z.string()),
  key_weaknesses: z.array(z.string()),
  
  evidence_ids: z.array(z.string().uuid()),
});

export type InvestmentDecision = z.infer<typeof InvestmentDecisionSchema>;

// ============================================================================
// LLM Narrative Synthesis
// ============================================================================

export const TokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  estimated_cost: z.number().nonnegative(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const NarrativeSynthesisSchema = z.object({
  llm_version: z.string(),
  generated_at: z.string().datetime(),
  token_usage: TokenUsageSchema,
  
  executive_summary: z.string(),
  market_narrative: z.string().optional(),
  team_narrative: z.string().optional(),
  financial_narrative: z.string().optional(),
  
  coherence_score: z.number().min(0).max(1).nullable(),
});

export type NarrativeSynthesis = z.infer<typeof NarrativeSynthesisSchema>;

// ============================================================================
// Execution Metadata (Audit Trail)
// ============================================================================

export const MCPCallLogSchema = z.object({
  tool_name: z.string(),
  called_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
});

export type MCPCallLog = z.infer<typeof MCPCallLogSchema>;

export const TavilySearchLogSchema = z.object({
  query: z.string(),
  called_at: z.string().datetime(),
  results_count: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
});

export type TavilySearchLog = z.infer<typeof TavilySearchLogSchema>;

export const LLMCallLogSchema = z.object({
  purpose: z.enum(["query_generation", "narrative_synthesis", "edge_case"]),
  called_at: z.string().datetime(),
  token_usage: TokenUsageSchema,
  duration_ms: z.number().int().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
});

export type LLMCallLog = z.infer<typeof LLMCallLogSchema>;

export const ExecutionErrorSchema = z.object({
  timestamp: z.string().datetime(),
  component: z.string(),
  error_code: z.string(),
  message: z.string(),
  stack_trace: z.string().optional(),
});

export type ExecutionError = z.infer<typeof ExecutionErrorSchema>;

export const ExecutionWarningSchema = z.object({
  timestamp: z.string().datetime(),
  component: z.string(),
  warning_code: z.string(),
  message: z.string(),
});

export type ExecutionWarning = z.infer<typeof ExecutionWarningSchema>;

export const ExecutionMetadataSchema = z.object({
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  
  worker_version: z.string(),
  environment: z.enum(["development", "staging", "production"]),
  
  dependencies: z.object({
    mcp_calls: z.array(MCPCallLogSchema),
    tavily_searches: z.array(TavilySearchLogSchema),
    llm_calls: z.array(LLMCallLogSchema),
  }),
  
  errors: z.array(ExecutionErrorSchema),
  warnings: z.array(ExecutionWarningSchema),
  
  performance: z.object({
    document_load_ms: z.number().int().nonnegative(),
    analyzer_total_ms: z.number().int().nonnegative(),
    mcp_total_ms: z.number().int().nonnegative(),
    tavily_total_ms: z.number().int().nonnegative(),
    llm_total_ms: z.number().int().nonnegative(),
  }),
});

export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;

// ============================================================================
// Derived Context (Lightweight Pre-Analyzer Classification)
// ============================================================================

export const DIOContextSchema = z.object({
  primary_doc_type: z.enum([
    "pitch_deck",
    "exec_summary",
    "one_pager",
    "business_plan_im",
    "financials",
    "other",
  ]),
  deal_type: z.enum([
    "startup_raise",
    "fund_spv",
    "holdco_platform",
    "services",
    "consumer_product",
    "crypto_mining",
    "other",
  ]),
  vertical: z.enum([
    "saas",
    "fintech",
    "healthcare",
    "consumer",
    "energy",
    "services",
    "crypto",
    "other",
  ]),
  stage: z.enum(["idea", "pre_seed", "seed", "growth", "mature", "fund_ops", "unknown"]),
  confidence: z.number().min(0).max(1),
});

export type DIOContext = z.infer<typeof DIOContextSchema>;

// ============================================================================
// Deal Intelligence Object (Top-Level)
// ============================================================================

export const DealIntelligenceObjectSchema = z.object({
  // Metadata
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/).default(SCHEMA_VERSION),
  dio_id: z.string().uuid(),
  deal_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  analysis_version: z.number().int().positive(),

  // Derived context (computed before analyzers run)
  dio_context: DIOContextSchema.optional(),
  
  // Input snapshot
  inputs: AnalysisInputsSchema,
  
  // Analyzer results
  analyzer_results: AnalyzerResultsSchema,
  
  // HRM-DD artifacts
  planner_state: PlannerStateSchema,
  fact_table: z.array(FactRowSchema),
  ledger_manifest: LedgerManifestSchema,
  
  // Risks & decision
  risk_map: z.array(RiskSchema),
  decision: InvestmentDecisionSchema,
  
  // LLM narrative
  narrative: NarrativeSynthesisSchema,
  
  // Audit trail
  execution_metadata: ExecutionMetadataSchema,
});

export type DealIntelligenceObject = z.infer<typeof DealIntelligenceObjectSchema>;

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_PLANNER_STATE: PlannerState = {
  cycle: 0,
  goals: [
    "Validate market & problem",
    "Verify predictive validity",
    "Quantify monetization realism",
    "Team/competition assessment",
  ],
  constraints: ["deck-facts-only", "cite-or-uncertain"],
  hypotheses: [],
  subgoals: [],
  focus: "",
  stop_reason: null,
};

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  analyzer_versions: {
    slide_sequence: "1.0.0",
    metric_benchmark: "1.0.0",
    visual_design: "1.0.0",
    narrative_arc: "1.0.0",
    financial_health: "1.0.0",
    risk_assessment: "1.0.0",
  },
  features: {
    tavily_enabled: false,
    mcp_enabled: true,
    llm_synthesis_enabled: true,
    debug_scoring: false,
  },
  parameters: {
    max_cycles: 3,
    depth_threshold: 2,
    min_confidence: 0.7,
  },
};

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateDIO(data: unknown): DealIntelligenceObject {
  return DealIntelligenceObjectSchema.parse(data);
}

export function validateAnalyzerResults(data: unknown): AnalyzerResults {
  return AnalyzerResultsSchema.parse(data);
}

export function validatePlannerState(data: unknown): PlannerState {
  return PlannerStateSchema.parse(data);
}

export function isValidDIO(data: unknown): data is DealIntelligenceObject {
  return DealIntelligenceObjectSchema.safeParse(data).success;
}
