/**
 * Orchestrator Report Builder (v1)
 *
 * Produces a ddai_orchestrator_report_v1 object by composing already-computed
 * sections from the investor insights render package.
 *
 * NO new LLM calls.
 * NO DB writes.
 * NO mutations to existing sections.
 * Pure deterministic composition + aggregation.
 *
 * Authoritative contracts:
 *   docs/Active/orchestractor/DDAI_JSON_CONTRACT_v1.md
 *   docs/Active/orchestractor/DDAI_CORE_SCORING_MODEL_v1.md
 *   docs/Active/orchestractor/DDAI_DCI_v1.md
 *   docs/Active/orchestractor/DDAI_FHC_v1.md
 */

import type { OrchestratorRenderPackageInput } from './render-package-input';
import type {
  OrchestratorReportV1,
  OrchestratorSegments,
  ExecutiveSummarySegment,
  DealTermsSegment,
  MarketSegment,
  FinancialSegment,
  RiskVerificationSegment,
  CanonicalFieldSnapshot,
  ConflictEntry,
  EvidenceRegistry,
  OrchestratorDiagnostics,
  StructureRating,
  TopRisk,
  VerificationRequest,
  FinancialLayoutClassification,
  FinancialReconciliation,
  ReconciliationFlag,
} from './types';

import {
  findSectionBody,
  findSectionItems,
  hasSectionKey,
  parseCoverageSnapshot,
  parseLayoutClassifier,
  parseReconciliation,
  parseCanonicalFieldsBody,
  parseConflictsBody,
  parseDeckFinancialSignals,
  parseExecutiveSummaryBody,
  detectStage,
} from './render-package-helpers';

import { computeDocumentConfidenceIndex, type DciRawInputs } from './compute-dci';
import { computeFinancialHealthComposite, type FhcRawInputs } from './compute-fhc';
import {
  computeUnifiedRiskSeverity,
  type UrssInputs,
  type UrssConflict,
} from './compute-urss';
import {
  computeMarketScoreRaw,
  computeMarketScorePersisted,
  computeOverallRecommendationScore,
  computeDecision,
  type DecisionInputs,
} from './compute-ors';

// ─── Public type alias ───────────────────────────────────────────────────────

/** Alias for the render package input type used as the orchestrator's primary input. */
export type InvestorInsightsRenderPackage = OrchestratorRenderPackageInput;

// ─── Critical canonical fields set ───────────────────────────────────────────

/**
 * The subset of canonical field names that must be Computable for a complete
 * investment terms picture. Absence of any of these is reported as a
 * missing_critical_term.
 */
const CRITICAL_CANONICAL_FIELDS = new Set([
  "raise_amount",
  "raise_instrument",
  "raise_cap",
  "raise_discount",
  "valuation_post",
  "use_of_funds_buckets",
  "tam_value",
  "sam_value",
  "som_value",
]);

// ─── Segment builders ────────────────────────────────────────────────────────

function buildExecutiveSummarySegment(rp: OrchestratorRenderPackageInput): ExecutiveSummarySegment {
  const body = findSectionBody(rp, "governed_executive_summary_v1");
  const parsed = parseExecutiveSummaryBody(body);

  return {
    headline: parsed?.headline ?? "",
    summary_paragraphs: parsed?.summary_paragraphs ?? [],
    strengths: parsed?.strengths ?? [],
    risks: parsed?.risks ?? [],
    open_questions: parsed?.open_questions ?? [],
    evidence_refs: [],
  };
}

