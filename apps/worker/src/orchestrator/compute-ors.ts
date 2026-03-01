/**
 * Overall Recommendation Score (ORS) + Stage-Conditional Decision
 *
 * Authoritative spec: docs/Active/orchestractor/DDAI_CORE_SCORING_MODEL_v1.md §C, D, E
 *
 * Range: 0–100.  Higher is better.
 * Deterministic. No LLM.
 */

import type {
  StageLabel,
  DecisionLabel,
  ConfidenceBand,
  OrchestratorDecision,
  DecisionThresholdsUsed,
} from "./types.js";
import type { FhcStatus } from "./types.js";

// ─── Primitives ───────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ─── Market score persistence ─────────────────────────────────────────────────

export interface MarketScoreInputs {
  /** 0–100 deterministic proxy from canonical fields. */
  market_score_raw: number;
  missing_inputs: string[];
}

export function computeMarketScorePersisted(raw: number, dci: number): number {
  return clamp(Math.round(0.85 * raw + 0.15 * dci), 0, 100);
}

// ─── Market score raw (deterministic proxy) ───────────────────────────────────

/**
 * A mini-model of canonicalField presence to produce market_score_raw.
 * Weights are calibrated to sum to 100 when all signals are present.
 */
const MARKET_FIELD_WEIGHTS: Record<string, number> = {
  tam_value:      20,
  sam_value:      15,
  som_value:      10,
  arr_value:      15, // or mrr_value (checked together)
  mrr_value:      15, // counted only once if arr already present
  revenue_value:  10,
  growth_rate:    15,
  customer_count: 15,
};

interface SimpleCanonicalField {
  field: string;
  computability: string;
}

/**
 * Compute market_score_raw from canonical fields.
 * Returns { score, missing_inputs }.
 */
export function computeMarketScoreRaw(fields: SimpleCanonicalField[]): MarketScoreInputs {
  const computable = new Set(
    fields.filter((f) => f.computability === "Computable").map((f) => f.field)
  );

  let score = 0;
  const missing: string[] = [];

  // TAM / SAM / SOM
  if (computable.has("tam_value")) score += 20; else missing.push("tam_value");
  if (computable.has("sam_value")) score += 15; else missing.push("sam_value");
  if (computable.has("som_value")) score += 10; else missing.push("som_value");

  // Revenue scale: ARR or MRR (mutually exclusive — only credit once)
  const hasRevScale = computable.has("arr_value") || computable.has("mrr_value");
  if (hasRevScale) {
    score += 15;
  } else {
    missing.push("arr_value_or_mrr_value");
  }

  // Revenue evidence
  if (computable.has("revenue_value")) score += 10; else missing.push("revenue_value");

  // Growth & traction
  if (computable.has("growth_rate")) score += 15; else missing.push("growth_rate");
  if (computable.has("customer_count")) score += 15; else missing.push("customer_count");

  return {
    market_score_raw: clamp(score, 0, 100),
    missing_inputs: missing,
  };
}

// ─── ORS ─────────────────────────────────────────────────────────────────────

export interface OrsInputs {
  market_score_persisted: number;
  /** null when FHC is insufficient_data */
  fhc_score: number | null;
  fhc_status: FhcStatus;
  urss: number;
  dci: number;
  /** true when deck has revenue/burn/arr signals (used for Series A GO guard) */
  deck_has_strong_financial_signals: boolean;
}

export interface OrsResult {
  ors: number;
  financial_proxy_used: boolean;
  financial_proxy_value: number;
}

/**
 * Compute the Overall Recommendation Score.
 *
 * ORS = round(0.35 * market + 0.30 * financial_proxy + 0.25 * risk_quality + 0.10 * DCI)
 */
export function computeOverallRecommendationScore(inputs: OrsInputs): OrsResult {
  const riskQuality = 100 - inputs.urss;

  let financialProxy: number;
  let financialProxyUsed: boolean;

  if (inputs.fhc_score === null || inputs.fhc_status === "insufficient_data") {
    // Financial proxy rule
    financialProxy = clamp(Math.round(0.6 * inputs.dci + 0.4 * riskQuality), 0, 100);
    financialProxyUsed = true;
  } else {
    financialProxy = inputs.fhc_score;
    financialProxyUsed = false;
  }

  const ors = clamp(
    Math.round(
      0.35 * inputs.market_score_persisted +
        0.30 * financialProxy +
        0.25 * riskQuality +
        0.10 * inputs.dci
    ),
    0,
    100
  );

  return {
    ors,
    financial_proxy_used: financialProxyUsed,
    financial_proxy_value: financialProxy,
  };
}

// ─── Stage-conditional decision thresholds ────────────────────────────────────

interface StageThresholds {
  go_min_ors: number;
  max_acceptable_risk: number;
}

