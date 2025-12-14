import { ThumbsUp, ThumbsDown, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface GoNoGoRecommendationProps {
  data: DealReportData;
  darkMode: boolean;
}

export function GoNoGoRecommendation({ data, darkMode }: GoNoGoRecommendationProps) {
  const getRecommendationConfig = () => {
    switch (data.recommendation) {
      case 'strong-yes':
        return {
          title: 'STRONG YES - Highly Recommended',
          icon: <ThumbsUp className="w-8 h-8" />,
          color: '#10b981',
          bgColor: 'rgba(16,185,129,0.15)',
          borderColor: 'rgba(16,185,129,0.4)',
          description: 'This opportunity exhibits exceptional characteristics and aligns strongly with investment criteria. Immediate action recommended.'
        };
      case 'yes':
        return {
          title: 'YES - Recommended',
          icon: <CheckCircle2 className="w-8 h-8" />,
          color: '#6366f1',
          bgColor: 'rgba(99,102,241,0.15)',
          borderColor: 'rgba(99,102,241,0.4)',
          description: 'This opportunity shows strong potential with favorable risk-reward profile. Recommended for investment consideration.'
        };
      case 'maybe':
        return {
          title: 'MAYBE - Conditional Interest',
          icon: <AlertTriangle className="w-8 h-8" />,
          color: '#f59e0b',
          bgColor: 'rgba(245,158,11,0.15)',
          borderColor: 'rgba(245,158,11,0.4)',
          description: 'This opportunity has potential but requires further due diligence or specific conditions to be met.'
        };
      case 'pass':
        return {
          title: 'PASS - Not Recommended',
          icon: <ThumbsDown className="w-8 h-8" />,
          color: '#ef4444',
          bgColor: 'rgba(239,68,68,0.15)',
          borderColor: 'rgba(239,68,68,0.4)',
          description: 'This opportunity does not meet investment criteria at this time. Recommend passing on this deal.'
        };
    }
  };

  const config = getRecommendationConfig();

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Go/No-Go Recommendation
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Investment decision and rationale
        </p>
      </div>

      {/* Main Recommendation Card */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: config.bgColor,
          border: `2px solid ${config.borderColor}`
        }}
      >
        <div className="flex items-start gap-4 mb-4">
          <div 
            className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: config.color }}
          >
            <div style={{ color: '#fff' }}>
              {config.icon}
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-2xl mb-2" style={{ color: config.color }}>
              {config.title}
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
              {config.description}
            </p>
          </div>
        </div>

        {/* Overall Score */}
        <div className="flex items-center gap-3 pt-4 border-t" style={{ 
          borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' 
        }}>
          <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            Overall Investor Readiness Score:
          </div>
          <div className="text-3xl" style={{ color: config.color }}>
            {data.investorScore}/100
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Score Breakdown
        </h3>
        <div className="space-y-3">
          {[
            { label: 'Market Validation', score: data.marketScore, description: 'TAM size, growth rate, competitive positioning' },
            { label: 'Financial Strength', score: data.financialScore, description: 'Revenue projections, unit economics, runway' },
            { label: 'Team Quality', score: data.teamScore, description: 'Founder experience, team composition, advisors' }
          ].map((item, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                    {item.label}
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                    {item.description}
                  </div>
                </div>
                <div className="text-2xl" style={{ 
                  color: item.score >= 90 ? '#10b981' : item.score >= 80 ? '#6366f1' : item.score >= 70 ? '#f59e0b' : '#ef4444'
                }}>
                  {item.score}
                </div>
              </div>
              {/* Progress Bar */}
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
              }}>
                <div 
                  className="h-full transition-all duration-500 rounded-full"
                  style={{ 
                    width: `${item.score}%`,
                    background: `linear-gradient(to right, ${item.score >= 90 ? '#10b981' : item.score >= 80 ? '#6366f1' : item.score >= 70 ? '#f59e0b' : '#ef4444'}, ${item.score >= 90 ? '#059669' : item.score >= 80 ? '#4f46e5' : item.score >= 70 ? '#d97706' : '#dc2626'})`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Decision Factors */}
      <div className="grid grid-cols-2 gap-4">
        {/* Strengths */}
        <div 
          className="p-4 rounded-lg"
          style={{ 
            backgroundColor: 'rgba(16,185,129,0.1)',
            border: `1px solid rgba(16,185,129,0.3)`
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#10b981' }}>
            <CheckCircle2 className="w-4 h-4" />
            Key Strengths
          </h4>
          <ul className="space-y-2">
            {data.executiveSummary.keyHighlights.slice(0, 4).map((highlight, index) => (
              <li 
                key={index}
                className="text-xs flex items-start gap-2"
                style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}
              >
                <span className="text-emerald-500 mt-0.5">•</span>
                <span className="flex-1">{highlight}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Risks */}
        <div 
          className="p-4 rounded-lg"
          style={{ 
            backgroundColor: 'rgba(245,158,11,0.1)',
            border: `1px solid rgba(245,158,11,0.3)`
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#f59e0b' }}>
            <AlertTriangle className="w-4 h-4" />
            Key Risks
          </h4>
          <ul className="space-y-2">
            {data.executiveSummary.keyRisks.map((risk, index) => (
              <li 
                key={index}
                className="text-xs flex items-start gap-2"
                style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}
              >
                <span className="text-amber-500 mt-0.5">•</span>
                <span className="flex-1">{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Next Steps */}
      {data.recommendation !== 'pass' && (
        <div 
          className="p-4 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
            border: `1px solid rgba(99,102,241,0.3)`
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
            <TrendingUp className="w-4 h-4" />
            Recommended Next Steps
          </h4>
          <ul className="space-y-2">
            <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              <span className="text-indigo-500 mt-0.5">1.</span>
              <span className="flex-1">Schedule founder meeting to discuss vision and strategy</span>
            </li>
            <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              <span className="text-indigo-500 mt-0.5">2.</span>
              <span className="flex-1">Conduct customer reference calls with top 3 enterprise clients</span>
            </li>
            <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              <span className="text-indigo-500 mt-0.5">3.</span>
              <span className="flex-1">Technical deep-dive with CTO on product architecture</span>
            </li>
            <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              <span className="text-indigo-500 mt-0.5">4.</span>
              <span className="flex-1">Review complete legal and financial documentation package</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
