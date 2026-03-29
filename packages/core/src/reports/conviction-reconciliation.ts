import type {
  ConvictionContradictionV1,
  ConvictionInputFamilyKeyV1,
  ConvictionInputFamilyV1,
  ConvictionInputsV1,
} from "../models/conviction-v1.js";

type EvidenceStrength = "strong" | "medium" | "weak" | "absent";

type FamilyEvidenceAssessment = {
  strength: EvidenceStrength;
  refs: string[];
  reason: string;
};

type ReconciliationDiagnostics =
  | "UNKNOWN_OVERRIDDEN_BY_EVIDENCE"
  | "CONTRADICTION_SUPPRESSED_BY_EVIDENCE"
  | "CONTRADICTION_DOWNGRADED_BY_EVIDENCE"
  | "LOW_PRIORITY_FLAG_DISCARDED"
  | "RECONCILED_TEAM_EXECUTION"
  | "RECONCILED_MARKET_DEMAND"
  | "RECONCILED_PRODUCT_QUALITY"
  | "RECONCILED_TRACTION_VALIDATION"
  | "RECONCILED_BUSINESS_MODEL";

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const uniqueStrings = (xs: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const containsSignal = (text: string, re: RegExp): boolean => re.test(text);

const isCleanEvidenceText = (raw: unknown): boolean => {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length < 18 || s.length > 360) return false;
  if (/[\uFFFD�]/.test(s)) return false;
  if (/[@#%^*_|`~]{3,}/.test(s)) return false;
  const compact = s.replace(/\s+/g, "");
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  if (compact.length <= 0) return false;
  const letterRatio = letters / compact.length;
  return letterRatio >= 0.5;
};

const asTextArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

const teamSignalCodes = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
      continue;
    }
    if (item && typeof item === "object" && typeof (item as any).code === "string") {
      const s = String((item as any).code).trim();
      if (s) out.push(s);
    }
  }
  return uniqueStrings(out);
};

const detectTechnicalRoleEvidence = (teamSignal: any): FamilyEvidenceAssessment => {
  const founderCount = typeof teamSignal?.founder_count === "number" ? teamSignal.founder_count : 0;
  const roleTechnical = Boolean(teamSignal?.key_roles_present?.technical);
  const signalCodes = teamSignalCodes(teamSignal?.signals).map((s) => s.toLowerCase());
  const hasTechCode = signalCodes.some((s) => /cto|chief[_\s-]?technology[_\s-]?officer|technical|engineering|architect/.test(s));
  const refs = uniqueStrings([]);

  if (roleTechnical && founderCount > 0) {
    return { strength: "strong", refs, reason: "technical_role_present_with_founders" };
  }
  if (roleTechnical || hasTechCode) {
    return { strength: "medium", refs, reason: "technical_role_signaled" };
  }
  return { strength: "absent", refs, reason: "no_technical_role_evidence" };
};

const detectGtmRoleEvidence = (teamSignal: any): FamilyEvidenceAssessment => {
  const founderCount = typeof teamSignal?.founder_count === "number" ? teamSignal.founder_count : 0;
  const roleGtm = Boolean(teamSignal?.key_roles_present?.gtm);
  const signalCodes = teamSignalCodes(teamSignal?.signals).map((s) => s.toLowerCase());
  const hasGtmCode = signalCodes.some((s) => /gtm|growth|sales|cro|marketing/.test(s));
  const refs = uniqueStrings([]);

  if (roleGtm && founderCount > 0) {
    return { strength: "strong", refs, reason: "gtm_role_present_with_founders" };
  }
  if (roleGtm || hasGtmCode) {
    return { strength: "medium", refs, reason: "gtm_role_signaled" };
  }
  return { strength: "absent", refs, reason: "no_gtm_role_evidence" };
};

