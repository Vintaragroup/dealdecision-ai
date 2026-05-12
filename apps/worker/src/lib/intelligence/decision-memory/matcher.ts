/**
 * Decision Memory — Matcher
 *
 * Finds the most similar historical deals by weighted Euclidean distance
 * over the normalized feature vector.
 *
 * Pure function: takes stored snapshots + query vector, returns ranked matches.
 * No I/O.
 */

import type { SimilarDeal, FindSimilarDealsOptions } from "./types.js";
import {
  VECTOR_DIMENSION_WEIGHTS,
  VECTOR_DIMENSION_LABELS,
} from "./vectorizer.js";

// ─── Distance ─────────────────────────────────────────────────────────────────

/**
 * Weighted Euclidean distance between two vectors.
 * Vectors must be the same length. Weights length must match vectors.
 */
export function weightedEuclideanDistance(
  a: number[],
  b: number[],
  weights: number[]
): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0.5) - (b[i] ?? 0.5);
    sum += (weights[i] ?? 1) * diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Convert Euclidean distance to a 0–100 similarity percentage.
 * Maximum possible distance for an 18-dim unit-normalized vector with given weights.
 */
function distanceToSimilarityPct(distance: number): number {
  // Max possible weighted distance (all weights * max_diff^2 summed, sqrt)
  const maxDist = Math.sqrt(
    VECTOR_DIMENSION_WEIGHTS.reduce((acc, w) => acc + w, 0)
  );
  return Math.round(Math.max(0, (1 - distance / maxDist) * 100));
}

// ─── Match reason generation ──────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.15; // delta <= this is "similar on that dimension"

function buildMatchReasons(
  queryVec: number[],
  candidateVec: number[],
  candidateVerdict: string
): string[] {
  const reasons: string[] = [];
  for (let i = 0; i < queryVec.length; i++) {
    const delta = Math.abs((queryVec[i] ?? 0.5) - (candidateVec[i] ?? 0.5));
    if (delta <= SIMILARITY_THRESHOLD) {
      reasons.push(`similar ${VECTOR_DIMENSION_LABELS[i]}`);
    }
  }
  if (reasons.length === 0) {
    reasons.push(`overall profile similarity (verdict: ${candidateVerdict})`);
  }
  return reasons.slice(0, 5); // cap at 5 reasons for readability
}

// ─── Stored snapshot (minimal shape needed for matching) ─────────────────────

export interface StoredMemoryRow {
  deal_id: string;
  feature_vector: number[];
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  verdict: string;
  scoreband_key: string;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Find the top-N most similar deals from the provided stored rows.
 *
 * @param queryVector - normalized feature vector for the current deal
 * @param storedRows - rows fetched from deal_decision_memory (excluding current deal)
 * @param opts - top_n (default 5), min_similarity_pct (default 0)
 */
export function findSimilarDeals(
  queryVector: number[],
  storedRows: StoredMemoryRow[],
  opts: { deal_id: string; top_n?: number; min_similarity_pct?: number }
): SimilarDeal[] {
  const topN = opts.top_n ?? 5;
  const minSim = opts.min_similarity_pct ?? 0;

  const scored = storedRows
    .filter((row) => row.deal_id !== opts.deal_id)
    .map((row) => {
      const distance = weightedEuclideanDistance(
        queryVector,
        row.feature_vector,
        VECTOR_DIMENSION_WEIGHTS
      );
      const similarity_pct = distanceToSimilarityPct(distance);
      const match_reasons = buildMatchReasons(queryVector, row.feature_vector, row.verdict);
      return {
        deal_id: row.deal_id,
        distance,
        similarity_pct,
        match_reasons,
        score_snapshot: {
          ors: row.ors_score,
          dci: row.dci_score,
          fhc: row.fhc_score,
          urss: row.urss_score,
        },
        verdict: row.verdict,
        scoreband_key: row.scoreband_key,
      } satisfies SimilarDeal;
    })
    .filter((r) => r.similarity_pct >= minSim)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, topN);

  return scored;
}
