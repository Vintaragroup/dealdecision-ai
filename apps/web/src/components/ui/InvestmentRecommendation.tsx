import { Sparkles, TrendingUp, AlertTriangle, XCircle, ArrowRight, Calendar, DollarSign } from 'lucide-react';
import { Button } from './button';

interface Recommendation {
  dealName: string;
  rank: number;
  score: number;
  recommendation: 'invest' | 'consider' | 'pass';
  reasoning: string[];
  concerns?: string[];
  investmentThesis?: string;
  suggestedTerms?: {
    amount: string;
    equity: string;
    special: string[];
  };
  nextSteps?: string[];
}

interface InvestmentRecommendationProps {
  recommendations: Recommendation[];
  darkMode: boolean;
}

export function InvestmentRecommendation({ recommendations, darkMode }: InvestmentRecommendationProps) {
  const recommendationConfig = {
    invest: {
      icon: TrendingUp,
      label: 'RECOMMENDED',
      color: 'text-green-500',
      bgColor: darkMode ? 'bg-green-500/10' : 'bg-green-50',
      borderColor: 'border-green-500/30',
      emoji: '🏆'
    },
    consider: {
      icon: AlertTriangle,
      label: 'CONSIDER',
      color: 'text-yellow-500',
      bgColor: darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50',
      borderColor: 'border-yellow-500/30',
      emoji: '🥈'
    },
    pass: {
      icon: XCircle,
      label: 'PASS',
      color: 'text-red-500',
      bgColor: darkMode ? 'bg-red-500/10' : 'bg-red-50',
      borderColor: 'border-red-500/30',
      emoji: '⚠️'
    }
  };

  const sortedRecommendations = [...recommendations].sort((a, b) => a.rank - b.rank);

  return (
    <div className={`p-6 rounded-lg backdrop-blur-xl border ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className={`text-xl bg-gradient-to-r bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>
            AI Investment Recommendation
          </h2>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Based on comprehensive analysis across all dimensions
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {sortedRecommendations.map((rec) => {
          const config = recommendationConfig[rec.recommendation];
          const Icon = config.icon;

          return (
            <div
              key={rec.dealName}
              className={`p-5 rounded-lg backdrop-blur-xl border ${
                config.bgColor
              } ${config.borderColor} ${
                rec.rank === 1 ? 'ring-2 ring-[#6366f1] shadow-[0_0_20px_rgba(99,102,241,0.2)]' : ''
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.emoji}</span>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className={`text-lg ${
                        darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {rec.dealName}
                      </h3>
                      {rec.rank === 1 && (
                        <span className="px-2 py-0.5 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white text-xs rounded-full">
                          Top Pick
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Icon className={`w-3 h-3 ${config.color}`} />
                      <span className={config.color}>{config.label}</span>
                      <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>•</span>
                      <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                        Score: {rec.score}/100
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reasoning */}
              {rec.reasoning.length > 0 && (
                <div className="mb-3">
                  <h4 className={`text-xs uppercase tracking-wide mb-2 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    {rec.recommendation === 'invest' ? 'Why Invest' : rec.recommendation === 'consider' ? 'Why Consider' : 'Why Pass'}
                  </h4>
                  <ul className={`space-y-1 text-sm ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {rec.reasoning.map((reason, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Concerns */}
              {rec.concerns && rec.concerns.length > 0 && (
                <div className="mb-3">
                  <h4 className={`text-xs uppercase tracking-wide mb-2 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    Concerns
                  </h4>
                  <ul className={`space-y-1 text-sm ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {rec.concerns.map((concern, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="text-yellow-500 mt-0.5">•</span>
                        <span>{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Investment Thesis */}
              {rec.investmentThesis && (
                <div className="mb-3">
                  <h4 className={`text-xs uppercase tracking-wide mb-2 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    Investment Thesis
                  </h4>
                  <p className={`text-sm ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {rec.investmentThesis}
                  </p>
                </div>
              )}

              {/* Suggested Terms */}
              {rec.suggestedTerms && (
                <div className="mb-4">
                  <h4 className={`text-xs uppercase tracking-wide mb-2 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    Suggested Terms
                  </h4>
                  <div className={`p-3 rounded-lg ${
                    darkMode ? 'bg-black/20' : 'bg-white/50'
                  }`}>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div>
                        <div className={`text-xs mb-1 ${
                          darkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          Investment Amount
                        </div>
                        <div className={`text-sm ${
                          darkMode ? 'text-white' : 'text-gray-900'
                        }`}>
                          {rec.suggestedTerms.amount}
                        </div>
                      </div>
                      <div>
                        <div className={`text-xs mb-1 ${
                          darkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          Equity
                        </div>
                        <div className={`text-sm ${
                          darkMode ? 'text-white' : 'text-gray-900'
                        }`}>
                          {rec.suggestedTerms.equity}
                        </div>
                      </div>
                    </div>
                    {rec.suggestedTerms.special.length > 0 && (
                      <div className={`text-xs ${
                        darkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        {rec.suggestedTerms.special.map((term, index) => (
                          <div key={index}>• {term}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Next Steps */}
              {rec.nextSteps && (
                <div className="flex gap-2">
                  {rec.recommendation === 'invest' && (
                    <>
                      <Button size="sm" className="flex-1 gap-2">
                        <DollarSign className="w-4 h-4" />
                        Proceed with Investment
                      </Button>
                      <Button variant="outline" size="sm" className="gap-2">
                        Request Introduction
                      </Button>
                    </>
                  )}
                  {rec.recommendation === 'consider' && (
                    <>
                      <Button variant="outline" size="sm" className="flex-1 gap-2">
                        Request More Info
                      </Button>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Calendar className="w-4 h-4" />
                        Schedule Deep Dive
                      </Button>
                    </>
                  )}
                  {rec.recommendation === 'pass' && (
                    <>
                      <Button variant="outline" size="sm" className="flex-1">
                        Pass
                      </Button>
                      <Button variant="outline" size="sm">
                        Add to Watchlist
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
