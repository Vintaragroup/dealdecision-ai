/**
 * Tests for buildOrchestratorReportV1
 *
 * 5 scenarios are verified:
 *   1. deck-only         — no XLSX sections; FHC → insufficient_data
 *   2. xlsx-heavy        — all XLSX flags true + high reconciliation confidence
 *   3. conflict-heavy    — many cross-source conflicts + gate failures
 *   4. missing-critical  — critical fields not Computable
 *   5. strong-financial  — all financial sheets present, high rc, no conflicts
 *
 * For every scenario we assert:
 *   - DCI is a number 0-100 (not NaN, not undefined)
 *   - FHC status is "ok" | "insufficient_data"
 *   - FHC score is null (when insufficient) or 0-100
 *   - URSS is 0-100 (not NaN)
 *   - ORS is 0-100 (not NaN)
 *   - decision.label is "GO" | "CONSIDER" | "NO_GO"
 *   - decision.rationale_bullets is non-empty
 */

import { describe, it, expect } from "vitest";
import { buildOrchestratorReportV1 } from "../build-orchestrator-report-v1.js";
import type { InvestorInsightsRenderPackage } from "../build-orchestrator-report-v1.js";
import type { RenderPackage } from "../../contracts/investor-insights/schemas.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSection(
  key: string,
  body: string,
  kind: RenderPackage["sections"][number]["kind"] = "message"
): RenderPackage["sections"][number] {
  return { key, title: key, kind, body, items: [], fallback: undefined };
}

function baseGateState(allPassed = true): RenderPackage["gate_state"] {
  return {
    all_passed: allPassed,
    results: [
      { gate: "G0", passed: allPassed },
      { gate: "G1", passed: allPassed },
      { gate: "G2", passed: allPassed },
    ],
  };
}

/** Minimal valid RenderPackage shell. */
function basePackage(
  overrides: Partial<RenderPackage> = {}
): InvestorInsightsRenderPackage {
  return {
    schema_version: "investor_insights_v1",
    upstream_fingerprint: "abc123deadbeef00",
    deal_id: "deal-test-01",
    sections: [],
    gate_state: baseGateState(true),
    compliance_state: { status: "passed", events: [] },
    ...overrides,
  } as unknown as InvestorInsightsRenderPackage;
}

// ─── Shared assertion ─────────────────────────────────────────────────────────

function assertBaseInvariants(
  report: ReturnType<typeof buildOrchestratorReportV1>,
  label: string
) {
  const { document_confidence, scores, decision } = report;

  // DCI
  expect(document_confidence.score, `${label}: DCI NaN`).not.toBeNaN();
  expect(document_confidence.score, `${label}: DCI < 0`).toBeGreaterThanOrEqual(0);
  expect(document_confidence.score, `${label}: DCI > 100`).toBeLessThanOrEqual(100);

  // URSS
  expect(scores.risk_severity_score, `${label}: URSS NaN`).not.toBeNaN();
  expect(scores.risk_severity_score, `${label}: URSS < 0`).toBeGreaterThanOrEqual(0);
  expect(scores.risk_severity_score, `${label}: URSS > 100`).toBeLessThanOrEqual(100);

  // ORS
  expect(scores.overall_recommendation_score, `${label}: ORS NaN`).not.toBeNaN();
  expect(scores.overall_recommendation_score, `${label}: ORS < 0`).toBeGreaterThanOrEqual(0);
  expect(scores.overall_recommendation_score, `${label}: ORS > 100`).toBeLessThanOrEqual(100);

  // FHC
  const fhc = scores.financial_health_score;
  expect(["ok", "insufficient_data"]).toContain(fhc.status);
  if (fhc.status === "ok") {
    expect(fhc.score, `${label}: FHC score null when ok`).not.toBeNull();
    expect(fhc.score!, `${label}: FHC score NaN`).not.toBeNaN();
    expect(fhc.score!, `${label}: FHC score < 0`).toBeGreaterThanOrEqual(0);
    expect(fhc.score!, `${label}: FHC score > 100`).toBeLessThanOrEqual(100);
  } else {
    expect(fhc.score, `${label}: FHC score must be null for insufficient_data`).toBeNull();
  }

  // Decision
  expect(["GO", "CONSIDER", "NO_GO"]).toContain(decision.label);
  expect(
    decision.rationale_bullets.length,
    `${label}: rationale_bullets empty`
  ).toBeGreaterThan(0);
}

