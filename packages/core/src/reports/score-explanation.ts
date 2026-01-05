import type { DealIntelligenceObject, ScoringDiagnosticsV1 } from "../types/dio.js";
import { getDealPolicy } from "../classification/deal-policy-registry";
import { getSelectedPolicyIdFromAny } from "../classification/get-selected-policy-id";
import { detectRealEstateUnderwritingProtections } from "../analyzers/risk-assessment";

export type ScoreExplainExcludedReason = "status_not_ok" | "null_score" | "doc_type_excluded";

export type ScoreExplanation = {
  context: DealIntelligenceObject["dio_context"];
  aggregation: {
    method: "weighted_mean";
    policy_id: string | null;
    weights: {
      slide_sequence: number;
      metric_benchmark: number;
      visual_design: number;
      narrative_arc: number;
      financial_health: number;
      risk_assessment: number;
    };
    included_components: string[];
    excluded_components: Array<{ component: string; reason: ScoreExplainExcludedReason }>;
  };
  components: {
    slide_sequence: ScoreComponent;
    metric_benchmark: ScoreComponent;
    visual_design: ScoreComponent;
    narrative_arc: ScoreComponent;
    financial_health: ScoreComponent;
    risk_assessment: ScoreComponent & {
      inverted_investment_score: number | null;
    };
  };
  totals: {
    overall_score: number | null;
    unadjusted_overall_score: number | null;
    coverage_ratio: number;
    confidence_score: number;
    evidence_factor: number;
    due_diligence_factor: number;
    adjustment_factor: number;
  };
};

export type ScoreComponent = {
  status: string | null;
  used_score: number | null;
  penalty: number;
  reason: string;
  reasons: string[];
  evidence_ids: string[];
  gaps: string[];
  red_flags: string[];
  coverage: number | null;
  confidence: number | null;
  raw_score: number | null;
  weighted_contribution: number | null;
  notes: string[];
  debug_ref?: string;
};

const PENALTY_MISSING = 8;
const PENALTY_NON_OK = 6;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];

