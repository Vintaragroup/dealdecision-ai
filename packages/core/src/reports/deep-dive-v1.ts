import type {
  DealDeepDiveV1,
  DeepDiveBusinessModelSectionV1,
  DeepDiveDiscoverySectionV1,
  DeepDiveFinancialsSectionV1,
  DeepDiveGapSectionV1,
  DeepDiveImplementationActionV1,
  DeepDiveImplementationSectionV1,
  DeepDiveMarketSectionV1,
  DeepDiveOpenQuestionsSectionV1,
  DeepDiveProductSectionV1,
  DeepDiveRedFlagsSectionV1,
  DeepDiveRisksSectionV1,
  DeepDiveTeamSectionV1,
  DeepDiveTractionSectionV1,
} from "../models/deep-dive-v1.js";
import type { DeepDiveClassificationEnrichmentV1 } from "../models/deep-dive-classification-v1.js";
import { DealDeepDiveV1Schema } from "./deep-dive-v1.schema.js";
import { deriveDeepDiveClassificationEnrichmentV1 } from "./deep-dive-classification-context-v1.js";
import {
  detectDeepDiveContradictionsV1,
  evidenceStrengthFromSignals,
  prioritizeDeepDiveQuestionsV1,
  toUniqueStrings,
} from "./deep-dive-reasoning-v1.js";

type BuildDealDeepDiveV1Args = {
  deal_id: string;
  analysis_version?: number | null;
  dio?: any;
  report?: any;
  orchestrator_report?: any;
};

type DeepDiveNormalizedInputsV1 = {
  report: any;
  orchestrator_report: any;
  classification: DeepDiveClassificationEnrichmentV1;
  facts: {
    raise_present: boolean;
    business_model: string | null;
    revenue_amount_present: boolean;
    customers_present: boolean;
    growth_present: boolean;
    underwriting_gaps: string[];
    diligence_open_items: string[];
    verification_requests: string[];
    executive_open_questions: string[];
  };
  signals: {
    market_evidence_refs: string[];
    product_evidence_refs: string[];
    financial_evidence_refs: string[];
    risk_evidence_refs: string[];
    market_kpi_count: number;
    product_differentiation_count: number;
    financial_benchmark_count: number;
  };
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
};

const humanizeFieldKey = (value: string): string => {
  const key = value.trim().toLowerCase();
  if (key === "raise") return "fundraising terms";
  if (key === "business_model") return "business model clarity";
  if (key === "revenue") return "revenue visibility";
  if (key === "customers") return "customer evidence";
  if (key === "growth") return "growth evidence";
  return key.replace(/_/g, " ");
};

const implicationForMissingField = (value: string): string => {
  const key = value.trim().toLowerCase();
  if (key === "revenue") return "Without verified revenue, scale and commercial maturity are difficult to assess.";
  if (key === "growth") return "Without growth evidence, momentum and trajectory remain uncertain.";
  if (key === "customers") return "Without customer evidence, demand durability is difficult to validate.";
  if (key === "raise") return "Without clear raise terms, dilution and financing risk cannot be evaluated reliably.";
  if (key === "business_model") return "Without business model clarity, unit economics and scalability remain unclear.";
  return "This limits confidence in the current underwriting view.";
};

const summarizeEvidenceStrength = (count: number): string => {
  if (count >= 3) return "Evidence coverage is relatively strong across multiple source anchors.";
  if (count >= 1) return "Evidence exists, but corroboration depth is still limited.";
  return "Evidence support is limited and key claims should be treated as provisional.";
};

const hasFiniteNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

const toEvidenceRefs = (values: unknown[]): string[] => toUniqueStrings(values).slice(0, 16);

const readDiligenceOpenItems = (report: any): string[] => {
  const items = report?.metadata?.score_explanation?.understanding_v1?.diligence_open_items;
  if (!Array.isArray(items)) return [];
  return toUniqueStrings(items.map((item: any) => item?.text)).slice(0, 12);
};

const readVerificationRequests = (orchestratorReport: any): string[] => {
  const items = orchestratorReport?.segments?.risk_verification?.verification_requests;
  if (!Array.isArray(items)) return [];
  return toUniqueStrings(items.map((item: any) => item?.request)).slice(0, 12);
};

