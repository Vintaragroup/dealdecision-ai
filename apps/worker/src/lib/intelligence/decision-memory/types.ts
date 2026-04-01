/**
 * Decision Memory — Types
 */

// ─── Memory snapshot ──────────────────────────────────────────────────────────

export interface MemorySnapshot {
  deal_id: string;
  org_id: string | null;
  analysis_version: number;
  engine_version: string;
  upstream_fingerprint: string;

  // Scores
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  scoreband_key: string;
  verdict: string;

  // Deal profile
  stage: string;
  sector: string | null;

  // Financial signals
  arr_value: number | null;
  mrr_value: number | null;
  burn_rate_monthly: number | null;
  runway_months: number | null;
  raise_amount: number | null;

  // Evidence quality
  evidence_count: number;
  contradiction_count: number;
  key_risk_count: number;
  key_strength_count: number;
  financial_completeness_pct: number;
  document_quality_score: number;
  has_xlsx: boolean;

  // Feature vector
  feature_vector: number[];        // 18 dimensions, normalized 0–1
  vector_null_mask: boolean[];     // true = dimension was null-substituted
}

// ─── Similarity ───────────────────────────────────────────────────────────────

export interface SimilarDeal {
  deal_id: string;
  distance: number;                // Euclidean distance (weighted)
  similarity_pct: number;          // 0–100, derived from distance
  match_reasons: string[];         // human-readable per-dimension explanations
  score_snapshot: {
    ors: number;
    dci: number;
    fhc: number;
    urss: number;
  };
  verdict: string;
  scoreband_key: string;
}

export interface FindSimilarDealsOptions {
  deal_id: string;
  org_id: string | null;
  feature_vector: number[];
  top_n?: number;                  // default 5
  min_similarity_pct?: number;     // default 0 (no minimum)
}
