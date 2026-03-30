export type FundingStageModelV1 = {
  funding_stage: "pre_seed" | "seed" | "series_a" | "growth" | "unknown";
  confidence: number; // 0..1
  signals: Array<{
    label: string;
    weight: number;
    value?: string | number;
    source?: {
      document_id?: string;
      page_index?: number;
      page?: number;
      source_path?: string;
    };
  }>;
  notes?: string[];
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

type FundingStage = FundingStageModelV1["funding_stage"];

type EvidenceRefLike = {
  document_id?: string;
  page_index?: number;
  page?: number;
  source_path?: string;
};

export function inferFundingStageModelV1(input: {
  funding_round_label?: string | null;
  company_phase_label?: string | null;
  raise_amount?: number | null;
  raise_sources?: Array<EvidenceRefLike> | null;
}): FundingStageModelV1 {
  const signals: FundingStageModelV1["signals"] = [];
  let labelSignalCount = 0;

  const stageScores: Record<Exclude<FundingStage, "unknown">, number> = {
    pre_seed: 0,
    seed: 0,
    series_a: 0,
    growth: 0,
  };

  const addLabelSignal = (labelKind: "funding_round_label" | "company_phase_label", raw: unknown) => {
    const rawStr = typeof raw === "string" ? raw.trim() : "";
    if (!rawStr) return;
    const stage = inferStageFromAnyLabel(rawStr);
    if (!stage) return;
    stageScores[stage] += 0.6;
    labelSignalCount += 1;
    signals.push({
      label: `${labelKind}:${stage}`,
      weight: 0.6,
      value: rawStr,
    });
  };

  // A) Explicit label signals (weight 0.6 each)
  addLabelSignal("funding_round_label", input.funding_round_label);
  addLabelSignal("company_phase_label", input.company_phase_label);

  // B) Raise band signal (weight 0.4)
  const raiseAmount = typeof input.raise_amount === "number" && Number.isFinite(input.raise_amount) ? input.raise_amount : null;
  const raiseStage = raiseAmount != null ? inferStageFromRaiseAmountBand(raiseAmount) : null;
  if (raiseStage && raiseAmount != null) {
    const src0 = Array.isArray(input.raise_sources) ? input.raise_sources[0] : null;
    stageScores[raiseStage] += 0.4;
    signals.push({
      label: `raise_amount_band:${raiseStage}`,
      weight: 0.4,
      value: raiseAmount,
      source: src0 && typeof src0 === "object" ? src0 : undefined,
    });
  }

  // Conservative fallback: amount-only signals are too ambiguous to force a stage.
  if (labelSignalCount === 0 && raiseStage) {
    return {
      funding_stage: "unknown",
      confidence: 0.3,
      signals,
      notes: ["raise_amount_only_signal"],
    };
  }

  const candidates = (Object.keys(stageScores) as Array<Exclude<FundingStage, "unknown">>)
    .filter((s) => stageScores[s] > 0);

  if (candidates.length === 0) {
    return { funding_stage: "unknown", confidence: 0, signals };
  }

  // Rank by raw scores (deterministic).
  const ranked = [...candidates]
    .map((stage) => ({ stage, raw: stageScores[stage] }))
    .sort((a, b) => b.raw - a.raw || a.stage.localeCompare(b.stage));

  const top = ranked[0]!;
  const second = ranked[1] ?? null;

  // C) Conflict handling
  // Use a deterministic normalization for the delta check so that mixed signals
  // like 0.6 vs 0.4 are treated as close enough to declare unknown (per v1 spec).
  const norm = softmax01({
    pre_seed: stageScores.pre_seed,
    seed: stageScores.seed,
    series_a: stageScores.series_a,
    growth: stageScores.growth,
  });

  if (second && (norm[top.stage] - norm[second.stage]) < 0.15) {
    return {
      funding_stage: "unknown",
      confidence: Math.min(0.6, clamp01(top.raw)),
      signals,
      notes: ["conflicting_signals"],
    };
  }

  // D) Confidence: normalized winning score (cap 1.0). In v1, this is the
  // bounded sum of weights for the winning stage.
  return {
    funding_stage: top.stage,
    confidence: clamp01(top.raw),
    signals,
  };
}

function inferStageFromRaiseAmountBand(raiseAmount: number): Exclude<FundingStage, "unknown"> | null {
  if (!(typeof raiseAmount === "number" && Number.isFinite(raiseAmount) && raiseAmount > 0)) return null;

  // Deterministic bands (v1). Note: 1.0–5.0M overlaps <1.5M; we deterministically
  // prioritize the explicit [1.0M, 5.0M] band for seed.
  if (raiseAmount >= 1_000_000 && raiseAmount <= 5_000_000) return "seed";
  if (raiseAmount < 1_500_000) return "pre_seed";
  if (raiseAmount >= 5_000_000 && raiseAmount <= 20_000_000) return "series_a";
  if (raiseAmount > 20_000_000) return "growth";

  return null;
}

function inferStageFromAnyLabel(label: string): Exclude<FundingStage, "unknown"> | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;

  // pre-seed
  if (s.includes("pre-seed") || s.includes("pre seed") || s.includes("preseed")) return "pre_seed";
  if (s === "idea" || s.includes("idea stage") || s.includes("ideation")) return "pre_seed";
  if (s === "pre_seed" || s === "preseed") return "pre_seed";
  if (s === "pre seed") return "pre_seed";

  // seed
  if (s === "seed" || s.includes("seed")) return "seed";
  if (s === "seed_plus" || s.includes("seed plus") || s.includes("seed+")) return "seed";

  // series a
  if (s.includes("series a") || s.includes("series-a") || s.includes("series_a") || s.includes("a round")) return "series_a";
  if (s === "series_a") return "series_a";

  // growth / late
  if (s.includes("growth") || s.includes("late")) return "growth";
  if (s.includes("series b") || s.includes("series c") || /series\s*[b-z]\b/.test(s)) return "growth";
  if (s === "series_b" || s === "series_c") return "growth";

  return null;
}

function softmax01(values: Record<Exclude<FundingStage, "unknown">, number>): Record<Exclude<FundingStage, "unknown">, number> {
  const entries = Object.entries(values) as Array<[Exclude<FundingStage, "unknown">, number]>;
  const exps = entries.map(([stage, v]) => [stage, Math.exp(v)] as const);
  const denom = exps.reduce((sum, [, ev]) => sum + ev, 0);
  const out: any = {};
  for (const [stage, ev] of exps) {
    out[stage] = denom > 0 ? ev / denom : 0;
  }
  return out;
}
