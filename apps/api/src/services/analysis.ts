/**
 * Analysis Service
 * Integrates HRM-DD analysis engine with API and database
 * Manages deal analysis workflow across Cycles 1-3
 */

import type { Pool } from "pg";
import {
  initializePlannerState,
  progressToCycle,
  shouldContinueToNextCycle,
} from "@dealdecision/core/services/planner";
import {
  initializeLedgerManifest,
  addFact,
  calculateCitationCompliance,
  calculateAverageConfidence,
  recordDepthDelta,
} from "@dealdecision/core/services/ledger";
import {
  assessDepth,
  determineNextCycle,
  calculateOverallConfidence,
  shouldStopAnalysis,
  generateCycleSummary,
} from "@dealdecision/core/services/cycle-analyzer";
import {
  generateCycle1SystemPrompt,
  generateCycle2SystemPrompt,
  generateCycle3SystemPrompt,
} from "@dealdecision/core/services/prompt-generator";
import type {
  PlannerState,
  FactRow,
  LedgerManifest,
  DecisionPack,
} from "@dealdecision/core";
import { DEPTH_THRESHOLDS, CONFIDENCE_THRESHOLDS } from "@dealdecision/core";

/**
 * Analysis workflow state per deal
 */
export interface DealAnalysisState {
  deal_id: string;
  current_cycle: 1 | 2 | 3 | null;
  planner_state: PlannerState;
  fact_table: FactRow[];
  ledger: LedgerManifest;
  decision_pack?: DecisionPack;
  created_at: Date;
  updated_at: Date;
  status: "not_started" | "in_progress" | "cycle_1" | "cycle_2" | "cycle_3" | "complete" | "failed";
}

/**
 * Initialize analysis for a deal
 */
export async function initializeAnalysis(
  pool: Pool,
  dealId: string
): Promise<DealAnalysisState> {
  const planner_state = initializePlannerState();
  const ledger = initializeLedgerManifest();
  const now = new Date();

  const state: DealAnalysisState = {
    deal_id: dealId,
    current_cycle: null,
    planner_state,
    fact_table: [],
    ledger,
    status: "not_started",
    created_at: now,
    updated_at: now,
  };

  // Store in database
  await pool.query(
    `INSERT INTO planner_states (deal_id, cycle, goals, constraints, hypotheses, subgoals, focus, stop_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (deal_id) DO UPDATE SET
       cycle = EXCLUDED.cycle,
       goals = EXCLUDED.goals,
       constraints = EXCLUDED.constraints,
       hypotheses = EXCLUDED.hypotheses,
       subgoals = EXCLUDED.subgoals,
       focus = EXCLUDED.focus,
       stop_reason = EXCLUDED.stop_reason`,
    [
      dealId,
      planner_state.cycle,
      planner_state.goals,
      planner_state.constraints,
      planner_state.hypotheses,
      planner_state.subgoals,
      planner_state.focus,
      planner_state.stop_reason,
    ]
  );

  // Store ledger manifest
  await pool.query(
    `INSERT INTO ledger_manifests (deal_id, cycles_completed, paraphrase_invariance)
     VALUES ($1, $2, $3)
     ON CONFLICT (deal_id) DO UPDATE SET
       cycles_completed = EXCLUDED.cycles_completed,
       paraphrase_invariance = EXCLUDED.paraphrase_invariance`,
    [dealId, ledger.cycles, ledger.paraphrase_invariance]
  );

  return state;
}

/**
 * Load analysis state for a deal
 */
