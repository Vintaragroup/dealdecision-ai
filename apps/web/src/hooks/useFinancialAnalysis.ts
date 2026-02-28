/**
 * useFinancialAnalysis
 *
 * AI Analysis Tab–exclusive hook.  Reads deterministic financial sections from
 * an already-fetched InvestorInsightsReport, computes the Financial Strength
 * Score and highlights, then calls the lightweight
 * POST /api/v1/deals/:id/analysis/financial-analysis endpoint for the AI
 * Governed narrative panel.
 *
 * SCOPE: used by FinancialAnalysisSection.  Must NOT be imported by
 * InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiPostFinancialAnalysis,
  type FinancialNarrativeResult,
  type InvestorInsightsReport,
  type InvestorInsightsSection,
} from '../lib/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Section‑key constants
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT_KEY          = 'financial_layout_classifier_v1';
const STATEMENT_KEY       = 'financial_statement_v1';
const HEALTH_KEY          = 'financial_health_metrics_v1';
const RECONCILIATION_KEY  = 'financial_reconciliation_v1';
const IMPLIED_KEY         = 'implied_capital_allocation_v1';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types (opaque to the outside world)
// ─────────────────────────────────────────────────────────────────────────────

export type LayoutFlags = {
  has_income_statement: boolean;
  has_use_of_funds: boolean;
  has_budget_model: boolean;
  has_cap_table: boolean;
  has_cash_flow: boolean;
  has_balance_sheet: boolean;
  has_saas_kpis: boolean;
  layout_coverage_pct: number;
};

export type HealthMetrics = {
  revenue_latest: string | null;
  revenue_yoy_growth_pct: string | null;
  revenue_cagr_pct: string | null;
  gross_margin_pct: string | null;
  cost_efficiency_ratio: string | null;
};

export type StatementPeriod = {
  period: string;
  revenue: string | null;
  gross_profit: string | null;
  total_expenses: string | null;
};

export type FinancialStatement = {
  periods: string[];
  rows: StatementPeriod[];
  gross_margin: string | null;
  revenue_yoy_growth: string | null;
};

export type ImpliedBucket = {
  category: string;
  annual_cost: string | null;
  pct_of_total: string | null;
};

export type ImpliedAllocation = {
  buckets: ImpliedBucket[];
  total_annual_cost: string | null;
  period: string;
  basis_note: string;
};

export type ReconciliationFlag = {
  key: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  reason: string;
};

export type ReconciliationSummary = {
  confidence_score: number;
  flags: ReconciliationFlag[];
};

export type FinancialSections = {
  layoutFlags: LayoutFlags | null;
  healthMetrics: HealthMetrics | null;
  statement: FinancialStatement | null;
  impliedAllocation: ImpliedAllocation | null;
  reconciliation: ReconciliationSummary | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Section body parsers
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a flat key: value body into a map. */
function parseKV(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

function parseBool(v: string | undefined): boolean {
  return v?.toLowerCase() === 'true';
}

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

export function parseLayoutFlags(body: string): LayoutFlags {
  const kv = parseKV(body);
  return {
    has_income_statement: parseBool(kv['has_income_statement']),
    has_use_of_funds:     parseBool(kv['has_use_of_funds']),
    has_budget_model:     parseBool(kv['has_budget_model']),
    has_cap_table:        parseBool(kv['has_cap_table']),
    has_cash_flow:        parseBool(kv['has_cash_flow']),
    has_balance_sheet:    parseBool(kv['has_balance_sheet']),
    has_saas_kpis:        parseBool(kv['has_saas_kpis']),
    layout_coverage_pct:  parseNum(kv['layout_coverage_pct']) ?? 0,
  };
}

export function parseHealthMetrics(body: string): HealthMetrics {
  const kv = parseKV(body);
  return {
    revenue_latest:          kv['revenue_latest'] ?? null,
    revenue_yoy_growth_pct:  kv['revenue_yoy_growth_pct'] ?? null,
    revenue_cagr_pct:        kv['revenue_cagr_pct'] ?? null,
    gross_margin_pct:        kv['gross_margin_pct'] ?? null,
    cost_efficiency_ratio:   kv['cost_efficiency_ratio'] ?? null,
  };
}

export function parseFinancialStatement(body: string): FinancialStatement {
  const kv = parseKV(body);
  const periodsStr = kv['periods'] ?? '';
  const periods = periodsStr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  // Try to parse per-period series (format: "$X (Period), $Y (Period2)")
  function parseSeries(raw: string | undefined): Record<string, string> {
    const map: Record<string, string> = {};
    if (!raw) return map;
    // Format: "$500,000 (FY2024), $625,000 (FY2025)"
    const rx = /(\$[\d,]+(?:\.\d+)?(?:\s*[KMBkmb])?)\s*\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(raw)) !== null) {
      map[m[2]!.trim()] = m[1]!.trim();
    }
    return map;
  }

  const revSeries = parseSeries(kv['revenue']);
  const gpSeries  = parseSeries(kv['gross_profit']);
  const expSeries = parseSeries(kv['total_expenses']);

  const rows: StatementPeriod[] = periods.map((p) => ({
    period: p,
    revenue:        revSeries[p] ?? null,
    gross_profit:   gpSeries[p] ?? null,
    total_expenses: expSeries[p] ?? null,
  }));

  return {
    periods,
    rows,
    gross_margin:        kv['gross_margin'] ?? kv['gross_margin_pct'] ?? null,
    revenue_yoy_growth:  kv['revenue_yoy_growth'] ?? null,
  };
}

