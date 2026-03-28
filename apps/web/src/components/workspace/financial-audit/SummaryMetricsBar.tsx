import { AlertTriangle } from 'lucide-react';
import { SummaryMetricsBarProps } from '../../../types/financialAudit';
import { getCompletenessColor } from '../../../utils/financialAuditHelpers';

interface Props extends SummaryMetricsBarProps {
  darkMode?: boolean;
}

export function SummaryMetricsBar({
  completeness,
  criticalMetrics,
  conflicts,
  extractedFactsCount,
  validatedFactsCount,
  darkMode = true
}: Props) {
  return (
    <div className={`sm:sticky sm:top-0 z-10 p-4 sm:p-6 rounded-xl border backdrop-blur-lg ${
      darkMode 
        ? 'bg-[#0B0F14]/95 border-white/10' 
        : 'bg-white/95 border-gray-200'
    }`}>
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
        {/* Completeness Score */}
        <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
          <div className={`text-xs mb-1.5 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Completeness
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-bold ${getCompletenessColor(completeness, darkMode)}`}>
              {completeness}
            </span>
            <span className={`text-base ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>/ 100</span>
          </div>
        </div>

        {/* Critical Metrics */}
        <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
          <div className={`text-xs mb-1.5 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Critical Metrics
          </div>
          <div className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {criticalMetrics}
          </div>
        </div>

        {/* Conflicts */}
        <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
          <div className={`text-xs mb-1.5 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Conflicts
          </div>
          <div className={`text-sm font-bold flex items-center gap-1.5 ${
            conflicts > 0 
              ? (darkMode ? 'text-amber-400' : 'text-amber-600')
              : (darkMode ? 'text-emerald-400' : 'text-emerald-600')
          }`}>
            {conflicts > 0 && <AlertTriangle className="w-4 h-4" />}
            {conflicts} <span className="font-normal">conflicts</span>
          </div>
        </div>

        {/* Surfaced Facts */}
        <div className={`p-3 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
          <div className={`text-xs mb-1.5 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Surfaced Facts
          </div>
          <div className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {extractedFactsCount != null
              ? <>{extractedFactsCount} <span className="font-normal">facts</span></>
              : <span className={`font-normal ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>—</span>
            }
          </div>
        </div>

        {/* Validated Facts */}
        <div className={`p-3 rounded-lg border col-span-2 xl:col-span-1 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
          <div className={`text-xs mb-1.5 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Validated Facts
          </div>
          <div className={`text-sm font-bold ${
            validatedFactsCount != null && validatedFactsCount > 0
              ? (darkMode ? 'text-emerald-400' : 'text-emerald-600')
              : (darkMode ? 'text-gray-500' : 'text-gray-400')
          }`}>
            {validatedFactsCount != null
              ? <>{validatedFactsCount} <span className="font-normal">passed</span></>
              : <span className="font-normal">—</span>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
