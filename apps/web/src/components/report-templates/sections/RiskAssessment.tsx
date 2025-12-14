import { 
  AlertTriangle, 
  Shield, 
  TrendingDown,
  Users,
  DollarSign,
  Target,
  Clock,
  Zap,
  CheckCircle,
  XCircle
} from 'lucide-react';

interface RiskAssessmentProps {
  data: any;
  darkMode: boolean;
}

export function RiskAssessment({ data, darkMode }: RiskAssessmentProps) {
  const risks = [
    {
      category: 'Market Risk',
      level: 'Medium',
      score: 65,
      icon: Target,
      color: '#f59e0b',
      description: 'Competitive intensity and market timing',
      factors: [
        'Market is rapidly evolving with new entrants',
        'Customer adoption rates uncertain',
        'Regulatory landscape may change'
      ],
      mitigation: [
        'First-mover advantage in specific vertical',
        'Strong partnerships with industry leaders',
        'Flexible product architecture for pivots'
      ]
    },
    {
      category: 'Execution Risk',
      level: 'Low',
      score: 85,
      icon: Zap,
      color: '#10b981',
      description: 'Team ability to deliver on milestones',
      factors: [
        'Limited team size for ambitious roadmap',
        'Key person dependencies'
      ],
      mitigation: [
        'Experienced team with prior exits',
        'Clear hiring roadmap for next 6 months',
        'Advisory board with domain expertise'
      ]
    },
    {
      category: 'Financial Risk',
      level: 'Medium',
      score: 70,
      icon: DollarSign,
      color: '#f59e0b',
      description: 'Funding runway and burn rate',
      factors: [
        'Current runway: 18 months',
        'Revenue ramp slower than projected',
        'High customer acquisition costs'
      ],
      mitigation: [
        'Multiple revenue streams being developed',
        'Cost optimization initiatives in place',
        'Bridge financing options identified'
      ]
    },
    {
      category: 'Technology Risk',
      level: 'Low',
      score: 80,
      icon: Shield,
      color: '#10b981',
      description: 'Technical feasibility and scalability',
      factors: [
        'Dependency on third-party APIs',
        'Scaling challenges at 10x growth'
      ],
      mitigation: [
        'Proven technology stack',
        'Built for scale from day one',
        'Technical advisors from FAANG companies'
      ]
    },
    {
      category: 'Team Risk',
      level: 'Low',
      score: 88,
      icon: Users,
      color: '#10b981',
      description: 'Team cohesion and retention',
      factors: [
        'Small core team',
        'Competitive talent market'
      ],
      mitigation: [
        'Strong equity incentives',
        'Culture-first approach',
        'Competitive compensation packages'
      ]
    },
    {
      category: 'Timeline Risk',
      level: 'Medium',
      score: 68,
      icon: Clock,
      color: '#f59e0b',
      description: 'Ability to meet projected milestones',
      factors: [
        'Aggressive product roadmap',
        'Multiple dependencies on partners',
        'Regulatory approval timelines'
      ],
      mitigation: [
        'Buffer time built into critical path',
        'Parallel workstreams to reduce dependencies',
        'Early engagement with regulators'
      ]
    }
  ];

  const overallRiskScore = Math.round(
    risks.reduce((sum, risk) => sum + risk.score, 0) / risks.length
  );

  const getRiskLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#ef4444] to-[#dc2626] flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              Risk Assessment
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Comprehensive risk analysis and mitigation strategies
            </p>
          </div>
        </div>
      </div>

      {/* Overall Risk Score */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Overall Risk Score
            </div>
            <div className="text-4xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
              {overallRiskScore}/100
            </div>
            <div 
              className="text-sm"
              style={{ color: overallRiskScore >= 75 ? '#10b981' : overallRiskScore >= 60 ? '#f59e0b' : '#ef4444' }}
            >
              {overallRiskScore >= 75 ? 'Low Risk Profile' : overallRiskScore >= 60 ? 'Moderate Risk Profile' : 'High Risk Profile'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Risk Distribution
            </div>
            <div className="flex gap-4">
              <div>
                <div className="text-2xl text-emerald-500">3</div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  Low
                </div>
              </div>
              <div>
                <div className="text-2xl text-amber-500">3</div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  Medium
                </div>
              </div>
              <div>
                <div className="text-2xl" style={{ color: darkMode ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>0</div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  High
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Categories */}
      <div className="space-y-4">
        {risks.map((risk, index) => {
          const Icon = risk.icon;
          return (
            <div
              key={index}
              className="p-5 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: risk.color + '20' }}
                  >
                    <Icon className="w-5 h-5" style={{ color: risk.color }} />
                  </div>
                  <div>
                    <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {risk.category}
                    </h3>
                    <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      {risk.description}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div 
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm mb-1"
                    style={{ 
                      backgroundColor: getRiskLevelColor(risk.level) + '20',
                      color: getRiskLevelColor(risk.level)
                    }}
                  >
                    {risk.level} Risk
                  </div>
                  <div className="text-2xl" style={{ color: risk.color }}>
                    {risk.score}/100
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div 
                className="h-2 rounded-full mb-4"
                style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
              >
                <div 
                  className="h-full rounded-full transition-all"
                  style={{ 
                    width: `${risk.score}%`,
                    backgroundColor: risk.color
                  }}
                />
              </div>

              {/* Risk Factors */}
              <div className="mb-4">
                <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Risk Factors:
                </div>
                <div className="space-y-2">
                  {risk.factors.map((factor, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {factor}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mitigation Strategies */}
              <div>
                <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Mitigation Strategies:
                </div>
                <div className="space-y-2">
                  {risk.mitigation.map((strategy, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {strategy}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Risk Matrix Summary */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.2)'
        }}
      >
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Shield className="w-5 h-5 text-[#6366f1]" />
          Risk Management Approach
        </h3>
        <div className="space-y-2">
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            • Regular risk reviews conducted quarterly with board oversight
          </p>
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            • Contingency plans in place for all medium and high-risk scenarios
          </p>
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            • Key risk indicators (KRIs) monitored monthly
          </p>
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            • Risk-adjusted financial modeling updated quarterly
          </p>
        </div>
      </div>
    </div>
  );
}
