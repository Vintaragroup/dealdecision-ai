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
import { DealDeepDiveV1Schema } from "./deep-dive-v1.schema.js";
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

  return {
    report,
    orchestrator_report: orchestrator,
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
        hasTamSignal ? "TAM/SAM/SOM-like KPI evidence detected." : "No explicit TAM KPI evidence found.",
        asNonEmptyString(market?.narrative) ?? "",
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasTamSignal ? 2 : (market ? 1 : 0) }),
    },
    timing_logic: {
      status: market ? (hasTimingSignal ? "supported" : "partial") : "missing",
      notes: toUniqueStrings([
        hasTimingSignal ? "No market timing gaps reported in market missing_inputs." : "Market timing assumptions are partially specified.",
        ...((Array.isArray(market?.missing_inputs) ? market.missing_inputs : []).map((x: any) => String(x))),
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
        hasDifferentiation ? "Differentiation claims are present in product profile." : "Differentiation claims are sparse or absent.",
        ...(Array.isArray(profile?.differentiation_claims) ? profile.differentiation_claims : []),
      ]),
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: hasDifferentiation ? 2 : (profile ? 1 : 0) }),
    },
    defensibility_logic: {
      status: hasDefensibility ? "clear" : (profile ? "partial" : "unclear"),
      notes: toUniqueStrings([
        asNonEmptyString(profile?.ai_defensibility_notes) ?? "No explicit defensibility note present.",
        profile?.ai_claims_present === true ? "AI claims are present and included in product profile." : "AI defensibility evidence is limited.",
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
      inferred_model: model,
      status: model ? "supported" : "missing",
      evidence_refs: evidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: evidenceRefs, supporting_signals: model ? 2 : 0 }),
    },
    scaling_logic: {
      status: hasScaleSignals ? "supported" : (model ? "partial" : "missing"),
      notes: toUniqueStrings([
        ...(Array.isArray(market?.strengths) ? market.strengths : []),
        hasScaleSignals ? "Market strengths indicate scaling pathways." : "Scaling logic requires stronger route-to-scale evidence.",
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
        hasGrowth ? "Growth metric is present in structured summary." : "Growth metric is missing from structured summary.",
        hasCustomers ? "Customer metric is present in structured summary." : "Customer metric is missing from structured summary.",
      ]),
      evidence_refs: tractionEvidenceRefs,
      evidence_strength: evidenceStrengthFromSignals({ evidence_refs: tractionEvidenceRefs, supporting_signals: proofCount }),
    },
    proof_vs_promise_detection: {
      status: proofVsPromise,
      notes: toUniqueStrings([
        `proof_signals=${proofCount}`,
        `promise_signals=${promiseCount}`,
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
  const evidenceRefs = args.normalized.signals.financial_evidence_refs;
  const currentSignals = toUniqueStrings([
    ...(Array.isArray(breakdown?.current_state?.summary) ? breakdown.current_state.summary : [breakdown?.current_state?.summary]),
    args.normalized.facts.revenue_amount_present ? "Revenue value present." : "Revenue value missing.",
  ]);
  const forwardSignals = toUniqueStrings([
    ...(Array.isArray(breakdown?.projections?.periods) && breakdown.projections.periods.length > 0
      ? ["Projected periods available in financial breakdown."]
      : ["Projected periods are limited or missing."]),
    asNonEmptyString(breakdown?.projections?.path_to_profitability_label) ?? "",
  ]);

  const supportCount = [
    Boolean(breakdown),
    Array.isArray(breakdown?.projections?.periods) && breakdown.projections.periods.length > 0,
    args.normalized.facts.revenue_amount_present,
  ].filter(Boolean).length;

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
      inferred_capabilities: capabilities.length > 0 ? capabilities : teamRisks,
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

  return {
    section: "risks",
    classification: topRisks.slice(0, 12).map((risk: any) => ({
      category: mapCategory(String(risk?.risk ?? "")),
      severity: mapSeverity(String(risk?.severity ?? "low")),
      risk: asNonEmptyString(risk?.risk) ?? "Unspecified risk",
      evidence_refs: toEvidenceRefs(Array.isArray(risk?.evidence_refs) ? risk.evidence_refs : []),
    })),
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
    actions.push({
      action_id: `critical_fact:${missingField}`,
      priority: "high",
      title: `Backfill ${missingField} with evidence-backed data`,
      rationale: `Critical field ${missingField} is missing and blocks deterministic interpretation coverage.`,
      source: "structured_summary",
    });
  }

  for (const underwritingGap of args.gap.underwriting_gaps.slice(0, 6)) {
    actions.push({
      action_id: `underwriting_gap:${underwritingGap}`,
      priority: "high",
      title: `Resolve underwriting gap: ${underwritingGap}`,
      rationale: `underwriting_readiness_v1 indicates ${underwritingGap}; address with source-backed facts.`,
      source: "underwriting_readiness_v1",
    });
  }

  for (const redFlag of args.red_flags.items.slice(0, 4)) {
    actions.push({
      action_id: `red_flag:${redFlag.contradiction_type}:${redFlag.flag.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      priority: "medium",
      title: "Resolve contradiction before synthesis",
      rationale: redFlag.flag,
      source: "orchestrator_report_v1",
    });
  }

  for (const question of args.open_questions.prioritized.slice(0, 4)) {
    actions.push({
      action_id: `question:${question.priority}:${question.question.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      priority: question.priority === "p0" ? "high" : (question.priority === "p1" ? "medium" : "low"),
      title: "Answer prioritized open question",
      rationale: `${question.question} (${question.reason})`,
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