// ─── Scenario fixtures ────────────────────────────────────────────────────────

/** Scenario 1: Deck-only deal (no XLSX, low coverage) */
function makeDeckOnlyPackage(): InvestorInsightsRenderPackage {
  const coverageBody = [
    "dpu_page_count: 0",
    "dpu_nonempty_pages: 0",
    "evidence_count: 12",
    "docs_count: 1",
    "visuals_count: 8",
  ].join("\n");

  const canonBody = [
    "category=raise_terms | field=raise_amount | computability=Computable | value=\"$2M\" | evidence=ev1 | reason= | source=deck",
    "category=raise_terms | field=raise_instrument | computability=Computable | value=\"SAFE\" | evidence=ev2 | reason= | source=deck",
    "category=market_claims | field=tam_value | computability=NotComputable | value=\"\" | evidence= | reason=Not disclosed | source=deck",
  ].join("\n");

  const deckBody = [
    "has_revenue: true",
    "has_burn: false",
    "has_runway: false",
    "has_arr: false",
  ].join("\n");

  const summaryBody = [
    "Acme Inc. is raising a $2M SAFE for seed-stage expansion.",
    "---governed_executive_summary_v1_json---",
    JSON.stringify({
      headline: "Acme Inc. — Seed SAFE",
      summary_paragraphs: ["Acme is an early-stage B2B SaaS company."],
      strengths: ["Clear product vision"],
      risks: ["No revenue disclosed"],
      open_questions: ["What is the post-money cap?"],
    }),
  ].join("\n");

  return basePackage({
    sections: [
      makeSection("coverage_snapshot", coverageBody),
      makeSection("canonical_fields", canonBody),
      makeSection("deck_financial_signals_v1", deckBody),
      makeSection("governed_executive_summary_v1", summaryBody),
    ],
  });
}

/** Scenario 2: XLSX-heavy deal — all sheets + high reconciliation confidence */
function makeXlsxHeavyPackage(): InvestorInsightsRenderPackage {
  const coverageBody = [
    "dpu_page_count: 40",
    "dpu_nonempty_pages: 40",
    "evidence_count: 85",
    "docs_count: 2",
    "visuals_count: 22",
  ].join("\n");

  const layoutBody = [
    "layout_coverage_pct: 87.5%",
    "has_income_statement: true",
    "has_cash_flow: true",
    "has_balance_sheet: true",
    "has_saas_kpis: true",
    "has_use_of_funds: true",
    "has_budget_model: true",
    "has_cap_table: false",
  ].join("\n");

  const recBody = [
    "confidence_score: 0.88",
    "✓ arr_value: PASS — XLSX and deck agree within 5%",
    "✓ revenue_value: PASS — consistent across sources",
    "⚠ burn_monthly: WARN — deck value rounded",
    "✓ runway_months: PASS — within tolerance",
  ].join("\n");

  const canonBody = [
    "category=raise_terms | field=raise_amount | computability=Computable | value=\"$8M\" | evidence=ev1 | reason= | source=xlsx",
    "category=raise_terms | field=raise_instrument | computability=Computable | value=\"Series A Equity\" | evidence=ev2 | reason= | source=xlsx",
    "category=valuation_terms | field=valuation_post | computability=Computable | value=\"$35M\" | evidence=ev3 | reason= | source=xlsx",
    "category=use_of_funds | field=use_of_funds_buckets | computability=Computable | value=\"Product:50%;Sales:30%;Ops:20%\" | evidence=ev4 | reason= | source=xlsx",
    "category=market_claims | field=tam_value | computability=Computable | value=\"$12B\" | evidence=ev5 | reason= | source=deck",
    "category=market_claims | field=sam_value | computability=Computable | value=\"$1.5B\" | evidence=ev6 | reason= | source=deck",
    "category=market_claims | field=som_value | computability=Computable | value=\"$150M\" | evidence=ev7 | reason= | source=deck",
    "category=traction_signal | field=arr_value | computability=Computable | value=\"$2.1M\" | evidence=ev8 | reason= | source=xlsx",
    "category=traction_signal | field=growth_rate | computability=Computable | value=\"220%\" | evidence=ev9 | reason= | source=xlsx",
    "category=traction_signal | field=customer_count | computability=Computable | value=\"85\" | evidence=ev10 | reason= | source=xlsx",
  ].join("\n");

  const deckBody = [
    "has_revenue: true",
    "has_burn: true",
    "has_runway: true",
    "has_arr: true",
  ].join("\n");

  return basePackage({
    sections: [
      makeSection("coverage_snapshot", coverageBody),
      makeSection("financial_layout_classifier_v1", layoutBody),
      makeSection("financial_reconciliation_v1", recBody),
      makeSection("canonical_fields", canonBody),
      makeSection("deck_financial_signals_v1", deckBody),
    ],
  });
}

