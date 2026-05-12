/**
 * Decision Memory — Influence Service
 *
 * Derives a MemoryInfluenceSummary from a list of similar deals found in the
 * decision-memory pool. This summary is a SECONDARY, BOUNDED signal:
 *
 *   - It does NOT overwrite ORS, verdict, or extracted facts.
 *   - It INFORMS the confidence engine and challenge pass via explicit,
 *     auditable adjustments and explanation strings.
 *   - All influence is zeroed when the pool is too small or similarity is weak.
 *
 * These values are computed once and threaded through Stage 5.
 */

import type { SimilarDeal } from "./types.js";

// ─── Thresholds (all explicit constants) ─────────────────────────────────────

/** Minimum number of neighbors required to apply any memory influence. */
export const MEMORY_MIN_NEIGHBORS = 3;

/** Minimum average similarity_pct required to apply any memory influence. */
export const MEMORY_MIN_AVG_SIMILARITY = 40;

/** Fractional agreement required among neighbors to signal "support" or "contradiction". */
export const MEMORY_AGREEMENT_THRESHOLD = 0.6; // ≥ 60% of neighbors agree

/** Maximum positive confidence adjustment from memory. */
export const MEMORY_MAX_CONFIDENCE_BOOST = 5;

/** Maximum negative confidence adjustment from memory. */
export const MEMORY_MAX_CONFIDENCE_PENALTY = 10;

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * Snapshot of a single neighbor's key characteristics.
 * Stored for auditability — never used to overwrite base facts.
 */
export interface MemoryNeighborSnapshot {
  deal_id: string;
  verdict: string;
  scoreband_key: string;
  similarity_pct: number;
  ors: number;
}

/**
 * Verdict distribution among the neighbor pool.
 * All counts are non-negative integers that sum to neighbor_count.
 */
export interface NeighborVerdictMix {
  go: number;
  consider: number;
  no_go: number;
}

/**
 * Memory influence summary derived from similar deals.
 *
 * Safe to include in any internal/admin payload.
 * Must never be used to silently overwrite base scores.
 */
export interface MemoryInfluenceSummary {
  /** Number of neighbors evaluated. */
  similar_deal_count: number;

  /** Average similarity_pct across neighbors (0–100). */
  avg_similarity_pct: number;

  /** Per-verdict counts. */
  neighbor_verdict_mix: NeighborVerdictMix;

  /** Average ORS across neighbors. */
  avg_neighbor_ors: number;

  /**
   * True when a clear majority of neighbors agree with the current verdict.
   * Requires similar_deal_count ≥ MEMORY_MIN_NEIGHBORS and
   * avg_similarity_pct ≥ MEMORY_MIN_AVG_SIMILARITY.
   */
  memory_support_signal: boolean;

  /**
   * True when a clear majority of neighbors contradict the current verdict.
   * Same pool requirements as memory_support_signal.
   */
  memory_fragility_signal: boolean;

  /**
   * Fraction of neighbors that match current verdict (0.0 – 1.0).
   * 0 when pool is too small or similarity too weak.
   */
  verdict_agreement_fraction: number;

  /**
   * Confidence score adjustment derived from memory.
   * Positive = boost (max +5), Negative = penalty (max -10), 0 = no effect.
   * Always 0 when pool requirements are not met.
   */
  confidence_adjustment: number;

  /**
   * Human-readable explanation of the confidence adjustment.
   * Never empty — describes the reason or explains why no adjustment was made.
   */
  confidence_adjustment_reason: string;

  /**
   * Whether memory challenge context was used in the challenge pass.
   * Only true when pool requirements are met and a contradiction signal fires.
   */
  challenge_memory_used: boolean;

  /**
   * Narrative paragraph for challenge pass enrichment.
   * null when pool requirements are not met or no meaningful signal.
   */
  challenge_memory_summary: string | null;

