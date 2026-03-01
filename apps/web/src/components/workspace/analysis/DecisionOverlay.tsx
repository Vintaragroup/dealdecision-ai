/**
 * DecisionOverlay — AI Analysis Tab exclusive component
 *
 * Renders a prominent Deal Decision banner at the TOP of the AI Analysis report
 * (above Executive Summary). Derives all content from OrchestratorReportV1 via
 * useOrchestratorReport — no new LLM calls and no new API endpoints.
 *
 * Sections:
 *   1. Decision badge + ORS + stage + DCI confidence
 *   2. "Why this decision" — rationale_bullets from OrchestratorDecision
 *   3. "What to verify next" — verification_requests from risk_verification segment
 *   4. "Data limitations" callout — missing_critical_terms or weak coverage
 *
 * SCOPE: used by InvestorReportView.tsx only.
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Info,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useOrchestratorReport } from '../../../hooks/useOrchestratorReport';
import { apiRegenerateInvestorInsights } from '../../../lib/apiClient';
import type { OrchestratorReportV1, OrchestratorVerificationRequest } from '../../../lib/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Prop types
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionOverlayProps {
  dealId: string | undefined;
  darkMode?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision styling helpers
// ─────────────────────────────────────────────────────────────────────────────

function decisionStyle(label: 'GO' | 'CONSIDER' | 'NO_GO', darkMode: boolean) {
  const base = {
    GO: {
      border: darkMode ? 'border-emerald-400/30' : 'border-emerald-300',
      bg: darkMode ? 'bg-emerald-500/10' : 'bg-emerald-50',
      badgeBg: darkMode ? 'bg-emerald-500/20 border-emerald-400/40' : 'bg-emerald-100 border-emerald-300',
      badgeText: darkMode ? 'text-emerald-300' : 'text-emerald-800',
      dot: 'bg-emerald-500',
      barFill: 'bg-emerald-500',
      Icon: CheckCircle2,
    },
    CONSIDER: {
      border: darkMode ? 'border-amber-400/30' : 'border-amber-300',
      bg: darkMode ? 'bg-amber-500/10' : 'bg-amber-50',
      badgeBg: darkMode ? 'bg-amber-500/20 border-amber-400/40' : 'bg-amber-100 border-amber-300',
      badgeText: darkMode ? 'text-amber-300' : 'text-amber-800',
      dot: 'bg-amber-500',
      barFill: 'bg-amber-500',
      Icon: AlertTriangle,
    },
    NO_GO: {
      border: darkMode ? 'border-red-400/30' : 'border-red-300',
      bg: darkMode ? 'bg-red-500/10' : 'bg-red-50',
      badgeBg: darkMode ? 'bg-red-500/20 border-red-400/40' : 'bg-red-100 border-red-300',
      badgeText: darkMode ? 'text-red-300' : 'text-red-800',
      dot: 'bg-red-500',
      barFill: 'bg-red-500',
      Icon: XCircle,
    },
  } as const;
  return base[label];
}

function priorityStyle(priority: 'P0' | 'P1' | 'P2', darkMode: boolean) {
  if (priority === 'P0') return {
    bg: darkMode ? 'bg-red-500/15 border-red-400/30' : 'bg-red-50 border-red-200',
    text: darkMode ? 'text-red-400' : 'text-red-700',
    label: 'Critical',
  };
  if (priority === 'P1') return {
    bg: darkMode ? 'bg-amber-500/15 border-amber-400/30' : 'bg-amber-50 border-amber-200',
    text: darkMode ? 'text-amber-400' : 'text-amber-700',
    label: 'High',
  };
  return {
    bg: darkMode ? 'bg-blue-500/15 border-blue-400/30' : 'bg-blue-50 border-blue-200',
    text: darkMode ? 'text-blue-400' : 'text-blue-700',
    label: 'Review',
  };
}

function dciBandColor(band: string, darkMode: boolean): string {
  if (band === 'Strong') return darkMode ? 'text-emerald-400' : 'text-emerald-700';
  if (band === 'Good') return darkMode ? 'text-blue-400' : 'text-blue-700';
  if (band === 'Partial') return darkMode ? 'text-amber-400' : 'text-amber-700';
  return darkMode ? 'text-red-400' : 'text-red-700'; // Weak
}

function isLowCoverage(band: string): boolean {
  return band === 'Partial' || band === 'Weak';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort verification requests: P0 first, then P1, then P2
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2 } as const;

function sortedVerifications(
  items: OrchestratorVerificationRequest[] | undefined,
  max = 5,
): OrchestratorVerificationRequest[] {
  if (!items || items.length === 0) return [];
  return [...items]
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function Skeleton({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="space-y-3 animate-pulse" data-testid="decision-overlay-skeleton">
      <div className={`h-8 w-48 rounded-full ${darkMode ? 'bg-white/8' : 'bg-gray-200'}`} />
      <div className={`h-16 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`} />
      <div className={`h-20 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RegenCTA — shown in not_found state
// ─────────────────────────────────────────────────────────────────────────────

function RegenCTA({ dealId, darkMode }: { dealId: string | undefined; darkMode: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const handleRegen = async () => {
    if (!dealId || state === 'loading' || state === 'done') return;
    setState('loading');
    try {
      await apiRegenerateInvestorInsights(dealId);
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <p className={`text-xs mt-2 ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
        <CheckCircle2 size={12} className="inline mr-1" />
        Analysis queued. Refresh the page in a moment.
      </p>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-3 flex-wrap">
      {dealId && (
        <button
          type="button"
          onClick={handleRegen}
          disabled={state === 'loading'}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
            ${darkMode
              ? 'border-white/15 bg-white/8 text-gray-200 hover:bg-white/15 disabled:opacity-50'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50'
            }`}
          data-testid="regenerate-btn"
        >
          <RefreshCw size={12} className={state === 'loading' ? 'animate-spin' : ''} />
          {state === 'loading' ? 'Queueing…' : 'Regenerate Analysis'}
        </button>
      )}
      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {dealId
          ? 'Or re-run the full analysis from the Deal Workspace.'
          : 'Run the full analysis from the Deal Workspace to see this report.'}
      </p>
      {state === 'error' && (
        <p className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
          Failed to queue — please try again.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main content (when data loaded)
// ─────────────────────────────────────────────────────────────────────────────

function OverlayContent({
  report,
  darkMode,
}: {
  report: OrchestratorReportV1;
  darkMode: boolean;
}) {
  const { decision, scores, document_confidence, stage_context, segments } = report;
  const ors = scores.overall_recommendation_score;
  const dci = document_confidence.score;
  const dciBand = document_confidence.band;
  const style = decisionStyle(decision.label, darkMode);
  const { Icon } = style;

  const drivers = (decision.rationale_bullets ?? []).slice(0, 6);
  const verifications = sortedVerifications(segments?.risk_verification?.verification_requests, 5);

  // Data limitations: missing terms from stage_context OR from segments (whichever is populated)
  const missingTerms = stage_context.missing_critical_terms.length > 0
    ? stage_context.missing_critical_terms
    : (segments?.risk_verification?.data_issues?.missing_critical_terms ?? []);
  const hasLimitations = missingTerms.length > 0 || isLowCoverage(dciBand);

  return (
    <div className="space-y-4">
      {/* ── Row 1: Decision badge + ORS + stage + DCI ── */}
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3.5 ${style.bg} ${style.border}`}>
        {/* Decision badge */}
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-sm font-bold ${style.badgeBg} ${style.badgeText}`}
          data-testid="decision-overlay-badge"
          data-decision={decision.label}
        >
          <Icon size={14} />
          {decision.label}
        </div>

        {/* ORS */}
        <div className={`flex items-center gap-1.5 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          <span className={`text-xs uppercase tracking-wide font-medium opacity-60`}>Deal Score</span>
          <span className="text-xl font-bold tabular-nums" data-testid="decision-overlay-ors">{ors}</span>
          <span className={`text-xs opacity-50`}>/100</span>
        </div>

        {/* Stage */}
        <div
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium
            ${darkMode ? 'border-white/10 bg-white/5 text-gray-300' : 'border-gray-200 bg-white text-gray-700'}`}
          data-testid="decision-overlay-stage"
        >
          <Activity size={11} className="opacity-70" />
          {stage_context.stage}
        </div>

        {/* DCI */}
        <div
          className={`flex items-center gap-1 text-xs`}
          data-testid="decision-overlay-dci"
        >
          <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Coverage</span>
          <span className={`font-semibold tabular-nums ${dciBandColor(dciBand, darkMode)}`}>{dci}/100</span>
          <span className={`rounded px-1 py-0.5 text-xs font-medium ${dciBandColor(dciBand, darkMode)} ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
            {dciBand}
          </span>
        </div>

        {/* Confidence band */}
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium
          ${decision.confidence_band === 'High'
            ? (darkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700')
            : decision.confidence_band === 'Medium'
              ? (darkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700')
              : (darkMode ? 'bg-gray-500/10 text-gray-400' : 'bg-gray-100 text-gray-600')
          }`}
        >
          {decision.confidence_band} confidence
        </span>
      </div>

      {/* ── Row 2: Why this decision ── */}
      {drivers.length > 0 && (
        <div className={`rounded-xl border p-4 ${darkMode ? 'bg-white/3 border-white/8' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-2 mb-3">
            <ChevronRight size={14} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
            <h4 className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Why this decision
            </h4>
          </div>
          <ul className="space-y-2">
            {drivers.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2" data-testid="driver-bullet">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                <span className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {bullet}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Row 3: What to verify next ── */}
      {verifications.length > 0 && (
        <div className={`rounded-xl border p-4 ${darkMode ? 'bg-white/3 border-white/8' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck size={14} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
            <h4 className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              What to verify next
            </h4>
          </div>
          <ul className="space-y-2.5">
            {verifications.map((v, i) => {
              const pStyle = priorityStyle(v.priority, darkMode);
              return (
                <li key={i} className="flex items-start gap-2.5" data-testid="verification-item">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold border ${pStyle.bg} ${pStyle.text}`}
                    data-priority={v.priority}
                  >
                    {pStyle.label}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium leading-snug ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {v.request}
                    </p>
                    {v.why && (
                      <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {v.why}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Row 4: Data limitations callout ── */}
      {hasLimitations && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm
            ${darkMode ? 'bg-amber-500/8 border-amber-400/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'}`}
          data-testid="limitations-callout"
        >
          <Info size={15} className="shrink-0 mt-0.5 opacity-80" />
          <div className="space-y-1 min-w-0">
            <p className="font-medium text-xs uppercase tracking-wide opacity-80">Data limitations</p>
            {missingTerms.length > 0 && (
              <p className="text-xs">
                Not disclosed:{' '}
                <span className="font-medium">{missingTerms.join(', ')}</span>.
                Scoring uses conservative proxies for missing fields.
              </p>
            )}
            {isLowCoverage(dciBand) && (
              <p className="text-xs">
                Document coverage is <span className="font-medium">{dciBand.toLowerCase()}</span>{' '}
                ({dci}/100 DCI). Conclusions may have lower reliability.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public export
// ─────────────────────────────────────────────────────────────────────────────

export function DecisionOverlay({ dealId, darkMode = false }: DecisionOverlayProps) {
  const { status, data, error } = useOrchestratorReport(dealId);

  return (
    <div
      data-testid="decision-overlay"
      className={`${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
    >
      {(status === 'idle' || status === 'loading') && (
        <Skeleton darkMode={darkMode} />
      )}

      {status === 'not_found' && (
        <div
          className={`rounded-xl border p-4 ${darkMode ? 'bg-white/3 border-white/8 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-500'}`}
          data-testid="decision-overlay-not-found"
        >
          <p className="text-sm">
            Deal Intelligence report is not yet available for this deal.
          </p>
          <RegenCTA dealId={dealId} darkMode={darkMode} />
        </div>
      )}

      {status === 'error' && error && (
        <div
          className={`flex items-center gap-2 rounded-xl border p-3.5 text-sm
            ${darkMode ? 'bg-red-500/8 border-red-400/20 text-red-400' : 'bg-red-50 border-red-200 text-red-700'}`}
          data-testid="decision-overlay-error"
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {status === 'ready' && data?.report && (
        <OverlayContent report={data.report} darkMode={darkMode} />
      )}
    </div>
  );
}
