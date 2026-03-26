// Local structural types mirroring packages/core/src/models/financial-breakdown-v1.ts.
// Kept inline so the web app has no hard dependency on the core package types.

export type FinancialMetricPointLike = {
  value?: number | null;
  unit?: string | null;
  currency?: string | null;
  period_label?: string | null;
  confidence?: string | null;
  source_kind?: string | null;
  // Phase 2: semantic enrichment (mirrors FinancialMetricPoint in @dealdecision/core)
  is_derived?: boolean | null;
  derivation_rule?: string | null;
  semantic_family?: string | null;
  semantic_role?: string | null;
  temporal_scope?: string | null;
  is_projected?: boolean | null;
  is_provisional?: boolean | null;
  selection_reason?: string | null;
};

export type FinancialRiskFlagLike = {
  severity: 'high' | 'medium' | 'low';
  code: string;
  message: string;
};

export type FinancialCurrentStateLike = {
  revenue?: FinancialMetricPointLike | null;
  burn_rate?: FinancialMetricPointLike | null;
  runway_months?: FinancialMetricPointLike | null;
  cash?: FinancialMetricPointLike | null;
  gross_margin_pct?: FinancialMetricPointLike | null;
  summary?: string | null;
  data_quality?: string | null;
  // Phase 2: projected vs current temporal contrast
  alternative_gross_margin_fact?: FinancialMetricPointLike | null;
};

export type FinancialBurnRunwayLike = {
  monthly_burn?: FinancialMetricPointLike | null;
  runway_months?: FinancialMetricPointLike | null;
  cash?: FinancialMetricPointLike | null;
  summary?: string | null;
  confidence?: string | null;
  // Phase 2: workbook-derived proxy when primary burn is weak (deck / low-conf)
  alternative_burn_fact?: FinancialMetricPointLike | null;
};

export type FinancialPeriodSnapshotLike = {
  period_label?: string | null;
  revenue?: FinancialMetricPointLike | null;
  net_income?: FinancialMetricPointLike | null;
};

export type FinancialProjectionsLike = {
  periods?: FinancialPeriodSnapshotLike[] | null;
  path_to_profitability_label?: string | null;
  summary?: string | null;
  data_quality?: string | null;
};

export type FinancialCapTableSummaryLike = {
  total_raised?: FinancialMetricPointLike | null;
  post_money_valuation?: FinancialMetricPointLike | null;
  summary?: string | null;
};

export type FinancialBreakdownV1Like = {
  current_state?: FinancialCurrentStateLike | null;
  projections?: FinancialProjectionsLike | null;
  burn_runway?: FinancialBurnRunwayLike | null;
  cap_table_summary?: FinancialCapTableSummaryLike | null;
  risks?: FinancialRiskFlagLike[] | null;
  narrative?: string | null;
  has_xlsx?: boolean;
  has_current_state?: boolean;
  has_projections?: boolean;
  has_cap_table?: boolean;
};

export type UnderwritingReadinessGapLike =
  | 'no_current_revenue'
  | 'projection_only'
  | 'no_expenses'
  | 'no_burn_rate'
  | 'no_runway'
  | 'no_cap_table'
  | 'deck_only'
  | 'conflicting_revenue'
  | 'no_income_statement';

export type UnderwritingReadinessV1Like = {
  status: 'sufficient' | 'partially_sufficient' | 'insufficient';
  score: number;
  reasons: string[];
  missing: string[];
  gaps: UnderwritingReadinessGapLike[];
  narrative: string;
};

export type AuthoritativeFinancialBreakdownSelectionV1 = {
  value: FinancialBreakdownV1Like | null;
  source: 'report.financial_breakdown_v1' | 'missing';
};

export type AuthoritativeUnderwritingReadinessSelectionV1 = {
  value: UnderwritingReadinessV1Like | null;
  source: 'report.underwriting_readiness_v1' | 'missing';
};

function unwrapEnvelope(reportOrEnvelope: unknown): any {
  const r = reportOrEnvelope as any;
  return r?.report && typeof r.report === 'object' ? r.report : r;
}

export function selectAuthoritativeFinancialBreakdownV1(
  reportOrEnvelope?: unknown | null,
): AuthoritativeFinancialBreakdownSelectionV1 {
  const report = unwrapEnvelope(reportOrEnvelope);

  if (!report || typeof report !== 'object') {
    return { value: null, source: 'missing' };
  }

  // Return the block whenever it is actually present — do not gate on overall report readiness.
  // Non-XLSX deals often have financial_breakdown_v1 but lack structured_summary / ready:true.
  const block = (report as any)?.financial_breakdown_v1;
  if (!block || typeof block !== 'object') {
    return { value: null, source: 'missing' };
  }

  return { value: block as FinancialBreakdownV1Like, source: 'report.financial_breakdown_v1' };
}

export function selectAuthoritativeUnderwritingReadinessV1(
  reportOrEnvelope?: unknown | null,
): AuthoritativeUnderwritingReadinessSelectionV1 {
  const report = unwrapEnvelope(reportOrEnvelope);

  if (!report || typeof report !== 'object') {
    return { value: null, source: 'missing' };
  }

  // Return the block whenever it is actually present.
  const block = (report as any)?.underwriting_readiness_v1;
  if (!block || typeof block !== 'object') {
    return { value: null, source: 'missing' };
  }

  return { value: block as UnderwritingReadinessV1Like, source: 'report.underwriting_readiness_v1' };
}
