import { getScoreBandV2 } from "../scoring/score-bands-v2.js";
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

const mkFamily = (
  family: ConvictionInputFamilyKeyV1,
  status: ConvictionInputFamilyV1["status"],
  source: string,
  sourcePriority: number,
  evidenceRefs: string[],
  notes: string[] = [],
): ConvictionInputFamilyV1 => ({
  family,
  status,
  source,
  source_priority: sourcePriority,
  evidence_refs: uniqueStrings(evidenceRefs),
  notes: uniqueStrings(notes),
});

const buildContributors = (scoreExplanation: any): { positive: ConvictionContributorV1[]; negative: ConvictionContributorV1[] } => {
  const comps = scoreExplanation?.components;
  if (!comps || typeof comps !== "object") return { positive: [], negative: [] };

  const contributors: ConvictionContributorV1[] = [];
  for (const key of Object.keys(comps)) {
    const comp = comps[key];
    const used = asNumber(comp?.used_score);
    if (used == null) continue;
    const penalty = asNumber(comp?.penalty) ?? 0;
    const delta = Math.round((used - penalty - 50) * 10) / 10;
    contributors.push({
      key,
      label: componentLabel[key] ?? key,
      score_delta_0_100: delta,
      evidence_refs: Array.isArray(comp?.evidence_ids) ? uniqueStrings(comp.evidence_ids.map((x: any) => String(x))) : [],
      notes: Array.isArray(comp?.notes) ? uniqueStrings(comp.notes.map((x: any) => String(x))) : undefined,
    });
  }

  const positive = contributors
    .filter((c) => c.score_delta_0_100 > 0)
    .sort((a, b) => b.score_delta_0_100 - a.score_delta_0_100)
    .slice(0, 3);

  const negative = contributors
    .filter((c) => c.score_delta_0_100 < 0)
    .sort((a, b) => a.score_delta_0_100 - b.score_delta_0_100)
    .slice(0, 3);

  return { positive, negative };
};

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
  financial_coverage_v1?: any;
  capital_logic_v1?: any;
  team_signal_v1?: any;
  financial_breakdown_v1?: any;
}): ConvictionV1 {
  const scoreExplanation = args.score_explanation && typeof args.score_explanation === "object"
    ? args.score_explanation
    : null;

  const selectedPolicyId =
    asString(args.selected_policy_id)
    ?? asString(scoreExplanation?.aggregation?.policy_id)
    ?? null;

  const rawScore =
    asNumber(scoreExplanation?.totals?.overall_score)
    ?? asNumber(args.overall_score)
    ?? 50;
  const convictionScore = clampScore(rawScore);

  const band = getScoreBandV2(convictionScore);
  const recommendationPosture =
    asString(args.recommendation)
    ?? mapPostureFromBand(band.key);

  const confidence = clamp01(
    asNumber(scoreExplanation?.totals?.confidence_score)
    ?? asNumber(scoreExplanation?.totals?.evidence_factor)
    ?? 0.5,
  );

  const coverageRatio = clamp01(
    asNumber(scoreExplanation?.totals?.coverage_ratio)
    ?? (() => {
      const coverage = args.financial_coverage_v1?.coverage;
      if (!coverage || typeof coverage !== "object") return 0.5;
      const values = Object.values(coverage).filter((v) => typeof v === "boolean") as boolean[];
      if (values.length === 0) return 0.5;
      return values.filter(Boolean).length / values.length;
    })(),
  );

  const contradictions = buildContradictions(scoreExplanation);
  const contradictionIndex = clamp01(contradictions.length / 6);

  const missingInputs = Array.isArray(scoreExplanation?.totals?.unadjusted_missing_inputs)
    ? uniqueStrings(scoreExplanation.totals.unadjusted_missing_inputs.map((x: any) => String(x)))
    : [];

  const diligenceOpenItems = Array.isArray(scoreExplanation?.understanding_v1?.diligence_open_items)
    ? scoreExplanation.understanding_v1.diligence_open_items
    : [];

  const unknowns = missingInputs.map((code) => ({
    code,
    text: `Signal currently unknown: ${code}.`,
    evidence_refs: [],
  }));

  const requiredNextChecks = diligenceOpenItems
    .map((item: any) => ({
      text: asString(item?.text),
      expected_direction: "clarify" as const,
      evidence_refs: Array.isArray(item?.evidence_ids) ? uniqueStrings(item.evidence_ids.map((x: any) => String(x))) : [],
    }))
    .filter((x: any) => Boolean(x.text))
    .slice(0, 5);

  const { positive, negative } = buildContributors(scoreExplanation);

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

  const tractionComponent = scoreExplanation?.components?.metric_benchmark;
  const marketComponent = scoreExplanation?.components?.slide_sequence;
  const productComponent = scoreExplanation?.components?.narrative_arc;
  const riskComponent = scoreExplanation?.components?.risk_assessment;

  const capitalLogic = args.capital_logic_v1;
  const teamSignal = args.team_signal_v1;

  const familyInputs: ConvictionInputsV1 = {
    financial_truth: mkFamily(
      "financial_truth",
      hasFinancialTruth ? "confirmed" : hasForecastOnly ? "probable" : "unknown",
      topCoverageSource,
      sourcePriorityFromKind(topCoverageSource),
      coverageEvidenceRefs,
      Array.isArray(coverageProfile?.notes) ? coverageProfile.notes.map((x: any) => String(x)) : [],
    ),
    capital_structure: mkFamily(
      "capital_structure",
      capitalLogic?.raise?.present && capitalLogic?.use_of_funds?.present
        ? "confirmed"
        : capitalLogic?.raise?.present
          ? "probable"
          : "unknown",
      "capital_logic_v1",
      2,
      Array.isArray(capitalLogic?.raise?.sources) ? capitalLogic.raise.sources.map(normalizeEvidenceRef).filter(Boolean) as string[] : [],
      Array.isArray(capitalLogic?.notes) ? capitalLogic.notes.map((x: any) => String(x)) : [],
    ),
    traction_validation: mkFamily(
      "traction_validation",
      asString(tractionComponent?.status) === "ok"
        ? "confirmed"
        : asNumber(tractionComponent?.used_score) != null
          ? "probable"
          : "unknown",
      "score_explanation.components.metric_benchmark",
      3,
      Array.isArray(tractionComponent?.evidence_ids) ? tractionComponent.evidence_ids.map((x: any) => String(x)) : [],
      Array.isArray(tractionComponent?.gaps) ? tractionComponent.gaps.map((x: any) => String(x)) : [],
    ),
    market_demand: mkFamily(
      "market_demand",
      asString(marketComponent?.status) === "ok" ? "confirmed" : "unknown",
      "score_explanation.components.slide_sequence",
      3,
      Array.isArray(marketComponent?.evidence_ids) ? marketComponent.evidence_ids.map((x: any) => String(x)) : [],
      Array.isArray(marketComponent?.gaps) ? marketComponent.gaps.map((x: any) => String(x)) : [],
    ),
    product_or_asset_quality: mkFamily(
      "product_or_asset_quality",
      asString(productComponent?.status) === "ok" ? "confirmed" : "unknown",
      "score_explanation.components.narrative_arc",
      3,
      Array.isArray(productComponent?.evidence_ids) ? productComponent.evidence_ids.map((x: any) => String(x)) : [],
      Array.isArray(productComponent?.gaps) ? productComponent.gaps.map((x: any) => String(x)) : [],
    ),
    team_execution: mkFamily(
      "team_execution",
      typeof teamSignal?.founder_count === "number"
        ? (teamSignal.founder_count > 0 ? "probable" : "unknown")
        : "unknown",
      "team_signal_v1",
      3,
      [],
      Array.isArray(teamSignal?.signals)
        ? teamSignal.signals.filter((s: any) => s?.present).map((s: any) => String(s?.code ?? "")).filter(Boolean)
        : [],
    ),
    risk_dependencies: mkFamily(
      "risk_dependencies",
      Array.isArray(riskComponent?.red_flags) && riskComponent.red_flags.length > 0 ? "contradicted" : "probable",
      "score_explanation.components.risk_assessment",
      3,
      Array.isArray(riskComponent?.evidence_ids) ? riskComponent.evidence_ids.map((x: any) => String(x)) : [],
      Array.isArray(riskComponent?.red_flags) ? riskComponent.red_flags.map((x: any) => String(x)) : [],
    ),
    external_corroboration: mkFamily(
      "external_corroboration",
      "unknown",
      "not_available_phase1",
      5,
      [],
      ["reserved_for_phase2"],
    ),
    evidence_quality: mkFamily(
      "evidence_quality",
      confidence >= 0.7 ? "confirmed" : confidence >= 0.5 ? "probable" : "unknown",
      "score_explanation.totals",
      3,
      [],
      [
        `confidence_score=${confidence.toFixed(3)}`,
        `evidence_factor=${(asNumber(scoreExplanation?.totals?.evidence_factor) ?? 0).toFixed(3)}`,
      ],
    ),
    coverage: mkFamily(
      "coverage",
      coverageRatio >= 0.75 ? "confirmed" : coverageRatio >= 0.5 ? "probable" : "unknown",
      "score_explanation.totals",
      3,
      coverageEvidenceRefs,
      [`coverage_ratio=${coverageRatio.toFixed(3)}`],
    ),
    contradictions: mkFamily(
      "contradictions",
      contradictions.length > 0 ? "contradicted" : "probable",
      "conviction_v1.contradictions",
      3,
      contradictions.flatMap((c) => c.evidence_refs),
      contradictions.map((c) => c.code),
    ),
  };

  const summaryHeadline = `Conviction ${convictionScore}/100 (${band.label})`;
  const summaryRationale = positive.length > 0
    ? `Primary support comes from ${positive.map((p) => p.label).slice(0, 2).join(" and ")}.`
    : "Conviction is currently limited by sparse deterministic evidence.";

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
      provisional: true,
      notes: [
        "phase1_transitional_mapping",
        "temporary_score_derived_from_existing_deterministic_artifacts",
      ],
    },
    top_positive_contributors: positive,
    top_negative_contributors: negative,
    unknowns,
    contradictions,
    required_next_checks: requiredNextChecks,
    lineage: {
      generated_at: new Date().toISOString(),
      mapping_version: "phase1_transitional_v1",
      source_artifacts: [
        {
          artifact: "score_explanation",
          path: "metadata.score_explanation",
          used: Boolean(scoreExplanation),
          note: "primary transitional source for score/confidence/coverage",
        },
        {
          artifact: "financial_coverage_v1",
          path: "report.financial_coverage_v1",
          used: Boolean(args.financial_coverage_v1),
        },
        {
          artifact: "capital_logic_v1",
          path: "report.capital_logic_v1",
          used: Boolean(args.capital_logic_v1),
        },
        {
          artifact: "team_signal_v1",
          path: "report.team_signal_v1",
          used: Boolean(args.team_signal_v1),
        },
        {
          artifact: "recommendation",
          path: "report.recommendation",
          used: Boolean(args.recommendation),
        },
        {
          artifact: "overall_score",
          path: "report.overallScore",
          used: asNumber(args.overall_score) != null,
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
