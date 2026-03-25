import { XCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { RiskFlagsPanelProps } from '../../../types/financialAudit';
import { getCardBackground } from '../../../utils/financialAuditHelpers';

interface Props extends RiskFlagsPanelProps {
  darkMode?: boolean;
}

export function RiskFlagsPanel({ critical, validation, dataQuality, darkMode = true }: Props) {
  return (
    <div className={`p-4 rounded-xl border ${getCardBackground(darkMode)}`}>
      {/* Critical Risks */}
      {critical.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className={`w-4 h-4 ${darkMode ? 'text-red-400' : 'text-red-600'}`} />
            <h3 className={`text-xs font-medium uppercase tracking-wide ${
              darkMode ? 'text-red-400' : 'text-red-600'
            }`}>
              Critical Risks
            </h3>
          </div>
          <div className="space-y-2">
            {critical.map((flag, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg ${
                  darkMode ? 'bg-red-500/10' : 'bg-red-50'
                }`}
              >
                <div className={darkMode ? 'text-red-400' : 'text-red-600'}>
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className={`text-sm flex-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {flag.message}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
                }`}>
                  critical
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Validation Risks */}
      {validation.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
            <h3 className={`text-xs font-medium uppercase tracking-wide ${
              darkMode ? 'text-amber-400' : 'text-amber-600'
            }`}>
              Validation Risks
            </h3>
          </div>
          <div className="space-y-2">
            {validation.map((flag, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg ${
                  darkMode ? 'bg-amber-500/10' : 'bg-amber-50'
                }`}
              >
                <div className={darkMode ? 'text-amber-400' : 'text-amber-600'}>
                  <AlertCircle className="w-4 h-4" />
                </div>
                <span className={`text-sm flex-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {flag.message}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                }`}>
                  validation
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Quality Issues */}
      {dataQuality.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Info className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
            <h3 className={`text-xs font-medium uppercase tracking-wide ${
              darkMode ? 'text-blue-400' : 'text-blue-600'
            }`}>
              Data Quality Issues
            </h3>
          </div>
          <div className="space-y-2">
            {dataQuality.map((flag, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg ${
                  darkMode ? 'bg-blue-500/10' : 'bg-blue-50'
                }`}
              >
                <div className={darkMode ? 'text-blue-400' : 'text-blue-600'}>
                  <Info className="w-4 h-4" />
                </div>
                <span className={`text-sm flex-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {flag.message}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
                }`}>
                  info
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
