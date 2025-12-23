import type { DealIntelligenceObject } from "../types/dio.js";

export type ScoreExplainExcludedReason = "status_not_ok" | "null_score" | "doc_type_excluded";

export type ScoreExplanation = {
  context: DealIntelligenceObject["dio_context"];
  aggregation: {
    method: "weighted_mean";
    weights: {
      slide_sequence: number;
      metric_benchmark: number;
      visual_design: number;
      narrative_arc: number;
      financial_health: number;
      risk_assessment: number;
    };
    included_components: string[];
    excluded_components: Array<{ component: string; reason: ScoreExplainExcludedReason }>;
  };
  components: {
    slide_sequence: ScoreComponent;
    metric_benchmark: ScoreComponent;
    visual_design: ScoreComponent;
    narrative_arc: ScoreComponent;
    financial_health: ScoreComponent;
    risk_assessment: ScoreComponent & {
      inverted_investment_score: number | null;
    };
  };
  totals: {
    overall_score: number | null;
    unadjusted_overall_score: number | null;
    coverage_ratio: number;
    confidence_score: number;
    evidence_factor: number;
    due_diligence_factor: number;
    adjustment_factor: number;
  };
};

export type ScoreComponent = {
  status: string | null;
  coverage: number | null;
  confidence: number | null;
  raw_score: number | null;
  weighted_contribution: number | null;
  notes: string[];
  debug_ref?: string;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const getMeta = (res: any): { status: string | null; coverage: number | null; confidence: number | null } => {
  const status = typeof res?.status === "string" ? res.status : null;
  const coverage = isFiniteNumber(res?.coverage) ? res.coverage : null;
  const confidence = isFiniteNumber(res?.confidence) ? res.confidence : null;
  return { status, coverage, confidence };
};

type ScoreComponentKey = "slide_sequence" | "metric_benchmark" | "visual_design" | "narrative_arc" | "financial_health" | "risk_assessment";

export type DocInventory = {
  documents_count: number;
  total_pages: number;
  types: string[];
};

export type ScoreWeights = ScoreExplanation["aggregation"]["weights"];

export function getContextWeights(dio_context: any, doc_inventory: DocInventory): ScoreWeights {
  const primary = typeof dio_context?.primary_doc_type === "string" ? dio_context.primary_doc_type : "";

  // Default: neutral weighting.
  const defaultWeights: ScoreWeights = {
    slide_sequence: 1.0,
    metric_benchmark: 1.0,
    visual_design: 1.0,
    narrative_arc: 1.0,
    financial_health: 1.0,
    risk_assessment: 1.0,
  };

  // Pitch decks: presentation + narrative + metrics matter most.
  if (primary === "pitch_deck") {
    return {
      narrative_arc: 1.5,
      slide_sequence: 1.0,
      visual_design: 1.0,
      metric_benchmark: 1.0,
      financial_health: 0.5,
      risk_assessment: 1.0,
    };
  }

  // Investment memos / business plans: heavily downweight slide/visual heuristics; emphasize fundamentals.
  // IMs still benefit from coherent structure (narrative_arc) but are not judged on slide choreography.
  if (primary === "business_plan_im") {
    return {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.1,
      metric_benchmark: 1.5,
      financial_health: 1.5,
      risk_assessment: 1.3,
    };
  }

  // Executive summaries: keep some slide/visual signal, but still emphasize clarity + fundamentals.
  if (primary === "exec_summary") {
    return {
      slide_sequence: 0.3,
      visual_design: 0.4,
      narrative_arc: 1.3,
      metric_benchmark: 1.2,
      financial_health: 1.2,
      risk_assessment: 1.1,
    };
  }

  // Financials-first: metrics + financial health dominate.
  if (primary === "financials") {
    return {
      slide_sequence: 0.1,
      visual_design: 0.1,
      narrative_arc: 0.2,
      metric_benchmark: 1.6,
      financial_health: 1.6,
      risk_assessment: 1.0,
    };
  }

  // If context missing but we only have financial docs, treat as financials-first.
  const hasOnlyFinancialDocs = doc_inventory.types.length > 0
    && doc_inventory.types.every((t) => /financial/i.test(t));
  if (!primary && hasOnlyFinancialDocs) {
    return {
      slide_sequence: 0.1,
      visual_design: 0.1,
      narrative_arc: 0.2,
      metric_benchmark: 1.6,
      financial_health: 1.6,
      risk_assessment: 1.0,
    };
  }

  return defaultWeights;
}

const buildDocInventory = (dio: DealIntelligenceObject): DocInventory => {
  const docs: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];
  const types = docs.map((d) => (typeof d?.type === "string" ? d.type : "")).filter(Boolean);
  const total_pages = docs.reduce((sum, d) => sum + (typeof d?.page_count === "number" ? d.page_count : 0), 0);
  return {
    documents_count: docs.length,
    total_pages,
    types,
  };
};