const uniqueStrings = (xs: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const s = x.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const normalizeKey = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

type RubricEval = {
  id: string;
  required_signals: string[];
  missing_required: string[];
  positive_drivers_present: string[];
  acceptable_missing_present: string[];
  red_flags_triggered: string[];
  has_revenue_metric: boolean;
};

const getNormalizedPresenceSetForRubric = (dio: DealIntelligenceObject): Set<string> => {
  const classification = getDealClassificationV1Any(dio as any);
  const selectedSignalsRaw: string[] = asStringArray(classification?.selected?.signals);
  const selectedSignals = selectedSignalsRaw.map(normalizeKey);

  const mbMetrics: string[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
    ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
        .map((m: any) => (typeof m?.metric === "string" ? m.metric : ""))
        .filter(Boolean)
    : [];

  const mbMetricKeys = mbMetrics.map(normalizeKey);
  const extractedInputMetricKeys = getExtractedMetricKeysFromInputs(dio).map(normalizeKey);

  const present = new Set<string>([...selectedSignals, ...mbMetricKeys, ...extractedInputMetricKeys]);

  // Map KPI presence to rubric readiness signals.
  if (present.has("loi_count") || present.has("contract_value")) present.add("loi_or_contract");
  if (present.has("partnership_count") || present.has("distribution_partners")) present.add("partnership_or_distribution");
  if (present.has("launch_timeline_months")) present.add("launch_timeline");
  if (present.has("manufacturing_capacity") || selectedSignals.includes("manufacturing_ready")) present.add("product_ready");
  if (selectedSignals.includes("product_ready")) present.add("product_ready");

  // Ecommerce mapping: treat common unit economics KPIs as "unit_economics".
  if (present.has("ltv_to_cac") || present.has("ltv") || present.has("cac") || present.has("roas")) {
    present.add("unit_economics");
  }
  if (present.has("gross_margin_pct") || present.has("contribution_margin_pct")) {
    present.add("gross_margin_or_unit_economics");
    present.add("unit_economics");
  }
  // Operational control signals for ecommerce (repeat purchase / cohorts / conversion tracking).
  if (present.has("repeat_purchase_rate") || present.has("conversion_rate") || present.has("cohort")) {
    present.add("risk_controls");
  }

  // Physical product / CPG / spirits mapping.
  if (
    present.has("gross_margin") ||
    present.has("contribution_margin") ||
    present.has("cogs") ||
    present.has("landed_cost") ||
    present.has("inventory_turns") ||
    present.has("cash_conversion_cycle")
  ) {
    present.add("gross_margin_or_unit_economics");
    present.add("unit_economics");
  }

  if (present.has("repeat_rate") || present.has("retention_90d") || present.has("sell_through") || present.has("velocity")) {
    present.add("repeat_or_velocity");
    present.add("risk_controls");
  }

  if (present.has("doors") || present.has("distribution_points") || present.has("signed_distribution_agreement")) {
    present.add("distribution_traction_or_agreements");
    present.add("risk_controls");
  }

  if (present.has("working_capital_plan") || present.has("cash_conversion_cycle")) {
    present.add("risk_controls");
  }

  if (present.has("ttb") || present.has("excise") || present.has("regulatory_compliance")) {
    present.add("regulatory_compliance");
  }

  // Fintech mapping: transaction volume/adoption and compliance signals.
  if (
    present.has("tpv") ||
    present.has("gtv") ||
    present.has("transaction_volume") ||
    present.has("payment_volume") ||
    present.has("processed_volume") ||
    present.has("transaction_count") ||
    present.has("txn_count")
  ) {
    present.add("transaction_volume_or_gtv");
  }

  if (
    present.has("active_users") ||
    present.has("monthly_active_users") ||
    present.has("mau") ||
    present.has("dau") ||
    present.has("users")
  ) {
    present.add("transaction_volume_or_gtv");
  }

  if (
    present.has("kyc") ||
    present.has("aml") ||
    present.has("anti_money_laundering") ||
    present.has("compliance") ||
    present.has("regulatory") ||
    present.has("regulatory_status") ||
    present.has("license") ||
    present.has("licence") ||
    present.has("money_transmitter") ||
    present.has("mtl")
  ) {
    present.add("compliance_controls");
    present.add("risk_controls");
  }

  if (present.has("fraud_rate") || present.has("chargeback_rate")) {
    present.add("risk_controls");
  }

  // SaaS mapping: treat recurring revenue + retention + unit economics as rubric readiness signals.
  if (present.has("arr") || present.has("mrr") || present.has("bookings") || present.has("revenue")) {
    present.add("revenue");
  }
  if (present.has("nrr") || present.has("ndr") || present.has("grr") || present.has("churn") || present.has("churn_logo") || present.has("churn_revenue")) {
    present.add("retention_or_churn");
  }
  if (present.has("gross_margin") || present.has("ltv_to_cac") || present.has("payback_months")) {
    present.add("gross_margin_or_unit_economics");
    present.add("unit_economics");
  }
  if (present.has("acv") || present.has("pipeline_coverage") || present.has("sales_cycle_days") || present.has("magic_number")) {
    present.add("risk_controls");
  }

  // Healthcare / biotech mapping.
  // Regulatory path signals.
  if (present.has("regulatory_path_clear") || present.has("fda") || present.has("ind") || present.has("ide") || present.has("pma") || present.has("510k") || present.has("510_k")) {
    present.add("regulatory_path_clear");
  }
  if (present.has("regulatory_path_unclear")) {
    present.add("regulatory_path_unclear");
  }

  // Validation signals (trials/IRB/data) and validation metrics.
  if (
    present.has("validation_signal") ||
    present.has("trial_phase") ||
    present.has("clinical_trial") ||
    present.has("irb") ||
    present.has("peer_reviewed") ||
    present.has("endpoints") ||
    present.has("sensitivity") ||
    present.has("specificity") ||
    present.has("strong_validation_metrics")
  ) {
    present.add("validation_signal");
  }
  if (present.has("strong_validation_metrics") || present.has("sensitivity") || present.has("specificity")) {
    present.add("strong_validation_metrics");
  }

  // Team credibility (heuristic from classifier signals).
  if (present.has("team_credibility") || present.has("kol") || present.has("key_opinion_leader")) {
    present.add("team_credibility");
  }

  // Timeline + costs realism.
  if (present.has("timeline_costs_realistic") || present.has("time_to_clearance_months") || present.has("runway_months") || present.has("burn_rate")) {
    present.add("timeline_costs_realistic");
  }

  // Reimbursement (positive driver, not required).
  if (present.has("reimbursement_status") || present.has("reimbursement_path") || present.has("cpt") || present.has("drg") || present.has("payer")) {
    present.add("reimbursement_path");
  }

  // Safety/ethics red flag.
  if (present.has("safety_ethics_risk")) {
    present.add("safety_ethics_risk");
  }

  // Media / entertainment / IP mapping.
  // Rights verification (option / chain of title).
  if (present.has("rights_verifiable") || present.has("chain_of_title") || present.has("option") || present.has("rights") || present.has("rights_agreement")) {
    present.add("rights_verifiable");
  }

  // Distribution package (distribution agreement / MG / pre-sales) as a gating/positive driver.
  if (
    present.has("distribution_package") ||
    present.has("distribution") ||
    present.has("distributor") ||
    present.has("mg_amount") ||
    present.has("minimum_guarantee") ||
    present.has("presales_amount") ||
    present.has("presales")
  ) {
    present.add("distribution_package");
  }

  // Attachments and financeability.
  if (present.has("strong_attachments") || present.has("attachment_strength") || present.has("talent_attachments")) {
    present.add("strong_attachments");
  }
  if (present.has("financing_plan")) {
    present.add("financing_plan");
  }
  if (present.has("completion_bond_plan") || present.has("completion_bond")) {
    present.add("completion_bond_plan");
  }
  if (present.has("waterfall_recoupment_clarity") || present.has("recoupment_multiple") || present.has("recoupment") || present.has("waterfall")) {
    present.add("waterfall_recoupment_clarity");
  }

  // Red flags.
  if (present.has("rights_unclear")) present.add("rights_unclear");
  if (present.has("no_distribution_path")) present.add("no_distribution_path");
  if (present.has("aggressive_assumptions_no_comps")) present.add("aggressive_assumptions_no_comps");
  if (present.has("recoupment_waterfall_unclear")) present.add("recoupment_waterfall_unclear");

  // Rubric convenience: a financeable structure exists if there's a distribution package OR strong attachments + financing + completion bond plan.
  if (
    present.has("distribution_package") ||
    (present.has("strong_attachments") && present.has("financing_plan") && present.has("completion_bond_plan"))
  ) {
    present.add("financeable_structure");
  }

  // Marketing commitment (proxy KPI or narrative signal).
  if (present.has("marketing_commitment") || present.has("p_and_a") || present.has("prints_and_advertising")) {
    present.add("marketing_commitment");
  }

  return present;
};

type PolicyCapBucket = "positive_signals" | "coverage_gaps" | "red_flags";

const computeHealthcareBiotechV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: PolicyCapBucket; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "healthcare_biotech_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);

  const hasRegulatoryPath = present.has("regulatory_path_clear") && !present.has("regulatory_path_unclear");
  const regulatoryUnclear = present.has("regulatory_path_unclear") && !present.has("regulatory_path_clear");
  const hasValidation = present.has("validation_signal");
  const hasTeamCredibility = present.has("team_credibility");
  const hasTimelineCosts = present.has("timeline_costs_realistic");
  const safetyEthicsRisk = present.has("safety_ethics_risk");

  const preCap =
    unadjustedOverall === null ? null : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));
  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: PolicyCapBucket; text: string }> = [];

  // Explicit safety/ethics risk caps at 50 (red_flags bucket).
  if (baseline !== null && baseline > 50 && safetyEthicsRisk) {
    const cap = 50;
    capped = cap;
    capApplied = cap;
    diagnostics.push({
      bucket: "red_flags",
      text: "Healthcare/Biotech: red flag — safety/ethics/compliance risk indicated (e.g., fraudulent claims or missing compliance). Policy caps score at 50 until resolved.",
    });
  }

  // Regulatory path unclear caps at 60 with explicit diagnostic.
  if (baseline !== null && baseline > 60 && !safetyEthicsRisk && regulatoryUnclear) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Healthcare/Biotech: regulatory pathway appears unclear (FDA/IND/IDE/510(k)/PMA not specified). Policy caps score at 60 until regulatory path is clarified.",
    });
  }

  // >75 gating requires clear regulatory path + validation + team credibility + realistic timeline/costs.
  const qualifies75 = Boolean(hasRegulatoryPath && hasValidation && hasTeamCredibility && hasTimelineCosts);
  if (baseline !== null && baseline > 75 && !safetyEthicsRisk && !regulatoryUnclear && !qualifies75) {
    const cap = 75;
    capped = Math.min(typeof capped === "number" ? capped : cap, cap);
    capApplied = capApplied ?? cap;

    const missing: string[] = [];
    if (!hasRegulatoryPath) missing.push("clear regulatory path");
    if (!hasValidation) missing.push("validation signal (trial/IRB/data/endpoints)");
    if (!hasTeamCredibility) missing.push("team credibility (KOL/clinical leadership)");
    if (!hasTimelineCosts) missing.push("realistic timeline/costs (clearance timeline + burn/runway)");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Healthcare/Biotech: score >75 requires regulatory path + validation + team credibility + realistic timeline/costs. Missing: ${missing.join(", ") || "gating signals"}.`,
    });
  }

  if (!safetyEthicsRisk && hasRegulatoryPath && hasValidation && hasTeamCredibility && hasTimelineCosts) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Healthcare/Biotech: clear regulatory path with validation evidence, credible team, and realistic timeline/cost framing.",
    });
  }

  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const computeMediaEntertainmentIpV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: PolicyCapBucket; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "media_entertainment_ip_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);

  const hasRights = present.has("rights_verifiable") && !present.has("rights_unclear");
  const rightsUnclear = present.has("rights_unclear") && !present.has("rights_verifiable");

  const hasDistributionPackage = present.has("distribution_package");
  const hasAttachments = present.has("strong_attachments");
  const hasFinancingPlan = present.has("financing_plan");
  const hasCompletionBond = present.has("completion_bond_plan");
  const hasWaterfallClarity = present.has("waterfall_recoupment_clarity") && !present.has("recoupment_waterfall_unclear");

  const noDistributionPath = present.has("no_distribution_path");
  const aggressiveAssumptions = present.has("aggressive_assumptions_no_comps");
  const recoupmentUnclear = present.has("recoupment_waterfall_unclear");

  const preCap =
    unadjustedOverall === null ? null : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));
  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: PolicyCapBucket; text: string }> = [];

  // Red-flag caps: keep deterministic and policy-local.
  // Rights uncertainty is the most severe.
  if (baseline !== null && baseline > 60 && rightsUnclear) {
    const cap = 60;
    capped = cap;
    capApplied = cap;
    diagnostics.push({
      bucket: "red_flags",
      text: "Media/IP: red flag — rights/chain-of-title appears unclear or not secured. Policy caps score at 60 until rights are verified.",
    });
  }

  if (baseline !== null && baseline > 60 && !rightsUnclear && noDistributionPath) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "red_flags",
      text: "Media/IP: red flag — no clear distribution path (no distribution/MG/pre-sales). Policy caps score at 60 until distribution is clarified.",
    });
  }

  if (baseline !== null && baseline > 60 && !rightsUnclear && !noDistributionPath && aggressiveAssumptions) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "red_flags",
      text: "Media/IP: red flag — aggressive assumptions without comps/comparables. Policy caps score at 60 until assumptions are grounded.",
    });
  }

  if (baseline !== null && baseline > 60 && !rightsUnclear && !noDistributionPath && !aggressiveAssumptions && recoupmentUnclear) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "red_flags",
      text: "Media/IP: red flag — recoupment/waterfall appears unclear (missing or TBD). Policy caps score at 60 until waterfall/recoupment is clarified.",
    });
  }

  const qualifies75 = Boolean(
    hasRights &&
      (hasDistributionPackage || (hasAttachments && hasFinancingPlan && hasCompletionBond))
  );

  // >75 gating: rights + (distribution package OR (attachments + financing + completion bond)).
  if (baseline !== null && baseline > 75 && !rightsUnclear && !noDistributionPath && !aggressiveAssumptions && !recoupmentUnclear && !qualifies75) {
    const cap = 75;
    capped = Math.min(typeof capped === "number" ? capped : cap, cap);
    capApplied = capApplied ?? cap;

    const missing: string[] = [];
    if (!hasRights) missing.push("verifiable rights (option/chain of title)");
    const pathA = hasDistributionPackage;
    const pathB = hasAttachments && hasFinancingPlan && hasCompletionBond;
    if (!pathA && !pathB) {
      missing.push("distribution/MG/pre-sales OR strong attachments + financing plan + completion bond plan");
    } else {
      if (hasAttachments && !hasFinancingPlan) missing.push("credible financing plan");
      if (hasAttachments && hasFinancingPlan && !hasCompletionBond) missing.push("completion bond plan");
    }

    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Media/IP: score >75 requires verifiable rights + distribution/MG/pre-sales OR strong attachments + credible financing plan + completion bond plan. Missing: ${missing.join(", ") || "gating signals"}.`,
    });
  }

  // Missing revenue is acceptable if contracts/attachments are strong and structure is financeable.
  const hasRevenueMetric = present.has("contracted_revenue") || present.has("revenue") || present.has("arr") || present.has("mrr");
  const financeableWithoutRevenue = Boolean(!hasRevenueMetric && hasRights && (hasDistributionPackage || (hasAttachments && hasFinancingPlan && hasCompletionBond)));
  if (financeableWithoutRevenue) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Media/IP: missing revenue is acceptable when rights are verified and the package is financeable (distribution/MG/pre-sales or strong attachments + financing + completion plan).",
    });
  }

  if (qualifies75 && hasRights && (hasDistributionPackage || (hasAttachments && hasFinancingPlan && hasCompletionBond)) && hasWaterfallClarity) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Media/IP: rights verified with a financeable distribution/attachments package and clear waterfall/recoupment structure.",
    });
  }

  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const computeEnterpriseSaasB2BV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "enterprise_saas_b2b_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);

  const hasRevenue = present.has("arr") || present.has("mrr") || present.has("bookings") || present.has("revenue");
  const hasRetention = present.has("nrr") || present.has("ndr") || present.has("grr") || present.has("retention_or_churn") || present.has("churn_logo") || present.has("churn_revenue") || present.has("churn");
  const hasUnitEconomics = present.has("gross_margin_or_unit_economics") || present.has("gross_margin") || present.has("ltv_to_cac") || present.has("payback_months") || present.has("unit_economics");
  const hasSalesMotion = present.has("acv") || present.has("pipeline_coverage") || present.has("sales_cycle_days") || present.has("magic_number") || present.has("acv_pipeline");

  const qualitySignals = [hasRetention, hasUnitEconomics, hasSalesMotion].filter(Boolean).length;
  const revenueOnly = Boolean(hasRevenue && qualitySignals === 0);

  const metricsAnalyzed: any[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
    ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
    : [];

  const normalizePct = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    // Heuristic: treat values in (0,1] as fractions.
    if (v > 0 && v <= 1) return v * 100;
    return v;
  };

  const findMetric = (keys: string[]): { value: number | null; rating: string | null } => {
    for (const m of metricsAnalyzed) {
      const metric = typeof m?.metric === "string" ? normalizeKey(m.metric) : "";
      if (!metric) continue;
      if (!keys.includes(metric)) continue;
      const value = typeof m?.value === "number" ? m.value : null;
      const rating = typeof m?.rating === "string" ? m.rating : null;
      return { value, rating };
    }
    return { value: null, rating: null };
  };

  const nrr = findMetric(["nrr", "ndr", "net_dollar_retention", "net_revenue_retention"]);
  const grr = findMetric(["grr", "gross_revenue_retention", "gross_dollar_retention"]);
  const churn = findMetric(["churn", "churn_revenue", "churn_logo", "churn_rate"]);

  const nrrPct = normalizePct(nrr.value);
  const grrPct = normalizePct(grr.value);
  const churnPct = normalizePct(churn.value);

  const retentionWeakByRating = [nrr.rating, grr.rating, churn.rating].some((r) => typeof r === "string" && r.toLowerCase() === "weak");
  const badRetentionByValue =
    (typeof nrrPct === "number" && nrrPct > 0 && nrrPct < 90) ||
    (typeof grrPct === "number" && grrPct > 0 && grrPct < 85) ||
    (typeof churnPct === "number" && churnPct > 10);
  const badRetention = Boolean(retentionWeakByRating || badRetentionByValue);

  const preCap = unadjustedOverall === null
    ? null
    : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));
  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }> = [];

  // Bad retention caps final score at 60.
  if (baseline !== null && baseline > 60 && badRetention) {
    const cap = 60;
    capped = cap;
    capApplied = cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Enterprise SaaS: retention/churn appears weak; policy caps score at 60 until retention improves or is clarified.",
    });
  }

  // Revenue-only cannot exceed 70.
  if (baseline !== null && baseline > 70 && !badRetention && revenueOnly) {
    const cap = 70;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Enterprise SaaS: revenue present but missing retention, unit economics, or sales motion context. Revenue-only is capped at 70.",
    });
  }

  // >75 requires at least 3 quality signals (retention + unit economics + sales motion).
  if (baseline !== null && baseline > 75 && !badRetention && qualitySignals < 3) {
    const cap = 75;
    capped = Math.min(typeof capped === "number" ? capped : cap, cap);
    capApplied = capApplied ?? cap;

    const missing: string[] = [];
    if (!hasRetention) missing.push("retention/churn (NRR/GRR)");
    if (!hasUnitEconomics) missing.push("unit economics (gross margin, LTV:CAC, payback)");
    if (!hasSalesMotion) missing.push("sales motion (ACV, pipeline coverage, sales cycle)");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Enterprise SaaS: score >75 requires 3 quality signals. Missing: ${missing.join(", ") || "quality signals"}.`,
    });
  }

  if (!badRetention && hasRevenue && qualitySignals >= 3) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Enterprise SaaS: recurring revenue supported by retention, unit economics, and sales motion signals.",
    });
  }

  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const computePhysicalProductCpgSpiritsV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "physical_product_cpg_spirits_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);

  const metricsAnalyzed: any[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
    ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
    : [];

  const normalizePct = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v > 0 && v <= 1) return v * 100;
    return v;
  };

  const findMetric = (keys: string[]): { value: number | null; rating: string | null } => {
    for (const m of metricsAnalyzed) {
      const metric = typeof m?.metric === "string" ? normalizeKey(m.metric) : "";
      if (!metric) continue;
      if (!keys.includes(metric)) continue;
      const value = typeof m?.value === "number" ? m.value : null;
      const rating = typeof m?.rating === "string" ? m.rating : null;
      return { value, rating };
    }
    return { value: null, rating: null };
  };

  const ratingLc = (r: string | null): string => (typeof r === "string" ? r.toLowerCase() : "");
  const isStrong = (r: string | null): boolean => ratingLc(r) === "strong";
  const isWeak = (r: string | null): boolean => {
    const s = ratingLc(r);
    return s === "weak" || s === "poor";
  };

  const gm = findMetric(["gross_margin", "gross_margin_pct", "gm"]);
  const cm = findMetric(["contribution_margin", "contribution_margin_pct", "cm"]);
  const repeat = findMetric(["repeat_rate", "repeat_purchase_rate", "repeat_purchase"]);
  const retention90 = findMetric(["retention_90d", "90_day_retention", "d90_retention"]);
  const velocity = findMetric(["velocity", "retail_velocity", "units_per_store_per_week", "upsw"]);
  const sellThrough = findMetric(["sell_through", "sellthrough"]);
  const doors = findMetric(["doors", "retail_doors", "store_doors"]);
  const pod = findMetric(["distribution_points", "points_of_distribution", "pod"]);
  const chargebacks = findMetric(["chargebacks", "chargeback_rate", "returns", "return_rate"]);

  const gmPct = normalizePct(gm.value);
  const cmPct = normalizePct(cm.value);
  const repeatPct = normalizePct(repeat.value);
  const retention90Pct = normalizePct(retention90.value);
  const sellThroughPct = normalizePct(sellThrough.value);
  const chargebacksPct = normalizePct(chargebacks.value);

  const strongGm = Boolean(isStrong(gm.rating) || isStrong(cm.rating) || (typeof gmPct === "number" && gmPct >= 55) || (typeof cmPct === "number" && cmPct >= 30));
  const strongRepeatOrVelocity = Boolean(
    isStrong(repeat.rating) ||
      isStrong(retention90.rating) ||
      isStrong(velocity.rating) ||
      isStrong(sellThrough.rating) ||
      (typeof repeatPct === "number" && repeatPct >= 25) ||
      (typeof retention90Pct === "number" && retention90Pct >= 25) ||
      (typeof sellThroughPct === "number" && sellThroughPct >= 70) ||
      (typeof velocity.value === "number" && velocity.value >= 3)
  );

  const distributionTraction = Boolean(
    (typeof doors.value === "number" && doors.value >= 50) ||
      (typeof pod.value === "number" && pod.value >= 2) ||
      present.has("distribution_traction_or_agreements")
  );

  const signedDistributionAgreements = present.has("signed_distribution_agreement") || present.has("loi_or_contract");
  const workingCapitalPlan = present.has("working_capital_plan") || present.has("cash_conversion_cycle") || present.has("inventory_turns");
  const productionReady = present.has("production_ready") || present.has("manufacturing_ready") || present.has("product_ready");

  const hasRevenueMetric = present.has("revenue") || present.has("arr") || present.has("mrr");
  const hasUnitEconomics = present.has("gross_margin_or_unit_economics") || present.has("unit_economics");

  const negativeUnitMargins = Boolean((typeof gmPct === "number" && gmPct < 0) || (typeof cmPct === "number" && cmPct < 0));
  const severeChargebacksOrReturns = Boolean(isWeak(chargebacks.rating) || (typeof chargebacksPct === "number" && chargebacksPct > 2.0));
  const ttbComplianceUnclear = present.has("ttb_compliance_unclear");
  const noDistributionPath = present.has("no_distribution_path");

  const preCap =
    unadjustedOverall === null ? null : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));
  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }> = [];

  // Policy-local red flag caps (deterministic). These do not change global scoring math.
  if (baseline !== null && baseline > 55 && negativeUnitMargins) {
    const cap = 55;
    capped = cap;
    capApplied = cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Spirits/CPG: red flag — negative unit margins detected (gross or contribution margin < 0). Policy caps score at 55 until margins are clarified/improved.",
    });
  }

  if (baseline !== null && baseline > 60 && !negativeUnitMargins && severeChargebacksOrReturns) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Spirits/CPG: red flag — severe returns/chargebacks indicated. Policy caps score at 60 until the returns/chargebacks story is resolved.",
    });
  }

  if (baseline !== null && baseline > 60 && !negativeUnitMargins && !severeChargebacksOrReturns && ttbComplianceUnclear) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Spirits/CPG: red flag — TTB/state licensing or regulatory compliance appears unclear/pending. Policy caps score at 60 until compliance is confirmed.",
    });
  }

  if (baseline !== null && baseline > 60 && !negativeUnitMargins && !severeChargebacksOrReturns && !ttbComplianceUnclear && noDistributionPath) {
    const cap = 60;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Spirits/CPG: red flag — no clear path to distribution (explicitly stated). Policy caps score at 60 until a distribution plan/partner is secured.",
    });
  }

  // >75 gating: GM strong + repeat/velocity strong + (distribution traction OR (signed agreements + working capital plan)).
  const qualifies75 = Boolean(strongGm && strongRepeatOrVelocity && (distributionTraction || (signedDistributionAgreements && workingCapitalPlan)));
  if (
    baseline !== null &&
    baseline > 75 &&
    !negativeUnitMargins &&
    !severeChargebacksOrReturns &&
    !ttbComplianceUnclear &&
    !noDistributionPath &&
    !qualifies75
  ) {
    const cap = 75;
    capped = Math.min(typeof capped === "number" ? capped : cap, cap);
    capApplied = capApplied ?? cap;

    const missing: string[] = [];
    if (!strongGm) missing.push("gross/contribution margin strength");
    if (!strongRepeatOrVelocity) missing.push("repeat/retention or velocity/sell-through");
    if (!(distributionTraction || signedDistributionAgreements)) missing.push("distribution traction or signed distribution agreements");
    if (signedDistributionAgreements && !workingCapitalPlan) missing.push("working capital plan (inventory turns / cash conversion cycle)");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Spirits/CPG: score >75 requires strong GM + repeat/velocity + distribution traction (or signed agreements + working capital plan). Missing: ${missing.join(", ") || "gating signals"}.`,
    });
  }

  // Missing revenue is acceptable if execution-ready distribution is present and unit economics are solid.
  const executionReadyDistribution = Boolean(!hasRevenueMetric && productionReady && (distributionTraction || signedDistributionAgreements) && hasUnitEconomics);
  if (executionReadyDistribution) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Spirits/CPG: execution-ready distribution — production + distribution/contract signals present with solid unit economics even without revenue.",
    });
  }

  if (qualifies75 && strongGm && strongRepeatOrVelocity && (distributionTraction || signedDistributionAgreements) && (hasRevenueMetric || executionReadyDistribution)) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Spirits/CPG: unit economics supported by repeat/velocity and distribution traction/agreements.",
    });
  }

  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const computeOperatingStartupRevenueV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
  riskInvestmentScore: number | null;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor, riskInvestmentScore } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "operating_startup_revenue_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);
  const hasRevenue = present.has("revenue") || present.has("arr") || present.has("mrr");
  const hasMarginsOrUnitEcon = present.has("gross_margin_or_unit_economics") || present.has("gross_margin") || present.has("unit_economics") || present.has("contribution_margin");
  const hasRiskControls = present.has("risk_controls") || present.has("kpi") || present.has("cohort") || present.has("unit_economics");
  const hasRetention = present.has("retention_or_churn") || present.has("retention") || present.has("churn") || present.has("ndr") || present.has("nrr");

  // "Strong execution" for this deal class means revenue PLUS margin/unit economics PLUS some operational control signal.
  const strongExecution = Boolean(hasRevenue && hasMarginsOrUnitEcon && hasRiskControls);

  const riskScore = typeof riskInvestmentScore === "number" && Number.isFinite(riskInvestmentScore) ? riskInvestmentScore : 50;
  const riskMap: any[] = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map : [];
  const hasHighOrCritical = riskMap.some((r) => {
    const sev = typeof r?.severity === "string" ? r.severity.toLowerCase() : "";
    return sev === "high" || sev === "critical";
  });

  // Acceptable risk: no high/critical risks and a decent inverted risk score.
  const acceptableRisk = !hasHighOrCritical && riskScore >= 60;

  const preCap = unadjustedOverall === null
    ? null
    : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));

  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }> = [];

  // Revenue-only cannot push the deal above 70.
  if (baseline !== null && hasRevenue && !strongExecution) {
    const cap = 70;
    if (baseline > cap) {
      capped = cap;
      capApplied = cap;
    }
    const missingParts: string[] = [];
    if (!hasMarginsOrUnitEcon) missingParts.push("margins/unit economics");
    if (!hasRiskControls) missingParts.push("risk controls / operating KPIs");
    if (!hasRetention) missingParts.push("retention/churn (if applicable)");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Operating startup: revenue present but execution evidence incomplete (${missingParts.join(", ") || "execution signals"}). Revenue-only is capped at 70.`,
    });
  }

  // >75 requires strong execution AND acceptable risk.
  // If execution is not strong, the revenue-only cap above already applies (<=70).
  if (baseline !== null && baseline > 75 && strongExecution && !acceptableRisk) {
    const cap = 75;
    if (baseline > cap) {
      capped = cap;
      capApplied = capApplied ?? cap;
    }
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Operating startup: score >75 requires strong execution signals and acceptable risk. Current gating: execution=${strongExecution ? "ok" : "missing"}, risk=${acceptableRisk ? "ok" : "not acceptable"}.`,
    });
  }

  if (capped !== null && hasRevenue && strongExecution && acceptableRisk) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Operating startup: revenue supported by execution signals (margins/unit economics + operating controls) with acceptable risk.",
    });
  }

  // Only report cap as applied when we can show it actually changed the outcome.
  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const computeConsumerEcommerceBrandV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
  riskInvestmentScore: number | null;
  metricInvestmentScore: number | null;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor, riskInvestmentScore, metricInvestmentScore } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "consumer_ecommerce_brand_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);

  const hasMargin = present.has("gross_margin_pct") || present.has("contribution_margin_pct") || present.has("gross_margin") || present.has("contribution_margin");
  const hasLtv = present.has("ltv");
  const hasCac = present.has("cac");
  const hasLtvToCac = present.has("ltv_to_cac") || present.has("ltv_cac");
  const hasAov = present.has("aov");
  const hasConversion = present.has("conversion_rate");
  const hasRepeatability = present.has("repeat_purchase_rate") || present.has("cohort") || present.has("retention") || present.has("repeat_purchase");

  const coreKpiCount = [hasMargin, hasLtv, hasCac, hasLtvToCac, hasAov].filter(Boolean).length;
  const hasUnitEconomics = Boolean(hasMargin && (hasLtvToCac || (hasLtv && hasCac)));

  const metricScore = typeof metricInvestmentScore === "number" && Number.isFinite(metricInvestmentScore) ? metricInvestmentScore : 50;
  const strongUnitEconomics = Boolean(hasUnitEconomics && metricScore >= 70);

  const riskScore = typeof riskInvestmentScore === "number" && Number.isFinite(riskInvestmentScore) ? riskInvestmentScore : 50;
  const riskMap: any[] = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map : [];
  const hasHighOrCritical = riskMap.some((r) => {
    const sev = typeof r?.severity === "string" ? r.severity.toLowerCase() : "";
    return sev === "high" || sev === "critical";
  });

  const acceptableRisk = !hasHighOrCritical && riskScore >= 60;

  const preCap = unadjustedOverall === null
    ? null
    : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));
  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }> = [];

  // Coverage gating: if key unit-econ KPIs are missing, keep score near neutral.
  if (coreKpiCount < 2) {
    const missing: string[] = [];
    if (!hasMargin) missing.push("gross/contribution margin");
    if (!hasCac) missing.push("CAC");
    if (!hasLtv && !hasLtvToCac) missing.push("LTV or LTV:CAC");
    if (!hasAov) missing.push("AOV");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Ecommerce: limited benchmarkable unit economics (${missing.join(", ") || "core KPIs"}). Score stays near neutral until KPIs are present.`,
    });

    if (baseline !== null && baseline > 60) {
      const cap = 60;
      if (baseline > cap) {
        capped = cap;
        capApplied = cap;
      }
    }
  }

  // 75+ requires strong unit economics AND acceptable risk.
  if (baseline !== null && baseline > 75 && (!strongUnitEconomics || !acceptableRisk)) {
    const cap = 75;
    if (baseline > cap) {
      capped = cap;
      capApplied = capApplied ?? cap;
    }
    const gating: string[] = [];
    if (!strongUnitEconomics) gating.push("unit economics (LTV:CAC + margins) not strong/confirmed");
    if (!acceptableRisk) gating.push("risk not acceptable (high/critical risks or low risk score)");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Ecommerce: 75+ requires strong unit economics and acceptable risk. Gating: ${gating.join("; ")}.`,
    });
  }

  // 90+ semantics (diagnostics only): unit economics + repeatability + scaling proof + low risk.
  const qualifies90 = Boolean(strongUnitEconomics && acceptableRisk && !hasHighOrCritical && riskScore >= 75 && metricScore >= 85 && hasRepeatability && hasConversion);

  if (strongUnitEconomics && acceptableRisk) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Ecommerce: strong unit economics (LTV:CAC + margins) supported by benchmarks with acceptable risk.",
    });
  }
  if (qualifies90) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Ecommerce: 90+ signals present (unit economics + repeatability/cohorts + conversion performance) with no high/critical risks.",
    });
  } else if (strongUnitEconomics && acceptableRisk && (!hasRepeatability || !hasConversion)) {
    const missing: string[] = [];
    if (!hasRepeatability) missing.push("repeat purchase/cohorts/retention");
    if (!hasConversion) missing.push("conversion rate");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Ecommerce: scaling proof for 90+ typically needs ${missing.join(" and ")}.`,
    });
  }

  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const computeConsumerFintechPlatformV1Caps = (params: {
  dio: DealIntelligenceObject;
  overall: number | null;
  unadjustedOverall: number | null;
  adjustmentFactor: number;
  riskInvestmentScore: number | null;
  metricInvestmentScore: number | null;
}): {
  capped_overall: number | null;
  cap_applied: number | null;
  diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }>;
} => {
  const { dio, overall, unadjustedOverall, adjustmentFactor, riskInvestmentScore, metricInvestmentScore } = params;
  const policyId = getSelectedPolicyIdFromAny(dio);
  if (policyId !== "consumer_fintech_platform_v1") {
    return { capped_overall: overall, cap_applied: null, diagnostics: [] };
  }

  const present = getNormalizedPresenceSetForRubric(dio);

  const hasRevenue = present.has("revenue") || present.has("arr") || present.has("mrr");
  const hasGrowth = present.has("growth_rate") || present.has("revenue_growth_rate") || present.has("yoy_growth") || present.has("mom_growth");
  const hasVolume =
    present.has("tpv") ||
    present.has("gtv") ||
    present.has("transaction_volume") ||
    present.has("payment_volume") ||
    present.has("processed_volume") ||
    present.has("transaction_value");
  const hasTxnCount = present.has("transaction_count") || present.has("txn_count") || present.has("monthly_transactions") || present.has("transactions");
  const hasUsers = present.has("active_users") || present.has("monthly_active_users") || present.has("mau") || present.has("dau") || present.has("users");
  const hasTakeRate = present.has("take_rate") || present.has("interchange_rate") || present.has("net_take_rate");
  const hasCompliance = present.has("compliance_controls") || present.has("kyc") || present.has("aml") || present.has("regulatory_status");

  const adoptionEvidence = Boolean(hasVolume || hasTxnCount || hasUsers);
  const revenueOnly = Boolean(hasRevenue && !hasGrowth && !adoptionEvidence && !hasTakeRate);
  const growthOnly = Boolean(hasGrowth && !hasRevenue && !adoptionEvidence && !hasTakeRate);

  const metricScore = typeof metricInvestmentScore === "number" && Number.isFinite(metricInvestmentScore) ? metricInvestmentScore : 50;
  const riskScore = typeof riskInvestmentScore === "number" && Number.isFinite(riskInvestmentScore) ? riskInvestmentScore : 50;

  const riskMap: any[] = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map : [];
  const highOrCriticalRisks = riskMap.filter((r) => {
    const sev = typeof r?.severity === "string" ? r.severity.toLowerCase() : "";
    return sev === "high" || sev === "critical";
  });

  const regFraudRe = /(regulatory|compliance|licen[cs]e|kyc|aml|anti[-\s]?money\s+laundering|sanctions|ofac|money\s+transmitter|fraud|chargeback|dispute|money\s+laundering)/i;
  const hasUnmitigatedRegOrFraud = highOrCriticalRisks.some((r) => {
    const cat = typeof r?.category === "string" ? r.category : "";
    const title = typeof r?.title === "string" ? r.title : "";
    const desc = typeof r?.description === "string" ? r.description : "";
    const mitigation = typeof r?.mitigation === "string" ? r.mitigation.trim() : "";
    const haystack = `${cat} ${title} ${desc}`;
    return regFraudRe.test(haystack) && mitigation.length === 0;
  });

  const hasHighOrCritical = highOrCriticalRisks.length > 0;
  const acceptableRisk = !hasHighOrCritical && riskScore >= 60;

  const preCap =
    unadjustedOverall === null ? null : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));
  const baseline = preCap !== null ? preCap : overall;

  let capped = overall;
  let capApplied: number | null = null;
  const diagnostics: Array<{ bucket: "positive_signals" | "coverage_gaps"; text: string }> = [];

  // Hard cap: unmitigated regulatory/fraud risk caps final score at 70.
  if (baseline !== null && baseline > 70 && hasUnmitigatedRegOrFraud) {
    const cap = 70;
    capped = cap;
    capApplied = cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Fintech: policy cap at 70 due to unmitigated regulatory/fraud risk (missing mitigation details).",
    });
  }

  // Revenue alone cannot push score above 70.
  if (baseline !== null && baseline > 70 && !hasUnmitigatedRegOrFraud && revenueOnly) {
    const cap = 70;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Fintech: revenue present but missing volume/adoption, growth, or unit economics. Revenue-only is capped at 70.",
    });
  }

  // Growth alone should not guarantee high scores.
  if (baseline !== null && baseline > 70 && !hasUnmitigatedRegOrFraud && growthOnly) {
    const cap = 70;
    capped = cap;
    capApplied = capApplied ?? cap;
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Fintech: growth reported without adoption/volume or unit economics context. Growth-only is capped at 70.",
    });
  }

  // 75+ requires adoption/volume evidence and acceptable risk.
  const qualifies75 = Boolean(acceptableRisk && adoptionEvidence && (hasRevenue || hasGrowth) && metricScore >= 70);
  if (baseline !== null && baseline > 75 && !hasUnmitigatedRegOrFraud && !qualifies75) {
    const cap = 75;
    capped = Math.min(typeof capped === "number" ? capped : cap, cap);
    capApplied = capApplied ?? cap;
    const gating: string[] = [];
    if (!adoptionEvidence) gating.push("adoption/volume (TPV/GTV, transactions, or users)");
    if (!(hasRevenue || hasGrowth)) gating.push("growth or revenue context");
    if (!acceptableRisk) gating.push("acceptable risk (no high/critical risks)");
    if (metricScore < 70) gating.push("benchmark strength");
    diagnostics.push({
      bucket: "coverage_gaps",
      text: `Fintech: 75+ requires ${gating.join(", ") || "strong traction and acceptable risk"}.`,
    });
  }

  if (hasCompliance) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Fintech: compliance posture signals present (KYC/AML / licensing / regulatory readiness).",
    });
  } else {
    diagnostics.push({
      bucket: "coverage_gaps",
      text: "Fintech: compliance posture not clearly stated (KYC/AML, licensing, regulatory readiness).",
    });
  }

  if (adoptionEvidence && (hasGrowth || hasRevenue) && metricScore >= 70 && (!hasHighOrCritical || acceptableRisk)) {
    diagnostics.push({
      bucket: "positive_signals",
      text: "Fintech: adoption/volume evidence plus growth/revenue context with strong benchmarks.",
    });
  }

  const applied = preCap !== null && capApplied !== null && preCap > capApplied && capped === capApplied ? capApplied : null;
  return { capped_overall: capped, cap_applied: applied, diagnostics };
};

const getDealClassificationV1Any = (dioLike: any): any | null =>
  (dioLike as any)?.dio?.deal_classification_v1 ??
  (dioLike as any)?.deal_classification_v1 ??
  (dioLike as any)?.dio?.dio?.deal_classification_v1 ??
  (dioLike as any)?.phase1?.deal_classification_v1 ??
  (dioLike as any)?.dio?.phase1?.deal_classification_v1 ??
  null;

const evaluatePolicyRubric = (dio: DealIntelligenceObject, policyId: string | null): RubricEval | null => {
  if (!policyId) return null;
  const policy = getDealPolicy(policyId);
  const rubric = (policy as any)?.rubric as
    | {
        id: string;
        required_signals: string[];
        positive_drivers: string[];
        acceptable_missing: string[];
        red_flags: string[];
      }
    | undefined;

  if (!rubric) return null;

  const present = getNormalizedPresenceSetForRubric(dio);

  const requiredPairs = (rubric.required_signals || []).map((s) => ({ raw: s, key: normalizeKey(s) }));
  const missingRequired = requiredPairs.filter((p) => !present.has(p.key)).map((p) => p.raw);

  const positivePairs = (rubric.positive_drivers || []).map((s) => ({ raw: s, key: normalizeKey(s) }));
  const positivePresent = positivePairs.filter((p) => present.has(p.key)).map((p) => p.raw);

  const acceptableMissing = (rubric.acceptable_missing || []).map(normalizeKey);
  const hasRevenueMetric = present.has("revenue") || present.has("arr") || present.has("mrr");
  const acceptableMissingPresent = !hasRevenueMetric && acceptableMissing.some((s) => s === "revenue" || s === "arr" || s === "mrr")
    ? ["revenue"]
    : [];

  const allowedRedFlags = new Set((rubric.red_flags || []).map((s) => normalizeKey(s)));

  // Policy-local rubric red flags can be triggered either by risk_map (high/critical) or by
  // metric benchmark values when available (deterministic, no global scoring impact).
  const metricsAnalyzed: any[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
    ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
    : [];

  const normalizePct = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v > 0 && v <= 1) return v * 100;
    return v;
  };

  const findMetric = (keys: string[]): { value: number | null; rating: string | null } => {
    for (const m of metricsAnalyzed) {
      const metric = typeof m?.metric === "string" ? normalizeKey(m.metric) : "";
      if (!metric) continue;
      if (!keys.includes(metric)) continue;
      const value = typeof m?.value === "number" ? m.value : null;
      const rating = typeof m?.rating === "string" ? m.rating : null;
      return { value, rating };
    }
    return { value: null, rating: null };
  };

  // Red flags: use risk_map severity/category heuristics (deterministic).
  const riskMap: any[] = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map : [];
  const redFlagsTriggered: string[] = [];

  // Metric-based policy red flags (used by physical_product_cpg_spirits_v1 and similar).
  if (allowedRedFlags.has("negative_unit_margins")) {
    const gm = findMetric(["gross_margin", "gross_margin_pct", "gm"]);
    const cm = findMetric(["contribution_margin", "contribution_margin_pct", "cm"]);
    const gmPct = normalizePct(gm.value);
    const cmPct = normalizePct(cm.value);
    if ((typeof gmPct === "number" && gmPct < 0) || (typeof cmPct === "number" && cmPct < 0)) {
      redFlagsTriggered.push("negative_unit_margins");
    }
  }

  if (allowedRedFlags.has("severe_chargebacks_or_returns")) {
    const cb = findMetric(["chargebacks", "chargeback_rate", "returns", "return_rate"]);
    const cbPct = normalizePct(cb.value);
    const rating = typeof cb.rating === "string" ? cb.rating.toLowerCase() : "";
    if ((typeof cbPct === "number" && cbPct > 2.0) || rating === "weak" || rating === "poor") {
      redFlagsTriggered.push("severe_chargebacks_or_returns");
    }
  }

  if (allowedRedFlags.has("ttb_compliance_unclear")) {
    const selectedSignalsRaw: string[] = asStringArray(getDealClassificationV1Any(dio as any)?.selected?.signals);
    const selectedSignals = selectedSignalsRaw.map(normalizeKey);
    if (selectedSignals.includes("ttb_compliance_unclear")) {
      redFlagsTriggered.push("ttb_compliance_unclear");
    }
  }

  if (allowedRedFlags.has("no_distribution_path")) {
    const selectedSignalsRaw: string[] = asStringArray(getDealClassificationV1Any(dio as any)?.selected?.signals);
    const selectedSignals = selectedSignalsRaw.map(normalizeKey);
    if (selectedSignals.includes("no_distribution_path")) {
      redFlagsTriggered.push("no_distribution_path");
    }
  }

  if (allowedRedFlags.has("safety_ethics_risk")) {
    const selectedSignalsRaw: string[] = asStringArray(getDealClassificationV1Any(dio as any)?.selected?.signals);
    const selectedSignals = selectedSignalsRaw.map(normalizeKey);
    if (selectedSignals.includes("safety_ethics_risk")) {
      redFlagsTriggered.push("safety_ethics_risk");
    }
  }

  for (const r of riskMap) {
    const sev = typeof r?.severity === "string" ? r.severity.toLowerCase() : "";
    const cat = typeof r?.category === "string" ? r.category.toLowerCase() : "";
    const title = typeof r?.title === "string" ? r.title.toLowerCase() : "";
    const desc = typeof r?.description === "string" ? r.description.toLowerCase() : "";
    const blob = `${cat} ${title} ${desc}`;

    if (sev === "critical" || sev === "high") {
      if (allowedRedFlags.has("fraud") && /fraud|misrepresent/.test(blob)) redFlagsTriggered.push("fraud");
      if (allowedRedFlags.has("ownership_unclear") && /ownership|cap\s*table|ip\s+ownership|assignment/.test(blob)) {
        redFlagsTriggered.push("ownership_unclear");
      }
      if (allowedRedFlags.has("regulatory_blocker") && /regulator|regulatory|fda|compliance|license|permits?/.test(blob)) {
        redFlagsTriggered.push("regulatory_blocker");
      }
    }
  }

  return {
    id: rubric.id,
    required_signals: rubric.required_signals || [],
    missing_required: missingRequired,
    positive_drivers_present: positivePresent,
    acceptable_missing_present: acceptableMissingPresent,
    red_flags_triggered: uniqueStrings(redFlagsTriggered),
    has_revenue_metric: hasRevenueMetric,
  };
};

const getMeta = (res: any): { status: string | null; coverage: number | null; confidence: number | null } => {
  const status = typeof res?.status === "string" ? res.status : null;
  const coverage = isFiniteNumber(res?.coverage) ? res.coverage : null;
  const confidence = isFiniteNumber(res?.confidence) ? res.confidence : null;
  return { status, coverage, confidence };
};

type ScoreComponentKey = "slide_sequence" | "metric_benchmark" | "visual_design" | "narrative_arc" | "financial_health" | "risk_assessment";

type ComponentDetail = {
  reason: string;
  reasons: string[];
  evidence_ids: string[];
  gaps: string[];
  red_flags: string[];
};

export type DocInventory = {
  documents_count: number;
  total_pages: number;
  types: string[];
};

export type ScoreWeights = ScoreExplanation["aggregation"]["weights"];

export function getContextWeights(dio_context: any, doc_inventory: DocInventory): ScoreWeights {
  const primary = typeof dio_context?.primary_doc_type === "string" ? dio_context.primary_doc_type : "";

  // Default: neutral weighting.
  const defaultWeights: ScoreWeights = {
    slide_sequence: 1.0,
    metric_benchmark: 1.0,
    visual_design: 1.0,
    narrative_arc: 1.0,
    financial_health: 1.0,
    risk_assessment: 1.0,
  };

  // Pitch decks: presentation + narrative + metrics matter most.
  if (primary === "pitch_deck") {
    return {
      narrative_arc: 1.5,
      slide_sequence: 1.0,
      visual_design: 1.0,
      metric_benchmark: 1.0,
      financial_health: 0.5,
      risk_assessment: 1.0,
    };
  }

  // Investment memos / business plans: heavily downweight slide/visual heuristics; emphasize fundamentals.
  // IMs still benefit from coherent structure (narrative_arc) but are not judged on slide choreography.
  if (primary === "business_plan_im") {
    return {
      slide_sequence: 0.0,
      visual_design: 0.0,
      narrative_arc: 1.1,
      metric_benchmark: 1.5,
      financial_health: 1.5,
      risk_assessment: 1.3,
    };
  }

  // Executive summaries: keep some slide/visual signal, but still emphasize clarity + fundamentals.
  if (primary === "exec_summary") {
    return {
      slide_sequence: 0.3,
      visual_design: 0.4,
      narrative_arc: 1.3,
      metric_benchmark: 1.2,
      financial_health: 1.2,
      risk_assessment: 1.1,
    };
  }

  // Financials-first: metrics + financial health dominate.
  if (primary === "financials") {
    return {
      slide_sequence: 0.1,
      visual_design: 0.1,
      narrative_arc: 0.2,
      metric_benchmark: 1.6,
      financial_health: 1.6,
      risk_assessment: 1.0,
    };
  }

  // If context missing but we only have financial docs, treat as financials-first.
  const hasOnlyFinancialDocs = doc_inventory.types.length > 0
    && doc_inventory.types.every((t) => /financial/i.test(t));
  if (!primary && hasOnlyFinancialDocs) {
    return {
      slide_sequence: 0.1,
      visual_design: 0.1,
      narrative_arc: 0.2,
      metric_benchmark: 1.6,
      financial_health: 1.6,
      risk_assessment: 1.0,
    };
  }

  return defaultWeights;
}

const buildDocInventory = (dio: DealIntelligenceObject): DocInventory => {
  const docs: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];
  const types = docs.map((d) => (typeof d?.type === "string" ? d.type : "")).filter(Boolean);
  const total_pages = docs.reduce((sum, d) => sum + (typeof d?.page_count === "number" ? d.page_count : 0), 0);
  return {
    documents_count: docs.length,
    total_pages,
    types,
  };
};

const getExtractedMetricKeysFromInputs = (dio: DealIntelligenceObject): string[] => {
  const docs: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];
  const keys: string[] = [];
  for (const doc of docs) {
    const metrics = Array.isArray(doc?.metrics) ? doc.metrics : [];
    for (const m of metrics) {
      if (typeof m?.key === "string" && m.key.trim()) keys.push(m.key.trim());
      else if (typeof m?.name === "string" && m.name.trim()) keys.push(m.name.trim());
    }
  }
  return uniqueStrings(keys);
};

const getEvidenceIdsForComponent = (key: ScoreComponentKey, dio: DealIntelligenceObject, results: any): string[] => {
  const base = uniqueStrings(asStringArray(results?.[key]?.evidence_ids));
  switch (key) {
    case "metric_benchmark": {
      const metricEvidence = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
        ? results.metric_benchmark.metrics_analyzed
            .map((m: any) => (typeof m?.evidence_id === "string" ? m.evidence_id : null))
            .filter(Boolean)
        : [];
      return uniqueStrings([...base, ...(metricEvidence as string[])]);
    }
    case "financial_health": {
      const riskEvidence = Array.isArray(results?.financial_health?.risks)
        ? results.financial_health.risks
            .map((r: any) => (typeof r?.evidence_id === "string" ? r.evidence_id : null))
            .filter(Boolean)
        : [];
      return uniqueStrings([...base, ...(riskEvidence as string[])]);
    }
    case "risk_assessment": {
      const cats = results?.risk_assessment?.risks_by_category;
      const allRisks: any[] = cats && typeof cats === "object"
        ? ([] as any[])
            .concat(Array.isArray(cats.market) ? cats.market : [])
            .concat(Array.isArray(cats.team) ? cats.team : [])
            .concat(Array.isArray(cats.financial) ? cats.financial : [])
            .concat(Array.isArray(cats.execution) ? cats.execution : [])
        : [];
      const riskEvidence = allRisks
        .map((r: any) => (typeof r?.evidence_id === "string" ? r.evidence_id : null))
        .filter(Boolean) as string[];
      return uniqueStrings([...base, ...riskEvidence]);
    }
    default:
      return base;
  }
};

const buildComponentDetail = (params: {
  key: ScoreComponentKey;
  dio: DealIntelligenceObject;
  results: any;
  status: string | null;
  computed_status: string | null;
  raw_score: number | null;
  used_score: number | null;
  penalty: number;
  confidence: number | null;
}): ComponentDetail => {
  const { key, dio, results, status, computed_status, raw_score, used_score, penalty, confidence } = params;

  const evidence_ids = getEvidenceIdsForComponent(key, dio, results);
  const gaps: string[] = [];
  const red_flags: string[] = [];
  const reasons: string[] = [];

  const set = (reason: string, extra?: { gaps?: string[]; red_flags?: string[]; reasons?: string[] }): void => {
    if (extra?.gaps) gaps.push(...extra.gaps);
    if (extra?.red_flags) red_flags.push(...extra.red_flags);
    if (extra?.reasons) reasons.push(...extra.reasons);
    reasons.unshift(reason);
  };

  const analyzerStatus = status;

  // Error/missing paths
  if (analyzerStatus == null) {
    set("Missing analyzer result; neutral baseline applied", { gaps: ["analyzer_result_missing"] });
  } else if (analyzerStatus === "extraction_failed") {
    set("Analyzer failed; neutral baseline applied", { gaps: ["analyzer_failed"] });
  } else if (analyzerStatus === "insufficient_data") {
    switch (key) {
      case "slide_sequence":
        set("Insufficient structure signal; expected slide headings/sections not detected", { gaps: ["headings", "sections"] });
        break;
      case "financial_health":
        set("No financial KPIs extracted (revenue/expenses/burn/runway)", {
          gaps: ["revenue", "expenses", "burn_rate", "cash_balance", "runway_months", "burn_multiple"],
        });
        break;
      case "metric_benchmark":
        set("No financial metrics extracted for benchmarking", { gaps: ["metrics"] });
        break;
      case "risk_assessment":
        set("Insufficient risk signal; expected pitch text and/or risk cues not detected", { gaps: ["pitch_text", "risk_cues"] });
        break;
      case "narrative_arc":
        set("Insufficient narrative signal; expected section progression not detected", { gaps: ["sections", "structure"] });
        break;
      case "visual_design":
        set("Insufficient design signal; expected layout/format cues not detected", { gaps: ["layout", "formatting"] });
        break;
      default:
        set("Insufficient data; neutral baseline applied", { gaps: ["insufficient_data"] });
        break;
    }
  }

  // Special neutral/baseline and red-flag logic when status is ok
  if (analyzerStatus === "ok") {
    if (key === "risk_assessment") {
      const ra: any = results?.risk_assessment;
      const total = typeof ra?.total_risks === "number" ? ra.total_risks : 0;
      const critical = typeof ra?.critical_count === "number" ? ra.critical_count : 0;
      const high = typeof ra?.high_count === "number" ? ra.high_count : 0;

      if ((critical > 0 || high > 0) && ra?.risks_by_category) {
        const cats = ra.risks_by_category;
        const allRisks: any[] = ([] as any[])
          .concat(Array.isArray(cats.market) ? cats.market : [])
          .concat(Array.isArray(cats.team) ? cats.team : [])
          .concat(Array.isArray(cats.financial) ? cats.financial : [])
          .concat(Array.isArray(cats.execution) ? cats.execution : []);
        const flagged = allRisks.filter((r) => r && (r.severity === "critical" || r.severity === "high"));
        const texts = flagged
          .map((r) => {
            const sev = typeof r?.severity === "string" ? r.severity : "risk";
            const desc = typeof r?.description === "string" ? r.description : "(missing description)";
            return `${sev}: ${desc}`;
          })
          .filter(Boolean) as string[];
        if (texts.length > 0) {
          red_flags.push(...texts);
          set(`Red flags detected in risk assessment (${texts.length})`);
        }
      } else if (raw_score === 50 && total === 0) {
        // Deterministic neutral baseline when no explicit risks extracted.
        set("No explicit risks extracted; neutral baseline used", { gaps: ["explicit_risks"] });
      } else if (reasons.length === 0) {
        set("Risks assessed; risk score inverted for investment score");
      }
    }

    if (key === "metric_benchmark") {
      const metricsAnalyzed = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
        ? results.metric_benchmark.metrics_analyzed
        : [];
      const extractedKeys = getExtractedMetricKeysFromInputs(dio);

      if (raw_score == null) {
        if (extractedKeys.length > 0) {
          set("Metrics present but not mapped to benchmark set", {
            gaps: extractedKeys.map((k) => `benchmark_mapping:${k}`),
          });
        } else {
          set("No financial metrics extracted for benchmarking", { gaps: ["metrics"] });
        }
      } else if (metricsAnalyzed.length === 0) {
        // OK score but no explicit metric-by-metric validation: treat as partial signal.
        set("No benchmark-mapped KPIs found; neutral baseline used", { gaps: ["benchmark_mapping"] });
      } else if (reasons.length === 0) {
        set("Benchmarks applied to extracted metrics");
      }
    }

    if (key === "financial_health") {
      const fh: any = results?.financial_health;
      const risks = Array.isArray(fh?.risks) ? fh.risks : [];
      const severe = risks.filter((r: any) => r && (r.severity === "critical" || r.severity === "high"));
      if (severe.length > 0) {
        const texts = severe
          .map((r: any) => {
            const sev = typeof r?.severity === "string" ? r.severity : "risk";
            const desc = typeof r?.description === "string" ? r.description : "(missing description)";
            return `${sev}: ${desc}`;
          })
          .filter(Boolean) as string[];
        red_flags.push(...texts);
        set(`Red flags detected in financial health (${texts.length})`);
      } else {
        const metrics: any = fh?.metrics;
        const missing: string[] = [];
        const need = [
          ["revenue", metrics?.revenue],
          ["expenses", metrics?.expenses],
          ["burn_rate", metrics?.burn_rate],
          ["cash_balance", metrics?.cash_balance],
          ["runway_months", fh?.runway_months],
          ["burn_multiple", fh?.burn_multiple],
        ] as const;
        for (const [name, val] of need) {
          if (val == null) missing.push(name);
        }
        if (raw_score == null) {
          set("Financial KPIs present but insufficient to compute health score", { gaps: missing.length > 0 ? missing : ["financial_kpis"] });
        } else if (missing.length > 0) {
          set("Some financial KPIs missing; score computed with partial data", { gaps: missing });
        } else if (reasons.length === 0) {
          set("Financial KPIs extracted; health score computed");
        }
      }
    }

    if (key === "slide_sequence" && reasons.length === 0) {
      const deviations = Array.isArray(results?.slide_sequence?.deviations) ? results.slide_sequence.deviations : [];
      if (deviations.length > 0) set(`Slide sequence deviations detected (${deviations.length})`);
      else set("Slide structure matches common patterns");
    }

    if (key === "narrative_arc" && reasons.length === 0) {
      set("Narrative pacing score computed");
    }

    if (key === "visual_design" && reasons.length === 0) {
      const weaknesses = asStringArray(results?.visual_design?.weaknesses);
      if (weaknesses.length > 0) set(`Visual design weaknesses detected (${weaknesses.length})`);
      else set("Visual design score computed");
    }
  }

  // Penalization / blending context
  if (computed_status && computed_status.startsWith("penalized_")) {
    const suffix = computed_status.replace("penalized_", "");
    if (suffix === "missing") gaps.push("score_missing");
    if (suffix === "non_ok") gaps.push("status_not_ok");
    reasons.push(`Neutral baseline=50 applied with penalty=${penalty}`);
  }
  if (typeof confidence === "number" && Number.isFinite(confidence) && confidence < 0.5) {
    gaps.push("confidence_low");
    reasons.push(`Low confidence (${confidence.toFixed(2)}); blended toward neutral baseline`);
  }

  // Ensure a single best required reason.
  const reason = reasons.length > 0
    ? reasons[0]
    : (analyzerStatus === "ok" ? "Analyzer score used" : "Neutral baseline used");

  return {
    reason,
    reasons: uniqueStrings(reasons),
    evidence_ids,
    gaps: uniqueStrings(gaps),
    red_flags: uniqueStrings(red_flags),
  };
};

const getAnalyzerNumericScore = (key: ScoreComponentKey, results: any): number | null => {
  switch (key) {
    case "slide_sequence":
      return isFiniteNumber(results?.slide_sequence?.score) ? results.slide_sequence.score : null;
    case "metric_benchmark":
      return isFiniteNumber(results?.metric_benchmark?.overall_score) ? results.metric_benchmark.overall_score : null;
    case "visual_design":
      return isFiniteNumber(results?.visual_design?.design_score) ? results.visual_design.design_score : null;
    case "narrative_arc":
      return isFiniteNumber(results?.narrative_arc?.pacing_score) ? results.narrative_arc.pacing_score : null;
    case "financial_health":
      return isFiniteNumber(results?.financial_health?.health_score) ? results.financial_health.health_score : null;
    case "risk_assessment":
      return isFiniteNumber(results?.risk_assessment?.overall_risk_score) ? results.risk_assessment.overall_risk_score : null;
  }
};

export function buildScoreExplanationFromDIO(dio: DealIntelligenceObject): ScoreExplanation {
  const results: any = (dio as any).analyzer_results || {};
  const ctx = (dio as any).dio_context;
  const docInventory = buildDocInventory(dio);

  const inputDocuments: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];

  const notes: Record<string, string[]> = {
    slide_sequence: [],
    metric_benchmark: [],
    visual_design: [],
    narrative_arc: [],
    financial_health: [],
    risk_assessment: [],
  };

  const raw: Record<ScoreComponentKey, number | null> = {
    slide_sequence: getAnalyzerNumericScore("slide_sequence", results),
    metric_benchmark: getAnalyzerNumericScore("metric_benchmark", results),
    visual_design: getAnalyzerNumericScore("visual_design", results),
    narrative_arc: getAnalyzerNumericScore("narrative_arc", results),
    financial_health: getAnalyzerNumericScore("financial_health", results),
    risk_assessment: getAnalyzerNumericScore("risk_assessment", results),
  };

  const totalRisks = Array.isArray((dio as any).risk_map) ? (dio as any).risk_map.length : 0;
  const rawRisk = raw.risk_assessment;
  const riskLooksLikeNoSignal = rawRisk === 0 && totalRisks === 0;

  const componentMeta = {
    slide_sequence: getMeta(results?.slide_sequence),
    metric_benchmark: getMeta(results?.metric_benchmark),
    visual_design: getMeta(results?.visual_design),
    narrative_arc: getMeta(results?.narrative_arc),
    financial_health: getMeta(results?.financial_health),
    risk_assessment: getMeta(results?.risk_assessment),
  };

  // Determine which components are included in the aggregate
  const componentsInOrder = [
    "slide_sequence",
    "metric_benchmark",
    "visual_design",
    "narrative_arc",
    "financial_health",
    "risk_assessment",
  ] as const;

  const isPitchDeck = (ctx as any)?.primary_doc_type === "pitch_deck";
  const slidePatternMatch = typeof results?.slide_sequence?.pattern_match === "string" ? results.slide_sequence.pattern_match : "";
  const isTractionFirst = isPitchDeck && /traction/i.test(slidePatternMatch);

  const classificationSelectedPolicy = getSelectedPolicyIdFromAny(dio);

  const rubricEval = evaluatePolicyRubric(dio, classificationSelectedPolicy);

  // Policy-aware base weights (pre-normalization).
  // If classification exists, use policy weights; otherwise fall back to legacy context behavior.
  const baseWeights: ScoreExplanation["aggregation"]["weights"] = classificationSelectedPolicy
    ? getDealPolicy(classificationSelectedPolicy).weights
    : getContextWeights(ctx, docInventory);

  // Preserve the existing traction-first pitch deck override for the legacy context path.
  const adjustedBaseWeights: ScoreExplanation["aggregation"]["weights"] = !classificationSelectedPolicy && isPitchDeck && isTractionFirst
    ? {
        ...baseWeights,
        narrative_arc: 1.9,
        slide_sequence: 0.6,
      }
    : baseWeights;

  // CRITICAL: do not skip components. Always include expected components from getContextWeights().
  // When missing/non-ok/no-signal, we use neutral baseline (50) plus an explicit deterministic penalty.
  const weights: ScoreExplanation["aggregation"]["weights"] = {
    slide_sequence: adjustedBaseWeights.slide_sequence,
    metric_benchmark: adjustedBaseWeights.metric_benchmark,
    visual_design: adjustedBaseWeights.visual_design,
    narrative_arc: adjustedBaseWeights.narrative_arc,
    financial_health: adjustedBaseWeights.financial_health,
    risk_assessment: adjustedBaseWeights.risk_assessment,
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const toInvestmentScore = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    if (key === "risk_assessment") {
      return 100 - rawScore;
    }
    return rawScore;
  };

  const toEffectiveInvestmentScore = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    const invScore = toInvestmentScore(key, rawScore);
    const confidence = componentMeta[key].confidence;
    if (isFiniteNumber(confidence) && confidence < 0.5) {
      // Blend low-confidence components toward neutral baseline.
      // effective = invScore*confidence + 50*(1-confidence)
      return invScore * confidence + 50 * (1 - confidence);
    }
    return invScore;
  };

  const weightedContribution = (key: (typeof componentsInOrder)[number], rawScore: number): number => {
    if (totalWeight === 0) return 0;
    const w = (weights as any)[key] as number;
    if (!w) return 0;
    return (w / totalWeight) * toEffectiveInvestmentScore(key, rawScore);
  };

  const effectiveScores: Record<string, number | null> = {};
  const penalties: Record<string, number> = {};
  const usedScores: Record<string, number | null> = {};
  const componentDetails: Record<string, ComponentDetail> = {};
  const statuses: Record<string, string | null> = {};

  const penalize = (key: (typeof componentsInOrder)[number], kind: "missing" | "non_ok", why: string): void => {
    statuses[key] = kind === "missing" ? "penalized_missing" : "penalized_non_ok";
    usedScores[key] = 50;
    penalties[key] = kind === "missing" ? PENALTY_MISSING : PENALTY_NON_OK;
    notes[key].push(`${statuses[key]} -> used_score=50 penalty=${penalties[key]} (${why})`);
  };

  // Always compute a contribution for each component.
  const contributions: Record<string, number | null> = {};
  for (const key of componentsInOrder) {
    const status = componentMeta[key].status;
    const rawScore = raw[key];

    // Default outputs.
    statuses[key] = status;
    penalties[key] = 0;
    usedScores[key] = null;

    // Missing / warn / no-signal -> neutral + penalty.
    if (status == null) {
      penalize(key, "missing", "missing analyzer result");
    } else if (status !== "ok") {
      penalize(key, "non_ok", `status=${status}`);
    } else if (key === "risk_assessment" && riskLooksLikeNoSignal) {
      penalize(key, "non_ok", "no_signal (risk_score=0 and empty risk_map)");
    } else if (!isFiniteNumber(rawScore)) {
      if (key === "metric_benchmark") {
        const metricsCount = Array.isArray(results?.metric_benchmark?.metrics_analyzed)
          ? results.metric_benchmark.metrics_analyzed.length
          : 0;
        if (metricsCount === 0) notes[key].push("no metrics extracted");
      }
      penalize(key, "missing", "null score");
    } else {
      // OK path: use analyzer score (with risk inversion + low-confidence blending).
      statuses[key] = "ok";
      usedScores[key] = toEffectiveInvestmentScore(key, rawScore);

      const conf = componentMeta[key].confidence;
      if (isFiniteNumber(conf) && conf < 0.5) {
        notes[key].push(`low confidence (${conf.toFixed(2)} < 0.50) -> blended toward neutral baseline (50)`);
      }
      if (key === "risk_assessment") {
        notes[key].push(`risk inverted: ${rawScore} -> ${100 - rawScore}`);
      }
      if (key === "slide_sequence") {
        const deviationsCount = Array.isArray(results?.slide_sequence?.deviations)
          ? results.slide_sequence.deviations.length
          : 0;
        if (deviationsCount > 0) {
          notes[key].push(`${deviationsCount} sequence deviations detected`);
        }
      }
    }

    const used = usedScores[key];
    const penalty = penalties[key] ?? 0;
    const effective = used == null ? null : Math.min(100, Math.max(0, used - penalty));
    effectiveScores[key] = effective;

    const detail = buildComponentDetail({
      key,
      dio,
      results,
      status: componentMeta[key].status,
      computed_status: statuses[key],
      raw_score: rawScore,
      used_score: usedScores[key],
      penalty,
      confidence: componentMeta[key].confidence,
    });
    componentDetails[key] = detail;

    // Weighted contribution uses the effective score.
    if (effective == null) {
      contributions[key] = null;
      continue;
    }

    if (totalWeight === 0) {
      contributions[key] = 0;
      continue;
    }

    const w = (weights as any)[key] as number;
    if (!w) {
      contributions[key] = 0;
      continue;
    }
    contributions[key] = (w / totalWeight) * effective;
  }

  const unadjustedSum = Object.values(contributions)
    .reduce((sum: number, v) => sum + (isFiniteNumber(v) ? v : 0), 0);
  const unadjustedOverall = totalWeight > 0
    ? Math.round(unadjustedSum + 1e-9)
    : null;

  // For coverage/confidence, do not count analyzers excluded by the active policy.
  // This prevents excluded-by-policy components from dragging down coverage_ratio/evidence_factor.
  const enabledByPolicy = classificationSelectedPolicy
    ? new Set([
        ...getDealPolicy(classificationSelectedPolicy).required_analyzers,
        ...getDealPolicy(classificationSelectedPolicy).optional_analyzers,
      ])
    : null;

  const weightedKeys = componentsInOrder
    .filter(k => ((weights as any)[k] as number) > 0)
    .filter(k => (enabledByPolicy ? enabledByPolicy.has(k as any) : true));

  const coverageValues = weightedKeys.map((k) => {
    if (statuses[k] === "ok") return isFiniteNumber(componentMeta[k].coverage) ? (componentMeta[k].coverage as number) : 0;
    return 0;
  });
  const coverageRatio = coverageValues.length > 0
    ? clamp01(coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length)
    : 0;

  const confidenceValues = weightedKeys.map((k) => {
    if (statuses[k] === "ok") return isFiniteNumber(componentMeta[k].confidence) ? (componentMeta[k].confidence as number) : 0;
    return 0;
  });
  const analyzerConfidence = confidenceValues.length > 0
    ? clamp01(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
    : 0;

  const contextConfidence = isFiniteNumber((ctx as any)?.confidence) ? (ctx as any).confidence : 1;
  const confidenceScore = Math.min(1, Math.max(0, analyzerConfidence * contextConfidence));

  // Evidence + due diligence directly affect the final investment score by blending toward neutral baseline.
  // - evidence_factor: uses analyzer coverage as a proxy for how much supporting signal we actually had
  // - due_diligence_factor: uses document verification readiness when present
  // - adjustment_factor = evidence_factor * due_diligence_factor
  // - overall_score = unadjusted*adjustment + 50*(1-adjustment)
  let evidenceFactor = clamp01(0.5 + 0.5 * coverageRatio);

  // Policy behavior: execution_ready_v1 should not auto-fail for missing revenue.
  // Readiness evidence is required; if missing, keep the final score close to neutral (~50) even if other components are strong.
  if (classificationSelectedPolicy === "execution_ready_v1" && rubricEval) {
    const missingReadiness = rubricEval.missing_required.length;
    if (missingReadiness > 0) {
      const cap = missingReadiness >= 2 ? 0.1 : 0.15;
      if (evidenceFactor > cap) {
        evidenceFactor = cap;
        notes.metric_benchmark.push(
          `execution_ready_v1: missing required readiness signals (${missingReadiness}) -> evidence_factor capped to ${cap.toFixed(2)}`
        );
      }
    }
  }

  // Policy behavior: consumer_ecommerce_brand_v1 should not inflate without benchmarkable unit economics.
  // When core unit-econ KPIs are missing, keep the final score near neutral (~50-60).
  if (classificationSelectedPolicy === "consumer_ecommerce_brand_v1") {
    const present = getNormalizedPresenceSetForRubric(dio);
    const hasMargin = present.has("gross_margin_pct") || present.has("contribution_margin_pct") || present.has("gross_margin") || present.has("contribution_margin");
    const hasCac = present.has("cac");
    const hasLtv = present.has("ltv") || present.has("ltv_to_cac") || present.has("ltv_cac");
    const hasAov = present.has("aov");
    const coreCount = [hasMargin, hasCac, hasLtv, hasAov].filter(Boolean).length;
    if (coreCount < 2) {
      const cap = 0.22;
      if (evidenceFactor > cap) {
        evidenceFactor = cap;
        notes.metric_benchmark.push(
          `consumer_ecommerce_brand_v1: missing core unit economics KPIs (${coreCount}) -> evidence_factor capped to ${cap.toFixed(2)}`
        );
      }
    }
  }

  const getDueDiligenceReadiness = (docs: any[]): number => {
    if (docs.length === 0) return 1;

    const perDoc: number[] = [];

    for (const doc of docs) {
      const status = typeof doc?.verification_status === "string" ? doc.verification_status : null;
      const vr = doc?.verification_result;
      const overall = isFiniteNumber(vr?.overall_score) ? vr.overall_score : null;

      let readiness: number | null = null;

      if (status) {
        if (status === "verified") readiness = 1;
        else if (status === "warnings") readiness = 0.75;
        else if (status === "failed") readiness = 0.4;
        else readiness = 0.6;
      } else if (overall !== null) {
        readiness = clamp01(overall);
      }

      if (readiness !== null) {
        // If both status and numeric score exist, use the more conservative one.
        if (overall !== null) readiness = Math.min(readiness, clamp01(overall));
        perDoc.push(readiness);
      }
    }

    // If no verification metadata is present (older DIOs), do not penalize.
    if (perDoc.length === 0) return 1;

    return clamp01(perDoc.reduce((a, b) => a + b, 0) / perDoc.length);
  };

  const dueDiligenceReadiness = getDueDiligenceReadiness(inputDocuments);
  const dueDiligenceFactor = clamp01(0.5 + 0.5 * dueDiligenceReadiness);
  const adjustmentFactor = clamp01(evidenceFactor * dueDiligenceFactor);

  let overall = unadjustedOverall === null
    ? null
    : Math.round(unadjustedOverall * adjustmentFactor + 50 * (1 - adjustmentFactor));

  // Policy rubric caps: if critical red flags are present, cap overall below the "75+" threshold.
  if (overall !== null && rubricEval && Array.isArray(rubricEval.red_flags_triggered) && rubricEval.red_flags_triggered.length > 0) {
    const cap = 70;
    if (overall > cap) {
      overall = cap;
      notes.risk_assessment.push(`rubric cap applied (${cap}) due to red_flags: ${rubricEval.red_flags_triggered.join(", ")}`);
    }
  }

  // Policy semantics: operating_startup_revenue_v1
  // - Revenue alone cannot exceed 70
  // - >75 requires strong execution signals + acceptable risk
  if (classificationSelectedPolicy === "operating_startup_revenue_v1") {
    const riskInvestmentScore = effectiveScores.risk_assessment ?? null;
    const capResult = computeOperatingStartupRevenueV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
      riskInvestmentScore,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`operating_startup_revenue_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      // Keep deterministic breadcrumbs in component notes for auditability.
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
    }
  }

  // Policy semantics: consumer_fintech_platform_v1
  // - Revenue alone cannot exceed 70
  // - >75 requires adoption/volume evidence + acceptable risk
  // - Unmitigated regulatory/fraud risk caps final score <=70
  if (classificationSelectedPolicy === "consumer_fintech_platform_v1") {
    const riskInvestmentScore = effectiveScores.risk_assessment ?? null;
    const metricInvestmentScore = effectiveScores.metric_benchmark ?? null;
    const capResult = computeConsumerFintechPlatformV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
      riskInvestmentScore,
      metricInvestmentScore,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`consumer_fintech_platform_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
    }
  }

  // Policy semantics: consumer_ecommerce_brand_v1
  // - 75+ requires strong unit economics (LTV:CAC + margins) AND acceptable risk
  // - missing core unit economics KPIs caps score near neutral
  // - policy gating caps must not populate rubric.red_flags_triggered (handled in diagnostics)
  if (classificationSelectedPolicy === "consumer_ecommerce_brand_v1") {
    const riskInvestmentScore = effectiveScores.risk_assessment ?? null;
    const metricInvestmentScore = effectiveScores.metric_benchmark ?? null;
    const capResult = computeConsumerEcommerceBrandV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
      riskInvestmentScore,
      metricInvestmentScore,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`consumer_ecommerce_brand_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
    }
  }

  // Policy semantics: enterprise_saas_b2b_v1
  // - Revenue-only cannot exceed 70
  // - Bad retention caps at 60
  // - >75 requires 3 quality signals (retention + unit economics + sales motion)
  if (classificationSelectedPolicy === "enterprise_saas_b2b_v1") {
    const capResult = computeEnterpriseSaasB2BV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`enterprise_saas_b2b_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
    }
  }

  // Policy semantics: healthcare_biotech_v1
  // - >75 requires clear regulatory path + validation + team credibility + realistic timeline/costs
  // - Regulatory path unclear caps at 60 (explicit diagnostic)
  // - Safety/ethics risk caps at 50 (red_flags bucket)
  if (classificationSelectedPolicy === "healthcare_biotech_v1") {
    const capResult = computeHealthcareBiotechV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`healthcare_biotech_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
      if (d.bucket === "red_flags") notes.risk_assessment.push(d.text);
    }
  }

  // Policy semantics: media_entertainment_ip_v1
  // - >75 requires verifiable rights + (distribution/MG/pre-sales OR (strong attachments + financing + completion bond))
  // - Missing revenue acceptable if contracts/attachments are strong and structure is financeable
  // - Red flags cap at 60 (rights unclear, no distribution path, aggressive assumptions w/o comps, waterfall/recoupment unclear)
  if (classificationSelectedPolicy === "media_entertainment_ip_v1") {
    const capResult = computeMediaEntertainmentIpV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`media_entertainment_ip_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
      if (d.bucket === "red_flags") notes.risk_assessment.push(d.text);
    }
  }

  // Policy semantics: physical_product_cpg_spirits_v1
  // - >75 requires: strong GM + repeat/velocity + distribution traction OR signed distribution agreements + working capital plan
  // - Missing revenue is acceptable when execution-ready distribution is present (diagnostic only)
  // - Policy-local red flag caps for negative margins / severe chargebacks / unclear TTB compliance / no distribution path
  if (classificationSelectedPolicy === "physical_product_cpg_spirits_v1") {
    const capResult = computePhysicalProductCpgSpiritsV1Caps({
      dio,
      overall,
      unadjustedOverall,
      adjustmentFactor,
    });
    if (capResult.capped_overall !== overall) {
      const cap = capResult.capped_overall;
      if (typeof cap === "number") {
        notes.metric_benchmark.push(`physical_product_cpg_spirits_v1: policy cap applied -> overall_score=${cap}`);
      }
    }
    overall = capResult.capped_overall;
    for (const d of capResult.diagnostics) {
      if (d.bucket === "coverage_gaps") notes.metric_benchmark.push(d.text);
      if (d.bucket === "positive_signals") notes.metric_benchmark.push(d.text);
    }
  }

  const mkComponent = (key: (typeof componentsInOrder)[number]): ScoreComponent => {
    const { status, coverage, confidence } = componentMeta[key];
    const rawScore = raw[key];
    const wc = contributions[key];
    const hasDebug = Boolean((results as any)?.[key]?.debug_scoring);
    const debug_ref = hasDebug ? `dio.analyzer_results.${key}.debug_scoring` : undefined;
    const detail = (componentDetails[key] ?? {
      reason: "Neutral baseline used",
      reasons: ["Neutral baseline used"],
      evidence_ids: [],
      gaps: [],
      red_flags: [],
    }) as ComponentDetail;

    return {
      status: statuses[key] ?? status,
      used_score: usedScores[key],
      penalty: penalties[key] ?? 0,
      reason: detail.reason,
      reasons: detail.reasons,
      evidence_ids: detail.evidence_ids,
      gaps: detail.gaps,
      red_flags: detail.red_flags,
      coverage,
      confidence,
      raw_score: rawScore,
      weighted_contribution: wc,
      notes: notes[key],
      debug_ref,
    };
  };

  return {
    context: ctx,
    aggregation: {
      method: "weighted_mean",
      policy_id: classificationSelectedPolicy,
      weights,
      included_components: [...componentsInOrder],
      excluded_components: [],
    },
    components: {
      slide_sequence: mkComponent("slide_sequence"),
      metric_benchmark: mkComponent("metric_benchmark"),
      visual_design: mkComponent("visual_design"),
      narrative_arc: mkComponent("narrative_arc"),
      financial_health: mkComponent("financial_health"),
      risk_assessment: {
        ...mkComponent("risk_assessment"),
        inverted_investment_score:
          statuses.risk_assessment === "ok" && isFiniteNumber(rawRisk) && !riskLooksLikeNoSignal
            ? 100 - rawRisk
            : 50,
      },
    },
    totals: {
      overall_score: overall,
      unadjusted_overall_score: unadjustedOverall,
      coverage_ratio: coverageRatio,
      confidence_score: confidenceScore,
      evidence_factor: evidenceFactor,
      due_diligence_factor: dueDiligenceFactor,
      adjustment_factor: adjustmentFactor,
    },
  };
}

const mapComponentStatusForDiagnostics = (status: string | null): string => {
  if (!status) return "error";
  if (status === "ok") return "ok";
  if (status === "insufficient_data") return "insufficient_data";
  if (status.startsWith("penalized")) return "penalized";
  if (status === "extraction_failed") return "error";
  return status;
};

export function buildScoringDiagnosticsFromDIO(dio: DealIntelligenceObject): ScoringDiagnosticsV1 {
  const explanation = buildScoreExplanationFromDIO(dio);
  const rubricEval = evaluatePolicyRubric(dio, explanation.aggregation.policy_id);

  const componentsInOrder = [
    "slide_sequence",
    "metric_benchmark",
    "visual_design",
    "narrative_arc",
    "financial_health",
    "risk_assessment",
  ] as const;

  const components: ScoringDiagnosticsV1["components"] = {};

  for (const key of componentsInOrder) {
    const c: any = (explanation.components as any)[key];
    const weight = (explanation.aggregation.weights as any)[key] as number;
    components[key] = {
      status: mapComponentStatusForDiagnostics(typeof c?.status === "string" ? c.status : null),
      raw_score: typeof c?.raw_score === "number" ? c.raw_score : null,
      used_score: typeof c?.used_score === "number" ? c.used_score : null,
      weight: typeof weight === "number" ? weight : 0,
      confidence: typeof c?.confidence === "number" ? c.confidence : null,
      reason: typeof c?.reason === "string" && c.reason.trim() ? c.reason : "Neutral baseline used",
      reasons: Array.isArray(c?.reasons) ? (c.reasons as string[]) : [],
      evidence_ids: Array.isArray(c?.evidence_ids) ? (c.evidence_ids as string[]) : [],
      gaps: Array.isArray(c?.gaps) ? (c.gaps as string[]) : [],
      red_flags: Array.isArray(c?.red_flags) ? (c.red_flags as string[]) : [],
    };
  }

  const buckets: ScoringDiagnosticsV1["buckets"] = {
    positive_signals: [],
    red_flags: [],
    coverage_gaps: [],
  };

  for (const key of componentsInOrder) {
    const comp = components[key];
    const evidence_ids = Array.isArray(comp.evidence_ids) ? comp.evidence_ids : [];

    if (Array.isArray(comp.red_flags) && comp.red_flags.length > 0) {
      for (const text of comp.red_flags) {
        buckets.red_flags.push({ component: key, text, evidence_ids });
      }
    }

    if ((Array.isArray(comp.gaps) && comp.gaps.length > 0) || comp.status === "insufficient_data" || comp.status === "penalized" || comp.status === "error") {
      buckets.coverage_gaps.push({ component: key, text: comp.reason, evidence_ids });
    }

    const used = typeof comp.used_score === "number" ? comp.used_score : null;
    if (comp.status === "ok" && used !== null && used >= 60 && (!Array.isArray(comp.red_flags) || comp.red_flags.length === 0)) {
      buckets.positive_signals.push({ component: key, text: comp.reason, evidence_ids });
    }
  }

  const overall_score = explanation.totals.overall_score ?? 50;
  const unadjusted_overall_score = explanation.totals.unadjusted_overall_score ?? 50;

  // Policy-scoped: for real_estate_underwriting, explicitly explain why a 75+ score is justified.
  // This is additive only (does not remove/alter existing diagnostics).
  if (explanation.aggregation.policy_id === "real_estate_underwriting") {
    const docs: any[] = Array.isArray((dio as any)?.inputs?.documents) ? (dio as any).inputs.documents : [];
    const combinedText = docs
      .map((d) => (typeof d?.textSummary === "string" ? d.textSummary : typeof d?.text_summary === "string" ? d.text_summary : ""))
      .filter(Boolean)
      .join("\n\n");

    // Build a metrics map from the metric_benchmark analyzer output when available.
    const metricsAnalyzed: any[] = Array.isArray((dio as any)?.analyzer_results?.metric_benchmark?.metrics_analyzed)
      ? (dio as any).analyzer_results.metric_benchmark.metrics_analyzed
      : [];
    const metricsMap: Record<string, number> = {};
    for (const m of metricsAnalyzed) {
      if (typeof m?.metric !== "string") continue;
      if (typeof m?.value !== "number" || !Number.isFinite(m.value)) continue;
      metricsMap[m.metric] = m.value;
    }

    const protections = detectRealEstateUnderwritingProtections({ pitch_text: combinedText, metrics: metricsMap });
    if (protections.fully_protected || protections.protections_score >= 4) {
      const mb: any = (explanation.components as any).metric_benchmark;
      const evidence_ids = Array.isArray(mb?.evidence_ids) ? (mb.evidence_ids as string[]) : [];

      const hasCashFlows = !buckets.positive_signals.some((b) => b.text === "Contracted cash flows");
      const hasDownside = !buckets.positive_signals.some((b) => b.text === "Downside protection via lease/guarantees");

      if (hasCashFlows) buckets.positive_signals.push({ component: "metric_benchmark", text: "Contracted cash flows", evidence_ids });
      if (hasDownside) buckets.positive_signals.push({ component: "metric_benchmark", text: "Downside protection via lease/guarantees", evidence_ids });
    }
  }

  // Add rubric-derived diagnostics as first-class fields + buckets.
  let rubric: ScoringDiagnosticsV1["rubric"] = undefined;
  if (rubricEval) {
    const preCap = Math.round(unadjusted_overall_score * explanation.totals.adjustment_factor + 50 * (1 - explanation.totals.adjustment_factor));
    const redFlagCap = 70;
    const scoreCapAppliedFromRedFlags = rubricEval.red_flags_triggered.length > 0 && preCap > redFlagCap && overall_score === redFlagCap ? redFlagCap : null;

    // Policy-specific cap reporting (additive).
    const policyId = explanation.aggregation.policy_id;
    const policyCap = policyId === "operating_startup_revenue_v1"
      ? computeOperatingStartupRevenueV1Caps({
          dio,
          overall: overall_score,
          unadjustedOverall: unadjusted_overall_score,
          adjustmentFactor: explanation.totals.adjustment_factor,
          riskInvestmentScore: typeof (components as any)?.risk_assessment?.used_score === "number" ? (components as any).risk_assessment.used_score : null,
        }).cap_applied
      : policyId === "enterprise_saas_b2b_v1"
        ? computeEnterpriseSaasB2BV1Caps({
            dio,
            overall: overall_score,
            unadjustedOverall: unadjusted_overall_score,
            adjustmentFactor: explanation.totals.adjustment_factor,
          }).cap_applied
      : policyId === "healthcare_biotech_v1"
        ? computeHealthcareBiotechV1Caps({
            dio,
            overall: overall_score,
            unadjustedOverall: unadjusted_overall_score,
            adjustmentFactor: explanation.totals.adjustment_factor,
          }).cap_applied
      : policyId === "media_entertainment_ip_v1"
        ? computeMediaEntertainmentIpV1Caps({
            dio,
            overall: overall_score,
            unadjustedOverall: unadjusted_overall_score,
            adjustmentFactor: explanation.totals.adjustment_factor,
          }).cap_applied
      : policyId === "physical_product_cpg_spirits_v1"
        ? computePhysicalProductCpgSpiritsV1Caps({
            dio,
            overall: overall_score,
            unadjustedOverall: unadjusted_overall_score,
            adjustmentFactor: explanation.totals.adjustment_factor,
          }).cap_applied
      : policyId === "consumer_ecommerce_brand_v1"
        ? computeConsumerEcommerceBrandV1Caps({
            dio,
            overall: overall_score,
            unadjustedOverall: unadjusted_overall_score,
            adjustmentFactor: explanation.totals.adjustment_factor,
            riskInvestmentScore: typeof (components as any)?.risk_assessment?.used_score === "number" ? (components as any).risk_assessment.used_score : null,
            metricInvestmentScore: typeof (components as any)?.metric_benchmark?.used_score === "number" ? (components as any).metric_benchmark.used_score : null,
          }).cap_applied
        : policyId === "consumer_fintech_platform_v1"
          ? computeConsumerFintechPlatformV1Caps({
              dio,
              overall: overall_score,
              unadjustedOverall: unadjusted_overall_score,
              adjustmentFactor: explanation.totals.adjustment_factor,
              riskInvestmentScore: typeof (components as any)?.risk_assessment?.used_score === "number" ? (components as any).risk_assessment.used_score : null,
              metricInvestmentScore: typeof (components as any)?.metric_benchmark?.used_score === "number" ? (components as any).metric_benchmark.used_score : null,
            }).cap_applied
        : null;

    const scoreCapApplied = scoreCapAppliedFromRedFlags ?? policyCap ?? null;

    rubric = {
      id: rubricEval.id,
      required_signals: rubricEval.required_signals,
      missing_required: rubricEval.missing_required,
      positive_drivers_present: rubricEval.positive_drivers_present,
      acceptable_missing_present: rubricEval.acceptable_missing_present,
      red_flags_triggered: rubricEval.red_flags_triggered,
      has_revenue_metric: rubricEval.has_revenue_metric,
      score_cap_applied: scoreCapApplied,
    };

    if (rubricEval.missing_required.length > 0) {
      buckets.coverage_gaps.push({
        component: "rubric",
        text: `Missing required signals: ${rubricEval.missing_required.join(", ")}`,
        evidence_ids: [],
      });
    }
    if (rubricEval.red_flags_triggered.length > 0) {
      buckets.red_flags.push({
        component: "rubric",
        text: `Rubric red flags: ${rubricEval.red_flags_triggered.join(", ")}`,
        evidence_ids: [],
      });
    }
  }

  // Add explicit policy diagnostics for operating_startup_revenue_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "operating_startup_revenue_v1") {
    const cap = computeOperatingStartupRevenueV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
      riskInvestmentScore: typeof (components as any)?.risk_assessment?.used_score === "number" ? (components as any).risk_assessment.used_score : null,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
    }
  }

  // Add explicit policy diagnostics for healthcare_biotech_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "healthcare_biotech_v1") {
    const cap = computeHealthcareBiotechV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
      if (d.bucket === "red_flags") buckets.red_flags.push(item);
    }
  }

  // Add explicit policy diagnostics for media_entertainment_ip_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "media_entertainment_ip_v1") {
    const cap = computeMediaEntertainmentIpV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
      if (d.bucket === "red_flags") buckets.red_flags.push(item);
    }
  }

  // Add explicit policy diagnostics for consumer_ecommerce_brand_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "consumer_ecommerce_brand_v1") {
    const cap = computeConsumerEcommerceBrandV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
      riskInvestmentScore: typeof (components as any)?.risk_assessment?.used_score === "number" ? (components as any).risk_assessment.used_score : null,
      metricInvestmentScore: typeof (components as any)?.metric_benchmark?.used_score === "number" ? (components as any).metric_benchmark.used_score : null,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
    }
  }

  // Add explicit policy diagnostics for consumer_fintech_platform_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "consumer_fintech_platform_v1") {
    const cap = computeConsumerFintechPlatformV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
      riskInvestmentScore: typeof (components as any)?.risk_assessment?.used_score === "number" ? (components as any).risk_assessment.used_score : null,
      metricInvestmentScore: typeof (components as any)?.metric_benchmark?.used_score === "number" ? (components as any).metric_benchmark.used_score : null,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
    }
  }

  // Add explicit policy diagnostics for enterprise_saas_b2b_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "enterprise_saas_b2b_v1") {
    const cap = computeEnterpriseSaasB2BV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
    }
  }

  // Add explicit policy diagnostics for physical_product_cpg_spirits_v1 (diagnostics-first).
  if (explanation.aggregation.policy_id === "physical_product_cpg_spirits_v1") {
    const cap = computePhysicalProductCpgSpiritsV1Caps({
      dio,
      overall: overall_score,
      unadjustedOverall: unadjusted_overall_score,
      adjustmentFactor: explanation.totals.adjustment_factor,
    });

    for (const d of cap.diagnostics) {
      const item = { component: "policy", text: d.text, evidence_ids: [] as string[] };
      if (d.bucket === "positive_signals") buckets.positive_signals.push(item);
      if (d.bucket === "coverage_gaps") buckets.coverage_gaps.push(item);
    }
  }

  return {
    policy_id: explanation.aggregation.policy_id,
    overall_score,
    unadjusted_overall_score,
    adjustment_factor: explanation.totals.adjustment_factor,
    evidence_factor: explanation.totals.evidence_factor,
    due_diligence_factor: explanation.totals.due_diligence_factor,
    coverage_ratio: explanation.totals.coverage_ratio,
    components,
    buckets,
    rubric,
  };
}
