import { CheckCircle, AlertTriangle, XCircle, AlertCircle } from 'lucide-react';
import { InvestorActionPanelProps } from '../../../types/financialAudit';
import { getStatusColor, getCardBackground } from '../../../utils/financialAuditHelpers';

interface Props extends InvestorActionPanelProps {
  darkMode?: boolean;
}

export function InvestorActionPanel({
  status,
  visibleStatusLabel,
  criticalActions,
  validationActions,
  strengths,
  darkMode = true
}: Props) {
  return (
    <div className={`p-6 rounded-xl border ${getCardBackground(darkMode)}`}>
      <div className="flex flex-col lg:flex-row items-start gap-6">
        {/* Left: Status Badge */}
        <div className="flex-shrink-0 w-full lg:w-auto">
          <div className={`px-6 py-3 rounded-xl border font-bold text-base ${getStatusColor(status, darkMode)}`}>
            {status === 'WARNING' && <AlertTriangle className="w-5 h-5 inline mr-2" />}
            {status === 'PARTIAL' && <AlertCircle className="w-5 h-5 inline mr-2" />}
            {status === 'READY' && <CheckCircle className="w-5 h-5 inline mr-2" />}
            {visibleStatusLabel}
          </div>
        </div>

        {/* Right: Action Sections */}
        <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          
          {/* Resolve Before Investment */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <XCircle className={`w-4 h-4 ${darkMode ? 'text-red-400' : 'text-red-600'}`} />
              <h3 className={`text-sm font-medium uppercase tracking-wide ${
                darkMode ? 'text-red-400' : 'text-red-600'
              }`}>
                Resolve Before Investment
              </h3>
            </div>
            <div className="space-y-2">
              {criticalActions.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 text-xs ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    darkMode ? 'bg-red-400' : 'bg-red-600'
                  }`} />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Validate Before IC */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
              <h3 className={`text-sm font-medium uppercase tracking-wide ${
                darkMode ? 'text-amber-400' : 'text-amber-600'
              }`}>
                Validate Before IC
              </h3>
            </div>
            <div className="space-y-2">
              {validationActions.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 text-xs ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    darkMode ? 'bg-amber-400' : 'bg-amber-600'
                  }`} />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Strong Areas */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className={`w-4 h-4 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
              <h3 className={`text-sm font-medium uppercase tracking-wide ${
                darkMode ? 'text-emerald-400' : 'text-emerald-600'
              }`}>
                Strong Areas
              </h3>
            </div>
            <div className="space-y-2">
              {strengths.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 text-xs ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    darkMode ? 'bg-emerald-400' : 'bg-emerald-600'
                  }`} />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