const assessFamilyEvidenceStrength = (args: {
  familyInputs: ConvictionInputsV1;
  businessModelSignal: any;
  marketSignalModel: any;
  teamSignal: any;
  tractionSignalModel: any;
}): Record<"product" | "market" | "team" | "business_model" | "traction", FamilyEvidenceAssessment> => {
  const productStructured = [
    Boolean(args.businessModelSignal?.pricing_present),
    Boolean(args.businessModelSignal?.revenue_model_present),
    Boolean(args.businessModelSignal?.customer_segment_present),
  ].filter(Boolean).length;
  const productRefs = uniqueStrings(args.familyInputs.product_or_asset_quality.evidence_refs);
  const productTextNotes = asTextArray(args.businessModelSignal?.notes).filter(isCleanEvidenceText);
  const productStrength: EvidenceStrength =
    (productStructured >= 2 && productRefs.length > 0) || (productStructured >= 2 && productTextNotes.length > 0)
      ? "strong"
      : productStructured >= 1 || productRefs.length > 0
        ? "medium"
        : productTextNotes.length > 0
          ? "weak"
          : "absent";

  const marketStructured = [
    Boolean(args.marketSignalModel?.icp_defined),
    Boolean(args.marketSignalModel?.distribution_path_present),
    Boolean(args.marketSignalModel?.som_defined),
  ].filter(Boolean).length;
  const marketRefs = uniqueStrings(args.familyInputs.market_demand.evidence_refs);
  const marketStrength: EvidenceStrength =
    marketStructured >= 2 && marketRefs.length > 0
      ? "strong"
      : marketStructured >= 1 || marketRefs.length > 0
        ? "medium"
        : "absent";

  const founderCount = typeof args.teamSignal?.founder_count === "number" ? args.teamSignal.founder_count : 0;
  const teamStructured = [
    founderCount > 0,
    Boolean(args.teamSignal?.key_roles_present?.technical),
    Boolean(args.teamSignal?.key_roles_present?.gtm),
    Boolean(args.teamSignal?.domain_experience_present),
  ].filter(Boolean).length;
  const teamSignalText = teamSignalCodes(args.teamSignal?.signals).filter(isCleanEvidenceText);
  const teamStrength: EvidenceStrength =
    teamStructured >= 3
      ? "strong"
      : teamStructured >= 1 || teamSignalText.length > 0
        ? "medium"
        : "absent";

  const businessModelRefs = uniqueStrings(args.familyInputs.product_or_asset_quality.evidence_refs);
  const businessModelText = asTextArray(args.businessModelSignal?.notes).filter((s) => {
    if (!isCleanEvidenceText(s)) return false;
    return containsSignal(String(s).toLowerCase(), /saas|subscription|api|usage[-\s]?based|seat[-\s]?based|licens|marketplace/i);
  });
  const businessModelStrength: EvidenceStrength =
    (Boolean(args.businessModelSignal?.revenue_model_present) || Boolean(args.businessModelSignal?.pricing_present))
      && (businessModelRefs.length > 0 || businessModelText.length > 0)
      ? "strong"
      : Boolean(args.businessModelSignal?.revenue_model_present)
        || Boolean(args.businessModelSignal?.pricing_present)
        || businessModelText.length > 0
          ? "medium"
          : "absent";

  const tractionStructured = [
    Boolean(args.tractionSignalModel?.historical_revenue_present),
    Boolean(args.tractionSignalModel?.customer_evidence_present),
    Boolean(args.tractionSignalModel?.growth_signal_present),
  ].filter(Boolean).length;
  const tractionRefs = uniqueStrings(args.familyInputs.traction_validation.evidence_refs);
  const tractionStrength: EvidenceStrength =
    tractionStructured >= 2 && tractionRefs.length > 0
      ? "strong"
      : tractionStructured >= 1 || tractionRefs.length > 0
        ? "medium"
        : "absent";

  return {
    product: {
      strength: productStrength,
      refs: productRefs,
      reason: `product_structured=${productStructured},refs=${productRefs.length}`,
    },
    market: {
      strength: marketStrength,
      refs: marketRefs,
      reason: `market_structured=${marketStructured},refs=${marketRefs.length}`,
    },
    team: {
      strength: teamStrength,
      refs: uniqueStrings(args.familyInputs.team_execution.evidence_refs),
      reason: `team_structured=${teamStructured}`,
    },
    business_model: {
      strength: businessModelStrength,
      refs: businessModelRefs,
      reason: `model_refs=${businessModelRefs.length},model_notes=${businessModelText.length}`,
    },
    traction: {
      strength: tractionStrength,
      refs: tractionRefs,
      reason: `traction_structured=${tractionStructured},refs=${tractionRefs.length}`,
    },
  };
};

