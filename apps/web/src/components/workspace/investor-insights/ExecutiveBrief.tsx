/**
 * ExecutiveBrief — Condensed single-page executive summary view.
 *
 * Uses ScoreCard and CircularScore to display the overall score and
 * per-module breakdown. Intended for the "executive" view mode.
 */

import { CircularScore } from './CircularScore';
import { ScoreCard } from './ScoreCard';
import { CriticalMetricsTable } from './CriticalMetricsTable';
import type { InvestorInsightsData, ModuleId } from '../../../types/investor-insights';
import { RECOMMENDATION_LABELS, RECOMMENDATION_COLORS, MODULE_TITLES } from '../../../types/investor-insights';

interface ExecutiveBriefProps {
  darkMode: boolean;
  data: InvestorInsightsData;
}

const SCORED_MODULES: ModuleId[] = [
  'investment_thesis',
  'market_opportunity',
  'traction_growth',
  'financial_outlook',
];

export function ExecutiveBrief({ darkMode, data }: ExecutiveBriefProps) {
  const { deal_signals, executive_summary, analysis_modules, deal_metadata } = data;

  const recColor = deal_signals.recommendation
    ? RECOMMENDATION_COLORS[deal_signals.recommendation]
    : '#6366f1';
  const recLabel = deal_signals.recommendation
    ? RECOMMENDATION_LABELS[deal_signals.recommendation]
    : 'Analyzing';

  return (
    <div className="space-y-6">
      {/* Overall header card */}
      <div
        className={`p-8 rounded-xl border backdrop-blur-xl ${
          darkMode
            ? 'bg-gradient-to-br from-[#6366f1]/10 via-[#8b5cf6]/10 to-transparent border-[#6366f1]/30'
            : 'bg-gradient-to-br from-[#6366f1]/5 via-[#8b5cf6]/5 to-white border-[#6366f1]/20'
        }`}
      >
        <div className="flex items-start gap-6">
          {/* Circular overall score */}
          <div className="relative flex-shrink-0">
            <CircularScore
              score={deal_signals.overall_score}
              size={96}
              strokeWidth={8}
              darkMode={darkMode}
              label="Overall"
            />
          </div>

          <div className="flex-1 min-w-0">
            {/* Company + recommendation */}
            <div className="flex items-center gap-3 mb-2">
              <h2 className={`text-xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {deal_metadata.company_name}
              </h2>
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: recColor }}
              >
                {recLabel}
              </span>
            </div>

            {/* Executive summary */}
            {executive_summary.investment_summary ? (
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {executive_summary.investment_summary}
              </p>
            ) : (
              <p className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                No summary available.
              </p>
            )}
          </div>
        </div>

        {/* Investment thesis */}
        {executive_summary.investment_thesis && (
          <div
            className={`mt-5 pt-5 border-t ${
              darkMode ? 'border-white/10' : 'border-[#6366f1]/20'
            }`}
          >
            <p className={`text-xs font-medium uppercase tracking-wide mb-1.5 ${
              darkMode ? 'text-[#a5b4fc]' : 'text-[#6366f1]'
            }`}>
              Investment Thesis
            </p>
            <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {executive_summary.investment_thesis}
            </p>
          </div>
        )}
      </div>

      {/* Module score cards */}
      <div>
        <h3 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${
          darkMode ? 'text-gray-400' : 'text-gray-500'
        }`}>
          Module Overview
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SCORED_MODULES.map((id) => {
            const mod = analysis_modules[id];
            return (
              <ScoreCard
                key={id}
                darkMode={darkMode}
                label={MODULE_TITLES[id]}
                score={mod?.score ?? null}
              />
            );
          })}
        </div>
      </div>

      {/* Strengths + risks summary */}
      {(executive_summary.top_strengths.length > 0 || executive_summary.top_risks.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Top strengths */}
          <div
            className={`p-5 rounded-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
            }`}
          >
            <h4 className={`text-sm font-semibold mb-3 text-green-500`}>Top Strengths</h4>
            <ul className="space-y-2">
              {executive_summary.top_strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                  <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Top risks */}
          <div
            className={`p-5 rounded-xl border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
            }`}
          >
            <h4 className={`text-sm font-semibold mb-3 text-amber-500`}>Key Risks</h4>
            <ul className="space-y-2">
              {executive_summary.top_risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                  <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Critical metrics table */}
      <CriticalMetricsTable darkMode={darkMode} metrics={data.critical_metrics} />
    </div>
  );
}