function buildDealTermsSegment(
  canonicalFields: ReturnType<typeof parseCanonicalFieldsBody>,
  conflicts: ReturnType<typeof parseConflictsBody>
): DealTermsSegment {
  // Snapshot of raise_terms + valuation_terms + use_of_funds fields
  const DEAL_TERM_CATEGORIES = new Set(["raise_terms", "valuation_terms", "use_of_funds"]);
  const snapshot: CanonicalFieldSnapshot[] = canonicalFields
    .filter((f) => DEAL_TERM_CATEGORIES.has(f.category))
    .map((f) => ({
      field: f.field,
      value: f.value,
      source: (f.source_type === "xlsx"
        ? "xlsx"
        : f.source_type === "deck"
          ? "deck"
          : "unknown") as CanonicalFieldSnapshot["source"],
      evidence_refs: f.evidence ? [f.evidence] : [],
    }));

  const missingTerms = canonicalFields
    .filter((f) => DEAL_TERM_CATEGORIES.has(f.category) && f.computability !== "Computable")
    .map((f) => f.field);

  // Heuristic structure assessment based on field presence
  const hasValuationPost = canonicalFields.some(
    (f) => f.field === "valuation_post" && f.computability === "Computable"
  );
  const hasRaiseAmount = canonicalFields.some(
    (f) => f.field === "raise_amount" && f.computability === "Computable"
  );
  const hasInstrument = canonicalFields.some(
    (f) => f.field === "raise_instrument" && f.computability === "Computable"
  );
  const hasUoF = canonicalFields.some(
    (f) => f.field === "use_of_funds_buckets" && f.computability === "Computable"
  );
  const hasConflicts = conflicts.length > 0;

  const rate = (conditions: boolean[]): StructureRating => {
    const score = conditions.filter(Boolean).length / conditions.length;
    if (score >= 0.75) return "High";
    if (score >= 0.4) return "Medium";
    return "Low";
  };

  const narrative =
    snapshot.length > 0
      ? `${snapshot.filter((f) => f.value).length}/${snapshot.length} deal term fields populated.${hasConflicts ? ` ${conflicts.length} cross-source conflict(s) detected.` : ""}`
      : "No deal term fields extracted from this document.";

  return {
    narrative,
    structure_assessment: {
      simplicity: rate([hasRaiseAmount, hasInstrument, !hasConflicts]),
      dilution_visibility: rate([hasValuationPost, hasInstrument]),
      valuation_clarity: rate([hasValuationPost, hasRaiseAmount]),
      downside_protection: rate([hasInstrument, hasValuationPost, hasUoF]),
    },
    missing_terms: missingTerms,
    canonical_fields_snapshot: snapshot,
  };
}

function buildMarketSegment(
  canonicalFields: ReturnType<typeof parseCanonicalFieldsBody>,
  marketScorePersisted: number,
  missingMarketInputs: string[],
  rp: OrchestratorRenderPackageInput
): MarketSegment {
  const MARKET_CATEGORIES = new Set(["market_claims", "traction_signal"]);
  const marketFields = canonicalFields.filter((f) => MARKET_CATEGORIES.has(f.category));

  // KPIs from market and traction fields
  const kpis = marketFields
    .filter((f) => f.computability === "Computable" && f.value)
    .map((f) => ({
      label: f.field.replace(/_/g, " "),
      value: f.value!,
      evidence_refs: f.evidence ? [f.evidence] : [],
    }));

  // Derive basic strengths / concerns
  const strengths: string[] = [];
  const concerns: string[] = [];

  const hasRevenue = marketFields.some(
    (f) =>
      (f.field === "revenue_value" || f.field === "arr_value" || f.field === "mrr_value") &&
      f.computability === "Computable"
  );
  const hasTam = marketFields.some(
    (f) => f.field === "tam_value" && f.computability === "Computable"
  );
  const hasGrowth = marketFields.some(
    (f) => f.field === "growth_rate" && f.computability === "Computable"
  );
  if (hasRevenue) strengths.push("Revenue traction signal present in documentation.");
  if (hasTam) strengths.push("TAM/market sizing claim documented.");
  if (hasGrowth) strengths.push("Growth rate signal detected.");
  if (!hasTam) concerns.push("Market size (TAM/SAM/SOM) not clearly stated.");
  if (!hasRevenue) concerns.push("No explicit revenue figure found in documentation.");

  // Pass-through insight_slots narrative as ai_insight
  const insightSlotsBody = findSectionBody(rp, "insight_slots") ?? "";
  const ai_insight = insightSlotsBody.slice(0, 800).trim();

  return {
    narrative: kpis.length > 0
      ? `${kpis.length} market/traction signal(s) extracted from documentation.`
      : "No market or traction signals extracted from this document.",
    score: marketScorePersisted,
    kpis,
    strengths,
    concerns,
    ai_insight,
    missing_inputs: missingMarketInputs,
    evidence_refs: marketFields
      .filter((f) => f.evidence)
      .map((f) => f.evidence!)
      .slice(0, 10),
  };
}

