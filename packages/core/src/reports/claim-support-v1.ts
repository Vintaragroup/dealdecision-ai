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
  traction: "traction",
  legal: "capital_structure",
  capital_structure: "capital_structure",
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
  if (code === "market_evidence_weak") return ["market"];
  if (code === "product_gap") return ["product"];
  if (code === "revenue_conflict") return ["financials", "traction"];
  if (code === "growth_conflict") return ["traction"];
  return []; // contradiction_cluster, deterministic_only, and unknown codes don't add to reasons
}

// Fallback reason text used only when no human-readable reasons are available from other sources.
const CATEGORY_STATUS_FALLBACKS: Partial<Record<ClaimSupportCategory, Partial<Record<ClaimSupportStatus, string>>>> = {
  market: {
    supported: "Market validation evidenced — ICP definition, addressable market sizing, and demand signals are present",
    missing: "No market validation data present — ICP definition, TAM/SAM sizing, and validated customer segment not evidenced",
    incomplete: "Market validation is partial — addressable market definition and customer segment validation not fully documented",
    contradicted: "Market sizing or ICP claims are inconsistent across submitted materials",
  },
  product: {
    supported: "Product evidence present — business model, technical differentiation, or validated deployment is documented",
    missing: "No product evidence present — demo, pilot, or proof-of-concept documentation not submitted",
    incomplete: "Product documentation is partial — technical differentiation and use-case validation not established",
    contradicted: "Product or business model claims are inconsistent with available evidence",
  },
  financials: {
    supported: "Financial performance evidenced — structured financial data is present with sufficient completeness and signal quality",
    missing: "No structured financial data present in deal materials",
    incomplete: "Financial evidence is incomplete — key metrics unverified or absent",
    contradicted: "Financial claims contain internal contradictions",
  },
  team: {
    supported: "Team execution credentials documented — founding team background and relevant domain experience are present",
    missing: "No founder or team profiles present — backgrounds, prior exits, and execution track record not documented",
    incomplete: "Team composition documented but execution credentials and domain track record not fully established",
    contradicted: "Team composition claims are inconsistent with verifiable information",
  },
  traction: {
    supported: "Traction validated — customer metrics, revenue evidence, and growth trajectory are documented",
    missing: "No customer traction data present — MRR/ARR history, cohort retention, and customer contracts not evidenced",
    incomplete: "Traction evidence is limited — customer metrics, MRR history, and growth trajectory not fully validated",
    contradicted: "Traction claims are inconsistent with available revenue or growth data",
  },
  capital_structure: {
    supported: "Capital structure transparent — raise terms, ownership percentages, and instrument type are documented",
    missing: "No ownership or raise terms documented — cap table, instrument type, and option pool not provided",
    incomplete: "Capital structure partially documented — instrument terms or ownership percentages incomplete",
    contradicted: "Ownership or raise structure claims are internally inconsistent",
  },
};

// Known positive conviction family note codes → human-readable positive reason text.
// These are unambiguously positive signals emitted by the conviction engine as machine codes;
// isMachineNote() correctly strips them from general note processing (single-token, no spaces),
// but they carry concrete evidence information that should surface as supplementary reasons for
// supported and incomplete items. Only includes genuinely positive structural evidence codes.
const POSITIVE_FAMILY_NOTE_TEXT: Record<string, string> = {
  xlsx_present: "Structured XLSX financial model present and incorporated into evidence analysis",
  xlsx_evidence_used: "Structured financial model data confirmed and used in scoring",
  sec_filing_present: "Regulatory or SEC filing detected as verified financial evidence source",
};

// Specific missing-evidence descriptions for conviction families with zero signal (sig=0, cov=0).
// These are more action-oriented than CATEGORY_STATUS_FALLBACKS and name the exact evidence needed.
// Only fires for completely absent families (not merely weak ones) and only when
// challenge_pass.missing_evidence has not already generated items for the category.
const FAMILY_ABSENT_GAP_TEXT: Partial<Record<ClaimSupportCategory, string>> = {
  market:
    "No market validation evidence found — provide ICP definition with TAM/SAM sizing methodology and at least one validated customer segment",
  product:
    "No product evidence present — provide product demo, pilot results, or technical proof-of-concept documentation",
  traction:
    "No customer or revenue traction evidence found — provide MRR/ARR schedule, customer cohort data, or signed LOIs",
  capital_structure:
    "No ownership documentation found — provide cap table with ownership percentages, instrument type, and option pool details",
  team:
    "No founder evidence found — provide founder profiles with execution history and LinkedIn or equivalent verification",
};