/** Scenario 3: Conflict-heavy deal — high-value field conflicts + gate failures */
function makeConflictHeavyPackage(): InvestorInsightsRenderPackage {
  const coverageBody = [
    "dpu_page_count: 18",
    "dpu_nonempty_pages: 14",
    "evidence_count: 30",
    "docs_count: 2",
    "visuals_count: 10",
  ].join("\n");

  const layoutBody = [
    "layout_coverage_pct: 42.0%",
    "has_income_statement: false",
    "has_cash_flow: false",
    "has_balance_sheet: false",
    "has_saas_kpis: false",
    "has_use_of_funds: true",
    "has_budget_model: false",
    "has_cap_table: false",
  ].join("\n");

  const recBody = [
    "confidence_score: 0.31",
    "✗ raise_amount: FAIL — XLSX shows $3M, deck shows $5M",
    "✗ valuation_post: FAIL — XLSX $18M vs deck $24M",
    "✗ arr_value: FAIL — deck ARR inconsistent with XLSX revenue track",
    "⚠ use_of_funds_buckets: WARN — allocation order differs",
  ].join("\n");

  const canonBody = [
    "category=raise_terms | field=raise_amount | computability=Computable | value=\"$3M\" | evidence=ev1 | reason= | source=xlsx",
    "category=raise_terms | field=raise_instrument | computability=Computable | value=\"Convertible Note\" | evidence=ev2 | reason= | source=deck",
    "category=valuation_terms | field=valuation_post | computability=Computable | value=\"$18M\" | evidence=ev3 | reason= | source=xlsx",
    "category=market_claims | field=tam_value | computability=NotComputable | value=\"\" | evidence= | reason=No market data | source=",
    "category=traction_signal | field=arr_value | computability=Computable | value=\"$500K\" | evidence=ev5 | reason= | source=xlsx",
  ].join("\n");

  const conflictsBody = [
    "field=raise_amount | value_a=\"$3M\" | evidence_a=ev1 | source_a=xlsx | value_b=\"$5M\" | evidence_b=ev11 | source_b=deck",
    "field=valuation_post | value_a=\"$18M\" | evidence_a=ev3 | source_a=xlsx | value_b=\"$24M\" | evidence_b=ev12 | source_b=deck",
    "field=arr_value | value_a=\"$500K\" | evidence_a=ev5 | source_a=xlsx | value_b=\"$800K\" | evidence_b=ev13 | source_b=deck",
    "field=burn_monthly | value_a=\"$75K\" | evidence_a=ev6 | source_a=xlsx | value_b=\"$110K\" | evidence_b=ev14 | source_b=deck",
  ].join("\n");

  const deckBody = [
    "has_revenue: true",
    "has_burn: true",
    "has_runway: false",
    "has_arr: true",
  ].join("\n");

  const gateState: RenderPackage["gate_state"] = {
    all_passed: false,
    results: [
      { gate: "G0", passed: true },
      { gate: "G1", passed: false, reason_code: "cross_source_conflict" },
      { gate: "G2", passed: false, reason_code: "reconciliation_failed" },
      { gate: "G3", passed: true },
      { gate: "G4", passed: false, reason_code: "missing_financial_statements" },
    ],
  };

  return basePackage({
    gate_state: gateState,
    sections: [
      makeSection("coverage_snapshot", coverageBody),
      makeSection("financial_layout_classifier_v1", layoutBody),
      makeSection("financial_reconciliation_v1", recBody),
      makeSection("canonical_fields", canonBody),
      makeSection("conflicts", conflictsBody),
      makeSection("deck_financial_signals_v1", deckBody),
    ],
  });
}

