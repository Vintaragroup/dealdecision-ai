/**
 * Cycle Analyzer Service
 * Orchestrates multi-cycle analysis flow
 * Manages cycle progression and depth assessment
 */

import type {
  AnalysisCycleResult,
  CycleExecutionResult,
  DepthAssessment,
  CycleType,
  Finding,
} from "../types/analysis";
import type { PlannerState, FactRow, DecisionPack } from "../types/hrmdd";
import {
  DEPTH_THRESHOLDS,
  CONFIDENCE_THRESHOLDS,
  StopReason,
} from "../types/validation";

/**
 * Assess depth of current cycle results
 */
export function assessDepth(
  findings: Finding[],
  facts: FactRow[],
  hasKeyQuestions: boolean,
  uncertaintyMapped: boolean,
  constraintsClear: boolean,
  evidenceCoverageAdequate: boolean,
  paraphraseConsistency: number
): DepthAssessment {
  let depthMetric = 0;

  // Metric 1: Finding count (0-3 points)
  if (findings.length >= 5) depthMetric += 3;
  else if (findings.length >= 3) depthMetric += 2;
  else if (findings.length >= 1) depthMetric += 1;

  // Metric 2: Fact extraction (0-2 points)
  if (facts.length >= 10) depthMetric += 2;
  else if (facts.length >= 5) depthMetric += 1;

  // Metric 3: Question coverage (0-2 points)
  if (hasKeyQuestions) depthMetric += 2;

  // Metric 4: Uncertainty mapping (0-2 points)
  if (uncertaintyMapped) depthMetric += 2;

  // Metric 5: Constraint clarity (0-1 point)
  if (constraintsClear) depthMetric += 1;

  // Metric 6: Evidence coverage (0-1 point)
  if (evidenceCoverageAdequate) depthMetric += 1;

  // Total normalized to 0-10 scale
  const normalizedDepth = (depthMetric / 11) * 10;

  const shouldContinue =
    !constraintsClear ||
    !evidenceCoverageAdequate ||
    paraphraseConsistency < 0.75;

  return {
    has_key_questions: hasKeyQuestions,
    uncertainty_mapped: uncertaintyMapped,
    binding_constraints_clear: constraintsClear,
    evidence_coverage_adequate: evidenceCoverageAdequate,
    paraphrase_consistency: paraphraseConsistency,
    depth_metric: Math.min(10, normalizedDepth),
    should_continue: shouldContinue,
    reasoning: generateDepthReasoning({
      has_key_questions: hasKeyQuestions,
      uncertainty_mapped: uncertaintyMapped,
      binding_constraints_clear: constraintsClear,
      evidence_coverage_adequate: evidenceCoverageAdequate,
      paraphrase_consistency: paraphraseConsistency,
      depth_metric: normalizedDepth,
    }),
  };
}

/**
 * Generate human-readable depth assessment reasoning
 */
function generateDepthReasoning(assessment: Partial<DepthAssessment>): string {
  const reasons: string[] = [];

  if (!assessment.has_key_questions) {
    reasons.push("Key questions not yet identified");
  }

  if (!assessment.uncertainty_mapped) {
    reasons.push("Uncertainty gaps not adequately mapped");
  }

  if (!assessment.binding_constraints_clear) {
    reasons.push("Binding constraints need clarification");
  }

  if (!assessment.evidence_coverage_adequate) {
    reasons.push("Evidence coverage insufficient");
  }

  if ((assessment.paraphrase_consistency ?? 1) < 0.75) {
    reasons.push("Paraphrase consistency needs improvement");
  }

  if (reasons.length === 0) {
    return "Depth adequate: all assessment criteria met";
  }

  return `Depth insufficient: ${reasons.join("; ")}`;
}

/**
 * Determine next cycle based on assessment
 */
export function determineNextCycle(
  currentCycle: CycleType,
  depthAssessment: DepthAssessment,
  depthThreshold: number = DEPTH_THRESHOLDS.CYCLE_1_CONTINUE
): CycleType | "synthesize" | "stop" {
  // Cycle 3 always produces synthesis
  if (currentCycle === 3) {
    return "synthesize";
  }

  // Check if depth is sufficient
  const depthSufficient = depthAssessment.depth_metric < depthThreshold;

  if (depthSufficient && !depthAssessment.should_continue) {
    return "synthesize";
  }

  // Progress to next cycle
  if (currentCycle === 1) return 2;
  if (currentCycle === 2) return 3;

  return "synthesize";
}

/**
 * Should stop analysis entirely
 */
