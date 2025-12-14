import { 
  Users, 
  TrendingUp, 
  DollarSign,
  Target,
  Star,
  BarChart3,
  Zap,
  CheckCircle
} from 'lucide-react';

interface CustomerAnalysisProps {
  data: any;
  darkMode: boolean;
}

export function CustomerAnalysis({ data, darkMode }: CustomerAnalysisProps) {
  const customerMetrics = [
    { label: 'Total Customers', value: '45', change: '+180% YoY', icon: Users },
    { label: 'Avg Deal Size', value: '$18K', change: '+25%', icon: DollarSign },
    { label: 'NPS Score', value: '72', change: 'Industry leading', icon: Star },
    { label: 'Retention Rate', value: '94%', change: '+8pts', icon: TrendingUp }
  ];

  const customerProfiles = [
    {
      name: 'Sequoia Capital-backed VC',
      logo: '🚀',
      tier: 'Enterprise',
      arr: '$48K',
      features: ['Deal flow analysis', 'Portfolio tracking', 'Due diligence', 'Reporting'],
      satisfaction: 95,
      quote: 'Reduced our due diligence time by 75%. Game changer for our team.'
    },
    {
      name: 'Mid-Market PE Firm',
      logo: '💼',
      tier: 'Professional',
      arr: '$24K',
      features: ['Due diligence', 'Financial modeling', 'Document generation'],
      satisfaction: 88,
      quote: 'Best ROI of any tool we use. Pays for itself in the first deal.'
    }
  ];

  const useCases = [
    {
      title: 'Due Diligence Acceleration',
      users: '100%',
      impact: '10x faster',
      description: 'Automated analysis of financials, market, and team'
    },
    {
      title: 'Document Generation',
      users: '89%',
      impact: '$15K saved',
      description: 'Professional reports and memos in minutes'
    },
    {
      title: 'Portfolio Tracking',
      users: '67%',
      impact: 'Real-time insights',
      description: 'Monitor all investments in one dashboard'
    },
    {
      title: 'Deal Comparison',
      users: '78%',
      impact: 'Better decisions',
      description: 'Side-by-side analysis of multiple opportunities'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              Customer Analysis
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Deep dive into customer base and satisfaction
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {customerMetrics.map((metric, index) => {
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
              <Icon className="w-5 h-5 mb-2 text-[#10b981]" />
              <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                {metric.value}
              </div>
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {metric.label}
              </div>
              <div className="text-xs text-emerald-500">{metric.change}</div>
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Featured Customers
        </h3>
        <div className="space-y-4">
          {customerProfiles.map((customer, index) => (
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
                  <div className="text-3xl">{customer.logo}</div>
                  <div>
                    <h4 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {customer.name}
                    </h4>
                    <div className="flex items-center gap-2">
                      <span 
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ 
                          backgroundColor: '#6366f120',
                          color: '#6366f1'
                        }}
                      >
                        {customer.tier}
                      </span>
                      <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        ARR: {customer.arr}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl mb-1" style={{ color: '#10b981' }}>
                    {customer.satisfaction}%
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                    Satisfaction
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {customer.features.map((feature, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 rounded text-xs"
                    style={{ 
                      backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                      color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)'
                    }}
                  >
                    {feature}
                  </div>
                ))}
              </div>

              <div 
                className="p-3 rounded-lg italic"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                  borderLeft: '3px solid #10b981'
                }}
              >
                <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  "{customer.quote}"
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Popular Use Cases
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {useCases.map((useCase, index) => (
            <div
              key={index}
              className="p-4 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {useCase.title}
                </h4>
                <div 
                  className="px-2 py-0.5 rounded text-xs"
                  style={{ 
                    backgroundColor: '#10b98120',
                    color: '#10b981'
                  }}
                >
                  {useCase.users}
                </div>
              </div>
              <p className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {useCase.description}
              </p>
              <div className="text-sm text-emerald-500">
                Impact: {useCase.impact}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
          border: '1px solid rgba(16,185,129,0.2)'
        }}
      >
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Star className="w-5 h-5 text-emerald-500" />
          Customer Success Highlights
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <strong>94%</strong> renewal rate
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <strong>140%</strong> net revenue retention
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <strong>72</strong> NPS score
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
