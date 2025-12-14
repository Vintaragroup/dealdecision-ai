import { Award } from 'lucide-react';

interface MetricItem {
  dealName: string;
  value: number;
  label?: string;
  isWinner?: boolean;
}

interface MetricComparisonProps {
  title: string;
  metrics: MetricItem[];
  darkMode: boolean;
  maxValue?: number;
  showWinner?: boolean;
  unit?: string;
}

export function MetricComparison({ 
  title, 
  metrics, 
  darkMode, 
  maxValue = 100,
  showWinner = true,
  unit = ''
}: MetricComparisonProps) {
  const highestValue = Math.max(...metrics.map(m => m.value));
  
  return (
    <div className="space-y-3">
      <h4 className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        {title}
      </h4>
      
      <div className="space-y-3">
        {metrics.map((metric, index) => {
          const percentage = (metric.value / maxValue) * 100;
          const isHighest = showWinner && metric.value === highestValue;
          
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    {metric.dealName}
                  </span>
                  {isHighest && (
                    <Award className="w-3 h-3 text-[#6366f1]" />
                  )}
                </div>
                <span className={`${
                  isHighest 
                    ? 'text-[#6366f1] font-medium'
                    : darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {metric.label || `${metric.value}${unit}`}
                </span>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${
                darkMode ? 'bg-white/10' : 'bg-gray-200'
              }`}>
                <div
                  className={`h-full transition-all duration-500 ${
                    isHighest
                      ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                      : darkMode 
                        ? 'bg-gray-600'
                        : 'bg-gray-400'
                  }`}
                  style={{ width: `${percentage}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