function buildFinancialSegment(
  rp: OrchestratorRenderPackageInput,
  warnings: string[]
): FinancialSegment {
  const layoutBody = findSectionBody(rp, "financial_layout_classifier_v1");
  const layout = parseLayoutClassifier(layoutBody);
  const recBody = findSectionBody(rp, "financial_reconciliation_v1");
  const rec = parseReconciliation(recBody);

  // Layout classification — safe defaults when absent
  const layoutClassification: FinancialLayoutClassification = {
    layout_coverage_pct: layout?.layout_coverage_pct ?? 0,
    has_income_statement: layout?.has_income_statement ?? false,
    has_use_of_funds: layout?.has_use_of_funds ?? false,
    has_budget_model: layout?.has_budget_model ?? false,
    has_cap_table: layout?.has_cap_table ?? false,
    has_cash_flow: layout?.has_cash_flow ?? false,
    has_balance_sheet: layout?.has_balance_sheet ?? false,
    has_saas_kpis: layout?.has_saas_kpis ?? false,
  };

  // Reconciliation — empty when absent
  const reconciliation: FinancialReconciliation = {
    confidence_score: rec?.confidence_score ?? 0,
    flags: (rec?.flags ?? []).map(
      (f): ReconciliationFlag => ({
        name: f.key,
        status: f.status,
        evidence_refs: [],
        note: f.reason ?? null,
      })
    ),
  };

  if (!layout) warnings.push("financial_layout_classifier_v1 section absent — financial layout data unavailable.");
  if (!rec) warnings.push("financial_reconciliation_v1 section absent — reconciliation data unavailable.");

  // Strengths / considerations from XLSX presence
  const strengths: string[] = [];
  const considerations: string[] = [];
  if (layoutClassification.has_income_statement) strengths.push("Income statement present in XLSX.");
  if (layoutClassification.has_cash_flow) strengths.push("Cash flow statement present in XLSX.");
  if (layoutClassification.has_saas_kpis) strengths.push("SaaS KPI sheet present in XLSX.");
  if (!layoutClassification.has_income_statement) considerations.push("No income statement detected — revenue/cost basis unverified.");
  if (!layoutClassification.has_cash_flow) considerations.push("No cash flow statement — burn/runway cannot be independently verified.");
  if (rec) {
    const failCount = rec.flags.filter((f) => f.status === "FAIL").length;
    const warnCount = rec.flags.filter((f) => f.status === "WARN").length;
    if (failCount > 0)
      considerations.push(`${failCount} reconciliation flag(s) FAILED — review financial consistency.`);
    if (warnCount > 0)
      considerations.push(`${warnCount} reconciliation flag(s) WARN — minor inconsistencies detected.`);
  }

  // Benchmarks: pass through financial health metrics if section present
  const benchmarks = buildFinancialBenchmarks(rp);

  return {
    narrative_paragraphs: [
      `XLSX layout coverage: ${layoutClassification.layout_coverage_pct.toFixed(1)}%.`,
      rec
        ? `Reconciliation confidence: ${(rec.confidence_score * 100).toFixed(0)}% across ${rec.flags.length} financial checks.`
        : "No financial reconciliation data available.",
    ].filter(Boolean),
    strengths,
    considerations,
    benchmarks,
    layout_classification: layoutClassification,
    reconciliation,
  };
}

function buildFinancialBenchmarks(rp: OrchestratorRenderPackageInput): FinancialSegment["benchmarks"] {
  const healthBody = findSectionBody(rp, "financial_health_metrics_v1")
    ?? findSectionBody(rp, "financial_health_v1")
    ?? findSectionBody(rp, "financial_statement_v1");
  if (!healthBody) return [];

  const benchmarks: FinancialSegment["benchmarks"] = [];
  for (const line of healthBody.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("schema_version") || trimmed.startsWith("source")) continue;
    // Lines like: `gross_margin: 65.4%` or `runway_months: 14.2`
    const colIdx = trimmed.indexOf(":");
    if (colIdx === -1) continue;
    const label = trimmed.slice(0, colIdx).trim().replace(/_/g, " ");
    const value = trimmed.slice(colIdx + 1).trim();
    if (!value || value === "null" || value === "undefined") continue;
    benchmarks.push({
      label,
      value,
      basis: "direct",
      evidence_refs: [],
    });
    if (benchmarks.length >= 10) break;
  }
  return benchmarks;
}

