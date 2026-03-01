/**
 * OrchestratorSummaryCard  — AI Analysis Tab exclusive component
 *
 * Renders the DDAI Deal Intelligence Score card derived from the
 * ddai_orchestrator_report_v1. Pure read-only display — no writes or mutations.
 *
 * Data source: GET /api/v1/deals/:deal_id/orchestrator-report
 * Fetched via useOrchestratorReport(dealId).
 *
 * SCOPE: used by InvestorReportView.tsx only.
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useOrchestratorReport } from '../../../hooks/useOrchestratorReport';
import type { OrchestratorReportV1 } from '../../../lib/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Prop types
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestratorSummaryCardProps {
  dealId: string | undefined;
  darkMode?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision badge helpers
// ─────────────────────────────────────────────────────────────────────────────

function decisionColors(label: 'GO' | 'CONSIDER' | 'NO_GO', darkMode: boolean) {
  if (label === 'GO') {
    return {
      bg: darkMode ? 'bg-emerald-500/15 border-emerald-400/30' : 'bg-emerald-50 border-emerald-300',
      text: darkMode ? 'text-emerald-400' : 'text-emerald-700',
      dot: 'bg-emerald-500',
      barFill: 'bg-emerald-500',
      Icon: CheckCircle2,
    };
  }
  if (label === 'CONSIDER') {
    return {
      bg: darkMode ? 'bg-amber-500/15 border-amber-400/30' : 'bg-amber-50 border-amber-300',
      text: darkMode ? 'text-amber-400' : 'text-amber-700',
      dot: 'bg-amber-500',
      barFill: 'bg-amber-500',
      Icon: AlertTriangle,
    };
  }
  // NO_GO
  return {
    bg: darkMode ? 'bg-red-500/15 border-red-400/30' : 'bg-red-50 border-red-300',
    text: darkMode ? 'text-red-400' : 'text-red-600',
    dot: 'bg-red-500',
    barFill: 'bg-red-500',
    Icon: XCircle,
  };
}

function orsBarColor(ors: number): string {
  if (ors >= 70) return 'bg-emerald-500';
  if (ors >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini score row (used for sub-scores)
// ─────────────────────────────────────────────────────────────────────────────

function MiniScoreRow({
  label,
  score,
  maxScore = 100,
  inverted = false,
  darkMode,
}: {
  label: string;
  score: number | null;
  maxScore?: number;
  inverted?: boolean;
  darkMode: boolean;
}) {
  if (score === null) {
    return (
      <div className="flex items-center gap-2 text-xs" data-testid="mini-score-row">
        <span className={`w-28 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
        <span className={`text-xs italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>N/A</span>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (score / maxScore) * 100));
  // For inverted scores (risk): red is high, green is low
  const fillColor = inverted
    ? pct <= 24 ? 'bg-emerald-500' : pct <= 49 ? 'bg-amber-500' : 'bg-red-500'
    : pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 text-xs" data-testid="mini-score-row">
      <span className={`w-28 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
      <div className={`flex-1 rounded-full h-1.5 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
        <div
          className={`h-1.5 rounded-full transition-all ${fillColor}`}
          style={{ width: `${pct}%` }}
          data-testid="mini-score-bar"
        />
      </div>
      <span className={`w-8 text-right tabular-nums ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {score}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main card content (when data loaded)
// ─────────────────────────────────────────────────────────────────────────────

function CardContent({
  report,
  darkMode,
}: {
  report: OrchestratorReportV1;
  darkMode: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);

  const { decision, scores, document_confidence, stage_context } = report;
  const ors = scores.overall_recommendation_score;
  const urss = scores.risk_severity_score;
  const dci = document_confidence.score;
  const fhc = scores.financial_health_score.score;
  const market = scores.market_score.persisted;
  const colors = decisionColors(decision.label, darkMode);
  const { Icon } = colors;

  return (
    <div className="space-y-4">
      {/* Header row: decision badge + ORS */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Decision badge */}
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${colors.bg} ${colors.text}`}
          data-testid="decision-badge"
          data-decision={decision.label}
        >
          <Icon size={14} />
          {decision.label}
        </div>

        {/* ORS score */}
        <div className={`flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          <span className="text-xs font-medium uppercase tracking-wide opacity-60">Deal Score</span>
          <span className="font-bold text-lg tabular-nums" data-testid="ors-score">{ors}</span>
          <span className="text-xs opacity-50">/100</span>
        </div>

        {/* Confidence band */}
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
          ${decision.confidence_band === 'High'
            ? (darkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700')
            : decision.confidence_band === 'Medium'
              ? (darkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700')
              : (darkMode ? 'bg-gray-500/10 text-gray-400' : 'bg-gray-100 text-gray-600')
          }`}
          data-testid="confidence-band"
        >
          {decision.confidence_band} confidence
        </span>

        {/* ORS bar */}
        <div className="flex-1 min-w-24">
          <div className={`rounded-full h-2 ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
            <div
              className={`h-2 rounded-full transition-all ${orsBarColor(ors)}`}
              style={{ width: `${ors}%` }}
              data-testid="ors-bar"
            />
          </div>
        </div>
      </div>

      {/* Sub-score grid */}
      <div className={`rounded-lg border p-3 space-y-2 ${darkMode ? 'bg-white/3 border-white/8' : 'bg-slate-50 border-slate-200'}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Component Scores
        </p>
        <MiniScoreRow label="Document (DCI)" score={dci} darkMode={darkMode} />
        <MiniScoreRow label="Financial (FHC)" score={fhc} darkMode={darkMode} />
        <MiniScoreRow label="Market" score={market} darkMode={darkMode} />
        <MiniScoreRow label="Risk (URSS)" score={urss} inverted darkMode={darkMode} />
      </div>

      {/* Stage + data coverage row */}
      <div className="flex flex-wrap gap-3 text-xs">
        <div className={`flex items-center gap-1.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <TrendingUp size={12} className="shrink-0" />
          <span>Stage: <span className={`font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{stage_context.stage}</span></span>
        </div>
        <div className={`flex items-center gap-1.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <FileSearch size={12} className="shrink-0" />
          <span>
            Coverage: <span className={`font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{dci}</span>
            <span className="opacity-60">/100 DCI</span>
            {document_confidence.band && (
              <span className={`ml-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>({document_confidence.band})</span>
            )}
          </span>
        </div>
        {scores.financial_health_score.status === 'insufficient_data' && (
          <div className={`flex items-center gap-1 text-xs ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
            <AlertTriangle size={11} />
            <span>Insufficient financial data — score is a proxy</span>
          </div>
        )}
      </div>

      {/* Why bullets */}
      {decision.rationale_bullets.length > 0 && (
        <div className={`rounded-lg border p-3 space-y-1 ${darkMode ? 'bg-white/3 border-white/8' : 'bg-slate-50 border-slate-200'}`}>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Rationale
          </p>
          {decision.rationale_bullets.map((bullet, i) => (
            <div key={i} className={`flex gap-2 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
              <span>{bullet}</span>
            </div>
          ))}
        </div>
      )}

      {/* Dev-only raw JSON toggle */}
      {import.meta.env.DEV && (
        <div>
          <button
            className={`text-xs underline ${darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
            onClick={() => setShowRaw((v) => !v)}
            data-testid="show-raw-toggle"
          >
            {showRaw ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
            {showRaw ? ' Hide raw JSON' : ' View raw JSON'}
          </button>
          {showRaw && (
            <pre
              className={`mt-2 rounded-lg p-3 text-xs overflow-auto max-h-64 ${darkMode ? 'bg-black/30 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
              data-testid="raw-json"
            >
              {JSON.stringify(report, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton loader
// ─────────────────────────────────────────────────────────────────────────────

function CardSkeleton({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="space-y-3 animate-pulse" data-testid="orchestrator-skeleton">
      <div className={`h-7 w-32 rounded-full ${darkMode ? 'bg-white/8' : 'bg-gray-200'}`} />
      <div className={`h-12 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`} />
      <div className={`h-24 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public export
// ─────────────────────────────────────────────────────────────────────────────

export function OrchestratorSummaryCard({ dealId, darkMode = false }: OrchestratorSummaryCardProps) {
  const { status, data, error } = useOrchestratorReport(dealId);

  return (
    <div
      data-testid="orchestrator-summary-card"
      className={`space-y-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
    >
      {(status === 'idle' || status === 'loading') && (
        <CardSkeleton darkMode={darkMode} />
      )}

      {status === 'not_found' && (
        <div className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} data-testid="orchestrator-not-found">
          Deal Intelligence Score is not yet available. Generate investor insights first.
        </div>
      )}

      {status === 'error' && error && (
        <div className={`text-sm ${darkMode ? 'text-red-400' : 'text-red-600'}`} data-testid="orchestrator-error">
          <AlertTriangle size={14} className="inline mr-1" />
          {error}
        </div>
      )}

      {status === 'ready' && data?.report && (
        <CardContent report={data.report} darkMode={darkMode} />
      )}
    </div>
  );
}
