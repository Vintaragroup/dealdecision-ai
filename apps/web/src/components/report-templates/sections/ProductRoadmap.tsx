import { 
  Map, 
  CheckCircle, 
  Clock, 
  Target,
  Zap,
  Users,
  TrendingUp,
  Star,
  Sparkles
} from 'lucide-react';

interface ProductRoadmapProps {
  data: any;
  darkMode: boolean;
}

export function ProductRoadmap({ data, darkMode }: ProductRoadmapProps) {
  const roadmapPhases = [
    {
      phase: 'Q4 2024',
      status: 'completed',
      progress: 100,
      color: '#10b981',
      milestones: [
        { 
          title: 'MVP Launch', 
          status: 'completed', 
          impact: 'High',
          description: 'Core platform with basic AI analysis'
        },
        { 
          title: 'First 10 Customers', 
          status: 'completed', 
          impact: 'High',
          description: 'Initial market validation achieved'
        },
        { 
          title: 'Beta Testing Program', 
          status: 'completed', 
          impact: 'Medium',
          description: '50 beta users providing feedback'
        }
      ]
    },
    {
      phase: 'Q1 2025',
      status: 'in-progress',
      progress: 65,
      color: '#3b82f6',
      milestones: [
        { 
          title: 'Advanced Analytics Dashboard', 
          status: 'completed', 
          impact: 'High',
          description: 'Real-time insights and reporting'
        },
        { 
          title: 'Team Collaboration Features', 
          status: 'completed', 
          impact: 'High',
          description: 'Multi-user workspaces and sharing'
        },
        { 
          title: 'API v2.0', 
          status: 'in-progress', 
          impact: 'Medium',
          description: 'RESTful and GraphQL endpoints'
        },
        { 
          title: 'Mobile App (iOS)', 
          status: 'planned', 
          impact: 'Medium',
          description: 'Native iOS application'
        }
      ]
    },
    {
      phase: 'Q2 2025',
      status: 'planned',
      progress: 0,
      color: '#f59e0b',
      milestones: [
        { 
          title: 'Enterprise SSO', 
          status: 'planned', 
          impact: 'High',
          description: 'SAML and OAuth integration'
        },
        { 
          title: 'Custom AI Models', 
          status: 'planned', 
          impact: 'High',
          description: 'Industry-specific fine-tuning'
        },
        { 
          title: 'White-Label Solution', 
          status: 'planned', 
          impact: 'High',
          description: 'Rebrandable platform for partners'
        },
        { 
          title: 'Mobile App (Android)', 
          status: 'planned', 
          impact: 'Medium',
          description: 'Native Android application'
        }
      ]
    },
    {
      phase: 'Q3 2025',
      status: 'planned',
      progress: 0,
      color: '#8b5cf6',
      milestones: [
        { 
          title: 'Marketplace Launch', 
          status: 'planned', 
          impact: 'High',
          description: 'Third-party integrations and plugins'
        },
        { 
          title: 'Advanced ML Models', 
          status: 'planned', 
          impact: 'High',
          description: 'Predictive analytics and forecasting'
        },
        { 
          title: 'Multi-language Support', 
          status: 'planned', 
          impact: 'Medium',
          description: 'Support for 10+ languages'
        }
      ]
    },
    {
      phase: 'Q4 2025',
      status: 'planned',
      progress: 0,
      color: '#ec4899',
      milestones: [
        { 
          title: 'On-Premise Deployment', 
          status: 'planned', 
          impact: 'High',
          description: 'Self-hosted option for enterprises'
        },
        { 
          title: 'Advanced Security Features', 
          status: 'planned', 
          impact: 'High',
          description: 'SOC 2 Type II compliance'
        },
        { 
          title: 'AI Co-pilot', 
          status: 'planned', 
          impact: 'High',
          description: 'Conversational AI assistant'
        }
      ]
    }
  ];

  const keyFeatures = [
    {
      category: 'Core Platform',
      features: [
        'AI-powered due diligence analysis',
        'Automated document generation',
        'Real-time collaboration tools',
        'Advanced analytics & reporting'
      ]
    },
    {
      category: 'Enterprise Features',
      features: [
        'SSO & SAML integration',
        'Custom branding & white-labeling',
        'Advanced security controls',
        'Dedicated support & SLAs'
      ]
    },
    {
      category: 'Integrations',
      features: [
        'Salesforce CRM integration',
        'Slack & Teams notifications',
        'DocuSign e-signature',
        'QuickBooks accounting sync'
      ]
    }
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'in-progress': return <Clock className="w-4 h-4 text-blue-500" />;
      case 'planned': return <Target className="w-4 h-4 text-gray-400" />;
      default: return null;
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'High': return '#ef4444';
      case 'Medium': return '#f59e0b';
      case 'Low': return '#6b7280';
      default: return '#6b7280';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#ec4899] flex items-center justify-center">
            <Map className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              Product Roadmap
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Strategic product development timeline
            </p>
          </div>
        </div>
      </div>

      {/* Timeline Overview */}
      <div className="grid grid-cols-5 gap-3">
        {roadmapPhases.map((phase, index) => (
          <div
            key={index}
            className="p-4 rounded-xl text-center"
            style={{ 
              backgroundColor: phase.color + '10',
              border: `2px solid ${phase.color}40`
            }}
          >
            <div className="text-sm mb-2" style={{ color: phase.color }}>
              {phase.phase}
            </div>
            <div className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
              {phase.progress}%
            </div>
            <div 
              className="h-2 rounded-full mb-2"
              style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
            >
              <div 
                className="h-full rounded-full"
                style={{ 
                  width: `${phase.progress}%`,
                  backgroundColor: phase.color
                }}
              />
            </div>
            <div className="text-xs capitalize" style={{ color: phase.color }}>
              {phase.status.replace('-', ' ')}
            </div>
          </div>
        ))}
      </div>

      {/* Detailed Roadmap */}
      <div className="space-y-4">
        {roadmapPhases.map((phase, phaseIndex) => (
          <div
            key={phaseIndex}
            className="p-5 rounded-xl"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            {/* Phase Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: phase.color + '20' }}
                >
                  <span className="text-lg" style={{ color: phase.color }}>
                    Q{phaseIndex + 4 > 4 ? (phaseIndex + 4 - 4) : phaseIndex + 4}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
                    {phase.phase}
                  </h3>
                  <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                    {phase.milestones.length} milestones
                  </p>
                </div>
              </div>
              <div 
                className="px-3 py-1.5 rounded-full text-sm capitalize"
                style={{ 
                  backgroundColor: phase.color + '20',
                  color: phase.color
                }}
              >
                {phase.status.replace('-', ' ')}
              </div>
            </div>

            {/* Milestones */}
            <div className="space-y-3">
              {phase.milestones.map((milestone, milestoneIndex) => (
                <div
                  key={milestoneIndex}
                  className="p-4 rounded-lg"
                  style={{ 
                    backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.5)',
                    border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-start gap-3 flex-1">
                      {getStatusIcon(milestone.status)}
                      <div>
                        <h4 className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {milestone.title}
                        </h4>
                        <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                          {milestone.description}
                        </p>
                      </div>
                    </div>
                    <div 
                      className="px-2 py-1 rounded text-xs flex-shrink-0"
                      style={{ 
                        backgroundColor: getImpactColor(milestone.impact) + '20',
                        color: getImpactColor(milestone.impact)
                      }}
                    >
                      {milestone.impact} Impact
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Key Features by Category */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Feature Set Overview
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {keyFeatures.map((category, index) => (
            <div
              key={index}
              className="p-4 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[#6366f1]" />
                <h4 className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {category.category}
                </h4>
              </div>
              <div className="space-y-2">
                {category.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="flex items-start gap-2">
                    <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Strategic Priorities */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.2)'
        }}
      >
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Star className="w-5 h-5 text-[#6366f1]" />
          Strategic Priorities
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-[#6366f1]" />
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                Customer-Centric
              </div>
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              All features driven by customer feedback and validated demand
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-[#6366f1]" />
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                Fast Iteration
              </div>
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              2-week sprint cycles with continuous deployment
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-[#6366f1]" />
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                Scalable Growth
              </div>
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Architecture built to handle 100x growth without major refactoring
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