function buildRiskVerificationSegment(
  canonicalFields: ReturnType<typeof parseCanonicalFieldsBody>,
  conflicts: ReturnType<typeof parseConflictsBody>,
  gateResults: Array<{ gate: string; passed: boolean; reason_code?: string | null }>,
  missingCriticalTerms: string[],
  textCoveragePct: number,
  warnings: string[]
): RiskVerificationSegment {
  const gatesFailed = gateResults.filter((g) => !g.passed).length;

  // Convert parsed conflicts to contract ConflictEntry shape
  const contractConflicts: ConflictEntry[] = conflicts.map((c) => ({
    field: c.field,
    a: c.value_a,
    b: c.value_b,
    source_a: (c.source_a === "xlsx" || c.source_a === "deck" ? c.source_a : "other") as ConflictEntry["source_a"],
    source_b: (c.source_b === "xlsx" || c.source_b === "deck" ? c.source_b : "other") as ConflictEntry["source_b"],
    evidence_refs: [
      ...(c.evidence_a ? [c.evidence_a] : []),
      ...(c.evidence_b ? [c.evidence_b] : []),
    ],
  }));

  // Top risks: derived from missing terms + conflicts + gate failures
  const topRisks: TopRisk[] = [];

  if (missingCriticalTerms.length > 0) {
    topRisks.push({
      risk: `${missingCriticalTerms.length} critical term(s) not disclosed: ${missingCriticalTerms.slice(0, 3).join(", ")}${missingCriticalTerms.length > 3 ? "…" : ""}`,
      severity: missingCriticalTerms.length >= 4 ? "High" : "Medium",
      drivers: missingCriticalTerms.slice(0, 5),
      evidence_refs: [],
    });
  }

  if (conflicts.length > 0) {
    topRisks.push({
      risk: `${conflicts.length} cross-source data conflict(s) detected — requires investor verification`,
      severity: conflicts.length >= 3 ? "High" : "Medium",
      drivers: conflicts.map((c) => `${c.field}: ${c.value_a ?? "?"} vs ${c.value_b ?? "?"}`).slice(0, 4),
      evidence_refs: [],
    });
  }

  if (gatesFailed > 0) {
    topRisks.push({
      risk: `${gatesFailed} readiness gate(s) not passed`,
      severity: gatesFailed >= 3 ? "Critical" : "Medium",
      drivers: gateResults
        .filter((g) => !g.passed)
        .map((g) => `${g.gate}: ${g.reason_code ?? "no reason code"}`)
        .slice(0, 4),
      evidence_refs: [],
    });
  }

  // Verification requests
  const requests: VerificationRequest[] = [];
  if (missingCriticalTerms.length > 0) {
    requests.push({
      request: `Provide documentation for missing critical terms: ${missingCriticalTerms.slice(0, 3).join(", ")}`,
      priority: "P0",
      why: "Missing critical investment terms prevent complete financial and legal assessment.",
      evidence_refs: [],
    });
  }
  if (conflicts.length > 0) {
    requests.push({
      request: `Resolve ${conflicts.length} data conflict(s): ${conflicts.map((c) => c.field).slice(0, 3).join(", ")}`,
      priority: "P0",
      why: "Cross-source value disagreements indicate potential presentation inconsistency.",
      evidence_refs: [],
    });
  }

  const summaryParts: string[] = [];
  if (missingCriticalTerms.length > 0) {
    summaryParts.push(
      `${missingCriticalTerms.length} critical term(s) are not disclosed in the submitted materials.`
    );
  }
  if (conflicts.length > 0) {
    summaryParts.push(
      `${conflicts.length} data conflict(s) detected between XLSX and deck sources.`
    );
  }
  if (gatesFailed > 0) {
    summaryParts.push(
      `${gatesFailed} readiness gate(s) have not been passed — investor diligence should address open gates.`
    );
  }
  if (summaryParts.length === 0) {
    summaryParts.push("No critical risk signals detected from available documentation.");
  }

  // suppress unused warnings param warning
  void warnings;

  return {
    summary_paragraphs: summaryParts,
    top_risks: topRisks,
    verification_requests: requests,
    data_issues: {
      missing_critical_terms: missingCriticalTerms,
      conflicts: contractConflicts,
      coverage_pct: textCoveragePct,
      gates_failed: gatesFailed,
    },
  };
}

// ─── Empty evidence registry ─────────────────────────────────────────────────

