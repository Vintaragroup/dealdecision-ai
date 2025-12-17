/**
 * Analysis Cycle Types
 * Orchestration and state management for multi-cycle reasoning
 */

import type {
  AnalysisCycleInput,
  AnalysisCycleResult,
  PlannerState,
  FactRow,
  WorkerDiff,
  Hypothesis,
  Uncertainty,
  BindingConstraint,
  Citation
} from "./hrmdd";

// Re-export for convenience when importing from analysis.ts
export type { AnalysisCycleResult };

/**
 * Cycle type (1, 2, or 3)
 */
export type CycleType = 1 | 2 | 3;

/**
 * Cycle focus area
 */
export type CycleFocus = "broad_scan" | "deep_dive" | "synthesis";

/**
 * Analysis mode (full or targeted)
 */
export type AnalysisMode = "full" | "targeted" | "verification";

/**
 * Quality assessment for stopping analysis
 */
export interface DepthAssessment {
  has_key_questions: boolean;
  uncertainty_mapped: boolean;
  binding_constraints_clear: boolean;
  evidence_coverage_adequate: boolean;
  paraphrase_consistency: number; // 0-1
  depth_metric: number; // 0-10 scale
  should_continue: boolean;
  reasoning: string;
}

/**
 * Cycle configuration
 */
export interface CycleConfig {
  cycle_number: CycleType;
  focus: CycleFocus;
  max_facts_per_cycle: number;
  confidence_threshold: number;
  llm_model: string; // e.g., "gpt-4", "claude-3-opus"
  temperature: number;
  timeout_seconds: number;
}

/**
 * Per-cycle goal specification
 */
export interface CycleGoal {
  cycle: CycleType;
  primary_objective: string;
  secondary_objectives: string[];
  success_criteria: string[];
  key_metrics: string[];
  stop_condition: string;
}

/**
 * Cycle execution context
 */
export interface CycleContext {
  deal_id: string;
  cycle_number: CycleType;
  config: CycleConfig;
  planner_state: PlannerState;
  prior_facts: FactRow[];
  prior_hypotheses: Hypothesis[];
  prior_uncertainties: Uncertainty[];
  prior_constraints: BindingConstraint[];
  deal_materials: {
    deck_text: string;
    document_texts: string[];
    metadata: Record<string, any>;
  };
  citations_allowed: Citation[];
  started_at: string;
}

/**
 * Individual finding from analysis
 */
export interface Finding {
  id: string;
  type: "hypothesis" | "uncertainty" | "constraint" | "fact" | "risk";
  statement: string;
  supporting_evidence: string[];
  citations: Citation[];
  confidence: number;
  status: "new" | "refined" | "resolved";
}

/**
 * Analysis worker output
 */
export interface WorkerOutput {
  worker_id: string;
  analysis_text: string;
  findings: Finding[];
  facts: FactRow[];
  evidence: Array<{ quote: string; page: string | number; source: string }>;
  errors: string[];
  metrics: {
    processing_time_ms: number;
    facts_extracted: number;
    citations_count: number;
    confidence_average: number;
  };
}

/**
 * Cycle state transition
 */
export interface CycleTransition {
  from_cycle: CycleType | null;
  to_cycle: CycleType;
  reason: string;
  planner_state_update: Partial<PlannerState>;
  facts_added: FactRow[];
  metrics: {
    depth_delta: number;
    findings_count: number;
    uncertainty_reduction: number;
  };
}

/**
 * Complete cycle execution result
 */
export interface CycleExecutionResult {
  cycle_number: CycleType;
  status: "success" | "failure" | "timeout" | "partial";
  duration_ms: number;
  worker_output: WorkerOutput;
  depth_assessment: DepthAssessment;
  findings: Finding[];
  updated_facts: FactRow[];
  updated_planner_state: PlannerState;
  next_cycle_recommendation: CycleType | "synthesize" | "stop";
  error?: string;
  warning?: string;
}

/**
 * Analysis flow state machine
 */
export interface AnalysisFlowState {
  deal_id: string;
  current_cycle: CycleType | null;
  completed_cycles: CycleType[];
  total_facts: FactRow[];
  total_findings: Finding[];
  planner_state: PlannerState;
  transitions: CycleTransition[];
  quality_metrics: {
    overall_depth: number;
    citation_compliance: number;
    paraphrase_invariance: number;
  };
  should_stop: boolean;
  stop_reason?: string;
}

/**
 * Analysis execution parameters
 */
export interface AnalysisExecutionParams {
  deal_id: string;
  max_cycles: number; // Limit cycles to prevent infinite loops
  max_duration_seconds: number;
  min_confidence: number; // Minimum confidence to accept facts
  require_citations: boolean;
  parallel_workers: number;
  llm_config: {
    model: string;
    temperature: number;
    max_tokens: number;
  };
}

/**
 * Cycle 1 specific output: Broad Scan
 */
export interface Cycle1Output {
  hypotheses: Hypothesis[];
  uncertainties: Uncertainty[];
  initial_binding_constraints: BindingConstraint[];
  depth_delta: number;
  reasoning_for_depth: string;
}

/**
 * Cycle 2 specific output: Deep Dive
 */
export interface Cycle2Output {
  uncertainty_resolution: Array<{
    uncertainty: string;
    evidence_gathered: string;
    determination: "supportive" | "concerning" | "inconclusive";
    citations: Citation[];
  }>;
  hypothesis_testing: Array<{
    hypothesis: string;
    test_result: "supported" | "contradicted" | "inconclusive";
    evidence: string;
  }>;
  binding_constraints: BindingConstraint[];
  depth_delta: number;
  reasoning_for_depth: string;
}

/**
 * Cycle 3 specific output: Synthesis
 */
export interface Cycle3Output {
  executive_summary: string;
  go_no_go_recommendation: "GO" | "NO-GO" | "CONDITIONAL";
  key_binding_constraints: BindingConstraint[];
  risk_summary: Array<{
    risk: string;
    severity: "critical" | "high" | "medium" | "low";
    mitigation: string;
  }>;
  next_steps: string[];
  calibration_metrics: Record<string, number>;
}

/**
 * Prompt template variables
 */
export interface PromptVariables {
  deal_name: string;
  deck_excerpt: string;
  prior_hypotheses: string[];
  prior_uncertainties: string[];
  prior_facts: string[];
  cycle_number: number;
  cycle_focus: string;
}

/**
 * Paraphrase variance test input/output
 */
export interface ParaphraseVarianceTest {
  original_prompt: string;
  paraphrases: string[]; // 2-3 different ways to ask same question
  responses: string[]; // Responses to each paraphrase
  variance_score: number; // 0-1, where 1 = perfectly consistent
  inconsistencies: string[];
  overall_confidence: number;
}
