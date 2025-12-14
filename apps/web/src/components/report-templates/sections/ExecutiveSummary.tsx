import { CheckCircle, AlertCircle, TrendingUp, Target } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface ExecutiveSummaryProps {
  data: DealReportData;
  darkMode: boolean;
}

export function ExecutiveSummary({ data, darkMode }: ExecutiveSummaryProps) {
  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Executive Summary
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Comprehensive overview and key highlights
        </p>
      </div>

      {/* Deal Overview */}
      <div>
        <h3 className="text-lg mb-3" style={{ color: darkMode ? '#fff' : '#000' }}>
          Overview
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          {data.executiveSummary.overview}
        </p>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-lg" style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}>
          <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
            Stage
          </div>
          <div className="text-lg font-semibold" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.stage}
          </div>
        </div>
        
        <div className="p-4 rounded-lg" style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}>
          <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
            Funding Amount
          </div>
          <div className="text-lg font-semibold" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.fundingAmount}
          </div>
        </div>
        
        <div className="p-4 rounded-lg" style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}>
          <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
            Valuation
          </div>
          <div className="text-lg font-semibold" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.valuation}
          </div>
        </div>
        
        <div className="p-4 rounded-lg" style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}>
          <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
            Industry
          </div>
          <div className="text-lg font-semibold" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.industry}
          </div>
        </div>
      </div>

      {/* Investment Thesis */}
      <div>
        <h3 className="text-lg mb-3" style={{ color: darkMode ? '#fff' : '#000' }}>
          Investment Thesis
        </h3>
        <div className="p-4 rounded-lg" style={{ 
          backgroundColor: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}>
          <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
            {data.executiveSummary.investmentThesis}
          </p>
        </div>
      </div>

      {/* Key Highlights */}
      <div>
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          Key Highlights
        </h3>
        <div className="space-y-2">
          {data.executiveSummary.keyHighlights.map((highlight, index) => (
            <div 
              key={index}
              className="flex items-start gap-3 p-3 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: `1px solid ${darkMode ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)'}`
              }}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ 
                backgroundColor: 'rgba(16,185,129,0.2)'
              }}>
                <span className="text-xs text-emerald-500">{index + 1}</span>
              </div>
              <span className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {highlight}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Key Risks */}
      <div>
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <AlertCircle className="w-5 h-5 text-amber-500" />
          Key Risks & Considerations
        </h3>
        <div className="space-y-2">
          {data.executiveSummary.keyRisks.map((risk, index) => (
            <div 
              key={index}
              className="flex items-start gap-3 p-3 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
                border: `1px solid ${darkMode ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.2)'}`
              }}
            >
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {risk}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Score Summary */}
      <div>
        <h3 className="text-lg mb-3" style={{ color: darkMode ? '#fff' : '#000' }}>
          Score Summary
        </h3>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Overall Score', value: data.investorScore, color: '#6366f1' },
            { label: 'Market', value: data.marketScore, color: '#10b981' },
            { label: 'Financial', value: data.financialScore, color: '#f59e0b' },
            { label: 'Team', value: data.teamScore, color: '#8b5cf6' }
          ].map((score, index) => (
            <div 
              key={index}
              className="text-center p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="text-3xl mb-1" style={{ color: score.color }}>
                {score.value}
              </div>
              <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {score.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
