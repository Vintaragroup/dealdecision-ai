import type {
  DealIntelligenceObject,
  CompanyPhase,
  PhaseInferenceV1,
} from "../../types/dio.js";

type EvidenceSignal = PhaseInferenceV1["supporting_evidence"][number];

type SignalKey =
  | "problem_definition"
  | "customer_persona"
  | "solution_concept"
  | "prototype_or_roadmap"
  | "customer_discovery"
  | "icp_definition"
  | "live_product"
  | "customers_or_users"
  | "revenue_or_strong_usage"
  | "gtm_hypothesis"
  | "revenue_growth"
  | "retention_metrics"
  | "unit_economics"
  | "burn_runway_clarity"
  | "predictable_growth"
  | "cac_ltv_or_efficiency"
  | "operational_discipline"
  | "scale_signal";

const PHASE_REQUIREMENTS: Record<CompanyPhase, SignalKey[]> = {
  IDEA: ["problem_definition", "customer_persona", "solution_concept"],
  PRE_SEED: ["prototype_or_roadmap", "customer_discovery", "icp_definition"],
  SEED: ["live_product", "customers_or_users", "revenue_or_strong_usage", "gtm_hypothesis"],
  SEED_PLUS: ["revenue_growth", "retention_metrics", "unit_economics", "burn_runway_clarity"],
  SERIES_A: ["predictable_growth", "retention_metrics", "cac_ltv_or_efficiency", "operational_discipline"],
  SERIES_B: [
    "predictable_growth",
    "retention_metrics",
    "cac_ltv_or_efficiency",
    "operational_discipline",
    "scale_signal",
  ],
};

const PHASE_ORDER_HIGH_TO_LOW: CompanyPhase[] = [
  "SERIES_B",
  "SERIES_A",
  "SEED_PLUS",
  "SEED",
  "PRE_SEED",
  "IDEA",
];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw;
}

function pushEvidence(bucket: EvidenceSignal[], item: EvidenceSignal, max = 3): void {
  if (bucket.length >= max) return;
  bucket.push(item);
}

