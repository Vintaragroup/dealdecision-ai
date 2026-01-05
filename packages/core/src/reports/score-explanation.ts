import type { DealIntelligenceObject, ScoringDiagnosticsV1 } from "../types/dio.js";
import { getDealPolicy } from "../classification/deal-policy-registry";
import { getSelectedPolicyIdFromAny } from "../classification/get-selected-policy-id";
import { detectRealEstateUnderwritingProtections } from "../analyzers/risk-assessment";

export type ScoreExplainExcludedReason = "status_not_ok" | "null_score" | "doc_type_excluded";

export type ScoreExplanation = {
  context: DealIntelligenceObject["dio_context"];
  aggregation: {
    method: "weighted_mean";
    policy_id: string | null;
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
  used_score: number | null;
  penalty: number;
  reason: string;
  reasons: string[];
  evidence_ids: string[];
  gaps: string[];
  red_flags: string[];
  coverage: number | null;
  confidence: number | null;
  raw_score: number | null;
  weighted_contribution: number | null;
  notes: string[];
  debug_ref?: string;
};

const PENALTY_MISSING = 8;
const PENALTY_NON_OK = 6;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];

const uniqueStrings = (xs: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const s = x.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const normalizeKey = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

type RubricEval = {
  id: string;
  required_signals: string[];
  missing_required: string[];
  positive_drivers_present: string[];
  acceptable_missing_present: string[];
  red_flags_triggered: string[];
  has_revenue_metric: boolean;
};

const getDealClassificationV1Any = (dioLike: any): any | null =>
  (dioLike as any)?.dio?.deal_classification_v1 ??
  (dioLike as any)?.deal_classification_v1 ??
  (dioLike as any)?.dio?.dio?.deal_classification_v1 ??
  (dioLike as any)?.phase1?.deal_classification_v1 ??
  (dioLike as any)?.dio?.phase1?.deal_classification_v1 ??
  null;

const evaluatePolicyRubric = (dio: DealIntelligenceObject, policyId: string | null): RubricEval | null => {
  if (!policyId) return null;
  const policy = getDealPolicy(policyId);
  const rubric = (policy as any)?.rubric as
    | {
        id: string;
        required_signals: string[];
        positive_drivers: string[];
        acceptable_missing: string[];
        red_flags: string[];
      }
    | undefined;

  if (!rubric) return null;

  const classification = getDealClassificationV1Any(dio as any);
  const selectedSignalsRaw: string[] = asStringArray(classification?.selected?.signals);
  const selectedSignals = selectedSignalsRaw.map(normalizeKey);

  const mbMetrics: string[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
    ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
        .map((m: any) => (typeof m?.metric === "string" ? m.metric : ""))
        .filter(Boolean)
    : [];

  const mbMetricKeys = mbMetrics.map(normalizeKey);
  const extractedInputMetricKeys = getExtractedMetricKeysFromInputs(dio).map(normalizeKey);

  const present = new Set<string>([...selectedSignals, ...mbMetricKeys, ...extractedInputMetricKeys]);

  // Map KPI presence to rubric readiness signals.
  if (present.has("loi_count") || present.has("contract_value")) present.add("loi_or_contract");
  if (present.has("partnership_count") || present.has("distribution_partners")) present.add("partnership_or_distribution");
  if (present.has("launch_timeline_months")) present.add("launch_timeline");
  if (present.has("manufacturing_capacity") || selectedSignals.includes("manufacturing_ready")) present.add("product_ready");
  if (selectedSignals.includes("product_ready")) present.add("product_ready");

  const requiredPairs = (rubric.required_signals || []).map((s) => ({ raw: s, key: normalizeKey(s) }));
  const missingRequired = requiredPairs.filter((p) => !present.has(p.key)).map((p) => p.raw);

  const positivePairs = (rubric.positive_drivers || []).map((s) => ({ raw: s, key: normalizeKey(s) }));
  const positivePresent = positivePairs.filter((p) => present.has(p.key)).map((p) => p.raw);

  const acceptableMissing = (rubric.acceptable_missing || []).map(normalizeKey);
  const hasRevenueMetric = present.has("revenue") || present.has("arr") || present.has("mrr");
  const acceptableMissingPresent = !hasRevenueMetric && acceptableMissing.some((s) => s === "revenue" || s === "arr" || s === "mrr")
    ? ["revenue"]
    : [];

  // Red flags: use risk_map severity/category heuristics (deterministic).
  const riskMap: any[] = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map : [];
  const redFlagsTriggered: string[] = [];
  for (const r of riskMap) {
    const sev = typeof r?.severity === "string" ? r.severity.toLowerCase() : "";
    const cat = typeof r?.category === "string" ? r.category.toLowerCase() : "";
    const title = typeof r?.title === "string" ? r.title.toLowerCase() : "";
    const desc = typeof r?.description === "string" ? r.description.toLowerCase() : "";
    const blob = `${cat} ${title} ${desc}`;

    if (sev === "critical" || sev === "high") {
      if (/fraud|misrepresent/.test(blob)) redFlagsTriggered.push("fraud");
      if (/ownership|cap\s*table|ip\s+ownership|assignment/.test(blob)) redFlagsTriggered.push("ownership_unclear");
      if (/regulator|regulatory|fda|compliance|license|permits?/.test(blob)) redFlagsTriggered.push("regulatory_blocker");
    }
  }

  return {
    id: rubric.id,
    required_signals: rubric.required_signals || [],
    missing_required: missingRequired,
    positive_drivers_present: positivePresent,
    acceptable_missing_present: acceptableMissingPresent,
    red_flags_triggered: uniqueStrings(redFlagsTriggered),
    has_revenue_metric: hasRevenueMetric,
  };
};

const getMeta = (res: any): { status: string | null; coverage: number | null; confidence: number | null } => {
  const status = typeof res?.status === "string" ? res.status : null;
  const coverage = isFiniteNumber(res?.coverage) ? res.coverage : null;
  const confidence = isFiniteNumber(res?.confidence) ? res.confidence : null;
  return { status, coverage, confidence };
};

type ScoreComponentKey = "slide_sequence" | "metric_benchmark" | "visual_design" | "narrative_arc" | "financial_health" | "risk_assessment";

type ComponentDetail = {
  reason: string;
  reasons: string[];
  evidence_ids: string[];
  gaps: string[];
  red_flags: string[];
};

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

const getExtractedMetricKeysFromInputs = (dio: DealIntelligenceObject): string[] => {
  const docs: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];
  const keys: string[] = [];
  for (const doc of docs) {
    const metrics = Array.isArray(doc?.metrics) ? doc.metrics : [];
    for (const m of metrics) {
      if (typeof m?.key === "string" && m.key.trim()) keys.push(m.key.trim());
      else if (typeof m?.name === "string" && m.name.trim()) keys.push(m.name.trim());
    }
  }
  return uniqueStrings(keys);
};

const getEvidenceIdsForComponent = (key: ScoreComponentKey, dio: DealIntelligenceObject, results: any): string[] => {
  const base = uniqueStrings(asStringArray(results?.[key]?.evidence_ids));
  switch (key) {
    case "metric_benchmark": {
      const metricEvidence = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
        ? results.metric_benchmark.metrics_analyzed
            .map((m: any) => (typeof m?.evidence_id === "string" ? m.evidence_id : null))
            .filter(Boolean)
        : [];
      return uniqueStrings([...base, ...(metricEvidence as string[])]);
    }
    case "financial_health": {
      const riskEvidence = Array.isArray(results?.financial_health?.risks)
        ? results.financial_health.risks
            .map((r: any) => (typeof r?.evidence_id === "string" ? r.evidence_id : null))
            .filter(Boolean)
        : [];
      return uniqueStrings([...base, ...(riskEvidence as string[])]);
    }
    case "risk_assessment": {
      const cats = results?.risk_assessment?.risks_by_category;
      const allRisks: any[] = cats && typeof cats === "object"
        ? ([] as any[])
            .concat(Array.isArray(cats.market) ? cats.market : [])
            .concat(Array.isArray(cats.team) ? cats.team : [])
            .concat(Array.isArray(cats.financial) ? cats.financial : [])
            .concat(Array.isArray(cats.execution) ? cats.execution : [])
        : [];
      const riskEvidence = allRisks
        .map((r: any) => (typeof r?.evidence_id === "string" ? r.evidence_id : null))
        .filter(Boolean) as string[];
      return uniqueStrings([...base, ...riskEvidence]);
    }
    default:
      return base;
  }
};

const buildComponentDetail = (params: {
  key: ScoreComponentKey;
  dio: DealIntelligenceObject;
  results: any;
  status: string | null;
  computed_status: string | null;
  raw_score: number | null;
  used_score: number | null;
  penalty: number;
  confidence: number | null;
}): ComponentDetail => {
  const { key, dio, results, status, computed_status, raw_score, used_score, penalty, confidence } = params;

  const evidence_ids = getEvidenceIdsForComponent(key, dio, results);
  const gaps: string[] = [];
  const red_flags: string[] = [];
  const reasons: string[] = [];

  const set = (reason: string, extra?: { gaps?: string[]; red_flags?: string[]; reasons?: string[] }): void => {
    if (extra?.gaps) gaps.push(...extra.gaps);
    if (extra?.red_flags) red_flags.push(...extra.red_flags);
    if (extra?.reasons) reasons.push(...extra.reasons);
    reasons.unshift(reason);
  };

  const analyzerStatus = status;

  // Error/missing paths
  if (analyzerStatus == null) {
    set("Missing analyzer result; neutral baseline applied", { gaps: ["analyzer_result_missing"] });
  } else if (analyzerStatus === "extraction_failed") {
    set("Analyzer failed; neutral baseline applied", { gaps: ["analyzer_failed"] });
  } else if (analyzerStatus === "insufficient_data") {
    switch (key) {
      case "slide_sequence":
        set("Insufficient structure signal; expected slide headings/sections not detected", { gaps: ["headings", "sections"] });
        break;
      case "financial_health":
        set("No financial KPIs extracted (revenue/expenses/burn/runway)", {
          gaps: ["revenue", "expenses", "burn_rate", "cash_balance", "runway_months", "burn_multiple"],
        });
        break;
      case "metric_benchmark":
        set("No financial metrics extracted for benchmarking", { gaps: ["metrics"] });
        break;
      case "risk_assessment":
        set("Insufficient risk signal; expected pitch text and/or risk cues not detected", { gaps: ["pitch_text", "risk_cues"] });
        break;
      case "narrative_arc":
        set("Insufficient narrative signal; expected section progression not detected", { gaps: ["sections", "structure"] });
        break;
      case "visual_design":
        set("Insufficient design signal; expected layout/format cues not detected", { gaps: ["layout", "formatting"] });
        break;
      default:
        set("Insufficient data; neutral baseline applied", { gaps: ["insufficient_data"] });
        break;
    }
  }

  // Special neutral/baseline and red-flag logic when status is ok
  if (analyzerStatus === "ok") {
    if (key === "risk_assessment") {
      const ra: any = results?.risk_assessment;
      const total = typeof ra?.total_risks === "number" ? ra.total_risks : 0;
      const critical = typeof ra?.critical_count === "number" ? ra.critical_count : 0;
      const high = typeof ra?.high_count === "number" ? ra.high_count : 0;

      if ((critical > 0 || high > 0) && ra?.risks_by_category) {
        const cats = ra.risks_by_category;
        const allRisks: any[] = ([] as any[])
          .concat(Array.isArray(cats.market) ? cats.market : [])
          .concat(Array.isArray(cats.team) ? cats.team : [])
          .concat(Array.isArray(cats.financial) ? cats.financial : [])
          .concat(Array.isArray(cats.execution) ? cats.execution : []);
        const flagged = allRisks.filter((r) => r && (r.severity === "critical" || r.severity === "high"));
        const texts = flagged
          .map((r) => {
            const sev = typeof r?.severity === "string" ? r.severity : "risk";
            const desc = typeof r?.description === "string" ? r.description : "(missing description)";
            return `${sev}: ${desc}`;
          })
          .filter(Boolean) as string[];
        if (texts.length > 0) {
          red_flags.push(...texts);
          set(`Red flags detected in risk assessment (${texts.length})`);
        }
      } else if (raw_score === 50 && total === 0) {
        // Deterministic neutral baseline when no explicit risks extracted.
        set("No explicit risks extracted; neutral baseline used", { gaps: ["explicit_risks"] });
      } else if (reasons.length === 0) {
        set("Risks assessed; risk score inverted for investment score");
      }
    }

    if (key === "metric_benchmark") {
      const metricsAnalyzed = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
        ? results.metric_benchmark.metrics_analyzed
        : [];
      const extractedKeys = getExtractedMetricKeysFromInputs(dio);

      if (raw_score == null) {
        if (extractedKeys.length > 0) {
          set("Metrics present but not mapped to benchmark set", {
            gaps: extractedKeys.map((k) => `benchmark_mapping:${k}`),
          });
        } else {
          set("No financial metrics extracted for benchmarking", { gaps: ["metrics"] });
        }
      } else if (metricsAnalyzed.length === 0) {
        // OK score but no explicit metric-by-metric validation: treat as partial signal.
        set("No benchmark-mapped KPIs found; neutral baseline used", { gaps: ["benchmark_mapping"] });
      } else if (reasons.length === 0) {
        set("Benchmarks applied to extracted metrics");
      }
    }

    if (key === "financial_health") {
      const fh: any = results?.financial_health;
      const risks = Array.isArray(fh?.risks) ? fh.risks : [];
      const severe = risks.filter((r: any) => r && (r.severity === "critical" || r.severity === "high"));
      if (severe.length > 0) {
        const texts = severe
          .map((r: any) => {
            const sev = typeof r?.severity === "string" ? r.severity : "risk";
            const desc = typeof r?.description === "string" ? r.description : "(missing description)";
            return `${sev}: ${desc}`;
          })
          .filter(Boolean) as string[];
        red_flags.push(...texts);
        set(`Red flags detected in financial health (${texts.length})`);
      } else {
        const metrics: any = fh?.metrics;
        const missing: string[] = [];
        const need = [
          ["revenue", metrics?.revenue],
          ["expenses", metrics?.expenses],
          ["burn_rate", metrics?.burn_rate],
          ["cash_balance", metrics?.cash_balance],
          ["runway_months", fh?.runway_months],
          ["burn_multiple", fh?.burn_multiple],
        ] as const;
        for (const [name, val] of need) {
          if (val == null) missing.push(name);
        }
        if (raw_score == null) {
          set("Financial KPIs present but insufficient to compute health score", { gaps: missing.length > 0 ? missing : ["financial_kpis"] });
        } else if (missing.length > 0) {
          set("Some financial KPIs missing; score computed with partial data", { gaps: missing });
        } else if (reasons.length === 0) {
          set("Financial KPIs extracted; health score computed");
        }
      }
    }

    if (key === "slide_sequence" && reasons.length === 0) {
      const deviations = Array.isArray(results?.slide_sequence?.deviations) ? results.slide_sequence.deviations : [];
      if (deviations.length > 0) set(`Slide sequence deviations detected (${deviations.length})`);
      else set("Slide structure matches common patterns");
    }

    if (key === "narrative_arc" && reasons.length === 0) {
      set("Narrative pacing score computed");
    }

    if (key === "visual_design" && reasons.length === 0) {
      const weaknesses = asStringArray(results?.visual_design?.weaknesses);
      if (weaknesses.length > 0) set(`Visual design weaknesses detected (${weaknesses.length})`);
      else set("Visual design score computed");
    }
  }

  // Penalization / blending context
  if (computed_status && computed_status.startsWith("penalized_")) {
    const suffix = computed_status.replace("penalized_", "");
    if (suffix === "missing") gaps.push("score_missing");
    if (suffix === "non_ok") gaps.push("status_not_ok");
    reasons.push(`Neutral baseline=50 applied with penalty=${penalty}`);
  }
  if (typeof confidence === "number" && Number.isFinite(confidence) && confidence < 0.5) {
    gaps.push("confidence_low");
    reasons.push(`Low confidence (${confidence.toFixed(2)}); blended toward neutral baseline`);
  }

  // Ensure a single best required reason.
  const reason = reasons.length > 0
    ? reasons[0]
    : (analyzerStatus === "ok" ? "Analyzer score used" : "Neutral baseline used");

  return {
    reason,
    reasons: uniqueStrings(reasons),
    evidence_ids,
    gaps: uniqueStrings(gaps),
    red_flags: uniqueStrings(red_flags),
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

  const classificationSelectedPolicy = getSelectedPolicyIdFromAny(dio);

  const rubricEval = evaluatePolicyRubric(dio, classificationSelectedPolicy);

  // Policy-aware base weights (pre-normalization).
  // If classification exists, use policy weights; otherwise fall back to legacy context behavior.
  const baseWeights: ScoreExplanation["aggregation"]["weights"] = classificationSelectedPolicy
    ? getDealPolicy(classificationSelectedPolicy).weights
    : getContextWeights(ctx, docInventory);

  // Preserve the existing traction-first pitch deck override for the legacy context path.
  const adjustedBaseWeights: ScoreExplanation["aggregation"]["weights"] = !classificationSelectedPolicy && isPitchDeck && isTractionFirst
    ? {
        ...baseWeights,
        narrative_arc: 1.9,
        slide_sequence: 0.6,
      }
    : baseWeights;

  // CRITICAL: do not skip components. Always include expected components from getContextWeights().
  // When missing/non-ok/no-signal, we use neutral baseline (50) plus an explicit deterministic penalty.
  const weights: ScoreExplanation["aggregation"]["weights"] = {
    slide_sequence: adjustedBaseWeights.slide_sequence,
    metric_benchmark: adjustedBaseWeights.metric_benchmark,
    visual_design: adjustedBaseWeights.visual_design,
    narrative_arc: adjustedBaseWeights.narrative_arc,
    financial_health: adjustedBaseWeights.financial_health,
    risk_assessment: adjustedBaseWeights.risk_assessment,
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const toInvestmentScore = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    if (key === "risk_assessment") {
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

  const effectiveScores: Record<string, number | null> = {};
  const penalties: Record<string, number> = {};
  const usedScores: Record<string, number | null> = {};
  const componentDetails: Record<string, ComponentDetail> = {};
  const statuses: Record<string, string | null> = {};

  const penalize = (key: (typeof componentsInOrder)[number], kind: "missing" | "non_ok", why: string): void => {
    statuses[key] = kind === "missing" ? "penalized_missing" : "penalized_non_ok";
    usedScores[key] = 50;
    penalties[key] = kind === "missing" ? PENALTY_MISSING : PENALTY_NON_OK;
    notes[key].push(`${statuses[key]} -> used_score=50 penalty=${penalties[key]} (${why})`);
  };

  // Always compute a contribution for each component.
  const contributions: Record<string, number | null> = {};
  for (const key of componentsInOrder) {
    const status = componentMeta[key].status;
    const rawScore = raw[key];

    // Default outputs.
    statuses[key] = status;
    penalties[key] = 0;
    usedScores[key] = null;

    // Missing / warn / no-signal -> neutral + penalty.
    if (status == null) {
      penalize(key, "missing", "missing analyzer result");
    } else if (status !== "ok") {
      penalize(key, "non_ok", `status=${status}`);
    } else if (key === "risk_assessment" && riskLooksLikeNoSignal) {
      penalize(key, "non_ok", "no_signal (risk_score=0 and empty risk_map)");
    } else if (!isFiniteNumber(rawScore)) {
      if (key === "metric_benchmark") {
        const metricsCount = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
          ? results.metric_benchmark.metrics_analyzed.length
          : 0;
        if (metricsCount === 0) notes[key].push("no metrics extracted");
      }
      penalize(key, "missing", "null score");
    } else {
      // OK path: use analyzer score (with risk inversion + low-confidence blending).
      statuses[key] = "ok";
      usedScores[key] = toEffectiveInvestmentScore(key, rawScore);

      const conf = componentMeta[key].confidence;
      if (isFiniteNumber(conf) && conf < 0.5) {
        notes[key].push(`low confidence (${conf.toFixed(2)} < 0.50) -> blended toward neutral baseline (50)`);
      }
      if (key === "risk_assessment") {
        notes[key].push(`risk inverted: ${rawScore} -> ${100 - rawScore}`);
      }
      if (key === "slide_sequence") {
        const deviationsCount = Array.isArray(results?.slide_sequence?.deviations)
          ? results.slide_sequence.deviations.length
          : 0;
        if (deviationsCount > 0) {
          notes[key].push(`${deviationsCount} sequence deviations detected`);
        }
      }
    }

    const used = usedScores[key];
    const penalty = penalties[key] ?? 0;
    const effective = used == null ? null : Math.min(100, Math.max(0, used - penalty));
    effectiveScores[key] = effective;

    const detail = buildComponentDetail({
      key,
      dio,
      results,
      status: componentMeta[key].status,
      computed_status: statuses[key],
      raw_score: rawScore,
      used_score: usedScores[key],
      penalty,
      confidence: componentMeta[key].confidence,
    });
    componentDetails[key] = detail;

    // Weighted contribution uses the effective score.
    if (effective == null) {
      contributions[key] = null;
      continue;
    }

    if (totalWeight === 0) {
      contributions[key] = 0;
      continue;
    }

    const w = (weights as any)[key] as number;
    if (!w) {
      contributions[key] = 0;
      continue;
    }
    contributions[key] = (w / totalWeight) * effective;
  }

  const unadjustedSum = Object.values(contributions)
    .reduce((sum: number, v) => sum + (isFiniteNumber(v) ? v : 0), 0);
  const unadjustedOverall = totalWeight > 0
    ? Math.round(unadjustedSum + 1e-9)
    : null;

  // For coverage/confidence, do not count analyzers excluded by the active policy.
  // This prevents excluded-by-policy components from dragging down coverage_ratio/evidence_factor.
  const enabledByPolicy = classificationSelectedPolicy
    ? new Set([
        ...getDealPolicy(classificationSelectedPolicy).required_analyzers,
        ...getDealPolicy(classificationSelectedPolicy).optional_analyzers,
      ])
    : null;

  const weightedKeys = componentsInOrder
    .filter(k => ((weights as any)[k] as number) > 0)
    .filter(k => (enabledByPolicy ? enabledByPolicy.has(k as any) : true));

  const coverageValues = weightedKeys.map((k) => {
    if (statuses[k] === "ok") return isFiniteNumber(componentMeta[k].coverage) ? (componentMeta[k].coverage as number) : 0;
    return 0;
  });
  const coverageRatio = coverageValues.length > 0
    ? clamp01(coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length)
    : 0;

  const confidenceValues = weightedKeys.map((k) => {
    if (statuses[k] === "ok") return isFiniteNumber(componentMeta[k].confidence) ? (componentMeta[k].confidence as number) : 0;
    return 0;
  });
  const analyzerConfidence = confidenceValues.length > 0
    ? clamp01(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
    : 0;

  const contextConfidence = isFiniteNumber((ctx as any)?.confidence) ? (ctx as any).confidence : 1;
  const confidenceScore = Math.min(1, Math.max(0, analyzerConfidence * contextConfidence));

  // Evidence + due diligence directly affect the final investment score by blending toward neutral baseline.
  // - evidence_factor: uses analyzer coverage as a proxy for how much supporting signal we actually had
  // - due_diligence_factor: uses document verification readiness when present
  // - adjustment_factor = evidence_factor * due_diligence_factor
  // - overall_score = unadjusted*adjustment + 50*(1-adjustment)
  let evidenceFactor = clamp01(0.5 + 0.5 * coverageRatio);

  // Policy behavior: execution_ready_v1 should not auto-fail for missing revenue.
  // Readiness evidence is required; if missing, keep the final score close to neutral (~50) even if other components are strong.
  if (classificationSelectedPolicy === "execution_ready_v1" && rubricEval) {
    const missingReadiness = rubricEval.missing_required.length;
    if (missingReadiness > 0) {
      const cap = missingReadiness >= 2 ? 0.1 : 0.15;
      if (evidenceFactor > cap) {
        evidenceFactor = cap;
        notes.metric_benchmark.push(
          `execution_ready_v1: missing required readiness signals (${missingReadiness}) -> evidence_factor capped to ${cap.toFixed(2)}`
        );
      }
    }
  }

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

  let overall = unadjustedOverall === null
    ? null
    : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));

  // Policy rubric caps: if critical red flags are present, cap overall below the "75+" threshold.
  if (overall !== null && rubricEval && Array.isArray(rubricEval.red_flags_triggered) && rubricEval.red_flags_triggered.length > 0) {
    const cap = 70;
    if (overall > cap) {
      overall = cap;
      notes.risk_assessment.push(`rubric cap applied (${cap}) due to red_flags: ${rubricEval.red_flags_triggered.join(", ")}`);
    }
  }

  const mkComponent = (key: (typeof componentsInOrder)[number]): ScoreComponent => {
    const { status, coverage, confidence } = componentMeta[key];
    const rawScore = raw[key];
    const wc = contributions[key];
    const hasDebug = Boolean((results as any)?.[key]?.debug_scoring);
    const debug_ref = hasDebug ? `dio.analyzer_results.${key}.debug_scoring` : undefined;
    const detail = (componentDetails[key] ?? {
      reason: "Neutral baseline used",
      reasons: ["Neutral baseline used"],
      evidence_ids: [],
      gaps: [],
      red_flags: [],
    }) as ComponentDetail;

    return {
      status: statuses[key] ?? status,
      used_score: usedScores[key],
      penalty: penalties[key] ?? 0,
      reason: detail.reason,
      reasons: detail.reasons,
      evidence_ids: detail.evidence_ids,
      gaps: detail.gaps,
      red_flags: detail.red_flags,
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
      policy_id: classificationSelectedPolicy,
      weights,
      included_components: [...componentsInOrder],
      excluded_components: [],
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
          statuses.risk_assessment === "ok" && isFiniteNumber(rawRisk) && !riskLooksLikeNoSignal
            ? 100 - rawRisk
            : 50,
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

const mapComponentStatusForDiagnostics = (status: string | null): string => {
  if (!status) return "error";
  if (status === "ok") return "ok";
  if (status === "insufficient_data") return "insufficient_data";
  if (status.startsWith("penalized")) return "penalized";
  if (status === "extraction_failed") return "error";
  return status;
};

export function buildScoringDiagnosticsFromDIO(dio: DealIntelligenceObject): ScoringDiagnosticsV1 {
  const explanation = buildScoreExplanationFromDIO(dio);
  const rubricEval = evaluatePolicyRubric(dio, explanation.aggregation.policy_id);

  const componentsInOrder = [
    "slide_sequence",
    "metric_benchmark",
    "visual_design",
    "narrative_arc",
    "financial_health",
    "risk_assessment",
  ] as const;

  const components: ScoringDiagnosticsV1["components"] = {};

  for (const key of componentsInOrder) {
    const c: any = (explanation.components as any)[key];
    const weight = (explanation.aggregation.weights as any)[key] as number;
    components[key] = {
      status: mapComponentStatusForDiagnostics(typeof c?.status === "string" ? c.status : null),
      raw_score: typeof c?.raw_score === "number" ? c.raw_score : null,
      used_score: typeof c?.used_score === "number" ? c.used_score : null,
      weight: typeof weight === "number" ? weight : 0,
      confidence: typeof c?.confidence === "number" ? c.confidence : null,
      reason: typeof c?.reason === "string" && c.reason.trim() ? c.reason : "Neutral baseline used",
      reasons: Array.isArray(c?.reasons) ? (c.reasons as string[]) : [],
      evidence_ids: Array.isArray(c?.evidence_ids) ? (c.evidence_ids as string[]) : [],
      gaps: Array.isArray(c?.gaps) ? (c.gaps as string[]) : [],
      red_flags: Array.isArray(c?.red_flags) ? (c.red_flags as string[]) : [],
    };
  }

  const buckets: ScoringDiagnosticsV1["buckets"] = {
    positive_signals: [],
    red_flags: [],
    coverage_gaps: [],
  };

  for (const key of componentsInOrder) {
    const comp = components[key];
    const evidence_ids = Array.isArray(comp.evidence_ids) ? comp.evidence_ids : [];

    if (Array.isArray(comp.red_flags) && comp.red_flags.length > 0) {
      for (const text of comp.red_flags) {
        buckets.red_flags.push({ component: key, text, evidence_ids });
      }
    }

    if ((Array.isArray(comp.gaps) && comp.gaps.length > 0) || comp.status === "insufficient_data" || comp.status === "penalized" || comp.status === "error") {
      buckets.coverage_gaps.push({ component: key, text: comp.reason, evidence_ids });
    }

    const used = typeof comp.used_score === "number" ? comp.used_score : null;
    if (comp.status === "ok" && used !== null && used >= 60 && (!Array.isArray(comp.red_flags) || comp.red_flags.length === 0)) {
      buckets.positive_signals.push({ component: key, text: comp.reason, evidence_ids });
    }
  }

  const overall_score = explanation.totals.overall_score ?? 50;
  const unadjusted_overall_score = explanation.totals.unadjusted_overall_score ?? 50;

  // Policy-scoped: for real_estate_underwriting, explicitly explain why a 75+ score is justified.
  // This is additive only (does not remove/alter existing diagnostics).
  if (explanation.aggregation.policy_id === "real_estate_underwriting") {
    const docs: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];
    const combinedText = docs
      .map((d) => (typeof d?.textSummary === "string" ? d.textSummary : typeof d?.text_summary === "string" ? d.text_summary : ""))
      .filter(Boolean)
      .join("\n\n");

    // Build a metrics map from the metric_benchmark analyzer output when available.
    const metricsAnalyzed: any[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
      ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
      : [];
    const metricsMap: Record<string, number> = {};
    for (const m of metricsAnalyzed) {
      if (typeof m?.metric !== "string") continue;
      if (typeof m?.value !== "number" || !Number.isFinite(m.value)) continue;
      metricsMap[m.metric] = m.value;
    }

    const protections = detectRealEstateUnderwritingProtections({ pitch_text: combinedText, metrics: metricsMap });
    if (protections.fully_protected || protections.protections_score >= 4) {
      const mb: any = (explanation.components as any).metric_benchmark;
      const evidence_ids = Array.isArray(mb?.evidence_ids) ? (mb.evidence_ids as string[]) : [];

      const hasCashFlows = !buckets.positive_signals.some((b) => b.text === "Contracted cash flows");
      const hasDownside = !buckets.positive_signals.some((b) => b.text === "Downside protection via lease/guarantees");

      if (hasCashFlows) buckets.positive_signals.push({ component: "metric_benchmark", text: "Contracted cash flows", evidence_ids });
      if (hasDownside) buckets.positive_signals.push({ component: "metric_benchmark", text: "Downside protection via lease/guarantees", evidence_ids });
    }
  }

  // Add rubric-derived diagnostics as first-class fields + buckets.
  let rubric: ScoringDiagnosticsV1["rubric"] = undefined;
  if (rubricEval) {
    const cap = 70;
    const preCap = Math.round(unadjusted_overall_score * explanation.totals.adjustment_factor + 50 * (1 - explanation.totals.adjustment_factor));
    const scoreCapApplied = rubricEval.red_flags_triggered.length > 0 && preCap > cap && overall_score === cap ? cap : null;

    rubric = {
      id: rubricEval.id,
      required_signals: rubricEval.required_signals,
      missing_required: rubricEval.missing_required,
      positive_drivers_present: rubricEval.positive_drivers_present,
      acceptable_missing_present: rubricEval.acceptable_missing_present,
      red_flags_triggered: rubricEval.red_flags_triggered,
      has_revenue_metric: rubricEval.has_revenue_metric,
      score_cap_applied: scoreCapApplied,
    };

    if (rubricEval.missing_required.length > 0) {
      buckets.coverage_gaps.push({
        component: "rubric",
        text: `Missing required signals: ${rubricEval.missing_required.join(", ")}`,
        evidence_ids: [],
      });
    }
    if (rubricEval.red_flags_triggered.length > 0) {
      buckets.red_flags.push({
        component: "rubric",
        text: `Rubric red flags: ${rubricEval.red_flags_triggered.join(", ")}`,
        evidence_ids: [],
      });
    }
  }

  return {
    policy_id: explanation.aggregation.policy_id,
    overall_score,
    unadjusted_overall_score,
    adjustment_factor: explanation.totals.adjustment_factor,
    evidence_factor: explanation.totals.evidence_factor,
    due_diligence_factor: explanation.totals.due_diligence_factor,
    coverage_ratio: explanation.totals.coverage_ratio,
    components,
    buckets,
    rubric,
  };
}
