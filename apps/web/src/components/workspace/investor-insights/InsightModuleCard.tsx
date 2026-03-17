/**
 * InsightModuleCard — Card for a single analysis module.
 *
 * Two variants:
 *  - compact: used in QuickInsightCards grid (summary + score only)
 *  - expanded: used in InsightModules list (full details + evidence)
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { InsightModuleData, EvidenceItem } from '../../../types/investor-insights';
import { EvidencePanel } from './EvidencePanel';

interface InsightModuleCardProps {
  darkMode: boolean;
  module: InsightModuleData;
  variant?: 'compact' | 'expanded';
  evidence?: EvidenceItem[] | null;
}

function ScoreBar({ score, darkMode }: { score: number | null; darkMode: boolean }) {
  const pct = score !== null ? Math.min(100, Math.max(0, score)) : 0;
  const color =
    score === null
      ? darkMode ? 'bg-white/10' : 'bg-gray-200'
      : pct >= 70 ? 'bg-green-500' : pct >= 45 ? 'bg-yellow-500' : 'bg-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 h-1.5 rounded-full ${darkMode ? 'bg-white/10' : 'bg-gray-100'}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`text-xs font-medium w-7 text-right ${
          darkMode ? 'text-gray-300' : 'text-gray-600'
        }`}
      >
        {score !== null ? pct : '—'}
      </span>
    </div>
  );
}

export function InsightModuleCard({
  darkMode,
  module,
  variant = 'expanded',
  evidence,
}: InsightModuleCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  if (variant === 'compact') {
    return (
      <div
        className={`p-5 rounded-xl border backdrop-blur-xl ${
          darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h4 className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {module.title}
          </h4>
          {module.score !== null && (
            <span
              className={`text-lg font-bold ${
                module.score >= 70
                  ? 'text-green-500'
                  : module.score >= 45
                  ? 'text-yellow-500'
                  : 'text-red-400'
              }`}
            >
              {module.score}
            </span>
          )}
        </div>
        <p className={`text-xs leading-relaxed mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {module.summary}
        </p>
        <ScoreBar score={module.score} darkMode={darkMode} />
      </div>
    );
  }

  // Expanded variant
  return (
    <div
      className={`rounded-xl border backdrop-blur-xl ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setDetailOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-4 p-5 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {module.title}
            </h4>
          </div>
          <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {module.key_insight || module.summary}
          </p>
          <div className="mt-3">
            <ScoreBar score={module.score} darkMode={darkMode} />
          </div>
        </div>
        <div className="flex-shrink-0 mt-0.5">
          {detailOpen ? (
            <ChevronDown className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
          ) : (
            <ChevronRight className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
          )}
        </div>
      </button>

      {/* Expanded body */}
      {detailOpen && (
        <div className={`px-5 pb-5 border-t ${darkMode ? 'border-white/10' : 'border-gray-100'}`}>
          {/* Summary if different from key_insight */}
          {module.summary && module.summary !== module.key_insight && (
            <p className={`mt-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {module.summary}
            </p>
          )}

          {/* Strengths */}
          {module.strengths.length > 0 && (
            <div className="mt-4">
              <p className={`text-xs font-medium uppercase tracking-wide mb-2 ${
                darkMode ? 'text-green-400' : 'text-green-600'
              }`}>
                Strengths
              </p>
              <ul className="space-y-1.5">
                {module.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {module.risks.length > 0 && (
            <div className="mt-4">
              <p className={`text-xs font-medium uppercase tracking-wide mb-2 ${
                darkMode ? 'text-amber-400' : 'text-amber-600'
              }`}>
                Risks
              </p>
              <ul className="space-y-1.5">
                {module.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Deeper analysis */}
          {module.deeper_analysis && (
            <div className="mt-4">
              <p className={`text-xs font-medium uppercase tracking-wide mb-2 ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Analysis
              </p>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {module.deeper_analysis}
              </p>
            </div>
          )}

          {/* Evidence citations */}
          <EvidencePanel darkMode={darkMode} evidence={evidence} />
        </div>
      )}
    </div>
  );
}
