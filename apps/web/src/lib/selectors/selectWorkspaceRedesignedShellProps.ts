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

/**
 * Returns true for financial summary strings that are null-state placeholders produced by
 * the deterministic sub-models when input data is absent. These must not be rendered as
 * insight prose to the investor.
 */
function isNullStateSummary(s: string): boolean {
  return /no financial data|not available|unavailable|no data|cannot be determined/i.test(s);
}

/**
 * Known internal dimension / field-name tokens that can surface from machine-generated
 * diligence item sources (score_explanation.understanding_v1.diligence_open_items and
 * score_explanation.totals.unadjusted_missing_inputs). These are system labels, not
 * investor-readable questions.
 */
const INTERNAL_DILIGENCE_TOKENS: ReadonlySet<string> = new Set([
  'key_risks_detected', 'business_model', 'product_or_asset_quality', 'external_corroboration',
  'financial_truth', 'capital_structure', 'traction_validation', 'market_demand', 'team_execution',
  'risk_dependencies', 'evidence_quality', 'coverage', 'traction', 'revenue', 'team', 'market',
  'product', 'raise', 'exit', 'financials', 'contradictions',
]);

/**
 * Returns true for a diligence item that is an internal system token rather than a
 * real investor-facing question. Filters:
 *   - Bare snake_case identifiers (e.g. "key_risks_detected")
 *   - Known internal dimension labels (case-insensitive exact match)
 *   - Fewer than 4 whitespace-separated words (too shallow to be a meaningful question)
 */