// Specific incomplete-evidence descriptions for conviction families with weak but present signal.
// Fires when status would be "incomplete" (some conviction signal exists but below validated threshold)
// and challenge_pass has not already generated items for the category.
// More actionable than CATEGORY_STATUS_FALLBACKS for the "described but unvalidated" case.
const WEAK_PRESENCE_GAP_TEXT: Partial<Record<ClaimSupportCategory, string>> = {
  market:
    "Market narrative or sizing claimed but customer ICP definition, competitive positioning, and demand validation not documented",
  product:
    "Product described but no demo, pilot results, or proof-of-concept documentation submitted",
  traction:
    "Revenue or growth signals detected but cohort retention, customer count trajectory, and contract evidence not verified",
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
    typeof family?.coverage === "number" && !Number.isNaN(family.coverage)
      ? family.coverage
      : 0;
  if (sig < 0.3 && cov < 0.25) return "missing";
  if (sig >= 0.65 && cov >= 0.5) return "supported";
  return "incomplete";
}

// Human-readable text for machine-code contradiction notes in conviction_v1.inputs.contradictions.notes.
// Only codes with entries here will be processed as supplementary contradiction signals.
const CONTRADICTION_NOTE_TO_TEXT: Record<string, string> = {
  no_technical_lead: "Technical leadership role not evidenced in founding team",
  no_founder: "No identifiable founder documented in submitted materials",
  no_gtm_lead: "Go-to-market leadership not identified in deal documents",
};

// Contradiction codes that represent deal-level risk flags, not claim-level contradictions.
// These appear in conviction_v1.contradictions but should not contaminate category tracking —
// they are surfaced separately via challenge_factors and risk_assessment components.
const RISK_ONLY_CONTRADICTION_CODES = new Set([
  "red_flag_risk_assessment",
]);

// Map a contradiction code to the categories it most likely affects.
function contradictionCategories(code: string): ClaimSupportCategory[] {
  // Risk-only codes are deal-level flags, not per-category claim contradictions.
  if (RISK_ONLY_CONTRADICTION_CODES.has(code)) return [];
  const cats: ClaimSupportCategory[] = [];
  if (code.includes("tam") || code.includes("market") || code.includes("addressable")) cats.push("market");
  if (code.includes("business_model") || code.includes("distribution") || code.includes("product_gap")) cats.push("product");
  if (code.includes("revenue") || code.includes("forecast") || code.includes("financial") || code.includes("fraud")) cats.push("financials");
  if (code.includes("revenue") || code.includes("forecast") || code.includes("growth") || code.includes("traction") || code.includes("customer_claims")) cats.push("traction");
  if (code.includes("technical_lead") || code.includes("gtm_lead") || code.includes("no_founder") || code.includes("team_mismatch") || code.includes("founder_mismatch")) cats.push("team");
  if (code.includes("cap_table") || code.includes("equity") || code.includes("ownership")) cats.push("capital_structure");
  return cats.length > 0 ? (dedup(cats) as ClaimSupportCategory[]) : ["financials"];
}

