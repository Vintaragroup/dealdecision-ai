/**
 * Scoring V2 — Phase 1 stub type contracts
 *
 * These types define the shape of V2 artifacts written during report enrichment.
 * All Phase 1 instances carry `stub: true` to distinguish them from the full
 * Phase 2 computed values.  No formula changes are implied by this file.
 *
 * Phase 2 will extend (not replace) these interfaces.
 */

// ─── Band / label vocabularies ────────────────────────────────────────────────

export type BusinessQualityBandV2 =
  | 'not_investment_grade'   // 0–44
  | 'early_consideration'    // 45–54
  | 'emerging_opportunity'   // 55–64
  | 'strong_opportunity'     // 65–74
  | 'fund_grade'             // 75–84
  | 'exceptional';           // 85–100

export type EvidenceQualityLabelV2 =
  | 'Strong Evidence'        // score 65–100
  | 'Adequate Evidence'      // score 40–64
  | 'Thin Evidence'          // score 20–39
  | 'Insufficient Evidence'; // score 0–19

export type ConvictionLabelV2 =
  | 'Strong Conviction'        // score 70–100
  | 'Moderate Conviction'      // score 45–69
  | 'Low Conviction'           // score 20–44
  | 'Insufficient Conviction'; // score 0–19

export type CanonicalVerdictV2 =
  | 'fund'
  | 'advance'
  | 'investigate'
  | 'pass'
  | 'hard_pass';

export type EvidenceGateResultV2 = 'clear' | 'caution' | 'capped' | 'blocked';
export type ConvictionGateResultV2 = 'clear' | 'capped' | 'hard_pass';

// ─── Band label display map ───────────────────────────────────────────────────

export const BUSINESS_QUALITY_BAND_LABELS: Record<BusinessQualityBandV2, string> = {
  not_investment_grade: 'Not Investment Grade',
  early_consideration: 'Early Consideration',
  emerging_opportunity: 'Emerging Opportunity',
  strong_opportunity: 'Strong Opportunity',
  fund_grade: 'Fund Grade',
  exceptional: 'Exceptional',
};

export const CANONICAL_VERDICT_LABELS: Record<CanonicalVerdictV2, string> = {
  fund: 'Fund',
  advance: 'Advance',
  investigate: 'Investigate',
  pass: 'Pass',
  hard_pass: 'Hard Pass',
};

// ─── Phase 1 stub interfaces ──────────────────────────────────────────────────

export interface BusinessQualityV2Stub {
  score: number;
  band: BusinessQualityBandV2;
  band_label: string;
  /** Phase 1: all dimensions null — dimension-scorer wired in Phase 2. */
  dimension_breakdown: {
    market: null;
    product: null;
    traction: null;
    business_model: null;
    team: null;
  };
  /** Phase 1: FHC not wired. */
  fhc: null;
  /** Phase 1: not computed. */
  data_sources_used: string[];
  /** Phase 1: not computed. */
  formula_weights: null;
  stub: true;
  source: 'score_band_v2';
  version: 'business_quality_v2';
}

export interface EvidenceQualityV2Stub {
  /** 0–100. Null when coverage_ratio is absent. */
  score: number | null;
  /** Null when score is null. */
  label: EvidenceQualityLabelV2 | null;
  /** Raw coverage_ratio stored for Phase 2 reference. */
  coverage_ratio: number | null;
  /** Phase 1: DCI not wired (lives in orchestrator report). */
  dci: null;
  /** Phase 1: confidence_engine not wired. */
  confidence_score: null;
  /** Phase 1: evaluation flags not wired — all zero. */
  flag_counts: { critical: number; error: number; warn: number };
  gate: {
    result: EvidenceGateResultV2;
    /** Phase 1: null. */
    reason: null;
    /** Phase 1: null. */
    effective_verdict_ceiling: null;
  };
  /** Phase 1: not computed. */
  missing_signals: string[];
  stub: true;
  source: 'coverage_ratio';
  version: 'evidence_quality_v2';
}

export interface ConvictionV2Stub {
  /** Null when conviction_v1 is absent. */
  score: number | null;
  /** Null when score is null. */
  label: ConvictionLabelV2 | null;
  /** Phase 1: challenge_pass not wired here. */
  verdict_resistance_score: null;
  /** Same as score — named for Phase 2 reference. */
  conviction_composite: number | null;
  /** Phase 1: not computed. */
  urss: null;
  /** Phase 1: not computed. */
  memory_influence: null;
  gate: {
    result: ConvictionGateResultV2;
    /** Phase 1: null. */
    reason: null;
    /** Phase 1: null. */
    effective_verdict_ceiling: null;
  };
  key_unknowns: string[];
  top_positive_contributors: Array<{
    key: string;
    label: string;
    score_delta_0_100: number | null;
  }>;
  top_negative_contributors: Array<{
    key: string;
    label: string;
    score_delta_0_100: number | null;
  }>;
  opposing_case: string | null;
  stub: true;
  source: 'conviction_v1';
  version: 'conviction_v2';
}

export interface CanonicalDecisionV2Stub {
  verdict: CanonicalVerdictV2;
  verdict_label: string;
  business_quality_score: number;
  business_quality_band: BusinessQualityBandV2;
  evidence_gate: EvidenceGateResultV2;
  conviction_gate: ConvictionGateResultV2;
  /** Phase 1: not computed. */
  confidence: null;
  /** Phase 1: not computed. */
  confidence_label: null;
  conflict_detected: boolean;
  hard_pass_guardrail_triggered: boolean;
  /** The decision_v1.recommendation_key this stub was derived from. */
  source_v1_decision_key: string;
  stub: true;
  version: 'canonical_v2';
  computed_at: string;
}
