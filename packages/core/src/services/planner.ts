/**
 * Planner Service
 * Manages PlannerState across analysis cycles
 * Responsible for goal tracking, constraint management, hypothesis evolution
 */

import type {
  PlannerState,
  FactRow,
  Hypothesis,
  Uncertainty,
  BindingConstraint,
} from "../types/hrmdd";
import type {
  CycleType,
  CycleContext,
  Finding,
} from "../types/analysis";

/**
 * Initialize planner state for a new deal analysis
 */
export function initializePlannerState(): PlannerState {
  return {
    cycle: 1,
    goals: [
      "Validate market & problem",
      "Verify predictive validity",
      "Quantify monetization realism",
      "Team/competition assessment",
    ],
    constraints: ["deck-facts-only", "cite-or-uncertain"],
    hypotheses: [],
    subgoals: [],
    focus: "Initial market validation",
    stop_reason: null,
  };
}

/**
 * Add hypothesis to planner state
 */
export function addHypothesis(
  state: PlannerState,
  hypothesis: string,
  cycle: CycleType
): PlannerState {
  if (!state.hypotheses.includes(hypothesis)) {
    return {
      ...state,
      hypotheses: [...state.hypotheses, hypothesis],
    };
  }
  return state;
}

/**
 * Remove hypothesis from planner state
 */
export function removeHypothesis(
  state: PlannerState,
  hypothesis: string
): PlannerState {
  return {
    ...state,
    hypotheses: state.hypotheses.filter((h) => h !== hypothesis),
  };
}

/**
 * Add subgoal to planner state
 */
export function addSubgoal(
  state: PlannerState,
  subgoal: string
): PlannerState {
  if (!state.subgoals.includes(subgoal)) {
    return {
      ...state,
      subgoals: [...state.subgoals, subgoal],
    };
  }
  return state;
}

/**
 * Mark subgoal as complete by removing it
 */
export function completeSubgoal(
  state: PlannerState,
  subgoal: string
): PlannerState {
  return {
    ...state,
    subgoals: state.subgoals.filter((s) => s !== subgoal),
  };
}

/**
 * Update focus area for next investigation
 */
export function updateFocus(
  state: PlannerState,
  newFocus: string,
  cycle: CycleType
): PlannerState {
  return {
    ...state,
    cycle: cycle,
    focus: newFocus,
  };
}

/**
 * Progress planner state to next cycle
 */
export function progressToCycle(
  state: PlannerState,
  nextCycle: CycleType,
  newFocus: string
): PlannerState {
  return {
    ...state,
    cycle: nextCycle,
    focus: newFocus,
  };
}

/**
 * Mark analysis as stopped with reason
 */
export function stopAnalysis(
  state: PlannerState,
  reason: string
): PlannerState {
  return {
    ...state,
    stop_reason: reason,
  };
}

/**
 * Determine if we should continue to next cycle based on state
 */
export function shouldContinueToNextCycle(
  state: PlannerState,
  depthDelta: number,
  cycle: CycleType,
  depthThreshold: number
): boolean {
  // Cycle 3 always produces final result
  if (cycle === 3) return false;

  // Check depth delta threshold
  return depthDelta >= depthThreshold;
}

/**
 * Calculate hypothesis status based on findings
 */
export function updateHypothesisStatus(
  hypothesis: string,
  findings: Finding[]
): "supported" | "contradicted" | "inconclusive" | "testing" {
  const hypothesisFinding = findings.find((f) => f.statement === hypothesis);

  if (!hypothesisFinding) return "testing";

  switch (hypothesisFinding.status) {
    case "resolved":
      return hypothesisFinding.confidence > 0.7 ? "supported" : "contradicted";
    case "refined":
      return "inconclusive";
    case "new":
    default:
      return "testing";
  }
}

/**
 * Validate planner state for consistency
 */
export function validatePlannerState(state: PlannerState): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!state.goals || state.goals.length === 0) {
    errors.push("PlannerState must have at least one goal");
  }

  if (!state.constraints || state.constraints.length === 0) {
    errors.push("PlannerState must have at least one constraint");
  }

  if (state.cycle < 1 || state.cycle > 3) {
    errors.push("Cycle must be 1, 2, or 3");
  }

  if (state.stop_reason && !state.stop_reason.length) {
    errors.push("stop_reason must be null or non-empty string");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate next focus area based on current state
 */
export function generateNextFocus(
  state: PlannerState,
  cycle: CycleType,
  openSubgoals: string[]
): string {
  // If subgoals remain, focus on highest priority
  if (openSubgoals.length > 0) {
    return `Address: ${openSubgoals[0]}`;
  }

  // Otherwise, progress focus based on cycle
  switch (cycle) {
    case 1:
      return "Prepare deep dive into binding constraints";
    case 2:
      return "Synthesize findings into investment recommendation";
    case 3:
      return "Finalize decision package";
    default:
      return "Continue analysis";
  }
}

/**
 * Summary of planner state for logging/debugging
 */
export function summarizePlannerState(state: PlannerState): string {
  return (
    `Cycle ${state.cycle} | ` +
    `Goals: ${state.goals.length} | ` +
    `Hypotheses: ${state.hypotheses.length} | ` +
    `Subgoals: ${state.subgoals.length} | ` +
    `Focus: ${state.focus || "None"} | ` +
    `${state.stop_reason ? `Stopped: ${state.stop_reason}` : "Active"}`
  );
}

/**
 * Export planner state as JSON
 */
export function serializePlannerState(state: PlannerState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Import planner state from JSON
 */
export function deserializePlannerState(json: string): PlannerState {
  return JSON.parse(json) as PlannerState;
}