function buildEmptyEvidenceRegistry(): EvidenceRegistry {
  return {
    items: [],
    indexes: {
      by_segment: {
        executive_summary: [],
        deal_terms: [],
        market: [],
        financial: [],
        risk_verification: [],
      },
    },
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Build the complete OrchestratorReportV1 from a stored InvestorInsightsRenderPackage.
 *
 * This function is:
 * - Deterministic (same inputs → same outputs)
 * - Side-effect free (no DB, no LLM, no I/O)
 * - Non-mutating (does not alter renderPackage)
 */
export function buildOrchestratorReportV1(args: {
  dealId: string;
  renderPackage: OrchestratorRenderPackageInput;
}): OrchestratorReportV1 {
  const { dealId, renderPackage: rp } = args;
  const startMs = Date.now();
  const warnings: string[] = [];

  // ─── 1. Parse all sections ─────────────────────────────────────────────────

  const canonicalFields = parseCanonicalFieldsBody(findSectionBody(rp, "canonical_fields"));
  const conflicts = parseConflictsBody(findSectionBody(rp, "conflicts"));
  const coverage = parseCoverageSnapshot(findSectionBody(rp, "coverage_snapshot"));
  const layout = parseLayoutClassifier(findSectionBody(rp, "financial_layout_classifier_v1"));
  const rec = parseReconciliation(findSectionBody(rp, "financial_reconciliation_v1"));
  const deckSignals = parseDeckFinancialSignals(findSectionBody(rp, "deck_financial_signals_v1"));

  // ─── 2. Diagnostics: inputs present ───────────────────────────────────────

  const inputsPresent = {
    gate_state: hasSectionKey(rp, "gate_state") || rp.gate_state.results.length > 0,
    canonical_fields: hasSectionKey(rp, "canonical_fields"),
    coverage_snapshot: hasSectionKey(rp, "coverage_snapshot"),
    financial_layout_classifier_v1: hasSectionKey(rp, "financial_layout_classifier_v1"),
    financial_reconciliation_v1: hasSectionKey(rp, "financial_reconciliation_v1"),
    market_analysis: hasSectionKey(rp, "insight_slots"),
  };

  if (!inputsPresent.canonical_fields)
    warnings.push("canonical_fields section absent — deal terms and market signals unavailable.");
  if (!inputsPresent.coverage_snapshot)
    warnings.push("coverage_snapshot section absent — DCI text coverage will be 0.");
  if (!inputsPresent.financial_layout_classifier_v1)
    warnings.push("financial_layout_classifier_v1 section absent — FHC XLSX signals will be 0.");
  if (!inputsPresent.financial_reconciliation_v1)
    warnings.push("financial_reconciliation_v1 section absent — FHC RC will use neutral default of 50.");
  warnings.push(
    "evidence_registry: evidence_items table not accessible in build-only mode — items empty."
  );

  // ─── 3. Stage context ──────────────────────────────────────────────────────

  const stage = detectStage(canonicalFields);

  const missingCriticalTerms = canonicalFields
    .filter(
      (f) => CRITICAL_CANONICAL_FIELDS.has(f.field) && f.computability !== "Computable"
    )
    .map((f) => f.field);

  const getField = (name: string): string | null =>
    canonicalFields.find((f) => f.field === name && f.computability === "Computable")?.value ?? null;

  // ─── 4. DCI ───────────────────────────────────────────────────────────────

  const dpuPageCount = coverage.dpu_page_count;
  const dpuNonempty = coverage.dpu_nonempty_pages;
  const softMissing = dpuPageCount - dpuNonempty;

  const dciRaw: DciRawInputs = {
    text_coverage_pct: coverage.text_coverage_pct,
    layout_coverage_pct: layout?.layout_coverage_pct ?? 0,
    expected_pages_total: dpuPageCount,
    dpu_rows_total: dpuPageCount,         // treat all DPU pages as present
    missing_pages_total: Math.max(0, softMissing),
    hard_missing_pages_total: 0,          // not available from render_package alone
  };

  if (dpuPageCount === 0) {
    warnings.push("DPU page count is 0 — DCI computed from layout coverage only.");
    dciRaw.expected_pages_total = 0;
  }

  const documentConfidence = computeDocumentConfidenceIndex(dciRaw);

  // ─── 5. FHC ───────────────────────────────────────────────────────────────

  const fhcRaw: FhcRawInputs = {
    has_income_statement: layout?.has_income_statement ?? false,
    has_cash_flow: layout?.has_cash_flow ?? false,
    has_balance_sheet: layout?.has_balance_sheet ?? false,
    has_saas_kpis: layout?.has_saas_kpis ?? false,
    has_use_of_funds: layout?.has_use_of_funds ?? false,
    has_budget_model: layout?.has_budget_model ?? false,
    reconciliation_confidence_score: rec?.confidence_score ?? null,
    deck_has_revenue: deckSignals.has_revenue,
    deck_has_burn: deckSignals.has_burn,
    deck_has_runway: deckSignals.has_runway,
    deck_has_growth: false,   // deck_financial_signals_v1 doesn't expose has_growth directly
    deck_has_margin: false,
  };

  const fhc = computeFinancialHealthComposite(fhcRaw);

  // ─── 6. URSS ──────────────────────────────────────────────────────────────

  const urssConflicts: UrssConflict[] = conflicts.map((c) => ({ field: c.field }));

  const urssInputs: UrssInputs = {
    missing_critical_terms: missingCriticalTerms,
    conflicts: urssConflicts,
    dci: documentConfidence.score,
    reconciliation_confidence_score: rec?.confidence_score ?? null,
    gate_results: rp.gate_state.results.map((r) => ({ passed: r.passed })),
  };

  const urssResult = computeUnifiedRiskSeverity(urssInputs);

  // ─── 7. Market score ──────────────────────────────────────────────────────

  const { market_score_raw, missing_inputs: missingMarketInputs } =
    computeMarketScoreRaw(canonicalFields);
  const marketScorePersisted = computeMarketScorePersisted(
    market_score_raw,
    documentConfidence.score
  );

  // ─── 8. ORS ───────────────────────────────────────────────────────────────

  const orsInputs = {
    market_score_persisted: marketScorePersisted,
    fhc_score: fhc.score,
    fhc_status: fhc.status,
    urss: urssResult.score,
    dci: documentConfidence.score,
    deck_has_strong_financial_signals: deckSignals.has_any_financial,
  };

  const orsResult = computeOverallRecommendationScore(orsInputs);

  // ─── 9. Decision ──────────────────────────────────────────────────────────

  const decisionInputs: DecisionInputs = {
    ors: orsResult.ors,
    urss: urssResult.score,
    stage,
    fhc_score: fhc.score,
    fhc_status: fhc.status,
    deck_has_strong_financial_signals: deckSignals.has_any_financial,
    dci: documentConfidence.score,
    financial_proxy_used: orsResult.financial_proxy_used,
  };

  const decision = computeDecision(decisionInputs);

  // ─── 10. Segments ─────────────────────────────────────────────────────────

  const gateItems = rp.gate_state.results;

  const segments: OrchestratorSegments = {
    executive_summary: buildExecutiveSummarySegment(rp),
    deal_terms: buildDealTermsSegment(canonicalFields, conflicts),
    market: buildMarketSegment(canonicalFields, marketScorePersisted, missingMarketInputs, rp),
    financial: buildFinancialSegment(rp, warnings),
    risk_verification: buildRiskVerificationSegment(
      canonicalFields,
      conflicts,
      gateItems.map((g) => ({
        gate: g.gate,
        passed: g.passed,
        reason_code: g.reason_code,
      })),
      missingCriticalTerms,
      coverage.text_coverage_pct,
      warnings
    ),
  };

  // ─── 11. Assemble report ───────────────────────────────────────────────────

  const composeTotal = Date.now() - startMs;

  const diagnostics: OrchestratorDiagnostics = {
    inputs_present: inputsPresent,
    warnings,
    timings_ms: {
      compose_total: composeTotal,
      market_call: 0,
      deal_terms_call: 0,
      financial_call: 0,
      risk_call: 0,
    },
  };

  return {
    schema_version: "ddai_orchestrator_report_v1",
    deal_id: dealId,
    created_at: new Date().toISOString(),
    input_fingerprint: rp.upstream_fingerprint,
    source_versions: {
      page_understanding_version: "page_understanding_v1",
      investor_insights_version: rp.schema_version,
      deterministic_pipeline_version: "orchestrator_v1",
    },
    document_confidence: documentConfidence,
    stage_context: {
      stage,
      raise_amount: getField("raise_amount"),
      instrument: getField("raise_instrument"),
      valuation_pre: getField("valuation_pre"),
      valuation_post: getField("valuation_post"),
      missing_critical_terms: missingCriticalTerms,
    },
    scores: {
      overall_recommendation_score: orsResult.ors,
      risk_severity_score: urssResult.score,
      market_score: {
        raw: market_score_raw,
        persisted: marketScorePersisted,
        missing_inputs: missingMarketInputs,
      },
      financial_health_score: fhc,
    },
    decision,
    segments,
    evidence_registry: buildEmptyEvidenceRegistry(),
    diagnostics,
  };
}

// suppress unused import warning for findSectionItems
void findSectionItems;
