/**
 * Financial Breakdown V1 — User-facing financial interpretation layer.
 *
 * Converts raw `FinancialFactV1[]` into structured, investor-readable sections.
 * All logic is deterministic (no LLM). Fail-open: never throws.
 *
 * Sections:
 *   1. current_state       — where the company is today
 *   2. projections         — the financial model forecast
 *   3. revenue_breakdown   — bookings, recognized, ARR/MRR, channel
 *   4. expense_structure   — headcount and payroll-driven costs
 *   5. burn_runway         — cash burn and runway
 *   6. assumptions_summary — inferred model assumptions
 *   7. cap_table_summary   — cap table context
 *   8. risks               — data inconsistencies and red flags
 *   9. narrative           — plain-English investor summary
 */

import type { FinancialFactV1 } from '../financial-facts/financial-fact-v1.js';
import type { FinancialCoverageProfileV1 } from './financial-coverage-profile.js';
import type { FinancialIntegrityV1 } from '../types/financial-integrity-v1.js';
import {
  selectAuthoritativeFact,
  selectAlternativeFact,
  filterCorruptedFacts,
  isProjectedFact,
  isProvisionalFact,
  isCorruptedFact,
  selectCanonicalRevenueFact,
  detectProformaModelFactIds,
  CANONICAL_REVENUE_KEYS,
} from '../financial-facts/select-authoritative-fact.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

/** A single financial metric with source, confidence, and semantic context. */
export type FinancialMetricPoint = {
  value: number;
  unit: 'currency' | 'percent' | 'number' | string;
  currency?: string;
  period_label: string;
  confidence: 'high' | 'medium' | 'low';
  source_kind: string;

  // ── Phase 2: Semantic enrichment ─────────────────────────────────────────
  // All optional for backward compatibility. Omitted (not false) when not applicable.

  /** True when this value is the result of a mathematical derivation, not direct extraction. */
  is_derived?: boolean;
  /** Identifies the derivation rule, e.g. 'gross_margin_from_gross_profit_and_revenue'. */
  derivation_rule?: string | null;
  /** Semantic family: 'revenue' | 'profitability' | 'liquidity' | 'expense' | etc. */
  semantic_family?: string | null;
  /** Semantic role: 'explicit' | 'derived' | 'inferred' | 'supporting' | 'unknown'. */
  semantic_role?: string | null;
  /** Temporal scope from the source fact: 'historical' | 'projected' | 'scenario' | etc. */
  temporal_scope?: string | null;
  /** True when this fact represents a forward-looking projection or scenario value. */
  is_projected?: boolean;
  /**
   * True when the value is provisional: derived proxy, projected-only, or a
   * low-confidence deck claim. The UI should distinguish provisional metrics
   * from directly measured actuals.
   */
  is_provisional?: boolean;
  /**
   * Human-readable explanation of why this fact was selected, or a signal that
   * a limitation exists (e.g. "Deck-sourced; workbook-derived proxy available").
   */
  selection_reason?: string | null;
};

/** Revenue + expense snapshot for one projected period. */
export type FinancialPeriodSnapshot = {
  period_label: string;
  period_type: string;
  revenue?: number;
  revenue_currency?: string;
  expenses?: number;
  ebitda?: number;
  is_projected: boolean;
};

/** A risk or data-quality flag with investor-readable message. */
export type FinancialRiskFlag = {
  severity: 'high' | 'medium' | 'low';
  /** Machine-readable code for downstream consumers. */
  code: string;
  /** Investor-readable explanation. */
  message: string;
};

export type FinancialBreakdownV1 = {
  /** True when any XLSX-sourced facts are present. */
  has_xlsx: boolean;
  /** True when current or historical realized financials are present. */
  has_current_state: boolean;
  /** True when projected future-period data is present. */
  has_projections: boolean;
  /** True when a cap table document or cap-table-related facts are detected. */
  has_cap_table: boolean;

  // ── Section 1: Current Financial State ────────────────────────────────────
  current_state: {
    revenue?: FinancialMetricPoint;
    burn_rate?: FinancialMetricPoint;
    runway_months?: FinancialMetricPoint;
    cash?: FinancialMetricPoint;
    gross_margin_pct?: FinancialMetricPoint;
    /**
     * Phase 2: Projected or alternative gross margin for temporal contrast.
     * Populated when a projected-period gross margin exists alongside a current value,
     * enabling the UI to present "Current 9.5%" vs "Projected 2028: 64.8%" separately.
     */
    alternative_gross_margin_fact?: FinancialMetricPoint;
    /** Plain-English summary of the company's current financial state. */
    summary: string;
    data_quality: 'complete' | 'partial' | 'missing';
  };

  // ── Section 2: Projected Financial Model ──────────────────────────────────
  projections: {
    periods: FinancialPeriodSnapshot[];
    /** Human-readable label for the first EBITDA-positive period, if visible. */
    path_to_profitability_label?: string;
    /** Plain-English summary of the forecast model. */
    summary: string;
    data_quality: 'complete' | 'partial' | 'missing';
  };

  // ── Section 3: Revenue Breakdown ──────────────────────────────────────────
  revenue_breakdown: {
    total_revenue?: FinancialMetricPoint;
    arr?: FinancialMetricPoint;
    mrr?: FinancialMetricPoint;
    bookings?: FinancialMetricPoint;
    ytd_recognized?: FinancialMetricPoint;
    ytd_cash?: FinancialMetricPoint;
    direct_revenue?: FinancialMetricPoint;
    /** Plain-English summary of revenue composition. */
    summary: string;
  };

  // ── Section 4: Expense Structure ──────────────────────────────────────────
  expense_structure: {
    total_headcount?: FinancialMetricPoint;
    headcount_by_function: Array<{ function: string; display_name: string; count: number }>;
    /** Plain-English summary of the headcount and expense structure. */
    summary: string;
  };

  // ── Section 5: Burn / Runway ──────────────────────────────────────────────
  burn_runway: {
    monthly_burn?: FinancialMetricPoint;
    /**
     * Phase 2: Alternative burn rate when the primary is weak (deck-only / low-confidence).
     * Populated when a workbook-derived or higher-quality burn proxy is also available.
     * The UI can present this as: "Deck: $250K/mo (low confidence) — Workbook proxy: $400K/mo (derived)".
     */
    alternative_burn_fact?: FinancialMetricPoint;
    runway_months?: FinancialMetricPoint;
    cash?: FinancialMetricPoint;
    /** Plain-English summary of burn and runway. */
    summary: string;
    confidence: 'high' | 'medium' | 'low' | 'not_available';
  };

  // ── Section 6: Assumptions (inferred) ────────────────────────────────────
  /** Plain-English summary of inferred model assumptions. */
  assumptions_summary: string;

  // ── Section 7: Cap Table ─────────────────────────────────────────────────
  cap_table_summary: string;
  has_cap_table_data: boolean;

  // ── Section 8: Risks / Inconsistencies ───────────────────────────────────
  risks: FinancialRiskFlag[];

  // ── Overall ───────────────────────────────────────────────────────────────
  /** 2–4 sentence investor-readable overview of the financial package. */
  narrative: string;
};

