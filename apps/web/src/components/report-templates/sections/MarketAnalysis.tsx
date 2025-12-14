import { Target, TrendingUp, Users, Shield, BarChart3, Zap } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface MarketAnalysisProps {
  data: DealReportData;
  darkMode: boolean;
}

export function MarketAnalysis({ data, darkMode }: MarketAnalysisProps) {
  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Market Analysis
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Market size, opportunity, and competitive landscape
        </p>
      </div>

      {/* Market Score */}
      <div 
        className="p-5 rounded-xl text-center"
        style={{ 
          backgroundColor: 'rgba(16,185,129,0.1)',
          border: '2px solid rgba(16,185,129,0.3)'
        }}
      >
        <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
          Market Validation Score
        </div>
        <div className="text-5xl mb-2" style={{ color: '#10b981' }}>
          {data.marketScore}/100
        </div>
        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Excellent market opportunity with strong validation
        </div>
      </div>

      {/* Market Size Overview */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Target className="w-5 h-5 text-[#6366f1]" />
          Market Size & Opportunity
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
              border: '1px solid rgba(99,102,241,0.3)'
            }}
          >
            <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Total Addressable Market (TAM)
            </div>
            <div className="text-3xl mb-2" style={{ color: '#6366f1' }}>
              {data.marketAnalysis.tam}
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Global market size
            </div>
          </div>

          {data.marketAnalysis.sam && (
            <div 
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)',
                border: '1px solid rgba(139,92,246,0.3)'
              }}
            >
              <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Serviceable Available Market (SAM)
              </div>
              <div className="text-3xl mb-2" style={{ color: '#8b5cf6' }}>
                {data.marketAnalysis.sam}
              </div>
              <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                Reachable market segment
              </div>
            </div>
          )}

          {data.marketAnalysis.som && (
            <div 
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Serviceable Obtainable Market (SOM)
              </div>
              <div className="text-3xl mb-2" style={{ color: '#10b981' }}>
                {data.marketAnalysis.som}
              </div>
              <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                Realistic capture in 3-5 years
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Market Dynamics */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <TrendingUp className="w-5 h-5 text-[#6366f1]" />
          Market Dynamics
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Market Growth Rate
            </div>
            <div className="text-2xl" style={{ color: '#10b981' }}>
              {data.marketAnalysis.marketGrowthRate}
            </div>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Target Market Share
            </div>
            <div className="text-2xl" style={{ color: '#6366f1' }}>
              {data.marketAnalysis.targetMarketShare}
            </div>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Competitive Position
            </div>
            <div className="text-2xl" style={{ color: '#8b5cf6' }}>
              {data.marketAnalysis.competitivePosition}
            </div>
          </div>
        </div>
      </div>

      {/* Competitive Landscape */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Users className="w-5 h-5 text-[#6366f1]" />
          Competitive Landscape
        </h3>
        <div className="space-y-3">
          {data.marketAnalysis.keyCompetitors.map((competitor, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {competitor.name}
                </div>
                <div 
                  className="text-xs px-2 py-1 rounded"
                  style={{ 
                    backgroundColor: 'rgba(99,102,241,0.2)',
                    color: '#6366f1'
                  }}
                >
                  Competitor {index + 1}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: 'rgba(16,185,129,0.1)',
                    border: '1px solid rgba(16,185,129,0.2)'
                  }}
                >
                  <div className="text-xs mb-1" style={{ color: '#10b981' }}>
                    Their Strength
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {competitor.strength}
                  </div>
                </div>
                
                <div 
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.2)'
                  }}
                >
                  <div className="text-xs mb-1" style={{ color: '#ef4444' }}>
                    Their Weakness
                  </div>
                  <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {competitor.weakness}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Market Trends */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Zap className="w-5 h-5 text-[#6366f1]" />
          Key Market Trends
        </h3>
        <div className="space-y-2">
          {data.marketAnalysis.marketTrends.map((trend, index) => (
            <div 
              key={index}
              className="p-3 rounded-lg flex items-start gap-3"
              style={{ 
                backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                border: '1px solid rgba(99,102,241,0.2)'
              }}
            >
              <div 
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgba(99,102,241,0.3)' }}
              >
                <TrendingUp className="w-3 h-3" style={{ color: '#6366f1' }} />
              </div>
              <span className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {trend}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Barriers to Entry / Competitive Moats */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Shield className="w-5 h-5 text-[#6366f1]" />
          Competitive Moats & Barriers to Entry
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {data.marketAnalysis.barriers.map((barrier, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                  {barrier}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Market Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <BarChart3 className="w-4 h-4" />
          Market Analysis Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          The market opportunity is exceptionally strong with a TAM of {data.marketAnalysis.tam} growing at {data.marketAnalysis.marketGrowthRate}. 
          The company has established clear competitive differentiation and built meaningful barriers to entry. 
          Market timing appears optimal with favorable secular trends accelerating adoption. 
          The target of capturing {data.marketAnalysis.targetMarketShare} appears achievable given current traction and competitive positioning.
        </p>
      </div>
    </div>
  );
}