function isMechanicalDiligenceItem(s: string): boolean {
  const t = s.trim();
  // Bare snake_case: all lowercase letters, digits, underscores — at least one underscore
  if (/^[a-z][a-z0-9_]+$/.test(t) && t.includes('_')) return true;
  // Known internal token (case-insensitive, whole-string match)
  if (INTERNAL_DILIGENCE_TOKENS.has(t.toLowerCase())) return true;
  // Too short — fewer than 4 words is a field label, not a diligence question
  if (t.split(/\s+/).length < 4) return true;
  return false;
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

  // ── TRACE: what overviewVM delivers at selector boundary ────────────────────
  if (import.meta.env.DEV) {
    console.group('[TRACE:selectWorkspaceRedesignedShellProps] overviewVM keyFacts at selector entry');
    console.log('overviewVM.keyFacts.product.value: ', overviewVM.keyFacts.product?.value);
    console.log('overviewVM.keyFacts.market.value:  ', overviewVM.keyFacts.market?.value);
    console.log('overviewVM.keyFacts.raise_terms.value:', overviewVM.keyFacts.raise_terms?.value);
    console.log('overviewVM.investmentSnapshotBody: ', overviewVM.investmentSnapshotBody);
    console.groupEnd();
  }

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

  // Conviction narrative fields (headline, rationale, provisional flag)
  const convictionSummaryRaw: any = convictionV1?.summary ?? null;
  const convictionHeadline = asNES(convictionSummaryRaw?.headline);
  const convictionRationale = asNES(convictionSummaryRaw?.rationale);
  const convictionProvisional = convictionSummaryRaw?.provisional === true;

  // Top positive contributors (conviction-backed strength signals)
  // key is the internal snake_case dimension used for presentation-layer mapping
  const topPositiveContributors: { key: string; label: string; scoreDelta: number | null }[] = (() => {
    const items = convictionV1?.top_positive_contributors;
    if (!Array.isArray(items)) return [];
    return items
      .map((c: any) => ({
        key: asNES(c?.key) ?? '',
        label: asNES(c?.label) ?? '',
        scoreDelta: asFinite(c?.score_delta_0_100),
      }))
      .filter((c) => c.label.length > 0)
      .slice(0, 5);
  })();

  // Top negative contributors (conviction-backed risk signals)
  const topNegativeContributors: { key: string; label: string; scoreDelta: number | null }[] = (() => {
    const items = convictionV1?.top_negative_contributors;
    if (!Array.isArray(items)) return [];
    return items
      .map((c: any) => ({
        key: asNES(c?.key) ?? '',
        label: asNES(c?.label) ?? '',
        scoreDelta: asFinite(c?.score_delta_0_100),
      }))
      .filter((c) => c.label.length > 0)
      .slice(0, 5);
  })();

  // Required next checks (diligence checklist from conviction)
  const requiredNextChecks: string[] = (() => {
    const items = convictionV1?.required_next_checks;
    if (!Array.isArray(items)) return [];
    return items
      .map((c: any) => asNES(typeof c === 'string' ? c : c?.text))
      .filter((s): s is string => s !== null)
      .slice(0, 5);
  })();

  // Investment snapshot: combine all three iav2 summary fields for a fuller narrative.
  // summary         = deal_summary_v2.summary.one_liner (crisper context-setter)
  // summary_medium  = paragraphs[0] (main descriptive paragraph)
  // summary_long    = paragraphs[1]+[2] joined (additional depth when present)
  // Deduplicate: skip any part that is wholly contained within a longer part already collected.
  const iav2: any = rpt.investment_analysis_overview_v2 ?? null;
  const investmentSnapshotBody = (() => {
    const overlayBody = asNES(overviewVM.investmentSnapshotBody);
    if (overlayBody) return overlayBody;
    const parts: string[] = [
      asNES(iav2?.summary),
      asNES(iav2?.summary_medium),
      asNES(iav2?.summary_long),
    ].filter((s): s is string => s !== null);
    const deduped = parts.reduce<string[]>((acc, s) => {
      if (!acc.some((prev) => prev.includes(s))) acc.push(s);
      return acc;
    }, []);
    const combined = deduped.join('\n\n');
    return combined.length > 0 ? combined : null;
  })();

  // ── Financial Column ──────────────────────────────────────────────────────
  const fb: any = rpt.financial_breakdown_v1 ?? null;
  // Financial narrative: investor-readable overview from financial_breakdown_v1 (deterministic)
  const financialNarrative = asNES(fb?.narrative) ?? null;
  const cs: any = fb?.current_state ?? null;
  const br: any = fb?.burn_runway ?? null;
  const ur: any = rpt.underwriting_readiness_v1 ?? null;
  const fc: any = rpt.financial_coverage_v1 ?? null;
  // More specific financial summaries — plain-English prose from deterministic sub-models.
  // Null-state strings ("not available", "no financial data", etc.) are suppressed so they
  // do not render as insight prose when underlying data is absent.
  const financialCurrentStateSummary = (() => {
    const s = asNES(cs?.summary);
    return s && !isNullStateSummary(s) ? s : null;
  })();
  const financialBurnRunwaySummary = (() => {
    const s = asNES(br?.summary);
    return s && !isNullStateSummary(s) ? s : null;
  })();
  const underwritingNarrative = asNES(ur?.narrative) ?? null;

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

  // Open questions: prefer investment_analysis_overview_v2.open_items.items[] (most compiled),
  // fall back to decision_summary_v1.open_questions, then diligence_open_items.
  // Mechanical items (bare snake_case tokens, known internal labels, fewer than 4 words)
  // are filtered out before the slice so they don't surface as investor-facing questions.
  const diligenceItems: string[] = (() => {
    const iav2Items = iav2?.open_items?.items;
    const raw = (Array.isArray(iav2Items) && iav2Items.length > 0)
      ? iav2Items
      : ss?.decision_summary_v1?.open_questions
        ?? meta?.score_explanation?.understanding_v1?.diligence_open_items
        ?? [];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((i: any) => asNES(typeof i === 'string' ? i : i?.text))
      .filter((s): s is string => s !== null && !isMechanicalDiligenceItem(s))
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

  // ── TRACE: final resolved props at selector exit ─────────────────────────────
  if (import.meta.env.DEV) {
    console.group('[TRACE:selectWorkspaceRedesignedShellProps] final resolved props (selector exit)');
    console.log('product (overviewVM.keyFacts.product):', product?.value ?? product);
    console.log('market  (overviewVM.keyFacts.market): ', market?.value ?? market);
    console.log('raiseTerms:', raiseTerms?.value ?? raiseTerms);
    console.log('investmentSnapshotBody:', investmentSnapshotBody);
    console.groupEnd();
  }

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
    convictionHeadline,
    convictionRationale,
    convictionProvisional,
    topPositiveContributors,
    topNegativeContributors,
    requiredNextChecks,
    financialNarrative,
    financialCurrentStateSummary,
    financialBurnRunwaySummary,
    underwritingNarrative,

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
