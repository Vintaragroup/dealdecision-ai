import type { DeepDiveClassificationEnrichmentV1, DeepDiveClassificationConfidenceV1, DeepDiveTaxonomyCandidateV1 } from "../models/deep-dive-classification-v1.js";
import { getSelectedPolicyIdFromAny } from "../classification/get-selected-policy-id.js";

type TaxonomyFamily =
  | "saas"
  | "fintech"
  | "consumer_brand"
  | "real_estate"
  | "biotech"
  | "media"
  | "fund_vehicle"
  | "services"
  | "other";

type TaxonomyTemplate = {
  family: TaxonomyFamily;
  naics: Array<{ code: string; title: string }>;
  sic: Array<{ code: string; title: string }>;
  bestFitLabel: string;
  expectations: string[];
};

const TAXONOMY_TEMPLATES: TaxonomyTemplate[] = [
  {
    family: "saas",
    naics: [{ code: "513210", title: "Software Publishers" }],
    sic: [{ code: "7372", title: "Prepackaged Software" }],
    bestFitLabel: "Software Publishers",
    expectations: [
      "Recurring-revenue quality and retention trend",
      "Sales efficiency and payback discipline",
      "Proof of durable product differentiation",
    ],
  },
  {
    family: "fintech",
    naics: [{ code: "522320", title: "Financial Transactions Processing, Reserve, and Clearinghouse Activities" }],
    sic: [{ code: "6099", title: "Functions Related to Depository Banking, Not Elsewhere Classified" }],
    bestFitLabel: "Financial Transactions Processing",
    expectations: [
      "Regulatory readiness and compliance controls",
      "Unit economics net of risk and fraud losses",
      "Clear monetization of payment or balance flow",
    ],
  },
  {
    family: "consumer_brand",
    naics: [{ code: "454110", title: "Electronic Shopping and Mail-Order Houses" }],
    sic: [{ code: "5961", title: "Catalog and Mail-Order Houses" }],
    bestFitLabel: "Electronic Shopping and Mail-Order Houses",
    expectations: [
      "Contribution-margin and repeat-purchase durability",
      "Channel concentration and merchandising risk",
      "Working-capital discipline and inventory velocity",
    ],
  },
  {
    family: "real_estate",
    naics: [{ code: "531390", title: "Other Activities Related to Real Estate" }],
    sic: [{ code: "6531", title: "Real Estate Agents and Managers" }],
    bestFitLabel: "Real Estate Activities",
    expectations: [
      "Asset-level underwriting and occupancy durability",
      "Debt-service resilience and covenant headroom",
      "Capex intensity and exit-liquidity assumptions",
    ],
  },
  {
    family: "biotech",
    naics: [{ code: "541714", title: "Research and Development in Biotechnology" }],
    sic: [{ code: "8731", title: "Commercial Physical and Biological Research" }],
    bestFitLabel: "Biotechnology R&D",
    expectations: [
      "Clinical or regulatory milestone evidence",
      "Path-to-market timeline realism",
      "Capital intensity relative to proof milestones",
    ],
  },
  {
    family: "media",
    naics: [{ code: "512110", title: "Motion Picture and Video Production" }],
    sic: [{ code: "7812", title: "Motion Picture and Video Tape Production" }],
    bestFitLabel: "Media and IP Production",
    expectations: [
      "Audience monetization durability",
      "Distribution dependency concentration",
      "IP ownership and rights defensibility",
    ],
  },
  {
    family: "fund_vehicle",
    naics: [{ code: "523920", title: "Portfolio Management" }],
    sic: [{ code: "6726", title: "Unit Investment Trusts, Face-Amount Certificate Offices, and Closed-End Management Investment Offices" }],
    bestFitLabel: "Portfolio Management",
    expectations: [
      "Governance and reporting controls",
      "Portfolio concentration and downside protection",
      "Liquidity terms aligned to asset duration",
    ],
  },
  {
    family: "services",
    naics: [{ code: "541990", title: "All Other Professional, Scientific, and Technical Services" }],
    sic: [{ code: "8748", title: "Business Consulting Services, Not Elsewhere Classified" }],
    bestFitLabel: "Professional Services",
    expectations: [
      "Delivery capacity versus growth plan",
      "Client concentration and renewal durability",
      "Margin profile as scale increases",
    ],
  },
  {
    family: "other",
    naics: [],
    sic: [],
    bestFitLabel: "Insufficient signal for reliable taxonomy fit",
    expectations: ["Primary business type should be clarified before relying on taxonomy-based context."],
  },
];

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
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

const confidenceFromScore = (score: number): DeepDiveClassificationConfidenceV1 => {
  if (score >= 0.72) return "strong";
  if (score >= 0.5) return "moderate";
  if (score >= 0.28) return "weak";
  return "unknown";
};

