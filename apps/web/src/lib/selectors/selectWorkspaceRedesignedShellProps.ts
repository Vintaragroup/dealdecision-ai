/**
 * selectWorkspaceRedesignedShellProps
 *
 * Assembles WorkspaceRedesignedShellProps from the compiled /report payload +
 * existing workspace view model inputs.
 *
 * Selector contract (deterministic-first):
 *   company_name     → report.structured_summary.company_name
 *   deal_type        → report.metadata.score_explanation.context.deal_type
 *   stage            → report.funding_stage_v1.funding_stage
 *   raise            → report.structured_summary.raise.value (with null_rule)
 *   product/market   → WorkspaceOverviewVM keyFacts (already arbitrated upstream)
 *   team_highlights  → report.structured_summary.team_highlights[]
 *   use_of_funds     → report.structured_summary.use_of_funds_breakdown[]
 *   project_pipeline → report.structured_summary.project_pipeline[]
 *   revenue_model    → report.structured_summary.revenue_model
 *   financial tiles  → report.financial_breakdown_v1 (via existing selectors)
 *   redFlags         → report.redFlags[]
 *   conviction       → report.structured_summary.conviction_v1
 */

import type { WorkspaceOverviewVM } from '../components/workspace/contracts/workspaceViewModel';
import type { WorkspaceRedesignedShellProps, FinancialTile, RedFlag } from '../components/workspace/WorkspaceRedesignedShell';

