export type CanonicalBusinessModel =
  | "saas"
  | "regtech_saas"
  | "fintech"
  | "marketplace"
  | "real_estate_investment"
  | "consumer"
  | "biotech"
  | "services"
  | "licensing"
  | "fund_spv"
  | "other"
  | "unknown";

export type BusinessModelRevenueType =
  | "saas_subscriptions"
  | "transactional"
  | "licensing"
  | "services"
  | "rents"
  | "management_fees"
  | "interest_spread"
  | "other";

export type BusinessModelKpi =
  | "mrr"
  | "arr"
  | "nrr"
  | "ndr"
  | "churn"
  | "cac"
  | "ltv"
  | "gmv"
  | "take_rate"
  | "noi"
  | "cap_rate"
  | "dscr"
  | "ltv_real_estate";

export type BusinessModelCandidate = {
  business_model: CanonicalBusinessModel | string;
  confidence?: number; // 0..1
  source?: string;
  note?: string;
};

export type BusinessModelArbitrationEvidence = {
  model: CanonicalBusinessModel;
  kind: "revenue_type" | "kpi" | "descriptor" | "slide_archetype" | "candidate" | "guard";
  weight: number;
  detail: string;
  source?: string;
};

export type BusinessModelArbitrationInput = {
  detected_revenue_types?: BusinessModelRevenueType[];
  kpis_present?: BusinessModelKpi[];
  product_descriptors?: string[];
  slide_archetypes?: string[];
  candidates?: BusinessModelCandidate[];
};

export type BusinessModelArbitrationResult = {
  business_model: CanonicalBusinessModel;
  confidence: number; // 0..1
  evidence: BusinessModelArbitrationEvidence[];
  overridden_candidates: BusinessModelCandidate[];
};

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