const readExecutiveOpenQuestions = (orchestratorReport: any): string[] => {
  const questions = orchestratorReport?.segments?.executive_summary?.open_questions;
  if (!Array.isArray(questions)) return [];
  return toUniqueStrings(questions).slice(0, 12);
};

const readUnderwritingGaps = (report: any): string[] => {
  const gaps = report?.underwriting_readiness_v1?.gaps;
  if (!Array.isArray(gaps)) return [];
  return toUniqueStrings(gaps).slice(0, 20);
};

const readMarketEvidenceRefs = (orchestratorReport: any): string[] => {
  return toEvidenceRefs([
    ...(Array.isArray(orchestratorReport?.segments?.market?.evidence_refs) ? orchestratorReport.segments.market.evidence_refs : []),
    ...(Array.isArray(orchestratorReport?.segments?.market?.kpis)
      ? orchestratorReport.segments.market.kpis.flatMap((kpi: any) => kpi?.evidence_refs ?? [])
      : []),
  ]);
};

const readProductEvidenceRefs = (orchestratorReport: any): string[] => {
  const sources = orchestratorReport?.segments?.product_profile_v1?.sources;
  return toEvidenceRefs(Array.isArray(sources) ? sources : []);
};

const readFinancialEvidenceRefs = (orchestratorReport: any): string[] => {
  return toEvidenceRefs([
    ...(Array.isArray(orchestratorReport?.segments?.financial?.benchmarks)
      ? orchestratorReport.segments.financial.benchmarks.flatMap((benchmark: any) => benchmark?.evidence_refs ?? [])
      : []),
    ...(Array.isArray(orchestratorReport?.segments?.financial?.reconciliation?.flags)
      ? orchestratorReport.segments.financial.reconciliation.flags.flatMap((flag: any) => flag?.evidence_refs ?? [])
      : []),
  ]);
};

const readRiskEvidenceRefs = (orchestratorReport: any): string[] => {
  const topRisks = Array.isArray(orchestratorReport?.segments?.risk_verification?.top_risks)
    ? orchestratorReport.segments.risk_verification.top_risks
    : [];
  const verificationRequests = Array.isArray(orchestratorReport?.segments?.risk_verification?.verification_requests)
    ? orchestratorReport.segments.risk_verification.verification_requests
    : [];
  return toEvidenceRefs([
    ...topRisks.flatMap((risk: any) => risk?.evidence_refs ?? []),
    ...verificationRequests.flatMap((item: any) => item?.evidence_refs ?? []),
  ]);
};

const computeMissingCriticalFacts = (report: any): string[] => {
  const structured = report?.structured_summary;
  const checks: Array<{ key: string; present: boolean }> = [
    { key: "raise", present: Boolean(asNonEmptyString(structured?.raise?.value)) },
    { key: "business_model", present: Boolean(asNonEmptyString(structured?.business_model?.value)) },
    { key: "revenue", present: hasFiniteNumber(structured?.revenue?.value?.amount) },
    { key: "customers", present: hasFiniteNumber(structured?.customers?.value?.count) },
    { key: "growth", present: hasFiniteNumber(structured?.growth?.value?.percent) },
  ];
  return checks.filter((item) => !item.present).map((item) => item.key);
};

const buildNormalizedDeepDiveInputsV1 = (args: {
  dio?: any;
  report?: any;
  orchestrator_report?: any;
}): DeepDiveNormalizedInputsV1 => {
  const report = args.report && typeof args.report === "object" ? args.report : null;
  const orchestrator = args.orchestrator_report && typeof args.orchestrator_report === "object" ? args.orchestrator_report : null;
  const marketKpis = Array.isArray(orchestrator?.segments?.market?.kpis) ? orchestrator.segments.market.kpis : [];
  const productDiff = Array.isArray(orchestrator?.segments?.product_profile_v1?.differentiation_claims)
    ? orchestrator.segments.product_profile_v1.differentiation_claims
    : [];
  const financialBenchmarks = Array.isArray(orchestrator?.segments?.financial?.benchmarks)
    ? orchestrator.segments.financial.benchmarks
    : [];
  const riskEvidenceRefs = readRiskEvidenceRefs(orchestrator);
  const classification = deriveDeepDiveClassificationEnrichmentV1({
    dio: args.dio,
    report,
    orchestrator_report: orchestrator,
  });

  return {
    report,
    orchestrator_report: orchestrator,
    classification,
    facts: {
      raise_present: Boolean(asNonEmptyString(report?.structured_summary?.raise?.value)),
      business_model: asNonEmptyString(report?.structured_summary?.business_model?.value),
      revenue_amount_present: hasFiniteNumber(report?.structured_summary?.revenue?.value?.amount),
      customers_present: hasFiniteNumber(report?.structured_summary?.customers?.value?.count),
      growth_present: hasFiniteNumber(report?.structured_summary?.growth?.value?.percent),
      underwriting_gaps: readUnderwritingGaps(report),
      diligence_open_items: readDiligenceOpenItems(report),
      verification_requests: readVerificationRequests(orchestrator),
      executive_open_questions: readExecutiveOpenQuestions(orchestrator),
    },
    signals: {
      market_evidence_refs: readMarketEvidenceRefs(orchestrator),
      product_evidence_refs: readProductEvidenceRefs(orchestrator),
      financial_evidence_refs: readFinancialEvidenceRefs(orchestrator),
      risk_evidence_refs: riskEvidenceRefs,
      market_kpi_count: marketKpis.length,
      product_differentiation_count: productDiff.length,
      financial_benchmark_count: financialBenchmarks.length,
    },
  };
};

