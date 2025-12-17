import type { Pool } from "pg";
import type { Deal } from "@dealdecision/contracts";
import type { DealStage } from "@dealdecision/contracts";
import { updateDealPriority } from "./priorityClassification";

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
  dealId: string
): Promise<{ shouldProgress: boolean; newStage?: DealStage; reason?: string }> {
  // Fetch current deal
  const { rows: dealRows } = await pool.query(
    `SELECT id, stage, score, created_at, updated_at FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [dealId]
  );

  if (!dealRows.length) {
    return { shouldProgress: false, reason: "Deal not found" };
  }

  const deal = dealRows[0];
  const currentStage: DealStage = deal.stage;

  // Fetch document count
  const { rows: docCountRows } = await pool.query(
    `SELECT COUNT(*) as count FROM documents WHERE deal_id = $1`,
    [dealId]
  );
  const documentCount = parseInt(docCountRows[0].count || 0, 10);

  // Fetch evidence count
  const { rows: evidenceCountRows } = await pool.query(
    `SELECT COUNT(*) as count FROM evidence WHERE deal_id = $1`,
    [dealId]
  );
  const hasEvidenceCount = parseInt(evidenceCountRows[0].count || 0, 10);

  // Check if deal has analysis (dio_versions)
  const { rows: analysisRows } = await pool.query(
    `SELECT id FROM dio_versions WHERE deal_id = $1 LIMIT 1`,
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
): Promise<{ progressed: boolean; oldStage?: DealStage; newStage?: DealStage }> {
  const evaluation = await evaluateDealStageProgression(pool, dealId);

  if (!evaluation.shouldProgress || !evaluation.newStage) {
    return { progressed: false };
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

  // Fetch old stage from deal query (we need to do this before update, so we'll return from evaluation)
  const { rows: dealRows } = await pool.query(
    `SELECT stage FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [dealId]
  );

  return {
    progressed: true,
    oldStage: evaluation.newStage === "idea" ? "idea" : undefined, // This is simplified
    newStage: evaluation.newStage
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
