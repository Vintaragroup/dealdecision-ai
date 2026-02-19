import type { DimensionKey } from "./stage-weight-matrix";
import { getStageWeightMatrix } from "./stage-weight-matrix";
import type { StageWeightedScoreInputsV1 } from "./stage-weighted-score-inputs-v1";

export type DimensionScoreV1 = {
  key: DimensionKey;
  score_0_100: number;
  weight: number;
  weighted_points: number;
  present: boolean;
  confidence: number;
  evidence_ids: string[];
  notes?: string[];
};

export type StageWeightedScoringV1 = {
  stage: StageWeightedScoreInputsV1["stage"];
  weights: Record<DimensionKey, number>;
  score_0_100: number;
  dimensions: DimensionScoreV1[];
  signals_used?: string[];
  notes?: string[];
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clamp0_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function baseScoreFromSignal(present: boolean, confidence: number): number {
  const c = clamp01(confidence);
  if (!present) {
    // Missing signal: keep deterministic but not fatal.
    return 20 + 30 * c; // 20..50
  }
  // Present: reward confidence.
  return 55 + 45 * c; // 55..100
}

function businessModelPenalty(stage: StageWeightedScoreInputsV1["stage"], code: string): number {
  const s = String(stage);
  const isAbsent = code === "business_model_absent";

  if (isAbsent) {
    if (s === "seed") return 20;
    if (s === "series_a") return 20;
    if (s === "growth") return 15;
    if (s === "pre_seed") return 8;
    return 12; // unknown
  }

  // Missing sub-signal
  if (s === "pre_seed") return 4;
  if (s === "unknown") return 6;
  return 8; // seed/series_a/growth
}

function tractionPenalty(stage: StageWeightedScoreInputsV1["stage"], code: string): number {
  const s = String(stage);
  if (code === "tam_without_traction") {
    if (s === "seed" || s === "series_a") return 20;
    return 0;
  }
  if (code === "forecast_without_history") return 15;
  if (code === "growth_without_recurring_revenue") return s === "growth" ? 15 : 0;
  return 0;
}

function marketPenalty(stage: StageWeightedScoreInputsV1["stage"], code: string): number {
  const s = String(stage);
  if (code === "tam_without_icp") {
    if (s === "seed" || s === "series_a") return 15;
    if (s === "pre_seed") return 8;
    return 0;
  }
  if (code === "tam_without_distribution") {
    if (s === "seed" || s === "series_a") return 15;
    return 0;
  }
  if (code === "missing_som") {
    return s === "pre_seed" ? 0 : 8;
  }
  return 0;
}

export function scoreStageWeightedV1(inputs: StageWeightedScoreInputsV1): StageWeightedScoringV1 {
  const weights = getStageWeightMatrix(inputs.stage);
  const dimensions: DimensionScoreV1[] = [];

  const keys = Object.keys(weights) as DimensionKey[];
  for (const key of keys) {
    const w = weights[key];
    const signal = inputs.signals[key];
    let score = clamp0_100(baseScoreFromSignal(signal.present, signal.confidence));

    // Business model: apply deterministic penalties driven by BusinessModelSignalProfileV1 notes.
    let notes = Array.isArray(signal.notes) ? [...signal.notes] : [];
    if (key === "business_model") {
      if (!signal.present) {
        score = clamp0_100(score - businessModelPenalty(inputs.stage, "business_model_absent"));
        notes.push("business_model_absent");
      } else {
        const missingCodes = new Set([
          "bm_pricing_missing",
          "bm_revenue_model_missing",
          "bm_customer_segment_missing",
          "bm_monetization_missing",
        ]);
        const missing = notes.filter((n) => missingCodes.has(String(n)));
        for (const code of missing) {
          score = clamp0_100(score - businessModelPenalty(inputs.stage, String(code)));
        }
      }
    }

    if (key === "traction") {
      const ruleCodes = new Set([
        "tam_without_traction",
        "forecast_without_history",
        "growth_without_recurring_revenue",
      ]);
      const hit = notes.filter((n) => ruleCodes.has(String(n)));
      for (const code of hit) {
        const p = tractionPenalty(inputs.stage, String(code));
        if (p > 0) score = clamp0_100(score - p);
      }
    }

    if (key === "market") {
      const ruleCodes = new Set(["tam_without_icp", "tam_without_distribution", "missing_som"]);
      const hit = notes.filter((n) => ruleCodes.has(String(n)));
      for (const code of hit) {
        const p = marketPenalty(inputs.stage, String(code));
        if (p > 0) score = clamp0_100(score - p);
      }
    }

    const weightedPoints = score * w;

    dimensions.push({
      key,
      score_0_100: round2(score),
      weight: round2(w),
      weighted_points: round2(weightedPoints),
      present: signal.present,
      confidence: round2(clamp01(signal.confidence)),
      evidence_ids: signal.evidence_ids,
      notes: notes.length ? notes : undefined,
    });
  }

  const total = dimensions.reduce((sum, d) => sum + d.weighted_points, 0);
  const score_0_100 = round2(clamp0_100(total));
  const notes = inputs.stage === "unknown" ? ["unknown stage: equal weights"] : [];

  return {
    stage: inputs.stage,
    weights,
    score_0_100,
    dimensions,
    signals_used: Array.isArray((inputs as any).signals_used) ? (inputs as any).signals_used : undefined,
    notes: notes.length ? notes : undefined,
  };
}