export type UnderwritingReadinessGap =
  | 'no_current_revenue'
  | 'projection_only'
  | 'no_expenses'
  | 'no_burn_rate'
  | 'no_runway'
  | 'no_cap_table'
  | 'deck_only'
  | 'sec_filing_no_xlsx'
  | 'conflicting_revenue'
  | 'no_income_statement';

export type UnderwritingReadinessV1 = {
  status: 'sufficient' | 'partially_sufficient' | 'insufficient';
  /** 0–100 composite readiness score derived from coverage signals. */
  score: number;
  /** Investor-readable reasons for the assigned status. */
  reasons: string[];
  /** Plain-English list of items still missing for full underwriting. */
  missing: string[];
  /** Machine-readable gap codes. */
  gaps: UnderwritingReadinessGap[];
  /** 1–2 sentence investor-readable summary and recommended next steps. */
  narrative: string;
};

// ─── Internal constants ───────────────────────────────────────────────────────

// Retained for period-snapshot collection (projection grouping) internal use.
const CONF_SCORES: Record<string, number> = { high: 3, medium: 2, low: 1 };

const HEADCOUNT_FUNCTION_MAP: Array<{ keys: string[]; display_name: string }> = [
  { keys: ['r_d_headcount', 'rd_headcount', 'engineering_headcount', 'product_engineering_headcount'], display_name: 'R&D / Engineering' },
  { keys: ['sales_headcount'], display_name: 'Sales' },
  { keys: ['marketing_headcount'], display_name: 'Marketing' },
  { keys: ['g_a_headcount', 'ga_headcount', 'general_admin_headcount'], display_name: 'G&A' },
  { keys: ['support_headcount', 'customer_success_headcount', 'customer_support_headcount'], display_name: 'Support / CS' },
  { keys: ['operations_headcount', 'ops_headcount'], display_name: 'Operations' },
  { keys: ['product_headcount'], display_name: 'Product' },
];

const CAP_TABLE_METRIC_KEYS = new Set([
  'total_shares', 'option_pool_pct', 'option_pool_shares', 'safe_amount',
  'pre_money_valuation', 'post_money_valuation', 'ownership_pct',
  'common_shares', 'preferred_shares', 'founder_ownership_pct',
]);

const PROJECTION_REVENUE_KEYS = ['revenue', 'arr', 'mrr'];
const PROJECTION_EXPENSE_KEYS = ['operating_expense', 'opex', 'total_expenses', 'total_costs'];
const PROJECTION_EBITDA_KEYS = ['ebitda', 'net_income', 'operating_income'];

// ─── Current-state fact selection ─────────────────────────────────────────────

/**
 * Select the best current-state fact for a headline field (burn_rate, runway, cash).
 *
 * Applies a strict priority ladder to prevent projected or provisional facts from
 * headlining current_state fields when better alternatives exist:
 *
 *   Pass 1 — Non-projected + non-provisional (explicit measured truth, highest quality)
 *   Pass 2 — Non-projected + is_derived (workbook-derived proxy beats deck-low-conf)
 *   Pass 3 — Non-projected + any (deck-low-conf is last resort when nothing else exists)
 *   → undefined   when ALL facts for these keys are projected (StackFactor guard)
 *
 * Why three passes?
 * - Pass 2 exists so a workbook-derived burn proxy (source_kind='unknown', is_derived=true)
 *   beats a deck+low-confidence $250/mo pricing artifact (DealDecision guard).
 * - Pass 3 retains deck-low-conf as a last resort so coverage is not silently dropped.
 *
 * @param metricKeys  The metric keys to select from (e.g. ['burn_rate', 'monthly_burn']).
 * @param cleanFacts  Already corruption-filtered FinancialFactV1[].
 */