export function parseImpliedAllocation(body: string): ImpliedAllocation {
  const kv = parseKV(body);
  const buckets: ImpliedBucket[] = [];

  // Parse "  bucket: Category | $X/yr | Y% | [source]" lines
  const bucketRe = /^\s*bucket:\s*(.+)$/;
  for (const line of body.split('\n')) {
    const m = bucketRe.exec(line);
    if (!m) continue;
    const parts = m[1]!.split('|').map((p) => p.trim());
    const category = parts[0] ?? '';
    if (!category) continue;
    const costPart = parts.find((p) => p.includes('/yr') || p.startsWith('$'));
    const pctPart  = parts.find((p) => p.endsWith('%'));
    buckets.push({
      category,
      annual_cost:  costPart?.replace('/yr', '').trim() ?? null,
      pct_of_total: pctPart ?? null,
    });
  }

  return {
    buckets,
    total_annual_cost: kv['total_annual_cost'] ?? null,
    period:     kv['period'] ?? '',
    basis_note: kv['basis_note'] ?? 'Derived from budget model',
  };
}

export function parseReconciliation(body: string): ReconciliationSummary {
  const kv = parseKV(body);
  const confidence = parseNum(kv['confidence_score']) ?? 0;
  const flags: ReconciliationFlag[] = [];

  const flagRe = /^[✓⚠✗\-]\s+(\w[\w._-]*):\s+(PASS|WARN|FAIL|SKIP)\s+—\s+(.+)$/;
  for (const line of body.split('\n')) {
    const m = flagRe.exec(line.trim());
    if (!m) continue;
    flags.push({
      key:    m[1]!,
      status: m[2] as ReconciliationFlag['status'],
      reason: m[3]!.trim(),
    });
  }

  return { confidence_score: confidence, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section extractor
// ─────────────────────────────────────────────────────────────────────────────

function getSection(
  sections: InvestorInsightsSection[] | undefined,
  key: string,
): InvestorInsightsSection | null {
  return sections?.find((s) => s.key === key) ?? null;
}

function sectionBody(s: InvestorInsightsSection | null): string | null {
  if (!s) return null;
  const b = typeof s.body === 'string' ? s.body.trim() : '';
  return b.length > 0 ? b : (s.fallback ?? null);
}

export function extractFinancialSections(
  report: InvestorInsightsReport | null,
): FinancialSections {
  const sections = report?.render_package?.sections;

  const layoutBody    = sectionBody(getSection(sections, LAYOUT_KEY));
  const healthBody    = sectionBody(getSection(sections, HEALTH_KEY));
  const stmtBody      = sectionBody(getSection(sections, STATEMENT_KEY));
  const impliedBody   = sectionBody(getSection(sections, IMPLIED_KEY));
  const reconcBody    = sectionBody(getSection(sections, RECONCILIATION_KEY));

  return {
    layoutFlags:      layoutBody    ? parseLayoutFlags(layoutBody)         : null,
    healthMetrics:    healthBody    ? parseHealthMetrics(healthBody)       : null,
    statement:        stmtBody      ? parseFinancialStatement(stmtBody)   : null,
    impliedAllocation: impliedBody  ? parseImpliedAllocation(impliedBody) : null,
    reconciliation:   reconcBody    ? parseReconciliation(reconcBody)     : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Score computation
// ─────────────────────────────────────────────────────────────────────────────

export function computeFinancialScore(
  sections: FinancialSections,
): { score: number; label: string } {
  const { layoutFlags, healthMetrics, statement, impliedAllocation, reconciliation } = sections;

  let score = 50;
  if (statement !== null && statement.rows.length > 0) score += 15;
  if (healthMetrics !== null) score += 10;
  if (layoutFlags?.has_cash_flow || layoutFlags?.has_balance_sheet) score += 10;
  if (layoutFlags?.has_saas_kpis) score += 10;
  if (impliedAllocation !== null) score += 5;

  // Reconciliation confidence adjustment: +round(confidence * 20) − 10
  if (reconciliation !== null) {
    score += Math.round(reconciliation.confidence_score * 20) - 10;
  }

  score = Math.max(0, Math.min(100, score));

  const label =
    score >= 80 ? 'Strong financial visibility'
    : score >= 60 ? 'Moderate financial visibility'
    : 'Limited financial visibility';

  return { score, label };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic highlights (no LLM)
// ─────────────────────────────────────────────────────────────────────────────

export function buildHighlights(sections: FinancialSections): {
  strengths: string[];
  considerations: string[];
} {
  const { layoutFlags, healthMetrics, statement, impliedAllocation, reconciliation } = sections;
  const strengths: string[] = [];
  const considerations: string[] = [];

  // ── Strengths ─────────────────────────────────────────────────────────────
  if (statement !== null && statement.rows.length > 0) {
    const periods = statement.periods.join(' / ');
    strengths.push(`Revenue statement available${periods ? ` (${periods})` : ''}`);
  }
  if (healthMetrics?.gross_margin_pct) {
    strengths.push(`Gross margin disclosed: ${healthMetrics.gross_margin_pct}`);
  }
  if (healthMetrics?.revenue_yoy_growth_pct) {
    strengths.push(`Revenue growth rate available: ${healthMetrics.revenue_yoy_growth_pct}`);
  }
  if (impliedAllocation !== null) {
    const cost = impliedAllocation.total_annual_cost
      ? ` (${impliedAllocation.total_annual_cost}/yr implied)`
      : '';
    strengths.push(`Budget allocation model available${cost}`);
  }
  if (layoutFlags?.has_cap_table) {
    strengths.push('Cap table structure present in materials');
  }
  if (layoutFlags?.has_cash_flow) {
    strengths.push('Cash flow statement present');
  }
  if (layoutFlags?.has_balance_sheet) {
    strengths.push('Balance sheet present');
  }
  if (reconciliation !== null && reconciliation.confidence_score >= 0.7) {
    strengths.push(
      `High reconciliation confidence (${(reconciliation.confidence_score * 100).toFixed(0)}%)`,
    );
  }

  // ── Considerations ────────────────────────────────────────────────────────
  // WARN/FAIL flags from reconciliation
  if (reconciliation) {
    for (const flag of reconciliation.flags) {
      if (flag.status === 'WARN') {
        considerations.push(`Data quality note: ${flag.reason}`);
      } else if (flag.status === 'FAIL') {
        considerations.push(`Reconciliation issue: ${flag.reason}`);
      }
    }
  }

  // Missing critical sections
  if (!statement && !impliedAllocation) {
    considerations.push('No revenue statement or budget model found in materials');
  }
  if (!healthMetrics) {
    considerations.push('Financial health metrics not computable from available data');
  }
  if (!layoutFlags?.has_cash_flow && !layoutFlags?.has_balance_sheet) {
    considerations.push('No cash flow or balance sheet disclosed');
  }
  if (!layoutFlags?.has_cap_table) {
    considerations.push('No cap table present in materials');
  }
  if (!layoutFlags?.has_saas_kpis) {
    considerations.push('No SaaS KPIs (ARR/MRR, churn) extracted from materials');
  }

  // Cap arrays
  return {
    strengths:      strengths.slice(0, 6),
    considerations: considerations.slice(0, 6),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint
// ─────────────────────────────────────────────────────────────────────────────

function fingerprint(sections: FinancialSections): string {
  const keys = [
    sections.layoutFlags    ? JSON.stringify(sections.layoutFlags)    : '',
    sections.healthMetrics  ? JSON.stringify(sections.healthMetrics)  : '',
    sections.statement      ? sections.statement.periods.join(',')    : '',
    sections.impliedAllocation ? sections.impliedAllocation.total_annual_cost ?? '' : '',
    sections.reconciliation ? String(sections.reconciliation.confidence_score) : '',
  ];
  return keys.join('|');
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook types
// ─────────────────────────────────────────────────────────────────────────────

export type UseFinancialAnalysisStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'no_data';

export type UseFinancialAnalysisReturn = {
  /** Whether any financial sections were found in the report */
  hasData: boolean;
  /** All parsed deterministic sections (always populated when hasData = true) */
  sections: FinancialSections;
  /** Deterministic 0–100 score */
  score: number;
  scoreLabel: string;
  /** Deterministic highlights (no LLM) */
  strengths: string[];
  considerations: string[];
  /** AI Governed narrative (optional async) */
  narrativeStatus: UseFinancialAnalysisStatus;
  narrative: FinancialNarrativeResult | null;
  narrativeError: string | null;
  refreshNarrative: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useFinancialAnalysis(
  dealId: string | undefined,
  report: InvestorInsightsReport | null,
  dealName?: string,
): UseFinancialAnalysisReturn {
  const [narrativeStatus, setNarrativeStatus] =
    useState<UseFinancialAnalysisStatus>('idle');
  const [narrative, setNarrative] = useState<FinancialNarrativeResult | null>(null);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  const sections    = extractFinancialSections(report);
  const { score, label: scoreLabel } = computeFinancialScore(sections);
  const { strengths, considerations } = buildHighlights(sections);

  // True when at least one parseable financial section exists
  const hasData =
    sections.layoutFlags !== null ||
    sections.healthMetrics !== null ||
    sections.statement !== null ||
    sections.impliedAllocation !== null;

  // Fingerprint guards against stale closures and duplicate calls
  const currentFp  = fingerprint(sections);
  const mountedRef = useRef(true);
  const dealIdRef  = useRef(dealId);
  const dealNameRef= useRef(dealName);
  const fpRef      = useRef(currentFp);
  dealIdRef.current  = dealId;
  dealNameRef.current = dealName;
  fpRef.current      = currentFp;

  const runNarrative = useCallback(async () => {
    const id = dealIdRef.current;
    const fp = fpRef.current;
    if (!id) { setNarrativeStatus('idle'); return; }

    const snap = extractFinancialSections(report);
    if (
      snap.layoutFlags === null &&
      snap.healthMetrics === null &&
      snap.statement === null &&
      snap.impliedAllocation === null
    ) {
      setNarrativeStatus('no_data');
      return;
    }

    const hm  = snap.healthMetrics;
    const ica = snap.impliedAllocation;
    const rec = snap.reconciliation;

    // Collect WARN/FAIL flags
    const warnFail = (rec?.flags ?? [])
      .filter((f) => f.status === 'WARN' || f.status === 'FAIL')
      .map((f) => `${f.key}: ${f.reason}`);

    // Collect missing sections
    const missingSections: string[] = [];
    if (!snap.statement) missingSections.push('Revenue statement');
    if (!hm) missingSections.push('Health metrics');
    if (!snap.layoutFlags?.has_cash_flow && !snap.layoutFlags?.has_balance_sheet)
      missingSections.push('Cash flow / Balance sheet');
    if (!snap.layoutFlags?.has_cap_table) missingSections.push('Cap table');

    setNarrativeStatus('loading');
    try {
      const result = await apiPostFinancialAnalysis(id, {
        deal_name:                 dealNameRef.current,
        layout_coverage_pct:       snap.layoutFlags?.layout_coverage_pct,
        has_statement:             snap.statement !== null,
        has_implied_allocation:    snap.impliedAllocation !== null,
        has_health_metrics:        hm !== null,
        revenue_latest:            hm?.revenue_latest ?? undefined,
        gross_margin_pct:          hm?.gross_margin_pct ??
                                   snap.statement?.gross_margin ?? undefined,
        total_annual_cost:         ica?.total_annual_cost ?? undefined,
        reconciliation_confidence: rec?.confidence_score,
        warn_fail_flags:           warnFail.length ? warnFail : undefined,
        missing_sections:          missingSections.length ? missingSections : undefined,
      });

      if (!mountedRef.current || dealIdRef.current !== id || fpRef.current !== fp) return;
      setNarrative(result);
      setNarrativeStatus('ready');
      setNarrativeError(null);
    } catch (err) {
      if (!mountedRef.current || dealIdRef.current !== id) return;
      setNarrativeError(err instanceof Error ? err.message : String(err));
      setNarrativeStatus('error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dealId && hasData) runNarrative();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, currentFp]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return {
    hasData,
    sections,
    score,
    scoreLabel,
    strengths,
    considerations,
    narrativeStatus,
    narrative,
    narrativeError,
    refreshNarrative: runNarrative,
  };
}
