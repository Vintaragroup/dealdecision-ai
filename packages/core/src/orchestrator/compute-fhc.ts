/**
 * Financial Health Composite (FHC)
 *
 * Authoritative spec: docs/Active/orchestractor/DDAI_FHC_v1.md
 *
 * Range: 0–100. Higher is better.
 * Deterministic. No LLM.
 */

import type { FinancialHealthScore, FinancialHealthScoreInputs } from './types';

// ─── Primitives ──────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function pct(x01: number): number {
  return clamp(Math.round(x01 * 100), 0, 100);
}

// ─── Input type ──────────────────────────────────────────────────────────────

export interface FhcRawInputs {
  // Presence flags (from financial_layout_classifier_v1)
  has_income_statement: boolean;
  has_cash_flow: boolean;
  has_balance_sheet: boolean;
  has_saas_kpis: boolean;
  has_use_of_funds: boolean;
  has_budget_model: boolean;
  /** null when financial_reconciliation_v1 section absent */
  reconciliation_confidence_score: number | null;
  // Deck-only backup signals (from deck_financial_signals_v1)
  deck_has_revenue: boolean;
  deck_has_burn: boolean;
  deck_has_runway: boolean;
  deck_has_growth: boolean;
  deck_has_margin: boolean;
}

// ─── FSI computation ─────────────────────────────────────────────────────────

function computeFsi(inputs: FhcRawInputs): number {
  let fsi = 0;

  // Structured XLSX sources
  if (inputs.has_income_statement) fsi += 25;
  if (inputs.has_cash_flow) fsi += 20;
  if (inputs.has_balance_sheet) fsi += 15;
  if (inputs.has_saas_kpis) fsi += 20;
  if (inputs.has_use_of_funds) fsi += 10;
  if (inputs.has_budget_model) fsi += 10;

  // Deck-only backup: only when none of the structured sources above are present
  const hasAnyStructured =
    inputs.has_income_statement ||
    inputs.has_cash_flow ||
    inputs.has_balance_sheet ||
    inputs.has_saas_kpis;

  if (!hasAnyStructured) {
    if (inputs.deck_has_revenue) fsi += 10;
    if (inputs.deck_has_burn) fsi += 10;
    if (inputs.deck_has_runway) fsi += 10;
    if (inputs.deck_has_growth) fsi += 5;
    if (inputs.deck_has_margin) fsi += 5;
  }

  return clamp(fsi, 0, 100);
}

// ─── Missing sections list ───────────────────────────────────────────────────

function buildMissingSections(inputs: FhcRawInputs): string[] {
  const missing: string[] = [];
  if (!inputs.has_income_statement) missing.push("income_statement");
  if (!inputs.has_cash_flow) missing.push("cash_flow");
  if (!inputs.has_balance_sheet) missing.push("balance_sheet");
  if (!inputs.has_saas_kpis) missing.push("saas_kpis");
  if (!inputs.has_use_of_funds) missing.push("use_of_funds");
  if (!inputs.has_budget_model) missing.push("budget_model");
  return missing;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Compute the Financial Health Composite.
 *
 * - FSI < 10 → status=insufficient_data, score=null
 *   (Threshold history: was 15; lowered 2026-03-30 — see inline comment below)
 * - Otherwise: score = round(0.60 * FSI + 0.40 * (RC ?? 50))
 */
export function computeFinancialHealthComposite(raw: FhcRawInputs): FinancialHealthScore {
  const fsi = computeFsi(raw);

  const rcRaw =
    raw.reconciliation_confidence_score !== null
      ? pct(raw.reconciliation_confidence_score)
      : null;

  // Track whether FSI is built from structured XLSX sources or deck signals only.
  const hasAnyStructuredForScore =
    raw.has_income_statement ||
    raw.has_cash_flow ||
    raw.has_balance_sheet ||
    raw.has_saas_kpis;

  const missingIn: FinancialHealthScoreInputs = {
    fsi_evidence_strength: fsi,
    reconciliation_confidence_pct: rcRaw,
    has_income_statement: raw.has_income_statement,
    has_cash_flow: raw.has_cash_flow,
    has_balance_sheet: raw.has_balance_sheet,
    has_saas_kpis: raw.has_saas_kpis,
    has_use_of_funds: raw.has_use_of_funds,
    has_budget_model: raw.has_budget_model,
    deck_has_revenue: raw.deck_has_revenue,
    deck_has_burn: raw.deck_has_burn,
    deck_has_runway: raw.deck_has_runway,
    deck_has_growth: raw.deck_has_growth,
    deck_has_margin: raw.deck_has_margin,
  };

  const missing_sections = buildMissingSections(raw);

  // Threshold history: was 15 (2026-03-30 calibration → lowered to 10).
  // Rationale: single deck signal (e.g. revenue-only = FSI=10) previously fell
  // short of FSI=15, forcing ORS to use the DCI-derived financial proxy even
  // when real (weak) FHC data was available.
  if (fsi < 10) {
    return {
      status: "insufficient_data",
      score: null,
      is_proxy: false,
      is_deck_only_fsi: !hasAnyStructuredForScore,
      missing_sections,
      inputs: missingIn,
    };
  }

  // RC absent → use 50 (neutral) but mark as unreconciled via is_proxy
  const rc = rcRaw ?? 50;
  const isProxy = rcRaw === null;
  const score = clamp(Math.round(0.6 * fsi + 0.4 * rc), 0, 100);

  return {
    status: "ok",
    score,
    is_proxy: isProxy,
    is_deck_only_fsi: !hasAnyStructuredForScore,
    missing_sections,
    inputs: missingIn,
  };
}