export async function loadAnalysisState(
  pool: Pool,
  dealId: string
): Promise<DealAnalysisState | null> {
  // Load planner state
  const { rows: plannerRows } = await pool.query(
    `SELECT cycle, goals, constraints, hypotheses, subgoals, focus, stop_reason
     FROM planner_states WHERE deal_id = $1`,
    [dealId]
  );

  if (plannerRows.length === 0) {
    return null;
  }

  const plannerData = plannerRows[0];

  // Load ledger
  const { rows: ledgerRows } = await pool.query(
    `SELECT cycles_completed, depth_delta, subgoals_addressed, constraints_checked, dead_ends, paraphrase_invariance, calibration_brier
     FROM ledger_manifests WHERE deal_id = $1`,
    [dealId]
  );

  const ledgerData = ledgerRows[0];

  // Load facts
  const { rows: factRows } = await pool.query(
    `SELECT id, claim, source, page, confidence, created_cycle
     FROM fact_rows WHERE deal_id = $1
     ORDER BY created_cycle ASC, created_at ASC`,
    [dealId]
  );

  // Load decision pack if exists
  const { rows: decisionRows } = await pool.query(
    `SELECT id, executive_summary, go_no_go, tranche_plan, risk_map, what_to_verify
     FROM decision_packs WHERE deal_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [dealId]
  );

  // Build state
  const state: DealAnalysisState = {
    deal_id: dealId,
    current_cycle: (plannerData.cycle as any) || null,
    planner_state: {
      cycle: plannerData.cycle,
      goals: plannerData.goals,
      constraints: plannerData.constraints,
      hypotheses: plannerData.hypotheses,
      subgoals: plannerData.subgoals,
      focus: plannerData.focus,
      stop_reason: plannerData.stop_reason,
    },
    fact_table: factRows.map((row: any) => ({
      id: row.id,
      claim: row.claim,
      source: row.source,
      page: row.page,
      confidence: parseFloat(row.confidence),
      created_cycle: row.created_cycle,
    })),
    ledger: {
      cycles: ledgerData?.cycles_completed || 0,
      depth_delta: ledgerData?.depth_delta || [],
      subgoals: ledgerData?.subgoals_addressed || 0,
      constraints: ledgerData?.constraints_checked || 0,
      dead_ends: ledgerData?.dead_ends || 0,
      paraphrase_invariance: ledgerData?.paraphrase_invariance || 1.0,
      calibration: { brier: ledgerData?.calibration_brier || 0.0 },
    },
    decision_pack: decisionRows[0] ? {
      executive_summary: decisionRows[0].executive_summary,
      go_no_go: decisionRows[0].go_no_go,
      tranche_plan: decisionRows[0].tranche_plan || [],
      risk_map: decisionRows[0].risk_map || [],
      what_to_verify: decisionRows[0].what_to_verify || [],
      calibration_audit: {},
      paraphrase_invariance: 0.0,
      ledger: {
        cycles: 0,
        depth_delta: [],
        subgoals: 0,
        constraints: 0,
        dead_ends: 0,
        paraphrase_invariance: 1.0,
        calibration: {},
      },
      fact_table: [],
    } : undefined,
    status: "not_started",
    created_at: new Date(),
    updated_at: new Date(),
  };

  return state;
}

/**
 * Determine if analysis should proceed to next cycle
 */
export function shouldProgressCycle(
  currentCycle: 1 | 2 | 3,
  depthDelta: number,
  confidence: number,
  maxCycles: number
): { shouldProgress: boolean; nextCycle?: 1 | 2 | 3 | "synthesize"; reason: string } {
  // Cycle 3 always synthesizes
  if (currentCycle === 3) {
    return { shouldProgress: false, nextCycle: "synthesize", reason: "Final synthesis cycle" };
  }

  // Check depth threshold
  const thresholdKey = `CYCLE_${currentCycle}_CONTINUE` as const;
  const threshold = DEPTH_THRESHOLDS[thresholdKey] || 2.0;

  if (depthDelta >= threshold) {
    const nextCycle = (currentCycle + 1) as 1 | 2 | 3;
    return {
      shouldProgress: true,
      nextCycle,
      reason: `Depth delta ${depthDelta} >= threshold ${threshold}, progressing to Cycle ${nextCycle}`,
    };
  }

  return {
    shouldProgress: false,
    nextCycle: "synthesize",
    reason: `Depth insufficient (${depthDelta} < ${threshold}), ready for synthesis`,
  };
}

/**
 * Generate analysis summary for API response
 */
export function generateAnalysisSummary(state: DealAnalysisState): {
  cycle: number;
  facts_count: number;
  confidence: number;
  status: string;
  next_action: string;
} {
  const citationCompliance = calculateCitationCompliance(state.fact_table);
  const confidence = calculateAverageConfidence(state.fact_table);

  let next_action = "waiting_for_cycle_1";
  if (state.current_cycle === 1) next_action = "run_cycle_2";
  else if (state.current_cycle === 2) next_action = "run_cycle_3";
  else if (state.current_cycle === 3) next_action = "synthesize";
  else if (state.status === "complete") next_action = "view_decision_pack";

  return {
    cycle: state.current_cycle || 0,
    facts_count: state.fact_table.length,
    confidence: Math.round(confidence * 100),
    status: state.status,
    next_action,
  };
}

/**
 * Save analysis state to database
 */
export async function saveAnalysisState(
  pool: Pool,
  state: DealAnalysisState
): Promise<void> {
  // Update planner state
  await pool.query(
    `UPDATE planner_states
     SET cycle = $1, goals = $2, constraints = $3, hypotheses = $4, subgoals = $5, focus = $6, stop_reason = $7, updated_at = now()
     WHERE deal_id = $8`,
    [
      state.planner_state.cycle,
      state.planner_state.goals,
      state.planner_state.constraints,
      state.planner_state.hypotheses,
      state.planner_state.subgoals,
      state.planner_state.focus,
      state.planner_state.stop_reason,
      state.deal_id,
    ]
  );

  // Update ledger
  await pool.query(
    `UPDATE ledger_manifests
     SET cycles_completed = $1, depth_delta = $2, subgoals_addressed = $3, constraints_checked = $4, dead_ends = $5, paraphrase_invariance = $6, calibration_brier = $7, updated_at = now()
     WHERE deal_id = $8`,
    [
      state.ledger.cycles,
      JSON.stringify(state.ledger.depth_delta),
      state.ledger.subgoals,
      state.ledger.constraints,
      state.ledger.dead_ends,
      state.ledger.paraphrase_invariance,
      state.ledger.calibration.brier,
      state.deal_id,
    ]
  );

  // Upsert facts (skip if already exists)
  for (const fact of state.fact_table) {
    await pool.query(
      `INSERT INTO fact_rows (id, deal_id, claim, source, page, confidence, created_cycle)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (deal_id, claim, created_cycle) DO NOTHING`,
      [
        fact.id,
        state.deal_id,
        fact.claim,
        fact.source,
        fact.page,
        fact.confidence,
        fact.created_cycle,
      ]
    );
  }
}

/**
 * Get system prompt for current cycle
 */
export function getSystemPrompt(cycle: 1 | 2 | 3): string {
  switch (cycle) {
    case 1:
      return generateCycle1SystemPrompt();
    case 2:
      return generateCycle2SystemPrompt();
    case 3:
      return generateCycle3SystemPrompt();
    default:
      return "";
  }
}

/**
 * Validate analysis can proceed
 */
export function validateAnalysisPrerequisites(
  dealId: string,
  documentsCount: number,
  hasDecks: boolean
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!dealId) {
    errors.push("Deal ID is required");
  }

  if (documentsCount === 0) {
    errors.push("At least one document must be uploaded");
  }

  if (!hasDecks) {
    errors.push("At least one pitch deck must be uploaded");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Log analysis event
 */
export function logAnalysisEvent(
  dealId: string,
  cycle: number,
  event: string,
  metadata?: Record<string, any>
): void {
  const timestamp = new Date().toISOString();
  const meta = metadata ? ` ${JSON.stringify(metadata)}` : "";
  console.log(`[ANALYSIS] ${timestamp} deal=${dealId} cycle=${cycle} event=${event}${meta}`);
}