const STAGE_THRESHOLDS: Record<StageLabel, StageThresholds> = {
  Seed:     { go_min_ors: 70, max_acceptable_risk: 60 },
  SeriesA:  { go_min_ors: 75, max_acceptable_risk: 55 },
  Growth:   { go_min_ors: 80, max_acceptable_risk: 50 },
  Unknown:  { go_min_ors: 70, max_acceptable_risk: 60 }, // same as Seed
};

export interface DecisionInputs {
  ors: number;
  urss: number;
  stage: StageLabel;
  fhc_score: number | null;
  fhc_status: FhcStatus;
  deck_has_strong_financial_signals: boolean;
  dci: number;
  financial_proxy_used: boolean;
}

function computeConfidenceBand(inputs: DecisionInputs): ConfidenceBand {
  if (inputs.dci >= 70 && inputs.fhc_status !== "insufficient_data") return "High";
  if (inputs.dci < 50) return "Low";
  return "Medium";
}

function buildRationaleBullets(
  inputs: DecisionInputs,
  label: DecisionLabel,
  thresholds: StageThresholds
): string[] {
  const bullets: string[] = [];
  bullets.push(`Stage: ${inputs.stage} — ORS ${inputs.ors}/100, URSS ${inputs.urss}/100.`);

  if (label === "GO") {
    bullets.push(`ORS (${inputs.ors}) meets or exceeds stage GO threshold (${thresholds.go_min_ors}).`);
    bullets.push(`Risk severity (${inputs.urss}) within acceptable limit (≤ ${thresholds.max_acceptable_risk}).`);
  } else if (label === "NO_GO") {
    if (inputs.ors < thresholds.go_min_ors) {
      bullets.push(`ORS (${inputs.ors}) below stage minimum (${thresholds.go_min_ors}).`);
    }
    if (inputs.urss > 74) {
      bullets.push(`Risk severity (${inputs.urss}) is Critical — investment risk unacceptable.`);
    } else if (inputs.urss > thresholds.max_acceptable_risk) {
      bullets.push(
        `Risk severity (${inputs.urss}) exceeds stage max (${thresholds.max_acceptable_risk}).`
      );
    }
    if (inputs.stage === "Growth" && (inputs.fhc_score ?? 0) < 65) {
      bullets.push(`Growth-stage deal requires FHC ≥ 65; current FHC = ${inputs.fhc_score ?? "n/a"}.`);
    }
  } else {
    bullets.push(`ORS and/or risk severity in consider band — additional diligence recommended.`);
  }

  if (inputs.financial_proxy_used) {
    bullets.push(`Financial score is a DCI-derived proxy (no XLSX financial statements).`);
  }
  if (inputs.dci < 50) {
    bullets.push(`Document confidence (DCI ${inputs.dci}) is Weak — extraction reliability limited.`);
  }

  return bullets;
}

/**
 * Apply stage-conditional decision thresholds and produce the final OrchestratorDecision.
 */
export function computeDecision(inputs: DecisionInputs): OrchestratorDecision {
  const thresholds = STAGE_THRESHOLDS[inputs.stage];
  let label: DecisionLabel;

  // Immediate NO_GO: URSS Critical (>= 75) — applies to all stages
  if (inputs.urss >= 75) {
    label = "NO_GO";
  } else {
    switch (inputs.stage) {
      case "Seed":
      case "Unknown": {
        if (inputs.ors >= 70 && inputs.urss <= 60) label = "GO";
        else if (inputs.ors < 55 || inputs.urss >= 75) label = "NO_GO";
        else label = "CONSIDER";
        break;
      }
      case "SeriesA": {
        const hasFinancialConfidence =
          inputs.fhc_status === "ok" || inputs.deck_has_strong_financial_signals;
        if (inputs.ors >= 75 && inputs.urss <= 55 && hasFinancialConfidence) label = "GO";
        else if (inputs.ors < 60 || inputs.urss >= 75) label = "NO_GO";
        else label = "CONSIDER";
        break;
      }
      case "Growth": {
        const fhcOk = inputs.fhc_score !== null && inputs.fhc_score >= 65;
        if (inputs.ors >= 80 && fhcOk && inputs.urss <= 50) label = "GO";
        else if (inputs.ors < 65 || inputs.urss >= 70) label = "NO_GO";
        else label = "CONSIDER";
        break;
      }
    }
  }

  const thresholdsUsed: DecisionThresholdsUsed = {
    stage: inputs.stage,
    go_min_ors: thresholds.go_min_ors,
    max_acceptable_risk: thresholds.max_acceptable_risk,
  };

  return {
    label: label!,
    confidence_band: computeConfidenceBand(inputs),
    rationale_bullets: buildRationaleBullets(inputs, label!, thresholds),
    thresholds_used: thresholdsUsed,
  };
}