export function generateDeepDiveDiscoverySectionV1(args: {
  dio?: any;
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveDiscoverySectionV1 {
  const report = args.normalized.report;
  const facts = args.normalized.facts;

  return {
    section: "discovery",
    sources: {
      dio_present: Boolean(args.dio && typeof args.dio === "object"),
      report_present: Boolean(report),
      investor_orchestrator_present: Boolean(args.normalized.orchestrator_report),
      financial_breakdown_present: Boolean(report?.financial_breakdown_v1),
      underwriting_readiness_present: Boolean(report?.underwriting_readiness_v1),
    },
    key_facts: {
      raise_present: facts.raise_present,
      business_model_present: Boolean(facts.business_model),
      revenue_present: facts.revenue_amount_present,
      customers_present: facts.customers_present,
      growth_present: facts.growth_present,
    },
    diligence_open_items_count: facts.diligence_open_items.length,
    verification_requests_count: facts.verification_requests.length,
  };
}

export function generateDeepDiveGapSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveGapSectionV1 {
  const report = args.normalized.report;
  const facts = args.normalized.facts;
  return {
    section: "gap",
    missing_critical_facts: computeMissingCriticalFacts(report),
    underwriting_gaps: facts.underwriting_gaps,
    diligence_open_items: facts.diligence_open_items,
    verification_requests: facts.verification_requests,
  };
}

export function generateDeepDiveMarketSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveMarketSectionV1 {
  const market = args.normalized.orchestrator_report?.segments?.market;
  const classification = args.normalized.classification;
  const evidenceRefs = args.normalized.signals.market_evidence_refs;
  const hasTamSignal = Array.isArray(market?.kpis) && market.kpis.some((kpi: any) => /tam|sam|som/i.test(String(kpi?.label ?? "")));
  const hasTimingSignal = Array.isArray(market?.missing_inputs)
    ? market.missing_inputs.every((input: any) => !/timing|window|go-to-market-timing/i.test(String(input ?? "")))
    : false;

  return {
    section: "market",
    tam_reasoning: {
      status: hasTamSignal ? "supported" : (market ? "partial" : "missing"),
      notes: toUniqueStrings([
        hasTamSignal
          ? "The market view includes explicit TAM/SAM/SOM-style signals, which supports a directional sizing case. This improves confidence in the opportunity framing, though assumptions still require periodic validation as the market evolves."
          : market
            ? "The materials do not provide a clearly supported TAM estimate. Without quantified market sizing, it is harder to test whether growth assumptions are realistic at the proposed scale."
            : "Market sizing evidence is limited in the current materials. As a result, upside potential and addressable demand should be treated as provisional until stronger support is provided.",
        summarizeEvidenceStrength(evidenceRefs.length),
        classification.classificationConfidence !== "unknown"
          ? `Best-fit industry category context points to ${classification.bestFitLabel ?? "a likely adjacent category"}; use this as directional validation rather than a replacement for product-native understanding.`
          : "Industry taxonomy support is currently low-confidence and should not drive market conclusions on its own.",
        asNonEmptyString(market?.narrative) ?? "",
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasTamSignal ? 2 : (market ? 1 : 0) }),
    },
    timing_logic: {
      status: market ? (hasTimingSignal ? "supported" : "partial") : "missing",
      notes: toUniqueStrings([
        hasTimingSignal
          ? "Market timing assumptions are generally coherent in the current evidence set. This supports a near-term execution case, provided demand and competitive dynamics remain stable."
          : "Market timing assumptions are only partially specified. This creates uncertainty around how quickly the company can convert market opportunity into reliable execution outcomes.",
        ...(Array.isArray(classification.industryExpectations)
          ? classification.industryExpectations.slice(0, 2).map((item) => `Industry expectation to validate: ${item}`)
          : []),
        ...((Array.isArray(market?.missing_inputs) ? market.missing_inputs : []).map((x: any) => `Timing dependency: ${String(x)}`)),
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasTimingSignal ? 2 : (market ? 1 : 0) }),
    },
  };
}

export function generateDeepDiveProductSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveProductSectionV1 {
  const profile = args.normalized.orchestrator_report?.segments?.product_profile_v1;
  const evidenceRefs = args.normalized.signals.product_evidence_refs;
  const hasDifferentiation = Array.isArray(profile?.differentiation_claims) && profile.differentiation_claims.length > 0;
  const hasDefensibility = Boolean(asNonEmptyString(profile?.ai_defensibility_notes)) || (Array.isArray(profile?.integrations_or_dependencies) && profile.integrations_or_dependencies.length > 1);

  return {
    section: "product",
    differentiation_detection: {
      status: hasDifferentiation ? "clear" : (profile ? "mixed" : "unclear"),
      notes: toUniqueStrings([
        hasDifferentiation
          ? "The company presents specific differentiation claims, which indicates a potentially defensible position in the near term. The key diligence question is whether these claims are durable as competitors respond."
          : profile
            ? "Differentiation is not yet clearly supported in the available materials. Without clearer separation from alternatives, pricing power and win-rate durability are harder to underwrite."
            : "Product differentiation evidence is limited, so competitive advantage should be treated as unproven at this stage.",
        ...(Array.isArray(profile?.differentiation_claims) ? profile.differentiation_claims.map((claim: string) => `Claim surfaced: ${claim}`) : []),
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasDifferentiation ? 2 : (profile ? 1 : 0) }),
    },
    defensibility_logic: {
      status: hasDefensibility ? "clear" : (profile ? "partial" : "unclear"),
      notes: toUniqueStrings([
        hasDefensibility
          ? "There are signs of potential defensibility (for example data, integrations, or workflow depth), which can support retention and switching-cost dynamics. Durability still depends on continued execution and product velocity."
          : "Long-term defensibility is only partially evidenced. This increases the risk that early product advantages compress as the category matures.",
        asNonEmptyString(profile?.ai_defensibility_notes) ?? "Defensibility detail is limited in the current evidence set.",
        profile?.ai_claims_present === true ? "AI positioning is present in claims and should be validated against repeatable customer outcomes." : "AI-related differentiation is not yet strongly supported by corroborating evidence.",
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasDefensibility ? 2 : (profile ? 1 : 0) }),
    },
  };
}

export function generateDeepDiveBusinessModelSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveBusinessModelSectionV1 {
  const model = args.normalized.facts.business_model;
  const classification = args.normalized.classification;
  const market = args.normalized.orchestrator_report?.segments?.market;
  const evidenceRefs = toEvidenceRefs([
    ...args.normalized.signals.market_evidence_refs,
    ...(Array.isArray(args.normalized.report?.structured_summary?.business_model?.sources)
      ? args.normalized.report.structured_summary.business_model.sources.map((source: any) => source?.evidence_id)
      : []),
  ]);

  const hasScaleSignals = Array.isArray(market?.strengths) && market.strengths.length > 0;

  return {
    section: "business_model",
    revenue_model_inference: {
      inferred_model: classification.inferredLabel ?? model,
      status: classification.classificationConfidence === "unknown" ? (model ? "partial" : "missing") : "supported",
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({
        evidence_refs: evidenceRefs,
        supporting_signals: classification.classificationConfidence === "strong" ? 3 : (classification.classificationConfidence === "moderate" ? 2 : (model ? 1 : 0)),
      }),
    },
    scaling_logic: {
      status: hasScaleSignals
        ? "supported"
        : (classification.classificationConfidence === "unknown" ? (model ? "partial" : "missing") : "partial"),
      notes: toUniqueStrings([
        hasScaleSignals
          ? "The materials include signals that support a plausible route to scale, which strengthens the business model narrative. Execution quality remains the key determinant of whether this scaling pathway is realized."
          : model
            ? "A business model is present, but evidence for how it scales is still limited. This leaves uncertainty around operating leverage and repeatability beyond early growth."
            : "Business model scaling logic is not yet sufficiently evidenced, limiting confidence in long-term economics.",
        classification.classificationConfidence === "unknown"
          ? "Business classification confidence remains low; avoid overcommitting to one operating archetype until stronger evidence appears."
          : `Appears to operate primarily as ${classification.inferredLabel}. Best-fit industry category context: ${classification.bestFitLabel ?? "not clearly resolved"}.`,
        classification.isHybrid
          ? "Hybrid business signals are present; underwriting should evaluate multiple revenue and risk pathways rather than a single-model assumption."
          : "Classification signal is relatively coherent across available business descriptors.",
        classification.classificationConflict
          ? `Classification conflict: ${classification.conflictReason ?? "taxonomy context and product-native signals disagree."}`
          : "No material classification conflict detected between native business description and taxonomy context.",
        ...(Array.isArray(market?.strengths) ? market.strengths.map((s: string) => `Scale signal: ${s}`) : []),
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasScaleSignals ? 2 : (model ? 1 : 0) }),
    },
  };
}

export function generateDeepDiveTractionSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveTractionSectionV1 {
  const hasGrowth = args.normalized.facts.growth_present;
  const hasCustomers = args.normalized.facts.customers_present;
  const marketKpis = Array.isArray(args.normalized.orchestrator_report?.segments?.market?.kpis)
    ? args.normalized.orchestrator_report.segments.market.kpis
    : [];
  const tractionEvidenceRefs = toEvidenceRefs(marketKpis.flatMap((kpi: any) => kpi?.evidence_refs ?? []));

  const proofCount = [hasGrowth, hasCustomers, marketKpis.length > 0].filter(Boolean).length;
  const promiseCount = args.normalized.facts.diligence_open_items.length + args.normalized.facts.verification_requests.length;
  const proofVsPromise = proofCount >= 3 ? "proof_heavy" : (proofCount >= 1 && promiseCount > 0 ? "mixed" : "promise_heavy");

  return {
    section: "traction",
    growth_validation: {
      status: hasGrowth && hasCustomers ? "validated" : (hasGrowth || hasCustomers ? "partial" : "unvalidated"),
      notes: toUniqueStrings([
        hasGrowth && hasCustomers
          ? "Both growth and customer signals are present, providing a stronger basis for early traction interpretation. This supports a more confident view of commercial momentum than narrative-only claims."
          : hasGrowth || hasCustomers
            ? "Only partial traction evidence is available. This supports directional progress but is not yet sufficient for a high-confidence momentum view."
            : "Traction evidence is limited in the current dataset. Commercial momentum should be treated as unproven until stronger metrics are provided.",
        hasGrowth ? "Growth evidence is present in structured materials." : "Growth evidence is currently missing from structured materials.",
        hasCustomers ? "Customer evidence is present in structured materials." : "Customer evidence is currently missing from structured materials.",
      ]),
      evidence_refs: tractionEvidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: tractionEvidenceRefs, supporting_signals: proofCount }),
    },
    proof_vs_promise_detection: {
      status: proofVsPromise,
      notes: toUniqueStrings([
        proofVsPromise === "proof_heavy"
          ? "Available evidence is weighted toward demonstrated proof points, which improves confidence in near-term execution claims."
          : proofVsPromise === "mixed"
            ? "The evidence set includes both proof points and unresolved assumptions, indicating moderate confidence with clear diligence dependencies."
            : "The current story is more promise-heavy than proof-heavy, so key claims require stronger corroboration before conviction should increase.",
        `Proof points identified: ${proofCount}.`,
        `Open assumptions requiring verification: ${promiseCount}.`,
      ]),
      evidence_refs: tractionEvidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: tractionEvidenceRefs, supporting_signals: proofCount }),
    },
  };
}

export function generateDeepDiveFinancialsSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveFinancialsSectionV1 {
  const breakdown = args.normalized.report?.financial_breakdown_v1;
  const classification = args.normalized.classification;
  const evidenceRefs = args.normalized.signals.financial_evidence_refs;
  const supportCount = [
    Boolean(breakdown),
    Array.isArray(breakdown?.projections?.periods) && breakdown.projections.periods.length > 0,
    args.normalized.facts.revenue_amount_present,
  ].filter(Boolean).length;
  const currentSignals = toUniqueStrings([
    supportCount >= 3
      ? "Current-state financial signals are sufficiently populated to support a grounded operating read."
      : supportCount >= 1
        ? "Current-state financial signals are partially available, so interpretation should be treated as directional."
        : "Current-state financial visibility is limited, constraining underwriting confidence.",
    ...(Array.isArray(breakdown?.current_state?.summary) ? breakdown.current_state.summary : [breakdown?.current_state?.summary]),
    args.normalized.facts.revenue_amount_present ? "Revenue data is present in structured sources." : "Revenue data is missing from structured sources.",
    ...(Array.isArray(classification.industryExpectations)
      ? classification.industryExpectations.slice(0, 2).map((item) => `Category expectation: ${item}`)
      : []),
  ]);
  const forwardSignals = toUniqueStrings([
    ...(Array.isArray(breakdown?.projections?.periods) && breakdown.projections.periods.length > 0
      ? ["Forward projections are present, enabling a directional view of future operating trajectory."]
      : ["Forward projections are limited or missing, reducing confidence in long-range planning assumptions."]),
    asNonEmptyString(breakdown?.projections?.path_to_profitability_label) ?? "",
    classification.classificationConflict
      ? `Financial interpretation should be stress-tested across classification scenarios: ${classification.conflictReason ?? "native signals conflict with taxonomy context."}`
      : "Financial interpretation can use taxonomy context as a directional benchmark, while keeping product-native facts primary.",
  ]);

  return {
    section: "financials",
    interpretation_layer: {
      status: supportCount >= 3 ? "supported" : (supportCount >= 1 ? "partial" : "missing"),
      current_state_signals: currentSignals,
      forward_view_signals: forwardSignals,
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: supportCount }),
    },
  };
}

