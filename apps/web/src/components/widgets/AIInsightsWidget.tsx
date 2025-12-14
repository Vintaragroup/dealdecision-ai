import { Brain, AlertCircle, CheckCircle, Clock, TrendingUp } from 'lucide-react';

interface Insight {
  id: string;
  type: 'action' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  action?: string;
}

interface AIInsightsWidgetProps {
  darkMode: boolean;
  insights: Insight[];
  onActionClick?: (insightId: string) => void;
}

export function AIInsightsWidget({ darkMode, insights, onActionClick }: AIInsightsWidgetProps) {
  const getInsightIcon = (type: string) => {
    const iconClass = "w-4 h-4";
    switch (type) {
      case 'action':
        return <AlertCircle className={`${iconClass} text-blue-500`} />;
      case 'warning':
        return <AlertCircle className={`${iconClass} text-yellow-500`} />;
      case 'success':
        return <CheckCircle className={`${iconClass} text-green-500`} />;
      case 'info':
        return <TrendingUp className={`${iconClass} text-purple-500`} />;
      default:
        return <Clock className={`${iconClass} text-gray-500`} />;
    }
  };

  const getInsightColor = (type: string) => {
    switch (type) {
      case 'action':
        return darkMode ? 'border-blue-500/30 bg-blue-500/5' : 'border-blue-200 bg-blue-50';
      case 'warning':
        return darkMode ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-yellow-200 bg-yellow-50';
      case 'success':
        return darkMode ? 'border-green-500/30 bg-green-500/5' : 'border-green-200 bg-green-50';
      case 'info':
        return darkMode ? 'border-purple-500/30 bg-purple-500/5' : 'border-purple-200 bg-purple-50';
      default:
        return darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50';
    }
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            AI Insights
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Smart recommendations
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {insights.map((insight) => (
          <div
            key={insight.id}
            className={`p-3 rounded-lg border transition-all ${getInsightColor(insight.type)}`}
          >
            <div className="flex items-start gap-2 mb-2">
              {getInsightIcon(insight.type)}
              <div className="flex-1">
                <h4 className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {insight.title}
                </h4>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {insight.description}
                </p>
              </div>
            </div>
            {insight.action && (
              <button
                onClick={() => onActionClick?.(insight.id)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
                  darkMode
                    ? 'bg-white/10 hover:bg-white/20 text-white'
                    : 'bg-white hover:bg-gray-50 text-gray-900 border border-gray-200'
                }`}
              >
                {insight.action}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* AI Tips */}
      <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          💡 AI analyzed 47 deals and generated {insights.length} recommendations
        </div>
      </div>
    </div>
  );
}
