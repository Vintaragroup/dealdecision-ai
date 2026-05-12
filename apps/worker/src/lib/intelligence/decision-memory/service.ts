/**
 * Decision Memory — Service
 *
 * Public API for the decision memory subsystem.
 * Orchestrates vectorizer → repository → matcher.
 */

import type { Pool } from "pg";
import type { MemorySnapshot, SimilarDeal, FindSimilarDealsOptions } from "./types.js";
import type { MemoryNeighborSnapshot } from "./influence.js";
import { vectorizeMemorySnapshot } from "./vectorizer.js";
import { findSimilarDeals } from "./matcher.js";
import {
  upsertMemorySnapshot,
  fetchOrgMemoryRows,
  fetchMemorySnapshotId,
} from "./repository.js";

// ─── Build snapshot ───────────────────────────────────────────────────────────

export function buildMemorySnapshot(opts: {
  deal_id: string;
  org_id: string | null;
  analysis_version: number;
  engine_version: string;
  upstream_fingerprint: string;
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  scoreband_key: string;
  verdict: string;
  stage: string;
  sector: string | null;
  arr_value: number | null;
  mrr_value: number | null;
  burn_rate_monthly: number | null;
  runway_months: number | null;
  raise_amount: number | null;
  evidence_count: number;
  contradiction_count: number;
  key_risk_count: number;
  key_strength_count: number;
  financial_completeness_pct: number;
  document_quality_score: number;
  has_xlsx: boolean;
}): MemorySnapshot {
  const { vector, null_mask } = vectorizeMemorySnapshot(opts);
  return {
    ...opts,
    feature_vector: vector,
    vector_null_mask: null_mask,
  };
}

// ─── Persist + retrieve similar ───────────────────────────────────────────────

export async function persistAndRecallMemory(
  pool: Pool,
  snapshot: MemorySnapshot,
  opts: { top_n?: number } = {}
): Promise<{
  memory_snapshot_id: string;
  similar_deals: SimilarDeal[];
}> {
  // 1. Persist the snapshot
  const memory_snapshot_id = await upsertMemorySnapshot(pool, snapshot);

  // 2. Fetch historical rows for this org (excluding this deal)
  const historicalRows = await fetchOrgMemoryRows(
    pool,
    snapshot.org_id,
    snapshot.deal_id
  );

  // 3. Compute similarity
  const similar_deals = findSimilarDeals(
    snapshot.feature_vector,
    historicalRows,
    {
      deal_id: snapshot.deal_id,
      top_n: opts.top_n ?? 5,
    }
  );

  return { memory_snapshot_id, similar_deals };
}

// ─── Persist memory influence snapshot ───────────────────────────────────────

/**
 * Persists the computed memory influence summary to deal_memory_snapshots.
 *
 * Called by Stage 5 after deriveMemoryInfluence() so that reviewers can
 * answer "why did memory boost (or not boost) this deal?" without reading logs.
 *
 * Non-throwing — caller must wrap in try/catch.
 */
export async function persistMemoryInfluenceSnapshot(
  pool: Pool,
  opts: {
    deal_id: string;
    intelligence_run_id: string;
    similar_deal_count: number;
    avg_similarity_pct: number;
    verdict_agreement_fraction: number;
    memory_support_signal: boolean;
    memory_fragility_signal: boolean;
    confidence_adjustment: number;
    neighbor_snapshots: MemoryNeighborSnapshot[];
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO deal_memory_snapshots
       (deal_id, intelligence_run_id, similar_deal_count, avg_similarity_pct,
        verdict_agreement_fraction, memory_support_signal, memory_fragility_signal,
        confidence_adjustment, neighbor_snapshots)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (deal_id, intelligence_run_id) DO UPDATE SET
       similar_deal_count         = EXCLUDED.similar_deal_count,
       avg_similarity_pct         = EXCLUDED.avg_similarity_pct,
       verdict_agreement_fraction = EXCLUDED.verdict_agreement_fraction,
       memory_support_signal      = EXCLUDED.memory_support_signal,
       memory_fragility_signal    = EXCLUDED.memory_fragility_signal,
       confidence_adjustment      = EXCLUDED.confidence_adjustment,
       neighbor_snapshots         = EXCLUDED.neighbor_snapshots`,
    [
      opts.deal_id,
      opts.intelligence_run_id,
      opts.similar_deal_count,
      opts.avg_similarity_pct,
      opts.verdict_agreement_fraction,
      opts.memory_support_signal,
      opts.memory_fragility_signal,
      opts.confidence_adjustment,
      JSON.stringify(opts.neighbor_snapshots),
    ]
  );
}