  /** Ordered (descending similarity_pct) snapshots of all neighbors. */
  neighbor_snapshots: MemoryNeighborSnapshot[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function verdictBucket(verdict: string): keyof NeighborVerdictMix {
  const v = verdict.toUpperCase();
  if (v === "GO") return "go";
  if (v === "NO_GO") return "no_go";
  return "consider";
}

function currentVerdictBucket(verdict: string): keyof NeighborVerdictMix {
  return verdictBucket(verdict);
}

/**
 * Whether a given verdict is "positive" (GO or CONSIDER).
 * Used to detect when a current positive verdict is contradicted by mostly
 * NO_GO neighbors (the fragility signal).
 */
function isPositiveVerdict(verdict: string): boolean {
  const v = verdict.toUpperCase();
  return v === "GO" || v === "CONSIDER";
}

// ─── Main derivation ──────────────────────────────────────────────────────────

/**
 * Derive a MemoryInfluenceSummary from the neighbor pool for the current deal.
 *
 * @param similarDeals - Output of findSimilarDeals for the current deal.
 * @param currentVerdict - The base verdict already computed for the current deal.
 *
 * Safety guarantees (enforced here, not at call site):
 *   1. If pool too small (< MEMORY_MIN_NEIGHBORS): all influence is zero/false.
 *   2. If avg similarity too weak (< MEMORY_MIN_AVG_SIMILARITY): all influence is zero/false.
 *   3. adjustment is clamped to [−MEMORY_MAX_CONFIDENCE_PENALTY, +MEMORY_MAX_CONFIDENCE_BOOST].
 *   4. Memory never alters base ORS, verdict, or extracted facts — this function
 *      only derives advisory signals.
 */
export function deriveMemoryInfluence(
  similarDeals: SimilarDeal[],
  currentVerdict: string
): MemoryInfluenceSummary {
  const noInfluence = (reason: string): MemoryInfluenceSummary => ({
    similar_deal_count: similarDeals.length,
    avg_similarity_pct: 0,
    neighbor_verdict_mix: { go: 0, consider: 0, no_go: 0 },
    avg_neighbor_ors: 0,
    memory_support_signal: false,
    memory_fragility_signal: false,
    verdict_agreement_fraction: 0,
    confidence_adjustment: 0,
    confidence_adjustment_reason: reason,
    challenge_memory_used: false,
    challenge_memory_summary: null,
    neighbor_snapshots: [],
  });

  // ── Guard: pool too small ────
  if (similarDeals.length < MEMORY_MIN_NEIGHBORS) {
    return noInfluence(
      similarDeals.length === 0
        ? "No memory adjustment applied: no similar deals in pool."
        : `No memory adjustment applied: pool too small (${similarDeals.length} neighbor(s), minimum ${MEMORY_MIN_NEIGHBORS} required).`
    );
  }

  // ── Compute pool statistics ────
  const avgSim =
    similarDeals.reduce((s, d) => s + d.similarity_pct, 0) / similarDeals.length;

  // ── Guard: similarity too weak ────
  if (avgSim < MEMORY_MIN_AVG_SIMILARITY) {
    return noInfluence(
      `No memory adjustment applied: average similarity too low (${Math.round(avgSim)}%, minimum ${MEMORY_MIN_AVG_SIMILARITY}% required).`
    );
  }

  // ── Guard: non-positive verdict ────
  // Support and fragility signals are only meaningful for positive verdicts
  // (GO or CONSIDER). A NO_GO deal cannot benefit from support, and the
  // concept of a "fragility" signal (optimism relative to NO_GO neighbors)
  // does not apply when the current verdict is already negative.
  // This guard runs AFTER the pool/similarity checks so the neighbor stats
  // are still computed and logged below — only influence is suppressed.
  if (!isPositiveVerdict(currentVerdict)) {
    return noInfluence(
      `No memory confidence adjustment: current verdict is ${currentVerdict}, and memory influence is only applied to positive verdicts (GO or CONSIDER).`
    );
  }

  // ── Derive verdict mix ────
  const verdictMix: NeighborVerdictMix = { go: 0, consider: 0, no_go: 0 };
  let orsSum = 0;
  for (const d of similarDeals) {
    verdictMix[verdictBucket(d.verdict)]++;
    orsSum += d.score_snapshot.ors;
  }
  const avgNeighborOrs = orsSum / similarDeals.length;

  // ── Compute agreement ────
  const currentBucket = currentVerdictBucket(currentVerdict);
  const agreementCount = verdictMix[currentBucket];
  const agreementFraction = agreementCount / similarDeals.length;

  const noGoCount = verdictMix.no_go;
  const noGoFraction = noGoCount / similarDeals.length;

  // ── Support signal ────
  // Majority of neighbors match current verdict AND current verdict is positive.
  const supportSignal =
    isPositiveVerdict(currentVerdict) &&
    agreementFraction >= MEMORY_AGREEMENT_THRESHOLD;

  // ── Fragility signal ────
  // Current deal has a positive verdict BUT majority of neighbors are NO_GO.
  const fragilitySignal =
    isPositiveVerdict(currentVerdict) &&
    noGoFraction >= MEMORY_AGREEMENT_THRESHOLD;

  // ── Confidence adjustment ────
  let adjustment = 0;
  let adjustmentReason: string;

  if (fragilitySignal) {
    const noGoNames = similarDeals
      .filter((d) => d.verdict.toUpperCase() === "NO_GO")
      .slice(0, 3)
      .map((d) => `${d.deal_id.slice(0, 8)} (ORS ${d.score_snapshot.ors})`)
      .join(", ");
    adjustment = -MEMORY_MAX_CONFIDENCE_PENALTY;
    adjustmentReason =
      `Confidence reduced: ${noGoCount} of ${similarDeals.length} nearest similar deals are NO_GO profiles` +
      ` (avg ORS ${Math.round(avgNeighborOrs)}).` +
      (noGoNames ? ` Comparable neighbors: ${noGoNames}.` : "");
  } else if (supportSignal) {
    const n = agreementCount;
    adjustment = MEMORY_MAX_CONFIDENCE_BOOST;
    adjustmentReason =
      `Confidence increased: ${n} of ${similarDeals.length} nearest similar deals support the current ${currentVerdict} verdict` +
      ` (avg similarity ${Math.round(avgSim)}%, avg ORS ${Math.round(avgNeighborOrs)}).`;
  } else {
    adjustmentReason =
      `No memory confidence adjustment: neighbor verdict mix is inconclusive` +
      ` (${agreementFraction * 100 | 0}% agreement, threshold ${MEMORY_AGREEMENT_THRESHOLD * 100}%).`;
    adjustment = 0;
  }

  // Clamp as a final safety guard (should already be within bounds above).
  adjustment = Math.max(
    -MEMORY_MAX_CONFIDENCE_PENALTY,
    Math.min(MEMORY_MAX_CONFIDENCE_BOOST, adjustment)
  );

  // ── Challenge memory ────
  let challengeMemoryUsed = false;
  let challengeMemorySummary: string | null = null;

  if (fragilitySignal) {
    challengeMemoryUsed = true;
    const avgSimStr = Math.round(avgSim);
    const avgOrsStr = Math.round(avgNeighborOrs);
    challengeMemorySummary =
      `This deal clusters with ${noGoCount} prior deal(s) that received a NO_GO verdict` +
      ` (avg ORS ${avgOrsStr}, avg similarity ${avgSimStr}% on structural profile).` +
      " Current verdict appears optimistic relative to similar historical profiles." +
      " Note: this reflects structural similarity only — no outcome data has been used.";
  } else if (supportSignal) {
    // Supportive memory is noted but doesn't generate a bear case paragraph.
    challengeMemoryUsed = false;
    challengeMemorySummary = null;
  }

  // ── Neighbor snapshots (ordered by descending similarity) ────
  const neighborSnapshots: MemoryNeighborSnapshot[] = [...similarDeals]
    .sort((a, b) => b.similarity_pct - a.similarity_pct)
    .map((d) => ({
      deal_id: d.deal_id,
      verdict: d.verdict,
      scoreband_key: d.scoreband_key,
      similarity_pct: d.similarity_pct,
      ors: d.score_snapshot.ors,
    }));

  return {
    similar_deal_count: similarDeals.length,
    avg_similarity_pct: Math.round(avgSim),
    neighbor_verdict_mix: verdictMix,
    avg_neighbor_ors: Math.round(avgNeighborOrs),
    memory_support_signal: supportSignal,
    memory_fragility_signal: fragilitySignal,
    verdict_agreement_fraction: agreementFraction,
    confidence_adjustment: adjustment,
    confidence_adjustment_reason: adjustmentReason,
    challenge_memory_used: challengeMemoryUsed,
    challenge_memory_summary: challengeMemorySummary,
    neighbor_snapshots: neighborSnapshots,
  };
}
