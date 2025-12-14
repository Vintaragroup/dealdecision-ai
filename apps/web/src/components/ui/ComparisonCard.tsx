import { CheckCircle, AlertTriangle, XCircle, TrendingUp, DollarSign, Users, Target } from 'lucide-react';
import { ScoreCircle } from './ScoreCircle';

interface Deal {
  id: string;
  name: string;
  score: number;
  recommendation: 'go' | 'hold' | 'no-go';
  stage: string;
  industry: string;
  fundingTarget: string;
  valuation: string;
  equity: string;
  marketScore: number;
  teamScore: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface ComparisonCardProps {
  deal: Deal;
  darkMode: boolean;
  isWinner?: boolean;
  onRemove?: () => void;
}

export function ComparisonCard({ deal, darkMode, isWinner, onRemove }: ComparisonCardProps) {
  const recommendationConfig = {
    go: {
      icon: CheckCircle,
      label: 'GO',
      color: 'text-green-500',
      bgColor: darkMode ? 'bg-green-500/10' : 'bg-green-50',
      borderColor: 'border-green-500/30'
    },
    hold: {
      icon: AlertTriangle,
      label: 'HOLD',
      color: 'text-yellow-500',
      bgColor: darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50',
      borderColor: 'border-yellow-500/30'
    },
    'no-go': {
      icon: XCircle,
      label: 'NO-GO',
      color: 'text-red-500',
      bgColor: darkMode ? 'bg-red-500/10' : 'bg-red-50',
      borderColor: 'border-red-500/30'
    }
  };

  const config = recommendationConfig[deal.recommendation];
  const Icon = config.icon;

  return (
    <div className={`relative p-6 rounded-lg backdrop-blur-xl border transition-all ${
      isWinner
        ? 'ring-2 ring-[#6366f1] shadow-[0_0_30px_rgba(99,102,241,0.3)]'
        : ''
    } ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      {/* Winner Badge */}
      {isWinner && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] rounded-full text-white text-xs shadow-[0_0_12px_rgba(99,102,241,0.6)]">
          ⭐ Top Pick
        </div>
      )}

      {/* Remove Button */}
      {onRemove && (
        <button
          onClick={onRemove}
          className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors ${
            darkMode ? 'bg-white/5 text-gray-400 hover:bg-red-500/20 hover:text-red-400' : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
          }`}
        >
          ✕
        </button>
      )}

      {/* Deal Name */}
      <h3 className={`text-lg mb-4 text-center ${
        darkMode ? 'text-white' : 'text-gray-900'
      }`}>
        {deal.name}
      </h3>

      {/* Score Circle */}
      <div className="flex justify-center mb-4">
        <ScoreCircle score={deal.score} size="md" darkMode={darkMode} showLabel={false} />
      </div>

      {/* Recommendation */}
      <div className={`p-3 rounded-lg backdrop-blur-xl border mb-4 ${config.bgColor} ${config.borderColor}`}>
        <div className="flex items-center justify-center gap-2">
          <Icon className={`w-4 h-4 ${config.color}`} />
          <span className={`text-sm ${config.color}`}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Key Details */}
      <div className="space-y-3">
        <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
          <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Stage & Industry
          </div>
          <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {deal.stage} • {deal.industry}
          </div>
        </div>

        <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
          <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Funding Target
          </div>
          <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {deal.fundingTarget}
          </div>
        </div>

        <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
          <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Valuation / Equity
          </div>
          <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {deal.valuation} / {deal.equity}
          </div>
        </div>

        {/* Quick Scores */}
        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Market</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>{deal.marketScore}/100</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Team</span>
            <span className={darkMode ? 'text-white' : 'text-gray-900'}>{deal.teamScore}/100</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Risk</span>
            <span className={`uppercase text-xs ${
              deal.riskLevel === 'low' ? 'text-green-500' :
              deal.riskLevel === 'medium' ? 'text-yellow-500' :
              'text-red-500'
            }`}>
              {deal.riskLevel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
