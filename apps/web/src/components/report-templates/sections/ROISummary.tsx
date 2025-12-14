import { DollarSign, Clock, TrendingUp, Sparkles, Target, CheckCircle } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface ROISummaryProps {
  data: DealReportData;
  darkMode: boolean;
}

export function ROISummary({ data, darkMode }: ROISummaryProps) {
  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          ROI Summary: Your DealDecision AI Value
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Estimated savings vs. traditional deal analysis methods
        </p>
      </div>

      {/* Hero Value Statement */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)',
          border: '2px solid rgba(99,102,241,0.4)'
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div 
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
          >
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              Total Value Generated
            </h3>
            <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              By using DealDecision AI for this deal analysis
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Money Saved */}
          <div 
            className="p-5 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.4)'
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
              >
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Cost Savings
                </div>
                <div className="text-3xl" style={{ color: '#10b981' }}>
                  ${data.roiSummary.moneySaved.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              vs. ${(data.roiSummary.moneySaved * 1.5).toLocaleString()}-${(data.roiSummary.moneySaved * 2.5).toLocaleString()} traditional costs
            </div>
          </div>

          {/* Time Saved */}
          <div 
            className="p-5 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.4)'
            }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}
              >
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Time Saved
                </div>
                <div className="text-3xl" style={{ color: '#3b82f6' }}>
                  {data.roiSummary.timeSaved} hrs
                </div>
              </div>
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              vs. {data.roiSummary.vsManualHours} of manual work
            </div>
          </div>
        </div>
      </div>

      {/* What You Saved On */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Target className="w-5 h-5 text-[#6366f1]" />
          What You&apos;re Saving On
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {data.roiSummary.breakdown.map((item, index) => (
            <div 
              key={index}
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-sm flex-1" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                  {item.category}
                </div>
                <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 ml-2" />
              </div>
              <div className="text-xs" style={{ color: '#10b981' }}>
                Saved: {item.saved}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison Table */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          DealDecision AI vs. Traditional Methods
        </h3>
        <div 
          className="rounded-lg overflow-hidden"
          style={{ 
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
          }}
        >
          {/* Table Header */}
          <div 
            className="grid grid-cols-3 gap-4 p-4"
            style={{ 
              backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
              borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>Service</div>
            <div className="text-sm text-center" style={{ color: darkMode ? '#fff' : '#000' }}>Traditional Method</div>
            <div className="text-sm text-center" style={{ color: darkMode ? '#fff' : '#000' }}>DealDecision AI</div>
          </div>

          {/* Table Rows */}
          {[
            { service: 'Legal Document Review', traditional: '$5K-$15K', ai: 'Included' },
            { service: 'Due Diligence Analysis', traditional: '$8K-$25K', ai: 'Included' },
            { service: 'Market Research', traditional: '$3K-$8K', ai: 'Included' },
            { service: 'Financial Modeling', traditional: '$2K-$5K', ai: 'Included' },
            { service: 'Timeline', traditional: '4-8 weeks', ai: '2-3 days' },
            { service: 'Quality & Consistency', traditional: 'Variable', ai: 'AI-Powered Excellence' }
          ].map((row, index) => (
            <div 
              key={index}
              className="grid grid-cols-3 gap-4 p-4"
              style={{ 
                backgroundColor: index % 2 === 0 
                  ? (darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)')
                  : 'transparent',
                borderBottom: index < 5 ? `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` : 'none'
              }}
            >
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                {row.service}
              </div>
              <div className="text-sm text-center" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                {row.traditional}
              </div>
              <div 
                className="text-sm text-center flex items-center justify-center gap-2"
                style={{ color: '#10b981' }}
              >
                <CheckCircle className="w-4 h-4" />
                {row.ai}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div 
        className="p-5 rounded-lg text-center"
        style={{ 
          backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)',
          border: '1px solid rgba(139,92,246,0.3)'
        }}
      >
        <TrendingUp className="w-8 h-8 mx-auto mb-3" style={{ color: '#8b5cf6' }} />
        <h4 className="text-lg mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Continue Building Your Success
        </h4>
        <p className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
          Every deal you analyze with DealDecision AI saves you time and money while improving quality. 
          Keep tracking your cumulative savings in your ROI Calculator dashboard!
        </p>
        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
          💡 Tip: Share these savings metrics with stakeholders to demonstrate platform value
        </div>
      </div>
    </div>
  );
}
