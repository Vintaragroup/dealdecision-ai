import { 
  FileText, 
  TrendingUp, 
  Shield, 
  Users, 
  CheckCircle, 
  DollarSign,
  Vote,
  Clock,
  Lock,
  Target,
  Award,
  BarChart3,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { DealReportData } from '../lib/report-config';

interface DealTermsSummaryProps {
  data: DealReportData;
  darkMode: boolean;
}

export function DealTermsSummary({ data, darkMode }: DealTermsSummaryProps) {
  // In a real app, this data would come from the data prop
  // For now, using mock data as this is a new section
  const dealTerms = {
    securityType: 'Series A Preferred Stock',
    investmentAmount: '$5.0M',
    preMoney: '$15.0M',
    postMoney: '$20.0M',
    investorOwnership: '25.0%',
    pricePerShare: '$2.50',
    shares: '2,000,000',
    liquidationPreference: '1x Non-Participating',
    antiDilution: 'Broad-based weighted average',
    boardSeats: '2 of 5 seats (40%)'
  };

  return (
    <div className="report-section space-y-8">
      {/* Cover Page */}
      <div className="min-h-screen flex flex-col justify-center items-center p-12 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-20 w-96 h-96 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10 text-center max-w-3xl">
          <div className="mb-8 flex justify-center">
            <div 
              className="p-6 rounded-2xl backdrop-blur-sm"
              style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
            >
              <FileText className="w-16 h-16" style={{ color: darkMode ? '#34d399' : '#10b981' }} />
            </div>
          </div>
          
          <h1 className="text-5xl mb-6" style={{ color: darkMode ? '#fff' : '#000' }}>
            Deal Terms Summary
          </h1>
          
          <p className="text-xl mb-8" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
            Comprehensive Analysis of Investment Structure & Key Terms
          </p>
          
          <div 
            className="inline-block px-6 py-3 rounded-full border"
            style={{
              backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.1)',
              borderColor: darkMode ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.3)'
            }}
          >
            <span className="text-sm" style={{ color: darkMode ? '#34d399' : '#059669' }}>
              Investment Terms • Cap Table • Governance • Vesting
            </span>
          </div>
        </div>
      </div>

      {/* Page 1: Investment Structure & Key Terms */}
      <div className="page-break">
        <div className="space-y-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.1)' }}
              >
                <DollarSign className="w-5 h-5" style={{ color: darkMode ? '#34d399' : '#10b981' }} />
              </div>
              <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
                Investment Structure Overview
              </h2>
            </div>
            <p className="text-base" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              Series A Preferred Stock Financing
            </p>
          </div>

          {/* Executive Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Investment Amount', value: dealTerms.investmentAmount, sublabel: 'Series A', color: '#10b981' },
              { label: 'Pre-Money Valuation', value: dealTerms.preMoney, sublabel: 'Cap Table', color: '#6366f1' },
              { label: 'Post-Money Valuation', value: dealTerms.postMoney, sublabel: 'Fully Diluted', color: '#8b5cf6' },
              { label: 'Investor Ownership', value: dealTerms.investorOwnership, sublabel: 'Post-Financing', color: '#f59e0b' },
            ].map((item, idx) => (
              <div 
                key={idx}
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  {item.label}
                </div>
                <div className="text-xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {item.value}
                </div>
                <div className="text-xs" style={{ color: item.color }}>
                  {item.sublabel}
                </div>
              </div>
            ))}
          </div>

          {/* Key Terms Table */}
          <div 
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
          >
            <div 
              className="px-6 py-4 border-b"
              style={{
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
              }}
            >
              <h3 className="text-base" style={{ color: darkMode ? '#fff' : '#000' }}>
                Key Investment Terms
              </h3>
            </div>
            <div style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : '#fff' }}>
              <table className="w-full">
                <tbody>
                  {[
                    { term: 'Security Type', value: dealTerms.securityType, highlight: false },
                    { term: 'Price Per Share', value: dealTerms.pricePerShare, highlight: false },
                    { term: 'Number of Shares', value: `${dealTerms.shares} shares`, highlight: false },
                    { term: 'Liquidation Preference', value: dealTerms.liquidationPreference, highlight: true },
                    { term: 'Dividend Rate', value: '8% cumulative, non-compounding', highlight: false },
                    { term: 'Conversion Rights', value: 'Convertible to Common at 1:1 ratio', highlight: false },
                    { term: 'Anti-Dilution Protection', value: dealTerms.antiDilution, highlight: true },
                    { term: 'Voting Rights', value: 'Vote on as-converted basis', highlight: false },
                    { term: 'Board Seats', value: dealTerms.boardSeats, highlight: true },
                    { term: 'Redemption Rights', value: 'None', highlight: false },
                  ].map((row, idx) => (
                    <tr 
                      key={idx} 
                      className="border-b"
                      style={{
                        borderColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                        backgroundColor: row.highlight 
                          ? (darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)')
                          : 'transparent'
                      }}
                    >
                      <td className="px-6 py-3 text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {row.term}
                      </td>
                      <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cap Table */}
          <div 
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
          >
            <div 
              className="px-6 py-4 border-b"
              style={{
                backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
              }}
            >
              <h3 className="text-base" style={{ color: darkMode ? '#fff' : '#000' }}>
                Post-Financing Capitalization Table
              </h3>
            </div>
            <div style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : '#fff' }}>
              <table className="w-full">
                <thead 
                  className="border-b"
                  style={{
                    backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                    borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                  }}
                >
                  <tr>
                    <th className="px-6 py-3 text-left text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                      Shareholder
                    </th>
                    <th className="px-6 py-3 text-right text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                      Shares
                    </th>
                    <th className="px-6 py-3 text-right text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                      Ownership %
                    </th>
                    <th className="px-6 py-3 text-right text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Series A Investors', shares: '2,000,000', ownership: '25.0%', value: '$5,000,000', type: 'preferred', typeColor: '#10b981' },
                    { name: 'Founders', shares: '4,500,000', ownership: '56.3%', value: '$11,250,000', type: 'common', typeColor: '#6366f1' },
                    { name: 'Employee Option Pool', shares: '1,000,000', ownership: '12.5%', value: '$2,500,000', type: 'options', typeColor: '#8b5cf6' },
                    { name: 'Angel Investors', shares: '500,000', ownership: '6.2%', value: '$1,250,000', type: 'common', typeColor: '#6366f1' },
                  ].map((row, idx) => (
                    <tr 
                      key={idx}
                      className="border-b"
                      style={{ borderColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                    >
                      <td className="px-6 py-3 text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                        <div className="flex items-center gap-2">
                          {row.name}
                          <span 
                            className="px-2 py-0.5 rounded text-xs"
                            style={{
                              backgroundColor: darkMode ? `${row.typeColor}33` : `${row.typeColor}22`,
                              color: row.typeColor
                            }}
                          >
                            {row.type}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {row.shares}
                      </td>
                      <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {row.ownership}
                      </td>
                      <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>
                        {row.value}
                      </td>
                    </tr>
                  ))}
                  <tr 
                    className="border-t-2"
                    style={{
                      backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                      borderColor: darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
                    }}
                  >
                    <td className="px-6 py-3 text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                      <strong>Total Fully Diluted</strong>
                    </td>
                    <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>
                      <strong>8,000,000</strong>
                    </td>
                    <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>
                      <strong>100.0%</strong>
                    </td>
                    <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? '#fff' : '#000' }}>
                      <strong>$20,000,000</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Visual Cap Table */}
          <div 
            className="p-6 rounded-xl border"
            style={{
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
              borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
            }}
          >
            <h3 className="text-base mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
              Ownership Distribution
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 h-8 rounded-lg overflow-hidden flex">
                <div style={{ width: '56.3%', backgroundColor: '#6366f1' }} title="Founders: 56.3%"></div>
                <div style={{ width: '25%', backgroundColor: '#10b981' }} title="Series A: 25%"></div>
                <div style={{ width: '12.5%', backgroundColor: '#8b5cf6' }} title="Options: 12.5%"></div>
                <div style={{ width: '6.2%', backgroundColor: '#f59e0b' }} title="Angels: 6.2%"></div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Founders (56.3%)', color: '#6366f1' },
                { label: 'Series A (25.0%)', color: '#10b981' },
                { label: 'Options (12.5%)', color: '#8b5cf6' },
                { label: 'Angels (6.2%)', color: '#f59e0b' },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                  <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Page 2: Liquidation & Governance */}
      <div className="page-break">
        <div className="space-y-6">
          {/* Liquidation Preferences */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.1)' }}
              >
                <TrendingUp className="w-5 h-5" style={{ color: darkMode ? '#34d399' : '#10b981' }} />
              </div>
              <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
                Liquidation Preferences & Exit Scenarios
              </h2>
            </div>

            {/* Liquidation Structure Cards */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h4 className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Preference Structure
                </h4>
                <div className="space-y-3">
                  {[
                    { text: '1x Non-Participating Preference', desc: 'Greater of 1x investment or pro-rata share' },
                    { text: 'Pari Passu Seniority', desc: 'Equal ranking with future Series A investors' },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                      <div className="flex-1">
                        <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {item.text}
                        </div>
                        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h4 className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Conversion Mechanics
                </h4>
                <div className="space-y-3">
                  {[
                    { text: 'Automatic Conversion', desc: 'Upon IPO >$50M or majority vote' },
                    { text: 'Optional Conversion', desc: 'At holder\'s option at any time' },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#6366f1' }} />
                      <div className="flex-1">
                        <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {item.text}
                        </div>
                        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Exit Scenarios Table */}
            <div 
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
            >
              <div 
                className="px-6 py-4 border-b"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h3 className="text-base" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Exit Scenarios & Waterfall Analysis
                </h3>
              </div>
              <div style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : '#fff' }}>
                <table className="w-full">
                  <thead 
                    className="border-b"
                    style={{
                      backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                      borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                    }}
                  >
                    <tr>
                      <th className="px-6 py-3 text-left text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        Exit Value
                      </th>
                      <th className="px-6 py-3 text-right text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        Series A Payout
                      </th>
                      <th className="px-6 py-3 text-right text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        Common Payout
                      </th>
                      <th className="px-6 py-3 text-right text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        Series A Return
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { exit: '$10M', seriesA: '$5.0M (50%)', common: '$5.0M (50%)', return: 1.0 },
                      { exit: '$20M', seriesA: '$5.0M (25%)', common: '$15.0M (75%)', return: 1.0, highlight: true },
                      { exit: '$40M', seriesA: '$10.0M (25%)', common: '$30.0M (75%)', return: 2.0 },
                      { exit: '$100M', seriesA: '$25.0M (25%)', common: '$75.0M (75%)', return: 5.0 },
                      { exit: '$200M', seriesA: '$50.0M (25%)', common: '$150.0M (75%)', return: 10.0 },
                    ].map((row, idx) => (
                      <tr 
                        key={idx}
                        className="border-b"
                        style={{
                          borderColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                          backgroundColor: row.highlight 
                            ? (darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)')
                            : 'transparent'
                        }}
                      >
                        <td className="px-6 py-3 text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {row.exit}
                        </td>
                        <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                          {row.seriesA}
                        </td>
                        <td className="px-6 py-3 text-sm text-right" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                          {row.common}
                        </td>
                        <td className="px-6 py-3 text-sm text-right" style={{
                          color: row.return >= 3 ? '#10b981' : row.return >= 2 ? '#6366f1' : '#f59e0b'
                        }}>
                          {row.return.toFixed(1)}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Board Composition */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: darkMode ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.1)' }}
              >
                <Users className="w-5 h-5" style={{ color: darkMode ? '#a78bfa' : '#8b5cf6' }} />
              </div>
              <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
                Board Composition & Governance
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Board Structure */}
              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h3 className="text-base mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Board Structure (5 Members)
                </h3>
                <div className="space-y-3">
                  {[
                    { role: 'Series A Directors', count: 2, color: '#10b981', desc: 'Appointed by Series A holders' },
                    { role: 'Founder Directors', count: 2, color: '#6366f1', desc: 'CEO + 1 founder representative' },
                    { role: 'Independent Director', count: 1, color: '#8b5cf6', desc: 'Mutually agreed upon' },
                  ].map((item, idx) => (
                    <div 
                      key={idx}
                      className="p-3 rounded-lg border"
                      style={{
                        backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : '#fff',
                        borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {item.role}
                        </span>
                        <span 
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            backgroundColor: darkMode ? `${item.color}33` : `${item.color}22`,
                            color: item.color
                          }}
                        >
                          {item.count} seat{item.count > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        {item.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Board Rights */}
              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h3 className="text-base mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Board Rights & Observers
                </h3>
                <div className="space-y-3">
                  {[
                    { text: 'Board Observer Rights', desc: 'Series A may appoint 1 observer' },
                    { text: 'Meeting Requirements', desc: 'Quarterly meetings, 7 days notice' },
                    { text: 'Information Rights', desc: 'Monthly financials, annual budget' },
                    { text: 'Committee Representation', desc: 'Audit & Compensation committees' },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                      <div className="flex-1">
                        <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {item.text}
                        </div>
                        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Page 3: Protective Provisions & Vesting */}
      <div className="page-break">
        <div className="space-y-6">
          {/* Protective Provisions */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: darkMode ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)' }}
              >
                <Shield className="w-5 h-5" style={{ color: darkMode ? '#818cf8' : '#6366f1' }} />
              </div>
              <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
                Protective Provisions & Anti-Dilution
              </h2>
            </div>

            {/* Anti-Dilution Grid */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h4 className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Protection Type
                </h4>
                <div 
                  className="p-3 rounded-lg mb-2"
                  style={{ backgroundColor: darkMode ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.1)' }}
                >
                  <div className="text-center text-sm mb-1" style={{ color: darkMode ? '#fbbf24' : '#f59e0b' }}>
                    Broad-Based Weighted Average
                  </div>
                  <div className="text-center text-xs" style={{ color: darkMode ? '#fcd34d' : '#f59e0b' }}>
                    Industry Standard
                  </div>
                </div>
                <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Adjusts conversion price based on down-round, using full cap denominator
                </div>
              </div>

              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h4 className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Triggering Events
                </h4>
                <div className="space-y-2">
                  {['Down-round financing', 'Below Series A price', 'Option grants excluded'].map((text, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: idx < 2 ? '#10b981' : '#6b7280' }} />
                      <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h4 className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                  Carve-Outs
                </h4>
                <div className="space-y-2">
                  {['Employee option pool', 'Convertible note conversion', 'Stock splits & dividends'].map((text, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="w-4 h-4 flex items-center justify-center mt-0.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6366f1' }}></div>
                      </div>
                      <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Protective Provisions Grid */}
            <div 
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
            >
              <div 
                className="px-6 py-4 border-b"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h3 className="text-base" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Series A Protective Provisions (Requires Majority Approval)
                </h3>
              </div>
              <div 
                className="p-6 grid grid-cols-2 gap-3"
                style={{ backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : '#fff' }}
              >
                {[
                  { icon: Lock, text: 'Amend Certificate or Bylaws', color: '#ef4444' },
                  { icon: DollarSign, text: 'Issue senior securities', color: '#f59e0b' },
                  { icon: TrendingUp, text: 'Authorize additional shares', color: '#10b981' },
                  { icon: Target, text: 'Dispose assets >$500K', color: '#6366f1' },
                  { icon: Users, text: 'Declare dividends', color: '#8b5cf6' },
                  { icon: Shield, text: 'Redeem shares', color: '#ec4899' },
                  { icon: BarChart3, text: 'Merge or liquidate', color: '#f97316' },
                  { icon: Award, text: 'Change Board composition', color: '#14b8a6' },
                  { icon: FileText, text: 'Incur debt >$1M', color: '#6366f1' },
                  { icon: Calendar, text: 'Change nature of business', color: '#06b6d4' },
                ].map((provision, idx) => {
                  const Icon = provision.icon;
                  return (
                    <div 
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-lg border"
                      style={{
                        backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                        borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                      }}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" style={{ color: provision.color }} />
                      <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                        {provision.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Vesting Schedules */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: darkMode ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.1)' }}
              >
                <Clock className="w-5 h-5" style={{ color: darkMode ? '#a78bfa' : '#8b5cf6' }} />
              </div>
              <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
                Founder & Employee Vesting
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Founder Vesting */}
              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h3 className="text-base mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Founder Vesting Schedule
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    {[
                      { label: 'Total Shares', value: '4,500,000' },
                      { label: 'Vesting Period', value: '4 years' },
                      { label: 'Cliff Period', value: '1 year (25%)' },
                      { label: 'Monthly Vesting', value: 'After cliff' },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                          {item.label}
                        </span>
                        <span className="text-sm" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Timeline Visual */}
                  <div>
                    <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      Vesting Timeline
                    </div>
                    <div className="relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: darkMode ? '#374151' : '#d1d5db' }}>
                      <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full" style={{ width: '25%' }}></div>
                      <div className="absolute inset-y-0 left-1/4 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full opacity-50" style={{ width: '75%' }}></div>
                    </div>
                    <div className="flex justify-between mt-2">
                      <span className="text-xs" style={{ color: '#a78bfa' }}>1yr Cliff</span>
                      <span className="text-xs" style={{ color: '#60a5fa' }}>Year 2</span>
                      <span className="text-xs" style={{ color: '#34d399' }}>Year 4</span>
                    </div>
                  </div>

                  <div 
                    className="p-3 rounded-lg"
                    style={{ backgroundColor: darkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)' }}
                  >
                    <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                      <strong>Acceleration:</strong> Single-trigger on Change of Control if terminated without cause within 12 months
                    </div>
                  </div>
                </div>
              </div>

              {/* Employee Options */}
              <div 
                className="p-5 rounded-xl border"
                style={{
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)',
                  borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                }}
              >
                <h3 className="text-base mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Employee Option Pool
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    {[
                      { label: 'Pool Size', value: '1,000,000 (12.5%)', color: null },
                      { label: 'Currently Granted', value: '400,000 (40%)', color: null },
                      { label: 'Available', value: '600,000 (60%)', color: '#10b981' },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                          {item.label}
                        </span>
                        <span className="text-sm" style={{ color: item.color || (darkMode ? '#fff' : '#000') }}>
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Pool Visual */}
                  <div>
                    <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      Pool Allocation
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-6 rounded-lg overflow-hidden flex">
                        <div className="flex items-center justify-center text-white text-xs" style={{ width: '40%', backgroundColor: '#6366f1' }}>
                          40%
                        </div>
                        <div className="flex items-center justify-center text-white text-xs" style={{ width: '60%', backgroundColor: '#10b981' }}>
                          60%
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#6366f1' }}></div>
                        <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>Granted</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
                        <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>Available</span>
                      </div>
                    </div>
                  </div>

                  <div 
                    className="p-3 rounded-lg"
                    style={{ backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)' }}
                  >
                    <div className="text-xs mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                      <strong>Standard Terms:</strong>
                    </div>
                    <ul className="text-xs space-y-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      <li>• 4-year vesting, 1-year cliff</li>
                      <li>• Strike price at FMV</li>
                      <li>• 10-year exercise window</li>
                      <li>• 90-day post-termination</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Assessment */}
          <div 
            className="p-6 rounded-xl border"
            style={{
              backgroundColor: darkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.05)',
              borderColor: darkMode ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.3)'
            }}
          >
            <div className="flex items-start gap-4">
              <CheckCircle className="w-6 h-6 flex-shrink-0 mt-1" style={{ color: '#10b981' }} />
              <div className="flex-1">
                <h3 className="text-base mb-2" style={{ color: darkMode ? '#fff' : '#000' }}>
                  Deal Terms Assessment
                </h3>
                <p className="text-sm mb-3" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                  The Series A terms are balanced and investor-friendly while maintaining founder alignment. Key highlights:
                </p>
                <ul className="text-sm space-y-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
                  <li className="flex items-start gap-2">
                    <span style={{ color: '#10b981' }}>✓</span>
                    <span>Non-participating liquidation preference protects downside without excessive drag on founders</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span style={{ color: '#10b981' }}>✓</span>
                    <span>Broad-based weighted average anti-dilution is founder-friendly vs. full ratchet</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span style={{ color: '#10b981' }}>✓</span>
                    <span>Board composition provides investor oversight while maintaining founder control</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span style={{ color: '#10b981' }}>✓</span>
                    <span>Protective provisions are standard and reasonable for Series A stage</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span style={{ color: '#10b981' }}>✓</span>
                    <span>Vesting terms align long-term interests with single-trigger acceleration protection</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
