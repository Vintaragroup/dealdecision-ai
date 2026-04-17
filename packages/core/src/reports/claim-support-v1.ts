/**
 * Claim Support V1 — Deterministic contract
 *
 * Derives per-category claim support status from existing governed artifacts:
 *   - conviction_v1.inputs (family-level signal / coverage / status)
 *   - conviction_v1.contradictions (mapped to category)
 *   - conviction_v1.top_positive/negative_contributors (evidence refs / labels)
 *   - report.challenge_pass.missing_evidence (maps evidence_type to category)
 *   - report.challenge_pass.diligence_gaps (category-tagged gap descriptions)
 *
 * No LLM, no free-form synthesis. Output is purely derived from deterministic fields.
 */

export type ClaimSupportCategory =
  | "market"
  | "product"
  | "financials"
  | "team"
  | "traction"
  | "capital_structure";

export type ClaimSupportStatus = "supported" | "incomplete" | "missing" | "contradicted";

export type ClaimSupportItemV1 = {
  claim: string;
  category: ClaimSupportCategory;
  status: ClaimSupportStatus;
  reasons: string[];
  evidence_refs: string[];
};

export type ClaimSupportV1 = {
  schema_version: "claim_support_v1";
  items: ClaimSupportItemV1[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_CLAIM_LABELS: Record<ClaimSupportCategory, string> = {
  market: "Market demand validated with defined ICP and distribution path",
  product: "Product and business model clearly defined",
  financials: "Financial performance evidenced with structured data",
  team: "Team execution capability demonstrated",
  traction: "Traction and growth trajectory substantiated",
  capital_structure: "Raise terms and capital structure transparent",
};

// Maps conviction_v1 input family keys to ClaimSupport categories.
const FAMILY_TO_CATEGORY: Partial<Record<string, ClaimSupportCategory>> = {
  financial_truth: "financials",
  capital_structure: "capital_structure",
  traction_validation: "traction",
  market_demand: "market",
  product_or_asset_quality: "product",
  team_execution: "team",
};

// Maps challenge_pass diligence_gap category strings to ClaimSupport categories.
const GAP_CATEGORY_MAP: Partial<Record<string, ClaimSupportCategory>> = {
  financial: "financials",
  team: "team",
  market: "market",
  product: "product",
  legal: "capital_structure",
};

// Family key for each category (reverse map for input lookup).
const FAMILY_KEY_FOR_CATEGORY: Record<ClaimSupportCategory, string> = {
  market: "market_demand",
  product: "product_or_asset_quality",
  financials: "financial_truth",
  team: "team_execution",
  traction: "traction_validation",
  capital_structure: "capital_structure",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const dedup = (xs: string[]): string[] => [...new Set(xs)];

// Strips machine-generated severity prefixes from conviction contradiction text.
const cleanContradictionText = (text: string): string =>
  text.replace(/^(high|medium|low|critical):\s*/i, "").trim();

// Returns true when a family note is a machine diagnostic code, not human-readable prose.
// Rejects: single tokens without spaces, key=value pairs, UNKNOWN_/CONTRADICTION_ strings.
const isMachineNote = (note: string): boolean => {
  const n = note.trim();
  if (!n.includes(" ")) return true;        // bare tokens: "no_founder", "headings", etc.
  if (/[a-z_]+=\d/.test(n)) return true;    // key=value metrics: "coverage_ratio=0.4"
  if (/^(UNKNOWN_|CONTRADICTION_|SUPPRESSED_)/i.test(n)) return true;
  return false;
};

// Maps challenge_pass challenge_factor codes to the categories most directly affected.
// Returns empty array for codes that are pipeline-mode flags (not claim issues).
// contradiction_cluster maps to [] intentionally — the contradicted status is already set from
// conviction_v1.contradictions, and financial_evidence_weak provides more specific deal-named text.
function challengeFactorCategories(code: string): ClaimSupportCategory[] {
  if (code === "financial_evidence_weak") return ["financials"];
  if (code === "fraud_signal") return ["financials", "capital_structure"];
  if (code === "ownership_mismatch") return ["capital_structure"];
  if (code === "team_mismatch") return ["team"];
  if (code === "traction_conflict") return ["traction"];
  return []; // contradiction_cluster, deterministic_only, and unknown codes don't add to reasons
}

// Fallback reason text used only when no human-readable reasons are available from other sources.
const CATEGORY_STATUS_FALLBACKS: Partial<Record<ClaimSupportCategory, Partial<Record<ClaimSupportStatus, string>>>> = {
  market: {
    missing: "No market validation found — addressable market and customer evidence absent",
    incomplete: "Market demand signal is weak — addressable market and ICP evidence insufficient",
    contradicted: "Market claims are internally inconsistent with available evidence",
  },
  product: {
    missing: "Product or business model not evidenced in submitted documents",
    incomplete: "Product clarity is partial — technical differentiation not established",
    contradicted: "Product claims are inconsistent with available evidence",
  },
  financials: {
    missing: "No structured financial data present in deal materials",
    incomplete: "Financial evidence is incomplete — key metrics unverified or absent",
    contradicted: "Financial claims contain internal contradictions",
  },
  team: {
    missing: "No founding team information found in deal materials",
    incomplete: "Team composition documented but execution track record not established",
    contradicted: "Team claims are inconsistent with verifiable information",
  },
  traction: {
    missing: "No traction evidence — customer or revenue growth data not present",
    incomplete: "Traction signal is limited — growth trajectory not sufficiently validated",
    contradicted: "Traction claims are inconsistent with available metrics",
  },
  capital_structure: {
    missing: "No cap table or raise terms provided",
    incomplete: "Capital structure partially documented — ownership terms incomplete",
    contradicted: "Capital structure claims are inconsistent",
  },
};

function deriveStatus(
  family: any,
  hasCategoryContradictions: boolean,
): ClaimSupportStatus {
  if (hasCategoryContradictions || family?.status === "contradicted") return "contradicted";
  const sig =
    typeof family?.signal_strength === "number" && Number.isFinite(family.signal_strength)
      ? family.signal_strength
      : 0;
  const cov =
    typeof family?.coverage === "number" && Number.isFinite(family.coverage)
      ? family.coverage
      : 0;
  if (sig < 0.3 && cov < 0.25) return "missing";
  if (sig >= 0.65 && cov >= 0.5) return "supported";
  return "incomplete";
}

// Map a contradiction code to the categories it most likely affects.
function contradictionCategories(code: string): ClaimSupportCategory[] {
  const cats: ClaimSupportCategory[] = [];
  if (code.includes("tam") || code.includes("market")) cats.push("market");
  if (code.includes("business_model") || code.includes("distribution")) cats.push("product");
  if (code.includes("revenue") || code.includes("forecast")) cats.push("financials", "traction");
  if (code.includes("growth")) cats.push("traction");
  if (code.includes("technical_lead") || code.includes("gtm_lead")) cats.push("team");
  return cats.length > 0 ? cats : ["financials"];
}

// Map a missing_evidence evidence_type string to a category.
function evidenceTypeToCategory(evType: string): ClaimSupportCategory {
  const t = evType.toLowerCase();
  if (t.includes("team") || t.includes("founder") || t.includes("linkedin")) return "team";
  if (t.includes("market") || t.includes("tam") || t.includes("icp")) return "market";
  if (t.includes("product") || t.includes("tech") || t.includes("business_model")) return "product";
  if (
    t.includes("cap_table") ||
    t.includes("cap table") ||
    t.includes("ownership") ||
    t.includes("equity")
  )
    return "capital_structure";
  if (t.includes("traction") || t.includes("customer") || t.includes("churn") || t.includes("nrr"))
    return "traction";
  return "financials";
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Derive claim_support_v1 items from an already-compiled report object.
 * Requires challenge_pass to already be attached (populated from deal_challenge_pass_results).
 * Returns null when conviction_v1 input families are absent (insufficient data to derive).
 */
export function buildClaimSupportV1(report: any): ClaimSupportV1 | null {
  const convictionV1 =
    report?.conviction_v1 ?? report?.structured_summary?.conviction_v1 ?? null;

  if (!convictionV1) return null;

  const inputs = convictionV1.inputs ?? null;
  const contradictions: any[] = Array.isArray(convictionV1.contradictions)
    ? convictionV1.contradictions
    : [];
  const posContribs: any[] = Array.isArray(convictionV1.top_positive_contributors)
    ? convictionV1.top_positive_contributors
    : [];
  // top_negative_contributors labels are family names (not useful as reasons); used only for evidence_refs in future passes.
  void convictionV1.top_negative_contributors;

  const challengePass = report?.challenge_pass ?? null;
  const missingEvidence: any[] = Array.isArray(challengePass?.missing_evidence)
    ? challengePass.missing_evidence
    : [];
  const diligenceGaps: any[] = Array.isArray(challengePass?.diligence_gaps)
    ? challengePass.diligence_gaps
    : [];
  const challengeFactors: any[] = Array.isArray(challengePass?.challenge_factors)
    ? challengePass.challenge_factors
    : [];

  // ── Build per-category indexes ────────────────────────────────────────────

  // challenge_factors: deal-specific, human-readable explanation text (highest priority).
  const challengeFactorsByCategory = new Map<ClaimSupportCategory, string[]>();
  for (const f of challengeFactors) {
    const explanation = asString(f?.explanation);
    if (!explanation) continue;
    for (const cat of challengeFactorCategories(asString(f?.code) ?? "")) {
      if (!challengeFactorsByCategory.has(cat)) challengeFactorsByCategory.set(cat, []);
      challengeFactorsByCategory.get(cat)!.push(explanation);
    }
  }

  const contradictionTextsByCategory = new Map<ClaimSupportCategory, string[]>();
  for (const c of contradictions) {
    const raw = asString(c?.text);
    if (!raw) continue;
    const text = cleanContradictionText(raw);
    if (!text) continue;
    const code = asString(c?.code) ?? "";
    for (const cat of contradictionCategories(code)) {
      if (!contradictionTextsByCategory.has(cat)) contradictionTextsByCategory.set(cat, []);
      contradictionTextsByCategory.get(cat)!.push(text);
    }
  }

  const missingReasonsByCategory = new Map<ClaimSupportCategory, string[]>();
  for (const m of missingEvidence) {
    const signal = asString(m?.description) ?? asString(m?.diligence_question);
    if (!signal) continue;
    const cat = evidenceTypeToCategory(asString(m?.evidence_type) ?? "");
    if (!missingReasonsByCategory.has(cat)) missingReasonsByCategory.set(cat, []);
    missingReasonsByCategory.get(cat)!.push(signal);
  }
  for (const gap of diligenceGaps) {
    const desc = asString(gap?.description);
    if (!desc) continue;
    const gapCatRaw = asString(gap?.category) ?? "";
    const cat: ClaimSupportCategory = GAP_CATEGORY_MAP[gapCatRaw] ?? "financials";
    if (!missingReasonsByCategory.has(cat)) missingReasonsByCategory.set(cat, []);
    missingReasonsByCategory.get(cat)!.push(desc);
  }

  const posRefsByCategory = new Map<ClaimSupportCategory, string[]>();
  for (const c of posContribs) {
    const key = asString(c?.key) ?? "";
    const cat = FAMILY_TO_CATEGORY[key];
    if (!cat) continue;
    const refs: string[] = Array.isArray(c?.evidence_refs)
      ? (c.evidence_refs as any[]).filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : [];
    if (!posRefsByCategory.has(cat)) posRefsByCategory.set(cat, []);
    posRefsByCategory.get(cat)!.push(...refs);
  }
  // Neg contributor labels are the family name (e.g. "Market Demand") — not useful as reasons.
  // negContribs is preserved for evidence_refs in posRefsByCategory above only.

  // ── Build items ───────────────────────────────────────────────────────────

  const categories: ClaimSupportCategory[] = [
    "market",
    "product",
    "financials",
    "team",
    "traction",
    "capital_structure",
  ];

  const items: ClaimSupportItemV1[] = [];

  for (const cat of categories) {
    const familyKey = FAMILY_KEY_FOR_CATEGORY[cat];
    const family = inputs ? (inputs as any)[familyKey] : null;
    const hasCatContradictions = contradictionTextsByCategory.has(cat);
    const hasMissing = missingReasonsByCategory.has(cat);

    // Skip categories with no signal at all.
    if (!family && !hasCatContradictions && !hasMissing) continue;

    const status = deriveStatus(family, hasCatContradictions);

    const reasons: string[] = [];
    // 1. Challenge factor explanations — deal-specific, human-readable, highest priority.
    for (const t of challengeFactorsByCategory.get(cat) ?? []) reasons.push(t);
    // 2. Contradiction texts (severity prefix stripped).
    for (const t of contradictionTextsByCategory.get(cat) ?? []) {
      if (!reasons.includes(t)) reasons.push(t);
    }
    // 3. Missing evidence / diligence gaps (only when not supported).
    if (status !== "supported") {
      for (const m of missingReasonsByCategory.get(cat) ?? []) reasons.push(m);
    }
    // 4. Input notes — machine diagnostic codes are excluded; only human-readable prose passes.
    const inputNotes: string[] = Array.isArray(family?.notes)
      ? (family.notes as any[]).filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0 && !isMachineNote(n.trim()),
        )
      : [];
    for (const n of inputNotes) if (!reasons.includes(n)) reasons.push(n);
    // 5. Fallback: when no human-readable reasons are available, use category+status description.
    if (reasons.length === 0) {
      const fallback = CATEGORY_STATUS_FALLBACKS[cat]?.[status];
      if (fallback) reasons.push(fallback);
    }

    const evidenceRefs: string[] = dedup([
      ...(Array.isArray(family?.evidence_refs)
        ? (family.evidence_refs as any[]).filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        : []),
      ...(posRefsByCategory.get(cat) ?? []),
    ]);

    items.push({
      claim: CATEGORY_CLAIM_LABELS[cat],
      category: cat,
      status,
      reasons: dedup(reasons).slice(0, 5),
      evidence_refs: evidenceRefs.slice(0, 6),
    });
  }

  return {
    schema_version: "claim_support_v1",
    items,
  };
}