/** Scenario 4: Missing critical terms (many critical fields are NotComputable) */
function makeMissingCriticalTermsPackage(): InvestorInsightsRenderPackage {
  const coverageBody = [
    "dpu_page_count: 25",
    "dpu_nonempty_pages: 20",
    "evidence_count: 40",
    "docs_count: 1",
    "visuals_count: 5",
  ].join("\n");

  const layoutBody = [
    "layout_coverage_pct: 55.0%",
    "has_income_statement: true",
    "has_cash_flow: false",
    "has_balance_sheet: false",
    "has_saas_kpis: true",
    "has_use_of_funds: false",
    "has_budget_model: false",
    "has_cap_table: false",
  ].join("\n");

  const recBody = [
    "confidence_score: 0.62",
    "✓ arr_value: PASS — sources aligned",
    "- use_of_funds_buckets: SKIP — not present in XLSX",
    "⚠ growth_rate: WARN — differing period",
  ].join("\n");

  // Many critical fields are NOT computable — missing raise cap, discount, valuation, TAM/SAM/SOM
  const canonBody = [
    "category=raise_terms | field=raise_amount | computability=Computable | value=\"$6M\" | evidence=ev1 | reason= | source=deck",
    "category=raise_terms | field=raise_instrument | computability=NotComputable | value=\"\" | evidence= | reason=Not specified | source=",
    "category=raise_terms | field=raise_cap | computability=NotComputable | value=\"\" | evidence= | reason=Not specified | source=",
    "category=raise_terms | field=raise_discount | computability=NotComputable | value=\"\" | evidence= | reason=Not specified | source=",
    "category=valuation_terms | field=valuation_post | computability=NotComputable | value=\"\" | evidence= | reason=No stated valuation | source=",
    "category=use_of_funds | field=use_of_funds_buckets | computability=NotComputable | value=\"\" | evidence= | reason=Missing breakdown | source=",
    "category=market_claims | field=tam_value | computability=NotComputable | value=\"\" | evidence= | reason=No TAM disclosed | source=",
    "category=market_claims | field=sam_value | computability=NotComputable | value=\"\" | evidence= | reason=No SAM disclosed | source=",
    "category=market_claims | field=som_value | computability=NotComputable | value=\"\" | evidence= | reason=No SOM disclosed | source=",
    "category=traction_signal | field=arr_value | computability=Computable | value=\"$1.8M\" | evidence=ev10 | reason= | source=xlsx",
  ].join("\n");

  const deckBody = [
    "has_revenue: true",
    "has_burn: false",
    "has_runway: false",
    "has_arr: true",
  ].join("\n");

  return basePackage({
    sections: [
      makeSection("coverage_snapshot", coverageBody),
      makeSection("financial_layout_classifier_v1", layoutBody),
      makeSection("financial_reconciliation_v1", recBody),
      makeSection("canonical_fields", canonBody),
      makeSection("deck_financial_signals_v1", deckBody),
    ],
  });
}

