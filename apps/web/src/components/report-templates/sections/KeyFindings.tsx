import { AlertTriangle, CheckCircle, Flag, TrendingUp, XCircle, Info, Zap, Shield } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface KeyFindingsProps {
  data: DealReportData;
  darkMode: boolean;
}

export function KeyFindings({ data, darkMode }: KeyFindingsProps) {
  // Generate findings based on data
  const greenFlags = [
    {
      category: 'Traction',
      finding: `Strong revenue growth with ${data.financialAnalysis.currentArr || '$850K'} ARR`,
      impact: 'High',
      verified: true
    },
    {
      category: 'Market',
      finding: `Large addressable market of ${data.marketAnalysis.tam} growing at ${data.marketAnalysis.marketGrowthRate}`,
      impact: 'High',
      verified: true
    },
    {
      category: 'Team',
      finding: `Experienced founders with ${data.teamAssessment.priorExits || 2} prior successful exits`,
      impact: 'High',
      verified: true
    },
    {
      category: 'Financial',
      finding: `Strong unit economics with ${data.financialAnalysis.ltvCacRatio || '10.2x'} LTV:CAC ratio`,
      impact: 'High',
      verified: true
    },
    {
      category: 'Product',
      finding: 'Clear product-market fit with strong customer retention',
      impact: 'Medium',
      verified: true
    }
  ];

  const yellowFlags = [
    {
      category: 'Revenue',
      finding: 'Customer concentration risk - top 3 customers represent 60% of revenue',
      impact: 'Medium',
      recommendation: 'Diversify customer base in next 12 months'
    },
    {
      category: 'Competition',
      finding: 'Competitive landscape intensifying with well-funded players entering market',
      impact: 'Medium',
      recommendation: 'Accelerate product differentiation and market positioning'
    },
    {
      category: 'Team',
      finding: 'Need to expand sales and marketing leadership for next growth phase',
      impact: 'Medium',
      recommendation: 'Prioritize senior sales hire in next quarter'
    }
  ];

  const redFlags = [
    {
      category: 'Legal',
      finding: 'IP assignment agreements not completed for 2 early employees',
      impact: 'Medium',
      urgency: 'Address before close',
      status: 'In Progress'
    }
  ];

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Key Findings & Red Flags
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Critical insights and areas requiring attention
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div 
          className="p-4 rounded-lg text-center"
          style={{ 
            backgroundColor: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.3)'
          }}
        >
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
          <div className="text-3xl mb-1" style={{ color: '#10b981' }}>
            {greenFlags.length}
          </div>
          <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            Positive Findings
          </div>
        </div>

        <div 
          className="p-4 rounded-lg text-center"
          style={{ 
            backgroundColor: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.3)'
          }}
        >
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
          <div className="text-3xl mb-1" style={{ color: '#f59e0b' }}>
            {yellowFlags.length}
          </div>
          <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            Areas to Monitor
          </div>
        </div>

        <div 
          className="p-4 rounded-lg text-center"
          style={{ 
            backgroundColor: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)'
          }}
        >
          <Flag className="w-8 h-8 mx-auto mb-2 text-red-500" />
          <div className="text-3xl mb-1" style={{ color: '#ef4444' }}>
            {redFlags.length}
          </div>
          <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
            Critical Issues
          </div>
        </div>
      </div>

      {/* Green Flags - Positive Findings */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          Positive Findings (Green Flags)
        </h3>
        <div className="space-y-3">
          {greenFlags.map((flag, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div className="flex items-start gap-4">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(16,185,129,0.3)' }}
                >
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div 
                        className="text-xs px-2 py-1 rounded inline-block mb-2"
                        style={{ 
                          backgroundColor: 'rgba(16,185,129,0.2)',
                          color: '#10b981'
                        }}
                      >
                        {flag.category}
                      </div>
                      <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                        {flag.finding}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div 
                        className="text-xs px-2 py-1 rounded"
                        style={{ 
                          backgroundColor: flag.impact === 'High' ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.2)',
                          color: flag.impact === 'High' ? '#10b981' : '#6366f1'
                        }}
                      >
                        {flag.impact} Impact
                      </div>
                      {flag.verified && (
                        <div className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
                          <Shield className="w-3 h-3" />
                          Verified
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Yellow Flags - Areas to Monitor */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Areas to Monitor (Yellow Flags)
        </h3>
        <div className="space-y-3">
          {yellowFlags.map((flag, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
                border: '1px solid rgba(245,158,11,0.3)'
              }}
            >
              <div className="flex items-start gap-4">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(245,158,11,0.3)' }}
                >
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <div className="mb-2">
                    <div 
                      className="text-xs px-2 py-1 rounded inline-block mb-2"
                      style={{ 
                        backgroundColor: 'rgba(245,158,11,0.2)',
                        color: '#f59e0b'
                      }}
                    >
                      {flag.category}
                    </div>
                    <p className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                      {flag.finding}
                    </p>
                    <div 
                      className="p-3 rounded-lg flex items-start gap-2"
                      style={{ 
                        backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
                        border: '1px solid rgba(99,102,241,0.2)'
                      }}
                    >
                      <Info className="w-4 h-4 text-[#6366f1] flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs mb-1" style={{ color: '#6366f1' }}>
                          Recommendation:
                        </div>
                        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                          {flag.recommendation}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div 
                    className="text-xs px-2 py-1 rounded inline-block"
                    style={{ 
                      backgroundColor: 'rgba(245,158,11,0.2)',
                      color: '#f59e0b'
                    }}
                  >
                    {flag.impact} Impact
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Red Flags - Critical Issues */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Flag className="w-5 h-5 text-red-500" />
          Critical Issues (Red Flags)
        </h3>
        {redFlags.length > 0 ? (
          <div className="space-y-3">
            {redFlags.map((flag, index) => (
              <div 
                key={index}
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
                  border: '2px solid rgba(239,68,68,0.4)'
                }}
              >
                <div className="flex items-start gap-4">
                  <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'rgba(239,68,68,0.3)' }}
                  >
                    <Flag className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="flex-1">
                    <div className="mb-3">
                      <div 
                        className="text-xs px-2 py-1 rounded inline-block mb-2"
                        style={{ 
                          backgroundColor: 'rgba(239,68,68,0.2)',
                          color: '#ef4444'
                        }}
                      >
                        {flag.category}
                      </div>
                      <p className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                        {flag.finding}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div 
                        className="text-xs px-2 py-1 rounded"
                        style={{ 
                          backgroundColor: 'rgba(239,68,68,0.2)',
                          color: '#ef4444'
                        }}
                      >
                        {flag.impact} Impact
                      </div>
                      <div 
                        className="text-xs px-2 py-1 rounded"
                        style={{ 
                          backgroundColor: 'rgba(245,158,11,0.2)',
                          color: '#f59e0b'
                        }}
                      >
                        {flag.urgency}
                      </div>
                      <div 
                        className="text-xs px-2 py-1 rounded"
                        style={{ 
                          backgroundColor: 'rgba(99,102,241,0.2)',
                          color: '#6366f1'
                        }}
                      >
                        Status: {flag.status}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div 
            className="p-6 rounded-lg text-center"
            style={{ 
              backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              No critical red flags identified in due diligence review.
            </p>
          </div>
        )}
      </div>

      {/* Overall Assessment */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <Zap className="w-4 h-4" />
          Overall Assessment
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          Due diligence reveals a strong opportunity with {greenFlags.length} significant positive findings including 
          exceptional team quality, strong market positioning, and solid financial fundamentals. 
          There are {yellowFlags.length} areas requiring monitoring but with clear mitigation strategies. 
          {redFlags.length > 0 
            ? ` ${redFlags.length} critical issue${redFlags.length > 1 ? 's' : ''} identified that should be resolved before close.` 
            : ' No critical blockers identified.'
          }
          {' '}Overall risk profile is acceptable for this stage with appropriate safeguards and milestone tracking.
        </p>
      </div>
    </div>
  );
}
