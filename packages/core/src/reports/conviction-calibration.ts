export type ConvictionFundingStage = "pre_seed" | "seed" | "series_a" | "growth" | "ipo" | "public_company" | "unknown";

type StageBucket = "early" | "standard" | "strict";

type PolicyAdjustment = {
  positive_weight_delta?: number;
  drag_weight_delta?: number;
  contradiction_penalty_multiplier?: number;
  coverage_drag_multiplier?: number;
};

export type StageCalibrationProfile = {
  // Scales drag from incomplete evidence at this stage.
  coverage_drag_multiplier: number;
  // Scales contradiction penalty at this stage.
  contradiction_penalty_multiplier: number;
  // Scales drag from unknown statuses at this stage.
  unknown_drag_multiplier: number;
  // Raises modulation floors for early-stage normalization.
  confidence_floor_lift: number;
  coverage_floor_lift: number;
  // Controlled floor for incomplete-but-plausible deals at this stage.
  plausible_score_floor: number;
  floor_positive_index_min: number;
  floor_max_contradiction_index: number;
};

export type ConvictionCalibration = {
  base_intercept: number;
  positive_weight: number;
  drag_weight: number;
  contradiction_penalty_weight: number;
  confidence_modulation_floor: number;
  coverage_modulation_floor: number;
  coverage_drag_scale: number;
  evidence_quality_drag_scale: number;
  unknown_drag_base: number;
  contradicted_drag_base: number;
  financial_unknown_drag: number;
  contradiction_severity_weight: {
    low: number;
    medium: number;
    high: number;
  };
  contradiction_low_confidence_cap: number;
  contradiction_low_confidence_threshold: number;
  stage_profile: StageCalibrationProfile;
};

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const clampWeight = (n: number, fallback: number): number => {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(2, n));
};

const BASE_CALIBRATION = {
  base_intercept: 0.18,
  positive_weight: 0.88,
  drag_weight: 0.30,
  contradiction_penalty_weight: 11,
  confidence_modulation_floor: 0.68,
  coverage_modulation_floor: 0.70,
  coverage_drag_scale: 0.72,
  evidence_quality_drag_scale: 0.62,
  unknown_drag_base: 0.045,
  contradicted_drag_base: 0.38,
  financial_unknown_drag: 0.08,
  contradiction_severity_weight: {
    low: 0.24,
    medium: 0.56,
    high: 0.92,
  },
  contradiction_low_confidence_cap: 0.55,
  contradiction_low_confidence_threshold: 0.52,
} as const;

const STAGE_PROFILES: Record<StageBucket, StageCalibrationProfile> = {
  early: {
    coverage_drag_multiplier: 0.72,
    contradiction_penalty_multiplier: 0.78,
    unknown_drag_multiplier: 0.75,
    confidence_floor_lift: 0.08,
    coverage_floor_lift: 0.08,
    plausible_score_floor: 36,
    floor_positive_index_min: 0.43,
    floor_max_contradiction_index: 0.52,
  },
  standard: {
    coverage_drag_multiplier: 0.90,
    contradiction_penalty_multiplier: 0.95,
    unknown_drag_multiplier: 0.92,
    confidence_floor_lift: 0.03,
    coverage_floor_lift: 0.03,
    plausible_score_floor: 30,
    floor_positive_index_min: 0.46,
    floor_max_contradiction_index: 0.48,
  },
  strict: {
    coverage_drag_multiplier: 1.0,
    contradiction_penalty_multiplier: 1.05,
    unknown_drag_multiplier: 1.0,
    confidence_floor_lift: 0,
    coverage_floor_lift: 0,
    plausible_score_floor: 24,
    floor_positive_index_min: 0.50,
    floor_max_contradiction_index: 0.42,
  },
};

const POLICY_ADJUSTMENTS: Record<string, PolicyAdjustment> = {
  real_estate_underwriting: {
    positive_weight_delta: 0.03,
    drag_weight_delta: -0.02,
    contradiction_penalty_multiplier: 0.92,
    coverage_drag_multiplier: 0.90,
  },
  execution_ready_v1: {
    positive_weight_delta: 0.01,
    drag_weight_delta: -0.01,
  },
};

function stageBucket(stage: ConvictionFundingStage): StageBucket {
  if (stage === "pre_seed" || stage === "seed") return "early";
  if (stage === "series_a") return "standard";
  return "strict";
}

export function getConvictionCalibration(policyId: string | null, stage: ConvictionFundingStage): ConvictionCalibration {
  const profile = STAGE_PROFILES[stageBucket(stage)];
  const policy = POLICY_ADJUSTMENTS[policyId ?? ""];

  const positiveWeight = clampWeight(
    BASE_CALIBRATION.positive_weight + (policy?.positive_weight_delta ?? 0),
    BASE_CALIBRATION.positive_weight,
  );

  const dragWeight = clampWeight(
    BASE_CALIBRATION.drag_weight + (policy?.drag_weight_delta ?? 0),
    BASE_CALIBRATION.drag_weight,
  );

  const stageProfile: StageCalibrationProfile = {
    ...profile,
    coverage_drag_multiplier: clampWeight(
      profile.coverage_drag_multiplier * (policy?.coverage_drag_multiplier ?? 1),
      profile.coverage_drag_multiplier,
    ),
    contradiction_penalty_multiplier: clampWeight(
      profile.contradiction_penalty_multiplier * (policy?.contradiction_penalty_multiplier ?? 1),
      profile.contradiction_penalty_multiplier,
    ),
    unknown_drag_multiplier: clampWeight(profile.unknown_drag_multiplier, profile.unknown_drag_multiplier),
    confidence_floor_lift: clamp01(profile.confidence_floor_lift),
    coverage_floor_lift: clamp01(profile.coverage_floor_lift),
    plausible_score_floor: Math.max(0, Math.min(100, Math.round(profile.plausible_score_floor))),
    floor_positive_index_min: clamp01(profile.floor_positive_index_min),
    floor_max_contradiction_index: clamp01(profile.floor_max_contradiction_index),
  };

  return {
    base_intercept: BASE_CALIBRATION.base_intercept,
    positive_weight: positiveWeight,
    drag_weight: dragWeight,
    contradiction_penalty_weight: BASE_CALIBRATION.contradiction_penalty_weight,
    confidence_modulation_floor: clamp01(BASE_CALIBRATION.confidence_modulation_floor + stageProfile.confidence_floor_lift),
    coverage_modulation_floor: clamp01(BASE_CALIBRATION.coverage_modulation_floor + stageProfile.coverage_floor_lift),
    coverage_drag_scale: BASE_CALIBRATION.coverage_drag_scale,
    evidence_quality_drag_scale: BASE_CALIBRATION.evidence_quality_drag_scale,
    unknown_drag_base: BASE_CALIBRATION.unknown_drag_base,
    contradicted_drag_base: BASE_CALIBRATION.contradicted_drag_base,
    financial_unknown_drag: BASE_CALIBRATION.financial_unknown_drag,
    contradiction_severity_weight: BASE_CALIBRATION.contradiction_severity_weight,
    contradiction_low_confidence_cap: clamp01(BASE_CALIBRATION.contradiction_low_confidence_cap),
    contradiction_low_confidence_threshold: clamp01(BASE_CALIBRATION.contradiction_low_confidence_threshold),
    stage_profile: stageProfile,
  };
}