const isStrongOrMedium = (s: EvidenceStrength): boolean => s === "strong" || s === "medium";

const withFamilyReconciled = (
  input: ConvictionInputFamilyV1,
  mode: EvidenceStrength,
  evidenceRefs: string[],
  note: string,
): ConvictionInputFamilyV1 => {
  const nextStatus: ConvictionInputFamilyV1["status"] = mode === "strong" ? "confirmed" : "probable";
  return {
    ...input,
    status: input.status === "unknown" ? nextStatus : input.status,
    signal_strength: Math.max(input.signal_strength, mode === "strong" ? 0.76 : 0.56),
    confidence: Math.max(input.confidence, mode === "strong" ? 0.72 : 0.58),
    coverage: Math.max(input.coverage, mode === "strong" ? 0.64 : 0.50),
    source_priority: Math.min(input.source_priority, mode === "strong" ? 2 : 3),
    evidence_refs: uniqueStrings([...input.evidence_refs, ...evidenceRefs]),
    notes: uniqueStrings([...input.notes, note]),
  };
};

export function reconcileConvictionTruthV1(args: {
  familyInputs: ConvictionInputsV1;
  contradictions: ConvictionContradictionV1[];
  missingInputs: string[];
  businessModelSignal: any;
  marketSignalModel: any;
  teamSignal: any;
  tractionSignalModel: any;
}): {
  familyInputs: ConvictionInputsV1;
  contradictions: ConvictionContradictionV1[];
  missingInputs: string[];
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const familyInputs: ConvictionInputsV1 = { ...args.familyInputs };
  const evidence = assessFamilyEvidenceStrength({
    familyInputs,
    businessModelSignal: args.businessModelSignal,
    marketSignalModel: args.marketSignalModel,
    teamSignal: args.teamSignal,
    tractionSignalModel: args.tractionSignalModel,
  });

  // Source priority rule:
  // explicit structured/extracted evidence (high/medium priority) must override
  // fallback unknown/negative assumptions (lowest priority).
  if (familyInputs.product_or_asset_quality.status === "unknown" && isStrongOrMedium(evidence.product.strength)) {
    familyInputs.product_or_asset_quality = withFamilyReconciled(
      familyInputs.product_or_asset_quality,
      evidence.product.strength,
      evidence.product.refs,
      `UNKNOWN_OVERRIDDEN_BY_EVIDENCE:product_or_asset_quality:${evidence.product.reason}`,
    );
    diagnostics.push("UNKNOWN_OVERRIDDEN_BY_EVIDENCE:product_or_asset_quality");
    diagnostics.push("RECONCILED_PRODUCT_QUALITY");
  }

  if (familyInputs.market_demand.status === "unknown" && isStrongOrMedium(evidence.market.strength)) {
    familyInputs.market_demand = withFamilyReconciled(
      familyInputs.market_demand,
      evidence.market.strength,
      evidence.market.refs,
      `UNKNOWN_OVERRIDDEN_BY_EVIDENCE:market_demand:${evidence.market.reason}`,
    );
    diagnostics.push("UNKNOWN_OVERRIDDEN_BY_EVIDENCE:market_demand");
    diagnostics.push("RECONCILED_MARKET_DEMAND");
  }

  if (familyInputs.team_execution.status === "unknown" && isStrongOrMedium(evidence.team.strength)) {
    familyInputs.team_execution = withFamilyReconciled(
      familyInputs.team_execution,
      evidence.team.strength,
      evidence.team.refs,
      `UNKNOWN_OVERRIDDEN_BY_EVIDENCE:team_execution:${evidence.team.reason}`,
    );
    diagnostics.push("UNKNOWN_OVERRIDDEN_BY_EVIDENCE:team_execution");
    diagnostics.push("RECONCILED_TEAM_EXECUTION");
  }

  if (familyInputs.product_or_asset_quality.status === "unknown" && isStrongOrMedium(evidence.business_model.strength)) {
    familyInputs.product_or_asset_quality = withFamilyReconciled(
      familyInputs.product_or_asset_quality,
      evidence.business_model.strength,
      evidence.business_model.refs,
      `UNKNOWN_OVERRIDDEN_BY_EVIDENCE:business_model:${evidence.business_model.reason}`,
    );
    diagnostics.push("UNKNOWN_OVERRIDDEN_BY_EVIDENCE:business_model");
    diagnostics.push("RECONCILED_BUSINESS_MODEL");
  }

  if (familyInputs.traction_validation.status === "unknown" && isStrongOrMedium(evidence.traction.strength)) {
    familyInputs.traction_validation = withFamilyReconciled(
      familyInputs.traction_validation,
      evidence.traction.strength,
      evidence.traction.refs,
      `UNKNOWN_OVERRIDDEN_BY_EVIDENCE:traction_validation:${evidence.traction.reason}`,
    );
    diagnostics.push("UNKNOWN_OVERRIDDEN_BY_EVIDENCE:traction_validation");
    diagnostics.push("RECONCILED_TRACTION_VALIDATION");
  }

  const coreStrongOrMedium = [
    evidence.product.strength,
    evidence.market.strength,
    evidence.team.strength,
    evidence.business_model.strength,
  ].filter(isStrongOrMedium).length;

  if (coreStrongOrMedium >= 3) {
    const coreFamilyKeys: ConvictionInputFamilyKeyV1[] = [
      "product_or_asset_quality",
      "market_demand",
      "team_execution",
    ];
    for (const key of coreFamilyKeys) {
      const f = familyInputs[key];
      if (f.status !== "unknown") continue;
      if (f.signal_strength < 0.30) continue;
      familyInputs[key] = {
        ...f,
        status: "probable",
        confidence: Math.max(f.confidence, 0.52),
        coverage: Math.max(f.coverage, 0.45),
        notes: uniqueStrings([...f.notes, "LOW_PRIORITY_FLAG_DISCARDED:min_plausibility_guard"]),
      };
      diagnostics.push("LOW_PRIORITY_FLAG_DISCARDED:min_plausibility_guard");
    }
  }

  const technicalEvidence = detectTechnicalRoleEvidence(args.teamSignal);
  const gtmEvidence = detectGtmRoleEvidence(args.teamSignal);
  const marketHasExplicitEvidence = isStrongOrMedium(evidence.market.strength);
  const tractionHasEvidence = isStrongOrMedium(evidence.traction.strength);
  const businessModelHasEvidence = isStrongOrMedium(evidence.business_model.strength);

  const reconciledContradictions: ConvictionContradictionV1[] = [];
  for (const c of args.contradictions) {
    const textLc = String(c.text ?? "").toLowerCase();
    const code = String(c.code ?? "");

    const isNoTechLead = code === "no_technical_lead" || /no[_\s-]?technical[_\s-]?lead|no\s+cto/.test(textLc);
    const isNoGtmLead = code === "no_gtm_lead" || /no[_\s-]?gtm[_\s-]?lead|no\s+(cro|head\s+of\s+growth|gtm\s+lead)/.test(textLc);
    const isMarketUnclear = code === "tam_without_icp" || code === "tam_without_distribution" || /market\s+unclear|icp\s+unclear|no\s+distribution\s+path/.test(textLc);
    const isTractionMismatch = code === "tam_without_traction" || code === "forecast_without_history" || /without\s+history/.test(textLc);
    const isBusinessModelAbsent = code === "business_model_absent" || /business\s+model\s+absent/.test(textLc);

    if (isNoTechLead && isStrongOrMedium(technicalEvidence.strength)) {
      diagnostics.push(`CONTRADICTION_SUPPRESSED_BY_EVIDENCE:${code || "no_technical_lead"}`);
      continue;
    }
    if (isNoGtmLead && isStrongOrMedium(gtmEvidence.strength)) {
      diagnostics.push(`CONTRADICTION_SUPPRESSED_BY_EVIDENCE:${code || "no_gtm_lead"}`);
      continue;
    }
    if (isMarketUnclear && marketHasExplicitEvidence) {
      diagnostics.push(`CONTRADICTION_SUPPRESSED_BY_EVIDENCE:${code || "market_unclear"}`);
      continue;
    }
    if (isTractionMismatch && tractionHasEvidence) {
      if (evidence.traction.strength === "strong") {
        diagnostics.push(`CONTRADICTION_SUPPRESSED_BY_EVIDENCE:${code || "traction_mismatch"}`);
        continue;
      }
      diagnostics.push(`CONTRADICTION_DOWNGRADED_BY_EVIDENCE:${code || "traction_mismatch"}`);
      reconciledContradictions.push({ ...c, severity: "low", source: `${c.source}|reconciled_traction` });
      continue;
    }
    if (isBusinessModelAbsent && businessModelHasEvidence) {
      diagnostics.push(`CONTRADICTION_SUPPRESSED_BY_EVIDENCE:${code || "business_model_absent"}`);
      continue;
    }

    reconciledContradictions.push(c);
  }

  const contradictionsSignalStrength = clamp01(
    reconciledContradictions.reduce((sum, c) => {
      const w = c.severity === "high" ? 1 : c.severity === "medium" ? 0.65 : 0.35;
      return sum + w;
    }, 0) / 4,
  );

  familyInputs.contradictions = {
    ...familyInputs.contradictions,
    status: reconciledContradictions.length > 0 ? "contradicted" : "probable",
    signal_strength: contradictionsSignalStrength,
    coverage: clamp01(reconciledContradictions.length > 0 ? 0.85 : 0.2),
    evidence_refs: uniqueStrings(reconciledContradictions.flatMap((c) => c.evidence_refs)),
    notes: uniqueStrings([
      ...familyInputs.contradictions.notes,
      ...diagnostics.filter((d) => d.includes("CONTRADICTION_") || d.includes("LOW_PRIORITY_FLAG_DISCARDED")),
    ]),
  };

  const reconciledMissingInputs = args.missingInputs.filter((code) => {
    const c = String(code).toLowerCase();
    const shouldDrop =
      ((c.includes("product") || c.includes("asset") || c.includes("business_model")) && isStrongOrMedium(evidence.product.strength))
      || ((c.includes("market") || c.includes("icp") || c.includes("som") || c.includes("distribution")) && isStrongOrMedium(evidence.market.strength))
      || ((c.includes("team") || c.includes("technical") || c.includes("gtm")) && isStrongOrMedium(evidence.team.strength))
      || ((c.includes("traction") || c.includes("revenue")) && isStrongOrMedium(evidence.traction.strength));
    if (shouldDrop) diagnostics.push(`LOW_PRIORITY_FLAG_DISCARDED:missing_input:${code}`);
    return !shouldDrop;
  });

  return {
    familyInputs,
    contradictions: reconciledContradictions,
    missingInputs: uniqueStrings(reconciledMissingInputs),
    diagnostics: uniqueStrings(diagnostics),
  };
}