export function shouldStopAnalysis(
  cycle: CycleType,
  depthAssessment: DepthAssessment,
  averageConfidence: number,
  maxCycles: number = 3,
  hasErrors: boolean = false
): { shouldStop: boolean; reason?: StopReason } {
  // Error condition
  if (hasErrors) {
    return { shouldStop: true, reason: StopReason.ERROR_OCCURRED };
  }

  // Max cycles reached
  if (cycle >= maxCycles) {
    return { shouldStop: true, reason: StopReason.MAX_CYCLES_REACHED };
  }

  // Inconsistency detected
  if (depthAssessment.paraphrase_consistency < 0.5) {
    return { shouldStop: true, reason: StopReason.INCONSISTENCY_DETECTED };
  }

  return { shouldStop: false };
}

/**
 * Calculate overall analysis confidence
 */
export function calculateOverallConfidence(
  facts: FactRow[],
  depthAssessment: DepthAssessment,
  citationCompliance: number
): number {
  if (facts.length === 0) return 0.0;

  const avgFactConfidence =
    facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;

  // Weighted average: facts (50%) + depth (30%) + citations (20%)
  const overall =
    avgFactConfidence * 0.5 +
    (depthAssessment.depth_metric / 10) * 0.3 +
    citationCompliance * 0.2;

  return Math.min(1.0, Math.max(0.0, overall));
}

/**
 * Generate cycle summary for logging
 */
export function generateCycleSummary(
  cycle: CycleType,
  duration_ms: number,
  findings: Finding[],
  facts: FactRow[],
  depth: DepthAssessment
): string {
  return (
    `Cycle ${cycle} completed in ${duration_ms}ms | ` +
    `Findings: ${findings.length} | ` +
    `Facts: ${facts.length} | ` +
    `Depth: ${depth.depth_metric.toFixed(1)}/10 | ` +
    `Continue: ${depth.should_continue}`
  );
}

/**
 * Validate cycle execution result
 */
export function validateCycleResult(
  result: CycleExecutionResult
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!result.cycle_number || result.cycle_number < 1 || result.cycle_number > 3) {
    errors.push("Invalid cycle number");
  }

  if (!result.status) {
    errors.push("Status is required");
  }

  if (!result.worker_output) {
    errors.push("Worker output is required");
  }

  if (!result.depth_assessment) {
    errors.push("Depth assessment is required");
  }

  if (result.duration_ms === undefined || result.duration_ms < 0) {
    errors.push("Invalid duration");
  }

  if (result.status === "failure" && !result.error) {
    errors.push("Error message required for failed status");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Track cycle-to-cycle progression
 */
export interface CycleProgression {
  cycle: CycleType;
  findings_count: number;
  facts_added: number;
  depth_delta: number;
  confidence_improvement: number;
  should_continue: boolean;
}

/**
 * Calculate progression metrics between cycles
 */
export function calculateProgression(
  currentFindings: Finding[],
  priorFindings: Finding[],
  currentFacts: FactRow[],
  priorFacts: FactRow[],
  currentConfidence: number,
  priorConfidence: number,
  cycle: CycleType
): CycleProgression {
  const findingsDelta = currentFindings.length - priorFindings.length;
  const factsDelta = currentFacts.length - priorFacts.length;
  const confidenceImprovement = currentConfidence - priorConfidence;

  return {
    cycle,
    findings_count: currentFindings.length,
    facts_added: factsDelta,
    depth_delta: findingsDelta > 0 ? Math.min(10, 2 + findingsDelta * 0.5) : 1.5,
    confidence_improvement: confidenceImprovement,
    should_continue: findingsDelta > 0 && confidenceImprovement >= -0.05,
  };
}

/**
 * Estimate cycles remaining
 */
export function estimateCyclesRemaining(
  currentCycle: CycleType,
  depthMetric: number,
  confidenceLevel: number
): number {
  // If confidence already high, might need 1 more cycle max
  if (confidenceLevel >= CONFIDENCE_THRESHOLDS.READY_FOR_DECISION) {
    return currentCycle === 3 ? 0 : 1;
  }

  // Standard progression
  if (currentCycle === 1) return 2;
  if (currentCycle === 2) return 1;
  return 0;
}

/**
 * Log cycle metrics for debugging
 */
export function logCycleMetrics(
  cycle: CycleType,
  duration: number,
  findings: number,
  facts: number,
  confidence: number,
  depth: number
): void {
  const metrics = {
    timestamp: new Date().toISOString(),
    cycle,
    duration_ms: duration,
    findings_count: findings,
    facts_count: facts,
    confidence_score: confidence.toFixed(2),
    depth_metric: depth.toFixed(1),
  };

  console.log(`[CYCLE ${cycle}]`, JSON.stringify(metrics));
}