export function generateDeepDiveTeamSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveTeamSectionV1 {
  const executiveStrengths = Array.isArray(args.normalized.orchestrator_report?.segments?.executive_summary?.strengths)
    ? args.normalized.orchestrator_report.segments.executive_summary.strengths
    : [];
  const riskItems = Array.isArray(args.normalized.orchestrator_report?.segments?.risk_verification?.top_risks)
    ? args.normalized.orchestrator_report.segments.risk_verification.top_risks
    : [];
  const teamRisks = riskItems
    .filter((risk: any) => /team|founder|hiring|execution/i.test(String(risk?.risk ?? "")))
    .map((risk: any) => String(risk?.risk));

  const capabilities = toUniqueStrings([
    ...executiveStrengths.filter((item: any) => /team|operator|founder|execution|hiring/i.test(String(item))),
  ]);

  const evidenceRefs = toEvidenceRefs(riskItems.flatMap((item: any) => item?.evidence_refs ?? []));
  const supportCount = capabilities.length > 0 ? 2 : (teamRisks.length > 0 ? 1 : 0);

  return {
    section: "team",
    capability_inference: {
      status: capabilities.length > 0 ? "supported" : (teamRisks.length > 0 ? "partial" : "missing"),
      inferred_capabilities: capabilities.length > 0
        ? [
            "The team profile includes evidence of execution capability in core operating areas.",
            ...capabilities,
          ]
        : teamRisks.length > 0
          ? [
              "Team-related execution risk is present and should be monitored during diligence.",
              ...teamRisks,
            ]
          : ["Team capability evidence is limited in the current materials."],
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: supportCount }),
    },
  };
}

