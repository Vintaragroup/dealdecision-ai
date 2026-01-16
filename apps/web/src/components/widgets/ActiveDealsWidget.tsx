import { TrendingUp, TrendingDown, ArrowRight, Circle } from 'lucide-react';
import { useScoreSource } from '../../contexts/ScoreSourceContext';
import { getDisplayScoreForDeal } from '../../lib/dealScore';

interface Deal {
  id: string;
  name: string;
  company: string;
  score: number;
  status: 'go' | 'hold' | 'no-go';
  stage: string;
  lastUpdated: string;
  trend: 'up' | 'down' | 'neutral';

	// Additive: Analysis Foundation (Fundability) summary for list cards.
	fundability_v1?: any;
}

interface ActiveDealsWidgetProps {
  darkMode: boolean;
  deals: Deal[];
  onDealClick?: (dealId: string) => void;
}

export function ActiveDealsWidget({ darkMode, deals, onDealClick }: ActiveDealsWidgetProps) {
  const { scoreSource } = useScoreSource();
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'go':
        return {
          color: 'text-green-500',
          bg: darkMode ? 'bg-green-500/10' : 'bg-green-50',
          border: 'border-green-500/30',
          label: 'GO'
        };
      case 'hold':
        return {
          color: 'text-yellow-500',
          bg: darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50',
          border: 'border-yellow-500/30',
          label: 'HOLD'
        };
      case 'no-go':
        return {
          color: 'text-red-500',
          bg: darkMode ? 'bg-red-500/10' : 'bg-red-50',
          border: 'border-red-500/30',
          label: 'NO-GO'
        };
      default:
        return {
          color: 'text-gray-500',
          bg: darkMode ? 'bg-gray-500/10' : 'bg-gray-50',
          border: 'border-gray-500/30',
          label: 'REVIEW'
        };
    }
  };

  return (
    <div className={`p-5 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Active Deals
        </h3>
        <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {deals.length} in progress
        </span>
      </div>

      <div className="space-y-3">
        {deals.map((deal) => {
          const { score: displayScore, sourceUsed } = getDisplayScoreForDeal(deal as any, scoreSource);
          const scoreLabel = displayScore == null ? '—' : String(Math.round(displayScore));
          const statusKey = displayScore != null
            ? (displayScore >= 75 ? 'go' : displayScore >= 50 ? 'hold' : 'no-go')
            : deal.status;
          const statusConfig = getStatusConfig(statusKey);
          
          return (
            <div
              key={deal.id}
              onClick={() => onDealClick?.(deal.id)}
              className={`p-3 rounded-lg border transition-all cursor-pointer group ${
                darkMode 
                  ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20' 
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {deal.name}
                    </h4>
                    {deal.trend === 'up' && (
                      <TrendingUp className="w-3 h-3 text-green-500" />
                    )}
                    {deal.trend === 'down' && (
                      <TrendingDown className="w-3 h-3 text-red-500" />
                    )}
                  </div>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {deal.company} • {deal.stage}
                  </p>

          {deal.fundability_v1 && typeof deal.fundability_v1 === 'object' && (
            <p className={`text-[11px] mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Fundability: {String(
                (deal.fundability_v1 as any)?.fundability_decision_v1?.outcome ??
                  (deal.fundability_v1 as any)?.fundability_assessment_v1?.outcome ??
                  '—'
              )}
              {(deal.fundability_v1 as any)?.phase_inference_v1?.company_phase
                ? ` · ${(deal.fundability_v1 as any).phase_inference_v1.company_phase}`
                : ''}
              {typeof (deal.fundability_v1 as any)?.fundability_assessment_v1?.fundability_score_0_100 === 'number'
                ? ` · ${Math.round((deal.fundability_v1 as any).fundability_assessment_v1.fundability_score_0_100)}/100`
                : ''}
            </p>
          )}
                </div>
                <ArrowRight className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${
                  darkMode ? 'text-gray-400' : 'text-gray-600'
                }`} />
              </div>

              <div className="flex items-center justify-between">
                {/* Score Circle */}
                <div className="flex items-center gap-2">
                  <div className="relative w-10 h-10">
                    <svg className="w-10 h-10 transform -rotate-90">
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                        strokeWidth="3"
                        fill="none"
                      />
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        stroke="url(#scoreGradient)"
                        strokeWidth="3"
                        fill="none"
                        strokeDasharray={`${(((displayScore ?? deal.score) / 100) * 100)} 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-xs ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {scoreLabel}
                      </span>
                    </div>
                    <svg width="0" height="0">
                      <defs>
                        <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#6366f1" />
                          <stop offset="100%" stopColor="#8b5cf6" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <div>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Score{sourceUsed === 'fundability_v1' ? ' (F)' : ''}
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      {deal.lastUpdated}
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div className={`px-2 py-1 rounded-full text-xs border ${statusConfig.bg} ${statusConfig.border} ${statusConfig.color}`}>
                  {statusConfig.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
