import { getPool } from "../lib/db";
import type { DealPriority } from "@dealdecision/contracts";

interface PriorityFactors {
  score: number | null;
  stage: string;
  documentCount: number;
  evidenceCount: number;
}

/**
 * Automatically classify deal priority based on:
 * 1. Deal Score (confidence >= 70% = higher priority)
 * 2. Document Completeness (more docs = higher priority)
 * 3. Stage Position (ready_decision/pitched = auto-high, intake = auto-low)
 * 4. Evidence Quality (verified evidence = higher priority)
 */
export function classifyPriority(factors: PriorityFactors): DealPriority {
  let priorityScore = 0;

  // Factor 1: Deal Score (0-40 points)
  if (factors.score !== null) {
    if (factors.score >= 80) priorityScore += 40;
    else if (factors.score >= 70) priorityScore += 30;
    else if (factors.score >= 60) priorityScore += 20;
    else if (factors.score >= 50) priorityScore += 10;
  }

  // Factor 2: Document Completeness (0-25 points)
  // Scoring: 4+ docs = 25pts, 3 docs = 18pts, 2 docs = 12pts, 1 doc = 6pts, 0 docs = 0pts
  if (factors.documentCount >= 4) priorityScore += 25;
  else if (factors.documentCount === 3) priorityScore += 18;
  else if (factors.documentCount === 2) priorityScore += 12;
  else if (factors.documentCount === 1) priorityScore += 6;

  // Factor 3: Stage Position (0-20 points)
  // ready_decision/pitched = high readiness
  // in_diligence = medium readiness
  // under_review = lower readiness
  // intake = just starting
  switch (factors.stage) {
    case "pitched":
      priorityScore += 20;
      break;
    case "ready_decision":
      priorityScore += 18;
      break;
    case "in_diligence":
      priorityScore += 10;
      break;
    case "under_review":
      priorityScore += 5;
      break;
    case "intake":
      priorityScore += 0;
      break;
  }

  // Factor 4: Evidence Quality (0-15 points)
  // Each evidence point adds value, with diminishing returns
  if (factors.evidenceCount >= 5) priorityScore += 15;
  else if (factors.evidenceCount >= 3) priorityScore += 10;
  else if (factors.evidenceCount >= 1) priorityScore += 5;

  // Convert score (0-100) to priority level
  // High: 70+, Medium: 40-69, Low: 0-39
  if (priorityScore >= 70) return "high";
  if (priorityScore >= 40) return "medium";
  return "low";
}

/**
 * Update priority for a single deal based on current metrics
 */
export async function updateDealPriority(dealId: string): Promise<void> {
  const pool = getPool();

  try {
    // Get current deal metrics
    const result = await pool.query(
      `
      SELECT 
        d.id,
        d.stage,
        d.score,
        (SELECT COUNT(*) FROM documents WHERE deal_id = d.id) as document_count,
        (SELECT COUNT(*) FROM evidence WHERE deal_id = d.id) as evidence_count
      FROM deals d
      WHERE d.id = $1 AND d.deleted_at IS NULL
      `,
      [dealId]
    );

    if (result.rows.length === 0) {
      console.warn(`Deal ${dealId} not found or deleted`);
      return;
    }

    const row = result.rows[0];
    const factors: PriorityFactors = {
      score: row.score,
      stage: row.stage,
      documentCount: parseInt(row.document_count),
      evidenceCount: parseInt(row.evidence_count),
    };

    const newPriority = classifyPriority(factors);

    // Update deal priority
    await pool.query(
      `UPDATE deals SET priority = $1, updated_at = NOW() WHERE id = $2`,
      [newPriority, dealId]
    );

    console.log(
      `Priority updated for deal ${dealId}: ${newPriority} (score: ${factors.score}, docs: ${factors.documentCount}, evidence: ${factors.evidenceCount}, stage: ${factors.stage})`
    );
  } catch (error) {
    console.error(`Error updating priority for deal ${dealId}:`, error);
    throw error;
  }
}

/**
 * Batch update priority for all deals based on current metrics
 */
export async function updateAllDealPriorities(): Promise<{
  updated: number;
  high: number;
  medium: number;
  low: number;
}> {
  const pool = getPool();

  try {
    // Get all deals with their current metrics
    const result = await pool.query(
      `
      SELECT 
        d.id,
        d.stage,
        d.score,
        (SELECT COUNT(*) FROM documents WHERE deal_id = d.id) as document_count,
        (SELECT COUNT(*) FROM evidence WHERE deal_id = d.id) as evidence_count
      FROM deals d
      WHERE d.deleted_at IS NULL
      ORDER BY d.created_at DESC
      `
    );

    let highCount = 0,
      mediumCount = 0,
      lowCount = 0;

    for (const row of result.rows) {
      const factors: PriorityFactors = {
        score: row.score,
        stage: row.stage,
        documentCount: parseInt(row.document_count),
        evidenceCount: parseInt(row.evidence_count),
      };

      const newPriority = classifyPriority(factors);

      // Update deal priority
      await pool.query(`UPDATE deals SET priority = $1, updated_at = NOW() WHERE id = $2`, [
        newPriority,
        row.id,
      ]);

      if (newPriority === "high") highCount++;
      else if (newPriority === "medium") mediumCount++;
      else lowCount++;
    }

    return {
      updated: result.rows.length,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
    };
  } catch (error) {
    console.error("Error updating all deal priorities:", error);
    throw error;
  }
}
