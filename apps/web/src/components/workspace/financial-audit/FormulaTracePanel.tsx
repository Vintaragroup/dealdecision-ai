import { FormulaTracePanelProps } from '../../../types/financialAudit';
import { getCardBackground, getConfidenceColor } from '../../../utils/financialAuditHelpers';

interface Props extends FormulaTracePanelProps {
  darkMode?: boolean;
}

export function FormulaTracePanel({ traces, darkMode = true }: Props) {
  return (
    <div className={`p-4 rounded-xl border ${getCardBackground(darkMode)}`}>
      <div className="space-y-3">
        {traces.map((formula, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-lg border ${
              formula.circular 
                ? (darkMode ? 'bg-red-500/5 border-red-500/30' : 'bg-red-50 border-red-200')
                : formula.depth >= 3
                ? (darkMode ? 'bg-amber-500/5 border-amber-500/30' : 'bg-amber-50 border-amber-200')
                : (darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200')
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {formula.metric}
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${
                  darkMode ? 'text-gray-500' : 'text-gray-600'
                }`}>
                  Depth: {formula.depth}
                </span>
                {formula.circular && (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    darkMode ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-red-100 text-red-700 border border-red-200'
                  }`}>
                    Circular Ref
                  </span>
                )}
                {formula.depth >= 3 && !formula.circular && (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                  }`}>
                    Deep Chain
                  </span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded ${getConfidenceColor(formula.confidence, darkMode)} ${
                  formula.confidence === 'High' ? (darkMode ? 'bg-emerald-500/20' : 'bg-emerald-100') :
                  formula.confidence === 'Medium' ? (darkMode ? 'bg-amber-500/20' : 'bg-amber-100') :
                  (darkMode ? 'bg-red-500/20' : 'bg-red-100')
                }`}>
                  {formula.confidence}
                </span>
              </div>
            </div>
            <div className={`px-3 py-2 rounded font-mono text-xs ${
              darkMode ? 'bg-black/30 text-emerald-400' : 'bg-gray-900 text-emerald-400'
            }`}>
              {formula.formula}
            </div>
            <div className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              Sheets: {formula.sheets.join(', ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
