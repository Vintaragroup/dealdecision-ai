import type {
  DeepDiveEvidenceStrengthV1,
  DeepDiveOpenQuestionV1,
  DeepDiveQuestionPriorityV1,
  DeepDiveRedFlagV1,
} from "../models/deep-dive-v1.js";
import type { DeepDiveClassificationEnrichmentV1 } from "../models/deep-dive-classification-v1.js";

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
};

const humanizeFactKey = (value: string): string => {
  const key = value.trim().toLowerCase();
  if (key === "raise") return "fundraising terms";
  if (key === "business_model") return "business model clarity";
  if (key === "revenue") return "revenue visibility";
  if (key === "customers") return "customer base visibility";
  if (key === "growth") return "growth evidence";
  return key.replace(/_/g, " ");
};

const implicationForMissingFact = (value: string): string => {
  const key = value.trim().toLowerCase();
  if (key === "revenue") return "without verified revenue, scale and maturity are difficult to assess";
  if (key === "growth") return "without growth evidence, momentum and trajectory remain uncertain";
  if (key === "customers") return "without customer visibility, demand durability is hard to validate";
  if (key === "raise") return "without clear raise terms, dilution and financing risk remain unclear";
  if (key === "business_model") return "without business model clarity, unit economics and scalability are uncertain";
  return "this limits confidence in underwriting conclusions";
};

const investorReasonForQuestionSource = (source: "missing" | "verification" | "diligence" | "executive"): string => {
  if (source === "missing") return "This is a core underwriting dependency and should be resolved before conviction increases.";
  if (source === "verification") return "This resolves an evidence conflict and improves reliability of the investment case.";
  if (source === "diligence") return "This is a diligence dependency that materially affects execution confidence.";
  return "This improves context but is lower urgency than core underwriting dependencies.";
};