// Map a missing_evidence evidence_type string to a category.
function evidenceTypeToCategory(evType: string): ClaimSupportCategory {
  const t = evType.toLowerCase();
  if (t.includes("team") || t.includes("founder") || t.includes("linkedin") || t.includes("executive")) return "team";
  if (t.includes("market") || t.includes("tam") || t.includes("icp") || t.includes("addressable") || t.includes("segment")) return "market";
  if (t.includes("product") || t.includes("tech") || t.includes("business_model") || t.includes("demo") || t.includes("poc") || t.includes("roadmap")) return "product";
  if (
    t.includes("cap_table") ||
    t.includes("cap table") ||
    t.includes("ownership") ||
    t.includes("equity") ||
    t.includes("dilution") ||
    t.includes("warrant")
  )
    return "capital_structure";
  if (t.includes("traction") || t.includes("customer") || t.includes("churn") || t.includes("nrr") || t.includes("pipeline") || t.includes("dau") || t.includes("mau") || t.includes("mrr") || t.includes("retention")) return "traction";
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

  // Supplement with conviction_v1.inputs.contradictions.notes when the contradictions
  // family itself is marked as contradicted — these notes carry confirmed contradiction codes
  // (e.g. no_technical_lead) that map to categories not covered by the formal contradictions array.
  const contradictionFamilyStatus = asString((inputs as any)?.contradictions?.status);
  if (contradictionFamilyStatus === "contradicted") {
    const formalCodes = new Set(contradictions.map((c) => asString(c?.code)).filter(Boolean));
    const contradictionFamilyNotes: string[] = Array.isArray((inputs as any)?.contradictions?.notes)
      ? ((inputs as any).contradictions.notes as any[]).filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0,
        )
      : [];
    for (const noteCode of contradictionFamilyNotes) {
      if (formalCodes.has(noteCode)) continue; // already handled via formal contradictions array
      const humanText = CONTRADICTION_NOTE_TO_TEXT[noteCode];
      if (!humanText) continue; // skip unrecognized machine codes
      for (const cat of contradictionCategories(noteCode)) {
        if (!contradictionTextsByCategory.has(cat)) contradictionTextsByCategory.set(cat, []);
        const existing = contradictionTextsByCategory.get(cat)!;
        if (!existing.includes(humanText)) existing.push(humanText);
      }
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

  // ── Conviction-family derived gaps ───────────────────────────────────────
  // For non-financial categories where challenge_pass generates no missing_evidence items,
  // derive specific action-oriented gap descriptions from conviction family signals.
  // Only fires for completely absent families (signal_strength === 0 AND coverage === 0).
  // This supplements fallback text with more specific diligence guidance.
  if (inputs) {
    for (const [catStr, gapText] of Object.entries(FAMILY_ABSENT_GAP_TEXT)) {
      const cat = catStr as ClaimSupportCategory;
      if (missingReasonsByCategory.has(cat)) continue; // challenge_pass already covers this category
      const familyKey = FAMILY_KEY_FOR_CATEGORY[cat];
      const family = (inputs as any)[familyKey];
      if (!family) continue;
      const sig = typeof family.signal_strength === "number" ? family.signal_strength : 1;
      const cov = typeof family.coverage === "number" ? family.coverage : 1;
      // Only the truly absent case (both zero) — not just weak signal
      if (sig === 0 && cov === 0) {
        missingReasonsByCategory.set(cat, [gapText]);
      }
    }
  }

  // ── Weak-but-present conviction-family gap supplement ─────────────────────
  // For categories where challenge_pass generated no items AND the conviction family has some
  // signal but is below the "validated" threshold — derives actionable incomplete-evidence text.
  // Fires only when status would be "incomplete" (some conviction signal, not fully absent, not supported).
  // Complements FAMILY_ABSENT_GAP_TEXT: that handles sig=0/cov=0, this handles the weak-present range.
  if (inputs) {
    for (const [catStr, gapText] of Object.entries(WEAK_PRESENCE_GAP_TEXT)) {
      const cat = catStr as ClaimSupportCategory;
      if (missingReasonsByCategory.has(cat)) continue; // challenge_pass or FAMILY_ABSENT_GAP_TEXT already covers this
      const familyKey = FAMILY_KEY_FOR_CATEGORY[cat];
      const family = (inputs as any)[familyKey];
      if (!family) continue;
      const hasCatContradictions = contradictionTextsByCategory.has(cat);
      const familyStatus = deriveStatus(family, hasCatContradictions);
      if (familyStatus === "incomplete") {
        missingReasonsByCategory.set(cat, [gapText]);
      }
    }
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

    let status = deriveStatus(family, hasCatContradictions);

    // Guard: downgrade "supported" → "incomplete" when challenge_pass has missing items for
    // this category. Conviction signal quality (supported) and data completeness are separate
    // dimensions: high conviction signal means evidence is credible; missing challenge_pass items
    // mean specific required data points are absent or unextractable. Never claim support when
    // the challenge pass found gaps (e.g. XLSX present but ARR/burn/runway unextracted).
    if (status === "supported" && missingReasonsByCategory.has(cat)) {
      status = "incomplete";
    }

    const reasons: string[] = [];
    // 1. Challenge factor explanations — deal-specific, human-readable, highest priority.
    //    Only added for non-supported items: challenge factors are negative signals.
    if (status !== "supported") {
      for (const t of challengeFactorsByCategory.get(cat) ?? []) reasons.push(t);
    }
    // 2. Contradiction texts (severity prefix stripped).
    for (const t of contradictionTextsByCategory.get(cat) ?? []) {
      if (!reasons.includes(t)) reasons.push(t);
    }
    // 2.5: Positive evidence notes — decoded before missing evidence so they appear as context
    // for what IS present (e.g. "XLSX present") alongside what is missing. Applied to supported
    // and incomplete items. Not applied to contradicted: the contradiction is the primary signal.
    // Placed before missing evidence so the "what exists" context comes before the gap list.
    if (status === "supported" || status === "incomplete") {
      const familyNotes: string[] = Array.isArray(family?.notes)
        ? (family.notes as any[]).filter((n): n is string => typeof n === "string")
        : [];
      for (const note of familyNotes) {
        const positiveText = POSITIVE_FAMILY_NOTE_TEXT[note.trim()];
        if (positiveText && !reasons.includes(positiveText)) reasons.push(positiveText);
      }
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
