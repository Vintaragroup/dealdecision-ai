import { 
  Rocket, 
  Target, 
  Users,
  TrendingUp,
  DollarSign,
  Megaphone,
  Globe,
  Award,
  CheckCircle
} from 'lucide-react';

interface GoToMarketStrategyProps {
  data: any;
  darkMode: boolean;
}

export function GoToMarketStrategy({ data, darkMode }: GoToMarketStrategyProps) {
  const channels = [
    {
      name: 'Enterprise Sales',
      icon: Users,
      color: '#6366f1',
      allocation: '40%',
      cost: '$120K/year',
      roi: '5.2x',
      tactics: [
        'Dedicated enterprise sales team (3 AEs)',
        'Account-based marketing (ABM)',
        'Executive briefing programs',
        'Industry conferences and events'
      ]
    },
    {
      name: 'Digital Marketing',
      icon: Globe,
      color: '#10b981',
      allocation: '30%',
      cost: '$90K/year',
      roi: '4.8x',
      tactics: [
        'SEO and content marketing',
        'Paid search (Google Ads)',
        'LinkedIn advertising',
        'Webinars and virtual events'
      ]
    },
    {
      name: 'Partner Channel',
      icon: Award,
      color: '#f59e0b',
      allocation: '20%',
      cost: '$60K/year',
      roi: '6.1x',
      tactics: [
        'Strategic partnerships with VCs',
        'Integration partnerships',
        'Referral program',
        'Co-marketing initiatives'
      ]
    },
    {
      name: 'Product-Led Growth',
      icon: Rocket,
      color: '#8b5cf6',
      allocation: '10%',
      cost: '$30K/year',
      roi: '8.3x',
      tactics: [
        'Free tier for self-service',
        'In-app upgrade prompts',
        'Viral sharing features',
        'Community building'
      ]
    }
  ];

  const customerSegments = [
    {
      segment: 'Venture Capital Firms',
      size: '2,000 firms',
      priority: 'Primary',
      characteristics: [
        'Need to analyze 100+ deals per year',
        'Budget: $50K-$200K annually',
        'Decision maker: Partners/Principals'
      ],
      approach: 'Enterprise sales with custom demos'
    },
    {
      segment: 'Private Equity',
      size: '5,000 firms',
      priority: 'Secondary',
      characteristics: [
        'Complex due diligence processes',
        'Budget: $100K-$500K annually',
        'Decision maker: Investment committees'
      ],
      approach: 'ABM campaigns targeting decision makers'
    },
    {
      segment: 'Corporate Development',
      size: '10,000 companies',
      priority: 'Growth',
      characteristics: [
        'M&A and strategic investments',
        'Budget: $25K-$150K annually',
        'Decision maker: Corp Dev Directors'
      ],
      approach: 'Targeted outreach and partnerships'
    }
  ];

  const milestones = [
    { phase: 'Launch (Q4 2024)', metric: '10 customers', achieved: true },
    { phase: 'Growth (Q1 2025)', metric: '50 customers', achieved: true },
    { phase: 'Scale (Q2 2025)', metric: '150 customers', achieved: false },
    { phase: 'Expansion (Q3 2025)', metric: '400 customers', achieved: false }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#ef4444] flex items-center justify-center">
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              Go-to-Market Strategy
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Multi-channel approach to customer acquisition
            </p>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Target CAC', value: '$2,500', icon: DollarSign },
          { label: 'LTV:CAC Ratio', value: '5:1', icon: TrendingUp },
          { label: 'Payback Period', value: '6 months', icon: Target },
          { label: 'Year 1 Target', value: '150', icon: Users }
        ].map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div
              key={index}
              className="p-4 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <Icon className="w-5 h-5 mb-2 text-[#6366f1]" />
              <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                {metric.value}
              </div>
              <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {metric.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Marketing Channels */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Marketing Channel Mix
        </h3>
        <div className="space-y-4">
          {channels.map((channel, index) => {
            const Icon = channel.icon;
            return (
              <div
                key={index}
                className="p-5 rounded-xl"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: channel.color + '20' }}
                    >
                      <Icon className="w-5 h-5" style={{ color: channel.color }} />
                    </div>
                    <div>
                      <h4 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {channel.name}
                      </h4>
                      <div className="flex items-center gap-4 text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        <span>Budget: {channel.cost}</span>
                        <span>•</span>
                        <span className="text-emerald-500">ROI: {channel.roi}</span>
                      </div>
                    </div>
                  </div>
                  <div 
                    className="px-3 py-1 rounded-full text-sm"
                    style={{ 
                      backgroundColor: channel.color + '20',
                      color: channel.color
                    }}
                  >
                    {channel.allocation}
                  </div>
                </div>

                {/* Progress Bar */}
                <div 
                  className="h-2 rounded-full mb-4"
                  style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
                >
                  <div 
                    className="h-full rounded-full"
                    style={{ 
                      width: channel.allocation,
                      backgroundColor: channel.color
                    }}
                  />
                </div>

                {/* Tactics */}
                <div className="grid grid-cols-2 gap-2">
                  {channel.tactics.map((tactic, tacticIndex) => (
                    <div key={tacticIndex} className="flex items-start gap-2">
                      <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        {tactic}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Customer Segments */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Target Customer Segments
        </h3>
        <div className="space-y-3">
          {customerSegments.map((segment, index) => (
            <div
              key={index}
              className="p-4 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                    {segment.segment}
                  </h4>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                    Market size: {segment.size}
                  </div>
                </div>
                <div 
                  className="px-2 py-1 rounded text-xs"
                  style={{ 
                    backgroundColor: segment.priority === 'Primary' ? '#6366f120' : '#f59e0b20',
                    color: segment.priority === 'Primary' ? '#6366f1' : '#f59e0b'
                  }}
                >
                  {segment.priority}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                    Characteristics:
                  </div>
                  {segment.characteristics.map((char, idx) => (
                    <div key={idx} className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      • {char}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                    GTM Approach:
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                    {segment.approach}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Growth Milestones */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Growth Milestones
        </h3>
        <div className="grid grid-cols-4 gap-3">
          {milestones.map((milestone, index) => (
            <div
              key={index}
              className="p-4 rounded-xl text-center"
              style={{ 
                backgroundColor: milestone.achieved 
                  ? darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)'
                  : darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${milestone.achieved ? '#10b98140' : darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              {milestone.achieved && (
                <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
              )}
              <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {milestone.phase}
              </div>
              <div className="text-lg" style={{ color: milestone.achieved ? '#10b981' : darkMode ? '#fff' : '#000' }}>
                {milestone.metric}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Competitive Advantage */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.2)'
        }}
      >
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Megaphone className="w-5 h-5 text-[#6366f1]" />
          Messaging & Positioning
        </h3>
        <div className="space-y-3">
          <div>
            <div className="text-sm mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              <strong>Value Proposition:</strong>
            </div>
            <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              "Save 80+ hours and $20K+ per deal with AI-powered due diligence and document generation"
            </div>
          </div>
          <div>
            <div className="text-sm mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              <strong>Key Differentiators:</strong>
            </div>
            <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              • First-mover in AI-powered deal flow management<br />
              • 10x faster than traditional methods<br />
              • Built by investors, for investors
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