const compactLabel = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const policyToNativeLabel = (policyId: string): string | null => {
  const p = policyId.toLowerCase();
  if (p === "enterprise_saas_b2b_v1") return "B2B SaaS";
  if (p === "consumer_fintech_platform_v1") return "Consumer Fintech Platform";
  if (p === "consumer_ecommerce_brand_v1") return "Consumer Ecommerce Brand";
  if (p === "physical_product_cpg_spirits_v1") return "Physical Product / CPG";
  if (p === "healthcare_biotech_v1") return "Biotechnology";
  if (p === "media_entertainment_ip_v1") return "Media and Entertainment IP";
  if (p === "real_estate_underwriting") return "Real Estate Investment";
  if (p === "fund_spv") return "Fund Vehicle";
  if (p === "credit_memo") return "Credit Strategy";
  if (p === "acquisition_memo") return "Acquisition Strategy";
  if (p === "operating_startup_revenue_v1" || p === "execution_ready_v1" || p === "startup_raise") return "Operating Startup";
  return null;
};

const familyFromLabel = (value: string | null): TaxonomyFamily => {
  const s = compactLabel(value ?? "");
  if (!s) return "other";
  if (/saas|software|regtech|subscription/.test(s)) return "saas";
  if (/fintech|payment|lending|wallet|bank/.test(s)) return "fintech";
  if (/consumer|ecommerce|e commerce|dtc|cpg|spirits|retail/.test(s)) return "consumer_brand";
  if (/real estate|property|reit|multifamily|asset backed/.test(s)) return "real_estate";
  if (/biotech|clinical|pharma|therapeutic|life science/.test(s)) return "biotech";
  if (/media|entertainment|ip|content|studio/.test(s)) return "media";
  if (/fund|spv|portfolio|asset manager|credit strategy|acquisition strategy/.test(s)) return "fund_vehicle";
  if (/services|consulting|agency|implementation/.test(s)) return "services";
  return "other";
};

const toCandidateConfidence = (score: number): Exclude<DeepDiveClassificationConfidenceV1, "unknown"> => {
  if (score >= 0.72) return "strong";
  if (score >= 0.5) return "moderate";
  return "weak";
};

const findTemplate = (family: TaxonomyFamily): TaxonomyTemplate =>
  TAXONOMY_TEMPLATES.find((item) => item.family === family) ?? TAXONOMY_TEMPLATES[TAXONOMY_TEMPLATES.length - 1];

const inferNativeLabel = (args: {
  structuredModel: string | null;
  arbitrationModel: string | null;
  policyLabel: string | null;
  archetypeValue: string | null;
  productType: string | null;
}): string => {
  return (
    args.structuredModel ??
    args.arbitrationModel ??
    args.policyLabel ??
    args.archetypeValue ??
    args.productType ??
    "Unknown operating model"
  );
};

const buildTaxonomyCandidates = (args: {
  familySignals: TaxonomyFamily[];
  baseScore: number;
}): {
  naicsCandidates: DeepDiveTaxonomyCandidateV1[];
  sicCandidates: DeepDiveTaxonomyCandidateV1[];
  bestFitLabel: string;
  expectations: string[];
} => {
  const familyWeights = new Map<TaxonomyFamily, number>();
  for (const family of args.familySignals) {
    familyWeights.set(family, (familyWeights.get(family) ?? 0) + 1);
  }

  const rankedFamilies = Array.from(familyWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family]) => family)
    .slice(0, 3);

  const topFamily = rankedFamilies[0] ?? "other";
  const topTemplate = findTemplate(topFamily);

  const naicsCandidates: DeepDiveTaxonomyCandidateV1[] = [];
  const sicCandidates: DeepDiveTaxonomyCandidateV1[] = [];

  for (const [index, family] of rankedFamilies.entries()) {
    const template = findTemplate(family);
    const dampener = index === 0 ? 1 : index === 1 ? 0.82 : 0.7;
    const score = clamp01(args.baseScore * dampener);
    if (template.naics.length > 0) {
      const naics = template.naics[0];
      naicsCandidates.push({
        code: naics.code,
        title: naics.title,
        confidence: toCandidateConfidence(score),
      });
    }
    if (template.sic.length > 0) {
      const sic = template.sic[0];
      sicCandidates.push({
        code: sic.code,
        title: sic.title,
        confidence: toCandidateConfidence(score),
      });
    }
  }

  return {
    naicsCandidates,
    sicCandidates,
    bestFitLabel: topTemplate.bestFitLabel,
    expectations: topTemplate.expectations,
  };
};

