import { DollarSign, Flame, Wallet, Clock, BarChart3 } from 'lucide-react';
import { FinancialSnapshotProps } from '../../../types/financialAudit';
import { getCardBackground, getConfidenceColor } from '../../../utils/financialAuditHelpers';

interface Props extends FinancialSnapshotProps {
  darkMode?: boolean;
}

export function FinancialSnapshot({ metrics, darkMode = true }: Props) {
  const getIcon = (label: string) => {
    switch (label) {
      case 'Revenue':
        return <DollarSign className="w-4 h-4" />;
      case 'Burn Rate':
        return <Flame className="w-4 h-4" />;
      case 'Cash':
        return <Wallet className="w-4 h-4" />;
      case 'Runway':
        return <Clock className="w-4 h-4" />;
      case 'Gross Margin':
        return <BarChart3 className="w-4 h-4" />;
      default:
        return <DollarSign className="w-4 h-4" />;
    }
  };

  const getColor = (label: string) => {
    switch (label) {
      case 'Revenue':
        return darkMode ? 'text-emerald-400' : 'text-emerald-600';
      case 'Burn Rate':
        return darkMode ? 'text-orange-400' : 'text-orange-600';
      case 'Cash':
        return darkMode ? 'text-blue-400' : 'text-blue-600';
      case 'Runway':
        return darkMode ? 'text-purple-400' : 'text-purple-600';
      case 'Gross Margin':
        return darkMode ? 'text-emerald-400' : 'text-emerald-600';
      default:
        return darkMode ? 'text-gray-400' : 'text-gray-600';
    }
  };

  return (
    <div className={`p-4 rounded-xl border ${getCardBackground(darkMode)}`}>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-lg border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
            } ${metric.label === 'Gross Margin' ? 'col-span-2' : ''}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={getColor(metric.label)}>
                {getIcon(metric.label)}
              </div>
              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {metric.label}
              </span>
            </div>
            <div className={`text-lg font-bold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {metric.value}
            </div>
            {metric.change && (
              <div className={`text-xs mb-2 ${
                metric.change.startsWith('+') 
                  ? (darkMode ? 'text-emerald-400' : 'text-emerald-600')
                  : metric.change.startsWith('-')
                  ? (darkMode ? 'text-red-400' : 'text-red-600')
                  : (darkMode ? 'text-amber-400' : 'text-amber-600')
              }`}>
                {metric.change}
              </div>
            )}
            {/* Trust Layer */}
            <div className={`text-xs pt-2 border-t ${
              darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-600'
            }`}>
              <span className={getConfidenceColor(metric.confidence, darkMode)}>
                {metric.confidence === 'High' ? '✓' : '⚠'} {metric.confidence}
              </span>
              <div className="mt-0.5 text-[10px]">
                {metric.confidenceReason}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
