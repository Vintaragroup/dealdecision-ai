import { 
  TrendingUp, 
  TrendingDown,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle
} from 'lucide-react';

interface SWOTAnalysisProps {
  data: any;
  darkMode: boolean;
}

export function SWOTAnalysis({ data, darkMode }: SWOTAnalysisProps) {
  const swot = {
    strengths: [
      {
        title: 'Experienced Team',
        description: 'Founding team with 2 prior exits and 15+ years in venture capital',
        impact: 'High'
      },
      {
        title: 'First-Mover Advantage',
        description: 'First AI-powered platform specifically for deal flow management',
        impact: 'High'
      },
      {
        title: 'Strong Early Traction',
        description: '45 paying customers with 180% YoY growth',
        impact: 'High'
      },
      {
        title: 'Technology Moat',
        description: 'Proprietary AI models fine-tuned on 10K+ investment documents',
        impact: 'Medium'
      },
      {
        title: 'Network Effects',
        description: 'Platform becomes more valuable with each new user and deal',
        impact: 'Medium'
      }
    ],
    weaknesses: [
      {
        title: 'Limited Team Size',
        description: 'Only 8 people to execute ambitious roadmap',
        impact: 'Medium'
      },
      {
        title: 'Brand Recognition',
        description: 'New entrant competing against established players',
        impact: 'Medium'
      },
      {
        title: 'Customer Concentration',
        description: 'Top 5 customers represent 35% of ARR',
        impact: 'Low'
      },
      {
        title: 'Limited Runway',
        description: '18 months of cash runway at current burn rate',
        impact: 'Medium'
      }
    ],
    opportunities: [
      {
        title: 'Market Expansion',
        description: 'Expand from VC to PE, corporate M&A, and investment banking',
        potential: '$500M+ TAM'
      },
      {
        title: 'Enterprise Tier',
        description: 'Launch white-label solution for large firms',
        potential: '$100K+ ACV'
      },
      {
        title: 'International Growth',
        description: 'Enter European and Asian markets',
        potential: '3x market size'
      },
      {
        title: 'Strategic Partnerships',
        description: 'Partner with major VCs and accelerators for distribution',
        potential: '10x reach'
      },
      {
        title: 'AI Marketplace',
        description: 'Third-party AI models and integrations',
        potential: 'New revenue stream'
      }
    ],
    threats: [
      {
        title: 'Competitive Entry',
        description: 'Large incumbents (Salesforce, HubSpot) could enter space',
        probability: 'Medium'
      },
      {
        title: 'Regulation',
        description: 'AI regulations could impact product capabilities',
        probability: 'Low'
      },
      {
        title: 'Economic Downturn',
        description: 'Reduced VC activity could decrease demand',
        probability: 'Medium'
      },
      {
        title: 'Technology Risk',
        description: 'Reliance on third-party AI models (OpenAI)',
        probability: 'Low'
      }
    ]
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              SWOT Analysis
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Strategic position and competitive landscape
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Strengths */}
        <div
          className="p-5 rounded-xl"
          style={{ 
            backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
            border: '1px solid rgba(16,185,129,0.3)'
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            <h3 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
              Strengths
            </h3>
          </div>
          <div className="space-y-3">
            {swot.strengths.map((item, index) => (
              <div key={index}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {item.title}
                      </div>
                      <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <span 
                    className="px-2 py-0.5 rounded text-xs flex-shrink-0"
                    style={{ 
                      backgroundColor: item.impact === 'High' ? '#10b98120' : '#f59e0b20',
                      color: item.impact === 'High' ? '#10b981' : '#f59e0b'
                    }}
                  >
                    {item.impact}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Weaknesses */}
        <div
          className="p-5 rounded-xl"
          style={{ 
            backgroundColor: darkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
            border: '1px solid rgba(239,68,68,0.3)'
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-red-500" />
            <h3 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
              Weaknesses
            </h3>
          </div>
          <div className="space-y-3">
            {swot.weaknesses.map((item, index) => (
              <div key={index}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {item.title}
                      </div>
                      <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <span 
                    className="px-2 py-0.5 rounded text-xs flex-shrink-0"
                    style={{ 
                      backgroundColor: item.impact === 'High' ? '#ef444420' : item.impact === 'Medium' ? '#f59e0b20' : '#6b728020',
                      color: item.impact === 'High' ? '#ef4444' : item.impact === 'Medium' ? '#f59e0b' : '#6b7280'
                    }}
                  >
                    {item.impact}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Opportunities */}
        <div
          className="p-5 rounded-xl"
          style={{ 
            backgroundColor: darkMode ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)',
            border: '1px solid rgba(59,130,246,0.3)'
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
              Opportunities
            </h3>
          </div>
          <div className="space-y-3">
            {swot.opportunities.map((item, index) => (
              <div key={index}>
                <div className="flex items-start gap-2 mb-1">
                  <CheckCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {item.title}
                    </div>
                    <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      {item.description}
                    </div>
                    <div className="text-xs text-blue-500">
                      Potential: {item.potential}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Threats */}
        <div
          className="p-5 rounded-xl"
          style={{ 
            backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
            border: '1px solid rgba(245,158,11,0.3)'
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
              Threats
            </h3>
          </div>
          <div className="space-y-3">
            {swot.threats.map((item, index) => (
              <div key={index}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {item.title}
                      </div>
                      <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <span 
                    className="px-2 py-0.5 rounded text-xs flex-shrink-0"
                    style={{ 
                      backgroundColor: item.probability === 'High' ? '#ef444420' : item.probability === 'Medium' ? '#f59e0b20' : '#6b728020',
                      color: item.probability === 'High' ? '#ef4444' : item.probability === 'Medium' ? '#f59e0b' : '#6b7280'
                    }}
                  >
                    {item.probability}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
        <h3 className="text-lg mb-3" style={{ color: darkMode ? '#fff' : '#000' }}>
          Strategic Priorities Based on SWOT
        </h3>
        <div className="space-y-2">
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            <strong>1. Leverage strengths to capture opportunities:</strong> Use first-mover advantage and strong traction to expand into adjacent markets (PE, corporate M&A) before competitors enter
          </p>
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            <strong>2. Address weaknesses proactively:</strong> Expand team with Series A funding, diversify customer base, and build brand through thought leadership
          </p>
          <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            <strong>3. Mitigate threats:</strong> Develop proprietary AI models to reduce OpenAI dependency, build deep integrations for switching costs, and maintain lean operations for economic resilience
          </p>
        </div>
      </div>
    </div>
  );
}
