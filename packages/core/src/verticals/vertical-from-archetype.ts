import type { VerticalKey } from "./vertical-contracts";

export function verticalFromArchetypeKey(archetypeKey?: string | null): VerticalKey {
  const k = (archetypeKey ?? "").toLowerCase().trim();
  if (!k) return "other";

  // Explicit prefixes (highest confidence)
  if (k.startsWith("real_estate")) return "real_estate";
  if (k.startsWith("healthcare")) return "healthcare";
  if (k.startsWith("services")) return "services";
  if (k.startsWith("technology")) return "technology";
  if (k.startsWith("product")) return "product";

  // Fuzzy fallbacks (carefully scoped)
  if (k.includes("saas") || k.includes("software") || k.includes("compliance")) {
    return "technology";
  }

  if (k.includes("agency") || k.includes("consulting")) {
    return "services";
  }

  if (k.includes("realestate") || k.includes("development") || k.includes("multifamily")) {
    return "real_estate";
  }

  if (k.includes("consumer") || k.includes("ecommerce") || k.includes("cpg") || k.includes("apparel")) {
    return "product";
  }

  if (k.includes("health") || k.includes("medical") || k.includes("bio")) {
    return "healthcare";
  }

  console.warn(`[verticalFromArchetypeKey] Unmapped archetype key: ${archetypeKey}`);
  return "other";
}