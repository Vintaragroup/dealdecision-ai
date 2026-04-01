/**
 * Decision Memory — Repository
 *
 * DB read/write for deal_decision_memory table.
 */

import type { Pool } from "pg";
import type { MemorySnapshot } from "./types.js";
import type { StoredMemoryRow } from "./matcher.js";

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Upsert a decision memory snapshot. Keyed on (deal_id, upstream_fingerprint).
 * Returns the inserted/updated row id.
 */
export async function upsertMemorySnapshot(
  pool: Pool,
  snapshot: MemorySnapshot
): Promise<string> {
  const {
    deal_id, org_id, analysis_version, engine_version, upstream_fingerprint,
    ors_score, dci_score, fhc_score, urss_score, scoreband_key, verdict,
    stage, sector,
    arr_value, mrr_value, burn_rate_monthly, runway_months, raise_amount,
    evidence_count, contradiction_count, key_risk_count, key_strength_count,
    financial_completeness_pct, document_quality_score, has_xlsx,
    feature_vector, vector_null_mask,
  } = snapshot;

  const result = await pool.query<{ id: string }>(
    `INSERT INTO deal_decision_memory (
       deal_id, org_id, analysis_version, engine_version, upstream_fingerprint,
       ors_score, dci_score, fhc_score, urss_score, scoreband_key, verdict,
       stage, sector,
       arr_value, mrr_value, burn_rate_monthly, runway_months, raise_amount,
       evidence_count, contradiction_count, key_risk_count, key_strength_count,
       financial_completeness_pct, document_quality_score, has_xlsx,
       feature_vector, vector_null_mask
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$24,$25,$26,$27
     )
     ON CONFLICT (deal_id, upstream_fingerprint) DO UPDATE SET
       analysis_version        = EXCLUDED.analysis_version,
       ors_score               = EXCLUDED.ors_score,
       dci_score               = EXCLUDED.dci_score,
       fhc_score               = EXCLUDED.fhc_score,
       urss_score              = EXCLUDED.urss_score,
       scoreband_key           = EXCLUDED.scoreband_key,
       verdict                 = EXCLUDED.verdict,
       stage                   = EXCLUDED.stage,
       sector                  = EXCLUDED.sector,
       arr_value               = EXCLUDED.arr_value,
       mrr_value               = EXCLUDED.mrr_value,
       burn_rate_monthly       = EXCLUDED.burn_rate_monthly,
       runway_months           = EXCLUDED.runway_months,
       raise_amount            = EXCLUDED.raise_amount,
       evidence_count          = EXCLUDED.evidence_count,
       contradiction_count     = EXCLUDED.contradiction_count,
       key_risk_count          = EXCLUDED.key_risk_count,
       key_strength_count      = EXCLUDED.key_strength_count,
       financial_completeness_pct = EXCLUDED.financial_completeness_pct,
       document_quality_score  = EXCLUDED.document_quality_score,
       has_xlsx                = EXCLUDED.has_xlsx,
       feature_vector          = EXCLUDED.feature_vector,
       vector_null_mask        = EXCLUDED.vector_null_mask,
       updated_at              = now()
     RETURNING id`,
    [
      deal_id, org_id, analysis_version, engine_version, upstream_fingerprint,
      ors_score, dci_score, fhc_score, urss_score, scoreband_key, verdict,
      stage, sector,
      arr_value, mrr_value, burn_rate_monthly, runway_months, raise_amount,
      evidence_count, contradiction_count, key_risk_count, key_strength_count,
      financial_completeness_pct, document_quality_score, has_xlsx,
      JSON.stringify(feature_vector), JSON.stringify(vector_null_mask),
    ]
  );
  return result.rows[0].id;
}

// ─── Fetch for similarity ─────────────────────────────────────────────────────

/**
 * Retrieve all memory rows for an org (excluding the current deal),
 * ordered by most recent first. Used as input to the similarity matcher.
 */
export async function fetchOrgMemoryRows(
  pool: Pool,
  orgId: string | null,
  excludeDealId: string,
  limit = 500
): Promise<StoredMemoryRow[]> {
  // If org_id is null, match only on deal_id exclusion (useful for single-org setups)
  const query = orgId
    ? `SELECT deal_id, feature_vector, ors_score, dci_score, fhc_score, urss_score, verdict, scoreband_key
         FROM deal_decision_memory
        WHERE org_id = $1 AND deal_id != $2
        ORDER BY updated_at DESC
        LIMIT $3`
    : `SELECT deal_id, feature_vector, ors_score, dci_score, fhc_score, urss_score, verdict, scoreband_key
         FROM deal_decision_memory
        WHERE deal_id != $1
        ORDER BY updated_at DESC
        LIMIT $2`;

  const params = orgId
    ? [orgId, excludeDealId, limit]
    : [excludeDealId, limit];

  const result = await pool.query<StoredMemoryRow>(query, params);

  return result.rows.map((row) => ({
    ...row,
    feature_vector: Array.isArray(row.feature_vector)
      ? row.feature_vector
      : JSON.parse(row.feature_vector as unknown as string),
  }));
}

// ─── Fetch by id ──────────────────────────────────────────────────────────────

export async function fetchMemorySnapshotId(
  pool: Pool,
  dealId: string,
  upstreamFingerprint: string
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM deal_decision_memory WHERE deal_id = $1 AND upstream_fingerprint = $2 LIMIT 1`,
    [dealId, upstreamFingerprint]
  );
  return result.rows[0]?.id ?? null;
}