const getAnalyzerNumericScore = (key: ScoreComponentKey, results: any): number | null => {
  switch (key) {
    case "slide_sequence":
      return isFiniteNumber(results?.slide_sequence?.score) ? results.slide_sequence.score : null;
    case "metric_benchmark":
      return isFiniteNumber(results?.metric_benchmark?.overall_score) ? results.metric_benchmark.overall_score : null;
    case "visual_design":
      return isFiniteNumber(results?.visual_design?.design_score) ? results.visual_design.design_score : null;
    case "narrative_arc":
      return isFiniteNumber(results?.narrative_arc?.pacing_score) ? results.narrative_arc.pacing_score : null;
    case "financial_health":
      return isFiniteNumber(results?.financial_health?.health_score) ? results.financial_health.health_score : null;
    case "risk_assessment":
      return isFiniteNumber(results?.risk_assessment?.overall_risk_score) ? results.risk_assessment.overall_risk_score : null;
  }
};

export function buildScoreExplanationFromDIO(dio: DealIntelligenceObject): ScoreExplanation {
  const results: any = (dio as any).analyzer_results || {};
  const ctx = (dio as any).dio_context;
  const docInventory = buildDocInventory(dio);

  const inputDocuments: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];

  const excluded: Array<{ component: string; reason: ScoreExplainExcludedReason }> = [];
  const included: string[] = [];

  const notes: Record<string, string[]> = {
    slide_sequence: [],
    metric_benchmark: [],
    visual_design: [],
    narrative_arc: [],
    financial_health: [],
    risk_assessment: [],
  };

  const raw: Record<ScoreComponentKey, number | null> = {
    slide_sequence: getAnalyzerNumericScore("slide_sequence", results),
    metric_benchmark: getAnalyzerNumericScore("metric_benchmark", results),
    visual_design: getAnalyzerNumericScore("visual_design", results),
    narrative_arc: getAnalyzerNumericScore("narrative_arc", results),
    financial_health: getAnalyzerNumericScore("financial_health", results),
    risk_assessment: getAnalyzerNumericScore("risk_assessment", results),
  };

  const totalRisks = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map.length : 0;
  const rawRisk = raw.risk_assessment;
  const riskLooksLikeNoSignal = rawRisk === 0 && totalRisks === 0;

  const componentMeta = {
    slide_sequence: getMeta(results?.slide_sequence),
    metric_benchmark: getMeta(results?.metric_benchmark),
    visual_design: getMeta(results?.visual_design),
    narrative_arc: getMeta(results?.narrative_arc),
    financial_health: getMeta(results?.financial_health),
    risk_assessment: getMeta(results?.risk_assessment),
  };

  // If the analyzer ran but found no explicit risks, treat it as neutral baseline (50), not perfect (100) or excluded.
  const applyNeutralRiskBaseline = componentMeta.risk_assessment.status === "ok"
    && riskLooksLikeNoSignal;

  // Determine which components are included in the aggregate
  const componentsInOrder = [
    "slide_sequence",
    "metric_benchmark",
    "visual_design",
    "narrative_arc",
    "financial_health",
    "risk_assessment",
  ] as const;

  const isPitchDeck = (ctx as any)?.primary_doc_type === "pitch_deck";
  const slidePatternMatch = typeof results?.slide_sequence?.pattern_match === "string" ? results.slide_sequence.pattern_match : "";
  const isTractionFirst = isPitchDeck && /traction/i.test(slidePatternMatch);

  // Context-aware base weights (pre-normalization).
  // Note: excluded components always get weight 0.
  const baseWeights: ScoreExplanation["aggregation"]["weights"] = getContextWeights(ctx, docInventory);

  // Preserve the existing traction-first pitch deck override.
  const adjustedBaseWeights: ScoreExplanation["aggregation"]["weights"] = isPitchDeck && isTractionFirst
    ? {
        ...baseWeights,
        narrative_arc: 1.9,
        slide_sequence: 0.6,
      }
    : baseWeights;

  for (const key of componentsInOrder) {
    const status = componentMeta[key].status;
    const rawScore = raw[key];

    // Only aggregate scores from analyzers that explicitly succeeded.
    if (status !== "ok") {
      notes[key].push(`status=${status} -> excluded`);
      excluded.push({ component: key, reason: "status_not_ok" });
      continue;
    }

    if (key === "risk_assessment" && riskLooksLikeNoSignal && !applyNeutralRiskBaseline) {
      notes[key].push("risk score 0 with empty risk_map -> excluded (no signal)");
      excluded.push({ component: key, reason: "null_score" });
      continue;
    }

    if (!isFiniteNumber(rawScore)) {
      if (key === "metric_benchmark") {
        const metricsCount = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
          ? results.metric_benchmark.metrics_analyzed.length
          : 0;
        if (metricsCount === 0) {
          notes[key].push("no metrics extracted -> excluded");
        }
      }

      notes[key].push("null score -> excluded");
      excluded.push({ component: key, reason: "null_score" });
      continue;
    }

    included.push(key);

    if (key === "slide_sequence") {
      const deviationsCount = Array.isArray(results?.slide_sequence?.deviations)
        ? results.slide_sequence.deviations.length
        : 0;
      if (deviationsCount > 0) {
        notes[key].push(`${deviationsCount} sequence deviations detected`);
      }
    }
  }

  const weights: ScoreExplanation["aggregation"]["weights"] = {
    slide_sequence: included.includes("slide_sequence") ? adjustedBaseWeights.slide_sequence : 0,
    metric_benchmark: included.includes("metric_benchmark") ? adjustedBaseWeights.metric_benchmark : 0,
    visual_design: included.includes("visual_design") ? adjustedBaseWeights.visual_design : 0,
    narrative_arc: included.includes("narrative_arc") ? adjustedBaseWeights.narrative_arc : 0,
    financial_health: included.includes("financial_health") ? adjustedBaseWeights.financial_health : 0,
    risk_assessment: included.includes("risk_assessment") ? adjustedBaseWeights.risk_assessment : 0,
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const toInvestmentScore = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    if (key === "risk_assessment") {
      if (applyNeutralRiskBaseline) return 50;
      return 100 - rawScore;
    }
    return rawScore;
  };

  const toEffectiveInvestmentScore = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    const invScore = toInvestmentScore(key, rawScore);
    const confidence = componentMeta[key].confidence;
    if (isFiniteNumber(confidence) && confidence < 0.5) {
      // Blend low-confidence components toward neutral baseline.
      // effective = invScore*confidence + 50*(1-confidence)
      return invScore * confidence + 50 * (1 - confidence);
    }
    return invScore;
  };

  const weightedContribution = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    if (totalWeight === 0) return 0;
    const w = (weights as any)[key] as number;
    if (!w) return 0;
    return (w / totalWeight) * toEffectiveInvestmentScore(key, rawScore);
  };

  const contributions: Record<string, number | null> = {};
  for (const key of componentsInOrder) {
    if (!included.includes(key)) {
      contributions[key] = null;
      continue;
    }

    const rawScore = raw[key] as number;
    contributions[key] = weightedContribution(key, rawScore);

    const conf = componentMeta[key].confidence;
    if (isFiniteNumber(conf) && conf < 0.5) {
      notes[key].push(`low confidence (${conf.toFixed(2)} < 0.50) -> blended toward neutral baseline (50)`);
    }

    if (key === "risk_assessment") {
      if (applyNeutralRiskBaseline) {
        notes[key].push("risk had no signal (0 + empty risk_map) -> neutral baseline applied: 50");
      } else {
        notes[key].push(`risk inverted: ${rawScore} -> ${100 - rawScore}`);
      }
    }
  }

  const unadjustedOverall = totalWeight > 0
    ? Math.round(Object.values(contributions).reduce((sum: number, v) => sum + (isFiniteNumber(v) ? v : 0), 0))
    : null;

  const includedWeightedKeys = componentsInOrder
    .filter(k => included.includes(k))
    .filter(k => ((weights as any)[k] as number) > 0);

  const includedCoverages = includedWeightedKeys
    .map(k => componentMeta[k].coverage)
    .filter((v): v is number => isFiniteNumber(v));
  const coverageRatio = includedCoverages.length > 0
    ? Math.min(1, Math.max(0, includedCoverages.reduce((a, b) => a + b, 0) / includedCoverages.length))
    : 0;

  const includedConfidences = includedWeightedKeys
    .map(k => componentMeta[k].confidence)
    .filter((v): v is number => isFiniteNumber(v));
  const analyzerConfidence = includedConfidences.length > 0
    ? Math.min(1, Math.max(0, includedConfidences.reduce((a, b) => a + b, 0) / includedConfidences.length))
    : 0;

  const contextConfidence = isFiniteNumber((ctx as any)?.confidence) ? (ctx as any).confidence : 1;
  const confidenceScore = Math.min(1, Math.max(0, analyzerConfidence * contextConfidence));

  // Evidence + due diligence directly affect the final investment score by blending toward neutral baseline.
  // - evidence_factor: uses analyzer coverage as a proxy for how much supporting signal we actually had
  // - due_diligence_factor: uses document verification readiness when present
  // - adjustment_factor = evidence_factor * due_diligence_factor
  // - overall_score = unadjusted*adjustment + 50*(1-adjustment)
  const evidenceFactor = clamp01(0.5 + 0.5 * coverageRatio);

  const getDueDiligenceReadiness = (docs: any[]): number => {
    if (docs.length === 0) return 1;

    const perDoc: number[] = [];

    for (const doc of docs) {
      const status = typeof doc?.verification_status === "string" ? doc.verification_status : null;
      const vr = doc?.verification_result;
      const overall = isFiniteNumber(vr?.overall_score) ? vr.overall_score : null;

      let readiness: number | null = null;

      if (status) {
        if (status === "verified") readiness = 1;
        else if (status === "warnings") readiness = 0.75;
        else if (status === "failed") readiness = 0.4;
        else readiness = 0.6;
      } else if (overall !== null) {
        readiness = clamp01(overall);
      }

      if (readiness !== null) {
        // If both status and numeric score exist, use the more conservative one.
        if (overall !== null) readiness = Math.min(readiness, clamp01(overall));
        perDoc.push(readiness);
      }
    }

    // If no verification metadata is present (older DIOs), do not penalize.
    if (perDoc.length === 0) return 1;

    return clamp01(perDoc.reduce((a, b) => a + b, 0) / perDoc.length);
  };

  const dueDiligenceReadiness = getDueDiligenceReadiness(inputDocuments);
  const dueDiligenceFactor = clamp01(0.5 + 0.5 * dueDiligenceReadiness);
  const adjustmentFactor = clamp01(evidenceFactor * dueDiligenceFactor);

  const overall = unadjustedOverall === null
    ? null
    : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));

  const mkComponent = (key: (typeof componentsInOrder)[number]): ScoreComponent => {
    const { status, coverage, confidence } = componentMeta[key];
    const rawScore = raw[key];
    const wc = contributions[key];
    const hasDebug = Boolean((results as any)?.[key]?.debug_scoring);
    const debug_ref = hasDebug ? `dio.analyzer_results.${key}.debug_scoring` : undefined;

    return {
      status,
      coverage,
      confidence,
      raw_score: rawScore,
      weighted_contribution: wc,
      notes: notes[key],
      debug_ref,
    };
  };

  return {
    context: ctx,
    aggregation: {
      method: "weighted_mean",
      weights,
      included_components: included,
      excluded_components: excluded,
    },
    components: {
      slide_sequence: mkComponent("slide_sequence"),
      metric_benchmark: mkComponent("metric_benchmark"),
      visual_design: mkComponent("visual_design"),
      narrative_arc: mkComponent("narrative_arc"),
      financial_health: mkComponent("financial_health"),
      risk_assessment: {
        ...mkComponent("risk_assessment"),
        inverted_investment_score:
          included.includes("risk_assessment") && applyNeutralRiskBaseline
            ? 50
            : (included.includes("risk_assessment") && isFiniteNumber(rawRisk) && !riskLooksLikeNoSignal
              ? 100 - rawRisk
              : null),
      },
    },
    totals: {
      overall_score: overall,
      unadjusted_overall_score: unadjustedOverall,
      coverage_ratio: coverageRatio,
      confidence_score: confidenceScore,
      evidence_factor: evidenceFactor,
      due_diligence_factor: dueDiligenceFactor,
      adjustment_factor: adjustmentFactor,
    },
  };
}
