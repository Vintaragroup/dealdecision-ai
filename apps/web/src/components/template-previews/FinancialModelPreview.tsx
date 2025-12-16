import { X, Download, TrendingUp, DollarSign } from 'lucide-react';
import { Button } from '../ui/button';

interface FinancialModelPreviewProps {
  isOpen: boolean;
  darkMode: boolean;
  templateName: string;
  onClose: () => void;
}

export function FinancialModelPreview({ isOpen, darkMode, templateName, onClose }: FinancialModelPreviewProps) {
  if (!isOpen) return null;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full h-full max-w-7xl flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div>
            <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {templateName}
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              3-Year Financial Projection Model
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" darkMode={darkMode} icon={<Download className="w-4 h-4" />}>
              Download Excel
            </Button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className={`p-4 rounded-xl border ${
                darkMode ? 'bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 border-white/10' : 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-gray-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-[#6366f1]" />
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Year 3 Revenue</p>
                </div>
                <p className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>$12.5M</p>
                <p className="text-xs text-green-500 mt-1">↑ 285% CAGR</p>
              </div>
              <div className={`p-4 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Gross Margin</p>
                <p className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>78%</p>
                <p className="text-xs text-green-500 mt-1">Target: 75%+</p>
              </div>
              <div className={`p-4 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Cash Burn (Avg)</p>
                <p className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>$125K/mo</p>
                <p className="text-xs text-blue-500 mt-1">Improving</p>
              </div>
              <div className={`p-4 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Break-even Month</p>
                <p className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>Month 28</p>
                <p className="text-xs text-purple-500 mt-1">Q3 Year 3</p>
              </div>
            </div>

            {/* Revenue Model */}
            <div className={`p-6 rounded-xl border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
            }`}>
              <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Revenue Projections (Monthly)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className={darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'}>
                    <tr>
                      <th className="px-3 py-2 text-left">Month</th>
                      {months.map(month => (
                        <th key={month} className="px-3 py-2 text-right">{month}</th>
                      ))}
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                      <td className="px-3 py-2">Year 1</td>
                      <td className="px-3 py-2 text-right">$15K</td>
                      <td className="px-3 py-2 text-right">$22K</td>
                      <td className="px-3 py-2 text-right">$32K</td>
                      <td className="px-3 py-2 text-right">$45K</td>
                      <td className="px-3 py-2 text-right">$62K</td>
                      <td className="px-3 py-2 text-right">$83K</td>
                      <td className="px-3 py-2 text-right">$108K</td>
                      <td className="px-3 py-2 text-right">$138K</td>
                      <td className="px-3 py-2 text-right">$172K</td>
                      <td className="px-3 py-2 text-right">$210K</td>
                      <td className="px-3 py-2 text-right">$252K</td>
                      <td className="px-3 py-2 text-right">$298K</td>
                      <td className={`px-3 py-2 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>$1.44M</td>
                    </tr>
                    <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                      <td className="px-3 py-2">Year 2</td>
                      <td className="px-3 py-2 text-right">$348K</td>
                      <td className="px-3 py-2 text-right">$402K</td>
                      <td className="px-3 py-2 text-right">$461K</td>
                      <td className="px-3 py-2 text-right">$525K</td>
                      <td className="px-3 py-2 text-right">$594K</td>
                      <td className="px-3 py-2 text-right">$668K</td>
                      <td className="px-3 py-2 text-right">$748K</td>
                      <td className="px-3 py-2 text-right">$834K</td>
                      <td className="px-3 py-2 text-right">$926K</td>
                      <td className="px-3 py-2 text-right">$1.02M</td>
                      <td className="px-3 py-2 text-right">$1.13M</td>
                      <td className="px-3 py-2 text-right">$1.24M</td>
                      <td className={`px-3 py-2 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>$8.87M</td>
                    </tr>
                    <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                      <td className="px-3 py-2">Year 3</td>
                      <td className="px-3 py-2 text-right">$1.35M</td>
                      <td className="px-3 py-2 text-right">$1.46M</td>
                      <td className="px-3 py-2 text-right">$1.58M</td>
                      <td className="px-3 py-2 text-right">$1.71M</td>
                      <td className="px-3 py-2 text-right">$1.85M</td>
                      <td className="px-3 py-2 text-right">$1.99M</td>
                      <td className="px-3 py-2 text-right">$2.14M</td>
                      <td className="px-3 py-2 text-right">$2.30M</td>
                      <td className="px-3 py-2 text-right">$2.47M</td>
                      <td className="px-3 py-2 text-right">$2.65M</td>
                      <td className="px-3 py-2 text-right">$2.84M</td>
                      <td className="px-3 py-2 text-right">$3.04M</td>
                      <td className={`px-3 py-2 text-right ${darkMode ? 'text-white' : 'text-gray-900'}`}>$25.38M</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* P&L Statement */}
            <div className={`p-6 rounded-xl border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
            }`}>
              <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Profit & Loss Statement (Annual)
              </h3>
              <table className="w-full text-sm">
                <thead className={darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'}>
                  <tr>
                    <th className="px-4 py-3 text-left">Line Item</th>
                    <th className="px-4 py-3 text-right">Year 1</th>
                    <th className="px-4 py-3 text-right">Year 2</th>
                    <th className="px-4 py-3 text-right">Year 3</th>
                    <th className="px-4 py-3 text-right">% of Revenue (Y3)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3">Total Revenue</td>
                    <td className="px-4 py-3 text-right">$1,437,000</td>
                    <td className="px-4 py-3 text-right">$8,874,000</td>
                    <td className="px-4 py-3 text-right">$25,380,000</td>
                    <td className="px-4 py-3 text-right">100%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3 pl-8 text-sm">Subscription Revenue</td>
                    <td className="px-4 py-3 text-right text-sm">$1,150,000</td>
                    <td className="px-4 py-3 text-right text-sm">$7,100,000</td>
                    <td className="px-4 py-3 text-right text-sm">$20,300,000</td>
                    <td className="px-4 py-3 text-right text-sm">80%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3 pl-8 text-sm">Professional Services</td>
                    <td className="px-4 py-3 text-right text-sm">$287,000</td>
                    <td className="px-4 py-3 text-right text-sm">$1,774,000</td>
                    <td className="px-4 py-3 text-right text-sm">$5,080,000</td>
                    <td className="px-4 py-3 text-right text-sm">20%</td>
                  </tr>
                  <tr className={`${darkMode ? 'border-t-2 border-white/20 bg-red-500/10' : 'border-t-2 border-gray-300 bg-red-50'}`}>
                    <td className="px-4 py-3">Cost of Revenue</td>
                    <td className="px-4 py-3 text-right">-$431,000</td>
                    <td className="px-4 py-3 text-right">-$2,218,000</td>
                    <td className="px-4 py-3 text-right">-$5,584,000</td>
                    <td className="px-4 py-3 text-right">22%</td>
                  </tr>
                  <tr className={`${darkMode ? 'border-t-2 border-white/20 bg-green-500/10' : 'border-t-2 border-gray-300 bg-green-50'}`}>
                    <td className="px-4 py-3">Gross Profit</td>
                    <td className="px-4 py-3 text-right">$1,006,000</td>
                    <td className="px-4 py-3 text-right">$6,656,000</td>
                    <td className="px-4 py-3 text-right">$19,796,000</td>
                    <td className="px-4 py-3 text-right">78%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3">Operating Expenses</td>
                    <td className="px-4 py-3 text-right">-$2,875,000</td>
                    <td className="px-4 py-3 text-right">-$7,100,000</td>
                    <td className="px-4 py-3 text-right">-$15,228,000</td>
                    <td className="px-4 py-3 text-right">60%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3 pl-8 text-sm">Sales & Marketing</td>
                    <td className="px-4 py-3 text-right text-sm">-$1,150,000</td>
                    <td className="px-4 py-3 text-right text-sm">-$3,550,000</td>
                    <td className="px-4 py-3 text-right text-sm">-$7,614,000</td>
                    <td className="px-4 py-3 text-right text-sm">30%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3 pl-8 text-sm">Product & Engineering</td>
                    <td className="px-4 py-3 text-right text-sm">-$1,006,000</td>
                    <td className="px-4 py-3 text-right text-sm">-$2,218,000</td>
                    <td className="px-4 py-3 text-right text-sm">-$5,076,000</td>
                    <td className="px-4 py-3 text-right text-sm">20%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3 pl-8 text-sm">General & Administrative</td>
                    <td className="px-4 py-3 text-right text-sm">-$719,000</td>
                    <td className="px-4 py-3 text-right text-sm">-$1,332,000</td>
                    <td className="px-4 py-3 text-right text-sm">-$2,538,000</td>
                    <td className="px-4 py-3 text-right text-sm">10%</td>
                  </tr>
                  <tr className={`${darkMode ? 'border-t-2 border-white/20 bg-[#6366f1]/10' : 'border-t-2 border-gray-300 bg-[#6366f1]/5'}`}>
                    <td className="px-4 py-3">EBITDA</td>
                    <td className="px-4 py-3 text-right text-red-500">-$1,869,000</td>
                    <td className="px-4 py-3 text-right text-red-500">-$444,000</td>
                    <td className="px-4 py-3 text-right text-green-500">$4,568,000</td>
                    <td className="px-4 py-3 text-right">18%</td>
                  </tr>
                  <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                    <td className="px-4 py-3">EBITDA Margin</td>
                    <td className="px-4 py-3 text-right text-red-500">-130%</td>
                    <td className="px-4 py-3 text-right text-red-500">-5%</td>
                    <td className="px-4 py-3 text-right text-green-500">18%</td>
                    <td className="px-4 py-3 text-right">-</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Unit Economics */}
            <div className={`p-6 rounded-xl border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
            }`}>
              <h3 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Unit Economics & Key Metrics
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <p className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Customer Metrics</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>CAC (Customer Acquisition Cost)</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>$1,250</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>LTV (Lifetime Value)</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>$8,500</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>LTV:CAC Ratio</span>
                      <span className="text-green-500">6.8:1</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Payback Period</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>8 months</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Revenue Metrics</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>ARPU (Monthly)</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>$250</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Churn Rate</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>3.5%/mo</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Net Revenue Retention</span>
                      <span className="text-green-500">125%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Magic Number</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>1.2</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Efficiency Metrics</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Burn Multiple</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>1.8x</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Rule of 40</span>
                      <span className="text-green-500">58%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Sales Efficiency</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>0.85</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Runway (Current)</span>
                      <span className={darkMode ? 'text-white' : 'text-gray-900'}>18 months</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
