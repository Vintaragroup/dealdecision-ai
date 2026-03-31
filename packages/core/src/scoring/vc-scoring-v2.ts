/**
 * VC Scoring V2
 *
 * Separates opportunity, confidence, and risk into independent scoring tracks,
 * producing an investment posture rather than a single compressed document-confidence score.
 *
 * PARALLEL SYSTEM — does not replace:
 *   - overall_score / score_band_v2 (Track 1, LLM-anchored)
 *   - ORS / computeDecision (Track 2, orchestrator)
 *   - stage_weighted_v1 (Track 3, dimensional)
 *
 * Deterministic. No LLM. No side effects. No imports from sibling scoring files.
 *
 * Composite formula:
 *   vc_composite_score = round(0.50 * opportunity + 0.25 * confidence + 0.25 * (100 - risk))
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Clamp and round to a 0–100 integer. */
function r(x: number): number {
  return clamp(Math.round(x), 0, 100);
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type InvestmentPosture =
  | "PASS"
  | "MONITOR"
  | "INVESTIGATE"
  | "HIGH_PRIORITY_DILIGENCE"
  | "INVESTABLE";

export interface VCScoringV2OpportunityBreakdown {
  market: number;
  product: number;
  team: number;
  traction: number;
  gtm: number;
  business_model: number;
  venture_upside: number;
}

export interface VCScoringV2ConfidenceBreakdown {
  document_coverage: number;
  financial_validity: number;
  kpi_presence: number;
  extraction_confidence: number;
  consistency: number;
}

export interface VCScoringV2RiskBreakdown {
  execution_risk: number;
  market_risk: number;
  product_risk: number;
  sales_risk: number;
  financial_risk: number;
  team_risk: number;
}

export interface VCScoringV2InferenceTrace {
  /** Whether the base score was overridden by inference. */
  boosted: boolean;
  /** 0–100 inferred score (before combining with base). */
  inferred_score: number;
  /** Final score used after combining base + inferred. */
  final_score: number;
  /** Human-readable reasons that drove the inferred score. */
  reasons: string[];
}

export interface VCScoringV2Inference {
  market: VCScoringV2InferenceTrace;
  product: VCScoringV2InferenceTrace;
  team: VCScoringV2InferenceTrace;
  traction: VCScoringV2InferenceTrace;
}

export interface VCScoringV2 {
  opportunity_score: number;
  confidence_score: number;
  risk_score: number;
  vc_composite_score: number;
  investment_posture: InvestmentPosture;
  breakdown: {
    opportunity: VCScoringV2OpportunityBreakdown;
    confidence: VCScoringV2ConfidenceBreakdown;
    risk: VCScoringV2RiskBreakdown;
  };
  /** Signal inference trace — shows which opportunity components were boosted and why. */
  inference: VCScoringV2Inference;
  reasoning: string[];
}

// ─── Input types ─────────────────────────────────────────────────────────────

/** Stage-weighted 0–100 dimension scores (from dimension-scorer-v1). null = not available. */
export interface VCScoringV2DimensionScores {
  solution_product: number | null;
  problem_clarity: number | null;
  team: number | null;
  traction: number | null;
  business_model: number | null;
}

/** Boolean traction signals used to compute venture_upside. */
export interface VCScoringV2TractionSignals {
  tam_present: boolean;
  growth_rate_present: boolean;
  arr_or_mrr_present: boolean;
  revenue_present: boolean;
}

/** URSS component severity scores 0–100. Higher = worse. */
export interface VCScoringV2UrssComponents {
  transparency: number;
  consistency: number;
  coverage: number;
  financial_reliability: number;
  gate: number;
}

/**
 * All inputs required to compute VCScoringV2.
 *
 * These fields map directly to values already produced by the existing orchestrator pipeline:
 *   market_score_raw       ← computeMarketScoreRaw()
 *   dimension_scores.*     ← scoreStageWeightedV1().dimensions[key].score_0_100
 *   gtm_signal             ← segment coverage key "go_to_market"
 *   traction_signals.*     ← canonical field computability flags
 *   dci_score              ← computeDocumentConfidenceIndex().score
 *   fhc_*                  ← computeFinancialHealthComposite()
 *   kpi_*                  ← computeDeterministicModifierV1() inputs / outputs
 *   extraction_modifier    ← computeDeterministicModifierV1().modifier
 *   conflict_count         ← conflicts.length (canonical field conflicts array)
 *   urss_components.*      ← computeUnifiedRiskSeverity().components.*
 *   team_penalty_codes     ← dimension-scorer team notes
 */
export interface VCScoringV2Inputs {
  // ── Opportunity ──────────────────────────────────────────────────────────

  /** Market score 0–100 from canonical field presence. */
  market_score_raw: number;
  /** Stage-weighted dimension scores 0–100 each. */
  dimension_scores: VCScoringV2DimensionScores;
  /** Go-to-Market signal presence and extraction confidence (0–1). */
  gtm_signal: { present: boolean; confidence: number };
  /** Raw traction signals for venture_upside computation. */
  traction_signals: VCScoringV2TractionSignals;

  // ── Confidence ───────────────────────────────────────────────────────────

  /** Document Confidence Index 0–100. */
  dci_score: number;
  /** Financial Health Composite 0–100, or null when status = insufficient_data. */
  fhc_score: number | null;
  /** FHC computation status. */
  fhc_status: "ok" | "insufficient_data";
  /** True when FHC was built from XLSX structured sources rather than deck-only signals. */
  fhc_has_structured_sources: boolean;
  /** Reconciliation confidence score 0–1, or null when the section is absent. */
  reconciliation_confidence: number | null;
  /** Number of KPIs extracted at sufficient confidence. */
  kpi_count: number;
  /** Average KPI confidence 0–1. */
  kpi_avg_confidence: number;
  /**
   * Deterministic extraction modifier from computeDeterministicModifierV1.
   * Range [0.85, 1.15]. Use 1.0 when unavailable.
   */
  extraction_modifier: number;
  /** Number of cross-source canonical field conflicts. */
  conflict_count: number;

  // ── Risk ─────────────────────────────────────────────────────────────────

  /** URSS component severity scores 0–100. Higher = worse. */
  urss_components: VCScoringV2UrssComponents;
  /**
   * Team penalty codes from dimension-scorer-v1 notes.
   * Known values: "no_founder", "solo_founder", "no_technical_lead",
   *               "no_gtm_lead", "no_domain_experience"
   */
  team_penalty_codes: string[];
}

// ─── Signal Inference Layer ───────────────────────────────────────────────────
//
// Purpose: allow strong qualitative signals to fill in when structured
// dimension scores are absent or incomplete.
//
// Principle: opportunity = inferred quality; confidence = structural evidence.
// Missing XLSX/KPIs should penalize confidence, NOT opportunity.
//
// Each helper returns { score, reasons } where score is the inferred 0–100 value.
// The combine() function merges inferred with base, favoring inferred when stronger.

interface InferenceResult {
  score: number;
  reasons: string[];
}

/**
 * Combine a base (structured) score with an inferred (signal-based) score.
 *
 * Rules:
 *   - If inferred is materially stronger (>8pts above base): use 40% base + 60% inferred.
 *   - If scores are within 8pts: average them (avoid overclaiming).
 *   - If base is stronger: stay with base (inference never penalizes).
 *   - Cap final score at 95 to prevent noise from reaching elite tier.
 */
function combine(base: number, inferred: number): number {
  if (inferred > base + 8) {
    return clamp(Math.round(0.40 * base + 0.60 * inferred), 0, 95);
  }
  if (base >= inferred) {
    return clamp(base, 0, 95);
  }
  return clamp(Math.round((base + inferred) / 2), 0, 95);
}

function buildTrace(
  base: number,
  inferred: InferenceResult,
  final: number
): VCScoringV2InferenceTrace {
  return {
    boosted: final > base,
    inferred_score: inferred.score,
    final_score: final,
    reasons: inferred.reasons,
  };
}

/**
 * Infer market strength from available signals.
 * Uses market_score_raw as primary; boosts when growth/revenue present without TAM.
 */
function inferMarketStrength(inputs: VCScoringV2Inputs): InferenceResult {
  const reasons: string[] = [];
  let score = r(inputs.market_score_raw);

  if (inputs.traction_signals.growth_rate_present) {
    score = clamp(score + 12, 0, 90);
    reasons.push("Growth rate signal present — implies expanding market.");
  }
  if (inputs.traction_signals.revenue_present && !inputs.traction_signals.tam_present) {
    // Revenue without explicit TAM is still positive market evidence
    score = clamp(score + 8, 0, 90);
    reasons.push("Revenue evidence without explicit TAM — market implied by traction.");
  }
  if (inputs.traction_signals.arr_or_mrr_present) {
    score = clamp(score + 8, 0, 92);
    reasons.push("ARR/MRR present — recurring market pull confirmed.");
  }
  if (score > r(inputs.market_score_raw)) {
    reasons.push(`Market inferred at ${score} vs structured ${r(inputs.market_score_raw)}.`);
  } else {
    reasons.push("No market inference boost — structured market score used as-is.");
  }

  return { score: clamp(score, 0, 100), reasons };
}

/**
 * Infer product strength from traction + GTM signals.
 * Treats revenue/ARR as implicit product-market fit evidence.
 * When dimension scores are absent, applies a signal-based floor rather than penalty floor.
 */
function inferProductStrength(inputs: VCScoringV2Inputs): InferenceResult {
  const reasons: string[] = [];
  // Floor is 40 (same as structured penalty floor).
  // Signals are required to improve the score; absence of signals ≠ boost.
  let score = 40;

  if (inputs.traction_signals.revenue_present) {
    score = clamp(score + 15, 0, 90);
    reasons.push("Revenue present — product has demonstrated exchangeability.");
  }
  if (inputs.traction_signals.arr_or_mrr_present) {
    score = clamp(score + 10, 0, 90);
    reasons.push("ARR/MRR present — recurring usage implies product retention.");
  }
  if (inputs.gtm_signal.present && inputs.gtm_signal.confidence >= 0.6) {
    score = clamp(score + 8, 0, 88);
    reasons.push("Strong GTM signal — clear product positioning implied.");
  }
  if (inputs.traction_signals.growth_rate_present) {
    score = clamp(score + 8, 0, 88);
    reasons.push("Growth rate present — product demand is increasing.");
  }

  if (reasons.length === 0) {
    reasons.push("No product signals — inference at floor.");
  }

  return { score: clamp(score, 0, 100), reasons };
}

/**
 * Infer team strength from penalty codes and available signals.
 * When no dimension score is available, defaults to 50 (neutral) before penalties.
 */
function inferTeamStrength(inputs: VCScoringV2Inputs): InferenceResult {
  const reasons: string[] = [];
  let score = 50; // neutral absent-data floor (vs structured penalty 40)

  // Apply penalty codes (same logic as computeTeamRisk — presence of penalties is real signal)
  if (inputs.team_penalty_codes.includes("no_founder")) {
    score = clamp(score - 30, 0, 100);
    reasons.push("No founder identified — team risk elevated.");
  } else if (inputs.team_penalty_codes.includes("solo_founder")) {
    score = clamp(score - 10, 0, 100);
    reasons.push("Solo founder — single point of failure on team.");
  }
  if (inputs.team_penalty_codes.includes("no_technical_lead")) {
    score = clamp(score - 8, 0, 100);
    reasons.push("No technical lead identified.");
  }
  if (inputs.team_penalty_codes.includes("no_gtm_lead")) {
    score = clamp(score - 8, 0, 100);
    reasons.push("No GTM lead identified.");
  }
  if (inputs.team_penalty_codes.includes("no_domain_experience")) {
    score = clamp(score - 5, 0, 100);
    reasons.push("Domain experience not confirmed.");
  }

  if (reasons.length === 0) {
    reasons.push("No team penalty signals — assuming adequate team composition.");
  }

  return { score: clamp(score, 0, 100), reasons };
}

/**
 * Infer traction strength from boolean signals.
 * 4 signals = 80. Each signal adds proportionally.
 * When no dimension score available, this replaces the penalty floor of 30.
 */
function inferTractionStrength(inputs: VCScoringV2Inputs): InferenceResult {
  const reasons: string[] = [];
  let score = 0;

  if (inputs.traction_signals.revenue_present) {
    score += 25;
    reasons.push("Revenue present — commercial traction confirmed.");
  }
  if (inputs.traction_signals.arr_or_mrr_present) {
    score += 25;
    reasons.push("ARR/MRR present — recurring revenue validates retention.");
  }
  if (inputs.traction_signals.growth_rate_present) {
    score += 20;
    reasons.push("Growth rate present — directional momentum confirmed.");
  }
  if (inputs.traction_signals.tam_present) {
    score += 10;
    reasons.push("TAM present — market sizing included.");
  }

  // Floor: even without any structured signal, a deck that passed gate review
  // should start at a minimal positive rather than 0
  score = Math.max(score, 15);

  if (reasons.length === 0) {
    reasons.push("No traction signals — scored at minimum floor.");
  }

  return { score: clamp(score, 0, 100), reasons };
}

// ─── Opportunity components ───────────────────────────────────────────────────

/**
 * venture_upside: synthesized from market size and growth evidence.
 * TAM presence (+30) reflects addressable scale.
 * Growth + ARR + revenue evidence strengthen the compounding thesis.
 */
function computeVentureUpside(signals: VCScoringV2TractionSignals): number {
  let score = 0;
  if (signals.tam_present) score += 30;
  if (signals.growth_rate_present) score += 25;
  if (signals.arr_or_mrr_present) score += 25;
  if (signals.revenue_present) score += 20;
  return clamp(score, 0, 100);
}

function computeOpportunityBreakdown(inputs: VCScoringV2Inputs): {
  od: VCScoringV2OpportunityBreakdown;
  inference: VCScoringV2Inference;
} {
  // ── Market ─────────────────────────────────────────────────────────────────
  const baseMarket = r(inputs.market_score_raw);
  const mInferred = inferMarketStrength(inputs);
  const marketFinal = combine(baseMarket, mInferred.score);
  const marketTrace = buildTrace(baseMarket, mInferred, marketFinal);

  // ── Product ─────────────────────────────────────────────────────────────────
  // Structured: average of solution_product + problem_clarity
  // When absent: infer from traction + GTM signals (not penalty floor)
  const sp = inputs.dimension_scores.solution_product;
  const pc = inputs.dimension_scores.problem_clarity;
  const baseProduct = sp !== null && pc !== null
    ? r((sp + pc) / 2)
    : sp !== null ? sp : pc !== null ? pc : 40; // partial fallback before inference
  const pInferred = inferProductStrength(inputs);
  const productFinal = sp !== null && pc !== null
    ? baseProduct  // structured: trust dimension scores, no inference override
    : combine(baseProduct, pInferred.score);
  const productTrace = buildTrace(baseProduct, pInferred, productFinal);

  // ── Team ────────────────────────────────────────────────────────────────────
  const baseTeam = inputs.dimension_scores.team ?? 40;
  const tInferred = inferTeamStrength(inputs);
  const teamFinal = inputs.dimension_scores.team !== null
    ? r(inputs.dimension_scores.team)  // structured: trust dimension score
    : combine(baseTeam, tInferred.score);
  const teamTrace = buildTrace(r(baseTeam), tInferred, teamFinal);

  // ── Traction ────────────────────────────────────────────────────────────────
  const baseTraction = inputs.dimension_scores.traction ?? 30;
  const trInferred = inferTractionStrength(inputs);
  const tractionFinal = inputs.dimension_scores.traction !== null
    ? r(inputs.dimension_scores.traction)  // structured: trust dimension score
    : combine(baseTraction, trInferred.score);
  const tractionTrace = buildTrace(r(baseTraction), trInferred, tractionFinal);

  // ── GTM (no inference — directly signal-based) ───────────────────────────────
  const c = clamp01(inputs.gtm_signal.confidence);
  const gtm = inputs.gtm_signal.present
    ? r(55 + 45 * c)   // present: 55–100 based on confidence
    : r(20 + 30 * c);  // absent:  20–50 (some credit for any GTM mention)

  // ── Business Model & Venture Upside ─────────────────────────────────────────
  const business_model = r(inputs.dimension_scores.business_model ?? 45);
  const venture_upside = computeVentureUpside(inputs.traction_signals);

  const od: VCScoringV2OpportunityBreakdown = {
    market: marketFinal,
    product: productFinal,
    team: teamFinal,
    traction: tractionFinal,
    gtm,
    business_model,
    venture_upside,
  };

  const inference: VCScoringV2Inference = {
    market: marketTrace,
    product: productTrace,
    team: teamTrace,
    traction: tractionTrace,
  };

  return { od, inference };
}

function computeOpportunityScore(od: VCScoringV2OpportunityBreakdown): number {
  return r(
    0.20 * od.market +        // ↑ from 0.15 (market quality is primary driver)
    0.20 * od.product +
    0.15 * od.team +
    0.20 * od.traction +
    0.10 * od.gtm +
    0.10 * od.business_model +
    0.05 * od.venture_upside  // ↓ from 0.10 (derived signal, reduced weight)
  );
}

// ─── Confidence components ────────────────────────────────────────────────────

function computeFinancialValidity(inputs: VCScoringV2Inputs): number {
  // Insufficient data or deck-only (narrative, not structured) → bottom tier
  if (inputs.fhc_status === "insufficient_data" || !inputs.fhc_has_structured_sources) {
    // Deck-only FHC is slightly better than pure absence (some numerical mention)
    return inputs.fhc_score !== null ? 25 : 10;
  }
  // Structured FHC available: blend with reconciliation confidence
  const rcPct = inputs.reconciliation_confidence !== null
    ? clamp(Math.round(inputs.reconciliation_confidence * 100), 0, 100)
    : 50; // neutral when reconciliation absent
  return r(0.5 * (inputs.fhc_score ?? 0) + 0.5 * rcPct);
}

function computeConfidenceBreakdown(inputs: VCScoringV2Inputs): VCScoringV2ConfidenceBreakdown {
  const document_coverage = r(inputs.dci_score);

  const financial_validity = computeFinancialValidity(inputs);

  // kpi_presence: normalized count × normalized confidence quality
  // count/3 → full credit at 3+ KPIs; avg_conf/0.7 → full credit at 0.70+ avg
  const kpiCount = Math.max(0, inputs.kpi_count);
  const kpiConf = clamp01(inputs.kpi_avg_confidence);
  const kpi_presence = r(Math.min(1, kpiCount / 3) * clamp01(kpiConf / 0.7) * 100);

  // extraction_confidence: normalize [0.85, 1.15] → [0, 100]
  const extraction_confidence = r((clamp(inputs.extraction_modifier, 0.85, 1.15) - 0.85) / 0.30 * 100);

  // consistency: inverse conflict density — each conflict costs 15pts
  const consistency = clamp(100 - Math.max(0, inputs.conflict_count) * 15, 0, 100);

  return { document_coverage, financial_validity, kpi_presence, extraction_confidence, consistency };
}

function computeConfidenceScore(cd: VCScoringV2ConfidenceBreakdown): number {
  return r(
    0.30 * cd.document_coverage +
    0.25 * cd.financial_validity +
    0.20 * cd.kpi_presence +
    0.15 * cd.extraction_confidence +
    0.10 * cd.consistency
  );
}

// ─── Risk components ──────────────────────────────────────────────────────────

function computeSalesRisk(inputs: VCScoringV2Inputs): number {
  // Base: no GTM strategy = 65 risk; confidence scales it down
  const c = clamp01(inputs.gtm_signal.confidence);
  const base = inputs.gtm_signal.present
    ? clamp(Math.round(65 * (1 - c)), 0, 65)
    : 65;

  // Additional penalty when no revenue evidence: pre-revenue sales motion unvalidated
  const hasRevEvidence =
    inputs.traction_signals.revenue_present || inputs.traction_signals.arr_or_mrr_present;
  return clamp(base + (hasRevEvidence ? 0 : 20), 0, 100);
}

function computeTeamRisk(inputs: VCScoringV2Inputs): number {
  const codes = inputs.team_penalty_codes;
  let risk = 0;
  if (codes.includes("no_founder")) {
    risk += 60;
  } else if (codes.includes("solo_founder")) {
    risk += 20;
  }
  if (codes.includes("no_technical_lead")) risk += 15;
  if (codes.includes("no_gtm_lead")) risk += 15;
  if (codes.includes("no_domain_experience")) risk += 10;

  // Floor from team dimension score inverse: low team score is independent risk signal
  const teamScore = inputs.dimension_scores.team;
  if (teamScore !== null) {
    const fromScore = clamp(Math.round((100 - teamScore) * 0.5), 0, 50);
    risk = Math.max(risk, fromScore);
  }

  return clamp(risk, 0, 100);
}

function computeProductScore(inputs: VCScoringV2Inputs): number {
  const sp = inputs.dimension_scores.solution_product ?? 40;
  const pc = inputs.dimension_scores.problem_clarity ?? 40;
  return (sp + pc) / 2;
}

function computeRiskBreakdown(inputs: VCScoringV2Inputs): VCScoringV2RiskBreakdown {
  // execution_risk: weighted blend of URSS transparency (missing critical info)
  // and gate failures — both signal process-level diligence gaps
  const execution_risk = r(0.7 * inputs.urss_components.transparency + 0.3 * inputs.urss_components.gate);

  // market_risk: inverse of market score quality — absent market fields = unprovable thesis
  const market_risk = clamp(100 - r(inputs.market_score_raw * 0.9), 0, 100);

  // product_risk: inverse of product clarity — unclear product = higher execution risk
  const product_risk = r(100 - computeProductScore(inputs) * 0.75);

  const sales_risk = computeSalesRisk(inputs);

  // financial_risk: URSS financial_reliability directly (higher component = higher risk)
  const financial_risk = r(inputs.urss_components.financial_reliability);

  const team_risk = computeTeamRisk(inputs);

  return { execution_risk, market_risk, product_risk, sales_risk, financial_risk, team_risk };
}

function computeRiskScore(rd: VCScoringV2RiskBreakdown): number {
  return r(
    0.20 * rd.execution_risk +
    0.15 * rd.market_risk +
    0.15 * rd.product_risk +
    0.15 * rd.sales_risk +
    0.25 * rd.financial_risk +
    0.10 * rd.team_risk
  );
}

// ─── Investment posture ───────────────────────────────────────────────────────

/**
 * Resolve investment posture from three independent axes.
 *
 * Decision tree (first match wins):
 *   1. opportunity < 35 → PASS (not worth pursuing at current evidence)
 *   2. Elite profile: opp≥75 + conf≥65 + risk<35 + composite≥72 → INVESTABLE
 *   3. Strong opp + adequate conf + manageable risk → HIGH_PRIORITY_DILIGENCE
 *   4. Strong opp but blind spots in evidence → INVESTIGATE
 *   5. Moderate opp + composite≥45 → MONITOR
 *   6. Default → PASS
 */
function resolveInvestmentPosture(
  opportunity: number,
  confidence: number,
  risk: number,
  composite: number
): InvestmentPosture {
  if (opportunity < 35) return "PASS";

  if (opportunity >= 75 && confidence >= 65 && risk < 35 && composite >= 72) {
    return "INVESTABLE";
  }

  if (opportunity >= 60 && confidence >= 45 && risk < 55) {
    return "HIGH_PRIORITY_DILIGENCE";
  }

  if (opportunity >= 60 && confidence < 45) {
    return "INVESTIGATE";
  }

  if (opportunity >= 35 && composite >= 45) {
    return "MONITOR";
  }

  return "PASS";
}

// ─── Reasoning ───────────────────────────────────────────────────────────────

function topEntry(obj: Record<string, number>): [string, number] | null {
  const entries = Object.entries(obj).sort(([, a], [, b]) => b - a);
  return entries[0] ?? null;
}

function bottomEntry(obj: Record<string, number>): [string, number] | null {
  const entries = Object.entries(obj).sort(([, a], [, b]) => a - b);
  return entries[0] ?? null;
}

function buildReasoning(
  opportunity: number,
  confidence: number,
  risk: number,
  composite: number,
  posture: InvestmentPosture,
  od: VCScoringV2OpportunityBreakdown,
  cd: VCScoringV2ConfidenceBreakdown,
  rd: VCScoringV2RiskBreakdown
): string[] {
  const bullets: string[] = [];

  bullets.push(
    `VC Composite: ${composite}/100 — Opportunity ${opportunity}/100, Confidence ${confidence}/100, Risk ${risk}/100.`
  );

  switch (posture) {
    case "INVESTABLE":
      bullets.push("Elite profile: high opportunity, validated evidence, and manageable risk across all axes.");
      break;
    case "HIGH_PRIORITY_DILIGENCE":
      bullets.push("Strong opportunity with adequate confidence and manageable risk — advance to structured diligence.");
      break;
    case "INVESTIGATE":
      bullets.push("Compelling opportunity but insufficient evidence — add structured data (XLSX, KPIs) before deciding.");
      break;
    case "MONITOR":
      bullets.push("Moderate opportunity — monitor development and request updated financials before committing capital.");
      break;
    case "PASS":
      bullets.push("Opportunity score too low to justify investment at current evidence level.");
      break;
  }

  // Top opportunity driver
  const topOpp = topEntry(od as unknown as Record<string, number>);
  if (topOpp) {
    bullets.push(`Top opportunity signal: ${topOpp[0]} (${topOpp[1]}/100).`);
  }

  // Confidence warning
  if (confidence < 40) {
    const lowest = bottomEntry(cd as unknown as Record<string, number>);
    if (lowest) {
      bullets.push(
        `Low confidence (${confidence}/100): weakest signal is ${lowest[0]} (${lowest[1]}/100). Structured evidence needed.`
      );
    }
  }

  // Risk warning
  if (risk > 60) {
    const highest = topEntry(rd as unknown as Record<string, number>);
    if (highest) {
      bullets.push(
        `Elevated risk (${risk}/100): primary driver is ${highest[0]} (${highest[1]}/100).`
      );
    }
  }

  return bullets;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute the VC Scoring V2 result from the provided input signals.
 *
 * Pure function. Safe to call in useMemo, tests, or outside React.
 * Does not mutate inputs or produce side effects.
 *
 * @example
 * const v2 = computeVCScoringV2({
 *   market_score_raw: 75,
 *   dimension_scores: { solution_product: 80, problem_clarity: 70, team: 85, traction: 90, business_model: 75 },
 *   gtm_signal: { present: true, confidence: 0.8 },
 *   traction_signals: { tam_present: true, growth_rate_present: true, arr_or_mrr_present: true, revenue_present: true },
 *   dci_score: 82,
 *   fhc_score: 72, fhc_status: "ok", fhc_has_structured_sources: true,
 *   reconciliation_confidence: 0.78,
 *   kpi_count: 4, kpi_avg_confidence: 0.82,
 *   extraction_modifier: 1.08,
 *   conflict_count: 0,
 *   urss_components: { transparency: 20, consistency: 10, coverage: 18, financial_reliability: 22, gate: 15 },
 *   team_penalty_codes: [],
 * });
 * // v2.investment_posture === "HIGH_PRIORITY_DILIGENCE"
 */
export function computeVCScoringV2(inputs: VCScoringV2Inputs): VCScoringV2 {
  const { od, inference } = computeOpportunityBreakdown(inputs);
  const cd = computeConfidenceBreakdown(inputs);
  const rd = computeRiskBreakdown(inputs);

  const opportunity_score = computeOpportunityScore(od);
  const confidence_score = computeConfidenceScore(cd);
  const risk_score = computeRiskScore(rd);

  const vc_composite_score = r(
    0.50 * opportunity_score +
    0.25 * confidence_score +
    0.25 * (100 - risk_score)
  );

  const investment_posture = resolveInvestmentPosture(
    opportunity_score,
    confidence_score,
    risk_score,
    vc_composite_score
  );

  const reasoning = buildReasoning(
    opportunity_score,
    confidence_score,
    risk_score,
    vc_composite_score,
    investment_posture,
    od,
    cd,
    rd
  );

  return {
    opportunity_score,
    confidence_score,
    risk_score,
    vc_composite_score,
    investment_posture,
    breakdown: { opportunity: od, confidence: cd, risk: rd },
    inference,
    reasoning,
  };
}
