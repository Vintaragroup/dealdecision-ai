export function computeDeterministicScorePreviewV1Diagnostics(args: {
  applied: boolean;
  delta_overall_score: number | null;
  base_unadjusted_overall_score: number | null;
  base_adjustment_factor: number | null;
  det_adjustment_factor: number | null;
  base_evidence_factor: number | null;
  det_evidence_factor: number | null;
}): {
  delta_unrounded_overall: number | null;
  delta_adjustment_factor: number | null;
  delta_evidence_factor: number | null;
  rounding_note: string | null;
} {
  const finite = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const baseUnadjusted = finite(args.base_unadjusted_overall_score);
  const baseAdj = finite(args.base_adjustment_factor);
  const detAdj = finite(args.det_adjustment_factor);
  const baseEvidence = finite(args.base_evidence_factor);
  const detEvidence = finite(args.det_evidence_factor);

  const baselineUnrounded =
    baseUnadjusted != null && baseAdj != null
      ? baseUnadjusted * baseAdj + 50 * (1 - baseAdj)
      : null;

  const deterministicUnrounded =
    baseUnadjusted != null && detAdj != null
      ? baseUnadjusted * detAdj + 50 * (1 - detAdj)
      : null;

  const deltaUnrounded =
    baselineUnrounded != null && deterministicUnrounded != null
      ? deterministicUnrounded - baselineUnrounded
      : null;

  const deltaAdj =
    baseAdj != null && detAdj != null ? detAdj - baseAdj : null;

  const deltaEvidence =
    baseEvidence != null && detEvidence != null ? detEvidence - baseEvidence : null;

  const roundingNote =
    args.applied === true &&
    args.delta_overall_score === 0 &&
    deltaUnrounded != null &&
    Math.abs(deltaUnrounded) > 0
      ? "Applied; final score unchanged due to rounding."
      : null;

  return {
    delta_unrounded_overall: deltaUnrounded,
    delta_adjustment_factor: deltaAdj,
    delta_evidence_factor: deltaEvidence,
    rounding_note: roundingNote,
  };
}

export type UnadjustedPinReasonV1 =
  | 'drift_misaligned'
  | 'low_coverage'
  | 'no_kpis'
  | 'low_confidence'
  | null;

// Deterministic, idempotent pinning rules for baseline unadjusted scoring.
export function shouldPinUnadjusted(args: {
  coverageRatio: number | null;
  kpiCount: number;
  driftAssessment: string | null;
  scoreConfidence: number | null;
}): { pinned: boolean; reason: UnadjustedPinReasonV1 } {
  const drift = typeof args.driftAssessment === 'string' ? args.driftAssessment.trim() : '';
  if (drift === 'misaligned') return { pinned: true, reason: 'drift_misaligned' };

  if (typeof args.coverageRatio === 'number' && Number.isFinite(args.coverageRatio) && args.coverageRatio < 0.65) {
    return { pinned: true, reason: 'low_coverage' };
  }

  if (typeof args.kpiCount === 'number' && Number.isFinite(args.kpiCount) && args.kpiCount === 0) {
    return { pinned: true, reason: 'no_kpis' };
  }

  if (typeof args.scoreConfidence === 'number' && Number.isFinite(args.scoreConfidence) && args.scoreConfidence < 0.4) {
    return { pinned: true, reason: 'low_confidence' };
  }

  return { pinned: false, reason: null };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function computeDeterministicModifierV1(inputs: any): { modifier: number; signal_strength: number; notes: string[] } {
  const notes: string[] = [];

  const counts = (inputs && inputs.segments && inputs.segments.counts && typeof inputs.segments.counts === 'object')
    ? inputs.segments.counts
    : {};
  const keySegments = ['market', 'product', 'traction', 'financials', 'team', 'go_to_market'];
  const covered = keySegments.filter((k) => Number((counts as any)[k] ?? 0) > 0).length;
  const segmentCoverage = keySegments.length > 0 ? covered / keySegments.length : 0;

  const kpis: any[] = Array.isArray(inputs?.kpis) ? inputs.kpis : [];
  const kpiCount = kpis.filter((k) => typeof k?.key === 'string').length;
  const kpiAvgConf = kpis.length > 0
    ? clamp01(kpis.reduce((sum, k) => sum + (typeof k?.confidence === 'number' ? k.confidence : 0), 0) / kpis.length)
    : 0;
  const kpiPresenceScore = clamp01(Math.min(1, kpiCount / 3) * (kpiAvgConf / 0.85));

  const overrideRatio = (typeof inputs?.segments?.override_ratio === 'number') ? inputs.segments.override_ratio : null;
  const overridePenalty = overrideRatio != null ? clamp01(overrideRatio) : 0;

  const signalStrength = clamp01(0.6 * segmentCoverage + 0.4 * kpiPresenceScore - 0.2 * overridePenalty);

  // Wider base impact range
  let baseModifier = 0.85 + 0.30 * signalStrength; // [0.85, 1.15]

  // KPI bonus: requires at least 2 KPIs, decent confidence, and hard KPI presence (revenue or customers)
  const hasRevenueOrCustomers = kpis.some((k) => {
    const key = typeof k?.key === 'string' ? k.key : '';
    if (key !== 'revenue' && key !== 'customers') return false;
    const raw = typeof k?.value_raw === 'string' ? k.value_raw.trim() : '';
    return raw.length > 0;
  });

  const kpiBonus = (kpiCount >= 2 && kpiAvgConf >= 0.70 && hasRevenueOrCustomers) ? 1.03 : 1.00;

  let modifier = baseModifier * kpiBonus;

  // Clamp to hard bounds
  const beforeClamp = modifier;
  modifier = clamp(modifier, 0.85, 1.15);
  if (Math.abs(modifier - beforeClamp) > 1e-12) {
    notes.push(`modifier_clamped_to_[0.85,1.15] (from=${beforeClamp.toFixed(3)} to=${modifier.toFixed(3)})`);
  }

  // Override safety cap: heavy override ratios cannot boost above 1.0
  if (overrideRatio != null && overrideRatio >= 0.25 && modifier > 1.0) {
    modifier = 1.0;
    notes.push('override_ratio>=0.25: boost capped to 1.0');
  }

  notes.push(`segment_coverage=${segmentCoverage.toFixed(3)}`);
  notes.push(`kpi_count=${kpiCount}`);
  notes.push(`kpi_avg_conf=${kpiAvgConf.toFixed(3)}`);
  notes.push(`kpi_bonus=${kpiBonus.toFixed(2)} (has_revenue_or_customers=${hasRevenueOrCustomers ? 'true' : 'false'})`);
  notes.push(`signal_strength=${signalStrength.toFixed(3)}`);
  notes.push(`base_modifier=${baseModifier.toFixed(3)}`);
  notes.push(`modifier=${modifier.toFixed(3)}`);

  return { modifier, signal_strength: signalStrength, notes };
}