export function deriveDeepDiveClassificationEnrichmentV1(args: {
  dio?: any;
  report?: any;
  orchestrator_report?: any;
}): DeepDiveClassificationEnrichmentV1 {
  const dio = args.dio && typeof args.dio === "object" ? args.dio : null;
  const report = args.report && typeof args.report === "object" ? args.report : null;
  const orchestrator = args.orchestrator_report && typeof args.orchestrator_report === "object" ? args.orchestrator_report : null;

  const structuredModel = asNonEmptyString(report?.structured_summary?.business_model?.value);
  const arbitrationModel = asNonEmptyString(
    dio?.phase1?.business_model_arbitration_v1?.business_model ??
      dio?.business_model_arbitration_v1?.business_model
  );
  const archetypeValue = asNonEmptyString(
    dio?.phase1?.business_archetype_v1?.value ??
      dio?.business_archetype_v1?.value
  );
  const productType = asNonEmptyString(orchestrator?.segments?.product_profile_v1?.product_type);
  const selectedPolicyId =
    getSelectedPolicyIdFromAny(dio) ??
    asNonEmptyString(report?.score_explanation?.aggregation?.policy_id) ??
    asNonEmptyString(report?.metadata?.score_explanation?.aggregation?.policy_id);
  const policyLabel = selectedPolicyId ? policyToNativeLabel(selectedPolicyId) : null;

  const nativeLabel = inferNativeLabel({
    structuredModel,
    arbitrationModel,
    policyLabel,
    archetypeValue,
    productType,
  });

  const labels = uniqueStrings([structuredModel, arbitrationModel, policyLabel, archetypeValue, productType]);
  const familySignals = labels.map((label) => familyFromLabel(label));
  const uniqueFamilies = uniqueStrings(familySignals);
  const familySignalCount = labels.length;

  const archetypeConfidence =
    typeof dio?.phase1?.business_archetype_v1?.confidence === "number" && Number.isFinite(dio.phase1.business_archetype_v1.confidence)
      ? clamp01(dio.phase1.business_archetype_v1.confidence)
      : null;
  const arbitrationConfidence =
    typeof dio?.phase1?.business_model_arbitration_v1?.confidence === "number" && Number.isFinite(dio.phase1.business_model_arbitration_v1.confidence)
      ? clamp01(dio.phase1.business_model_arbitration_v1.confidence)
      : null;

  const coverageScore = Math.min(1, familySignalCount / 4);
  const confidenceScore = clamp01(
    coverageScore * 0.55 +
      (archetypeConfidence ?? 0.5) * 0.25 +
      (arbitrationConfidence ?? 0.5) * 0.2
  );

  const isHybridByLabel = /\+|\band\b|\//i.test(nativeLabel);
  const isHybridByFamilies = uniqueFamilies.length >= 2;
  const isHybrid = isHybridByLabel || (isHybridByFamilies && confidenceScore >= 0.42);

  const { naicsCandidates, sicCandidates, bestFitLabel, expectations } = buildTaxonomyCandidates({
    familySignals: familySignals.length > 0 ? familySignals : [familyFromLabel(nativeLabel)],
    baseScore: confidenceScore,
  });

  const primaryFamily = familyFromLabel(nativeLabel);
  const policyFamily = familyFromLabel(policyLabel);
  const topTaxonomyFamily = familyFromLabel(bestFitLabel);
  const policyConflict =
    Boolean(selectedPolicyId) &&
    policyFamily !== "other" &&
    primaryFamily !== "other" &&
    policyFamily !== primaryFamily &&
    confidenceScore >= 0.5;
  const taxonomyConflict =
    topTaxonomyFamily !== "other" &&
    primaryFamily !== "other" &&
    topTaxonomyFamily !== primaryFamily &&
    confidenceScore >= 0.72;

  const classificationConflict = policyConflict || taxonomyConflict;
  const conflictReason = classificationConflict
    ? policyConflict
      ? `Policy-selected operating type (${policyLabel}) conflicts with document-native business description (${nativeLabel}).`
      : `Best-fit taxonomy category (${bestFitLabel}) diverges from document-native business description (${nativeLabel}).`
    : undefined;

  const classificationConfidence = confidenceFromScore(confidenceScore);
  const inferredDescription =
    classificationConfidence === "unknown"
      ? "Business type signal is currently too weak for reliable taxonomy mapping."
      : isHybrid
        ? "Business model appears hybrid; taxonomy is used only as directional context."
        : "Business type is inferred from product-native signals; taxonomy is applied as supporting context.";

  return {
    inferredLabel: nativeLabel,
    inferredDescription,
    naicsCandidates,
    sicCandidates,
    classificationConfidence,
    isHybrid,
    classificationConflict,
    conflictReason,
    bestFitLabel,
    industryExpectations: expectations,
  };
}