export const toUniqueStrings = (values: unknown[]): string[] => {
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

export const evidenceStrengthFromSignals = (args: {
  evidence_refs: string[];
  supporting_signals: number;
}): DeepDiveEvidenceStrengthV1 => {
  const refs = Array.isArray(args.evidence_refs) ? args.evidence_refs.length : 0;
  const support = Number.isFinite(args.supporting_signals) ? args.supporting_signals : 0;
  if (refs >= 3 && support >= 2) return "strong";
  if (refs >= 2 || support >= 2) return "moderate";
  if (refs >= 1 || support >= 1) return "weak";
  return "none";
};

const normalizeModel = (value: unknown): string | null => {
  const s = asNonEmptyString(value);
  if (!s) return null;
  return s.toLowerCase();
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const detectDeepDiveContradictionsV1 = (args: {
  report?: any;
  orchestrator_report?: any;
  missing_critical_facts?: string[];
  classification_enrichment?: DeepDiveClassificationEnrichmentV1 | null;
}): DeepDiveRedFlagV1[] => {
  const redFlags: DeepDiveRedFlagV1[] = [];
  const report = args.report && typeof args.report === "object" ? args.report : null;
  const orchestrator = args.orchestrator_report && typeof args.orchestrator_report === "object" ? args.orchestrator_report : null;

  const structuredModel = normalizeModel(report?.structured_summary?.business_model?.value);
  const productType = normalizeModel(orchestrator?.segments?.product_profile_v1?.product_type);
  const modelMismatch = structuredModel && productType && !structuredModel.includes(productType) && !productType.includes(structuredModel);
  if (modelMismatch) {
    redFlags.push({
      flag: "Business model characterization is inconsistent across structured summary and product profile outputs.",
      contradiction_type: "semantic_divergence",
      evidence_refs: [],
    });
  }

  const revenueAmount = asFiniteNumber(report?.structured_summary?.revenue?.value?.amount);
  const financialBenchmarks = Array.isArray(orchestrator?.segments?.financial?.benchmarks)
    ? (orchestrator.segments.financial.benchmarks as any[])
    : [];
  const benchmarkEvidenceRefs = toUniqueStrings(financialBenchmarks.flatMap((benchmark: any) => benchmark?.evidence_refs ?? []));

  if (revenueAmount != null && financialBenchmarks.length === 0) {
    redFlags.push({
      flag: "Revenue is stated, but benchmark-level corroboration is limited in the available financial evidence.",
      contradiction_type: "source_divergence",
      evidence_refs: [],
    });
  }

  const conflicts = Array.isArray(orchestrator?.segments?.risk_verification?.data_issues?.conflicts)
    ? (orchestrator.segments.risk_verification.data_issues.conflicts as any[])
    : [];
  for (const conflict of conflicts.slice(0, 6)) {
    const field = asNonEmptyString(conflict?.field);
    redFlags.push({
      flag: field
        ? `Conflicting values were detected for ${field}, which weakens confidence in this input.`
        : "Conflicting values were detected across sources, reducing reliability of the current evidence set.",
      contradiction_type: "numeric_divergence",
      evidence_refs: toUniqueStrings(Array.isArray(conflict?.evidence_refs) ? conflict.evidence_refs : []),
    });
  }

  const missingCriticalFacts = Array.isArray(args.missing_critical_facts) ? args.missing_critical_facts : [];
  for (const field of missingCriticalFacts.slice(0, 6)) {
    redFlags.push({
      flag: `${humanizeFactKey(field)} is missing; ${implicationForMissingFact(field)}.`,
      contradiction_type: "missing_critical",
      evidence_refs: [],
    });
  }

  if (args.classification_enrichment?.classificationConflict) {
    redFlags.push({
      flag: args.classification_enrichment.conflictReason
        ? `Classification conflict detected: ${args.classification_enrichment.conflictReason}`
        : "Classification conflict detected between product-native understanding and taxonomy context.",
      contradiction_type: "semantic_divergence",
      evidence_refs: [],
    });
  }

  if (benchmarkEvidenceRefs.length > 0 && redFlags.length > 0) {
    for (const flag of redFlags) {
      if (flag.evidence_refs.length === 0) {
        flag.evidence_refs = benchmarkEvidenceRefs.slice(0, 3);
      }
    }
  }

  return redFlags;
};

const priorityRank: Record<DeepDiveQuestionPriorityV1, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
};

export const prioritizeDeepDiveQuestionsV1 = (args: {
  diligence_open_items: string[];
  verification_requests: string[];
  executive_open_questions: string[];
  missing_critical_facts: string[];
}): DeepDiveOpenQuestionV1[] => {
  const out: DeepDiveOpenQuestionV1[] = [];

  for (const field of args.missing_critical_facts.slice(0, 6)) {
    const label = humanizeFactKey(field);
    out.push({
      question: `What verified evidence can establish ${label}?`,
      priority: "p0",
      reason: investorReasonForQuestionSource("missing"),
      evidence_refs: [],
    });
  }

  for (const item of args.verification_requests.slice(0, 6)) {
    out.push({
      question: item,
      priority: "p1",
      reason: investorReasonForQuestionSource("verification"),
      evidence_refs: [],
    });
  }

  for (const item of args.diligence_open_items.slice(0, 6)) {
    out.push({
      question: item,
      priority: "p1",
      reason: investorReasonForQuestionSource("diligence"),
      evidence_refs: [],
    });
  }

  for (const question of args.executive_open_questions.slice(0, 6)) {
    out.push({
      question,
      priority: "p2",
      reason: investorReasonForQuestionSource("executive"),
      evidence_refs: [],
    });
  }

  const deduped = new Map<string, DeepDiveOpenQuestionV1>();
  for (const item of out) {
    const key = item.question.toLowerCase().trim();
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    if (priorityRank[item.priority] < priorityRank[existing.priority]) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const p = priorityRank[a.priority] - priorityRank[b.priority];
    if (p !== 0) return p;
    return a.question.localeCompare(b.question);
  });
};
