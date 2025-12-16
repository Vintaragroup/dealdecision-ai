import { 
  FileText, 
  TrendingUp, 
  Shield, 
  Users, 
  CheckCircle, 
  AlertTriangle,
  DollarSign,
  Percent,
  Calendar,
  Lock,
  Vote,
  Award,
  BarChart3,
  Clock,
  Target
} from 'lucide-react';

interface DealTermsSummaryProps {
  darkMode: boolean;
}

export function DealTermsSummary({ darkMode }: DealTermsSummaryProps) {
  return (
    <div className="space-y-8">
      {/* Cover Page */}
      <div className="min-h-screen flex flex-col justify-center items-center p-12 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-20 w-96 h-96 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10 text-center max-w-3xl">
          <div className="mb-8 flex justify-center">
            <div className={`p-6 rounded-2xl ${
              darkMode ? 'bg-white/10' : 'bg-gray-900/10'
            } backdrop-blur-sm`}>
              <FileText className={`w-16 h-16 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
            </div>
          </div>
          
          <h1 className={`text-5xl mb-6 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Deal Terms Summary
          </h1>
          
          <p className={`text-xl mb-8 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            Comprehensive Analysis of Investment Structure & Key Terms
          </p>
          
          <div className={`inline-block px-6 py-3 rounded-full ${
            darkMode 
              ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30' 
              : 'bg-gradient-to-r from-emerald-100 to-teal-100 border border-emerald-300'
          }`}>
            <span className={`text-sm ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
              Investment Terms • Cap Table • Governance • Vesting
            </span>
          </div>
        </div>
      </div>

      {/* Page 1: Investment Structure Overview & Key Terms */}
      <div className="min-h-screen p-12">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-emerald-500/20' : 'bg-emerald-100'
              }`}>
                <DollarSign className={`w-5 h-5 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
              </div>
              <h2 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Investment Structure Overview
              </h2>
            </div>
            <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Series A Preferred Stock Financing
            </p>
          </div>

          {/* Executive Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className={`p-6 rounded-xl border ${
              darkMode 
                ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
            }`}>
              <div className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Investment Amount
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                $5.0M
              </div>
              <div className="text-xs text-emerald-500">Series A</div>
            </div>

            <div className={`p-6 rounded-xl border ${
              darkMode 
                ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
            }`}>
              <div className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Pre-Money Valuation
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                $15.0M
              </div>
              <div className="text-xs text-blue-500">Cap Table</div>
            </div>

            <div className={`p-6 rounded-xl border ${
              darkMode 
                ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
            }`}>
              <div className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Post-Money Valuation
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                $20.0M
              </div>
              <div className="text-xs text-purple-500">Fully Diluted</div>
            </div>

            <div className={`p-6 rounded-xl border ${
              darkMode 
                ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
            }`}>
              <div className={`text-sm mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Investor Ownership
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                25.0%
              </div>
              <div className="text-xs text-amber-500">Post-Financing</div>
            </div>
          </div>

          {/* Key Terms Table */}
          <div className={`rounded-xl border overflow-hidden ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <div className={`px-6 py-4 border-b ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
            }`}>
              <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Key Investment Terms
              </h3>
            </div>
            <div className={darkMode ? 'bg-white/5' : 'bg-white'}>
              <table className="w-full">
                <tbody>
                  {[
                    { term: 'Security Type', value: 'Series A Preferred Stock', highlight: false },
                    { term: 'Price Per Share', value: '$2.50', highlight: false },
                    { term: 'Number of Shares', value: '2,000,000 shares', highlight: false },
                    { term: 'Liquidation Preference', value: '1x Non-Participating', highlight: true },
                    { term: 'Dividend Rate', value: '8% cumulative, non-compounding', highlight: false },
                    { term: 'Conversion Rights', value: 'Convertible to Common at 1:1 ratio', highlight: false },
                    { term: 'Anti-Dilution Protection', value: 'Broad-based weighted average', highlight: true },
                    { term: 'Voting Rights', value: 'Vote on as-converted basis', highlight: false },
                    { term: 'Board Seats', value: '2 of 5 seats (40%)', highlight: true },
                    { term: 'Redemption Rights', value: 'None', highlight: false },
                  ].map((row, idx) => (
                    <tr key={idx} className={`border-b last:border-b-0 ${
                      darkMode ? 'border-white/5' : 'border-gray-100'
                    } ${row.highlight ? (darkMode ? 'bg-emerald-500/10' : 'bg-emerald-50') : ''}`}>
                      <td className={`px-6 py-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {row.term}
                      </td>
                      <td className={`px-6 py-4 text-right ${
                        darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Capitalization Table */}
          <div className={`rounded-xl border overflow-hidden ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <div className={`px-6 py-4 border-b ${
              darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
            }`}>
              <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Post-Financing Capitalization Table
              </h3>
            </div>
            <div className={darkMode ? 'bg-white/5' : 'bg-white'}>
              <table className="w-full">
                <thead className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                  <tr>
                    <th className={`px-6 py-3 text-left text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Shareholder
                    </th>
                    <th className={`px-6 py-3 text-right text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Shares
                    </th>
                    <th className={`px-6 py-3 text-right text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Ownership %
                    </th>
                    <th className={`px-6 py-3 text-right text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Series A Investors', shares: '2,000,000', ownership: '25.0%', value: '$5,000,000', type: 'preferred' },
                    { name: 'Founders', shares: '4,500,000', ownership: '56.3%', value: '$11,250,000', type: 'common' },
                    { name: 'Employee Option Pool', shares: '1,000,000', ownership: '12.5%', value: '$2,500,000', type: 'options' },
                    { name: 'Angel Investors', shares: '500,000', ownership: '6.2%', value: '$1,250,000', type: 'common' },
                  ].map((row, idx) => (
                    <tr key={idx} className={`border-b last:border-b-0 ${
                      darkMode ? 'border-white/5' : 'border-gray-100'
                    }`}>
                      <td className={`px-6 py-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        <div className="flex items-center gap-2">
                          {row.name}
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            row.type === 'preferred' 
                              ? darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                              : row.type === 'options'
                              ? darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                              : darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {row.type}
                          </span>
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-right ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {row.shares}
                      </td>
                      <td className={`px-6 py-4 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {row.ownership}
                      </td>
                      <td className={`px-6 py-4 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {row.value}
                      </td>
                    </tr>
                  ))}
                  <tr className={`border-t-2 ${darkMode ? 'border-white/20 bg-white/5' : 'border-gray-300 bg-gray-50'}`}>
                    <td className={`px-6 py-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      <strong>Total Fully Diluted</strong>
                    </td>
                    <td className={`px-6 py-4 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      <strong>8,000,000</strong>
                    </td>
                    <td className={`px-6 py-4 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      <strong>100.0%</strong>
                    </td>
                    <td className={`px-6 py-4 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      <strong>$20,000,000</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Visual Cap Table */}
          <div className={`p-6 rounded-xl border ${
            darkMode 
              ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
              : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
          }`}>
            <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Ownership Distribution
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 h-8 rounded-lg overflow-hidden flex">
                <div className="bg-blue-500" style={{ width: '56.3%' }} title="Founders: 56.3%"></div>
                <div className="bg-emerald-500" style={{ width: '25%' }} title="Series A: 25%"></div>
                <div className="bg-purple-500" style={{ width: '12.5%' }} title="Options: 12.5%"></div>
                <div className="bg-amber-500" style={{ width: '6.2%' }} title="Angels: 6.2%"></div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Founders (56.3%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Series A (25.0%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Options (12.5%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Angels (6.2%)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Page 2: Liquidation Preferences & Board Composition */}
      <div className="min-h-screen p-12">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Liquidation Preferences */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-emerald-500/20' : 'bg-emerald-100'
              }`}>
                <TrendingUp className={`w-5 h-5 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
              </div>
              <h2 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Liquidation Preferences
              </h2>
            </div>

            {/* Liquidation Structure */}
            <div className={`p-6 rounded-xl border mb-6 ${
              darkMode 
                ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
            }`}>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Preference Structure
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                      <div className="flex-1">
                        <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          1x Non-Participating Preference
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Series A receives the greater of 1x investment or pro-rata share
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                      <div className="flex-1">
                        <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          Seniority Structure
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Pari passu with future Series A investors
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Conversion Mechanics
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                      <div className="flex-1">
                        <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          Automatic Conversion
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Upon IPO {'>'}$50M or majority vote
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                      <div className="flex-1">
                        <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          Optional Conversion
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          At holder{'\''}s option at any time
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Liquidation Scenarios */}
            <div className={`rounded-xl border overflow-hidden ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <div className={`px-6 py-4 border-b ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Exit Scenarios & Waterfall Analysis
                </h3>
              </div>
              <div className={darkMode ? 'bg-white/5' : 'bg-white'}>
                <table className="w-full">
                  <thead className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                    <tr>
                      <th className={`px-6 py-3 text-left text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Exit Value
                      </th>
                      <th className={`px-6 py-3 text-right text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Series A Payout
                      </th>
                      <th className={`px-6 py-3 text-right text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Common Payout
                      </th>
                      <th className={`px-6 py-3 text-right text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Series A Return
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { exit: '$10M', seriesA: '$5.0M (50%)', common: '$5.0M (50%)', return: '1.0x', highlight: false },
                      { exit: '$20M', seriesA: '$5.0M (25%)', common: '$15.0M (75%)', return: '1.0x', highlight: true },
                      { exit: '$40M', seriesA: '$10.0M (25%)', common: '$30.0M (75%)', return: '2.0x', highlight: false },
                      { exit: '$100M', seriesA: '$25.0M (25%)', common: '$75.0M (75%)', return: '5.0x', highlight: false },
                      { exit: '$200M', seriesA: '$50.0M (25%)', common: '$150.0M (75%)', return: '10.0x', highlight: false },
                    ].map((row, idx) => (
                      <tr key={idx} className={`border-b last:border-b-0 ${
                        darkMode ? 'border-white/5' : 'border-gray-100'
                      } ${row.highlight ? (darkMode ? 'bg-emerald-500/10' : 'bg-emerald-50') : ''}`}>
                        <td className={`px-6 py-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {row.exit}
                        </td>
                        <td className={`px-6 py-4 text-right ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {row.seriesA}
                        </td>
                        <td className={`px-6 py-4 text-right ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {row.common}
                        </td>
                        <td className={`px-6 py-4 text-right ${
                          parseFloat(row.return) >= 3 
                            ? 'text-emerald-500' 
                            : parseFloat(row.return) >= 2 
                            ? 'text-blue-500' 
                            : 'text-amber-500'
                        }`}>
                          {row.return}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`p-4 rounded-lg border flex items-start gap-3 mt-4 ${
              darkMode 
                ? 'bg-blue-500/10 border-blue-500/30' 
                : 'bg-blue-50 border-blue-200'
            }`}>
              <AlertTriangle className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Preference Analysis
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  At exits below $20M, Series A takes preference payment. Above $20M, they convert to common and take pro-rata share (25%), which exceeds the 1x preference.
                </div>
              </div>
            </div>
          </div>

          {/* Board Composition */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
              }`}>
                <Users className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              </div>
              <h2 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Board Composition & Governance
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Board Structure */}
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Board Structure (5 Members)
                </h3>
                <div className="space-y-4">
                  {[
                    { role: 'Series A Directors', count: 2, color: 'emerald', desc: 'Appointed by Series A holders' },
                    { role: 'Founder Directors', count: 2, color: 'blue', desc: 'CEO + 1 founder representative' },
                    { role: 'Independent Director', count: 1, color: 'purple', desc: 'Mutually agreed upon' },
                  ].map((item, idx) => (
                    <div key={idx} className={`p-4 rounded-lg border ${
                      darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {item.role}
                        </span>
                        <span className={`px-2 py-1 rounded text-sm ${
                          item.color === 'emerald'
                            ? darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                            : item.color === 'blue'
                            ? darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
                            : darkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {item.count} seat{item.count > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {item.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Board Rights & Observers */}
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Board Rights & Observers
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Board Observer Rights
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Series A investors may appoint 1 observer
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Meeting Requirements
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Quarterly meetings minimum, 7 days notice
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Information Rights
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Monthly financials, annual budget, quarterly updates
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Committee Representation
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Series A participation in Audit & Compensation committees
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Page 3: Protective Provisions, Anti-Dilution & Vesting */}
      <div className="min-h-screen p-12">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Voting Rights & Protective Provisions */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-blue-500/20' : 'bg-blue-100'
              }`}>
                <Vote className={`w-5 h-5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              </div>
              <h2 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Voting Rights & Protective Provisions
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {/* Voting Rights */}
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  General Voting Rights
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Vote className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        As-Converted Basis
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Series A votes with Common on most matters
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Vote className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Voting Power
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        25% of total voting power on common matters
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Vote className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Separate Class Voting
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Majority of Series A required for protective provisions
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Drag-Along Rights */}
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Drag-Along Rights
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-purple-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Approval Threshold
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Requires approval by Board and holders of {'>'}50% Series A
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-purple-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Minimum Terms
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Same terms to all shareholders on pro-rata basis
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-purple-500 mt-0.5" />
                    <div className="flex-1">
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Carve-Out
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Founders may retain up to $2M in transaction value
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Protective Provisions Table */}
            <div className={`rounded-xl border overflow-hidden ${
              darkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <div className={`px-6 py-4 border-b ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Series A Protective Provisions (Requires Majority Approval)
                </h3>
              </div>
              <div className={darkMode ? 'bg-white/5' : 'bg-white'}>
                <div className="p-6 grid md:grid-cols-2 gap-4">
                  {[
                    { icon: Lock, text: 'Amend Certificate or Bylaws', color: 'red' },
                    { icon: DollarSign, text: 'Issue senior or pari passu securities', color: 'amber' },
                    { icon: TrendingUp, text: 'Authorize or issue additional shares', color: 'emerald' },
                    { icon: Target, text: 'Sell, transfer, or dispose of assets >$500K', color: 'blue' },
                    { icon: Users, text: 'Declare or pay dividends', color: 'purple' },
                    { icon: Shield, text: 'Redeem or repurchase shares', color: 'pink' },
                    { icon: BarChart3, text: 'Merge, consolidate, or liquidate company', color: 'orange' },
                    { icon: Award, text: 'Change size or composition of Board', color: 'teal' },
                    { icon: FileText, text: 'Incur debt >$1M', color: 'indigo' },
                    { icon: Calendar, text: 'Change nature of business', color: 'cyan' },
                  ].map((provision, idx) => (
                    <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg border ${
                      darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
                    }`}>
                      <provision.icon className={`w-5 h-5 flex-shrink-0 ${
                        provision.color === 'red' ? 'text-red-500' :
                        provision.color === 'amber' ? 'text-amber-500' :
                        provision.color === 'emerald' ? 'text-emerald-500' :
                        provision.color === 'blue' ? 'text-blue-500' :
                        provision.color === 'purple' ? 'text-purple-500' :
                        provision.color === 'pink' ? 'text-pink-500' :
                        provision.color === 'orange' ? 'text-orange-500' :
                        provision.color === 'teal' ? 'text-teal-500' :
                        provision.color === 'indigo' ? 'text-indigo-500' :
                        'text-cyan-500'
                      }`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {provision.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Anti-Dilution Protection */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-amber-500/20' : 'bg-amber-100'
              }`}>
                <Shield className={`w-5 h-5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
              </div>
              <h2 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Anti-Dilution Protection
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Protection Type
                </h3>
                <div className={`p-4 rounded-lg mb-3 ${
                  darkMode ? 'bg-amber-500/20' : 'bg-amber-100'
                }`}>
                  <div className={`text-center text-sm mb-1 ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                    Broad-Based Weighted Average
                  </div>
                  <div className={`text-center text-xs ${darkMode ? 'text-amber-300' : 'text-amber-600'}`}>
                    Industry Standard
                  </div>
                </div>
                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Adjusts conversion price based on price of down-round financing, using full capitalization denominator
                </div>
              </div>

              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Triggering Events
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5" />
                    <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Down-round financing
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5" />
                    <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Below Series A price
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                    </div>
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Not triggered by option grants
                    </span>
                  </div>
                </div>
              </div>

              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Carve-Outs
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    </div>
                    <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Employee option pool shares
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    </div>
                    <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Conversion of convertible notes
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    </div>
                    <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Stock splits & dividends
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Vesting Schedules */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2 rounded-lg ${
                darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
              }`}>
                <Clock className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              </div>
              <h2 className={`text-3xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Founder & Employee Vesting
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Founder Vesting */}
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Founder Vesting Schedule
                </h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Total Shares
                      </span>
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        4,500,000
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Vesting Period
                      </span>
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        4 years
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Cliff Period
                      </span>
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        1 year (25%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Monthly Vesting
                      </span>
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        After cliff
                      </span>
                    </div>
                  </div>

                  {/* Timeline Visual */}
                  <div>
                    <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Vesting Timeline
                    </div>
                    <div className="relative h-2 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full" style={{ width: '25%' }}></div>
                      <div className="absolute inset-y-0 left-1/4 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full opacity-50" style={{ width: '75%' }}></div>
                    </div>
                    <div className="flex justify-between mt-2">
                      <span className={`text-xs ${darkMode ? 'text-purple-400' : 'text-purple-600'}`}>
                        1yr Cliff
                      </span>
                      <span className={`text-xs ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        Year 2
                      </span>
                      <span className={`text-xs ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                        Year 4 (Fully Vested)
                      </span>
                    </div>
                  </div>

                  <div className={`p-3 rounded-lg ${
                    darkMode ? 'bg-purple-500/10' : 'bg-purple-50'
                  }`}>
                    <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <strong>Acceleration:</strong> Single-trigger on Change of Control if terminated without cause within 12 months
                    </div>
                  </div>
                </div>
              </div>

              {/* Employee Option Pool */}
              <div className={`p-6 rounded-xl border ${
                darkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white to-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Employee Option Pool
                </h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Pool Size
                      </span>
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        1,000,000 (12.5%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Currently Granted
                      </span>
                      <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        400,000 (40%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Available
                      </span>
                      <span className={`text-sm text-emerald-500`}>
                        600,000 (60%)
                      </span>
                    </div>
                  </div>

                  {/* Pool Usage Visual */}
                  <div>
                    <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Pool Allocation
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-6 rounded-lg overflow-hidden flex">
                        <div className="bg-blue-500 flex items-center justify-center text-white text-xs" style={{ width: '40%' }}>
                          40%
                        </div>
                        <div className="bg-emerald-500 flex items-center justify-center text-white text-xs" style={{ width: '60%' }}>
                          60%
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Granted
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Available
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={`p-3 rounded-lg ${
                    darkMode ? 'bg-blue-500/10' : 'bg-blue-50'
                  }`}>
                    <div className={`text-xs mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <strong>Standard Terms:</strong>
                    </div>
                    <ul className={`text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      <li>• 4-year vesting, 1-year cliff</li>
                      <li>• Strike price at FMV</li>
                      <li>• 10-year exercise window</li>
                      <li>• 90-day post-termination exercise</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Box */}
          <div className={`p-6 rounded-xl border ${
            darkMode 
              ? 'bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border-emerald-500/30' 
              : 'bg-gradient-to-br from-emerald-50 to-blue-50 border-emerald-300'
          }`}>
            <div className="flex items-start gap-4">
              <CheckCircle className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Deal Terms Assessment
                </h3>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  The Series A terms are balanced and investor-friendly while maintaining founder alignment. Key highlights:
                </p>
                <ul className={`text-sm space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500">✓</span>
                    <span>Non-participating liquidation preference protects downside without excessive drag on founders</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500">✓</span>
                    <span>Broad-based weighted average anti-dilution is founder-friendly vs. full ratchet</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500">✓</span>
                    <span>Board composition provides investor oversight while maintaining founder control</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500">✓</span>
                    <span>Protective provisions are standard and reasonable for Series A stage</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-500">✓</span>
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