function normalizeDescriptorToken(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCandidateModel(m: string): CanonicalBusinessModel {
  const k = String(m ?? "")
    .toLowerCase()
    .trim();
  if (!k) return "unknown";

  if (k === "saas" || k.includes("saas") || k.includes("subscription")) return "saas";
  if (k.includes("regtech") || k.includes("compliance")) return "regtech_saas";
  if (k.includes("fintech") || k.includes("payments") || k.includes("wallet")) return "fintech";
  if (k.includes("marketplace") || k.includes("two sided") || k.includes("two-sided")) return "marketplace";
  if (k.includes("real_estate") || k.includes("real estate") || k.includes("property")) return "real_estate_investment";
  if (k.includes("consumer") || k.includes("ecommerce") || k.includes("e-commerce") || k.includes("cpg")) return "consumer";
  if (k.includes("biotech") || k.includes("bio") || k.includes("clinical")) return "biotech";
  if (k.includes("service") || k.includes("consulting") || k.includes("implementation")) return "services";
  if (k.includes("licens")) return "licensing";
  if (k.includes("spv") || k.includes("fund")) return "fund_spv";

  return "other";
}

type ScoreState = {
  scoreByModel: Record<CanonicalBusinessModel, number>;
  evidence: BusinessModelArbitrationEvidence[];
};

function initScoreState(): ScoreState {
  return {
    scoreByModel: {
      saas: 0,
      regtech_saas: 0,
      fintech: 0,
      marketplace: 0,
      real_estate_investment: 0,
      consumer: 0,
      biotech: 0,
      services: 0,
      licensing: 0,
      fund_spv: 0,
      other: 0,
      unknown: 0,
    },
    evidence: [],
  };
}

function addEvidence(st: ScoreState, ev: BusinessModelArbitrationEvidence): void {
  st.evidence.push(ev);
  st.scoreByModel[ev.model] += ev.weight;
}

function hasAny(tokens: string[], needles: string[]): boolean {
  if (tokens.length === 0) return false;
  const set = new Set(tokens);
  return needles.some((n) => set.has(n));
}

export function arbitrateBusinessModelV1(input: BusinessModelArbitrationInput): BusinessModelArbitrationResult {
  const st = initScoreState();

  const revenueTypes = Array.isArray(input.detected_revenue_types) ? input.detected_revenue_types : [];
  const kpis = Array.isArray(input.kpis_present) ? input.kpis_present : [];
  const archetypes = Array.isArray(input.slide_archetypes) ? input.slide_archetypes : [];
  const descriptorsRaw = Array.isArray(input.product_descriptors) ? input.product_descriptors : [];
  const descriptorTokens = descriptorsRaw
    .flatMap((d) => normalizeDescriptorToken(d).split(" "))
    .filter(Boolean);

  // Revenue type signals
  for (const rt of revenueTypes) {
    if (rt === "saas_subscriptions") {
      addEvidence(st, { model: "saas", kind: "revenue_type", weight: 0.6, detail: "Revenue type indicates SaaS subscriptions" });
      addEvidence(st, { model: "regtech_saas", kind: "revenue_type", weight: 0.55, detail: "Revenue type indicates SaaS subscriptions (regtech candidate)" });
    }
    if (rt === "transactional") {
      addEvidence(st, { model: "marketplace", kind: "revenue_type", weight: 0.35, detail: "Revenue type indicates transactions" });
      addEvidence(st, { model: "fintech", kind: "revenue_type", weight: 0.35, detail: "Revenue type indicates transactions (fintech candidate)" });
    }
    if (rt === "licensing") {
      addEvidence(st, { model: "licensing", kind: "revenue_type", weight: 0.65, detail: "Revenue type indicates licensing" });
    }
    if (rt === "services") {
      addEvidence(st, { model: "services", kind: "revenue_type", weight: 0.55, detail: "Revenue type indicates services" });
    }
    if (rt === "rents" || rt === "management_fees") {
      addEvidence(st, { model: "real_estate_investment", kind: "revenue_type", weight: 0.6, detail: "Revenue type indicates real estate rent/fees" });
    }
    if (rt === "interest_spread") {
      addEvidence(st, { model: "fintech", kind: "revenue_type", weight: 0.45, detail: "Revenue type indicates interest spread" });
    }
  }

  // KPI presence signals
  for (const k of kpis) {
    if (k === "mrr" || k === "arr") {
      addEvidence(st, { model: "saas", kind: "kpi", weight: 0.6, detail: `KPI present: ${k.toUpperCase()}` });
      addEvidence(st, { model: "regtech_saas", kind: "kpi", weight: 0.55, detail: `KPI present: ${k.toUpperCase()} (regtech candidate)` });
    }
    if (k === "nrr" || k === "ndr" || k === "churn") {
      addEvidence(st, { model: "saas", kind: "kpi", weight: 0.25, detail: `SaaS retention KPI present: ${k}` });
      addEvidence(st, { model: "regtech_saas", kind: "kpi", weight: 0.2, detail: `SaaS retention KPI present: ${k} (regtech candidate)` });
    }
    if (k === "gmv" || k === "take_rate") {
      addEvidence(st, { model: "marketplace", kind: "kpi", weight: 0.55, detail: `Marketplace KPI present: ${k}` });
    }
    if (k === "noi" || k === "cap_rate" || k === "dscr" || k === "ltv_real_estate") {
      addEvidence(st, { model: "real_estate_investment", kind: "kpi", weight: 0.6, detail: `Real estate KPI present: ${k}` });
    }
  }

  // Product descriptor signals (token-based)
  const hasPlatformSoftwareLanguage = hasAny(descriptorTokens, [
    "platform",
    "software",
    "saas",
    "api",
    "dashboard",
    "workflow",
  ]);
  const hasAiLanguage = hasAny(descriptorTokens, ["ai", "aipowered", "ai-powered", "ml", "machine", "learning"]);
  const hasComplianceLanguage = hasAny(descriptorTokens, [
    "compliance",
    "regulatory",
    "regulation",
    "audit",
    "soc2",
    "soc",
    "hipaa",
    "gdpr",
    "kyc",
    "aml",
  ]);
  const hasRealEstateLanguage = hasAny(descriptorTokens, ["property", "multifamily", "tenant", "lease", "cap", "rate", "noi"]);

  if (hasPlatformSoftwareLanguage) {
    addEvidence(st, { model: "saas", kind: "descriptor", weight: 0.45, detail: "Platform/software language present" });
    addEvidence(st, { model: "regtech_saas", kind: "descriptor", weight: 0.35, detail: "Platform/software language present (regtech candidate)" });
  }
  if (hasAiLanguage) {
    addEvidence(st, { model: "saas", kind: "descriptor", weight: 0.15, detail: "AI-powered language present" });
    addEvidence(st, { model: "regtech_saas", kind: "descriptor", weight: 0.12, detail: "AI-powered language present (regtech candidate)" });
  }
  if (hasComplianceLanguage) {
    addEvidence(st, { model: "regtech_saas", kind: "descriptor", weight: 0.6, detail: "Compliance/regulatory language present" });
  }
  if (hasRealEstateLanguage) {
    addEvidence(st, { model: "real_estate_investment", kind: "descriptor", weight: 0.35, detail: "Property/real estate language present" });
  }

  // Slide archetypes (very light weights; mainly for auditability)
  const archetypesLc = archetypes.map((a) => String(a).toLowerCase());
  const hasRevenueSlide = archetypesLc.some((a) => a.includes("revenue") || a.includes("pricing") || a.includes("business model"));
  const hasTractionSlide = archetypesLc.some((a) => a.includes("traction") || a.includes("kpi"));
  const hasGtmSlide = archetypesLc.some((a) => a.includes("gtm") || a.includes("go to market") || a.includes("go-to-market"));

  const hasSaasSubscription = revenueTypes.includes("saas_subscriptions") || hasAny(descriptorTokens, ["subscription", "subscriptions", "saas"]);
  const hasMrr = kpis.includes("mrr");
  const hasArr = kpis.includes("arr");

  if (hasRevenueSlide && hasSaasSubscription) {
    addEvidence(st, { model: "saas", kind: "slide_archetype", weight: 0.1, detail: "Revenue model slide present alongside SaaS subscription signal" });
    addEvidence(st, { model: "regtech_saas", kind: "slide_archetype", weight: 0.08, detail: "Revenue model slide present alongside SaaS subscription signal (regtech candidate)" });
  }
  if (hasTractionSlide && (hasMrr || hasArr)) {
    addEvidence(st, { model: "saas", kind: "slide_archetype", weight: 0.1, detail: "Traction slide present alongside MRR/ARR" });
    addEvidence(st, { model: "regtech_saas", kind: "slide_archetype", weight: 0.08, detail: "Traction slide present alongside MRR/ARR (regtech candidate)" });
  }
  if (hasGtmSlide && hasPlatformSoftwareLanguage) {
    addEvidence(st, { model: "saas", kind: "slide_archetype", weight: 0.05, detail: "GTM slide present alongside platform/software language" });
  }

  // Candidate business models (kept modest so strong direct evidence can override)
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  for (const cand of candidates) {
    const model = normalizeCandidateModel(String(cand.business_model ?? ""));
    const c = clamp01(typeof cand.confidence === "number" ? cand.confidence : 0.5);
    const w = 0.22 * c;
    addEvidence(st, {
      model,
      kind: "candidate",
      weight: w,
      detail: `Candidate model provided: ${String(cand.business_model)} (confidence=${c.toFixed(2)})`,
      source: cand.source,
    });
  }

  // Contradiction guards
  // If SaaS subscriptions AND (MRR OR ARR) present → disallow real_estate_investment
  if (hasSaasSubscription && (hasMrr || hasArr)) {
    const current = st.scoreByModel.real_estate_investment;
    if (current > -999) {
      // Force disallow deterministically.
      st.scoreByModel.real_estate_investment = -999;
      st.evidence.push({
        model: "real_estate_investment",
        kind: "guard",
        weight: 0,
        detail: "Contradiction guard: SaaS subscriptions + MRR/ARR ⇒ disallow real_estate_investment",
      });
    }
  }

  const ranked = (Object.entries(st.scoreByModel) as Array<[CanonicalBusinessModel, number]>)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const best = ranked[0] ?? ["unknown" as const, 0];
  const second = ranked[1] ?? ["unknown" as const, 0];

  let business_model = best[0];
  const bestScore = best[1];
  const secondScore = second[1];

  if (!Number.isFinite(bestScore) || bestScore <= 0) {
    business_model = "unknown";
  }

  // Deterministic confidence: based on separation and absolute score.
  const denom = Math.max(0.0001, (bestScore <= 0 ? 0.0001 : bestScore) + Math.max(0, secondScore) + 0.35);
  const confidence = clamp01(bestScore <= 0 ? 0 : bestScore / denom);

  const overridden_candidates = candidates
    .map((c) => ({ ...c }))
    .filter((c) => normalizeCandidateModel(String(c.business_model ?? "")) !== business_model);

  // Keep evidence ordered by (model match first, |weight| desc, kind asc, detail asc).
  const evidence = st.evidence
    .slice()
    .sort((a, b) => {
      const am = a.model === business_model ? 1 : 0;
      const bm = b.model === business_model ? 1 : 0;
      if (am !== bm) return bm - am;
      const aw = Math.abs(a.weight);
      const bw = Math.abs(b.weight);
      if (bw !== aw) return bw - aw;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.detail.localeCompare(b.detail);
    });

  return {
    business_model,
    confidence,
    evidence,
    overridden_candidates,
  };
}
