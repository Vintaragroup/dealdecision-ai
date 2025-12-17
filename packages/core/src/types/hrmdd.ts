/**
 * HRM-DD: Hierarchical Reasoning Model for Due Diligence
 * Complete type definitions for the multi-cycle analysis system
 * Based on: HRM-DD SOP v2.0 (December 2025)
 */

/**
 * FactRow: Atomic evidence unit
 * Represents a single verifiable claim with provenance
 */
export interface FactRow {
  id: string; // UUID
  claim: string; // Falsifiable statement (max 200 chars)
  source: "deck.pdf" | string; // Must be deck.pdf, URL, or "uncertain"
  page: number | string;
  confidence: number; // 0.0-1.0 (used for calibration scoring)
  created_cycle: number; // Which cycle this fact was added
}

/**
 * PlannerState: H-module persistent memory
 * Tracks goals, constraints, hypotheses, and progress across cycles
 */
export interface PlannerState {
  cycle: number;
  goals: string[]; // Investment evaluation objectives
  constraints: string[]; // Rules (e.g., "deck-facts-only", "cite-or-uncertain")
  hypotheses: string[]; // High-level testable assumptions
  subgoals: string[]; // Derived questions to address
  focus: string; // Current investigation priority
  stop_reason: string | null; // Why analysis stopped
}

/**
 * Evidence: Extracted fact with source attribution
 */
export interface Evidence {
  quote: string; // Direct quote from source
  page: string | number;
  source: string; // Document name or URL
}

/**
 * WorkerDiff: Delta output from one analysis burst
 * Represents the incremental result of a single worker's analysis pass
 */
export interface WorkerDiff {
  worker_id: string; // Identifier for the analysis worker/cycle
  result: string; // Text result of analysis
  evidence: Evidence[]; // Supporting quotes and citations
  errors: string[]; // Errors encountered
  new_candidates: string[]; // New hypotheses/findings to investigate
  facts_added: FactRow[]; // Facts extracted in this pass
  confidence_updates: Record<string, number>; // fact_id -> new_confidence
}

/**
 * CalibrateMetrics: Quality assessment for confidence scoring
 */
export interface CalibrateMetrics {
  brier: number; // Brier score (0-1, lower is better)
  paraphrase_invariance: number; // Consistency across rephrased prompts (0-1)
  citation_compliance: number; // Percentage of claims with citations
}

/**
 * LedgerManifest: Audit scoreboard
 * Tracks analysis depth, activity, and quality metrics
 */
export interface LedgerManifest {
  cycles: number; // Number of analysis cycles completed
  depth_delta: number[]; // Depth progression per cycle
  subgoals: number; // Total subgoals addressed
  constraints: number; // Total constraints checked
  dead_ends: number; // Hypotheses disproven
  paraphrase_invariance: number; // Overall consistency (0-1)
  calibration: Record<string, number>; // Calibration metrics (e.g., brier score)
}

/**
 * RiskItem: Individual risk with severity and mitigation
 */
export interface RiskItem {
  risk: string; // Risk description
  severity: "critical" | "high" | "medium" | "low";
  mitigation: string; // Proposed risk mitigation
  evidence: string; // Supporting evidence
}

/**
 * TrancheGate: Investment gating condition
 */
export interface TrancheGate {
  tranche: string; // T0, M1, M2, M3, etc.
  condition: string; // What must be verified
  trigger: string; // What triggers this gate
}

/**
 * DecisionPack: Final deliverable from HRM-DD analysis
 * Complete analysis result with reasoning audit trail
 */
export interface DecisionPack {
  executive_summary: string; // ≤1 page summary
  go_no_go: "GO" | "NO-GO" | "CONDITIONAL"; // Investment recommendation
  tranche_plan: TrancheGate[]; // T0 + M1/M2/M3 gates
  risk_map: RiskItem[]; // Identified risks with severity
  what_to_verify: string[]; // Next steps / verification checklist
  calibration_audit: Record<string, number>; // Quality metrics
  paraphrase_invariance: number; // Consistency score
  ledger: LedgerManifest; // Analysis activity audit log
  fact_table: FactRow[]; // All extracted facts
}

/**
 * AnalysisCycleInput: Parameters for starting analysis cycle
 */
export interface AnalysisCycleInput {
  deal_id: string;
  cycle_number: number;
  planner_state: PlannerState;
  prior_facts: FactRow[];
  prior_uncertainties: string[];
  deal_materials_text: string; // Combined deck + docs text
}

/**
 * AnalysisCycleResult: Output from one complete cycle
 */
export interface AnalysisCycleResult {
  cycle_number: number;
  worker_diff: WorkerDiff;
  updated_planner_state: PlannerState;
  depth_delta: number; // Metric indicating need for further cycles
  findings: string[]; // Key findings from this cycle
  should_continue: boolean; // Recommendation: continue to next cycle?
}

/**
 * HRMDDJob: Queue job payload for analysis
 */
export interface HRMDDJob {
  deal_id: string;
  job_type: "run_analysis" | "fetch_evidence" | "synthesize_report";
  max_cycles: number; // Cycle limit
  payload?: Record<string, any>;
}

/**
 * HRMDDJobResult: Completion result from analysis job
 */
export interface HRMDDJobResult {
  deal_id: string;
  status: "success" | "failure" | "partial";
  cycles_completed: number;
  decision_pack?: DecisionPack;
  error?: string;
  ledger: LedgerManifest;
}

/**
 * Citation: Structured citation reference
 */
export interface Citation {
  claim: string;
  source: string;
  page?: string | number;
  confidence: number;
  fact_id: string;
}

/**
 * Hypothesis: Testable investment hypothesis
 */
export interface Hypothesis {
  statement: string;
  supporting_evidence: string[];
  citations: Citation[];
  status: "testing" | "supported" | "contradicted" | "inconclusive";
  pressure_test_result?: string;
}

/**
 * Uncertainty: Information gap requiring investigation
 */
export interface Uncertainty {
  question: string;
  importance: "critical" | "high" | "medium" | "low";
  investigation_path: string;
  resolved: boolean;
  resolution?: string;
}

/**
 * BindingConstraint: Must-be-true condition for investment success
 */
export interface BindingConstraint {
  constraint: string;
  evidence_for: string;
  evidence_against: string;
  assessment: string;
  risk_if_false: string;
}

/**
 * CycleOutput: Structured output from analysis cycle
 */
export interface CycleOutput {
  hypotheses?: Hypothesis[];
  uncertainties?: Uncertainty[];
  initial_binding_constraints?: BindingConstraint[];
  uncertainty_resolution?: Array<{
    uncertainty: string;
    evidence_gathered: string;
    determination: "supportive" | "concerning" | "inconclusive";
    citations: Citation[];
  }>;
  hypothesis_testing?: Array<{
    hypothesis: string;
    test_result: string;
    evidence: string;
  }>;
  binding_constraints?: BindingConstraint[];
  depth_delta: number;
  reasoning_for_depth: string;
}

/**
 * DealAnalysisState: Complete state for a deal under analysis
 */
export interface DealAnalysisState {
  deal_id: string;
  current_cycle: number;
  planner_state: PlannerState;
  fact_table: FactRow[];
  cycle_outputs: CycleOutput[];
  ledger: LedgerManifest;
  decision_pack?: DecisionPack;
  created_at: string;
  updated_at: string;
}
