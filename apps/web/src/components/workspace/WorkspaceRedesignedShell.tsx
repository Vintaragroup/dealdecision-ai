/**
 * WorkspaceRedesignedShell — Phase B workspace layout (simplified flow)
 *
 * Top-to-bottom reading order:
 *   1. Identity Strip      — company name, deal type, stage, raise, last analyzed
 *   2. Snapshot Row        — conviction score + investment snapshot prose (side by side)
 *   3. Key Facts Grid      — product / market / biz model / raise terms (2×2)
 *   4. Financial Strip     — vital signs inline, coverage + readiness gauges, integrity badge
 *   5. Risk Rail           — red flags + open questions + contradictions
 *   6. Detail Rows         — team / use-of-funds / pipeline / revenue model (collapsed when empty)
 *   7. Workbench Row       — deep dive / insights / evidence (single horizontal row)
 *
 * Selector contract (deterministic-first, no silent Phase1 fallback):
 *   - company_name        → report.structured_summary.company_name
 *   - deal_type           → report.metadata.score_explanation.context.deal_type
 *   - stage               → report.funding_stage_v1.funding_stage
 *   - raise               → report.structured_summary.raise.value
 *   - product_summary_v1  → report.structured_summary.product_summary_v1.value
 *   - market_summary_v1   → report.structured_summary.market_summary_v1.value
 *   - team_highlights     → report.structured_summary.team_highlights[]
 *   - use_of_funds        → report.structured_summary.use_of_funds_breakdown[]
 *   - project_pipeline    → report.structured_summary.project_pipeline[]
 *   - revenue_model       → report.structured_summary.revenue_model
 *   - investment snapshot → report.structured_summary.investment_analysis_overview_v2.summary_medium
 *   - financial tiles     → selectAuthoritativeFinancialBreakdownV1(report)
 *   - redFlags            → report.redFlags[]
 *   - conviction          → report.structured_summary.conviction_v1
 */

