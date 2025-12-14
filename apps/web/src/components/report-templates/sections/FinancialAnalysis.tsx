import { DollarSign, TrendingUp, AlertCircle, CheckCircle, BarChart3, Target, Zap } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface FinancialAnalysisProps {
  data: DealReportData;
  darkMode: boolean;
}

export function FinancialAnalysis({ data, darkMode }: FinancialAnalysisProps) {
  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Financial Analysis
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Revenue projections, unit economics, and financial health
        </p>
      </div>

      {/* Financial Score */}
      <div 
        className="p-5 rounded-xl text-center"
        style={{ 
          backgroundColor: 'rgba(245,158,11,0.1)',
          border: '2px solid rgba(245,158,11,0.3)'
        }}
      >
        <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
          Financial Strength Score
        </div>
        <div className="text-5xl mb-2" style={{ color: '#f59e0b' }}>
          {data.financialScore}/100
        </div>
        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Strong financials with solid unit economics
        </div>
      </div>

      {/* Current Metrics */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <DollarSign className="w-5 h-5 text-[#6366f1]" />
          Current Financial Metrics
        </h3>
        <div className="grid grid-cols-4 gap-4">
          {data.financialAnalysis.currentArr && (
            <div 
              className="p-4 rounded-lg"
              style={{ 
                backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Current ARR
              </div>
              <div className="text-2xl mb-1" style={{ color: '#10b981' }}>
                {data.financialAnalysis.currentArr}
              </div>
              <div className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
                <TrendingUp className="w-3 h-3" />
                Growing
              </div>
            </div>
          )}

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Monthly Burn Rate
            </div>
            <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              {data.financialAnalysis.burnRate}
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Operating expenses
            </div>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Runway
            </div>
            <div className="text-2xl mb-1" style={{ color: '#6366f1' }}>
              {data.financialAnalysis.runway}
            </div>
            <div className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
              <CheckCircle className="w-3 h-3" />
              Healthy
            </div>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Break-even
            </div>
            <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              {data.financialAnalysis.breakEvenMonth}
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
              Projected
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Projections */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <TrendingUp className="w-5 h-5 text-[#6366f1]" />
          Revenue Projections
        </h3>
        <div 
          className="rounded-lg overflow-hidden"
          style={{ 
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
          }}
        >
          {/* Table Header */}
          <div 
            className="grid grid-cols-4 gap-4 p-4"
            style={{ 
              backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
              borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>Year</div>
            <div className="text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>Revenue</div>
            <div className="text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>Expenses</div>
            <div className="text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>Profit/Loss</div>
          </div>

          {/* Table Rows */}
          {data.financialAnalysis.projections.map((projection, index) => {
            const isProfitable = projection.profit.startsWith('$') && !projection.profit.startsWith('-');
            return (
              <div 
                key={index}
                className="grid grid-cols-4 gap-4 p-4"
                style={{ 
                  backgroundColor: index % 2 === 0 
                    ? (darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)')
                    : 'transparent',
                  borderBottom: index < data.financialAnalysis.projections.length - 1 
                    ? `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` 
                    : 'none'
                }}
              >
                <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                  {projection.year}
                </div>
                <div className="text-sm text-right" style={{ color: '#10b981' }}>
                  {projection.revenue}
                </div>
                <div className="text-sm text-right" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  {projection.expenses}
                </div>
                <div 
                  className="text-sm text-right flex items-center justify-end gap-2"
                  style={{ color: isProfitable ? '#10b981' : '#ef4444' }}
                >
                  {isProfitable ? <TrendingUp className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {projection.profit}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unit Economics */}
      {(data.financialAnalysis.grossMargin || data.financialAnalysis.ltv || data.financialAnalysis.cac) && (
        <div>
          <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
            <Target className="w-5 h-5 text-[#6366f1]" />
            Unit Economics
          </h3>
          <div className="grid grid-cols-4 gap-4">
            {data.financialAnalysis.grossMargin && (
              <div 
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
                  border: '1px solid rgba(16,185,129,0.3)'
                }}
              >
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Gross Margin
                </div>
                <div className="text-3xl mb-1" style={{ color: '#10b981' }}>
                  {data.financialAnalysis.grossMargin}
                </div>
                <div className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
                  <CheckCircle className="w-3 h-3" />
                  Excellent
                </div>
              </div>
            )}

            {data.financialAnalysis.ltv && (
              <div 
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Customer LTV
                </div>
                <div className="text-3xl mb-1" style={{ color: '#6366f1' }}>
                  {data.financialAnalysis.ltv}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  Lifetime value
                </div>
              </div>
            )}

            {data.financialAnalysis.cac && (
              <div 
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  CAC
                </div>
                <div className="text-3xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {data.financialAnalysis.cac}
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  Acquisition cost
                </div>
              </div>
            )}

            {data.financialAnalysis.ltvCacRatio && (
              <div 
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)',
                  border: '1px solid rgba(139,92,246,0.3)'
                }}
              >
                <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  LTV:CAC Ratio
                </div>
                <div className="text-3xl mb-1" style={{ color: '#8b5cf6' }}>
                  {data.financialAnalysis.ltvCacRatio}
                </div>
                <div className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
                  <Zap className="w-3 h-3" />
                  Outstanding
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Key Financial Highlights */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <BarChart3 className="w-5 h-5 text-[#6366f1]" />
          Key Financial Highlights
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#10b981' }}>
              <CheckCircle className="w-4 h-4" />
              Strengths
            </h4>
            <ul className="space-y-2">
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Strong revenue growth trajectory with {data.financialAnalysis.projections[data.financialAnalysis.projections.length - 1].revenue} by Y{data.financialAnalysis.projections.length}</span>
              </li>
              {data.financialAnalysis.grossMargin && (
                <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>Excellent gross margins at {data.financialAnalysis.grossMargin}</span>
                </li>
              )}
              {data.financialAnalysis.ltvCacRatio && (
                <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>Outstanding unit economics with {data.financialAnalysis.ltvCacRatio} LTV:CAC</span>
                </li>
              )}
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Clear path to profitability by {data.financialAnalysis.breakEvenMonth}</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-emerald-500 mt-0.5">•</span>
                <span>Healthy runway of {data.financialAnalysis.runway}</span>
              </li>
            </ul>
          </div>

          <div 
            className="p-4 rounded-lg"
            style={{ 
              backgroundColor: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
              border: '1px solid rgba(245,158,11,0.3)'
            }}
          >
            <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#f59e0b' }}>
              <AlertCircle className="w-4 h-4" />
              Considerations
            </h4>
            <ul className="space-y-2">
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Monitor burn rate closely as team scales</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Revenue assumptions should be stress-tested for downside scenarios</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Customer acquisition cost may increase as market matures</span>
              </li>
              <li className="text-xs flex items-start gap-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Plan for potential follow-on funding if milestones slip</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Financial Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <DollarSign className="w-4 h-4" />
          Financial Analysis Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          The financial model demonstrates strong fundamentals with impressive unit economics 
          {data.financialAnalysis.ltvCacRatio && ` (${data.financialAnalysis.ltvCacRatio} LTV:CAC ratio)`}
          {data.financialAnalysis.grossMargin && ` and healthy gross margins (${data.financialAnalysis.grossMargin})`}.
          Revenue projections from {data.financialAnalysis.year1Revenue} to {data.financialAnalysis.year3Revenue} by Year 3 
          appear realistic based on current traction and market dynamics. The company maintains a comfortable runway of {data.financialAnalysis.runway} 
          with a clear path to break-even by {data.financialAnalysis.breakEvenMonth}. Overall financial health is strong, 
          though CAC assumptions should be monitored as the company scales into broader market segments.
        </p>
      </div>
    </div>
  );
}
