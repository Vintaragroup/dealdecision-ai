/**
 * MarketAnalysisCard  — AI Analysis Tab exclusive component
 *
 * Renders a governed LLM market analysis card: score bar, KPI tiles,
 * strengths/concerns columns, and an AI-insight narrative.
 *
 * SCOPE: used by InvestorReportView (embedded inside the Market section via
 * the `embedded` prop). Must NOT be imported by InvestorInsightsTab,
 * DueDiligenceReport, or any export route.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import type { MarketAnalysisResult, InvestorInsightsReport } from '../../lib/apiClient';
import { useMarketAnalysis } from '../../hooks/useMarketAnalysis';

// ─────────────────────────────────────────────────────────────────────────────
// Score bar
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ score, darkMode }: { score: number; darkMode: boolean }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2" data-testid="market-score-bar">
      <span
        className={`text-xs font-semibold tabular-nums ${
          darkMode ? 'text-zinc-100' : 'text-gray-800'
        }`}
      >
        Score: {pct}/100
      </span>
      <div
        className={`flex-1 max-w-[80px] h-1.5 rounded-full overflow-hidden ${
          darkMode ? 'bg-white/10' : 'bg-gray-200'
        }`}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  darkMode,
}: {
  label: string;
  value: string;
  darkMode: boolean;
}) {
  const isMissing =
    !value || value.toLowerCase() === 'not disclosed' || value.toLowerCase() === 'n/a';
  return (
    <div
      className={`flex-1 min-w-0 rounded-lg border p-3 space-y-1 ${
        darkMode ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-100'
      }`}
      data-testid="market-kpi-tile"
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wider ${
          darkMode ? 'text-zinc-400' : 'text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-sm font-semibold leading-snug break-words ${
          isMissing
            ? darkMode
              ? 'text-zinc-500 italic'
              : 'text-gray-400 italic'
            : darkMode
            ? 'text-zinc-100'
            : 'text-gray-800'
        }`}
        data-testid="market-kpi-value"
      >
        {value || 'Not disclosed'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bullet column
// ─────────────────────────────────────────────────────────────────────────────

function BulletColumn({
  title,
  items,
  accent,
  icon: Icon,
  darkMode,
}: {
  title: string;
  items: string[];
  accent: string;
  icon: typeof CheckCircle2;
  darkMode: boolean;
}) {
  return (
    <div className="flex-1 min-w-0">
      <p
        className={`text-xs font-semibold mb-2 ${accent}`}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p className={`text-xs italic ${darkMode ? 'text-zinc-500' : 'text-gray-400'}`}>
          None identified
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Icon
                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${accent}`}
              />
              <span
                className={`text-xs leading-relaxed ${
                  darkMode ? 'text-zinc-300' : 'text-gray-700'
                }`}
                data-testid={title === 'Strengths' ? 'market-strength-item' : 'market-concern-item'}
              >
                {item}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────

function MarketSkeleton({ darkMode }: { darkMode: boolean }) {
  const base = darkMode ? 'bg-white/8' : 'bg-gray-200';
  return (
    <div className="space-y-3 animate-pulse">
      <div className={`h-3 w-2/3 rounded ${base}`} />
      {/* KPI row */}
      <div className="flex gap-2">
        <div className={`flex-1 h-14 rounded-lg ${base}`} />
        <div className={`flex-1 h-14 rounded-lg ${base}`} />
        <div className={`flex-1 h-14 rounded-lg ${base}`} />
      </div>
      {/* Bullets */}
      <div className="flex gap-4">
        <div className="flex-1 space-y-1.5">
          <div className={`h-2.5 w-1/3 rounded ${base}`} />
          <div className={`h-2 w-full rounded ${base}`} />
          <div className={`h-2 w-5/6 rounded ${base}`} />
        </div>
        <div className="flex-1 space-y-1.5">
          <div className={`h-2.5 w-1/3 rounded ${base}`} />
          <div className={`h-2 w-full rounded ${base}`} />
          <div className={`h-2 w-3/4 rounded ${base}`} />
        </div>
      </div>
      {/* Insight */}
      <div className={`h-3 w-full rounded ${base}`} />
      <div className={`h-3 w-4/5 rounded ${base}`} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MarketAnalysisCardProps {
  dealId: string;
  report: InvestorInsightsReport | null;
  darkMode: boolean;
  dealName?: string;
  /** When true, no outer card wrapper or title h3 — ReportSection provides the container. */
  embedded?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketAnalysisCard({
  dealId,
  report,
  darkMode,
  dealName,
  embedded = false,
}: MarketAnalysisCardProps) {
  const { status, data, error, refresh } = useMarketAnalysis(dealId, report, dealName);
  const [showRaw, setShowRaw] = useState(false);

  // ── Shared sub-elements ───────────────────────────────────────────────────

  const governedBadge = (
    <span
      className={`text-xs px-1.5 py-0.5 rounded border ${
        darkMode
          ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
          : 'bg-indigo-50 border-indigo-200 text-indigo-700'
      }`}
    >
      AI Governed
    </span>
  );

  const refreshBtn = (
    <button
      onClick={refresh}
      title="Regenerate market analysis"
      className={`p-1 rounded transition-colors ${
        darkMode
          ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
      }`}
      data-testid="market-refresh-btn"
    >
      <RefreshCw className="w-3.5 h-3.5" />
    </button>
  );

  // ── Loading ───────────────────────────────────────────────────────────────

  if (status === 'idle' || status === 'loading') {
    if (embedded) {
      return (
        <div className="space-y-3" data-testid="market-loading-skeleton">
          <div className="flex items-center gap-2">{governedBadge}</div>
          <MarketSkeleton darkMode={darkMode} />
        </div>
      );
    }
    return (
      <div
        className={`rounded-xl border p-5 ${
          darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
        }`}
        data-testid="market-loading-skeleton"
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Market Analysis
          </h3>
          {governedBadge}
        </div>
        <MarketSkeleton darkMode={darkMode} />
      </div>
    );
  }

  // ── No data ───────────────────────────────────────────────────────────────

  if (status === 'no_data') {
    const noDataMsg = (
      <p
        className={`text-sm italic ${darkMode ? 'text-zinc-400' : 'text-gray-500'}`}
        data-testid="market-no-data"
      >
        No market signals found in provided materials. Add TAM/SAM/SOM, growth rate, or customer
        data to enable market analysis.
      </p>
    );
    if (embedded) {
      return <div className="space-y-2">{noDataMsg}</div>;
    }
    return (
      <div
        className={`rounded-xl border p-5 ${
          darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Market Analysis
          </h3>
        </div>
        {noDataMsg}
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (status === 'error' || !data) {
    const errorContent = (
      <>
        <div
          className={`flex items-start gap-2 text-sm rounded-lg border p-3 mb-3 ${
            darkMode ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error ?? 'Market analysis synthesis failed.'}</span>
        </div>
        <button
          onClick={refresh}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/15 text-zinc-300 hover:bg-white/5'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
          data-testid="market-retry-btn"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </>
    );

    if (embedded) return <div className="space-y-2">{errorContent}</div>;
    return (
      <div
        className={`rounded-xl border p-5 ${
          darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Market Analysis
          </h3>
        </div>
        {errorContent}
      </div>
    );
  }

  // ── Ready ─────────────────────────────────────────────────────────────────

  const readyBody = (
    <>
      {/* 1 — Score bar */}
      <ScoreBar score={data.score} darkMode={darkMode} />

      {/* 2 — KPI tiles */}
      <div className="flex gap-2 flex-wrap sm:flex-nowrap" data-testid="market-kpi-row">
        <KpiTile label="Market Tailwind" value={data.kpis.tailwind} darkMode={darkMode} />
        <KpiTile label="Launch Plan"    value={data.kpis.launch_plan} darkMode={darkMode} />
        <KpiTile label="Priority Markets" value={data.kpis.priority_markets} darkMode={darkMode} />
      </div>

      {/* 3 — Strengths / Concerns columns */}
      <div
        className={`flex gap-4 rounded-lg border p-4 ${
          darkMode ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-100'
        }`}
        data-testid="market-bullets-section"
      >
        <BulletColumn
          title="Strengths"
          items={data.strengths}
          accent={darkMode ? 'text-emerald-400' : 'text-emerald-600'}
          icon={CheckCircle2}
          darkMode={darkMode}
        />
        <BulletColumn
          title="Concerns"
          items={data.concerns}
          accent={darkMode ? 'text-amber-400' : 'text-amber-600'}
          icon={XCircle}
          darkMode={darkMode}
        />
      </div>

      {/* 4 — AI Insight */}
      {data.ai_insight && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border p-3 ${
            darkMode ? 'bg-indigo-500/8 border-indigo-500/25' : 'bg-indigo-50 border-indigo-200'
          }`}
          data-testid="market-ai-insight"
        >
          <TrendingUp
            className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
              darkMode ? 'text-indigo-400' : 'text-indigo-600'
            }`}
          />
          <p
            className={`text-sm leading-relaxed ${darkMode ? 'text-zinc-100' : 'text-gray-700'}`}
            data-testid="market-ai-insight-text"
          >
            {data.ai_insight}
          </p>
        </div>
      )}

      {/* 5 — Missing inputs note */}
      {data.missing_inputs.length > 0 && (
        <div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
              darkMode
                ? 'border-white/15 text-zinc-400 hover:bg-white/5'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            data-testid="market-missing-toggle"
          >
            {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showRaw ? 'Hide missing data' : `${data.missing_inputs.length} missing signal${data.missing_inputs.length !== 1 ? 's' : ''}`}
          </button>
          {showRaw && (
            <div
              className={`mt-2 rounded-lg border p-3 ${
                darkMode ? 'border-white/8 bg-white/3' : 'border-gray-100 bg-gray-50'
              }`}
              data-testid="market-missing-inputs"
            >
              <p
                className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  darkMode ? 'text-zinc-400' : 'text-gray-400'
                }`}
              >
                Inputs not found in materials
              </p>
              <ul
                className={`text-xs space-y-0.5 ${darkMode ? 'text-zinc-400' : 'text-gray-600'}`}
              >
                {data.missing_inputs.map((m) => (
                  <li key={m} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Embedded mode — ReportSection provides the outer card + heading
  if (embedded) {
    return (
      <div className="space-y-4" data-testid="market-analysis-card">
        {/* AI Governed badge + refresh */}
        <div className="flex items-center gap-2">
          {governedBadge}
          {refreshBtn}
        </div>
        {readyBody}
      </div>
    );
  }

  // Standalone mode — full card with header
  return (
    <div
      className={`rounded-xl border ${
        darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
      }`}
      data-testid="market-analysis-card"
    >
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-5 py-4 border-b ${
          darkMode ? 'border-white/8' : 'border-gray-100'
        }`}
      >
        <BarChart3 className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
        <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Market Analysis
        </h3>
        <div className="ml-auto flex items-center gap-2">
          {governedBadge}
          {refreshBtn}
        </div>
      </div>

      <div className="p-5 space-y-4">{readyBody}</div>
    </div>
  );
}
