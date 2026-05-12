/**
 * business-quality-v2.ts
 *
 * Phase 2: computes the BusinessQualityV2 artifact from available report signals.
 *
 * Formula
 * ───────
 * IF XLSX present (financial_health_proxy non-null):
 *   BQ = 0.60 * dimension_score + 0.30 * financial_health_proxy + 0.10 * market_proxy
 * ELSE:
 *   BQ = 0.70 * dimension_score + 0.30 * market_proxy
 *
 * Where:
 *   dimension_score     = score_band_v2.overall_score  (stage-weighted dimension scorer output)
 *   financial_health_proxy = underwriting_readiness_v1.score_0_100  (financial health — XLSX-backed)
 *   market_proxy        = coverage_ratio * 100  (document coverage signal)
 *
 * Output maps `stub: false` on the returned object.
 */

import type { BusinessQualityBandV2 } from '../models/scoring-v2-stubs.js';
import { BUSINESS_QUALITY_BAND_LABELS } from '../models/scoring-v2-stubs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessQualityV2Input {
  /** Stage-weighted dimension scorer output (0–100). Required. */
  dimension_score: number;
  /** Underwriting readiness score_0_100 (0–100). Null when no XLSX data. */
  financial_health_proxy: number | null;
  /** coverage_ratio × 100 (0–100). Null defaults to 50 (neutral). */
  market_proxy: number | null;
  /**
   * Per-dimension breakdown (score_0_100) from the dimension scorer.
   * Optional — passed through to breakdown when available.
   */
  dimension_scores?: {
    market?: number | null;
    product?: number | null;
    traction?: number | null;
    business_model?: number | null;
    team?: number | null;
  } | null;
}

export interface BusinessQualityV2Result {
  score: number;
  band: BusinessQualityBandV2;
  band_label: string;
  dimension_breakdown: {
    market: number | null;
    product: number | null;
    traction: number | null;
    business_model: number | null;
    team: number | null;
  };
  /** Financial health proxy used in weighted formula (null when XLSX absent). */
  fhc: number | null;
  data_sources_used: string[];
  formula_weights: {
    dimension_score: number;
    financial_health: number | null;
    market_proxy: number;
  };
  /** Phase 2: always false. */
  stub: false;
  version: 'business_quality_v2';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function bqBandFromScore(score: number): BusinessQualityBandV2 {
  const s = Math.round(score);
  if (s >= 85) return 'exceptional';
  if (s >= 75) return 'fund_grade';
  if (s >= 65) return 'strong_opportunity';
  if (s >= 55) return 'emerging_opportunity';
  if (s >= 45) return 'early_consideration';
  return 'not_investment_grade';
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeBusinessQualityV2(input: BusinessQualityV2Input): BusinessQualityV2Result {
  const dim = clamp(input.dimension_score);
  const fhc = input.financial_health_proxy !== null && Number.isFinite(input.financial_health_proxy)
    ? clamp(input.financial_health_proxy)
    : null;
  // Market proxy: default to 50 (neutral) when absent
  const mkt = input.market_proxy !== null && Number.isFinite(input.market_proxy ?? NaN)
    ? clamp(input.market_proxy as number)
    : 50;

  const xlsxPresent = fhc !== null;
  const dataSources: string[] = ['score_band_v2.overall_score'];

  let bqScore: number;
  let weights: BusinessQualityV2Result['formula_weights'];

  if (xlsxPresent) {
    dataSources.push('underwriting_readiness_v1.score_0_100', 'score_explanation.totals.coverage_ratio');
    bqScore = 0.60 * dim + 0.30 * fhc + 0.10 * mkt;
    weights = { dimension_score: 0.60, financial_health: 0.30, market_proxy: 0.10 };
  } else {
    dataSources.push('score_explanation.totals.coverage_ratio');
    bqScore = 0.70 * dim + 0.30 * mkt;
    weights = { dimension_score: 0.70, financial_health: null, market_proxy: 0.30 };
  }

  const score = round1(clamp(bqScore));
  const band = bqBandFromScore(score);
  const ds = input.dimension_scores ?? null;

  return {
    score,
    band,
    band_label: BUSINESS_QUALITY_BAND_LABELS[band],
    dimension_breakdown: {
      market:         ds?.market         ?? null,
      product:        ds?.product        ?? null,
      traction:       ds?.traction       ?? null,
      business_model: ds?.business_model ?? null,
      team:           ds?.team           ?? null,
    },
    fhc,
    data_sources_used: dataSources,
    formula_weights: weights,
    stub: false,
    version: 'business_quality_v2',
  };
}
