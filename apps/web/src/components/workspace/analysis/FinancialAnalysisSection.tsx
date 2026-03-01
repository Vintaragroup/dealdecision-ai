/**
 * FinancialAnalysisSection  — AI Analysis Tab exclusive component
 *
 * Renders a visual financial analysis panel with:
 *  • Deterministic Financial Strength Score (0–100)
 *  • Current Financial Metrics tiles (from health metrics or implied allocation)
 *  • Revenue Projections table (from financial_statement_v1)
 *  • Unit Economics tiles (gross margin; LTV/CAC when available)
 *  • Key Financial Highlights (strengths + considerations columns)
 *  • AI Governed narrative panel (from POST /analysis/financial-analysis)
 *
 * All deterministic data is derived from render_package.sections — no numbers
 * are invented.  Missing data shows "TBD" tiles.
 *
 * SCOPE: used by InvestorReportView.tsx only.
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { InvestorInsightsReport } from '../../../lib/apiClient';
import {
  useFinancialAnalysis,
  type FinancialSections,
  type ImpliedAllocation,
  type HealthMetrics,
  type FinancialStatement,
  type ReconciliationSummary,
} from '../../../hooks/useFinancialAnalysis';

// ─────────────────────────────────────────────────────────────────────────────
// Prop types
// ─────────────────────────────────────────────────────────────────────────────

interface FinancialAnalysisSectionProps {
  dealId: string | undefined;
  report: InvestorInsightsReport | null;
  darkMode?: boolean;
  dealName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score panel
// ─────────────────────────────────────────────────────────────────────────────

function ScorePanel({
  score,
  label,
  darkMode,
}: {
  score: number;
  label: string;
  darkMode: boolean;
}) {
  const pct   = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-red-500';
  const ringColor =
    pct >= 70 ? (darkMode ? 'text-emerald-400' : 'text-emerald-600')
    : pct >= 45 ? (darkMode ? 'text-amber-400' : 'text-amber-600')
    : (darkMode ? 'text-red-400' : 'text-red-600');

  return (
    <div
      className={`rounded-xl border p-5 flex items-center gap-5 ${
        darkMode ? 'bg-white/3 border-white/10' : 'bg-slate-50 border-slate-200'
      }`}
      data-testid="fin-score-panel"
    >
      {/* Circular score display */}
      <div className="relative shrink-0 w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26"
            className={darkMode ? 'stroke-white/10' : 'stroke-slate-200'}
            strokeWidth="6" fill="none" />
          <circle cx="32" cy="32" r="26"
            className={pct >= 70 ? 'stroke-emerald-500' : pct >= 45 ? 'stroke-amber-500' : 'stroke-red-500'}
            strokeWidth="6" fill="none"
            strokeDasharray={`${(pct / 100) * 163.4} 163.4`}
            strokeLinecap="round" />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums ${ringColor}`}
          data-testid="fin-score-value"
        >
          {pct}
        </span>
      </div>

      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide mb-0.5 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Financial Strength Score
        </p>
        <p className={`text-base font-semibold ${darkMode ? 'text-zinc-100' : 'text-slate-800'}`}>
          {pct} / 100
        </p>
        <p className={`text-xs mt-0.5 ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
          {label}
        </p>

        {/* Score bar */}
        <div
          className={`mt-2 h-1.5 rounded-full overflow-hidden w-40 ${
            darkMode ? 'bg-white/10' : 'bg-slate-200'
          }`}
        >
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric tile
// ─────────────────────────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  tag,
  darkMode,
}: {
  label: string;
  value: string | null;
  tag?: string;
  darkMode: boolean;
}) {
  const isTbd = !value || value === 'TBD';
  return (
    <div
      className={`rounded-lg border p-3 space-y-1 ${
        darkMode ? 'bg-white/3 border-white/8' : 'bg-white border-slate-100'
      }`}
      data-testid="fin-metric-tile"
    >
      <div className="flex items-center justify-between gap-1">
        <p className={`text-xs font-semibold uppercase tracking-wider leading-tight ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          {label}
        </p>
        {tag && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
            darkMode
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {tag}
          </span>
        )}
      </div>
      <p
        className={`text-sm font-semibold leading-snug ${
          isTbd
            ? (darkMode ? 'text-zinc-500 italic' : 'text-slate-400 italic')
            : (darkMode ? 'text-zinc-100' : 'text-slate-800')
        }`}
        data-testid="fin-metric-value"
      >
        {value ?? 'TBD'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Current Financial Metrics section
// ─────────────────────────────────────────────────────────────────────────────

function CurrentMetricsGrid({
  healthMetrics,
  impliedAllocation,
  darkMode,
}: {
  healthMetrics: HealthMetrics | null;
  impliedAllocation: ImpliedAllocation | null;
  darkMode: boolean;
}) {
  const hm = healthMetrics;

  const tiles = [
    { label: 'Revenue (Latest)',  value: hm?.revenue_latest || null },
    { label: 'Gross Margin',      value: hm?.gross_margin_pct || null },
    { label: 'Revenue YoY Growth',value: hm?.revenue_yoy_growth_pct || null },
    { label: 'Cost Efficiency',   value: hm?.cost_efficiency_ratio || null },
  ];

  return (
    <div data-testid="fin-metrics-grid">
      <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
        darkMode ? 'text-zinc-400' : 'text-slate-500'
      }`}>
        Current Financial Metrics
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <MetricTile key={label} label={label} value={value} darkMode={darkMode} />
        ))}
      </div>

      {/* Implied allocation tile when present */}
      {impliedAllocation && (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            darkMode ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-50 border-amber-200'
          }`}
          data-testid="fin-implied-tile"
        >
          <div className="flex items-start gap-2">
            <DollarSign className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
              darkMode ? 'text-amber-400' : 'text-amber-600'
            }`} />
            <div>
              <p className={`text-xs font-semibold ${
                darkMode ? 'text-amber-300' : 'text-amber-700'
              }`}>
                Implied Annual Operating Cost
                <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded-full ${
                  darkMode ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'
                }`}>
                  Implied
                </span>
              </p>
              <p className={`text-sm font-bold mt-0.5 ${
                darkMode ? 'text-zinc-100' : 'text-slate-800'
              }`} data-testid="fin-implied-cost">
                {impliedAllocation.total_annual_cost ?? 'Not disclosed'}
                {impliedAllocation.period ? ` — ${impliedAllocation.period}` : ''}
              </p>
              <p className={`text-xs mt-0.5 ${
                darkMode ? 'text-zinc-500' : 'text-slate-400'
              }`}>
                {impliedAllocation.basis_note}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Projections table
// ─────────────────────────────────────────────────────────────────────────────

function RevenueTable({
  statement,
  darkMode,
}: {
  statement: FinancialStatement | null;
  darkMode: boolean;
}) {
  const hasRows =
    statement !== null &&
    statement.rows.length > 0 &&
    statement.rows.some(
      (r) => r.revenue !== null || r.gross_profit !== null || r.total_expenses !== null,
    );

  if (!hasRows) {
    return (
      <div
        className={`rounded-lg border p-4 text-center ${
          darkMode ? 'border-white/10 bg-white/3' : 'border-slate-100 bg-slate-50'
        }`}
        data-testid="fin-no-statement"
      >
        <p className={`text-sm ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
          Revenue statement not available in current materials.
        </p>
      </div>
    );
  }

  const periods = statement!.rows;

  return (
    <div data-testid="fin-revenue-table">
      <div className="overflow-x-auto rounded-lg border">
        <table className={`w-full text-xs ${
          darkMode ? 'border-white/10' : 'border-slate-200'
        }`}>
          <thead>
            <tr className={darkMode ? 'bg-white/5' : 'bg-slate-50'}>
              <th className={`text-left px-3 py-2 font-semibold ${
                darkMode ? 'text-zinc-400' : 'text-slate-500'
              }`}>
                Metric
              </th>
              {periods.map((r) => (
                <th key={r.period} className={`text-right px-3 py-2 font-semibold ${
                  darkMode ? 'text-zinc-400' : 'text-slate-500'
                }`}>
                  {r.period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['Revenue', 'Gross Profit', 'Total Expenses'].map((metric, mi) => {
              const key = mi === 0 ? 'revenue' : mi === 1 ? 'gross_profit' : 'total_expenses';
              return (
                <tr
                  key={metric}
                  className={`border-t ${
                    darkMode ? 'border-white/5' : 'border-slate-100'
                  }`}
                >
                  <td className={`px-3 py-2 font-medium ${
                    darkMode ? 'text-zinc-300' : 'text-slate-600'
                  }`}>
                    {metric}
                  </td>
                  {periods.map((r) => {
                    const val = (r as Record<string, string | null>)[key];
                    return (
                      <td key={r.period} className={`px-3 py-2 text-right tabular-nums ${
                        val
                          ? (darkMode ? 'text-zinc-100' : 'text-slate-800')
                          : (darkMode ? 'text-zinc-600 italic' : 'text-slate-400 italic')
                      }`}>
                        {val ?? 'TBD'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {statement!.gross_margin && (
        <p className={`mt-2 text-xs ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
          Gross margin: <span className={`font-medium ${darkMode ? 'text-zinc-200' : 'text-slate-700'}`}>
            {statement!.gross_margin}
          </span>
          {statement!.revenue_yoy_growth && (
            <> · Growth: <span className={`font-medium ${darkMode ? 'text-zinc-200' : 'text-slate-700'}`}>
              {statement!.revenue_yoy_growth}
            </span></>
          )}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Highlights (2-column)
// ─────────────────────────────────────────────────────────────────────────────

function HighlightsGrid({
  strengths,
  considerations,
  darkMode,
}: {
  strengths: string[];
  considerations: string[];
  darkMode: boolean;
}) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      data-testid="fin-highlights-grid"
    >
      {/* Strengths */}
      <div
        className={`rounded-lg border p-4 ${
          darkMode ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-100 bg-emerald-50/60'
        }`}
      >
        <p className={`text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${
          darkMode ? 'text-emerald-400' : 'text-emerald-700'
        }`}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          Strengths
        </p>
        <ul className="space-y-2">
          {strengths.length > 0 ? strengths.map((s, i) => (
            <li
              key={i}
              className={`text-xs leading-relaxed flex items-start gap-1.5 ${
                darkMode ? 'text-zinc-300' : 'text-slate-700'
              }`}
              data-testid="fin-strength-item"
            >
              <span className={`mt-0.5 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`}>•</span>
              {s}
            </li>
          )) : (
            <li className={`text-xs italic ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
              Insufficient data to identify strengths
            </li>
          )}
        </ul>
      </div>

      {/* Considerations */}
      <div
        className={`rounded-lg border p-4 ${
          darkMode ? 'border-amber-500/20 bg-amber-500/5' : 'border-amber-100 bg-amber-50/60'
        }`}
      >
        <p className={`text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${
          darkMode ? 'text-amber-400' : 'text-amber-700'
        }`}>
          <XCircle className="w-3.5 h-3.5" />
          Considerations
        </p>
        <ul className="space-y-2">
          {considerations.length > 0 ? considerations.map((c, i) => (
            <li
              key={i}
              className={`text-xs leading-relaxed flex items-start gap-1.5 ${
                darkMode ? 'text-zinc-300' : 'text-slate-700'
              }`}
              data-testid="fin-consideration-item"
            >
              <span className={`mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-500'}`}>•</span>
              {c}
            </li>
          )) : (
            <li className={`text-xs italic ${darkMode ? 'text-zinc-500' : 'text-slate-400'}`}>
              No considerations identified
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Governed narrative panel
// ─────────────────────────────────────────────────────────────────────────────

function NarrativePanel({
  status,
  narrative,
  error,
  onRefresh,
  darkMode,
}: {
  status: string;
  narrative: import('../../../lib/apiClient').FinancialNarrativeResult | null;
  error: string | null;
  onRefresh: () => void;
  darkMode: boolean;
}) {
  const headerClass = `text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-3 ${
    darkMode ? 'text-indigo-400' : 'text-indigo-600'
  }`;
  const panelClass = `rounded-xl border p-4 ${
    darkMode ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-50/60 border-indigo-100'
  }`;

  if (status === 'loading') {
    return (
      <div className={panelClass} data-testid="fin-narrative-loading">
        <p className={headerClass}><Sparkles className="w-3.5 h-3.5" /> Financial Analysis Summary</p>
        <div className="space-y-2 animate-pulse">
          {[80, 60, 70].map((w) => (
            <div key={w} className={`h-3 rounded ${darkMode ? 'bg-white/10' : 'bg-indigo-100'}`}
              style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={panelClass} data-testid="fin-narrative-error">
        <p className={headerClass}><Sparkles className="w-3.5 h-3.5" /> Financial Analysis Summary</p>
        <div className={`flex items-start gap-2 text-xs rounded-lg border p-3 mb-3 ${
          darkMode ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error ?? 'Narrative synthesis failed.'}</span>
        </div>
        <button
          onClick={onRefresh}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/15 text-zinc-300 hover:bg-white/5'
              : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
          data-testid="fin-narrative-retry-btn"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (status === 'ready' && narrative) {
    return (
      <div className={panelClass} data-testid="fin-narrative-panel">
        <div className="flex items-center justify-between mb-3">
          <p className={headerClass}><Sparkles className="w-3.5 h-3.5" /> Financial Analysis Summary</p>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              darkMode
                ? 'bg-indigo-500/20 text-indigo-300'
                : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}>
              AI Governed
            </span>
            <button
              onClick={onRefresh}
              title="Regenerate narrative"
              className={`p-1 rounded transition-colors ${
                darkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-600'
              }`}
              data-testid="fin-narrative-refresh-btn"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Summary paragraphs */}
        <div className="space-y-2 mb-4">
          {narrative.summary_paragraphs.map((p, i) => (
            <p key={i} className={`text-sm leading-relaxed ${
              darkMode ? 'text-zinc-100' : 'text-slate-700'
            }`} data-testid="fin-narrative-paragraph">
              {p}
            </p>
          ))}
        </div>

        {/* Strengths + Considerations from AI */}
        {narrative.strengths.length > 0 || narrative.considerations.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-current/10">
            {narrative.strengths.length > 0 && (
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  darkMode ? 'text-emerald-400' : 'text-emerald-600'
                }`}>
                  Strengths
                </p>
                <ul className="space-y-1">
                  {narrative.strengths.map((s, i) => (
                    <li key={i} className={`text-xs leading-relaxed ${
                      darkMode ? 'text-zinc-300' : 'text-slate-600'
                    }`} data-testid="fin-ai-strength">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {narrative.considerations.length > 0 && (
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  darkMode ? 'text-amber-400' : 'text-amber-600'
                }`}>
                  Considerations
                </p>
                <ul className="space-y-1">
                  {narrative.considerations.map((c, i) => (
                    <li key={i} className={`text-xs leading-relaxed ${
                      darkMode ? 'text-zinc-300' : 'text-slate-600'
                    }`} data-testid="fin-ai-consideration">
                      • {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // idle — narrative not yet requested or no dealId
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function FinancialSkeleton({ darkMode }: { darkMode: boolean }) {
  const base = darkMode ? 'bg-white/8' : 'bg-slate-200';
  return (
    <div className="space-y-6 animate-pulse" data-testid="fin-loading-skeleton">
      <div className={`h-24 rounded-xl ${base}`} />
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className={`h-16 rounded-lg ${base}`} />
        ))}
      </div>
      <div className={`h-32 rounded-lg ${base}`} />
      <div className="grid grid-cols-2 gap-4">
        <div className={`h-28 rounded-lg ${base}`} />
        <div className={`h-28 rounded-lg ${base}`} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// No-data fallback
// ─────────────────────────────────────────────────────────────────────────────

function NoDataFallback({ darkMode }: { darkMode: boolean }) {
  return (
    <div
      className={`rounded-lg border p-6 text-center ${
        darkMode ? 'border-white/10 bg-white/3' : 'border-slate-100 bg-slate-50'
      }`}
      data-testid="fin-no-data"
    >
      <BarChart3 className={`w-8 h-8 mx-auto mb-3 ${darkMode ? 'text-zinc-600' : 'text-slate-300'}`} />
      <p className={`text-sm font-medium ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
        No financial signals found
      </p>
      <p className={`text-xs mt-1 ${darkMode ? 'text-zinc-600' : 'text-slate-400'}`}>
        Financial sections are not yet available in this report.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation sections sub-component
// ─────────────────────────────────────────────────────────────────────────────

function FinancialContent({
  score,
  scoreLabel,
  sections,
  strengths,
  considerations,
  narrativeStatus,
  narrative,
  narrativeError,
  onRefreshNarrative,
  darkMode,
}: {
  score: number;
  scoreLabel: string;
  sections: FinancialSections;
  strengths: string[];
  considerations: string[];
  narrativeStatus: string;
  narrative: import('../../../lib/apiClient').FinancialNarrativeResult | null;
  narrativeError: string | null;
  onRefreshNarrative: () => void;
  darkMode: boolean;
}) {
  const { healthMetrics, statement, impliedAllocation } = sections;
  const isImpliedOnly = impliedAllocation !== null && statement === null;

  return (
    <div className="space-y-6" data-testid="fin-analysis-card">
      {/* Sub-header */}
      <div>
        <p className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
          Revenue projections, unit economics, and financial health
          {isImpliedOnly && (
            <span className={`ml-2 font-medium px-1.5 py-0.5 rounded text-xs ${
              darkMode ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'
            }`}>
              Implied (budget model)
            </span>
          )}
        </p>
      </div>

      {/* A. Score panel */}
      <ScorePanel score={score} label={scoreLabel} darkMode={darkMode} />

      {/* C. Current Financial Metrics tiles */}
      <CurrentMetricsGrid
        healthMetrics={healthMetrics}
        impliedAllocation={impliedAllocation}
        darkMode={darkMode}
      />

      {/* D. Revenue Projections table */}
      <div>
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Revenue Projections
        </h4>
        <RevenueTable statement={statement} darkMode={darkMode} />
      </div>

      {/* E. Unit Economics (gross margin from health or statement) */}
      <div data-testid="fin-unit-economics">
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Unit Economics
        </h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricTile
            label="Gross Margin"
            value={
              healthMetrics?.gross_margin_pct ??
              statement?.gross_margin ??
              null
            }
            darkMode={darkMode}
          />
          <MetricTile label="LTV" value={null} darkMode={darkMode} />
          <MetricTile label="CAC" value={null} darkMode={darkMode} />
          <MetricTile label="LTV : CAC" value={null} darkMode={darkMode} />
        </div>
      </div>

      {/* F. Key Financial Highlights */}
      <div>
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-zinc-400' : 'text-slate-500'
        }`}>
          Key Financial Highlights
        </h4>
        <HighlightsGrid
          strengths={strengths}
          considerations={considerations}
          darkMode={darkMode}
        />
      </div>

      {/* G. AI Governed narrative */}
      {narrativeStatus !== 'idle' && (
        <NarrativePanel
          status={narrativeStatus}
          narrative={narrative}
          error={narrativeError}
          onRefresh={onRefreshNarrative}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FinancialAnalysisSection
 *
 * Renders inside InvestorReportView's "Financial Analysis & Benchmarks"
 * ReportSection.  Always embedded (the outer heading is provided by ReportSection).
 *
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
export function FinancialAnalysisSection({
  dealId,
  report,
  darkMode = false,
  dealName,
}: FinancialAnalysisSectionProps) {
  const {
    hasData,
    sections,
    score,
    scoreLabel,
    strengths,
    considerations,
    narrativeStatus,
    narrative,
    narrativeError,
    refreshNarrative,
  } = useFinancialAnalysis(dealId, report, dealName);

  // When report hasn't arrived yet, show skeleton
  if (report === null) {
    return <FinancialSkeleton darkMode={darkMode} />;
  }

  // No financial sections in this report
  if (!hasData) {
    return <NoDataFallback darkMode={darkMode} />;
  }

  return (
    <FinancialContent
      score={score}
      scoreLabel={scoreLabel}
      sections={sections}
      strengths={strengths}
      considerations={considerations}
      narrativeStatus={narrativeStatus}
      narrative={narrative}
      narrativeError={narrativeError}
      onRefreshNarrative={refreshNarrative}
      darkMode={darkMode}
    />
  );
}
