import { X, Download } from 'lucide-react';
import { Button } from '../ui/button';

interface ExecutiveSummaryPreviewProps {
  isOpen: boolean;
  darkMode: boolean;
  templateName: string;
  onClose: () => void;
}

export function ExecutiveSummaryPreview({ isOpen, darkMode, templateName, onClose }: ExecutiveSummaryPreviewProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full h-full max-w-4xl flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
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
              2-Page Executive Summary Template
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" darkMode={darkMode} icon={<Download className="w-4 h-4" />}>
              Download
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
        <div className="flex-1 overflow-auto p-8">
          <div className={`max-w-3xl mx-auto space-y-8 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            {/* Page 1 */}
            <div className={`p-8 rounded-xl border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
            }`}>
              {/* Header */}
              <div className="text-center mb-8 pb-6 border-b border-current/10">
                <h1 className="text-3xl mb-2">[Company Name]</h1>
                <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Executive Summary
                </p>
                <p className={`text-sm mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  [Date] • Confidential
                </p>
              </div>

              {/* Company Overview */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Company Overview</h2>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  [Company Name] is a [industry] company that [brief description of what the company does]. 
                  Founded in [year], we are headquartered in [location] and serve [target market].
                </p>
              </div>

              {/* Problem Statement */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Problem Statement</h2>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  The [industry/market] faces significant challenges: [problem 1], [problem 2], and [problem 3]. 
                  Current solutions are inadequate because [limitations]. This creates a $[X]B market opportunity.
                </p>
              </div>

              {/* Solution */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Our Solution</h2>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  We provide [solution description] that enables customers to [key benefit]. Our platform/product:
                </p>
                <ul className={`list-disc list-inside space-y-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <li>[Key feature 1] - [benefit]</li>
                  <li>[Key feature 2] - [benefit]</li>
                  <li>[Key feature 3] - [benefit]</li>
                  <li>[Key feature 4] - [benefit]</li>
                </ul>
              </div>

              {/* Market Opportunity */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Market Opportunity</h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className={`p-4 rounded-lg text-center ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">TAM</p>
                    <p className="text-lg">$[X]B</p>
                  </div>
                  <div className={`p-4 rounded-lg text-center ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">SAM</p>
                    <p className="text-lg">$[X]B</p>
                  </div>
                  <div className={`p-4 rounded-lg text-center ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">SOM</p>
                    <p className="text-lg">$[X]M</p>
                  </div>
                </div>
              </div>

              {/* Business Model */}
              <div>
                <h2 className="text-xl mb-3 text-[#6366f1]">Business Model</h2>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Revenue Model: [subscription/transaction/licensing/etc.] • 
                  Pricing: $[X]/[unit] • 
                  Target Customers: [customer segment] • 
                  LTV: $[X] • CAC: $[X] • LTV:CAC Ratio: [X]:1
                </p>
              </div>
            </div>

            {/* Page 2 */}
            <div className={`p-8 rounded-xl border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
            }`}>
              {/* Traction & Metrics */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Traction & Key Metrics</h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className={`p-4 rounded-lg ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">Revenue (ARR/MRR)</p>
                    <p className="text-xl">$[X]M</p>
                    <p className="text-xs mt-1 text-green-500">↑ [X]% MoM</p>
                  </div>
                  <div className={`p-4 rounded-lg ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">Customers</p>
                    <p className="text-xl">[X,XXX]</p>
                    <p className="text-xs mt-1 text-green-500">↑ [X]% MoM</p>
                  </div>
                  <div className={`p-4 rounded-lg ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">Gross Margin</p>
                    <p className="text-xl">[X]%</p>
                  </div>
                  <div className={`p-4 rounded-lg ${
                    darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
                  }`}>
                    <p className="text-xs mb-1 opacity-60">NRR</p>
                    <p className="text-xl">[X]%</p>
                  </div>
                </div>
              </div>

              {/* Competitive Advantage */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Competitive Advantage</h2>
                <ul className={`list-disc list-inside space-y-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <li>[Unique technology/IP/data advantage]</li>
                  <li>[Network effects or switching costs]</li>
                  <li>[Strategic partnerships or distribution]</li>
                  <li>[Team expertise and domain knowledge]</li>
                </ul>
              </div>

              {/* Team */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Leadership Team</h2>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <strong>[CEO Name]</strong>, CEO - [previous experience/credentials]<br/>
                  <strong>[CTO Name]</strong>, CTO - [previous experience/credentials]<br/>
                  <strong>[COO Name]</strong>, COO - [previous experience/credentials]
                </p>
              </div>

              {/* Financial Highlights */}
              <div className="mb-6">
                <h2 className="text-xl mb-3 text-[#6366f1]">Financial Projections (3-Year)</h2>
                <div className={`overflow-hidden rounded-lg border ${
                  darkMode ? 'border-white/10' : 'border-gray-200'
                }`}>
                  <table className="w-full text-sm">
                    <thead className={darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'}>
                      <tr>
                        <th className="px-4 py-2 text-left">Year</th>
                        <th className="px-4 py-2 text-right">Revenue</th>
                        <th className="px-4 py-2 text-right">EBITDA</th>
                        <th className="px-4 py-2 text-right">Customers</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                        <td className="px-4 py-2">Year 1</td>
                        <td className="px-4 py-2 text-right">$[X]M</td>
                        <td className="px-4 py-2 text-right">-$[X]M</td>
                        <td className="px-4 py-2 text-right">[X,XXX]</td>
                      </tr>
                      <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                        <td className="px-4 py-2">Year 2</td>
                        <td className="px-4 py-2 text-right">$[X]M</td>
                        <td className="px-4 py-2 text-right">-$[X]M</td>
                        <td className="px-4 py-2 text-right">[X,XXX]</td>
                      </tr>
                      <tr className={darkMode ? 'border-t border-white/10' : 'border-t border-gray-200'}>
                        <td className="px-4 py-2">Year 3</td>
                        <td className="px-4 py-2 text-right">$[X]M</td>
                        <td className="px-4 py-2 text-right">$[X]M</td>
                        <td className="px-4 py-2 text-right">[X,XXX]</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* The Ask */}
              <div className={`p-6 rounded-lg ${
                darkMode ? 'bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20' : 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10'
              }`}>
                <h2 className="text-xl mb-3 text-[#6366f1]">Investment Opportunity</h2>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <strong>Raising:</strong> $[X]M Series [A/B/C]<br/>
                  <strong>Valuation:</strong> $[X]M [pre/post]-money<br/>
                  <strong>Use of Funds:</strong> [X]% Product, [X]% Sales & Marketing, [X]% Operations<br/>
                  <strong>Key Milestones:</strong> [milestone 1], [milestone 2], [milestone 3]
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
