export type PolicyFamily = "startup" | "real_estate" | "fund" | "other";

function normalizePolicyId(policyId: string | null | undefined): string {
  return typeof policyId === "string" ? policyId.trim().toLowerCase() : "";
}

export function getPolicyFamily(policyId: string | null | undefined): PolicyFamily {
  const pid = normalizePolicyId(policyId);
  if (!pid) return "other";
  if (pid === "real_estate_underwriting" || pid.includes("real_estate")) return "real_estate";
  if (pid === "fund_spv" || pid.includes("fund") || pid.includes("spv")) return "fund";
  if (
    pid === "startup_raise" ||
    pid === "operating_startup_revenue_v1" ||
    pid === "enterprise_saas_b2b_v1" ||
    pid === "consumer_ecommerce_brand_v1" ||
    pid === "consumer_fintech_platform_v1" ||
    pid === "healthcare_biotech_v1" ||
    pid === "media_entertainment_ip_v1" ||
    pid === "physical_product_cpg_spirits_v1"
  ) {
    return "startup";
  }
  return "other";
}

export function isStartupPolicyId(policyId: string | null | undefined): boolean {
  return getPolicyFamily(policyId) === "startup";
}

export function isRealEstatePolicyId(policyId: string | null | undefined): boolean {
  return getPolicyFamily(policyId) === "real_estate";
}

export function isFundPolicyId(policyId: string | null | undefined): boolean {
  return getPolicyFamily(policyId) === "fund";
}

export function getPolicyScoreSectionLabel(
  policyId: string | null | undefined,
  key: string,
): string {
  const family = getPolicyFamily(policyId);
  const k = String(key || "").trim().toLowerCase();

  if (family === "real_estate") {
    if (k === "traction") return "Underwriting metrics";
    if (k === "business_model") return "Deal structure";
    if (k === "market") return "Submarket / demand";
  }

  if (family === "fund") {
    if (k === "traction") return "Portfolio construction";
    if (k === "business_model") return "Fund strategy";
    if (k === "market") return "Target allocation";
  }

  if (k === "business_model") return "Business model";
  if (k === "traction") return "Traction";
  if (k === "market") return "Market";
  if (k === "product") return "Product";
  if (k === "team") return "Team";
  if (k === "risks") return "Risks";
  if (k === "icp") return "ICP";
  return key;
}

export function toPolicyAwareBusinessModelDisplay(input: {
  policyId: string | null | undefined;
  rawLabel: string | null;
  hasRealEstateSignals?: boolean;
  hasFundSignals?: boolean;
  isPreferredEquity?: boolean;
}): { display: string | null; suppressedReasons: string[] } {
  const family = getPolicyFamily(input.policyId);
  const label = typeof input.rawLabel === "string" ? input.rawLabel.trim() : "";
  const suppressedReasons: string[] = [];

  if (family === "real_estate" || input.hasRealEstateSignals) {
    if (label && /omnichannel|dtc|wholesale|retail|consumer/i.test(label)) {
      suppressedReasons.push("startup_channel_label_suppressed_for_real_estate");
    }
    if (input.isPreferredEquity) return { display: "Real estate investment (preferred equity)", suppressedReasons };
    return { display: "Real estate structured investment", suppressedReasons };
  }

  if (family === "fund" || input.hasFundSignals) {
    if (label && /omnichannel|dtc|wholesale|retail|consumer|saas/i.test(label)) {
      suppressedReasons.push("startup_operating_label_suppressed_for_fund");
    }
    return { display: "Fund / SPV investment vehicle", suppressedReasons };
  }

  return { display: label || null, suppressedReasons };
}