function selectCurrentStateFact(
  metricKeys: string[],
  cleanFacts: FinancialFactV1[],
): FinancialFactV1 | undefined {
  const nonProjected = cleanFacts.filter((f) => !isProjectedFact(f));
  if (!nonProjected.some((f) => metricKeys.includes(f.metric_key))) return undefined;

  // Pass 1: non-projected, non-provisional (explicit, structured truth)
  const pass1 = selectAuthoritativeFact(
    metricKeys,
    nonProjected.filter((f) => !isProvisionalFact(f)),
  );
  if (pass1) return pass1;

  // Pass 2: non-projected, derived workbook proxy (beats deck-low-conf)
  const pass2 = selectAuthoritativeFact(
    metricKeys,
    nonProjected.filter((f) => f.is_derived === true),
  );
  if (pass2) return pass2;

  // Pass 3: any non-projected fact (deck-low-conf only option)
  return selectAuthoritativeFact(metricKeys, nonProjected);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toMetricPoint(
  f: FinancialFactV1,
  selection_reason?: string | null,
  opts?: { force_projected?: boolean },
): FinancialMetricPoint {
  const projected = isProjectedFact(f) || (opts?.force_projected ?? false);
  const isDerived = f.is_derived === true;
  const isDeckLowConf = f.source_kind === 'deck' && f.confidence === 'low';
  return {
    value: f.value,
    unit: f.unit,
    currency: f.currency,
    period_label: f.period_label,
    confidence: f.confidence,
    source_kind: f.source_kind,
    // Phase 2: semantic pass-through — omit fields that are falsy to keep JSON lean
    ...(isDerived ? { is_derived: true } : {}),
    ...(f.derivation_rule != null ? { derivation_rule: f.derivation_rule } : {}),
    ...(f.semantic_family != null ? { semantic_family: f.semantic_family } : {}),
    ...(f.semantic_role != null ? { semantic_role: f.semantic_role } : {}),
    ...(f.temporal_scope != null ? { temporal_scope: f.temporal_scope } : {}),
    ...(projected ? { is_projected: true } : {}),
    // is_provisional: true when derived, projected, or a low-confidence deck claim
    ...((isDerived || projected || isDeckLowConf) ? { is_provisional: true } : {}),
    ...(selection_reason != null ? { selection_reason } : {}),
  };
}

function fmtC(value: number, currency?: string): string {
  const sym = !currency || currency === 'USD' ? '$' : `${currency} `;
  const neg = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${neg}${sym}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${neg}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${neg}${sym}${(abs / 1_000).toFixed(0)}K`;
  return `${neg}${sym}${Math.round(abs).toLocaleString()}`;
}

function isCapTableDoc(doc: { filename?: string; kind?: string }): boolean {
  const name = (doc.filename ?? doc.kind ?? '').toLowerCase();
  return /cap[\s_-]?table|captable|capitaliz(ation|ation)/.test(name);
}

function collectProjectionPeriods(facts: FinancialFactV1[]): FinancialPeriodSnapshot[] {
  // Group projected non-corrupted facts by period_label
  const periodMap = new Map<string, { period_type: string; byKey: Map<string, FinancialFactV1> }>();

  for (const f of facts) {
    if (!isProjectedFact(f)) continue;
    if (isCorruptedFact(f).corrupted) continue;
    if (!periodMap.has(f.period_label)) {
      periodMap.set(f.period_label, { period_type: f.period_type, byKey: new Map() });
    }
    const slot = periodMap.get(f.period_label)!;
    // Keep highest-confidence fact per metric key per period
    const existing = slot.byKey.get(f.metric_key);
    if (!existing || (CONF_SCORES[f.confidence] ?? 0) > (CONF_SCORES[existing.confidence] ?? 0)) {
      slot.byKey.set(f.metric_key, f);
    }
  }

  const snapshots: FinancialPeriodSnapshot[] = [];
  for (const [period_label, { period_type, byKey }] of periodMap) {
    const revFact = PROJECTION_REVENUE_KEYS.map(k => byKey.get(k)).find(Boolean);
    const expFact = PROJECTION_EXPENSE_KEYS.map(k => byKey.get(k)).find(Boolean);
    const ebitdaFact = PROJECTION_EBITDA_KEYS.map(k => byKey.get(k)).find(Boolean);
    snapshots.push({
      period_label,
      period_type,
      revenue: revFact?.value,
      revenue_currency: revFact?.currency,
      expenses: expFact?.value,
      ebitda: ebitdaFact?.value,
      is_projected: true,
    });
  }

  snapshots.sort((a, b) => a.period_label.localeCompare(b.period_label));
  return snapshots;
}

// ─── Public builder: FinancialBreakdownV1 ─────────────────────────────────────

export function buildFinancialBreakdownV1(input: {
  financial_facts: FinancialFactV1[];
  financial_coverage_v1: FinancialCoverageProfileV1;
  /** Pass structured_summary.revenue to detect deck/xlsx revenue conflicts. */
  structured_summary?: any;
  documents?: Array<{ document_id: string; kind?: string; filename?: string }> | null;
}): FinancialBreakdownV1 {
  try {
    return _build(input);
  } catch {
    return _emptyBreakdown(input.financial_coverage_v1?.sources?.some(s => s.kind === 'xlsx') ?? false);
  }
}

function _emptyBreakdown(hasXlsx: boolean): FinancialBreakdownV1 {
  return {
    has_xlsx: hasXlsx,
    has_current_state: false,
    has_projections: false,
    has_cap_table: false,
    current_state: {
      summary: 'No financial data is available.',
      data_quality: 'missing',
    },
    projections: {
      periods: [],
      summary: 'No projected financial data is available.',
      data_quality: 'missing',
    },
    revenue_breakdown: {
      summary: 'Revenue breakdown is not available.',
    },
    expense_structure: {
      headcount_by_function: [],
      summary: 'Expense structure is not available.',
    },
    burn_runway: {
      summary: 'Burn rate and runway data are not available.',
      confidence: 'not_available',
    },
    assumptions_summary: 'Model assumptions are not available.',
    cap_table_summary: 'No cap table was provided.',
    has_cap_table_data: false,
    risks: [
      {
        severity: 'high',
        code: 'deck_only',
        message: 'No spreadsheet financial model is present. All financial data is sourced from the pitch deck only.',
      },
    ],
    narrative: 'No structured financial data is available for this deal. Financial analysis is based on pitch deck content only.',
  };
}

function _build(input: {
  financial_facts: FinancialFactV1[];
  financial_coverage_v1: FinancialCoverageProfileV1;
  structured_summary?: any;
  documents?: Array<{ document_id: string; kind?: string; filename?: string }> | null;
}): FinancialBreakdownV1 {
  const { financial_facts: rawFacts, financial_coverage_v1: coverage, structured_summary: ss } = input;
  const docs = Array.isArray(input.documents) ? input.documents : [];

  // Strip corrupted facts before any selection. Track which were dropped for risk reporting.
  const corruptedFacts = rawFacts.filter(f => isCorruptedFact(f).corrupted);
  const facts = filterCorruptedFacts(rawFacts);

  const hasXlsx = coverage.sources.some(s => s.kind === 'xlsx');
  const xlsxFacts = facts.filter(f => f.source_kind === 'xlsx');

  // Cap table detection
  const hasCapTableDoc = docs.some(isCapTableDoc);
  const hasCapTableFacts = facts.some(f => CAP_TABLE_METRIC_KEYS.has(f.metric_key));
  const has_cap_table = hasCapTableDoc || hasCapTableFacts;

  // ── Section 2: Projections (collect early so has_projections is accurate) ─

  const projPeriods = collectProjectionPeriods(facts);

  // ── Section 1: Current Financial State ──────────────────────────────────

  // Canonical revenue selection: uses the shared selectCanonicalRevenueFact selector
  // (defined in select-authoritative-fact.ts) so this path always agrees with
  // structured_summary.revenue, which is populated by injectCanonicalRevenueIntoStructuredSummary.
  const revFact = selectCanonicalRevenueFact(rawFacts);

  // Detect if the selected revenue fact was returned via Tier D (proforma-model fallback).
  // When it was, toMetricPoint must carry is_projected=true because isProjectedFact()
  // returns false for current-year facts even when they are proforma budget figures.
  //
  // We re-run detectProformaModelFactIds against the same non-monthly revenue pool
  // that selectCanonicalRevenueFact uses internally. This is a pure function call
  // so the double evaluation is safe and cheap.
  const _proformaCheckPool = revFact != null
    ? filterCorruptedFacts(rawFacts).filter(
        (f) =>
          (CANONICAL_REVENUE_KEYS as string[]).includes(f.metric_key) &&
          (f.period_type === 'annual' || f.period_type === 'ttm'),
      )
    : [];
  const _proformaModelFactIds =
    _proformaCheckPool.length > 0
      ? detectProformaModelFactIds(_proformaCheckPool)
      : new Set<string>();
  const revFactIsProforma =
    revFact != null && _proformaModelFactIds.has(revFact.fact_id);

  // Current-state burn/runway/cash: use selectCurrentStateFact to enforce the
  // three-pass priority ladder (non-projected > non-provisional > any non-projected).
  // Projected facts are NEVER selected as current_state headline values (StackFactor guard).
  const BURN_KEYS = ['burn_rate', 'monthly_burn', 'net_burn'];
  const RUNWAY_KEYS = ['runway_months', 'runway'];
  const CASH_KEYS = ['cash', 'cash_on_hand', 'cash_and_equivalents'];

  const burnFact = selectCurrentStateFact(BURN_KEYS, facts);
  const runwayFact = selectCurrentStateFact(RUNWAY_KEYS, facts);
  const cashFact = selectCurrentStateFact(CASH_KEYS, facts);

  // When no non-projected burn/runway exists, surface the best projected value
  // as an alternative (with selection_reason='projected_only') so the existence of
  // forward-looking data is not silently dropped from the report.
  const projectedBurnFact = burnFact == null
    ? selectAuthoritativeFact(BURN_KEYS, facts, { requireProjected: true })
    : null;
  const projectedRunwayFact = runwayFact == null
    ? selectAuthoritativeFact(RUNWAY_KEYS, facts, { requireProjected: true })
    : null;

  const grossMarginFact = selectAuthoritativeFact(['gross_margin', 'gross_margin_pct', 'gross_margin_percent'], facts, { requireNonProjected: true });

  // ── Phase 2: Alternative fact discovery ────────────────────────────────────

  // Alternative burn: surface workbook-derived proxy when primary is deck/low-conf.
  const alternativeBurnFact = selectAlternativeFact(
    BURN_KEYS,
    facts,
    burnFact,
  );
  // True when burn primary is too weak to rely on alone.
  const burnIsWeak =
    burnFact != null &&
    (burnFact.source_kind === 'deck' || burnFact.confidence === 'low' || burnFact.is_derived === true);
  // Selection reason reflects whether the primary is deck-provisional or workbook-derived.
  const burnPrimarySelectionReason =
    burnIsWeak && alternativeBurnFact != null
      ? burnFact!.source_kind === 'deck'
        ? 'Deck-sourced burn rate (low confidence). Workbook-derived operating proxy available — see alternative_burn_fact.'
        : 'Workbook-derived burn proxy. Alternative estimate available — see alternative_burn_fact.'
      : null;
  const burnAltSelectionReason =
    alternativeBurnFact != null
      ? 'Workbook-derived operating burn proxy. See derivation_rule for calculation details.'
      : null;

  // Alternative gross margin: show projected alternative alongside current for temporal context.
  const projectedGrossMarginFact = selectAlternativeFact(
    ['gross_margin', 'gross_margin_pct', 'gross_margin_percent'],
    facts,
    grossMarginFact,
  );

  const has_current_state = revFact != null || burnFact != null || cashFact != null;
  // Actual projected fact-periods take precedence over the coverage flag (which can be set by deck language)
  const has_projections = projPeriods.length > 0;

  const csQuality: 'complete' | 'partial' | 'missing' =
    revFact != null && (burnFact != null || runwayFact != null) ? 'complete' :
    revFact != null || burnFact != null ? 'partial' :
    'missing';

  const csParts: string[] = [];
  if (revFact) csParts.push(`Revenue: ${fmtC(revFact.value, revFact.currency)} (${revFact.period_label}, ${revFact.confidence} confidence, source: ${revFact.source_kind}${revFactIsProforma ? ' — proforma projection' : ''})`);
  if (burnFact) {
    const burnSuffix = burnIsWeak && alternativeBurnFact ? ' [deck-sourced; workbook proxy available]' : '';
    csParts.push(`Monthly burn: ${fmtC(burnFact.value, burnFact.currency)}${burnSuffix}`);
  }
  if (runwayFact) csParts.push(`Runway: ${runwayFact.value} months`);
  if (cashFact) csParts.push(`Cash on hand: ${fmtC(cashFact.value, cashFact.currency)}`);

  let csSummary: string;
  if (csParts.length > 0) {
    csSummary = 'Current financial state: ' + csParts.join('; ') + '.';
    if (!burnFact && !runwayFact) csSummary += ' Burn rate and cash runway are not available in the current financial package.';
  } else {
    csSummary = 'Current financial state data is not available. The financial package does not include current-period revenue, burn, or cash figures.';
  }

  // ── Section 2: Projections ────────────────────────────────────────────────

  let projSummary: string;
  let projDataQuality: 'complete' | 'partial' | 'missing';
  if (projPeriods.length === 0) {
    projSummary = 'No projected financial periods are present in the financial package. The model covers current-state data only.';
    projDataQuality = 'missing';
  } else {
    const labels = projPeriods.map(p => {
      const parts = [p.period_label];
      if (p.revenue != null) parts.push(`revenue ${fmtC(p.revenue, p.revenue_currency)}`);
      if (p.ebitda != null) parts.push(`EBITDA ${fmtC(p.ebitda)}`);
      return parts.join(': ');
    });
    projSummary = `The financial model includes ${projPeriods.length} projected period${projPeriods.length > 1 ? 's' : ''}: ${labels.join(', ')}.`;
    const hasExpenses = projPeriods.some(p => p.expenses != null);
    const hasEbitda = projPeriods.some(p => p.ebitda != null);
    projDataQuality = projPeriods.some(p => p.revenue != null) && (hasExpenses || hasEbitda) ? 'complete' : 'partial';
  }

  const firstProfitablePeriod = projPeriods.find(p => p.ebitda != null && p.ebitda > 0);
  const pathToProfitabilityLabel = firstProfitablePeriod
    ? `Projected EBITDA-positive by ${firstProfitablePeriod.period_label}`
    : undefined;

  // ── Section 3: Revenue Breakdown ──────────────────────────────────────────

  const mainRevFact = selectAuthoritativeFact(['revenue'], facts, { requireNonProjected: true });
  const arrFact = selectAuthoritativeFact(['arr'], facts, { requireNonProjected: true });
  const mrrFact = selectAuthoritativeFact(['mrr'], facts, { requireNonProjected: true });
  const bookingsFact = selectAuthoritativeFact(['cash_received', 'bookings', 'total_bookings', 'total_cash_received'], facts, { requireNonProjected: true });
  const ytdRecognizedFact = selectAuthoritativeFact(['ytd_revenue_recognized', 'ytd_recognized_revenue'], facts, { requireNonProjected: true });
  const ytdCashFact = selectAuthoritativeFact(['ytd_cash_received', 'ytd_cash'], facts, { requireNonProjected: true });
  const directRevFact = selectAuthoritativeFact(['direct_booked_revenue', 'direct_revenue', 'direct_bookings'], facts, { requireNonProjected: true });

  const revParts: string[] = [];
  if (mainRevFact) revParts.push(`recognized revenue ${fmtC(mainRevFact.value, mainRevFact.currency)} (${mainRevFact.period_label})`);
  if (bookingsFact) revParts.push(`cash collected ${fmtC(bookingsFact.value, bookingsFact.currency)}`);
  if (ytdRecognizedFact) revParts.push(`YTD recognized ${fmtC(ytdRecognizedFact.value, ytdRecognizedFact.currency)}`);
  if (ytdCashFact) revParts.push(`YTD cash collected ${fmtC(ytdCashFact.value, ytdCashFact.currency)}`);
  if (directRevFact) revParts.push(`direct bookings ${fmtC(directRevFact.value, directRevFact.currency)}`);
  if (arrFact) revParts.push(`ARR ${fmtC(arrFact.value, arrFact.currency)}`);
  if (mrrFact) revParts.push(`MRR ${fmtC(mrrFact.value, mrrFact.currency)}`);

  const revSummary = revParts.length > 0
    ? `Revenue is presented at multiple levels: ${revParts.join(', ')}.`
    : 'Revenue breakdown details are not available.';

  // ── Section 4: Expense Structure ──────────────────────────────────────────

  const totalHCFact = selectAuthoritativeFact(['total_headcount'], facts, { requireNonProjected: true });
  const hcByFunction: Array<{ function: string; display_name: string; count: number }> = [];

  for (const fn of HEADCOUNT_FUNCTION_MAP) {
    const hcFact = selectAuthoritativeFact(fn.keys, facts, { requireNonProjected: true });
    if (hcFact != null) {
      hcByFunction.push({ function: fn.keys[0], display_name: fn.display_name, count: hcFact.value });
    }
  }

  let expenseSummary: string;
  if (totalHCFact) {
    const fnBreakdown = hcByFunction.map(h => `${h.display_name} (${h.count})`).join(', ');
    expenseSummary = `The company has ${totalHCFact.value} total headcount${fnBreakdown ? `: ${fnBreakdown}` : ''}.`;
  } else if (hcByFunction.length > 0) {
    const derived = hcByFunction.reduce((s, h) => s + h.count, 0);
    const fnBreakdown = hcByFunction.map(h => `${h.display_name} (${h.count})`).join(', ');
    expenseSummary = `Headcount breakdown available (${derived} total derived): ${fnBreakdown}.`;
  } else {
    expenseSummary = 'Headcount and expense structure breakdown is not available in the financial package.';
  }

  // ── Section 5: Burn / Runway ──────────────────────────────────────────────

  const burnRunwayConf: 'high' | 'medium' | 'low' | 'not_available' =
    burnFact && runwayFact ? 'high' :
    burnFact || runwayFact || cashFact ? 'medium' :
    'not_available';

  let burnRunwaySummary: string;
  if (burnFact && runwayFact) {
    burnRunwaySummary = `Monthly burn is ${fmtC(burnFact.value, burnFact.currency)} with ${runwayFact.value} months of runway remaining.`;
  } else if (burnFact) {
    burnRunwaySummary = `Monthly burn is ${fmtC(burnFact.value, burnFact.currency)}. Runway could not be derived from the available data.`;
  } else if (runwayFact) {
    burnRunwaySummary = `Runway is estimated at ${runwayFact.value} months. Monthly burn rate is not separately stated.`;
  } else if (cashFact) {
    burnRunwaySummary = `Cash on hand is ${fmtC(cashFact.value, cashFact.currency)}. Monthly burn rate and runway are not directly available.`;
  } else {
    burnRunwaySummary = 'Burn rate and runway data are not available in the current financial package.';
  }

  // ── Section 6: Assumptions (inferred) ────────────────────────────────────

  const assumptionParts: string[] = [];

  // Implied CAGR from projection periods
  if (projPeriods.length >= 2) {
    const first = projPeriods[0];
    const last = projPeriods[projPeriods.length - 1];
    if (first.revenue != null && last.revenue != null && first.revenue > 0) {
      const years = projPeriods.length - 1;
      const cagr = (Math.pow(last.revenue / first.revenue, 1 / years) - 1) * 100;
      if (Number.isFinite(cagr) && cagr > 0) {
        assumptionParts.push(`Implied revenue CAGR: ~${cagr.toFixed(0)}% (${first.period_label} to ${last.period_label})`);
      }
    }
  }

  // MRR × 12 vs ARR consistency check
  if (mrrFact && arrFact && arrFact.value > 0) {
    const impliedARR = mrrFact.value * 12;
    const devPct = Math.abs(impliedARR - arrFact.value) / arrFact.value;
    if (devPct > 0.15) {
      assumptionParts.push(
        `MRR (${fmtC(mrrFact.value, mrrFact.currency)}) × 12 = ${fmtC(impliedARR, arrFact.currency)} vs stated ARR ${fmtC(arrFact.value, arrFact.currency)} — model may include non-recurring revenue`
      );
    }
  }

  const assumptionsSummary = assumptionParts.length > 0
    ? assumptionParts.join('. ') + '.'
    : hasXlsx
      ? 'The financial spreadsheet does not include a dedicated assumptions sheet visible in the extracted data. Growth and pricing assumptions cannot be independently audited.'
      : 'No financial model assumptions are available. Financial figures are sourced from the pitch deck only.';

  // ── Section 7: Cap Table ──────────────────────────────────────────────────

  let capTableSummary: string;
  if (hasCapTableDoc && hasCapTableFacts) {
    capTableSummary = 'A cap table document and capitalization facts are present. Dilution and ownership breakdown can be reviewed.';
  } else if (hasCapTableDoc) {
    capTableSummary = 'A cap table document was provided. Structured cap table data has not been extracted into financial facts.';
  } else if (hasCapTableFacts) {
    capTableSummary = 'Capitalization data is present in the extracted financial facts. A separate cap table document was not detected.';
  } else {
    capTableSummary = 'No cap table document or capitalization data was provided. Ownership structure, dilution, and option pool effects cannot be assessed.';
  }

  // ── Section 8: Risks / Inconsistencies ───────────────────────────────────

  const risks: FinancialRiskFlag[] = [];

  // Surface corruption as a risk flag
  if (corruptedFacts.length > 0) {
    const uniqueReasons = [...new Set(corruptedFacts.map(f => isCorruptedFact(f).reason ?? 'unknown'))];
    risks.push({
      severity: 'medium',
      code: 'corrupted_extraction_values',
      message: `${corruptedFacts.length} extracted financial value${corruptedFacts.length > 1 ? 's were' : ' was'} rejected due to extraction artifacts (${uniqueReasons.join(', ')}). These values have been excluded from the analysis.`,
    });
  }

  if (!hasXlsx) {
    risks.push({
      severity: 'high',
      code: 'deck_only',
      message: 'No spreadsheet financial model is present. All financial data is sourced from the pitch deck, which may be selective or incomplete.',
    });
  }

  // Conflicting revenue: deck says ~$0 but xlsx says material revenue
  if (hasXlsx && xlsxFacts.length > 0) {
    const xlsxRev = xlsxFacts.find(f => f.metric_key === 'revenue' && f.value > 0);
    const deckCandidates = Array.isArray(ss?.revenue?.candidates)
      ? (ss.revenue.candidates as any[]).filter((c: any) =>
          !c.selected && c.sources?.some((src: any) => src.kind !== 'xlsx')
        )
      : [];
    const deckRevAmount = deckCandidates[0]?.amount;
    if (xlsxRev && typeof deckRevAmount === 'number' && deckRevAmount < xlsxRev.value * 0.1 && xlsxRev.value > 10_000) {
      risks.push({
        severity: 'medium',
        code: 'conflicting_revenue',
        message: `Deck-derived revenue (${fmtC(deckRevAmount)}) is significantly lower than the financial model (${fmtC(xlsxRev.value, xlsxRev.currency)}). The deck may use a different revenue recognition period or definition.`,
      });
    }
  }

  if (!coverage.coverage.burn_rate_present && !coverage.coverage.runway_present) {
    risks.push({
      severity: 'medium',
      code: 'missing_burn_runway',
      message: 'Burn rate and runway are not present in the financial package. Cash position and capital efficiency cannot be assessed.',
    });
  }

  if (coverage.coverage.forecast_revenue_present && !coverage.coverage.historical_revenue_present) {
    risks.push({
      severity: 'high',
      code: 'projection_only',
      message: 'The financial model contains projected data but no current or historical actuals. Forecast assumptions cannot be benchmarked against realized performance.',
    });
  }

  if (hasXlsx && !coverage.coverage.income_statement_present) {
    risks.push({
      severity: 'low',
      code: 'no_income_statement',
      message: 'A spreadsheet model is present, but income-statement metrics (EBITDA, gross margin, COGS) are not visible in the extracted data. Profitability structure cannot be fully assessed.',
    });
  }

  if (!has_cap_table) {
    risks.push({
      severity: 'low',
      code: 'no_cap_table',
      message: 'No cap table was provided. Ownership structure, dilution, and option pool effects cannot be evaluated.',
    });
  }

  // ── Overall Narrative ─────────────────────────────────────────────────────

  const narrativeParts: string[] = [];

  if (hasXlsx) {
    const xlsxDocCount = coverage.sources.filter(s => s.kind === 'xlsx').length;
    narrativeParts.push(
      `This deal includes ${xlsxDocCount} spreadsheet financial model${xlsxDocCount !== 1 ? 's' : ''} providing structured financial data beyond the pitch deck.`
    );
  } else {
    narrativeParts.push('Financial data is sourced from the pitch deck only; no spreadsheet financial model is present.');
  }

  if (revFact) {
    const arrNote = arrFact ? `, with ARR of ${fmtC(arrFact.value, arrFact.currency)}` : '';
    const revLabel = revFactIsProforma
      ? `Proforma projected revenue is ${fmtC(revFact.value, revFact.currency)} (${revFact.period_label}, ${revFact.confidence} confidence — proforma projection)`
      : `Current revenue is ${fmtC(revFact.value, revFact.currency)} (${revFact.period_label}, ${revFact.confidence} confidence)`;
    narrativeParts.push(`${revLabel}${arrNote}.`);
  }

  if (projPeriods.length > 0) {
    const last = projPeriods[projPeriods.length - 1];
    if (last.revenue != null) {
      narrativeParts.push(`The model projects revenue of ${fmtC(last.revenue, last.revenue_currency)} by ${last.period_label}.`);
    }
  }

  if (!burnFact && !runwayFact && !cashFact) {
    narrativeParts.push('Burn rate and runway are not available; cash position cannot be assessed from the current package.');
  } else if (burnFact || runwayFact) {
    narrativeParts.push(burnRunwaySummary);
  }

  return {
    has_xlsx: hasXlsx,
    has_current_state,
    has_projections,
    has_cap_table,
    current_state: {
      revenue: revFact
        ? toMetricPoint(
            revFact,
            revFactIsProforma ? 'proforma_projection_fallback' : null,
            revFactIsProforma ? { force_projected: true } : undefined,
          )
        : undefined,
      burn_rate: burnFact ? toMetricPoint(burnFact, burnPrimarySelectionReason) : undefined,
      runway_months: runwayFact ? toMetricPoint(runwayFact) : undefined,
      cash: cashFact ? toMetricPoint(cashFact) : undefined,
      gross_margin_pct: grossMarginFact ? toMetricPoint(grossMarginFact) : undefined,
      // Phase 2: projected gross margin for temporal contrast (current vs projected).
      alternative_gross_margin_fact: projectedGrossMarginFact
        ? toMetricPoint(projectedGrossMarginFact, 'Projected gross margin — different period from current state. Not directly comparable.')
        : undefined,
      summary: csSummary,
      data_quality: csQuality,
    },
    projections: {
      periods: projPeriods,
      path_to_profitability_label: pathToProfitabilityLabel,
      summary: projSummary,
      data_quality: projDataQuality,
    },
    revenue_breakdown: {
      total_revenue: mainRevFact ? toMetricPoint(mainRevFact) : undefined,
      arr: arrFact ? toMetricPoint(arrFact) : undefined,
      mrr: mrrFact ? toMetricPoint(mrrFact) : undefined,
      bookings: bookingsFact ? toMetricPoint(bookingsFact) : undefined,
      ytd_recognized: ytdRecognizedFact ? toMetricPoint(ytdRecognizedFact) : undefined,
      ytd_cash: ytdCashFact ? toMetricPoint(ytdCashFact) : undefined,
      direct_revenue: directRevFact ? toMetricPoint(directRevFact) : undefined,
      summary: revSummary,
    },
    expense_structure: {
      total_headcount: totalHCFact ? toMetricPoint(totalHCFact) : undefined,
      headcount_by_function: hcByFunction,
      summary: expenseSummary,
    },
    burn_runway: {
      monthly_burn: burnFact ? toMetricPoint(burnFact, burnPrimarySelectionReason) : undefined,
      // Phase 2 / Fix #7: alternative burn slot has two distinct use-cases:
      //   (a) primary is provisional (deck/derived) — surface the workbook alternative
      //   (b) no non-projected burn exists — surface the projected fact as projected_only
      //       so the data is not silently dropped, but is clearly labeled.
      alternative_burn_fact: alternativeBurnFact
        ? toMetricPoint(alternativeBurnFact, burnAltSelectionReason)
        : projectedBurnFact
          ? toMetricPoint(projectedBurnFact, 'projected_only')
          : undefined,
      runway_months: runwayFact ? toMetricPoint(runwayFact) : undefined,
      // Fix #7: when no non-projected runway exists, surface the projected runway as projected_only.
      ...(runwayFact == null && projectedRunwayFact != null
        ? { runway_months: toMetricPoint(projectedRunwayFact, 'projected_only') }
        : {}),
      cash: cashFact ? toMetricPoint(cashFact) : undefined,
      summary: burnRunwaySummary,
      confidence: burnRunwayConf,
    },
    assumptions_summary: assumptionsSummary,
    cap_table_summary: capTableSummary,
    has_cap_table_data: has_cap_table,
    risks,
    narrative: narrativeParts.join(' '),
  };
}

// ─── Public builder: UnderwritingReadinessV1 ─────────────────────────────────

export function buildUnderwritingReadinessV1(input: {
  financial_breakdown_v1: FinancialBreakdownV1;
  financial_coverage_v1: FinancialCoverageProfileV1;
  financial_integrity_v1?: FinancialIntegrityV1;
}): UnderwritingReadinessV1 {
  try {
    return _buildReadiness(input);
  } catch {
    return {
      status: 'insufficient',
      score: 0,
      reasons: ['Unable to assess underwriting readiness due to an unexpected error.'],
      missing: ['Financial model or XLSX data'],
      gaps: ['deck_only'],
      narrative: 'The financial package is insufficient for underwriting. No structured financial data is available.',
    };
  }
}

function _buildReadiness(input: {
  financial_breakdown_v1: FinancialBreakdownV1;
  financial_coverage_v1: FinancialCoverageProfileV1;
  financial_integrity_v1?: FinancialIntegrityV1;
}): UnderwritingReadinessV1 {
  const { financial_breakdown_v1: bd, financial_coverage_v1: cov, financial_integrity_v1: fi } = input;

  let score = 0;
  const reasons: string[] = [];
  const missing: string[] = [];
  const gaps: UnderwritingReadinessGap[] = [];

  // +20 pts: XLSX financial model present OR audited SEC filing present (RC-001ft)
  const hasSecFiling = Array.isArray(cov.notes) && cov.notes.includes('sec_filing_present');
  if (bd.has_xlsx) {
    score += 20;
    reasons.push('A spreadsheet financial model is present.');
  } else if (hasSecFiling) {
    score += 20;
    reasons.push('Audited financial statements are present in a SEC filing (satisfies structured-financials requirement).');
    gaps.push('sec_filing_no_xlsx');
  } else {
    gaps.push('deck_only');
    missing.push('Spreadsheet financial model (XLSX)');
  }

  // +20 pts: Current-state revenue available
  if (bd.current_state.revenue) {
    score += 20;
    const r = bd.current_state.revenue;
    reasons.push(`Current revenue is available (${fmtC(r.value, r.currency)}, ${r.confidence} confidence).`);
  } else {
    gaps.push('no_current_revenue');
    missing.push('Current or historical revenue figures');
  }

  // +15 pts: Projections present
  if (bd.has_projections) {
    score += 15;
    reasons.push('Forward-looking financial projections are present.');
  } else {
    missing.push('Projected financial model');
  }

  // +15 pts: Burn rate or runway visible
  if (cov.coverage.burn_rate_present || cov.coverage.runway_present) {
    score += 15;
    reasons.push('Burn rate or runway data is available.');
  } else {
    if (!cov.coverage.burn_rate_present) gaps.push('no_burn_rate');
    if (!cov.coverage.runway_present) gaps.push('no_runway');
    missing.push('Burn rate and runway data');
  }

  // +15 pts: Income statement signals
  if (cov.coverage.income_statement_present) {
    score += 15;
    reasons.push('Income statement metrics (EBITDA, gross margin, or P&L) are present.');
  } else {
    gaps.push('no_income_statement');
    missing.push('Income statement / P&L breakdown');
  }

  // +10 pts: Cap table present
  if (bd.has_cap_table) {
    score += 10;
    reasons.push('Cap table data is available.');
  } else {
    gaps.push('no_cap_table');
    missing.push('Cap table and capitalization data');
  }

  // +5 pts: No critical data contradictions
  // Blocked when integrity analysis has confirmed FAIL-level discrepancies.
  const hasIntegrityFail = fi
    ? fi.has_facts && fi.flags.some(f => f.status === 'FAIL' && (f.severity === 'critical' || f.severity === 'high'))
    : false;
  const hasCriticalRisk = bd.risks.some(r => r.severity === 'high' && r.code !== 'no_cap_table' && r.code !== 'deck_only');
  if (!hasCriticalRisk && !hasIntegrityFail) {
    score += 5;
    reasons.push('No critical financial data inconsistencies were detected.');
  } else {
    if (hasIntegrityFail) {
      const failFlags = fi!.flags.filter(f => f.status === 'FAIL' && (f.severity === 'critical' || f.severity === 'high'));
      // Separate temporal alignment issues from quantitative data conflicts.
      // period_alignment:* flags represent projected vs historical period mismatches,
      // not numeric conflicts — they are surfaced in the dedicated temporal alignment panel.
      const quantitativeFails = failFlags.filter(f => !f.flag_key.startsWith('period_alignment:'));
      const hasTemporalAlignmentFails = failFlags.some(f => f.flag_key.startsWith('period_alignment:'));
      if (quantitativeFails.length > 0) {
        // Use fact_type label where available; fall back to the terminal segment of flag_key.
        const labels = quantitativeFails.slice(0, 3).map(f =>
          f.fact_type ? f.fact_type.replace(/_/g, ' ') : (f.flag_key.split(':').pop() ?? f.flag_key).replace(/_/g, ' ')
        );
        reasons.push(`Financial integrity issues detected: ${labels.join(', ')}.`);
        gaps.push('conflicting_revenue');
      }
      if (hasTemporalAlignmentFails) {
        reasons.push('Data comparability is limited for some metrics due to projected vs. historical period differences.');
      }
    }
    if (bd.risks.some(r => r.code === 'projection_only')) gaps.push('projection_only');
    if (!hasIntegrityFail && bd.risks.some(r => r.code === 'conflicting_revenue')) gaps.push('conflicting_revenue');
  }

  const status: UnderwritingReadinessV1['status'] =
    score >= 75 ? 'sufficient' :
    score >= 40 ? 'partially_sufficient' :
    'insufficient';

  const uniqueGaps = [...new Set(gaps)] as UnderwritingReadinessGap[];

  let narrative: string;
  if (status === 'sufficient') {
    const strengthen = missing.length > 0
      ? ` To strengthen the analysis, consider providing: ${missing.join(', ')}.`
      : '';
    narrative = `The financial package is sufficient for underwriting. ${reasons.slice(0, 2).join(' ')}${strengthen}`;
  } else if (status === 'partially_sufficient') {
    const keyStrengths = reasons.slice(0, 2).join(' ');
    const keyMissing = missing.slice(0, 3).join(', ');
    narrative = `The financial package is partially sufficient for underwriting. ${keyStrengths} To complete underwriting, the following are still needed: ${keyMissing}.`;
  } else {
    const keyMissing = missing.slice(0, 3).join(', ');
    const hint = bd.has_xlsx
      ? 'The financial model may need to be re-processed to extract structured facts.'
      : 'A spreadsheet financial model should be provided alongside the pitch deck.';
    narrative = `The financial package is insufficient for underwriting. Key missing items: ${keyMissing}. ${hint}`;
  }

  return { status, score, reasons, missing, gaps: uniqueGaps, narrative };
}
