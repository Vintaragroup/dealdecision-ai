import type { CapitalLogicProfileV1 } from "../models/capital-logic-profile.js";
import type { BusinessModelSignalProfileV1 } from "../models/business-model-signal-profile.js";
import type { MarketAccessibilitySignalProfileV1 } from "../models/market-accessibility-signal-profile.js";
import type { TractionSignalProfileV1 } from "../models/traction-signal-profile.js";
import type { FinancialCoverageProfileV1 } from "../models/financial-coverage-profile.js";
import type { FundingStageModelV1 } from "../models/funding-stage-model.js";
import type { StageExpectationsProfileV1 } from "../models/stage-expectations-profile.js";
import type { DimensionKey } from "./stage-weight-matrix";

export type StageWeightedDimensionSignalV1 = {
  key: DimensionKey;
  present: boolean;
  confidence: number; // 0..1
  evidence_ids: string[];
  notes?: string[];
};

export type StageWeightedScoreInputsV1 = {
  stage: FundingStageModelV1["funding_stage"];
  signals: Record<DimensionKey, StageWeightedDimensionSignalV1>;
  signals_used?: string[];
};

export type StageWeightedScoreInputsV1Args = {
  funding_stage_v1?: FundingStageModelV1 | null;
  financial_coverage_v1?: FinancialCoverageProfileV1 | null;
  capital_logic_v1?: CapitalLogicProfileV1 | null;
  stage_expectations_v1?: StageExpectationsProfileV1 | null;
  business_model_signal_v1?: BusinessModelSignalProfileV1 | null;
  market_accessibility_signal_v1?: MarketAccessibilitySignalProfileV1 | null;
  traction_signal_v1?: TractionSignalProfileV1 | null;
  structured_summary?: {
    business_model?: { value?: string | null } | null;
    revenue?: { value?: { amount?: number | null } | null } | null;
    customers?: { value?: { count?: number | null } | null } | null;
    growth?: { value?: { percent?: number | null } | null } | null;
  } | null;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function uniqStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function emptySignal(key: DimensionKey): StageWeightedDimensionSignalV1 {
  return { key, present: false, confidence: 0, evidence_ids: [] };
}

function confidenceTo01(conf: unknown): number {
  if (typeof conf === "number") return clamp01(conf);
  if (conf === "high") return 0.85;
  if (conf === "medium") return 0.6;
  if (conf === "low") return 0.3;
  return 0;
}

function bandTo01(band: BusinessModelSignalProfileV1["confidence"] | unknown): number {
  if (band === "high") return 0.85;
  if (band === "medium") return 0.6;
  if (band === "low") return 0.35;
  return 0.45;
}

function bandTo01Traction(band: TractionSignalProfileV1["confidence"] | unknown): number {
  if (band === "high") return 0.85;
  if (band === "medium") return 0.6;
  if (band === "low") return 0.35;
  return 0.45;
}

function bandTo01Market(band: MarketAccessibilitySignalProfileV1["confidence"] | unknown): number {
  if (band === "high") return 0.85;
  if (band === "medium") return 0.6;
  if (band === "low") return 0.35;
  return 0.45;
}

function hasGap(stage_expectations_v1: StageExpectationsProfileV1 | null | undefined, code: string): boolean {
  const gaps: any[] = Array.isArray((stage_expectations_v1 as any)?.gaps) ? ((stage_expectations_v1 as any).gaps as any[]) : [];
  return gaps.some((g) => String((g as any)?.code ?? "") === code);
}

export function buildStageWeightedScoreInputsV1(args: StageWeightedScoreInputsV1Args): StageWeightedScoreInputsV1 {
  const stage = args.funding_stage_v1?.funding_stage ?? "unknown";
  const signals: Record<DimensionKey, StageWeightedDimensionSignalV1> = {
    problem_clarity: emptySignal("problem_clarity"),
    solution_product: emptySignal("solution_product"),
    market: emptySignal("market"),
    business_model: emptySignal("business_model"),
    traction: emptySignal("traction"),
    financial_profile: emptySignal("financial_profile"),
    team: emptySignal("team"),
    use_of_funds_raise_logic: emptySignal("use_of_funds_raise_logic"),
  };

  // Business model: prefer deterministic BusinessModelSignalProfileV1 when available.
  const bms = args.business_model_signal_v1 ?? null;
  const bmRaw = args.structured_summary?.business_model?.value;
  const bmFallbackPresent = typeof bmRaw === "string" && bmRaw.trim().length > 0;

  const businessModelPresent = typeof bms?.present === "boolean" ? bms.present : bmFallbackPresent;
  const businessModelConfidence = bms
    ? bandTo01(bms.confidence)
    : (bmFallbackPresent ? 0.55 : 0.15);

  const bmNotes: Array<string | undefined> = bms
    ? [
        bms.pricing_present ? undefined : "bm_pricing_missing",
        bms.revenue_model_present ? undefined : "bm_revenue_model_missing",
        bms.customer_segment_present ? undefined : "bm_customer_segment_missing",
        bms.monetization_mechanics_present ? undefined : "bm_monetization_missing",
      ]
    : [];

  signals.business_model = {
    key: "business_model",
    present: businessModelPresent,
    confidence: clamp01(businessModelConfidence),
    evidence_ids: [],
    notes: uniqStrings(bmNotes),
  };

  // Financial profile: present if any core financial signals are present.
  const fc = args.financial_coverage_v1;
  if (fc) {
    const cov: any = (fc as any).coverage ?? {};
    const present = Boolean(
      cov.historical_revenue_present ||
        cov.income_statement_present ||
        cov.unit_economics_present ||
        cov.burn_rate_present ||
        cov.runway_present ||
        cov.balance_sheet_present ||
        cov.cash_flow_present,
    );
    const xlsxPresent = Array.isArray((fc as any).sources)
      ? (fc as any).sources.some((s: any) => String(s?.kind ?? "").toLowerCase() === "xlsx")
      : false;

    signals.financial_profile = {
      key: "financial_profile",
      present,
      confidence: confidenceTo01((fc as any).confidence),
      evidence_ids: [],
      notes: uniqStrings([
        xlsxPresent ? "source:xlsx" : undefined,
        cov.historical_revenue_present ? "historical_revenue_present" : undefined,
        cov.forecast_revenue_present ? "forecast_revenue_present" : undefined,
        cov.income_statement_present ? "income_statement_present" : undefined,
        cov.unit_economics_present ? "unit_economics_present" : undefined,
        cov.burn_rate_present ? "burn_rate_present" : undefined,
        cov.runway_present ? "runway_present" : undefined,
      ]),
    };
  }

  // Use of funds / raise logic: present if coherent capital logic exists.
  const cl = args.capital_logic_v1;
  if (cl) {
    const present = Boolean(
      cl.coherence?.appears_coherent ||
        (cl.raise?.present && (cl.use_of_funds?.present || cl.milestones?.present)),
    );
    signals.use_of_funds_raise_logic = {
      key: "use_of_funds_raise_logic",
      present,
      confidence: confidenceTo01((cl as any).confidence),
      evidence_ids: [],
      notes: uniqStrings([
        cl.raise?.present ? "raise_present" : undefined,
        cl.use_of_funds?.present ? "use_of_funds_present" : undefined,
        cl.milestones?.present ? "milestones_present" : undefined,
        cl.coherence?.appears_coherent ? "appears_coherent" : undefined,
      ]),
    };
  }

  // Traction: derived from structured_summary KPIs and/or stage expectations observed signals.
  const ssRev = args.structured_summary?.revenue?.value?.amount;
  const ssCustomers = args.structured_summary?.customers?.value?.count;
  const ssGrowth = args.structured_summary?.growth?.value?.percent;
  const stageObsTraction = Boolean((args.stage_expectations_v1 as any)?.observed?.traction_evidence_present);
  const tractionPresent =
    (typeof ssRev === "number" && Number.isFinite(ssRev) && ssRev > 0) ||
    (typeof ssCustomers === "number" && Number.isFinite(ssCustomers) && ssCustomers > 0) ||
    (typeof ssGrowth === "number" && Number.isFinite(ssGrowth)) ||
    stageObsTraction;

  const tractionMissing = hasGap(args.stage_expectations_v1, "missing_traction_evidence");

  const ts = args.traction_signal_v1 ?? null;
  const tractionPresentFromProfile = ts
    ? Boolean(
        ts.historical_revenue_present ||
          ts.user_metrics_present ||
          ts.growth_rate_present ||
          ts.bookings_present ||
          (ts.forecast_revenue_present && !ts.tam_only) ||
          stageObsTraction,
      )
    : tractionPresent;

  const tractionNotes: Array<string | undefined> = [
    tractionMissing ? "gap:missing_traction_evidence" : undefined,
    stageObsTraction ? "stage_expectations:observed_traction" : undefined,
    ts?.tam_only ? "tam_without_traction" : undefined,
    (ts?.forecast_revenue_present && !ts?.historical_revenue_present) ? "forecast_without_history" : undefined,
    (stage === "growth" && ts && !ts.recurring_revenue_present) ? "growth_without_recurring_revenue" : undefined,
  ];

  signals.traction = {
    key: "traction",
    present: tractionPresentFromProfile && !tractionMissing,
    confidence: ts ? bandTo01Traction(ts.confidence) : clamp01(tractionPresent ? 0.6 : 0.2),
    evidence_ids: [],
    notes: uniqStrings(tractionNotes),
  };

  // Market: deterministic MarketAccessibilitySignalProfileV1 (TAM vs. accessibility signals).
  const ma = args.market_accessibility_signal_v1 ?? null;
  if (ma) {
    const marketPresent = Boolean(
      ma.tam_present ||
        ma.sam_present ||
        ma.som_present ||
        ma.icp_defined ||
        ma.target_segment_defined ||
        ma.distribution_channel_defined ||
        ma.wedge_defined,
    );

    const marketNotes: Array<string | undefined> = [
      ma.tam_present && !ma.icp_defined ? "tam_without_icp" : undefined,
      (ma.tam_present && !ma.distribution_channel_defined && (stage === "seed" || stage === "series_a"))
        ? "tam_without_distribution"
        : undefined,
      !ma.som_present && stage !== "pre_seed" ? "missing_som" : undefined,
    ];

    signals.market = {
      key: "market",
      present: marketPresent,
      confidence: clamp01(bandTo01Market(ma.confidence)),
      evidence_ids: [],
      notes: uniqStrings(marketNotes),
    };
  }

  // Market, Problem, Solution, Team: v1 defaults (until we add deterministic extractors).
  // Keep them deterministic and conservative.

  return {
    stage,
    signals,
    signals_used: uniqStrings([
      bms ? "business_model_signal_v1" : undefined,
      ma ? "market_accessibility_signal_v1" : undefined,
      ts ? "traction_signal_v1" : undefined,
    ]),
  };
}