export function generateDeepDiveRisksSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
}): DeepDiveRisksSectionV1 {
  const topRisks = Array.isArray(args.normalized.orchestrator_report?.segments?.risk_verification?.top_risks)
    ? args.normalized.orchestrator_report.segments.risk_verification.top_risks
    : [];
  const classification = args.normalized.classification;

  const mapCategory = (value: string): "market" | "product" | "execution" | "financial" | "team" | "other" => {
    const v = value.toLowerCase();
    if (/market|competition|demand/.test(v)) return "market";
    if (/product|technology|platform/.test(v)) return "product";
    if (/team|founder|hiring|talent/.test(v)) return "team";
    if (/finance|runway|burn|cash|revenue|valuation/.test(v)) return "financial";
    if (/execution|go-to-market|gtm|ops|operational/.test(v)) return "execution";
    return "other";
  };

  const mapSeverity = (value: string): "critical" | "high" | "medium" | "low" => {
    const v = value.toLowerCase();
    if (v === "critical") return "critical";
    if (v === "high") return "high";
    if (v === "medium") return "medium";
    return "low";
  };

  const items = topRisks.slice(0, 12).map((risk: any) => ({
    category: mapCategory(String(risk?.risk ?? "")),
    severity: mapSeverity(String(risk?.severity ?? "low")),
    risk: asNonEmptyString(risk?.risk) ?? "Unspecified risk",
    evidence_refs: toEvidenceRefs(Array.isArray(risk?.evidence_refs) ? risk.evidence_refs : []),
  }));

  if (classification.classificationConflict) {
    items.unshift({
      category: "execution",
      severity: "high",
      risk: `Classification conflict: ${classification.conflictReason ?? "operating-category inference is inconsistent across evidence sources."}`,
      evidence_refs: toEvidenceRefs([
        ...args.normalized.signals.market_evidence_refs,
        ...args.normalized.signals.product_evidence_refs,
      ]).slice(0, 4),
    });
  }

  return {
    section: "risks",
    classification: items,
  };
}

export function generateDeepDiveRedFlagsSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
  gap: DeepDiveGapSectionV1;
}): DeepDiveRedFlagsSectionV1 {
  const fallbackEvidence = toEvidenceRefs([
    ...args.normalized.signals.risk_evidence_refs,
    ...args.normalized.signals.financial_evidence_refs,
  ]);

  const items = detectDeepDiveContradictionsV1({
    report: args.normalized.report,
    orchestrator_report: args.normalized.orchestrator_report,
    missing_critical_facts: args.gap.missing_critical_facts,
    classification_enrichment: args.normalized.classification,
  })
    .slice(0, 16)
    .map((item) => ({
      ...item,
      evidence_refs: item.evidence_refs.length > 0 ? item.evidence_refs : fallbackEvidence.slice(0, 3),
    }));

  return {
    section: "red_flags",
    items,
  };
}

const attachEvidenceToOpenQuestion = (question: string, normalized: DeepDiveNormalizedInputsV1): string[] => {
  const q = question.toLowerCase();
  if (/runway|burn|revenue|margin|cash|arr|mrr|unit economics|valuation|cap table/.test(q)) {
    return normalized.signals.financial_evidence_refs.slice(0, 4);
  }
  if (/market|tam|sam|som|timing|competition|demand/.test(q)) {
    return normalized.signals.market_evidence_refs.slice(0, 4);
  }
  if (/product|defensibility|moat|feature|integration|ai|workflow/.test(q)) {
    return normalized.signals.product_evidence_refs.slice(0, 4);
  }
  if (/risk|verify|concentration|churn|retention|execution|team/.test(q)) {
    return normalized.signals.risk_evidence_refs.slice(0, 4);
  }

  return toEvidenceRefs([
    ...normalized.signals.risk_evidence_refs,
    ...normalized.signals.financial_evidence_refs,
    ...normalized.signals.market_evidence_refs,
    ...normalized.signals.product_evidence_refs,
  ]).slice(0, 4);
};

export function generateDeepDiveOpenQuestionsSectionV1(args: {
  normalized: DeepDiveNormalizedInputsV1;
  gap: DeepDiveGapSectionV1;
}): DeepDiveOpenQuestionsSectionV1 {
  const prioritized = prioritizeDeepDiveQuestionsV1({
    diligence_open_items: args.gap.diligence_open_items,
    verification_requests: args.gap.verification_requests,
    executive_open_questions: args.normalized.facts.executive_open_questions,
    missing_critical_facts: args.gap.missing_critical_facts,
  });

  return {
    section: "open_questions",
    prioritized: prioritized
      .slice(0, 18)
      .map((item) => ({
        ...item,
        evidence_refs: item.evidence_refs.length > 0
          ? item.evidence_refs
          : attachEvidenceToOpenQuestion(item.question, args.normalized),
      })),
  };
}