function asNES(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function asFinite(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function formatMetricValue(metric: unknown): string {
  if (!metric || typeof metric !== 'object') return '—';
  const m = metric as any;
  if (m.value == null) return '—';
  const num = asFinite(m.value);
  if (num == null) return '—';
  const currency = asNES(m.currency) ?? '';
  const unit = asNES(m.unit) ?? '';
  const period = asNES(m.period_label);

  let formatted = '';
  if (Math.abs(num) >= 1_000_000_000) {
    formatted = `${currency}${(num / 1_000_000_000).toFixed(1)}B`;
  } else if (Math.abs(num) >= 1_000_000) {
    formatted = `${currency}${(num / 1_000_000).toFixed(1)}M`;
  } else if (Math.abs(num) >= 1_000) {
    formatted = `${currency}${(num / 1_000).toFixed(0)}K`;
  } else {
    formatted = `${currency}${num}`;
  }

  if (unit && unit !== '$' && unit !== 'USD') {
    formatted += ` ${unit}`;
  }
  if (period) formatted += ` (${period})`;
  return formatted;
}

export type SelectWorkspaceRedesignedShellInput = {
  /** Raw compiled /report payload */
  report: unknown;
  /** Pre-built overview VM (already contains arbitrated keyFacts + rcS6) */
  overviewVM: WorkspaceOverviewVM;
  /** ISO string from deal info */
  lastAnalyzedAt: string | null;
  /** Live blocker count from workspace state */
  blockerCount: number;
  /** Whether the deep dive endpoint has data */
  deepDiveReady: boolean;
  /** Whether investor insights have been run */
  insightsReady: boolean;
};

export function selectWorkspaceRedesignedShellProps(
  input: SelectWorkspaceRedesignedShellInput
): Omit<WorkspaceRedesignedShellProps, 'darkMode' | 'onRunAnalysis' | 'onOpenDeepDive' | 'onOpenInsights' | 'onOpenEvidenceExplorer'> {
  const { report, overviewVM, lastAnalyzedAt, blockerCount, deepDiveReady, insightsReady } = input;
  const rpt = (report && typeof report === 'object') ? report as any : {};
  const ss = (rpt.structured_summary && typeof rpt.structured_summary === 'object') ? rpt.structured_summary as any : {};
  const meta = (rpt.metadata && typeof rpt.metadata === 'object') ? rpt.metadata as any : {};

  // ── Identity Strip ────────────────────────────────────────────────────────
  const companyName = asNES(ss.company_name);

  const dealType = asNES(meta?.score_explanation?.context?.deal_type)
    ?? asNES(rpt.metadata?.deal_type)
    ?? null;

  const stage = asNES(rpt.funding_stage_v1?.funding_stage) ?? null;

  const rawRaise = ss.raise;
  const raise = (rawRaise && typeof rawRaise === 'object')
    ? asNES(rawRaise.value)
    : asNES(rawRaise);
  const raiseNullRule = (rawRaise && typeof rawRaise === 'object')
    ? asNES(rawRaise.null_rule)
    : null;

  // ── Conviction Column — delegate to overviewVM keyFacts + rcS6 ───────────
  const { product, market, businessModel: bm, raise: raiseTerms } = overviewVM.keyFacts;

  // Conviction scalar from report
  const convictionV1: any = ss.conviction_v1 ?? rpt.conviction_v1 ?? null;
  const convictionScore = asFinite(convictionV1?.conviction_score_0_100);
  const convictionBand = asNES(convictionV1?.conviction_band);
  const convictionPosture = asNES(convictionV1?.recommendation_posture);

  // Investment snapshot: prefer investment_analysis_overview_v2.summary_medium
  const iav2: any = ss.investment_analysis_overview_v2 ?? null;
  const investmentSnapshotBody = asNES(iav2?.summary_medium?.paragraphs?.[0])
    ?? asNES(iav2?.summary_medium)
    ?? overviewVM.investmentSnapshotBody
    ?? null;

  // ── Financial Column ──────────────────────────────────────────────────────
  const fb: any = rpt.financial_breakdown_v1 ?? null;
  const cs: any = fb?.current_state ?? null;
  const br: any = fb?.burn_runway ?? null;
  const ur: any = rpt.underwriting_readiness_v1 ?? null;
  const fc: any = rpt.financial_coverage_v1 ?? null;

  const financialTiles: FinancialTile[] = [];

  const pushTile = (label: string, metricOrValue: unknown, trustWhenPresent: FinancialTile['trust'] = 'structured') => {
    const v = formatMetricValue(metricOrValue);
    financialTiles.push({
      label,
      value: v,
      trust: v !== '—' ? trustWhenPresent : 'not_extracted',
      nullReason: v === '—' ? 'Not extracted' : null,
    });
  };

  pushTile('Revenue / ARR', cs?.revenue);
  pushTile('Monthly Burn', br?.monthly_burn ?? cs?.burn_rate);
  pushTile('Runway', br?.runway_months ?? cs?.runway_months);
  pushTile('Cash', br?.cash ?? cs?.cash);
  pushTile('Gross Margin', cs?.gross_margin_pct);

  // Coverage: prefer coverage_ratio from financial_coverage_v1
  const financialCoverage = asFinite(fc?.coverage_ratio != null ? fc.coverage_ratio * 100 : null)
    ?? asFinite(meta?.score_explanation?.totals?.overall_score); // fallback

  // Underwriting readiness: score_0_100 field
  const underwritingReadiness = asFinite(ur?.score_0_100);

  // Integrity
  const integrity = rpt.financial_integrity_v1 ?? null;
  const financialIntegrityStatus: WorkspaceRedesignedShellProps['financialIntegrityStatus'] = (() => {
    const s = asNES((integrity as any)?.status);
    if (!s) return null;
    if (s === 'validated' || s === 'clean') return 'validated';
    if (s === 'partial') return 'partial';
    if (s === 'unvalidated' || s === 'flagged') return 'unvalidated';
    return null;
  })();

  // ── Risk Strip ────────────────────────────────────────────────────────────
  const redFlagsRaw: any[] = Array.isArray(rpt.redFlags) ? rpt.redFlags : [];
  const redFlags: RedFlag[] = redFlagsRaw.map((rf: any) => ({
    severity: (['high', 'medium', 'low'].includes(rf?.severity) ? rf.severity : 'low') as RedFlag['severity'],
    message: asNES(rf?.message) ?? 'Unknown risk',
    action: asNES(rf?.action) ?? undefined,
  }));

  // Open questions from deep_dive or score_explanation diligence items
  const diligenceItems: string[] = (() => {
    const items = ss?.decision_summary_v1?.open_questions
      ?? meta?.score_explanation?.understanding_v1?.diligence_open_items
      ?? [];
    if (!Array.isArray(items)) return [];
    return items
      .map((i: any) => asNES(typeof i === 'string' ? i : i?.text))
      .filter((s): s is string => s !== null)
      .slice(0, 5);
  })();

  // Contradictions from conviction or investor_insights
  const contradictionsRaw: string[] = (() => {
    const items = convictionV1?.contradictions ?? [];
    if (!Array.isArray(items)) return [];
    return items
      .map((c: any) => asNES(typeof c === 'string' ? c : c?.description ?? c?.text))
      .filter((s): s is string => s !== null)
      .slice(0, 5);
  })();

  return {
    // identity
    companyName,
    dealType,
    stage,
    raise,
    raiseNullRule,
    lastAnalyzedAt,

    // conviction
    investmentSnapshotBody,
    product,
    market,
    businessModel: bm,
    raiseTerms,
    teamHighlights: overviewVM.rcS6.teamHighlights,
    useOfFunds: overviewVM.rcS6.useOfFunds,
    projectPipeline: overviewVM.rcS6.projectPipeline,
    revenueModel: overviewVM.rcS6.revenueModel,
    convictionScore,
    convictionBand,
    convictionPosture,

    // financial
    financialTiles,
    financialCoverage,
    underwritingReadiness,
    financialIntegrityStatus,

    // risk
    redFlags,
    blockerCount,
    openQuestions: diligenceItems,
    contradictions: contradictionsRaw,

    // workbench
    deepDiveReady,
    insightsReady,
  };
}
