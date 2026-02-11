import type { Pool } from "pg";
import type { DealStage } from "@dealdecision/contracts";
import { getFailOpenMode } from "@dealdecision/core";
import { updateDealPriority } from "./priorityClassification";
import { getNodeEvidenceGateForDeal } from "./nodeEvidenceGateForDeal";

const DISCLOSURE_FAIL_OPEN_STAGE_PROGRESSION_GATE = "fail_open_stage_progression_gate" as const;

interface StageProgressionRule {
  fromStage: DealStage;
  toStage: DealStage;
  conditions: (metrics: DealMetrics) => boolean;
  description: string;
}

interface DealMetrics {
  dealId: string;
  score: number;
  documentCount: number;
  daysInCurrentStage: number;
  hasAnalysis: boolean;
  hasEvidenceCount: number;
}

async function getEvidenceCountForGate(pool: Pool, dealId: string): Promise<number> {
  const parseCount = (rows: any[]): number => {
    const raw = rows?.[0]?.count;
    const n = Number.parseInt(String(raw ?? 0), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const hasEvidenceItems = await (async () => {
    try {
      const { rows } = await pool.query<{ oid: string | null }>(
        "SELECT to_regclass('public.evidence_items') as oid"
      );
      return !!rows?.[0]?.oid;
    } catch {
      return false;
    }
  })();

  if (hasEvidenceItems) {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM evidence_items WHERE deal_id = $1`,
        [dealId]
      );
      const count = parseCount(rows as any);
      if (count > 0) return count;
    } catch {
      // Best-effort; fall back to legacy evidence.
    }
  }

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM evidence WHERE deal_id = $1`,
      [dealId]
    );
    return parseCount(rows as any);
  } catch {
    return 0;
  }
}

/**
 * Stage Progression Rules (Analysis-Driven Workflow)
 *
 * intake → under_review: AI analysis job completes (has analysis)
 * under_review → in_diligence: Investor starts addressing identified gaps (new DD docs added)
 * in_diligence → ready_decision: Confidence >= 70% AND due diligence substantially complete
 * ready_decision → pitched: Manual advancement (investment decision made)
 */
const progressionRules: StageProgressionRule[] = [
  {
    fromStage: "intake",
    toStage: "under_review",
    conditions: (m) => m.hasAnalysis,
    description: "AI analysis completed, gaps and opportunities identified"
  },
  {
    fromStage: "under_review",
    toStage: "in_diligence",
    conditions: (m) => m.hasAnalysis && m.documentCount >= 2,
    description: "Investor has added new documents, addressing identified gaps"
  },
  {
    fromStage: "in_diligence",
    toStage: "ready_decision",
    conditions: (m) => m.score >= 70 && m.hasEvidenceCount >= 2,
    description: "Confidence >= 70% AND key evidence/findings collected"
  }
];

/**
 * Evaluate a deal for automatic stage progression
 */
export async function evaluateDealStageProgression(
  pool: Pool,
  dealId: string,
  opts?: {
		getNodeEvidenceGateForDeal?: typeof getNodeEvidenceGateForDeal;
		env?: NodeJS.ProcessEnv;
	}
): Promise<{ shouldProgress: boolean; newStage?: DealStage; reason?: string; gate?: any; disclosures?: string[] }> {
  const env = opts?.env ?? process.env;
  const failOpenMode = getFailOpenMode(env);
  const gateFetcher = opts?.getNodeEvidenceGateForDeal ?? getNodeEvidenceGateForDeal;
  // Fetch current deal
  const { rows: dealRows } = await pool.query(
    `SELECT id, stage, score, created_at, updated_at FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [dealId]
  );

  if (!dealRows.length) {
    return { shouldProgress: false, reason: "Deal not found" };
  }

  const deal = dealRows[0];
  const currentStage = deal.stage as DealStage;

  // Fetch document count
  const { rows: docCountRows } = await pool.query(
    `SELECT COUNT(*) as count FROM documents WHERE deal_id = $1`,
    [dealId]
  );
  const documentCount = parseInt(docCountRows[0].count || 0, 10);

  // Fetch evidence count (canonical bridge)
  const hasEvidenceCount = await getEvidenceCountForGate(pool, dealId);

  // Check if deal has analysis (latest DIO)
  const { rows: analysisRows } = await pool.query(
    `SELECT 1 FROM deal_intelligence_objects WHERE deal_id = $1 LIMIT 1`,
    [dealId]
  );
  const hasAnalysis = analysisRows.length > 0;

  // Calculate days in current stage
  const updatedAt = new Date(deal.updated_at);
  const daysInCurrentStage = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));

  // Create metrics object
  const metrics: DealMetrics = {
    dealId,
    score: deal.score || 0,
    documentCount,
    daysInCurrentStage,
    hasAnalysis,
    hasEvidenceCount
  };

  // Find applicable progression rule
  const applicableRule = progressionRules.find(
    (rule) => rule.fromStage === currentStage && rule.conditions(metrics)
  );

  if (applicableRule) {
    // Path A enforcement: block (optionally) advancing to ready_decision if score-linked evidence is not node-locatable.
    if (applicableRule.toStage === "ready_decision") {
      const gateModeRaw = typeof process.env.DDAI_NODE_EVIDENCE_GATE_MODE === "string" ? process.env.DDAI_NODE_EVIDENCE_GATE_MODE : "off";
      const gateMode = gateModeRaw.toLowerCase();
      const enforce = gateMode === "enforce" || gateMode === "hard";
      const warnOnly = gateMode === "warn" || gateMode === "soft";

      try {
			const { gate } = await gateFetcher(pool, dealId);
        const gateMsg = `Node-backed scoring gate: ${gate.status.toUpperCase()} (${gate.node_coverage_pct}% node-locatable linked evidence).`;

        if (enforce && gate.status === "block") {
          return {
            shouldProgress: false,
            reason: `Blocked from ready_decision. ${gateMsg}`,
            gate,
          };
        }

        if (warnOnly && gate.status !== "ok") {
          return {
            shouldProgress: true,
            newStage: applicableRule.toStage,
            reason: `${applicableRule.description}. Warning: ${gateMsg}`,
            gate,
          };
        }

        return {
          shouldProgress: true,
          newStage: applicableRule.toStage,
          reason: applicableRule.description,
          gate,
        };
      } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      try {
        console.warn(
          JSON.stringify({
            event: "DISCLOSURE",
            code: DISCLOSURE_FAIL_OPEN_STAGE_PROGRESSION_GATE,
            mode: failOpenMode,
            deal_id: dealId,
            error: errorMsg,
            ts: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }

      if (failOpenMode === "prod_block") {
        return {
          shouldProgress: false,
          reason: `Blocked from ready_decision. Node-backed scoring gate unavailable (${DISCLOSURE_FAIL_OPEN_STAGE_PROGRESSION_GATE}).`,
          disclosures: [DISCLOSURE_FAIL_OPEN_STAGE_PROGRESSION_GATE],
        };
      }

      // dev + prod_warn: fail open, but make it observable via disclosure.
      return {
        shouldProgress: true,
        newStage: applicableRule.toStage,
        reason: applicableRule.description,
        disclosures: [DISCLOSURE_FAIL_OPEN_STAGE_PROGRESSION_GATE],
      };
      }
    }

    return {
      shouldProgress: true,
      newStage: applicableRule.toStage,
      reason: applicableRule.description
    };
  }

  return { shouldProgress: false, reason: "No progression conditions met" };
}

/**
 * Automatically progress a deal's stage if conditions are met
 */
export async function autoProgressDealStage(
  pool: Pool,
  dealId: string
): Promise<{ progressed: boolean; oldStage?: DealStage; newStage?: DealStage; reason?: string; gate?: any }> {
  const { rows: beforeRows } = await pool.query(
    `SELECT stage FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [dealId]
  );

  if (!beforeRows.length) {
    return { progressed: false };
  }

  const oldStage = beforeRows[0].stage as DealStage;
  const evaluation = await evaluateDealStageProgression(pool, dealId);

  if (!evaluation.shouldProgress || !evaluation.newStage) {
    return { progressed: false, oldStage, reason: evaluation.reason, gate: evaluation.gate };
  }

  // Update the deal's stage
  const { rows } = await pool.query(
    `UPDATE deals SET stage = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING stage`,
    [evaluation.newStage, dealId]
  );

  if (!rows.length) {
    return { progressed: false };
  }

  // Update priority based on new stage and metrics
  await updateDealPriority(dealId);

  return {
    progressed: true,
    oldStage,
    newStage: rows[0].stage as DealStage,
    reason: evaluation.reason,
    gate: evaluation.gate,
  };
}

/**
 * Batch check all deals for automatic stage progression
 */
export async function autoProgressAllDeals(pool: Pool): Promise<
  Array<{ dealId: string; oldStage: DealStage; newStage: DealStage }>
> {
  const { rows: deals } = await pool.query(
    `SELECT id, stage FROM deals WHERE deleted_at IS NULL`
  );

  const progressedDeals: Array<{ dealId: string; oldStage: DealStage; newStage: DealStage }> = [];

  for (const deal of deals) {
    const evaluation = await evaluateDealStageProgression(pool, deal.id);

    if (evaluation.shouldProgress && evaluation.newStage && evaluation.newStage !== deal.stage) {
      await pool.query(
        `UPDATE deals SET stage = $1, updated_at = now() WHERE id = $2`,
        [evaluation.newStage, deal.id]
      );

      // Update priority based on new stage and metrics
      await updateDealPriority(deal.id);

      progressedDeals.push({
        dealId: deal.id,
        oldStage: deal.stage,
        newStage: evaluation.newStage
      });
    }
  }

  return progressedDeals;
}