function buildCorpus(dio: DealIntelligenceObject): {
  text: string;
  doc_count: number;
  evidence_count: number;
} {
  const docs = Array.isArray((dio as any)?.inputs?.documents) ? ((dio as any).inputs.documents as any[]) : [];
  const evidence = Array.isArray((dio as any)?.inputs?.evidence) ? ((dio as any).inputs.evidence as any[]) : [];

  const docText = docs
    .map((d) => {
      if (!d || typeof d !== "object") return "";
      const title = normalizeText((d as any).title);
      const summary = normalizeText((d as any).summary);
      const headings = Array.isArray((d as any).headings) ? ((d as any).headings as unknown[]).map(normalizeText).join("\n") : "";
      const metrics = Array.isArray((d as any).metrics)
        ? ((d as any).metrics as any[])
            .map((m) => {
              const name = normalizeText(m?.name);
              const value = typeof m?.value === "number" || typeof m?.value === "string" ? String(m.value) : "";
              return name && value ? `${name}: ${value}` : name;
            })
            .filter(Boolean)
            .join("\n")
        : "";
      return [title, headings, summary, metrics].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  const evidenceText = evidence
    .map((e) => {
      if (!e || typeof e !== "object") return "";
      return normalizeText((e as any).text);
    })
    .filter(Boolean)
    .join("\n\n");

  return {
    text: [docText, evidenceText].filter(Boolean).join("\n\n"),
    doc_count: docs.length,
    evidence_count: evidence.length,
  };
}

function hasAnyMetricNamed(dio: DealIntelligenceObject, rx: RegExp): boolean {
  const docs = Array.isArray((dio as any)?.inputs?.documents) ? ((dio as any).inputs.documents as any[]) : [];
  for (const doc of docs) {
    const metrics = Array.isArray(doc?.metrics) ? (doc.metrics as any[]) : [];
    for (const m of metrics) {
      const name = normalizeText(m?.name).toLowerCase();
      if (!name) continue;
      if (rx.test(name)) return true;
    }
  }
  return false;
}

function getFinancialHealthMetrics(dio: DealIntelligenceObject): {
  runway_months: number | null;
  burn_rate: number | null;
  growth_rate: number | null;
  revenue: number | null;
} {
  const fh = (dio as any)?.analyzer_results?.financial_health;
  const metrics = fh && typeof fh === "object" ? (fh as any).metrics : null;

  return {
    runway_months: typeof fh?.runway_months === "number" ? fh.runway_months : null,
    burn_rate: typeof metrics?.burn_rate === "number" ? metrics.burn_rate : null,
    growth_rate: typeof metrics?.growth_rate === "number" ? metrics.growth_rate : null,
    revenue: typeof metrics?.revenue === "number" ? metrics.revenue : null,
  };
}

function detectSignals(dio: DealIntelligenceObject): {
  present: Record<SignalKey, boolean>;
  evidence: Record<SignalKey, EvidenceSignal[]>;
  conflicts: string[];
} {
  const { text } = buildCorpus(dio);
  const t = text;

  const present = {} as Record<SignalKey, boolean>;
  const evidence = {} as Record<SignalKey, EvidenceSignal[]>;
  const conflicts: string[] = [];

  const init = (k: SignalKey) => {
    present[k] = false;
    evidence[k] = [];
  };

  (
    [
      "problem_definition",
      "customer_persona",
      "solution_concept",
      "prototype_or_roadmap",
      "customer_discovery",
      "icp_definition",
      "live_product",
      "customers_or_users",
      "revenue_or_strong_usage",
      "gtm_hypothesis",
      "revenue_growth",
      "retention_metrics",
      "unit_economics",
      "burn_runway_clarity",
      "predictable_growth",
      "cac_ltv_or_efficiency",
      "operational_discipline",
      "scale_signal",
    ] satisfies SignalKey[]
  ).forEach(init);

  const check = (k: SignalKey, rx: RegExp, signalLabel: string) => {
    if (rx.test(t)) {
      present[k] = true;
      pushEvidence(evidence[k], { signal: signalLabel, source: "text" });
    }
  };

  check("problem_definition", /\b(problem|pain point|pain)\b/i, "problem_definition");
  check("customer_persona", /\b(persona|target customer|buyer)\b/i, "customer_persona");
  check("solution_concept", /\b(solution|approach|product idea|concept)\b/i, "solution_concept");

  check("prototype_or_roadmap", /\b(prototype|mvp|roadmap|beta)\b/i, "prototype_or_roadmap");
  check("customer_discovery", /\b(customer discovery|interviews?|survey|pilot)\b/i, "customer_discovery");
  check("icp_definition", /\b(ICP|ideal customer profile)\b/i, "icp_definition");

  check("live_product", /\b(live product|launched|in production|available now)\b/i, "live_product");
  check("customers_or_users", /\b(customers?|users?|active users|paid users)\b/i, "customers_or_users");

  const hasRevenueMetric = hasAnyMetricNamed(dio, /(arr|mrr|revenue|gmv|sales)/i);
  const hasUsageMetric = hasAnyMetricNamed(dio, /(dau|mau|active users|retention|churn)/i);
  if (hasRevenueMetric || hasUsageMetric || /\b(ARR|MRR|revenue|GMV|orders?)\b/i.test(t)) {
    present["revenue_or_strong_usage"] = true;
    pushEvidence(evidence["revenue_or_strong_usage"], {
      signal: "revenue_or_strong_usage",
      source: hasRevenueMetric || hasUsageMetric ? "metrics" : "text",
    });
  }

  check("gtm_hypothesis", /\b(GTM|go-to-market|go to market|acquisition channel|distribution)\b/i, "gtm_hypothesis");

  const fh = getFinancialHealthMetrics(dio);
  if (
    /\b(growth|month over month|MoM)\b/i.test(t) ||
    typeof fh.growth_rate === "number" ||
    hasAnyMetricNamed(dio, /(growth|m\/?m|mom)/i)
  ) {
    present["revenue_growth"] = true;
    pushEvidence(evidence["revenue_growth"], { signal: "revenue_growth", source: "text" });
  }

  check("retention_metrics", /\b(retention|churn|cohort)\b/i, "retention_metrics");
  if (/\b(unit economics|gross margin|contribution margin)\b/i.test(t) || /\b(CAC|LTV|payback)\b/i.test(t)) {
    present["unit_economics"] = true;
    pushEvidence(evidence["unit_economics"], { signal: "unit_economics", source: "text" });
  }

  if (
    /\b(runway|burn rate|burn multiple)\b/i.test(t) ||
    typeof fh.runway_months === "number" ||
    typeof fh.burn_rate === "number"
  ) {
    present["burn_runway_clarity"] = true;
    pushEvidence(evidence["burn_runway_clarity"], { signal: "burn_runway_clarity", source: "financial_health" });
  }

  if (/\b(predictable|repeatable|pipeline)\b/i.test(t) || present["revenue_growth"]) {
    present["predictable_growth"] = true;
    pushEvidence(evidence["predictable_growth"], { signal: "predictable_growth", source: "text" });
  }

  if (/\b(CAC|LTV|payback|efficiency)\b/i.test(t)) {
    present["cac_ltv_or_efficiency"] = true;
    pushEvidence(evidence["cac_ltv_or_efficiency"], { signal: "cac_ltv_or_efficiency", source: "text" });
  }

  if (/\b(OKR|KPIs?|operational|reporting cadence|board deck)\b/i.test(t)) {
    present["operational_discipline"] = true;
    pushEvidence(evidence["operational_discipline"], { signal: "operational_discipline", source: "text" });
  }

  const scaleRevenue = typeof fh.revenue === "number" ? fh.revenue : null;
  if ((scaleRevenue != null && scaleRevenue >= 10_000_000) || /\b(10M ARR|\$10M ARR|\$10m ARR)\b/i.test(t)) {
    present["scale_signal"] = true;
    pushEvidence(evidence["scale_signal"], { signal: "scale_signal", source: "financial_health" });
  }

  const saysPreRevenue = /\b(pre-?revenue|no revenue)\b/i.test(t);
  const hasRevenue = hasRevenueMetric || (scaleRevenue != null && scaleRevenue > 0) || /\b(ARR|MRR|revenue)\b/i.test(t);
  if (saysPreRevenue && hasRevenue) {
    conflicts.push("conflict: pre-revenue vs revenue signal");
  }

  const saysNoCustomers = /\b(no customers|no users)\b/i.test(t);
  if (saysNoCustomers && present["customers_or_users"]) {
    conflicts.push("conflict: no customers vs customers/users signal");
  }

  return { present, evidence, conflicts };
}

function inferPhaseFromSignals(present: Record<SignalKey, boolean>): CompanyPhase {
  for (const phase of PHASE_ORDER_HIGH_TO_LOW) {
    const reqs = PHASE_REQUIREMENTS[phase];
    if (reqs.every((r) => present[r])) return phase;
  }
  return "IDEA";
}

function scoreConfidence(params: {
  inferred_phase: CompanyPhase;
  present: Record<SignalKey, boolean>;
  conflicts: string[];
  doc_count: number;
  evidence_count: number;
}): number {
  const reqs = PHASE_REQUIREMENTS[params.inferred_phase];
  const found = reqs.filter((r) => params.present[r]).length;
  const required = reqs.length;

  const requiredRatio = required > 0 ? found / required : 0;

  const docsFactor = Math.min(params.doc_count, 3) / 3;
  const evidenceFactor = Math.min(params.evidence_count, 3) / 3;

  let confidence = 0.45 + 0.35 * requiredRatio + 0.1 * docsFactor + 0.1 * evidenceFactor;

  if (params.conflicts.length > 0) confidence -= 0.15;

  return clamp01(Math.min(0.95, Math.max(0.05, confidence)));
}

export function inferCompanyPhaseV1(dio: DealIntelligenceObject): PhaseInferenceV1 {
  const corpus = buildCorpus(dio);
  const { present, evidence, conflicts } = detectSignals(dio);

  const company_phase = inferPhaseFromSignals(present);
  const confidence = scoreConfidence({
    inferred_phase: company_phase,
    present,
    conflicts,
    doc_count: corpus.doc_count,
    evidence_count: corpus.evidence_count,
  });

  const required = PHASE_REQUIREMENTS[company_phase];
  const missing_evidence = required.filter((r) => !present[r]);

  const supporting_evidence: EvidenceSignal[] = [];
  (Object.keys(present) as SignalKey[])
    .filter((k) => present[k])
    .forEach((k) => {
      for (const ev of evidence[k]) pushEvidence(supporting_evidence, ev, 24);
      // If we matched the signal but didn't capture a snippet, still emit a minimal marker for explainability.
      if (evidence[k].length === 0) pushEvidence(supporting_evidence, { signal: k, source: "derived" }, 24);
    });

  const rationale: string[] = [
    `phase inferred as ${company_phase} (highest phase with required evidence present)`,
  ];
  if (missing_evidence.length > 0) {
    rationale.push(`missing evidence for inferred phase: ${missing_evidence.join(", ")}`);
  }
  if (conflicts.length > 0) {
    rationale.push(...conflicts);
  }

  return {
    company_phase,
    confidence,
    supporting_evidence,
    missing_evidence,
    rationale,
  };
}

export function getPhaseRequirementsV1(phase: CompanyPhase): SignalKey[] {
  return [...PHASE_REQUIREMENTS[phase]];
}

export type { SignalKey };