const mapGapsToActions = (args: {
  gap: DeepDiveGapSectionV1;
  red_flags: DeepDiveRedFlagsSectionV1;
  open_questions: DeepDiveOpenQuestionsSectionV1;
}): DeepDiveImplementationActionV1[] => {
  const actions: DeepDiveImplementationActionV1[] = [];

  for (const missingField of args.gap.missing_critical_facts.slice(0, 6)) {
    const label = humanizeFieldKey(missingField);
    actions.push({
      action_id: `critical_fact:${missingField}`,
      priority: "high",
      title: `Establish verified ${label}`,
      rationale: `${implicationForMissingField(missingField)} Confirm this input with primary-source evidence before drawing stronger conclusions.`,
      source: "structured_summary",
    });
  }

  for (const underwritingGap of args.gap.underwriting_gaps.slice(0, 6)) {
    actions.push({
      action_id: `underwriting_gap:${underwritingGap}`,
      priority: "high",
      title: `Resolve underwriting gap: ${underwritingGap}`,
      rationale: `Underwriting readiness indicates "${underwritingGap}" as a blocker. Resolve with auditable, source-backed documentation.`,
      source: "underwriting_readiness_v1",
    });
  }

  for (const redFlag of args.red_flags.items.slice(0, 4)) {
    actions.push({
      action_id: `red_flag:${redFlag.contradiction_type}:${redFlag.flag.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      priority: "medium",
      title: "Resolve evidence contradiction",
      rationale: `${redFlag.flag} This inconsistency should be reconciled before increasing conviction.`,
      source: "orchestrator_report_v1",
    });
  }

  for (const question of args.open_questions.prioritized.slice(0, 4)) {
    actions.push({
      action_id: `question:${question.priority}:${question.question.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      priority: question.priority === "p0" ? "high" : (question.priority === "p1" ? "medium" : "low"),
      title: "Close prioritized diligence question",
      rationale: `${question.question} ${question.reason}`,
      source: "score_explanation",
    });
  }

  return actions;
};

export function generateDeepDiveImplementationSectionV1(args: {
  gap: DeepDiveGapSectionV1;
  red_flags: DeepDiveRedFlagsSectionV1;
  open_questions: DeepDiveOpenQuestionsSectionV1;
}): DeepDiveImplementationSectionV1 {
  return {
    section: "implementation",
    actions: mapGapsToActions(args),
  };
}

export function buildDealDeepDiveV1(args: BuildDealDeepDiveV1Args): DealDeepDiveV1 {
  const normalized = buildNormalizedDeepDiveInputsV1({
    dio: args.dio,
    report: args.report,
    orchestrator_report: args.orchestrator_report,
  });

  const discovery = generateDeepDiveDiscoverySectionV1({
    dio: args.dio,
    normalized,
  });

  const gap = generateDeepDiveGapSectionV1({
    normalized,
  });

  const market = generateDeepDiveMarketSectionV1({
    normalized,
  });

  const product = generateDeepDiveProductSectionV1({
    normalized,
  });

  const businessModel = generateDeepDiveBusinessModelSectionV1({
    normalized,
  });

  const traction = generateDeepDiveTractionSectionV1({
    normalized,
  });

  const financials = generateDeepDiveFinancialsSectionV1({
    normalized,
  });

  const team = generateDeepDiveTeamSectionV1({
    normalized,
  });

  const risks = generateDeepDiveRisksSectionV1({
    normalized,
  });

  const redFlags = generateDeepDiveRedFlagsSectionV1({
    normalized,
    gap,
  });

  const openQuestions = generateDeepDiveOpenQuestionsSectionV1({
    normalized,
    gap,
  });

  const implementation = generateDeepDiveImplementationSectionV1({
    gap,
    red_flags: redFlags,
    open_questions: openQuestions,
  });

  const deepDive: DealDeepDiveV1 = {
    schema_version: "deal_deep_dive_v1",
    deal_id: args.deal_id,
    analysis_version: typeof args.analysis_version === "number" && Number.isFinite(args.analysis_version)
      ? args.analysis_version
      : null,
    generated_at: new Date().toISOString(),
    discovery,
    gap,
    market,
    product,
    business_model: businessModel,
    traction,
    financials,
    team,
    risks,
    red_flags: redFlags,
    open_questions: openQuestions,
    implementation,
  };

  return DealDeepDiveV1Schema.parse(deepDive);
}
