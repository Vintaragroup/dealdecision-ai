import { getDealPolicy } from "../classification/deal-policy-registry.js";
import { getScoreBandV2 } from "../scoring/score-bands-v2.js";
import { getStageWeightMatrix } from "../scoring/stage-weight-matrix.js";
import type {
  ConvictionContributorV1,
  ConvictionContradictionV1,
  ConvictionInputFamilyKeyV1,
  ConvictionInputFamilyV1,
  ConvictionInputsV1,
  ConvictionV1,
} from "../models/conviction-v1.js";

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const clampScore = (n: number): number => {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const uniqueStrings = (xs: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const componentLabel: Record<string, string> = {
  slide_sequence: "Narrative Structure",
  metric_benchmark: "Traction and Metrics",
  visual_design: "Presentation Quality",
  narrative_arc: "Story Coherence",
  financial_health: "Financial Health",
  risk_assessment: "Risk Profile",
  business_model: "Business Model",
  market: "Market",
  traction: "Traction",
  team: "Team",
  financial_profile: "Financial Profile",
};

const contradictionCodes = new Set([
  "tam_without_traction",
  "tam_without_icp",
  "tam_without_distribution",
  "forecast_without_history",
  "growth_without_recurring_revenue",
  "business_model_absent",
  "no_technical_lead",
  "no_gtm_lead",
]);

const mapPostureFromBand = (band: string): string => {
  if (band === "hard_pass") return "pass";
  if (band === "consider_caution") return "consider";
  if (band === "strong_consider") return "consider";
  if (band === "fund_caution") return "yes";
  if (band === "fund_track") return "yes";
  if (band === "fund_confident") return "strong_yes";
  return "consider";
};

const normalizeEvidenceRef = (ref: any): string | null => {
  const doc = asString(ref?.document_id);
  const pageIndex = typeof ref?.page_index === "number" ? ref.page_index : null;
  const page = typeof ref?.page === "number" ? ref.page : null;
  const sourcePath = asString(ref?.source_path);
  if (sourcePath) return sourcePath;
  if (doc && pageIndex != null) return `${doc}:page_index:${pageIndex}`;
  if (doc && page != null) return `${doc}:page:${page}`;
  if (doc) return doc;
  return null;
};

const refsFromCoverageEvidence = (evidence: any): string[] => {
  if (!evidence || typeof evidence !== "object") return [];
  const out: string[] = [];
  for (const key of Object.keys(evidence)) {
    const ref = normalizeEvidenceRef((evidence as any)[key]);
    if (ref) out.push(ref);
  }
  return uniqueStrings(out);
};

const sourcePriorityFromKind = (kind: string | null): number => {
  const k = (kind ?? "").toLowerCase();
  if (k === "xlsx") return 1;
  if (k === "cap_table") return 2;
  if (k === "structured") return 3;
  if (k === "deck") return 4;
  return 5;
};

const familyLabel: Record<ConvictionInputFamilyKeyV1, string> = {
  financial_truth: "Financial Truth",
  capital_structure: "Capital Structure",
  traction_validation: "Traction Validation",
  market_demand: "Market Demand",
  product_or_asset_quality: "Product/Asset Quality",
  team_execution: "Team Execution",
  risk_dependencies: "Risk Dependencies",
  external_corroboration: "External Corroboration",
  evidence_quality: "Evidence Quality",
  coverage: "Coverage",
  contradictions: "Contradictions",
};

const mkFamily = (
  family: ConvictionInputFamilyKeyV1,
  status: ConvictionInputFamilyV1["status"],
  signalStrength: number,
  confidence: number,
  coverage: number,
  source: string,
  sourcePriority: number,
  evidenceRefs: string[],
  notes: string[] = [],
): ConvictionInputFamilyV1 => ({
  family,
  status,
  signal_strength: clamp01(signalStrength),
  confidence: clamp01(confidence),
  coverage: clamp01(coverage),
  source,
  source_priority: sourcePriority,
  evidence_refs: uniqueStrings(evidenceRefs),
  notes: uniqueStrings(notes),
});

const buildContradictions = (scoreExplanation: any): ConvictionContradictionV1[] => {
  const out: ConvictionContradictionV1[] = [];

  const comps = scoreExplanation?.components;
  if (comps && typeof comps === "object") {
    for (const key of Object.keys(comps)) {
      const comp = comps[key];
      const redFlags = Array.isArray(comp?.red_flags) ? comp.red_flags : [];
      for (const flag of redFlags) {
        const text = asString(flag);
        if (!text) continue;
        out.push({
          code: `red_flag_${key}`,
          text,
          severity: "medium",
          evidence_refs: Array.isArray(comp?.evidence_ids) ? uniqueStrings(comp.evidence_ids.map((x: any) => String(x))) : [],
          source: `score_explanation.components.${key}.red_flags`,
        });
      }
    }
  }

  const dims = Array.isArray(scoreExplanation?.stage_weighted_v1?.dimensions)
    ? scoreExplanation.stage_weighted_v1.dimensions
    : [];
  for (const dim of dims) {
    const notes = Array.isArray(dim?.notes) ? dim.notes : [];
    for (const note of notes) {
      const code = asString(note);
      if (!code || !contradictionCodes.has(code)) continue;
      out.push({
        code,
        text: `${componentLabel[String(dim?.key)] ?? String(dim?.key)} has conflicting support (${code}).`,
        severity: "low",
        evidence_refs: Array.isArray(dim?.evidence_ids) ? uniqueStrings(dim.evidence_ids.map((x: any) => String(x))) : [],
        source: "score_explanation.stage_weighted_v1.dimensions.notes",
      });
    }
  }

  const deduped = new Map<string, ConvictionContradictionV1>();
  for (const c of out) {
    const id = `${c.code}|${c.text}`;
    if (!deduped.has(id)) deduped.set(id, c);
  }
  return Array.from(deduped.values()).slice(0, 8);
};

export function buildConvictionV1(args: {
  selected_policy_id?: string | null;
  overall_score?: number | null;
  recommendation?: string | null;
  score_explanation?: any;
  funding_stage_v1?: any;
  financial_coverage_v1?: any;
  capital_logic_v1?: any;
  business_model_signal_v1?: any;
  market_accessibility_signal_v1?: any;
  traction_signal_v1?: any;
  team_signal_v1?: any;
  underwriting_readiness_v1?: any;
  financial_breakdown_v1?: any;
}): ConvictionV1 {
  const scoreExplanation = args.score_explanation && typeof args.score_explanation === "object"
    ? args.score_explanation
    : null;

  const selectedPolicyId =
    asString(args.selected_policy_id)
    ?? asString(scoreExplanation?.aggregation?.policy_id)
    ?? null;

  const stageRaw = asString(args.funding_stage_v1?.funding_stage);
  const stage: "pre_seed" | "seed" | "series_a" | "growth" | "unknown" =
    stageRaw === "pre_seed" || stageRaw === "seed" || stageRaw === "series_a" || stageRaw === "growth"
      ? stageRaw
      : "unknown";

  const contradictions = buildContradictions(scoreExplanation);

  const coverageProfile = args.financial_coverage_v1;
  const coverageEvidenceRefs = refsFromCoverageEvidence(coverageProfile?.evidence);
  const coverageSources = Array.isArray(coverageProfile?.sources) ? coverageProfile.sources : [];
  const topCoverageSource = asString(coverageSources[0]?.kind) ?? "unknown";

  const hasFinancialTruth = Boolean(
    coverageProfile?.coverage?.historical_revenue_present
    || coverageProfile?.coverage?.income_statement_present
    || coverageProfile?.coverage?.burn_rate_present
    || coverageProfile?.coverage?.runway_present,
  );

  const hasForecastOnly = Boolean(
    coverageProfile?.coverage?.forecast_revenue_present
    && !coverageProfile?.coverage?.historical_revenue_present,
  );

  const hasHistoricalRevenue = Boolean(coverageProfile?.coverage?.historical_revenue_present);
  const hasIncome = Boolean(coverageProfile?.coverage?.income_statement_present);
  const hasBurn = Boolean(coverageProfile?.coverage?.burn_rate_present);
  const hasRunway = Boolean(coverageProfile?.coverage?.runway_present);

  const financialSignal = hasHistoricalRevenue || hasIncome || hasBurn || hasRunway ? 0.85 : hasForecastOnly ? 0.55 : 0.35;
  const financialConfidence = hasHistoricalRevenue && hasIncome ? 0.85 : hasForecastOnly ? 0.55 : 0.45;
  const financialCoverage = clamp01(([hasHistoricalRevenue, hasIncome, hasBurn, hasRunway].filter(Boolean).length) / 4);

  const capitalLogic = args.capital_logic_v1;
  const capitalSignal = clamp01(
    (capitalLogic?.raise?.present ? 0.40 : 0)
    + (capitalLogic?.use_of_funds?.present ? 0.35 : 0)
    + (capitalLogic?.milestones?.present ? 0.25 : 0),
  );
  const capitalConfidence = capitalLogic?.confidence === "high" ? 0.85 : capitalLogic?.confidence === "medium" ? 0.65 : 0.45;
  const capitalCoverage = clamp01([
    Boolean(capitalLogic?.raise?.present),
    Boolean(capitalLogic?.use_of_funds?.present),
    Boolean(capitalLogic?.milestones?.present),
  ].filter(Boolean).length / 3);

  const tractionSignalModel = args.traction_signal_v1;
  const tractionSignal = clamp01(
    (tractionSignalModel?.historical_revenue_present ? 0.45 : 0)
    + (tractionSignalModel?.customer_evidence_present ? 0.30 : 0)
    + (tractionSignalModel?.growth_signal_present ? 0.25 : 0),
  );
  const tractionConfidence = tractionSignalModel?.confidence === "high" ? 0.85 : tractionSignalModel?.confidence === "medium" ? 0.65 : 0.45;
  const tractionCoverage = clamp01([
    Boolean(tractionSignalModel?.historical_revenue_present),
    Boolean(tractionSignalModel?.customer_evidence_present),
    Boolean(tractionSignalModel?.growth_signal_present),
  ].filter(Boolean).length / 3);

  const marketSignalModel = args.market_accessibility_signal_v1;
  const marketSignal = clamp01(
    (marketSignalModel?.icp_defined ? 0.40 : 0)
    + (marketSignalModel?.distribution_path_present ? 0.35 : 0)
    + (marketSignalModel?.som_defined ? 0.25 : 0),
  );
  const marketConfidence = marketSignalModel?.confidence === "high" ? 0.85 : marketSignalModel?.confidence === "medium" ? 0.65 : 0.45;
  const marketCoverage = clamp01([
    Boolean(marketSignalModel?.icp_defined),
    Boolean(marketSignalModel?.distribution_path_present),
    Boolean(marketSignalModel?.som_defined),
  ].filter(Boolean).length / 3);

  const businessModelSignal = args.business_model_signal_v1;
  const productSignal = clamp01(
    (businessModelSignal?.pricing_present ? 0.35 : 0)
    + (businessModelSignal?.revenue_model_present ? 0.35 : 0)
    + (businessModelSignal?.customer_segment_present ? 0.30 : 0),
  );
  const productConfidence = businessModelSignal?.confidence === "high" ? 0.85 : businessModelSignal?.confidence === "medium" ? 0.65 : 0.45;
  const productCoverage = clamp01([
    Boolean(businessModelSignal?.pricing_present),
    Boolean(businessModelSignal?.revenue_model_present),
    Boolean(businessModelSignal?.customer_segment_present),
  ].filter(Boolean).length / 3);

  const teamSignal = args.team_signal_v1;
  const teamSignalStrength = clamp01(
    (typeof teamSignal?.founder_count === "number" && teamSignal.founder_count > 0 ? 0.40 : 0)
    + (teamSignal?.key_roles_present?.technical ? 0.25 : 0)
    + (teamSignal?.key_roles_present?.gtm ? 0.20 : 0)
    + (teamSignal?.domain_experience_present ? 0.15 : 0),
  );
  const teamConfidence = teamSignal?.confidence === "high" ? 0.85 : teamSignal?.confidence === "medium" ? 0.65 : 0.45;
  const teamCoverage = clamp01([
    Boolean(typeof teamSignal?.founder_count === "number"),
    Boolean(teamSignal?.key_roles_present?.technical),
    Boolean(teamSignal?.key_roles_present?.gtm),
    Boolean(teamSignal?.domain_experience_present),
  ].filter(Boolean).length / 4);

  const riskComponent = scoreExplanation?.components?.risk_assessment;
  const riskRedFlags = Array.isArray(riskComponent?.red_flags) ? riskComponent.red_flags.length : 0;
  const riskGaps = Array.isArray(riskComponent?.gaps) ? riskComponent.gaps.length : 0;
  const riskSignal = clamp01(Math.min(1, (riskRedFlags * 0.25) + (riskGaps * 0.1)));
  const riskConfidence = clamp01(asNumber(riskComponent?.confidence) ?? 0.6);
  const riskCoverage = clamp01(asNumber(riskComponent?.coverage) ?? 0.5);

  const totals = scoreExplanation?.totals;
  const evidenceQualitySignal = clamp01(
    (asNumber(totals?.confidence_score) ?? 0.5) * 0.5
    + (asNumber(totals?.evidence_factor) ?? 0.5) * 0.5,
  );
  const evidenceQualityCoverage = clamp01(asNumber(totals?.coverage_ratio) ?? 0.5);

  const contradictionWeight = contradictions.reduce((sum, c) => {
    const sev = c.severity === "high" ? 1 : c.severity === "medium" ? 0.7 : 0.45;
    return sum + sev;
  }, 0);
  const contradictionSignal = clamp01(contradictionWeight / 4);
  const contradictionCoverage = clamp01(contradictions.length > 0 ? 0.85 : 0.2);

  const familyInputs: ConvictionInputsV1 = {
    financial_truth: mkFamily(
      "financial_truth",
      statusFromScore(financialSignal),
      financialSignal,
      financialConfidence,
      financialCoverage,
      topCoverageSource,
      sourcePriorityFromKind(topCoverageSource),
      coverageEvidenceRefs,
      Array.isArray(coverageProfile?.notes) ? coverageProfile.notes.map((x: any) => String(x)) : [],
    ),
    capital_structure: mkFamily(
      "capital_structure",
      statusFromScore(capitalSignal),
      capitalSignal,
      capitalConfidence,
      capitalCoverage,
      "capital_logic_v1",
      2,
      Array.isArray(capitalLogic?.raise?.sources) ? capitalLogic.raise.sources.map(normalizeEvidenceRef).filter(Boolean) as string[] : [],
      Array.isArray(capitalLogic?.notes) ? capitalLogic.notes.map((x: any) => String(x)) : [],
    ),
    traction_validation: mkFamily(
      "traction_validation",
      statusFromScore(tractionSignal),
      tractionSignal,
      tractionConfidence,
      tractionCoverage,
      "traction_signal_v1",
      3,
      Array.isArray(scoreExplanation?.components?.metric_benchmark?.evidence_ids)
        ? scoreExplanation.components.metric_benchmark.evidence_ids.map((x: any) => String(x))
        : [],
      Array.isArray(scoreExplanation?.components?.metric_benchmark?.gaps)
        ? scoreExplanation.components.metric_benchmark.gaps.map((x: any) => String(x))
        : [],
    ),
    market_demand: mkFamily(
      "market_demand",
      statusFromScore(marketSignal),
      marketSignal,
      marketConfidence,
      marketCoverage,
      "market_accessibility_signal_v1",
      3,
      Array.isArray(scoreExplanation?.components?.slide_sequence?.evidence_ids)
        ? scoreExplanation.components.slide_sequence.evidence_ids.map((x: any) => String(x))
        : [],
      Array.isArray(scoreExplanation?.components?.slide_sequence?.gaps)
        ? scoreExplanation.components.slide_sequence.gaps.map((x: any) => String(x))
        : [],
    ),
    product_or_asset_quality: mkFamily(
      "product_or_asset_quality",
      statusFromScore(productSignal),
      productSignal,
      productConfidence,
      productCoverage,
      "business_model_signal_v1",
      3,
      Array.isArray(scoreExplanation?.components?.narrative_arc?.evidence_ids)
        ? scoreExplanation.components.narrative_arc.evidence_ids.map((x: any) => String(x))
        : [],
      Array.isArray(businessModelSignal?.notes) ? businessModelSignal.notes.map((x: any) => String(x)) : [],
    ),
    team_execution: mkFamily(
      "team_execution",
      statusFromScore(teamSignalStrength),
      teamSignalStrength,
      teamConfidence,
      teamCoverage,
      "team_signal_v1",
      3,
      [],
      Array.isArray(teamSignal?.signals)
        ? teamSignal.signals.filter((s: any) => s?.present).map((s: any) => String(s?.code ?? "")).filter(Boolean)
        : [],
    ),
    risk_dependencies: mkFamily(
      "risk_dependencies",
      statusFromScore(1 - riskSignal, riskSignal >= 0.45),
      riskSignal,
      riskConfidence,
      riskCoverage,
      "score_explanation.components.risk_assessment",
      3,
      Array.isArray(riskComponent?.evidence_ids) ? riskComponent.evidence_ids.map((x: any) => String(x)) : [],
      Array.isArray(riskComponent?.red_flags) ? riskComponent.red_flags.map((x: any) => String(x)) : [],
    ),
    external_corroboration: mkFamily(
      "external_corroboration",
      "unknown",
      0.50,
      0.50,
      0.20,
      "not_available_phase1",
      5,
      [],
      ["reserved_for_future_external_signal_integration"],
    ),
    evidence_quality: mkFamily(
      "evidence_quality",
      statusFromScore(evidenceQualitySignal),
      evidenceQualitySignal,
      evidenceQualitySignal,
      evidenceQualityCoverage,
      "score_explanation.totals",
      3,
      [],
      [
        `confidence_score=${(asNumber(totals?.confidence_score) ?? 0).toFixed(3)}`,
        `evidence_factor=${(asNumber(totals?.evidence_factor) ?? 0).toFixed(3)}`,
      ],
    ),
    coverage: mkFamily(
      "coverage",
      statusFromScore(evidenceQualityCoverage),
      evidenceQualityCoverage,
      evidenceQualitySignal,
      evidenceQualityCoverage,
      "score_explanation.totals",
      3,
      coverageEvidenceRefs,
      [`coverage_ratio=${evidenceQualityCoverage.toFixed(3)}`],
    ),
    contradictions: mkFamily(
      "contradictions",
      contradictions.length > 0 ? "contradicted" : "probable",
      contradictionSignal,
      0.80,
      contradictionCoverage,
      "conviction_v1.contradictions",
      3,
      contradictions.flatMap((c) => c.evidence_refs),
      contradictions.map((c) => c.code),
    ),
  };

  const familyWeights = buildPolicyFamilyWeights(selectedPolicyId, stage);

  const positiveFamilies: ConvictionInputFamilyKeyV1[] = [
    "financial_truth",
    "capital_structure",
    "traction_validation",
    "market_demand",
    "product_or_asset_quality",
    "team_execution",
    "external_corroboration",
  ];

  const dragFamilies: ConvictionInputFamilyKeyV1[] = [
    "risk_dependencies",
    "contradictions",
    "coverage",
    "evidence_quality",
    "financial_truth",
  ];

  const weightedAverage = (keys: ConvictionInputFamilyKeyV1[], picker: (f: ConvictionInputFamilyV1) => number): number => {
    let num = 0;
    let den = 0;
    for (const key of keys) {
      const w = familyWeights[key] ?? 0;
      if (!(w > 0)) continue;
      num += w * picker(familyInputs[key]);
      den += w;
    }
    return den > 0 ? clamp01(num / den) : 0.5;
  };

  const positiveIndex = weightedAverage(positiveFamilies, (f) => buildFamilyScore(f.signal_strength, f.confidence, f.coverage));

  const dragIndex = weightedAverage(dragFamilies, (f) => {
    if (f.family === "coverage") return clamp01(1 - f.signal_strength);
    if (f.family === "evidence_quality") return clamp01(1 - f.signal_strength);
    if (f.family === "financial_truth") {
      if (f.status === "unknown") return 0.18;
      return familyDragScore(f.status, 1 - f.signal_strength, f.confidence);
    }
    return familyDragScore(f.status, f.signal_strength, f.confidence);
  });

  const coverageRatio = weightedAverage(
    [
      "financial_truth",
      "capital_structure",
      "traction_validation",
      "market_demand",
      "product_or_asset_quality",
      "team_execution",
      "evidence_quality",
      "coverage",
    ],
    (f) => f.coverage,
  );

  const confidence = weightedAverage(
    [
      "financial_truth",
      "capital_structure",
      "traction_validation",
      "market_demand",
      "product_or_asset_quality",
      "team_execution",
      "risk_dependencies",
      "evidence_quality",
    ],
    (f) => f.confidence,
  );

  const contradictionIndex = clamp01(
    0.75 * contradictionSignal + 0.25 * (contradictions.length > 0 ? 1 : 0),
  );

  const baseScore = clampScore(100 * (0.14 + (0.80 * positiveIndex) - (0.52 * dragIndex)));
  const modulation = clamp01((0.60 + 0.40 * confidence) * (0.72 + 0.28 * coverageRatio));

  let convictionScore = clampScore((baseScore * modulation) - (contradictionIndex * 18));

  if (contradictionIndex >= 0.70) convictionScore = Math.min(convictionScore, 54);
  if (familyInputs.risk_dependencies.status === "contradicted" && familyInputs.risk_dependencies.signal_strength >= 0.70) {
    convictionScore = Math.min(convictionScore, 49);
  }
  if (familyInputs.financial_truth.status === "unknown" && coverageRatio < 0.35) {
    convictionScore = Math.min(convictionScore, 64);
  }

  const band = getScoreBandV2(convictionScore);
  const recommendationPosture = mapPostureFromBand(band.key);

  const contributors: Array<ConvictionContributorV1 & { family: ConvictionInputFamilyKeyV1 }> = [];
  for (const key of Object.keys(familyInputs) as ConvictionInputFamilyKeyV1[]) {
    const f = familyInputs[key];
    const w = familyWeights[key] ?? 0;
    const positiveContribution = buildFamilyScore(f.signal_strength, f.confidence, f.coverage);
    let delta = (positiveContribution - 0.5) * (w * 100);

    if (key === "risk_dependencies" || key === "contradictions") {
      delta = -1 * (familyDragScore(f.status, f.signal_strength, f.confidence) * (w * 100));
    }
    if (key === "coverage" || key === "evidence_quality") {
      delta = (f.signal_strength - 0.5) * (w * 80);
    }

    contributors.push({
      family: key,
      key,
      label: familyLabel[key],
      score_delta_0_100: Math.round(delta * 10) / 10,
      evidence_refs: f.evidence_refs,
      notes: f.notes,
    });
  }

  const topPositiveContributors = contributors
    .filter((c) => c.score_delta_0_100 > 0)
    .sort((a, b) => b.score_delta_0_100 - a.score_delta_0_100)
    .slice(0, 3)
    .map(({ family, ...rest }) => rest);

  const topNegativeContributors = contributors
    .filter((c) => c.score_delta_0_100 < 0)
    .sort((a, b) => a.score_delta_0_100 - b.score_delta_0_100)
    .slice(0, 3)
    .map(({ family, ...rest }) => rest);

  const unknownsFromFamilies = buildUnknownsFromFamilies(familyInputs);
  const missingInputs = Array.isArray(scoreExplanation?.totals?.unadjusted_missing_inputs)
    ? uniqueStrings(scoreExplanation.totals.unadjusted_missing_inputs.map((x: any) => String(x)))
    : [];

  const unknowns = [
    ...unknownsFromFamilies,
    ...missingInputs.map((code) => ({
      code,
      text: `Signal currently unknown: ${code}.`,
      evidence_refs: [],
    })),
  ].slice(0, 8);

  const requiredNextChecks: ConvictionV1["required_next_checks"] = [];
  for (const u of unknowns.slice(0, 3)) {
    requiredNextChecks.push({
      text: `Provide deterministic evidence for ${u.code.replace(/^unknown_/, "")}.`,
      expected_direction: "clarify",
      evidence_refs: u.evidence_refs,
    });
  }

  for (const c of contradictions.slice(0, 2)) {
    requiredNextChecks.push({
      text: `Resolve contradiction: ${c.text}`,
      expected_direction: "increase",
      evidence_refs: c.evidence_refs,
    });
  }

  const diligenceOpenItems = Array.isArray(scoreExplanation?.understanding_v1?.diligence_open_items)
    ? scoreExplanation.understanding_v1.diligence_open_items
    : [];
  for (const item of diligenceOpenItems.slice(0, 2)) {
    const text = asString(item?.text);
    if (!text) continue;
    requiredNextChecks.push({
      text,
      expected_direction: "clarify",
      evidence_refs: Array.isArray(item?.evidence_ids) ? uniqueStrings(item.evidence_ids.map((x: any) => String(x))) : [],
    });
  }

  const summaryHeadline = `Conviction ${convictionScore}/100 (${band.label})`;
  const summaryRationale = topPositiveContributors.length > 0
    ? `Primary deterministic support is led by ${topPositiveContributors.map((p) => p.label).join(", ")}.`
    : "Conviction is constrained by limited deterministic support.";

  const policy = getDealPolicy((selectedPolicyId as any) ?? "unknown_generic");

  return {
    schema_version: "conviction_v1",
    selected_policy_id: selectedPolicyId,
    conviction_score_0_100: convictionScore,
    conviction_band: band.key,
    recommendation_posture: recommendationPosture,
    confidence_0_1: confidence,
    coverage_ratio_0_1: coverageRatio,
    contradiction_index_0_1: contradictionIndex,
    inputs: familyInputs,
    summary: {
      headline: summaryHeadline,
      rationale: summaryRationale,
      provisional: false,
      notes: [
        "phase2_native_deterministic_conviction",
        `policy=${selectedPolicyId ?? "unknown_generic"}`,
        `stage=${stage}`,
        `policy_label=${policy.label}`,
      ],
    },
    top_positive_contributors: topPositiveContributors,
    top_negative_contributors: topNegativeContributors,
    unknowns,
    contradictions,
    required_next_checks: requiredNextChecks.slice(0, 6),
    lineage: {
      generated_at: new Date().toISOString(),
      mapping_version: "phase2_deterministic_v1",
      source_artifacts: [
        {
          artifact: "financial_coverage_v1",
          path: "report.financial_coverage_v1",
          used: Boolean(args.financial_coverage_v1),
          note: "phase2 primary financial truth and coverage input",
        },
        {
          artifact: "capital_logic_v1",
          path: "report.capital_logic_v1",
          used: Boolean(args.capital_logic_v1),
          note: "phase2 primary capital-structure input",
        },
        {
          artifact: "business_model_signal_v1",
          path: "report.business_model_signal_v1",
          used: Boolean(args.business_model_signal_v1),
          note: "phase2 primary product/asset quality input",
        },
        {
          artifact: "market_accessibility_signal_v1",
          path: "report.market_accessibility_signal_v1",
          used: Boolean(args.market_accessibility_signal_v1),
          note: "phase2 primary market-demand input",
        },
        {
          artifact: "traction_signal_v1",
          path: "report.traction_signal_v1",
          used: Boolean(args.traction_signal_v1),
          note: "phase2 primary traction-validation input",
        },
        {
          artifact: "team_signal_v1",
          path: "report.team_signal_v1",
          used: Boolean(args.team_signal_v1),
          note: "phase2 primary team-execution input",
        },
        {
          artifact: "funding_stage_v1",
          path: "report.funding_stage_v1",
          used: Boolean(args.funding_stage_v1),
          note: "phase2 stage-aware weighting input",
        },
        {
          artifact: "score_explanation",
          path: "metadata.score_explanation",
          used: Boolean(scoreExplanation),
          note: "phase2 secondary deterministic compatibility input (evidence quality + contradictions), not conviction source of truth",
        },
        {
          artifact: "recommendation",
          path: "report.recommendation",
          used: Boolean(args.recommendation),
          note: "compatibility surface only; conviction posture is computed natively",
        },
        {
          artifact: "overall_score",
          path: "report.overallScore",
          used: asNumber(args.overall_score) != null,
          note: "compatibility surface only; not used as native conviction score passthrough",
        },
        {
          artifact: "financial_breakdown_v1",
          path: "report.financial_breakdown_v1",
          used: Boolean(args.financial_breakdown_v1),
        },
      ],
    },
  };
}

const statusFromScore = (score: number, contradictionHint = false): ConvictionInputFamilyV1["status"] => {
  if (contradictionHint) return "contradicted";
  if (score >= 0.7) return "confirmed";
  if (score >= 0.4) return "probable";
  return "unknown";
};

const buildPolicyFamilyWeights = (policyId: string | null, stage: "pre_seed" | "seed" | "series_a" | "growth" | "unknown"): Record<ConvictionInputFamilyKeyV1, number> => {
  const base: Record<ConvictionInputFamilyKeyV1, number> = {
    financial_truth: 0.16,
    capital_structure: 0.10,
    traction_validation: 0.14,
    market_demand: 0.10,
    product_or_asset_quality: 0.09,
    team_execution: 0.10,
    risk_dependencies: 0.14,
    external_corroboration: 0.03,
    evidence_quality: 0.07,
    coverage: 0.07,
    contradictions: 0.10,
  };

  const pid = policyId ?? "unknown_generic";
  if (pid === "execution_ready_v1") {
    base.traction_validation = 0.10;
    base.product_or_asset_quality = 0.13;
    base.team_execution = 0.14;
    base.capital_structure = 0.12;
    base.financial_truth = 0.08;
  } else if (pid === "real_estate_underwriting") {
    base.financial_truth = 0.20;
    base.capital_structure = 0.14;
    base.market_demand = 0.12;
    base.traction_validation = 0.06;
    base.team_execution = 0.06;
    base.risk_dependencies = 0.16;
    base.product_or_asset_quality = 0.08;
  } else if (pid === "fund_spv" || pid === "acquisition_memo" || pid === "credit_memo") {
    base.financial_truth = 0.18;
    base.capital_structure = 0.16;
    base.risk_dependencies = 0.18;
    base.traction_validation = 0.08;
    base.team_execution = 0.08;
  } else if (pid === "operating_startup_revenue_v1" || pid === "enterprise_saas_b2b_v1" || pid === "consumer_ecommerce_brand_v1" || pid === "consumer_fintech_platform_v1") {
    base.traction_validation = 0.19;
    base.financial_truth = 0.15;
    base.market_demand = 0.11;
    base.product_or_asset_quality = 0.10;
    base.team_execution = 0.10;
    base.risk_dependencies = 0.13;
  }

  const stageWeights = getStageWeightMatrix(stage);
  const stageAdj = {
    traction_validation: stageWeights.traction,
    financial_truth: stageWeights.financial_profile,
    market_demand: stageWeights.market,
    product_or_asset_quality: (stageWeights.solution_product + stageWeights.business_model) / 2,
    team_execution: stageWeights.team,
    capital_structure: stageWeights.use_of_funds_raise_logic,
  };

  base.traction_validation *= 0.8 + stageAdj.traction_validation;
  base.financial_truth *= 0.8 + stageAdj.financial_truth;
  base.market_demand *= 0.8 + stageAdj.market_demand;
  base.product_or_asset_quality *= 0.8 + stageAdj.product_or_asset_quality;
  base.team_execution *= 0.8 + stageAdj.team_execution;
  base.capital_structure *= 0.8 + stageAdj.capital_structure;

  const sum = Object.values(base).reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return base;

  const normalized: Record<ConvictionInputFamilyKeyV1, number> = { ...base };
  for (const key of Object.keys(base) as ConvictionInputFamilyKeyV1[]) {
    normalized[key] = base[key] / sum;
  }
  return normalized;
};

const buildFamilyScore = (signalStrength: number, confidence: number, coverage: number): number =>
  clamp01(0.55 * signalStrength + 0.25 * confidence + 0.20 * coverage);

const familyDragScore = (status: ConvictionInputFamilyV1["status"], strength: number, confidence: number): number => {
  if (status === "contradicted") return clamp01(0.55 + 0.45 * strength);
  if (status === "unknown") return clamp01(0.08 + 0.12 * (1 - confidence));
  return 0;
};

const buildUnknownsFromFamilies = (inputs: ConvictionInputsV1): Array<{ code: string; text: string; evidence_refs: string[] }> => {
  const out: Array<{ code: string; text: string; evidence_refs: string[] }> = [];
  for (const key of Object.keys(inputs) as ConvictionInputFamilyKeyV1[]) {
    const f = inputs[key];
    if (f.status !== "unknown") continue;
    out.push({
      code: `unknown_${key}`,
      text: `${familyLabel[key]} is currently unknown and needs additional deterministic evidence.`,
      evidence_refs: f.evidence_refs,
    });
  }
  return out;
};