import {
  Building2,
  Calendar,
  ChevronRight,
  CircleDot,
  DollarSign,
  FileSearch,
  FlaskConical,
  Layers,
  ShieldAlert,
  Tag,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { WorkspaceOverviewVM, WorkspaceOverviewFactTrust } from './contracts/workspaceViewModel';

// ─── Shared helpers ──────────────────────────────────────────────────────────

function asNES(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

const TRUST_LABELS: Record<WorkspaceOverviewFactTrust, string> = {
  structured: 'Structured',
  governed: 'Governed',
  interim_extraction: 'Interim',
  not_extracted: 'Not extracted',
  conflicted: 'Conflicted',
};

const trustBadgeClass = (trust: WorkspaceOverviewFactTrust): string => {
  switch (trust) {
    case 'governed': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'interim_extraction': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'conflicted': return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    case 'not_extracted': return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    case 'structured':
    default:
      return '';
  }
};

/**
 * Only renders badge for non-structured trust levels — structured is the default and
 * does not need to be declared. This keeps trust badges quiet and supportive.
 */
const TrustBadge = ({ trust }: { trust: WorkspaceOverviewFactTrust }) => {
  if (trust === 'structured') return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${trustBadgeClass(trust)}`}>
      {TRUST_LABELS[trust]}
    </span>
  );
};

// ─── Prop types ──────────────────────────────────────────────────────────────

export type RedFlag = { severity: 'high' | 'medium' | 'low'; message: string; action?: string };

export type FinancialTile = { label: string; value: string; trust: WorkspaceOverviewFactTrust; nullReason?: string | null };

export type WorkspaceRedesignedShellProps = {
  darkMode: boolean;

  // ── Identity ───────────────────────────────────────────────────────────────
  companyName: string | null;
  dealType: string | null;
  stage: string | null;
  raise: string | null;
  raiseNullRule: string | null;
  lastAnalyzedAt: string | null;
  onRunAnalysis?: () => void;

  // ── Snapshot + conviction ──────────────────────────────────────────────────
  investmentSnapshotBody: string | null;
  convictionScore: number | null;
  convictionBand: string | null;
  convictionPosture: string | null;

  // ── Key facts ─────────────────────────────────────────────────────────────
  product: WorkspaceOverviewVM['keyFacts']['product'];
  market: WorkspaceOverviewVM['keyFacts']['market'];
  businessModel: WorkspaceOverviewVM['keyFacts']['businessModel'];
  raiseTerms: WorkspaceOverviewVM['keyFacts']['raise'];

  // ── Financial ─────────────────────────────────────────────────────────────
  financialTiles: FinancialTile[];
  financialCoverage: number | null;
  underwritingReadiness: number | null;
  financialIntegrityStatus: 'validated' | 'unvalidated' | 'partial' | null;

  // ── Risks ─────────────────────────────────────────────────────────────────
  redFlags: RedFlag[];
  blockerCount: number;
  openQuestions: string[];
  contradictions: string[];

  // ── Detail rows (shown only when data present) ─────────────────────────────
  teamHighlights: WorkspaceOverviewVM['rcS6']['teamHighlights'];
  useOfFunds: WorkspaceOverviewVM['rcS6']['useOfFunds'];
  projectPipeline: WorkspaceOverviewVM['rcS6']['projectPipeline'];
  revenueModel: WorkspaceOverviewVM['rcS6']['revenueModel'];

  // ── Workbench ─────────────────────────────────────────────────────────────
  deepDiveReady: boolean;
  insightsReady: boolean;
  onOpenDeepDive?: () => void;
  onOpenInsights?: () => void;
  onOpenEvidenceExplorer?: () => void;
};

// ─── §1 Identity Strip ────────────────────────────────────────────────────────

function IdentityStrip({
  darkMode,
  companyName,
  dealType,
  stage,
  raise,
  raiseNullRule,
  lastAnalyzedAt,
  onRunAnalysis,
}: Pick<WorkspaceRedesignedShellProps,
  'darkMode' | 'companyName' | 'dealType' | 'stage' | 'raise' | 'raiseNullRule' | 'lastAnalyzedAt' | 'onRunAnalysis'
>) {
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const bg = darkMode ? 'bg-white/5' : 'bg-white';
  const title = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const chipCls = darkMode
    ? 'bg-white/5 border-white/10 text-gray-300'
    : 'bg-gray-50 border-gray-200 text-gray-600';

  const raiseDisplay = asNES(raise) ?? (raiseNullRule ? 'Not disclosed' : '—');

  const analysisTimestamp = (() => {
    if (!lastAnalyzedAt) return null;
    try {
      return new Date(lastAnalyzedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
    } catch {
      return lastAnalyzedAt;
    }
  })();

  return (
    <div data-testid="identity-strip" className={`rounded-xl border p-5 ${bg} ${border}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">

        {/* Company name */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Building2 className={`w-4 h-4 shrink-0 ${muted}`} strokeWidth={1.5} />
          <h2 className={`text-xl font-semibold truncate ${title}`}>
            {asNES(companyName) ?? <span className={muted}>Company name not extracted</span>}
          </h2>
          <TrustBadge trust={asNES(companyName) ? 'structured' : 'not_extracted'} />
        </div>

        {/* Metadata chips */}
        <div className="flex flex-wrap items-center gap-2">
          {dealType && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${chipCls}`}>
              <Tag className="w-3 h-3" strokeWidth={1.5} />
              {dealType}
            </span>
          )}
          {stage && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${chipCls}`}>
              <Layers className="w-3 h-3" strokeWidth={1.5} />
              {stage}
            </span>
          )}
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${chipCls}`}>
            <DollarSign className="w-3 h-3" strokeWidth={1.5} />
            {raiseDisplay}
            {!asNES(raise) && <TrustBadge trust="not_extracted" />}
          </span>
        </div>

        {/* Last analyzed / Run CTA */}
        <div className="shrink-0">
          {analysisTimestamp ? (
            <span className={`flex items-center gap-1.5 text-xs ${muted}`}>
              <Calendar className="w-3.5 h-3.5" strokeWidth={1.5} />
              Analyzed {analysisTimestamp}
            </span>
          ) : (
            <button
              type="button"
              onClick={onRunAnalysis}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                darkMode
                  ? 'bg-blue-500/20 border-blue-500/30 text-blue-300 hover:bg-blue-500/30'
                  : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
              }`}
            >
              Run Analysis
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── §2 Snapshot Row ──────────────────────────────────────────────────────────

function SnapshotRow({
  darkMode,
  investmentSnapshotBody,
  convictionScore,
  convictionBand,
  convictionPosture,
  onOpenInsights,
}: Pick<WorkspaceRedesignedShellProps,
  | 'darkMode'
  | 'investmentSnapshotBody'
  | 'convictionScore'
  | 'convictionBand'
  | 'convictionPosture'
> & { onOpenInsights?: () => void }) {
  const surface = darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-200' : 'text-gray-700';

  const scoreColor = (() => {
    if (convictionScore == null) return muted;
    if (convictionScore >= 70) return 'text-emerald-400';
    if (convictionScore >= 45) return 'text-amber-400';
    return 'text-rose-400';
  })();

  return (
    <div data-testid="snapshot-row" className={`rounded-xl border p-5 ${surface}`}>
      <div className="flex gap-6 flex-wrap">

        {/* Conviction score block */}
        <div className="shrink-0 flex flex-col justify-center min-w-[80px]">
          <div className={`text-4xl font-bold ${scoreColor}`}>
            {convictionScore != null ? Math.round(convictionScore) : '—'}
          </div>
          <div className={`text-[10px] uppercase tracking-wide mt-0.5 ${muted}`}>
            {convictionBand ?? 'Conviction'}
          </div>
        </div>

        {/* Divider */}
        <div className={`w-px self-stretch ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`} />

        {/* Snapshot prose */}
        <div className="flex-1 min-w-0">
          <div className={`text-xs uppercase tracking-wide font-medium mb-2 ${muted}`}>Investment Snapshot</div>
          {asNES(investmentSnapshotBody) ? (
            <p className={`text-sm leading-relaxed ${body}`}>{investmentSnapshotBody}</p>
          ) : (
            <p className={`text-sm ${muted}`}>
              Investment snapshot not yet generated.
              {onOpenInsights && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={onOpenInsights}
                    className={`underline underline-offset-2 transition-colors ${
                      darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
                    }`}
                  >
                    Run Investor Insights
                  </button>
                  {' '}to populate.
                </>
              )}
            </p>
          )}
          {asNES(convictionPosture) && (
            <p className={`text-xs mt-2 ${muted}`}>
              <span className={`font-medium ${body}`}>Posture: </span>{convictionPosture}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── §3 Key Facts Grid ────────────────────────────────────────────────────────

function KeyFactsGrid({
  darkMode,
  product,
  market,
  businessModel,
  raiseTerms,
}: Pick<WorkspaceRedesignedShellProps, 'darkMode' | 'product' | 'market' | 'businessModel' | 'raiseTerms'>) {
  const card = darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-200' : 'text-gray-700';

  const facts: Array<{
    label: string;
    field: WorkspaceOverviewVM['keyFacts']['product'];
    emptyLabel: string;
  }> = [
    { label: 'Product / Solution', field: product, emptyLabel: 'Not extracted' },
    { label: 'Market / ICP', field: market, emptyLabel: 'Not extracted' },
    { label: 'Business Model', field: businessModel, emptyLabel: 'Not extracted' },
    { label: 'Raise Terms', field: raiseTerms, emptyLabel: 'Not extracted' },
  ];

  return (
    <div data-testid="key-facts-grid" className="grid sm:grid-cols-2 gap-4">
      {facts.map(({ label, field, emptyLabel }) => (
        <div key={label} className={`rounded-xl border p-4 ${card}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium ${muted}`}>{label}</span>
            <TrustBadge trust={field.trust} />
          </div>
          {asNES(field.value) ? (
            <>
              <p className={`text-sm leading-snug ${body}`}>{field.value}</p>
              {field.conflict && (
                <p className="text-xs text-amber-400 mt-1.5">
                  Overlay disagrees: {field.conflict.value}
                </p>
              )}
            </>
          ) : (
            <p className={`text-sm ${muted}`}>{emptyLabel}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── §4 Financial Strip ───────────────────────────────────────────────────────

function FinancialStrip({
  darkMode,
  financialTiles,
  financialCoverage,
  underwritingReadiness,
  financialIntegrityStatus,
}: Pick<WorkspaceRedesignedShellProps,
  'darkMode' | 'financialTiles' | 'financialCoverage' | 'underwritingReadiness' | 'financialIntegrityStatus'
>) {
  const surface = darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200';
  const chipCard = darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';
  const title = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';

  const coveragePct = financialCoverage != null ? Math.round(financialCoverage) : null;
  const readinessPct = underwritingReadiness != null ? Math.round(underwritingReadiness) : null;

  const gaugeColor = (pct: number | null) => {
    if (pct == null) return muted;
    if (pct >= 70) return 'text-emerald-400';
    if (pct >= 40) return 'text-amber-400';
    return 'text-rose-400';
  };

  const integrityLabel = (() => {
    switch (financialIntegrityStatus) {
      case 'validated': return { label: 'Validated', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/15' };
      case 'partial':   return { label: 'Partial',    cls: 'text-amber-400 border-amber-500/30 bg-amber-500/15' };
      case 'unvalidated': return { label: 'Unvalidated', cls: 'text-rose-400 border-rose-500/30 bg-rose-500/15' };
      default: return { label: 'Not evaluated', cls: 'text-gray-400 border-gray-500/20 bg-gray-500/10' };
    }
  })();

  return (
    <div data-testid="financial-strip" className={`rounded-xl border p-5 ${surface}`}>
      <div className={`text-xs uppercase tracking-wide font-medium mb-4 ${muted}`}>Capital &amp; Financials</div>

      {/* Vital signs in a horizontal row */}
      {financialTiles.length > 0 ? (
        <div className="flex flex-wrap gap-3 mb-4">
          {financialTiles.map((tile) => (
            <div key={tile.label} className={`rounded-lg border px-3 py-2 min-w-[100px] ${chipCard}`}>
              <div className={`text-[11px] ${muted} mb-0.5`}>{tile.label}</div>
              <div className={`text-sm font-semibold ${tile.value !== '—' ? title : muted}`}>{tile.value}</div>
              <TrustBadge trust={tile.trust} />
              {tile.nullReason && tile.value === '—' && (
                <div className={`text-[10px] mt-0.5 ${muted}`}>{tile.nullReason}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className={`text-sm mb-4 ${muted}`}>Financial data not extracted.</p>
      )}

      {/* Coverage + Readiness + Integrity inline */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <TrendingUp className={`w-3.5 h-3.5 ${muted}`} strokeWidth={1.5} />
          <span className={`text-xs ${muted}`}>Coverage</span>
          <span className={`text-sm font-semibold ${gaugeColor(coveragePct)}`}>
            {coveragePct != null ? `${coveragePct}/100` : '—'}
          </span>
        </div>
        <div className={`w-px h-4 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className="flex items-center gap-1.5">
          <FlaskConical className={`w-3.5 h-3.5 ${muted}`} strokeWidth={1.5} />
          <span className={`text-xs ${muted}`}>UW Readiness</span>
          <span className={`text-sm font-semibold ${gaugeColor(readinessPct)}`}>
            {readinessPct != null ? `${readinessPct}/100` : '—'}
          </span>
        </div>
        <div className={`w-px h-4 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${integrityLabel.cls}`}>
          {integrityLabel.label}
        </span>
      </div>
    </div>
  );
}

// ─── §5 Risk Rail ─────────────────────────────────────────────────────────────

const RED_FLAG_SEVERITY_CLASS: Record<RedFlag['severity'], string> = {
  high:   'border-l-2 border-rose-500 pl-3 text-rose-300',
  medium: 'border-l-2 border-amber-500 pl-3 text-amber-300',
  low:    'border-l-2 border-gray-500 pl-3 text-gray-400',
};

function RiskRail({
  darkMode,
  redFlags,
  blockerCount,
  openQuestions,
  contradictions,
}: Pick<WorkspaceRedesignedShellProps, 'darkMode' | 'redFlags' | 'blockerCount' | 'openQuestions' | 'contradictions'>) {
  const surface = darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-200' : 'text-gray-700';

  const hasFlags = redFlags.length > 0;
  const hasQuestions = openQuestions.length > 0;
  const hasContradictions = contradictions.length > 0;
  const hasAnything = hasFlags || blockerCount > 0 || hasQuestions || hasContradictions;

  if (!hasAnything) {
    return (
      <div data-testid="risk-rail" className={`rounded-xl border p-4 ${surface}`}>
        <div className="flex items-center gap-2">
          <ShieldAlert className={`w-4 h-4 ${muted}`} strokeWidth={1.5} />
          <span className={`text-sm ${muted}`}>No red flags, blockers, or open questions identified.</span>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="risk-rail" className={`rounded-xl border p-5 ${surface} space-y-4`}>

      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-rose-400" strokeWidth={1.5} />
        <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Risks &amp; Blockers
        </h3>
        {blockerCount > 0 && (
          <span className="ml-auto text-xs font-medium text-rose-400">
            {blockerCount} blocker{blockerCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Red flags as a flat list with severity colors */}
      {hasFlags && (
        <ul className="space-y-2">
          {redFlags.map((rf, i) => (
            <li key={i} className={`text-sm py-1 ${RED_FLAG_SEVERITY_CLASS[rf.severity]}`}>
              <span>{rf.message}</span>
              {rf.action && (
                <span className={`block text-xs mt-0.5 ${muted}`}>{rf.action}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Open questions */}
      {hasQuestions && (
        <div>
          <div className={`flex items-center gap-1.5 text-xs font-medium mb-2 ${muted}`}>
            <CircleDot className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.5} />
            Open Questions
          </div>
          <ul className="space-y-1">
            {openQuestions.map((q, i) => (
              <li key={i} className={`text-sm ${body} flex gap-2`}>
                <span className="text-amber-400 shrink-0 text-xs mt-0.5">•</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Contradictions */}
      {hasContradictions && (
        <div>
          <div className={`text-xs font-medium mb-2 ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
            Narrative Contradictions
          </div>
          <ul className="space-y-1">
            {contradictions.map((c, i) => (
              <li key={i} className={`text-sm ${body}`}>
                <span className="text-amber-400 mr-1.5">↔</span>{c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── §6 Detail Rows ───────────────────────────────────────────────────────────
// Only renders sections where data is actually present.

function DetailRows({
  darkMode,
  teamHighlights,
  useOfFunds,
  projectPipeline,
  revenueModel,
}: Pick<WorkspaceRedesignedShellProps, 'darkMode' | 'teamHighlights' | 'useOfFunds' | 'projectPipeline' | 'revenueModel'>) {
  const card = darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';
  const title = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-200' : 'text-gray-700';
  const subtle = darkMode ? 'text-gray-500' : 'text-gray-400';
  const divider = darkMode ? 'border-white/5' : 'border-gray-100';

  const hasTeam = Array.isArray(teamHighlights) && teamHighlights.length > 0;
  const hasUoF = Array.isArray(useOfFunds) && useOfFunds.length > 0;
  const hasPipeline = Array.isArray(projectPipeline) && projectPipeline.length > 0;
  const rmHasContent = Boolean(revenueModel?.type || revenueModel?.detail || revenueModel?.unitEconomics);

  // Nothing to render — skip the section entirely
  if (!hasTeam && !hasUoF && !hasPipeline && !rmHasContent) return null;

  return (
    <div data-testid="detail-rows" className="space-y-4">

      {/* Revenue model (most concise — put first) */}
      {rmHasContent && (
        <div className={`rounded-xl border p-4 ${card}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium ${muted}`}>Revenue Model</span>
            <TrustBadge trust={revenueModel!.trust ?? 'not_extracted'} />
          </div>
          <div className={`text-sm space-y-0.5 ${body}`}>
            {revenueModel!.type && <p><span className={`font-medium`}>{revenueModel!.type}</span></p>}
            {revenueModel!.unitEconomics && (
              <p className={subtle}>{revenueModel!.unitEconomics}</p>
            )}
            {revenueModel!.detail && <p className={subtle}>{revenueModel!.detail}</p>}
          </div>
        </div>
      )}

      {/* Team highlights */}
      {hasTeam && (
        <div className={`rounded-xl border p-4 ${card}`}>
          <div className="flex items-center gap-2 mb-3">
            <Users className={`w-3.5 h-3.5 ${muted}`} strokeWidth={1.5} />
            <span className={`text-xs font-medium ${muted}`}>Team Highlights</span>
          </div>
          <ul className="space-y-2">
            {teamHighlights.map((m) => (
              <li key={`${m.name}-${m.role}`} className={`text-sm ${body}`}>
                <span className="font-medium">{m.name}</span>{' — '}<span>{m.role}</span>
                {m.credential && (
                  <span className={`block text-xs mt-0.5 ${muted}`}>{m.credential}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Use of funds + pipeline side by side when both present */}
      {(hasUoF || hasPipeline) && (
        <div className={`grid ${hasUoF && hasPipeline ? 'sm:grid-cols-2' : 'grid-cols-1'} gap-4`}>
          {hasUoF && (
            <div className={`rounded-xl border p-4 ${card}`}>
              <span className={`text-xs font-medium ${muted} block mb-2`}>Use of Funds</span>
              <ul className="space-y-1">
                {useOfFunds.map((item) => (
                  <li key={item.category} className={`flex items-center justify-between text-sm ${body}`}>
                    <span>{item.category}</span>
                    {item.amountLabel && <span className={`text-xs ${muted}`}>{item.amountLabel}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasPipeline && (
            <div className={`rounded-xl border p-4 ${card}`}>
              <span className={`text-xs font-medium ${muted} block mb-2`}>Project Pipeline</span>
              <div className="space-y-2">
                {projectPipeline.map((row) => (
                  <div key={row.name} className={`text-sm border-b pb-1.5 last:border-0 last:pb-0 ${divider} ${body}`}>
                    <span className="font-medium">{row.name}</span>
                    <div className={`flex flex-wrap gap-3 text-xs mt-0.5 ${muted}`}>
                      {row.capitalLabel && <span>Capital: {row.capitalLabel}</span>}
                      {row.revenueLabel && <span>Revenue: {row.revenueLabel}</span>}
                      {row.returnPct && <span>Return: {row.returnPct}</span>}
                      {row.startDate && <span>Start: {row.startDate}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── §7 Workbench Row ─────────────────────────────────────────────────────────

function WorkbenchRow({
  darkMode,
  deepDiveReady,
  insightsReady,
  onOpenDeepDive,
  onOpenInsights,
  onOpenEvidenceExplorer,
}: Pick<WorkspaceRedesignedShellProps,
  'darkMode' | 'deepDiveReady' | 'insightsReady' | 'onOpenDeepDive' | 'onOpenInsights' | 'onOpenEvidenceExplorer'
>) {
  const surface = darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-200' : 'text-gray-700';

  const entries: Array<{
    icon: React.ReactNode;
    label: string;
    description: string;
    ready: boolean;
    onOpen?: () => void;
    readyCta: string;
    notReadyCta: string;
  }> = [
    {
      icon: <Layers className="w-4 h-4" strokeWidth={1.5} />,
      label: 'Deep Dive',
      description: 'Detailed section-by-section analysis of the deck and financials.',
      ready: deepDiveReady,
      onOpen: onOpenDeepDive,
      readyCta: 'Open',
      notReadyCta: 'Run Deep Dive',
    },
    {
      icon: <TrendingUp className="w-4 h-4" strokeWidth={1.5} />,
      label: 'Investor Insights',
      description: 'Policy-aware scoring with signal-level justifications.',
      ready: insightsReady,
      onOpen: onOpenInsights,
      readyCta: 'Open',
      notReadyCta: 'Generate',
    },
    {
      icon: <FileSearch className="w-4 h-4" strokeWidth={1.5} />,
      label: 'Evidence',
      description: 'Browse raw extraction nodes by slide, field, and document.',
      ready: true,
      onOpen: onOpenEvidenceExplorer,
      readyCta: 'Explore',
      notReadyCta: 'Explore',
    },
  ];

  return (
    <div data-testid="workbench-row" className={`rounded-xl border p-5 ${surface}`}>
      <div className={`text-xs uppercase tracking-wide font-medium mb-4 ${muted}`}>Analyst Workbench</div>
      <div className="grid sm:grid-cols-3 gap-4">
        {entries.map((e) => (
          <div key={e.label} className="flex items-start gap-3">
            <div className={`mt-0.5 shrink-0 ${e.ready ? 'text-emerald-400' : muted}`}>{e.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-sm font-medium ${body}`}>{e.label}</span>
                {!e.ready && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-gray-500/10 text-gray-400 border-gray-500/20`}>
                    Not run
                  </span>
                )}
              </div>
              <p className={`text-xs leading-snug ${muted} mb-2`}>{e.description}</p>
              {e.onOpen && (
                <button
                  type="button"
                  onClick={e.onOpen}
                  className={`inline-flex items-center gap-1 text-xs transition-colors ${
                    e.ready
                      ? darkMode ? 'text-gray-200 hover:text-white' : 'text-gray-700 hover:text-gray-900'
                      : darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
                  }`}
                >
                  {e.ready ? e.readyCta : e.notReadyCta}
                  <ChevronRight className="w-3 h-3" strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function WorkspaceRedesignedShell(props: WorkspaceRedesignedShellProps) {
  const {
    darkMode,
    companyName, dealType, stage, raise, raiseNullRule, lastAnalyzedAt, onRunAnalysis,
    investmentSnapshotBody, convictionScore, convictionBand, convictionPosture,
    product, market, businessModel, raiseTerms,
    financialTiles, financialCoverage, underwritingReadiness, financialIntegrityStatus,
    redFlags, blockerCount, openQuestions, contradictions,
    teamHighlights, useOfFunds, projectPipeline, revenueModel,
    deepDiveReady, insightsReady, onOpenDeepDive, onOpenInsights, onOpenEvidenceExplorer,
  } = props;

  return (
    <div data-testid="workspace-redesigned-shell" className="w-full space-y-5 pb-10">

      {/* 1. Identity */}
      <IdentityStrip
        darkMode={darkMode}
        companyName={companyName}
        dealType={dealType}
        stage={stage}
        raise={raise}
        raiseNullRule={raiseNullRule}
        lastAnalyzedAt={lastAnalyzedAt}
        onRunAnalysis={onRunAnalysis}
      />

      {/* 2. Snapshot — conviction + prose */}
      <SnapshotRow
        darkMode={darkMode}
        investmentSnapshotBody={investmentSnapshotBody}
        convictionScore={convictionScore}
        convictionBand={convictionBand}
        convictionPosture={convictionPosture}
        onOpenInsights={onOpenInsights}
      />

      {/* 3. Key facts — 2×2 grid */}
      <KeyFactsGrid
        darkMode={darkMode}
        product={product}
        market={market}
        businessModel={businessModel}
        raiseTerms={raiseTerms}
      />

      {/* 4. Financial strip */}
      <FinancialStrip
        darkMode={darkMode}
        financialTiles={financialTiles}
        financialCoverage={financialCoverage}
        underwritingReadiness={underwritingReadiness}
        financialIntegrityStatus={financialIntegrityStatus}
      />

      {/* 5. Risk rail */}
      <RiskRail
        darkMode={darkMode}
        redFlags={redFlags}
        blockerCount={blockerCount}
        openQuestions={openQuestions}
        contradictions={contradictions}
      />

      {/* 6. Detail rows — only renders data that exists */}
      <DetailRows
        darkMode={darkMode}
        teamHighlights={teamHighlights}
        useOfFunds={useOfFunds}
        projectPipeline={projectPipeline}
        revenueModel={revenueModel}
      />

      {/* 7. Workbench */}
      <WorkbenchRow
        darkMode={darkMode}
        deepDiveReady={deepDiveReady}
        insightsReady={insightsReady}
        onOpenDeepDive={onOpenDeepDive}
        onOpenInsights={onOpenInsights}
        onOpenEvidenceExplorer={onOpenEvidenceExplorer}
      />
    </div>
  );
}

export default WorkspaceRedesignedShell;
