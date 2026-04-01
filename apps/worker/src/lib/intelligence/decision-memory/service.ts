/**
 * Decision Memory — Service
 *
 * Public API for the decision memory subsystem.
 * Orchestrates vectorizer → repository → matcher.
 */

import type { Pool } from "pg";
import type { MemorySnapshot, SimilarDeal, FindSimilarDealsOptions } from "./types.js";
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