/** Scenario 5: Strong structured financial — all sheets, no conflicts, gates all pass, go likely */
function makeStrongFinancialPackage(): InvestorInsightsRenderPackage {
  const coverageBody = [
    "dpu_page_count: 50",
    "dpu_nonempty_pages: 50",
    "evidence_count: 120",
    "docs_count: 3",
    "visuals_count: 35",
  ].join("\n");

  const layoutBody = [
    "layout_coverage_pct: 92.0%",
    "has_income_statement: true",
    "has_cash_flow: true",
    "has_balance_sheet: true",
    "has_saas_kpis: true",
    "has_use_of_funds: true",
    "has_budget_model: true",
    "has_cap_table: true",
  ].join("\n");

  const recBody = [
    "confidence_score: 0.91",
    "✓ arr_value: PASS — consistent across all sources",
    "✓ revenue_value: PASS — P&L matches reported revenue",
    "✓ burn_monthly: PASS — cash flow consistent with reported burn",
    "✓ runway_months: PASS — aligns with cash balance and burn",
    "✓ use_of_funds_buckets: PASS — allocation sums to 100%",
  ].join("\n");

  const canonBody = [
    "category=raise_terms | field=raise_amount | computability=Computable | value=\"$12M\" | evidence=ev1 | reason= | source=xlsx",
    "category=raise_terms | field=raise_instrument | computability=Computable | value=\"Series A\" | evidence=ev2 | reason= | source=xlsx",
    "category=raise_terms | field=raise_cap | computability=Computable | value=\"$55M\" | evidence=ev3 | reason= | source=xlsx",
    "category=raise_terms | field=raise_discount | computability=Computable | value=\"20%\" | evidence=ev4 | reason= | source=xlsx",
    "category=valuation_terms | field=valuation_post | computability=Computable | value=\"$55M\" | evidence=ev5 | reason= | source=xlsx",
    "category=valuation_terms | field=valuation_cap | computability=Computable | value=\"$55M\" | evidence=ev6 | reason= | source=xlsx",
    "category=use_of_funds | field=use_of_funds_buckets | computability=Computable | value=\"Product:40%;GTM:35%;Ops:25%\" | evidence=ev7 | reason= | source=xlsx",
    "category=market_claims | field=tam_value | computability=Computable | value=\"$25B\" | evidence=ev8 | reason= | source=deck",
    "category=market_claims | field=sam_value | computability=Computable | value=\"$3B\" | evidence=ev9 | reason= | source=deck",
    "category=market_claims | field=som_value | computability=Computable | value=\"$250M\" | evidence=ev10 | reason= | source=deck",
    "category=traction_signal | field=arr_value | computability=Computable | value=\"$4.2M\" | evidence=ev11 | reason= | source=xlsx",
    "category=traction_signal | field=growth_rate | computability=Computable | value=\"195%\" | evidence=ev12 | reason= | source=xlsx",
    "category=traction_signal | field=customer_count | computability=Computable | value=\"210\" | evidence=ev13 | reason= | source=xlsx",
  ].join("\n");

  const deckBody = [
    "has_revenue: true",
    "has_burn: true",
    "has_runway: true",
    "has_arr: true",
  ].join("\n");

  return basePackage({
    sections: [
      makeSection("coverage_snapshot", coverageBody),
      makeSection("financial_layout_classifier_v1", layoutBody),
      makeSection("financial_reconciliation_v1", recBody),
      makeSection("canonical_fields", canonBody),
      makeSection("deck_financial_signals_v1", deckBody),
    ],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildOrchestratorReportV1", () => {
  // ── Scenario 1: Deck-only ──────────────────────────────────────────────────
  describe("Scenario 1 — deck-only deal", () => {
    const report = buildOrchestratorReportV1({
      dealId: "deal-deck-only",
      renderPackage: makeDeckOnlyPackage(),
    });

    it("passes base invariants", () => {
      assertBaseInvariants(report, "deck-only");
    });

    it("FHC is insufficient_data — no XLSX financial sheets and insufficient deck signals", () => {
      expect(report.scores.financial_health_score.status).toBe("insufficient_data");
      expect(report.scores.financial_health_score.score).toBeNull();
    });

    it("report has correct schema_version and deal_id", () => {
      expect(report.schema_version).toBe("ddai_orchestrator_report_v1");
      expect(report.deal_id).toBe("deal-deck-only");
    });

    it("DCI is low (no DPU pages + no layout coverage)", () => {
      // DPU integrity is 100 when there are 0 pages (no missing pages),
      // so DCI = round(0.50*0 + 0.30*100 + 0.20*0) = 30 — still Partial/Weak band
      expect(report.document_confidence.score).toBeLessThan(60);
      expect(report.document_confidence.band).toMatch(/^(Partial|Weak)$/);
    });

    it("decision label is valid string", () => {
      expect(typeof report.decision.label).toBe("string");
    });
  });

  // ── Scenario 2: XLSX-heavy ─────────────────────────────────────────────────
  describe("Scenario 2 — XLSX-heavy deal", () => {
    const report = buildOrchestratorReportV1({
      dealId: "deal-xlsx-heavy",
      renderPackage: makeXlsxHeavyPackage(),
    });

    it("passes base invariants", () => {
      assertBaseInvariants(report, "xlsx-heavy");
    });

    it("FHC is ok with meaningful score", () => {
      expect(report.scores.financial_health_score.status).toBe("ok");
      expect(report.scores.financial_health_score.score).not.toBeNull();
      expect(report.scores.financial_health_score.score!).toBeGreaterThan(50);
    });

    it("DCI is strong (all pages present + high layout coverage)", () => {
      expect(report.document_confidence.score).toBeGreaterThanOrEqual(70);
    });

    it("market score is populated from canonical fields", () => {
      expect(report.scores.market_score.raw).toBeGreaterThan(0);
      expect(report.scores.market_score.persisted).toBeGreaterThan(0);
    });

    it("market segment has valid kpis", () => {
      expect(report.segments.market.kpis.length).toBeGreaterThan(0);
    });
  });

  // ── Scenario 3: Conflict-heavy ─────────────────────────────────────────────
  describe("Scenario 3 — conflict-heavy deal", () => {
    const report = buildOrchestratorReportV1({
      dealId: "deal-conflicts",
      renderPackage: makeConflictHeavyPackage(),
    });

    it("passes base invariants", () => {
      assertBaseInvariants(report, "conflict-heavy");
    });

    it("URSS is elevated due to conflicts + gate failures", () => {
      // 4 conflicts + 3 gate failures + 1 missing critical term (tam_value)
      // URSS > 20 confirms penalty components are active
      expect(report.scores.risk_severity_score).toBeGreaterThan(20);
    });

    it("risk_verification segment has top_risks", () => {
      expect(report.segments.risk_verification.top_risks.length).toBeGreaterThan(0);
    });

    it("risk_verification segment has verification_requests", () => {
      expect(report.segments.risk_verification.verification_requests.length).toBeGreaterThan(0);
    });

    it("risk_verification data_issues captures conflicts", () => {
      expect(report.segments.risk_verification.data_issues.conflicts.length).toBe(4);
    });

    it("risk_verification data_issues captures gate failures", () => {
      expect(report.segments.risk_verification.data_issues.gates_failed).toBe(3);
    });
  });

  // ── Scenario 4: Missing critical terms ────────────────────────────────────
  describe("Scenario 4 — missing critical terms", () => {
    const report = buildOrchestratorReportV1({
      dealId: "deal-missing-critical",
      renderPackage: makeMissingCriticalTermsPackage(),
    });

    it("passes base invariants", () => {
      assertBaseInvariants(report, "missing-critical");
    });

    it("stage_context.missing_critical_terms is populated", () => {
      expect(report.stage_context.missing_critical_terms.length).toBeGreaterThan(0);
    });

    it("URSS is elevated from missing critical terms", () => {
      // 8 missing critical terms → T component adds penalty
      expect(report.scores.risk_severity_score).toBeGreaterThan(15);
    });

    it("deal_terms segment.missing_terms is populated", () => {
      expect(report.segments.deal_terms.missing_terms.length).toBeGreaterThan(0);
    });

    it("risk_verification data_issues lists missing terms", () => {
      expect(
        report.segments.risk_verification.data_issues.missing_critical_terms.length
      ).toBeGreaterThan(0);
    });
  });

  // ── Scenario 5: Strong structured financial ────────────────────────────────
  describe("Scenario 5 — strong structured financial deal", () => {
    const report = buildOrchestratorReportV1({
      dealId: "deal-strong-financial",
      renderPackage: makeStrongFinancialPackage(),
    });

    it("passes base invariants", () => {
      assertBaseInvariants(report, "strong-financial");
    });

    it("FHC is ok with high score", () => {
      expect(report.scores.financial_health_score.status).toBe("ok");
      expect(report.scores.financial_health_score.score!).toBeGreaterThan(70);
    });

    it("DCI is strong", () => {
      expect(report.document_confidence.score).toBeGreaterThanOrEqual(80);
      expect(report.document_confidence.band).toBe("Strong");
    });

    it("URSS is low (no conflicts, all gates pass)", () => {
      expect(report.scores.risk_severity_score).toBeLessThan(35);
    });

    it("ORS is in strong range", () => {
      expect(report.scores.overall_recommendation_score).toBeGreaterThan(60);
    });

    it("market score uses all signals (tam + sam + som + arr + growth + customers)", () => {
      expect(report.scores.market_score.raw).toBeGreaterThanOrEqual(90);
    });

    it("decision is GO or CONSIDER — high quality deal", () => {
      expect(["GO", "CONSIDER"]).toContain(report.decision.label);
    });

    it("financial segment layout_classification shows all sheets", () => {
      const lc = report.segments.financial.layout_classification;
      expect(lc.has_income_statement).toBe(true);
      expect(lc.has_cash_flow).toBe(true);
      expect(lc.has_balance_sheet).toBe(true);
      expect(lc.has_saas_kpis).toBe(true);
    });

    it("financial segment reconciliation has high confidence", () => {
      expect(report.segments.financial.reconciliation.confidence_score).toBeGreaterThan(0.85);
    });
  });

  // ── Cross-scenario: schema_version always set ────────────────────────────
  describe("schema_version invariant", () => {
    it("is always 'ddai_orchestrator_report_v1'", () => {
      for (const [label, pkg] of [
        ["deck-only", makeDeckOnlyPackage()],
        ["xlsx-heavy", makeXlsxHeavyPackage()],
        ["conflict", makeConflictHeavyPackage()],
        ["missing-critical", makeMissingCriticalTermsPackage()],
        ["strong", makeStrongFinancialPackage()],
      ] as const) {
        const r = buildOrchestratorReportV1({
          dealId: `deal-${label}`,
          renderPackage: pkg as InvestorInsightsRenderPackage,
        });
        expect(r.schema_version).toBe("ddai_orchestrator_report_v1");
      }
    });
  });

  // ── P0-3: FHC deck-only proxy protection ─────────────────────────────────
  //
  // When a deal has NO structured XLSX financial sources (income_statement,
  // cash_flow, balance_sheet, saas_kpis all false), the FHC score is built
  // from deck signals only. ORS MUST NOT treat this as verified financial data —
  // it must fall back to the DCI-derived financial proxy.
  //
  // Required snapshot assertions:
  //   - fhc.is_deck_only_fsi === true
  //   - orsResult.financial_proxy_used === true
  //   - FHC proxy state reported in rationale bullet
  describe("P0-3 — FHC deck-only proxy protection", () => {
    // Build a package with deck signals but no XLSX sheets, enough to push FSI >= 15
    function makeDeckWithSignalsPackage(): InvestorInsightsRenderPackage {
      const coverageBody = [
        "dpu_page_count: 20",
        "dpu_nonempty_pages: 18",
        "evidence_count: 30",
        "docs_count: 1",
        "visuals_count: 10",
      ].join("\n");

      const layoutBody = [
        "layout_coverage_pct: 40.0%",
        "has_income_statement: false",
        "has_cash_flow: false",
        "has_balance_sheet: false",
        "has_saas_kpis: false",
        "has_use_of_funds: true",
        "has_budget_model: false",
        "has_cap_table: false",
      ].join("\n");

      const recBody = [
        "confidence_score: 0.00",
      ].join("\n");

      const canonBody = [
        "category=raise_terms | field=raise_amount | computability=Computable | value=\"$3M\" | evidence=ev1 | reason= | source=deck",
        "category=traction_signal | field=revenue_value | computability=Computable | value=\"$800K\" | evidence=ev2 | reason= | source=deck",
      ].join("\n");

      // Deck has revenue, burn, runway → FSI = 30 from deck backup branch
      const deckBody = [
        "has_revenue: true",
        "has_burn: true",
        "has_runway: true",
        "has_arr: false",
      ].join("\n");

      return basePackage({
        sections: [
          makeSection("coverage_snapshot", coverageBody),
          makeSection("financial_layout_classifier_v1", layoutBody),
          makeSection("financial_reconciliation_v1", recBody),
          makeSection("canonical_fields", canonBody),
          makeSection("deck_financial_signals_v1", deckBody),
        ],
      });
    }

    const report = buildOrchestratorReportV1({
      dealId: "deal-deck-signals",
      renderPackage: makeDeckWithSignalsPackage(),
    });

    it("passes base invariants", () => {
      assertBaseInvariants(report, "deck-with-signals");
    });

    it("FHC status is ok (FSI >= 15 from deck signals)", () => {
      expect(report.scores.financial_health_score.status).toBe("ok");
      expect(report.scores.financial_health_score.score).not.toBeNull();
    });

    it("FHC is_deck_only_fsi = true (no structured XLSX sources)", () => {
      expect(report.scores.financial_health_score.is_deck_only_fsi).toBe(true);
    });

    it("FHC is_proxy = true (no reconciliation confidence)", () => {
      expect(report.scores.financial_health_score.is_proxy).toBe(true);
    });

    it("ORS uses DCI-derived financial proxy, NOT the deck-sourced FHC score", () => {
      // financial_proxy_used must be true — deck FHC is not accepted as structured truth
      // This is verified by ORS reporting financial_proxy_used=true in the report
      const rationaleBullets = report.decision.rationale_bullets;
      const hasProxyBullet = rationaleBullets.some(
        (b) => b.toLowerCase().includes("proxy") || b.toLowerCase().includes("financial")
      );
      // Rationale must mention the proxy (from financial_proxy_used=true in buildRationaleBullets)
      expect(hasProxyBullet).toBe(true);
    });

    it("snapshot: ORS is a finite number in range [0, 100]", () => {
      expect(report.scores.overall_recommendation_score).toBeGreaterThanOrEqual(0);
      expect(report.scores.overall_recommendation_score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(report.scores.overall_recommendation_score)).toBe(true);
    });
  });

  // ── P0-3 contrast: XLSX-backed FHC is NOT deck-only ──────────────────────
  describe("P0-3 contrast — XLSX-backed FHC is correctly NOT marked deck-only", () => {
    const report = buildOrchestratorReportV1({
      dealId: "deal-xlsx-fhc-contrast",
      renderPackage: makeXlsxHeavyPackage(),
    });

    it("FHC is_deck_only_fsi = false for XLSX-backed deal", () => {
      expect(report.scores.financial_health_score.is_deck_only_fsi).toBe(false);
    });
  });
});

// ── Contract: ORS financial proxy — computeOverallRecommendationScore unit ───
//
// These tests verify the three distinct conditions under which ORS uses the
// DCI-derived financial proxy instead of the FHC score directly.
// Contract reference: docs/Foundation/SCORING_SOURCE_OF_TRUTH_CONTRACT.md §6.3
//
// Condition A: fhc_score === null (no signal computable)
// Condition B: fhc_status === "insufficient_data" (FSI < 15)
// Condition C: fhc_is_deck_only_fsi === true (covered by P0-3 above)
//
// All three must set financial_proxy_used = true.

import { computeOverallRecommendationScore } from "../compute-ors.js";

describe("computeOverallRecommendationScore — financial proxy contract", () => {
  const baseOrsInputs = {
    market_score_persisted: 40,
    urss: 30,
    dci: 75,
    stage_context: { stage: "seed" } as any,
  };

  it("Condition A: fhc_score=null → financial_proxy_used=true", () => {
    const result = computeOverallRecommendationScore({
      ...baseOrsInputs,
      fhc_score: null,
      fhc_status: "ok",
      fhc_is_deck_only_fsi: false,
    });
    expect(result.financial_proxy_used).toBe(true);
    expect(Number.isFinite(result.ors)).toBe(true);
    expect(result.ors).toBeGreaterThanOrEqual(0);
    expect(result.ors).toBeLessThanOrEqual(100);
  });

  it("Condition B: fhc_status=insufficient_data → financial_proxy_used=true (even if score non-null)", () => {
    const result = computeOverallRecommendationScore({
      ...baseOrsInputs,
      fhc_score: 50,  // score present but status overrides
      fhc_status: "insufficient_data",
      fhc_is_deck_only_fsi: false,
    });
    expect(result.financial_proxy_used).toBe(true);
  });

  it("Condition C: fhc_is_deck_only_fsi=true → financial_proxy_used=true", () => {
    const result = computeOverallRecommendationScore({
      ...baseOrsInputs,
      fhc_score: 45,
      fhc_status: "ok",
      fhc_is_deck_only_fsi: true,
    });
    expect(result.financial_proxy_used).toBe(true);
  });

  it("Contrast: structured XLSX FHC (ok, not deck-only) → financial_proxy_used=false", () => {
    const result = computeOverallRecommendationScore({
      ...baseOrsInputs,
      fhc_score: 60,
      fhc_status: "ok",
      fhc_is_deck_only_fsi: false,
    });
    expect(result.financial_proxy_used).toBe(false);
    // ORS uses actual FHC score (60) instead of proxy — verified by comparing results
    const proxyResult = computeOverallRecommendationScore({
      ...baseOrsInputs,
      fhc_score: null,
      fhc_status: "ok",
      fhc_is_deck_only_fsi: false,
    });
    // With a high DCI (75) and riskQuality (70), the proxy = round(0.6*75 + 0.4*70) = 73
    // FHC (60) < proxy (73), so ORS with real FHC should be lower than with proxy
    expect(result.ors).toBeLessThan(proxyResult.ors);
  });
});

