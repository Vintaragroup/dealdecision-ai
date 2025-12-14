import { TrendingUp, Users, DollarSign, Calendar, Target, Award, BarChart3, PieChart, Zap, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface TractionMetricsProps {
  data: DealReportData;
  darkMode: boolean;
}

export function TractionMetrics({ data, darkMode }: TractionMetricsProps) {
  const maxRevenue = Math.max(...data.tractionMetrics.growthTrajectory.map(d => d.revenue));
  const maxCustomers = Math.max(...data.tractionMetrics.growthTrajectory.map(d => d.customers));

  return (
    <div className="report-section space-y-6">
      {/* Section Header */}
      <div className="border-b pb-4" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
        <h2 className="text-2xl mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          Customer & Traction Metrics
        </h2>
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
          Growth trajectory, customer acquisition, and retention analysis
        </p>
      </div>

      {/* Key Metrics Dashboard */}
      <div className="grid grid-cols-4 gap-4">
        <div 
          className="p-4 rounded-lg"
          style={{ 
            background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)',
            border: '2px solid rgba(99,102,241,0.4)'
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              <Users className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              Total Customers
            </span>
          </div>
          <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.tractionMetrics.totalCustomers}
          </div>
          <div className="flex items-center gap-1 text-xs" style={{ color: '#10b981' }}>
            <ArrowUp className="w-3 h-3" />
            <span>{data.tractionMetrics.monthlyGrowthRate}% MoM</span>
          </div>
        </div>

        <div 
          className="p-4 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
            border: '2px solid rgba(16,185,129,0.4)'
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#10b981' }}
            >
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              NRR
            </span>
          </div>
          <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.tractionMetrics.nrr}%
          </div>
          <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
            Net Revenue Retention
          </div>
        </div>

        <div 
          className="p-4 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.1)',
            border: '2px solid rgba(245,158,11,0.4)'
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#f59e0b' }}
            >
              <DollarSign className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              Avg Deal Size
            </span>
          </div>
          <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.tractionMetrics.avgDealSize}
          </div>
          <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
            Per customer
          </div>
        </div>

        <div 
          className="p-4 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
            border: '2px solid rgba(239,68,68,0.4)'
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#ef4444' }}
            >
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              Churn Rate
            </span>
          </div>
          <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
            {data.tractionMetrics.churnRate}%
          </div>
          <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
            Monthly
          </div>
        </div>
      </div>

      {/* Growth Trajectory Chart */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <BarChart3 className="w-5 h-5 text-[#6366f1]" />
          Growth Trajectory (11 Months)
        </h3>
        <div 
          className="p-5 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
          }}
        >
          {/* Mini chart visualization */}
          <div className="flex items-end gap-2 h-40 mb-4">
            {data.tractionMetrics.growthTrajectory.map((point, index) => {
              const heightPercentage = (point.revenue / maxRevenue) * 100;
              return (
                <div key={index} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs" style={{ color: '#6366f1' }}>
                    ${Math.round(point.mrr / 1000)}K
                  </div>
                  <div 
                    className="w-full rounded-t transition-all duration-300 relative group cursor-pointer"
                    style={{ 
                      height: `${heightPercentage}%`,
                      background: 'linear-gradient(to top, #6366f1, #8b5cf6)',
                      minHeight: '10px'
                    }}
                  >
                    <div 
                      className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10"
                    >
                      {point.customers} customers
                    </div>
                  </div>
                  <div className="text-xs mt-1 rotate-45 origin-left" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                    {point.month.split(' ')[0]}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-4 pt-4 border-t" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
            <div>
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Starting MRR
              </div>
              <div className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
                ${Math.round(data.tractionMetrics.growthTrajectory[0].mrr).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Current MRR
              </div>
              <div className="text-lg" style={{ color: '#10b981' }}>
                ${Math.round(data.tractionMetrics.growthTrajectory[data.tractionMetrics.growthTrajectory.length - 1].mrr).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Segmentation */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <PieChart className="w-5 h-5 text-[#6366f1]" />
          Customer Segmentation by Industry
        </h3>
        <div className="space-y-3">
          {data.tractionMetrics.customerSegmentation.map((segment, index) => {
            const colors = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
            const color = colors[index % colors.length];
            return (
              <div 
                key={index}
                className="p-4 rounded-lg"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {segment.segment}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      {segment.count} customers
                    </span>
                    <span className="text-sm" style={{ color }}>
                      {segment.avgValue}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ 
                    backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                  }}>
                    <div 
                      className="h-full transition-all duration-500 rounded-full"
                      style={{ 
                        width: `${segment.percentage}%`,
                        backgroundColor: color
                      }}
                    />
                  </div>
                  <span className="text-xs w-12 text-right" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                    {segment.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Conversion Funnel */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Target className="w-5 h-5 text-[#6366f1]" />
          Sales Conversion Funnel
        </h3>
        <div className="space-y-2">
          {data.tractionMetrics.conversionFunnel.map((stage, index) => {
            const widthPercentage = (stage.count / data.tractionMetrics.conversionFunnel[0].count) * 100;
            return (
              <div 
                key={index}
                className="relative"
              >
                <div 
                  className="p-4 rounded-lg transition-all duration-500"
                  style={{ 
                    width: `${Math.max(widthPercentage, 30)}%`,
                    background: `linear-gradient(135deg, rgba(99,102,241,${0.9 - index * 0.12}) 0%, rgba(139,92,246,${0.9 - index * 0.12}) 100%)`,
                    border: '1px solid rgba(99,102,241,0.4)'
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm" style={{ color: '#fff' }}>
                        {stage.stage}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        {stage.count} {stage.count === 1 ? 'prospect' : 'prospects'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg" style={{ color: '#fff' }}>
                        {stage.conversion}%
                      </div>
                      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        conversion
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div 
          className="mt-4 p-4 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
            border: '1px solid rgba(16,185,129,0.3)'
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                Overall Conversion Rate
              </div>
              <div className="text-xs mt-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Lead to Closed Won
              </div>
            </div>
            <div className="text-2xl" style={{ color: '#10b981' }}>
              {((data.tractionMetrics.conversionFunnel[data.tractionMetrics.conversionFunnel.length - 1].count / data.tractionMetrics.conversionFunnel[0].count) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Cohort Analysis */}
      <div>
        <h3 className="text-lg mb-4 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <Award className="w-5 h-5 text-[#6366f1]" />
          Cohort Retention Analysis
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
                  Cohort Month
                </th>
                <th className="text-center p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Customers
                </th>
                <th className="text-center p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Retention
                </th>
                <th className="text-right p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {data.tractionMetrics.cohortData.slice(-6).map((cohort, index) => (
                <tr 
                  key={index}
                  style={{ 
                    borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                  }}
                >
                  <td className="p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                    {cohort.month}
                  </td>
                  <td className="text-center p-3" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {cohort.customers}
                  </td>
                  <td className="text-center p-3">
                    <div className="flex items-center justify-center gap-2">
                      <div 
                        className="px-2 py-1 rounded text-xs"
                        style={{ 
                          backgroundColor: cohort.retention >= 70 
                            ? 'rgba(16,185,129,0.2)' 
                            : cohort.retention >= 50 
                            ? 'rgba(245,158,11,0.2)' 
                            : 'rgba(239,68,68,0.2)',
                          color: cohort.retention >= 70 
                            ? '#10b981' 
                            : cohort.retention >= 50 
                            ? '#f59e0b' 
                            : '#ef4444'
                        }}
                      >
                        {cohort.retention}%
                      </div>
                    </div>
                  </td>
                  <td className="text-right p-3" style={{ color: '#6366f1' }}>
                    {cohort.revenue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Customers & Sales Cycle */}
      <div className="grid grid-cols-2 gap-4">
        <div 
          className="p-5 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
            border: '1px solid rgba(99,102,241,0.3)'
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
            <Zap className="w-4 h-4" />
            Top Customers
          </h4>
          <div className="space-y-2">
            {data.tractionMetrics.topCustomers.map((customer, index) => (
              <div 
                key={index}
                className="flex items-center gap-2 p-2 rounded"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'
                }}
              >
                <div 
                  className="w-6 h-6 rounded flex items-center justify-center text-xs"
                  style={{ 
                    backgroundColor: 'rgba(99,102,241,0.3)',
                    color: '#6366f1'
                  }}
                >
                  {index + 1}
                </div>
                <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)' }}>
                  {customer}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div 
          className="p-5 rounded-lg"
          style={{ 
            backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)',
            border: '1px solid rgba(139,92,246,0.3)'
          }}
        >
          <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#8b5cf6' }}>
            <Calendar className="w-4 h-4" />
            Sales Metrics
          </h4>
          <div className="space-y-4">
            <div>
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Average Sales Cycle
              </div>
              <div className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
                {data.tractionMetrics.salesCycle}
              </div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                Growth Rate
              </div>
              <div className="text-2xl flex items-center gap-2" style={{ color: '#10b981' }}>
                {data.tractionMetrics.monthlyGrowthRate}%
                <ArrowUp className="w-5 h-5" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div 
        className="p-5 rounded-lg"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.3)'
        }}
      >
        <h4 className="text-sm mb-3 flex items-center gap-2" style={{ color: '#6366f1' }}>
          <TrendingUp className="w-4 h-4" />
          Traction Summary
        </h4>
        <p className="text-sm leading-relaxed" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
          {data.companyName || 'The company'} demonstrates strong customer traction with {data.tractionMetrics.totalCustomers} total customers 
          and impressive {data.tractionMetrics.monthlyGrowthRate}% month-over-month growth. The {data.tractionMetrics.nrr}% net revenue retention 
          rate indicates excellent customer satisfaction and expansion opportunities. With an average deal size of {data.tractionMetrics.avgDealSize} and 
          a {data.tractionMetrics.salesCycle} sales cycle, the company shows efficient go-to-market execution. The low {data.tractionMetrics.churnRate}% 
          churn rate demonstrates product-market fit. Customer base is well-diversified across {data.tractionMetrics.customerSegmentation.length} industry 
          segments, reducing concentration risk. Overall conversion rate of {((data.tractionMetrics.conversionFunnel[data.tractionMetrics.conversionFunnel.length - 1].count / data.tractionMetrics.conversionFunnel[0].count) * 100).toFixed(1)}% 
          from lead to closed-won shows strong sales effectiveness.
        </p>
      </div>
    </div>
  );
}
