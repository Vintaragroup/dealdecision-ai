import { TrendingUp, TrendingDown, Target, DollarSign, Users, Calendar } from 'lucide-react';

interface Metric {
  id?: string;
  label: string;
  value: string;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
  icon: 'target' | 'dollar' | 'users' | 'calendar';
}

interface PerformanceMetricsWidgetProps {
  darkMode: boolean;
  metrics: Metric[];
  title?: string;
}

export function PerformanceMetricsWidget({ 
  darkMode, 
  metrics,
  title = 'Performance Metrics'
}: PerformanceMetricsWidgetProps) {
  const getIcon = (iconType: string) => {
    const iconClass = `w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`;
    switch (iconType) {
      case 'target':
        return <Target className={iconClass} />;
      case 'dollar':
        return <DollarSign className={iconClass} />;
      case 'users':
        return <Users className={iconClass} />;
      case 'calendar':
        return <Calendar className={iconClass} />;
      default:
        return <Target className={iconClass} />;
    }
  };

  const getTrendColor = (trend?: string) => {
    if (!trend || trend === 'neutral') return '';
    return trend === 'up' 
      ? darkMode ? 'text-green-400' : 'text-green-600'
      : darkMode ? 'text-red-400' : 'text-red-600';
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <h3 className={`text-base mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div
            key={metric.id || metric.label}
            className={`p-3 rounded-lg border ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              {getIcon(metric.icon)}
              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {metric.label}
              </span>
            </div>
            
            <div className="flex items-end justify-between">
              <span className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {metric.value}
              </span>
              
              {metric.change !== undefined && metric.trend && (
                <div className={`flex items-center gap-1 text-xs ${getTrendColor(metric.trend)}`}>
                  {metric.trend === 'up' && <TrendingUp className="w-3 h-3" />}
                  {metric.trend === 'down' && <TrendingDown className="w-3 h-3" />}
                  <span>{metric.change > 0 ? '+' : ''}{metric.change}%</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
