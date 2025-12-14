import { Target, TrendingUp, Shield, Award, AlertCircle, CheckCircle, XCircle, Minus, DollarSign, Users, Zap } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface CompetitiveLandscapeProps {
  data: DealReportData;
  darkMode: boolean;
}

export function CompetitiveLandscape({ data, darkMode }: CompetitiveLandscapeProps) {
  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Competitive Landscape
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Market positioning and competitive analysis
        </p>
      </div>

      {/* Competitive Position Summary */}
      <div 
        className="p-5 rounded-xl"
        style={{ 
          background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)',
          border: '2px solid rgba(99,102,241,0.4)'
        }}
      >
        <div className="flex items-center gap-4 mb-4">
          <div 
            className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
          >
            <Target className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              Competitive Position
            </h3>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              {data.competitiveLandscape.ourPosition}
            </p>
          </div>
        </div>
      </div>

      {/* Market Share Distribution */}
      {data.competitiveLandscape.marketShareData && (
        <div>
          <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
            <TrendingUp className="w-5 h-5 text-[#6366f1]" />
            Market Share Distribution
          </h3>
          <div className="space-y-3">
            {data.competitiveLandscape.marketShareData.map((item, index) => {
              const isUs = item.company === data.companyName || item.company.includes('TechVision');
              return (
                <div 
                  key={index}
                  className="p-4 rounded-lg"
                  style={{ 
                    backgroundColor: isUs 
                      ? 'rgba(99,102,241,0.1)' 
                      : darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                    border: `1px solid ${isUs 
                      ? 'rgba(99,102,241,0.3)' 
                      : darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {item.company}
                      </span>
                      {isUs && (
                        <div 
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ 
                            backgroundColor: 'rgba(99,102,241,0.3)',
                            color: '#6366f1'
                          }}
                        >
                          Us
                        </div>
                      )}
                    </div>
                    <span className="text-sm" style={{ color: isUs ? '#6366f1' : darkMode ? '#fff' : '#000' }}>
                      {item.share}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ 
                    backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                  }}>
                    <div 
                      className="h-full transition-all duration-500 rounded-full"
                      style={{ 
                        width: `${item.share}%`,
                        backgroundColor: isUs ? '#6366f1' : darkMode ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Competitor Profiles */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Users className="w-5 h-5 text-[#6366f1]" />
          Key Competitors
        </h3>
        <div className="space-y-4">
          {data.competitiveLandscape.competitors.map((competitor, index) => (
            <div 
              key={index}
              className="p-5 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h4 className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                    {competitor.name}
                  </h4>
                  <p className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                    {competitor.description}
                  </p>
                </div>
                {competitor.marketShare && (
                  <div 
                    className="px-3 py-1 rounded text-center ml-4"
                    style={{ 
                      backgroundColor: 'rgba(99,102,241,0.1)',
                      border: '1px solid rgba(99,102,241,0.3)'
                    }}
                  >
                    <div className="text-lg" style={{ color: '#6366f1' }}>
                      {competitor.marketShare}%
                    </div>
                    <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      market share
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                    border: '1px solid rgba(99,102,241,0.2)'
                  }}
                >
                  <div className="text-xs mb-1 flex items-center gap-1" style={{ color: '#6366f1' }}>
                    <DollarSign className="w-3 h-3" />
                    Funding
                  </div>
                  <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                    {competitor.funding}
                  </div>
                </div>
                {competitor.valuation && (
                  <div 
                    className="p-3 rounded-lg"
                    style={{ 
                      backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)',
                      border: '1px solid rgba(139,92,246,0.2)'
                    }}
                  >
                    <div className="text-xs mb-1 flex items-center gap-1" style={{ color: '#8b5cf6' }}>
                      <TrendingUp className="w-3 h-3" />
                      Valuation
                    </div>
                    <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                      {competitor.valuation}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                    border: '1px solid rgba(16,185,129,0.3)'
                  }}
                >
                  <div className="text-xs mb-2 flex items-center gap-1" style={{ color: '#10b981' }}>
                    <CheckCircle className="w-3 h-3" />
                    Strengths
                  </div>
                  <ul className="space-y-1">
                    {competitor.strengths.map((strength, idx) => (
                      <li key={idx} className="text-xs flex items-start gap-1" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        <span className="text-emerald-500 mt-0.5">•</span>
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: darkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
                    border: '1px solid rgba(239,68,68,0.3)'
                  }}
                >
                  <div className="text-xs mb-2 flex items-center gap-1" style={{ color: '#ef4444' }}>
                    <XCircle className="w-3 h-3" />
                    Weaknesses
                  </div>
                  <ul className="space-y-1">
                    {competitor.weaknesses.map((weakness, idx) => (
                      <li key={idx} className="text-xs flex items-start gap-1" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        <span className="text-red-500 mt-0.5">•</span>
                        <span>{weakness}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature Comparison Matrix */}
      {data.competitiveLandscape.featureComparison && (
        <div>
          <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
            <Award className="w-5 h-5 text-[#6366f1]" />
            Feature Comparison
          </h3>
          <div 
            className="overflow-x-auto rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
                  <th className="text-left p-3" style={{ color: darkMode ? '#fff' : '#000' }}>
                    Feature
                  </th>
                  <th className="text-center p-3" style={{ color: '#6366f1' }}>
                    {data.companyName || 'Us'}
                  </th>
                  {data.competitiveLandscape.featureComparison.competitors.map((comp, idx) => (
                    <th key={idx} className="text-center p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                      {comp.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.competitiveLandscape.featureComparison.features.map((feature, featureIdx) => (
                  <tr 
                    key={featureIdx}
                    style={{ 
                      borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                    }}
                  >
                    <td className="p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                      {feature}
                    </td>
                    <td className="text-center p-3">
                      {data.competitiveLandscape.featureComparison!.us[featureIdx] ? (
                        <CheckCircle className="w-5 h-5 inline-block text-emerald-500" />
                      ) : (
                        <XCircle className="w-5 h-5 inline-block text-red-500" />
                      )}
                    </td>
                    {data.competitiveLandscape.featureComparison!.competitors.map((comp, compIdx) => (
                      <td key={compIdx} className="text-center p-3">
                        {comp.hasFeature[featureIdx] ? (
                          <CheckCircle className="w-5 h-5 inline-block text-emerald-500" />
                        ) : (
                          <XCircle className="w-5 h-5 inline-block text-red-500" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Competitive Advantages */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Shield className="w-5 h-5 text-[#6366f1]" />
          Our Competitive Advantages
        </h3>
        <div className="space-y-3">
          {data.competitiveLandscape.competitiveAdvantages.map((advantage, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg flex items-start gap-3"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(16,185,129,0.3)' }}
              >
                <Zap className="w-4 h-4 text-emerald-500" />
              </div>
              <span className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {advantage}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Competitive Threats */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <AlertCircle className="w-5 h-5 text-amber-500" />
          Competitive Threats & Challenges
        </h3>
        <div className="space-y-3">
          {data.competitiveLandscape.threats.map((threat, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg flex items-start gap-3"
              style={{ 
                backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
                border: '1px solid rgba(245,158,11,0.3)'
              }}
            >
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(245,158,11,0.3)' }}
              >
                <AlertCircle className="w-4 h-4 text-amber-500" />
              </div>
              <span className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {threat}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Competitive Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Target className="w-4 h-4" />
          Competitive Assessment Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          {data.companyName || 'The company'} operates in a competitive market with {data.competitiveLandscape.competitors.length} key players. 
          Our competitive position is {data.competitiveLandscape.ourPosition.toLowerCase()} with {data.competitiveLandscape.competitiveAdvantages.length} distinct 
          competitive advantages including proprietary technology and strategic partnerships. While the competitive landscape presents challenges, 
          particularly from well-funded incumbents, the company's unique approach and strong execution capability position it well to 
          capture meaningful market share. Key success factors will be maintaining product differentiation, building customer switching costs, 
          and executing faster than competitors in this rapidly evolving market.
        </p>
      </div>
    </div>
  );
}
