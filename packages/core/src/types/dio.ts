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
// Phase 1 UI-usability contract (V1)
// ============================================================================

export const Phase1ConfidenceBandSchema = z.enum(["low", "med", "high"]);
export type Phase1ConfidenceBand = z.infer<typeof Phase1ConfidenceBandSchema>;

export const Phase1ExecutiveSummaryEvidenceRefV1Schema = z.object({
  claim_id: z.string().min(1),
  document_id: z.string().min(1),
  page: z.number().int().positive().optional(),
  page_range: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  snippet: z.string().optional(),
});

export const Phase1ExecutiveSummaryV1Schema = z.object({
  title: z.string(),
  one_liner: z.string(),
  deal_type: z.string(),
  raise: z.string(),
  business_model: z.string(),
  traction_signals: z.array(z.string()),
  key_risks_detected: z.array(z.string()),
  unknowns: z.array(z.string()),
  confidence: z.object({
    overall: Phase1ConfidenceBandSchema,
    sections: z.record(Phase1ConfidenceBandSchema).optional(),
  }),
  evidence: z.array(Phase1ExecutiveSummaryEvidenceRefV1Schema),
});

export type Phase1ExecutiveSummaryV1 = z.infer<typeof Phase1ExecutiveSummaryV1Schema>;

export const Phase1ClaimCategoryV1Schema = z.enum([
  "product",
  "market",
  "traction",
  "terms",
  "team",
  "risk",
  "other",
]);

export const Phase1ClaimEvidenceV1Schema = z.object({
  document_id: z.string().min(1),
  page: z.number().int().positive().optional(),
  page_range: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  snippet: z.string().min(1),
});

export const Phase1ClaimV1Schema = z.object({
  claim_id: z.string().min(1),
  category: Phase1ClaimCategoryV1Schema,
  text: z.string().min(1),
  evidence: z.array(Phase1ClaimEvidenceV1Schema),
});

export const Phase1CoverageV1Schema = z.object({
  sections: z.record(z.enum(["present", "partial", "missing"])),
});

export const Phase1DecisionRecommendationV1Schema = z.enum(["PASS", "CONSIDER", "GO"]);
export type Phase1DecisionRecommendationV1 = z.infer<typeof Phase1DecisionRecommendationV1Schema>;

export const Phase1DecisionSummaryV1Schema = z.object({
  score: z.number().min(0).max(100),
  recommendation: Phase1DecisionRecommendationV1Schema,
  reasons: z.array(z.string()),
  blockers: z.array(z.string()),
  next_requests: z.array(z.string()),
  confidence: Phase1ConfidenceBandSchema,
});

export type Phase1DecisionSummaryV1 = z.infer<typeof Phase1DecisionSummaryV1Schema>;

