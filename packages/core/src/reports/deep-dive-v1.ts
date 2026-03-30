import type {
  DealDeepDiveV1,
  DeepDiveDiscoverySectionV1,
  DeepDiveGapSectionV1,
  DeepDiveImplementationActionV1,
  DeepDiveImplementationSectionV1,
} from "../models/deep-dive-v1.js";

type BuildDealDeepDiveV1Args = {
  deal_id: string;
  analysis_version?: number | null;
  dio?: any;
  report?: any;
  orchestrator_report?: any;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
};

const toUniqueStrings = (values: unknown[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const readDiligenceOpenItems = (report: any): string[] => {
  const items = report?.metadata?.score_explanation?.understanding_v1?.diligence_open_items;
  if (!Array.isArray(items)) return [];
  const texts = items.map((item: any) => item?.text);
  return toUniqueStrings(texts).slice(0, 12);
};

const readVerificationRequests = (orchestratorReport: any): string[] => {
  const items = orchestratorReport?.segments?.risk_verification?.verification_requests;
  if (!Array.isArray(items)) return [];
  const requests = items.map((item: any) => item?.request);
  return toUniqueStrings(requests).slice(0, 12);
};

const readUnderwritingGaps = (report: any): string[] => {
  const gaps = report?.underwriting_readiness_v1?.gaps;
  if (!Array.isArray(gaps)) return [];
  return toUniqueStrings(gaps).slice(0, 20);
};

const computeMissingCriticalFacts = (report: any): string[] => {
  const structured = report?.structured_summary;
  const revenueAmount = structured?.revenue?.value?.amount;
  const customersCount = structured?.customers?.value?.count;
  const growthPercent = structured?.growth?.value?.percent;

  const checks: Array<{ key: string; present: boolean }> = [
    { key: "raise", present: Boolean(asNonEmptyString(structured?.raise?.value)) },
    { key: "business_model", present: Boolean(asNonEmptyString(structured?.business_model?.value)) },
    { key: "revenue", present: typeof revenueAmount === "number" && Number.isFinite(revenueAmount) },
    { key: "customers", present: typeof customersCount === "number" && Number.isFinite(customersCount) },
    { key: "growth", present: typeof growthPercent === "number" && Number.isFinite(growthPercent) },
  ];

  return checks.filter((item) => !item.present).map((item) => item.key);
};

export function generateDeepDiveDiscoverySectionV1(args: {
  dio?: any;
  report?: any;
  orchestrator_report?: any;
}): DeepDiveDiscoverySectionV1 {
  const report = args.report && typeof args.report === "object" ? args.report : null;
  const structured = report?.structured_summary;
  const diligenceOpenItems = readDiligenceOpenItems(report);
  const verificationRequests = readVerificationRequests(args.orchestrator_report);

  return {
    section: "discovery",
    sources: {
      dio_present: Boolean(args.dio && typeof args.dio === "object"),
      report_present: Boolean(report),
      investor_orchestrator_present: Boolean(args.orchestrator_report && typeof args.orchestrator_report === "object"),
      financial_breakdown_present: Boolean(report?.financial_breakdown_v1),
      underwriting_readiness_present: Boolean(report?.underwriting_readiness_v1),
    },
    key_facts: {
      raise_present: Boolean(asNonEmptyString(structured?.raise?.value)),
      business_model_present: Boolean(asNonEmptyString(structured?.business_model?.value)),
      revenue_present: typeof structured?.revenue?.value?.amount === "number" && Number.isFinite(structured.revenue.value.amount),
      customers_present: typeof structured?.customers?.value?.count === "number" && Number.isFinite(structured.customers.value.count),
      growth_present: typeof structured?.growth?.value?.percent === "number" && Number.isFinite(structured.growth.value.percent),
    },
    diligence_open_items_count: diligenceOpenItems.length,
    verification_requests_count: verificationRequests.length,
  };
}

export function generateDeepDiveGapSectionV1(args: {
  report?: any;
  orchestrator_report?: any;
}): DeepDiveGapSectionV1 {
  const report = args.report && typeof args.report === "object" ? args.report : null;
  const missingCriticalFacts = computeMissingCriticalFacts(report);
  const underwritingGaps = readUnderwritingGaps(report);
  const diligenceOpenItems = readDiligenceOpenItems(report);
  const verificationRequests = readVerificationRequests(args.orchestrator_report);

  return {
    section: "gap",
    missing_critical_facts: missingCriticalFacts,
    underwriting_gaps: underwritingGaps,
    diligence_open_items: diligenceOpenItems,
    verification_requests: verificationRequests,
  };
}

const mapGapsToActions = (gap: DeepDiveGapSectionV1): DeepDiveImplementationActionV1[] => {
  const actions: DeepDiveImplementationActionV1[] = [];

  for (const missingField of gap.missing_critical_facts) {
    actions.push({
      action_id: `critical_fact:${missingField}`,
      priority: "high",
      title: `Backfill ${missingField} with evidence-backed data`,
      rationale: `The critical field ${missingField} is missing from structured_summary and blocks high-confidence underwriting interpretation.`,
      source: "structured_summary",
    });
  }

  for (const underwritingGap of gap.underwriting_gaps.slice(0, 6)) {
    actions.push({
      action_id: `underwriting_gap:${underwritingGap}`,
      priority: "high",
      title: `Resolve underwriting gap: ${underwritingGap}`,
      rationale: `underwriting_readiness_v1 reports ${underwritingGap}, indicating missing or weak financial support for investment review.`,
      source: "underwriting_readiness_v1",
    });
  }

  for (const item of gap.diligence_open_items.slice(0, 4)) {
    actions.push({
      action_id: `diligence:${item.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      priority: "medium",
      title: "Close diligence open item",
      rationale: item,
      source: "score_explanation",
    });
  }

  for (const request of gap.verification_requests.slice(0, 4)) {
    actions.push({
      action_id: `verification:${request.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      priority: "medium",
      title: "Execute verification request",
      rationale: request,
      source: "orchestrator_report_v1",
    });
  }

  return actions;
};

export function generateDeepDiveImplementationSectionV1(args: {
  gap: DeepDiveGapSectionV1;
}): DeepDiveImplementationSectionV1 {
  return {
    section: "implementation",
    actions: mapGapsToActions(args.gap),
  };
}

export function buildDealDeepDiveV1(args: BuildDealDeepDiveV1Args): DealDeepDiveV1 {
  const discovery = generateDeepDiveDiscoverySectionV1({
    dio: args.dio,
    report: args.report,
    orchestrator_report: args.orchestrator_report,
  });

  const gap = generateDeepDiveGapSectionV1({
    report: args.report,
    orchestrator_report: args.orchestrator_report,
  });

  const implementation = generateDeepDiveImplementationSectionV1({ gap });

  return {
    schema_version: "deal_deep_dive_v1",
    deal_id: args.deal_id,
    analysis_version: typeof args.analysis_version === "number" && Number.isFinite(args.analysis_version)
      ? args.analysis_version
      : null,
    generated_at: new Date().toISOString(),
    discovery,
    gap,
    implementation,
  };
}
