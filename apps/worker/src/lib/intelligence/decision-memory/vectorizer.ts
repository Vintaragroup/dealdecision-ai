/**
 * Decision Memory — Vectorizer
 *
 * Converts a raw deal snapshot into a normalized 18-dimension feature vector.
 * Pure function: no I/O, no side effects, deterministic.
 *
 * Vector dimensions:
 *  0: ORS score (0–1)
 *  1: DCI score (0–1)
 *  2: FHC score (0–1)
 *  3: URSS score inverted (0–1, 1=low risk)
 *  4: ARR value (log-normalized)
 *  5: Burn rate monthly (log-normalized)
 *  6: Runway months (0–36mo range, clamped)
 *  7: Raise amount (log-normalized)
 *  8: Evidence count (0–100)
 *  9: Contradiction count (0–10)
 * 10: Financial completeness pct (0–1)
 * 11: Key risk count (0–10)
 * 12: Key strength count (0–10)
 * 13: Stage encoding (Seed=0.2, SeriesA=0.6, Growth=1.0, Unknown=0.4)
 * 14: Has XLSX (0 or 1)
 * 15: Document quality score (0–1)
 * 16: Verdict encoding (GO=1.0, CONSIDER=0.5, NO_GO=0.0)
 * 17: Risk/strength ratio (0–1)
 */

import type { MemorySnapshot } from "./types.js";

const VECTOR_DIMENSIONS = 18;
const NULL_FILL = 0.5; // neutral mid-range fill for missing values

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Log-normalize a value on a scale from 0 to logCap.
 * Returns 0 if value is null/0/negative.
 * Returns 1 if value >= cap.
 */
function normalizeLog(value: number | null, cap: number): number {
  if (value == null || value <= 0 || cap <= 0) return NULL_FILL;
  return clamp(Math.log1p(value) / Math.log1p(cap), 0, 1);
}

function encodeStage(stage: string | null): number {
  switch (stage) {
    case "Seed": return 0.2;
    case "SeriesA": return 0.6;
    case "Growth": return 1.0;
    default: return 0.4; // Unknown — mid-range
  }
}

function encodeVerdict(verdict: string | null): number {
  switch (verdict) {
    case "GO": return 1.0;
    case "CONSIDER": return 0.5;
    case "NO_GO": return 0.0;
    default: return 0.5;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface VectorizeResult {
  vector: number[];
  null_mask: boolean[];  // true = this dimension was null-substituted
}

/**
 * Build a normalized 18-dimension feature vector from a deal snapshot.
 */
export function vectorizeMemorySnapshot(snapshot: {
  ors_score: number;
  dci_score: number;
  fhc_score: number;
  urss_score: number;
  arr_value: number | null;
  burn_rate_monthly: number | null;
  runway_months: number | null;
  raise_amount: number | null;
  evidence_count: number;
  contradiction_count: number;
  financial_completeness_pct: number;
  key_risk_count: number;
  key_strength_count: number;
  stage: string;
  has_xlsx: boolean;
  document_quality_score: number;
  verdict: string;
}): VectorizeResult {
  const nulls: boolean[] = new Array(VECTOR_DIMENSIONS).fill(false);

  function maybeNull(val: number | null, dim: number, fallback: number): number {
    if (val == null) { nulls[dim] = true; return fallback; }
    return val;
  }

  const riskStrengthRatio = (() => {
    const total = snapshot.key_risk_count + snapshot.key_strength_count;
    if (total === 0) { nulls[17] = true; return NULL_FILL; }
    return clamp(snapshot.key_risk_count / total, 0, 1);
  })();

  const vector: number[] = [
    clamp(snapshot.ors_score / 100, 0, 1),              // 0
    clamp(snapshot.dci_score / 100, 0, 1),              // 1
    clamp(snapshot.fhc_score / 100, 0, 1),              // 2
    clamp(1 - snapshot.urss_score / 100, 0, 1),         // 3: inverted
    (() => { const v = normalizeLog(snapshot.arr_value, 1e7); if (snapshot.arr_value == null) nulls[4] = true; return v; })(),   // 4
    (() => { const v = normalizeLog(snapshot.burn_rate_monthly, 5e5); if (snapshot.burn_rate_monthly == null) nulls[5] = true; return v; })(), // 5
    (() => { if (snapshot.runway_months == null) { nulls[6] = true; return NULL_FILL; } return clamp(snapshot.runway_months / 36, 0, 1); })(), // 6
    (() => { const v = normalizeLog(snapshot.raise_amount, 1e7); if (snapshot.raise_amount == null) nulls[7] = true; return v; })(), // 7
    clamp(snapshot.evidence_count / 100, 0, 1),         // 8
    clamp(snapshot.contradiction_count / 10, 0, 1),     // 9
    clamp(snapshot.financial_completeness_pct / 100, 0, 1), // 10
    clamp(snapshot.key_risk_count / 10, 0, 1),          // 11
    clamp(snapshot.key_strength_count / 10, 0, 1),      // 12
    encodeStage(snapshot.stage),                        // 13
    snapshot.has_xlsx ? 1 : 0,                         // 14
    clamp(snapshot.document_quality_score / 100, 0, 1), // 15
    encodeVerdict(snapshot.verdict),                    // 16
    riskStrengthRatio,                                  // 17
  ];

  return { vector, null_mask: nulls };
}

// ─── Dimension weights for similarity ─────────────────────────────────────────

/**
 * Weights used in weighted Euclidean distance computation.
 * Score dimensions are double-weighted.
 */
export const VECTOR_DIMENSION_WEIGHTS: number[] = [
  2.0, // 0: ORS
  2.0, // 1: DCI
  2.0, // 2: FHC
  2.0, // 3: URSS
  1.0, // 4: ARR
  1.0, // 5: Burn
  1.0, // 6: Runway
  1.0, // 7: Raise
  0.5, // 8: Evidence
  1.0, // 9: Contradictions
  1.0, // 10: Financial completeness
  0.75, // 11: Risk count
  0.75, // 12: Strength count
  1.0, // 13: Stage
  0.5, // 14: Has XLSX
  0.5, // 15: Doc quality
  1.5, // 16: Verdict
  0.5, // 17: Risk/strength ratio
];

// ─── Dimension labels (for match reason generation) ───────────────────────────

export const VECTOR_DIMENSION_LABELS: string[] = [
  "ORS score",                   // 0
  "DCI (document quality)",      // 1
  "FHC (financial health)",      // 2
  "URSS (risk severity)",        // 3
  "ARR traction band",           // 4
  "Monthly burn rate",           // 5
  "Runway length",               // 6
  "Raise amount",                // 7
  "Evidence depth",              // 8
  "Contradiction count",         // 9
  "Financial completeness",      // 10
  "Risk count",                  // 11
  "Strength count",              // 12
  "Stage",                       // 13
  "Structured XLSX presence",    // 14
  "Document quality score",      // 15
  "Verdict",                     // 16
  "Risk-to-strength ratio",      // 17
];