export const Phase1DIOV1Schema = z.object({
  executive_summary_v1: Phase1ExecutiveSummaryV1Schema,
  decision_summary_v1: Phase1DecisionSummaryV1Schema,
  claims: z.array(Phase1ClaimV1Schema),
  coverage: Phase1CoverageV1Schema,

  // Additive: deterministic business archetype classification (worker-provided).
  business_archetype_v1: z
    .object({
      value: z.string().min(1),
      confidence: z.number().min(0).max(1),
      generated_at: z.string().datetime().optional(),
      evidence: z
        .array(
          z.object({
            document_id: z.string().min(1),
            page_range: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
            snippet: z.string().min(1),
            rule: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),

  // Additive: worker-computed canonical overview for Phase 1 (V2).
  // This is the preferred single source for executive-summary one-liner composition.
  deal_overview_v2: z
    .object({
      deal_name: z.string().optional(),
      product_solution: z.string().optional(),
      market_icp: z.string().optional(),
      deal_type: z.string().optional(),
      raise: z.string().optional(),
      business_model: z.string().optional(),
      traction_signals: z.array(z.string()).optional(),
      key_risks_detected: z.array(z.string()).optional(),
      generated_at: z.string().datetime().optional(),
      sources: z
        .array(
          z.object({
            document_id: z.string().min(1),
            page_range: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
            note: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),

  // Additive: diff summary between the latest stored DIO and the current run.
  update_report_v1: z
    .object({
      generated_at: z.string().datetime(),
	  previous_dio_found: z.boolean().optional(),
      since_dio_id: z.string().uuid().optional(),
      since_version: z.number().int().positive().optional(),
	  docs_fingerprint: z.string().min(1).optional(),
	  previous_docs_fingerprint: z.string().min(1).optional(),
      changes: z
        .array(
          z.object({
            field: z.string().min(1),
            change_type: z.enum(["added", "updated", "removed"]),
			category: z
			  .enum([
				"field_populated",
				"field_lost",
				"field_updated",
				"coverage_changed",
				"decision_changed",
				"confidence_changed",
				"docs_changed",
			  ])
			  .optional(),
            before: z.string().optional(),
            after: z.string().optional(),
          })
        )
        .default([]),
	  summary: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// Deal Classification (V1)
// ============================================================================

export const DealAssetClassSchema = z.enum([
  "operating_company",
  "real_estate",
  "fund_vehicle",
  "credit",
  "infrastructure_project",
  "structured_product",
  "other",
  "unknown",
]);

export type DealAssetClass = z.infer<typeof DealAssetClassSchema>;

export const DealClassificationSchema = z.object({
  asset_class: DealAssetClassSchema,
  deal_structure: z.string().min(1),
  strategy_subtype: z.string().min(1).nullable().optional(),
  // Additive (classification upgrade): explicit policy id for this candidate.
  // Optional to preserve backward compatibility with stored legacy DIOs.
  policy_id: z.string().min(1).optional(),
  // Additive (classification upgrade): raw candidate score (0..1) prior to confidence heuristics.
  // Optional to preserve backward compatibility.
  score: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()),
});

export type DealClassification = z.infer<typeof DealClassificationSchema>;

export const DealClassificationResultSchema = z.object({
  candidates: z.array(DealClassificationSchema).max(5),
  selected: DealClassificationSchema,
  // Additive (classification upgrade): broad domain policy derived from domain-first routing.
  // Optional to preserve backward compatibility.
  domain_policy_id: z.string().min(1).optional(),
  selected_policy: z.string().min(1),
  routing_reason: z.array(z.string()),
});

export type DealClassificationResult = z.infer<typeof DealClassificationResultSchema>;

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
  policy_id: z.string().optional(),
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
  // Additive: allow risk assessment to scan full document text and evidence text.
  documents: z.array(z.object({
    full_text: z.string().optional(),
  })).optional(),
  evidence: z.array(z.object({
    text: z.string().optional(),
  })).optional(),
  // Additive: policy-aware risk reducers (e.g., real_estate_underwriting).
  policy_id: z.string().optional(),
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
// Scoring Diagnostics (V1) - persisted, UI-ready explainability
// ============================================================================

export const ScoringDiagnosticsBucketItemV1Schema = z.object({
  component: z.string().min(1),
  text: z.string().min(1),
  evidence_ids: z.array(z.string()).default([]),
});

export type ScoringDiagnosticsBucketItemV1 = z.infer<typeof ScoringDiagnosticsBucketItemV1Schema>;

export const ScoringDiagnosticsComponentV1Schema = z.object({
  status: z.string().min(1),
  raw_score: z.number().min(0).max(100).nullable(),
  used_score: z.number().min(0).max(100).nullable(),
  weight: z.number(),
  confidence: z.number().min(0).max(1).nullable(),
  reason: z.string().min(1),
  reasons: z.array(z.string()).default([]),
  evidence_ids: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  red_flags: z.array(z.string()).default([]),
});

export type ScoringDiagnosticsComponentV1 = z.infer<typeof ScoringDiagnosticsComponentV1Schema>;

export const ScoringDiagnosticsV1Schema = z.object({
  policy_id: z.string().nullable(),
  overall_score: z.number(),
  unadjusted_overall_score: z.number(),
  adjustment_factor: z.number(),
  evidence_factor: z.number(),
  due_diligence_factor: z.number(),
  coverage_ratio: z.number(),
  components: z.record(ScoringDiagnosticsComponentV1Schema),
  buckets: z.object({
    positive_signals: z.array(ScoringDiagnosticsBucketItemV1Schema).default([]),
    red_flags: z.array(ScoringDiagnosticsBucketItemV1Schema).default([]),
    coverage_gaps: z.array(ScoringDiagnosticsBucketItemV1Schema).default([]),
  }),
  // Additive: policy-specific rubric checks used to interpret “75+” consistently by deal class.
  rubric: z
    .object({
      id: z.string().min(1),
      required_signals: z.array(z.string()).default([]),
      missing_required: z.array(z.string()).default([]),
      positive_drivers_present: z.array(z.string()).default([]),
      acceptable_missing_present: z.array(z.string()).default([]),
      red_flags_triggered: z.array(z.string()).default([]),
      has_revenue_metric: z.boolean().optional(),
      score_cap_applied: z.number().min(0).max(100).nullable().optional(),
    })
    .optional(),
});

export type ScoringDiagnosticsV1 = z.infer<typeof ScoringDiagnosticsV1Schema>;

// ============================================================================
// Fundability System (Analysis Foundation) — Additive Outputs (V1)
// ============================================================================

export const CompanyPhaseSchema = z.enum([
  "IDEA",
  "PRE_SEED",
  "SEED",
  "SEED_PLUS",
  "SERIES_A",
  "SERIES_B",
]);

export type CompanyPhase = z.infer<typeof CompanyPhaseSchema>;

export const PhaseInferenceV1Schema = z.object({
  company_phase: CompanyPhaseSchema,
  confidence: z.number().min(0).max(1),
  supporting_evidence: z
    .array(
      z.object({
        signal: z.string().min(1),
        source: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .default([]),
  missing_evidence: z.array(z.string()).default([]),
  rationale: z.array(z.string()).default([]),
});

export type PhaseInferenceV1 = z.infer<typeof PhaseInferenceV1Schema>;

export const FundabilityGateOutcomeSchema = z.enum(["PASS", "CONDITIONAL", "FAIL"]);
export type FundabilityGateOutcome = z.infer<typeof FundabilityGateOutcomeSchema>;

export const FundabilityAssessmentV1Schema = z.object({
  outcome: FundabilityGateOutcomeSchema,
  reasons: z.array(z.string()).default([]),
  // Phase 2 (soft caps): legacy score remains unchanged; fundability score may be capped.
  legacy_overall_score_0_100: z.number().min(0).max(100).nullable().optional(),
  fundability_score_0_100: z.number().min(0).max(100).nullable().optional(),
  caps: z
    .object({
      max_fundability_score_0_100: z.number().min(0).max(100).optional(),
    })
    .optional(),
  // Optional guidance-only output (see analysis-foundation addendum).
  fundable_at_phase_if_downgraded: CompanyPhaseSchema.optional(),
});

export type FundabilityAssessmentV1 = z.infer<typeof FundabilityAssessmentV1Schema>;

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

  // UI usability addenda (Phase 1): always-on executive summary + claim→evidence mapping
  // Stored under `dio.phase1.*` to avoid clashing with existing top-level schema fields.
  dio: z
    .object({
      phase1: Phase1DIOV1Schema.optional(),
      deal_classification_v1: DealClassificationResultSchema.optional(),

      // Additive: authoritative spec versions used for decisioning.
      spec_versions: z
        .object({
          analysis_foundation: z.string().regex(/^\d+\.\d+\.\d+$/),
        })
        .optional(),

      // Additive: phase inference + fundability gates (shadow-mode in v1).
      phase_inference_v1: PhaseInferenceV1Schema.optional(),
      fundability_assessment_v1: FundabilityAssessmentV1Schema.optional(),
    })
    .optional(),
  
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

  // Additive: deterministic scoring diagnostics for UX/debugging (V1).
  // Optional for backward compatibility with older stored DIOs.
  scoring_diagnostics_v1: ScoringDiagnosticsV1Schema.optional(),
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
