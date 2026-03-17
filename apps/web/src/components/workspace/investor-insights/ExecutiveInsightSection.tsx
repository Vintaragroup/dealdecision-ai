/**
 * ExecutiveInsightSection — Top summary panel shown in all view modes.
 *
 * Displays:
 *  - Investment summary text
 *  - Key insight highlight card
 *  - Recommendation badge
 *  - Top strengths / top risks grid
 */

import { CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import type { ExecutiveSummaryData, DealSignalsData } from '../../../types/investor-insights';
import { RECOMMENDATION_COLORS, RECOMMENDATION_LABELS } from '../../../types/investor-insights';

interface ExecutiveInsightSectionProps {
  darkMode: boolean;
  data: ExecutiveSummaryData;
  signals: DealSignalsData;
}

export function ExecutiveInsightSection({ darkMode, data, signals }: ExecutiveInsightSectionProps) {
  const recColor = signals.recommendation
    ? RECOMMENDATION_COLORS[signals.recommendation]
    : '#6366f1';
  const recLabel = signals.recommendation
    ? RECOMMENDATION_LABELS[signals.recommendation]
    : 'Analyzing';

  return (
    <div
      className={`p-8 rounded-xl border backdrop-blur-xl ${
        darkMode
          ? 'bg-gradient-to-br from-[#6366f1]/10 via-[#8b5cf6]/10 to-transparent border-[#6366f1]/30'
          : 'bg-gradient-to-br from-[#6366f1]/5 via-[#8b5cf6]/5 to-white border-[#6366f1]/20'
      }`}
    >
      {/* Header row: title + recommendation badge */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className={`text-xl font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Investment Summary
          </h2>
          {data.investment_summary ? (
            <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {data.investment_summary}
            </p>
          ) : (
            <p className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              No summary available yet.
            </p>
          )}
        </div>

        {/* Score chip + Recommendation pill */}
        <div className="flex-shrink-0 flex items-center gap-3">
          {signals.overall_score !== null && (
            <div className="flex flex-col items-center">
              <span
                className={`text-lg font-bold tabular-nums leading-none ${
                  signals.overall_score >= 70 ? 'text-green-500' :
                  signals.overall_score >= 45 ? 'text-yellow-500' : 'text-red-400'
                }`}
                title="Investor Insights Score"
              >
                {signals.overall_score}
              </span>
              <span className={`text-xs leading-none mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                / 100
              </span>
            </div>
          )}
          <div
            className="px-4 py-2 rounded-full text-sm font-semibold text-white shadow"
            style={{ backgroundColor: recColor }}
          >
            {recLabel}
          </div>
        </div>
      </div>

      {/* Key Insight Highlight */}
      {data.key_insight && (
        <div
          className={`p-5 rounded-lg mb-6 ${
            darkMode
              ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 border border-[#6366f1]/40'
              : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border border-[#6366f1]/30'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex-shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className={`text-xs font-medium uppercase tracking-wide mb-1 ${
                darkMode ? 'text-[#a5b4fc]' : 'text-[#6366f1]'
              }`}>
                Key Insight
              </p>
              <p className={`text-sm font-medium leading-relaxed ${
                darkMode ? 'text-white' : 'text-gray-900'
              }`}>
                {data.key_insight}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Strengths + Risks grid */}
      {(data.top_strengths.length > 0 || data.top_risks.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Strengths */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Key Strengths
              </span>
            </div>
            <ul className="space-y-2">
              {data.top_strengths.length > 0 ? (
                data.top_strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{s}</span>
                  </li>
                ))
              ) : (
                <li className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  None identified
                </li>
              )}
            </ul>
          </div>

          {/* Risks */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Key Risks
              </span>
            </div>
            <ul className="space-y-2">
              {data.top_risks.length > 0 ? (
                data.top_risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{r}</span>
                  </li>
                ))
              ) : (
                <li className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  None identified
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Investment thesis */}
      {data.investment_thesis && (
        <div
          className={`mt-6 pt-5 border-t text-sm ${
            darkMode ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
          }`}
        >
          <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Thesis: </span>
          {data.investment_thesis}
        </div>
      )}
    </div>
  );
}
