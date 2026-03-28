import { UnderwritingReadinessProps } from '../../../types/financialAudit';
import { getCardBackground, getCompletenessColor } from '../../../utils/financialAuditHelpers';

interface Props extends UnderwritingReadinessProps {
  darkMode?: boolean;
}

export function UnderwritingReadiness({
  score,
  status,
  visibleStatusLabel,
  isProvisional,
  missingMetrics,
  weakAreas,
  summary,
  darkMode = true
}: Props) {
  return (
    <div className={`p-6 rounded-xl border ${getCardBackground(darkMode)}`}>
      <div className="flex flex-col sm:flex-row items-start gap-6">
        {/* Score Circle */}
        <div className="flex-shrink-0 text-center w-full sm:w-auto">
          <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center ${
            score >= 80
              ? (darkMode ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-emerald-300 bg-emerald-50')
              : score >= 50
              ? (darkMode ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-300 bg-amber-50')
              : (darkMode ? 'border-red-500/30 bg-red-500/10' : 'border-red-300 bg-red-50')
          }`}>
            <div className={`text-4xl font-bold ${getCompletenessColor(score, darkMode)}`}>
              {score}
            </div>
          </div>
          {/* Visible status label — uses canonical label, never raw status enum */}
          <div className={`mt-3 text-sm font-medium leading-tight ${
            status === 'READY' && !isProvisional
              ? (darkMode ? 'text-emerald-400' : 'text-emerald-600')
              : status === 'PARTIAL'
              ? (darkMode ? 'text-amber-400' : 'text-amber-600')
              : (darkMode ? 'text-red-400' : 'text-red-600')
          }`}>
            {visibleStatusLabel}
          </div>
          {isProvisional && (
            <div className={`mt-1 text-xs leading-tight ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Score provisional until validation completes
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 space-y-4">
          {/* Missing Metrics - Tag Pills */}
          {missingMetrics.length > 0 && (
            <div>
              <h3 className={`text-xs uppercase tracking-wide mb-2 font-medium ${
                darkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>
                Missing Critical Metrics
              </h3>
              <div className="flex flex-wrap gap-2">
                {missingMetrics.map((metric, idx) => (
                  <span
                    key={idx}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      darkMode ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {metric}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Weak Areas - Bullet List */}
          {weakAreas.length > 0 && (
            <div>
              <h3 className={`text-xs uppercase tracking-wide mb-2 font-medium ${
                darkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>
                Weak Evidence Areas
              </h3>
              <ul className="space-y-1">
                {weakAreas.map((area, idx) => (
                  <li
                    key={idx}
                    className={`text-xs flex items-center gap-2 ${
                      darkMode ? 'text-amber-400' : 'text-amber-600'
                    }`}
                  >
                    <div className="w-1 h-1 rounded-full bg-current" />
                    {area}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary - Decision Language */}
          <div>
            <h3 className={`text-xs uppercase tracking-wide mb-2 font-medium ${
              darkMode ? 'text-gray-500' : 'text-gray-600'
            }`}>
              Investment Decision Summary
            </h3>
            <p className={`text-sm leading-relaxed font-medium ${
              darkMode ? 'text-white' : 'text-gray-900'
            }`}>
              {summary}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
