import { AlertTriangle } from 'lucide-react';
import { TimeProjectionAuditProps } from '../../../types/financialAudit';
import { getCardBackground, getWarningBackground } from '../../../utils/financialAuditHelpers';

interface Props extends TimeProjectionAuditProps {
  darkMode?: boolean;
}

export function TimeProjectionAudit({ items, darkMode = true }: Props) {
  return (
    <div className={`p-4 rounded-xl border ${getCardBackground(darkMode)}`}>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-lg border ${
              item.clarity === 'Warning' || item.clarity === 'Ambiguous'
                ? getWarningBackground(darkMode)
                : (darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200')
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {item.metric}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                item.type === 'projected'
                  ? (darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700')
                  : (darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700')
              }`}>
                {item.type}
              </span>
            </div>
            <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Period: {item.period}
            </div>
            {item.warning && (
              <div className={`flex items-start gap-1.5 mt-2 p-2 rounded ${
                darkMode ? 'bg-amber-500/10' : 'bg-amber-50'
              }`}>
                <AlertTriangle className={`w-3 h-3 mt-0.5 flex-shrink-0 ${
                  darkMode ? 'text-amber-400' : 'text-amber-600'
                }`} />
                <span className={`text-xs ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  {item.warning}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
