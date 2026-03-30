import { AlertTriangle } from 'lucide-react';

interface RiskCardProps {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence: string;
  darkMode?: boolean;
  mitigation?: string;
}

export function RiskCard({ type, severity, description, evidence, darkMode = true, mitigation }: RiskCardProps) {
  const severityStyles = {
    low: {
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      text: 'text-emerald-400',
      badge: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30',
    },
    medium: {
      bg: 'bg-amber-500/10 border-amber-500/30',
      text: 'text-amber-400',
      badge: 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30',
    },
    high: {
      bg: 'bg-red-500/10 border-red-500/30',
      text: 'text-red-400',
      badge: 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30',
    },
  };

  const style = severityStyles[severity];

  return (
    <div className={`${style.bg} border rounded-lg p-4 ${darkMode ? '' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-4 h-4 ${style.text}`} />
          <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>{type}</h4>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs uppercase ${style.badge}`}>
          {severity}
        </span>
      </div>
      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{description}</p>
      <div className="mb-2">
        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Evidence: </span>
        <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{evidence}</span>
      </div>
      {mitigation && (
        <div>
          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Mitigation: </span>
          <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{mitigation}</span>
        </div>
      )}
    </div>
  );
}
