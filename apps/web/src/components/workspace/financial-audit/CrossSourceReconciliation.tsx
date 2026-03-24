import { AlertTriangle, Info } from 'lucide-react';
import { CrossSourceReconciliationProps } from '../../../types/financialAudit';
import { getConflictBackground, getImpactColor, getCardBackground } from '../../../utils/financialAuditHelpers';

interface Props extends CrossSourceReconciliationProps {
  darkMode?: boolean;
}

export function CrossSourceReconciliation({ conflicts, darkMode = true }: Props) {
  if (conflicts.length === 0) {
    return (
      <div className={`p-6 rounded-xl border text-center ${getCardBackground(darkMode)}`}>
        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          No cross-source conflicts detected
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {conflicts.map((conflict, idx) => (
        <div
          key={idx}
          className={`p-4 rounded-xl border ${getConflictBackground(darkMode)}`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${darkMode ? 'text-red-400' : 'text-red-600'}`} />
              <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {conflict.metric}
              </span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${
              darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
            }`}>
              {conflict.difference}
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div className={`p-3 rounded-lg border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
            }`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {conflict.sourceA.name}
              </div>
              <div className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {conflict.sourceA.value}
              </div>
            </div>
            
            <div className={`p-3 rounded-lg border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
            }`}>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {conflict.sourceB.name}
              </div>
              <div className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {conflict.sourceB.value}
              </div>
            </div>
          </div>

          {/* Impact Line */}
          <div className={`flex items-center gap-2 text-xs ${getImpactColor(conflict.impactSeverity, darkMode)}`}>
            <Info className="w-3 h-3" />
            <span className="font-medium">Impact:</span>
            <span>{conflict.impact}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
