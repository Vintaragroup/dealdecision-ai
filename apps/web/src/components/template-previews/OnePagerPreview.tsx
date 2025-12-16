import { X, Download } from 'lucide-react';
import { Button } from '../ui/button';

interface OnePagerPreviewProps {
  isOpen: boolean;
  darkMode: boolean;
  templateName: string;
  onClose: () => void;
}

export function OnePagerPreview({ isOpen, darkMode, templateName, onClose }: OnePagerPreviewProps) {
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
              One-Page Company Overview
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
          <div className={`max-w-3xl mx-auto p-12 rounded-xl border min-h-[800px] ${
            darkMode ? 'bg-[#27272a]/50 border-white/10 text-gray-100' : 'bg-white border-gray-200 text-gray-900'
          }`}>
            {/* Header with Logo */}
            <div className="flex items-start justify-between mb-8 pb-6 border-b border-current/10">
              <div>
                <div className={`w-16 h-16 rounded-lg mb-3 flex items-center justify-center ${
                  darkMode ? 'bg-[#6366f1]/20' : 'bg-[#6366f1]/10'
                }`}>
                  <span className="text-2xl">[Logo]</span>
                </div>
                <h1 className="text-3xl mb-1">[Company Name]</h1>
                <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  [Your tagline or value proposition]
                </p>
              </div>
              <div className="text-right text-sm">
                <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                  [www.company.com]<br/>
                  [contact@company.com]<br/>
                  [City, State]
                </p>
              </div>
            </div>

            {/* What We Do */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">What We Do</h2>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                [2-3 sentences describing what your company does, who you serve, and the core value you provide. Make it clear and compelling.]
              </p>
            </div>

            {/* The Problem */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">The Problem</h2>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                [Describe the pain point or challenge that your target customers face. Quantify the problem if possible.]
              </p>
            </div>

            {/* Our Solution */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">Our Solution</h2>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                [Explain how your product/service solves the problem. Focus on benefits and outcomes, not just features.]
              </p>
            </div>

            {/* Key Metrics */}
            <div className="mb-6">
              <h2 className="text-xl mb-3 text-[#6366f1]">Traction</h2>
              <div className="grid grid-cols-4 gap-3">
                <div className={`p-3 rounded-lg text-center ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">Revenue</p>
                  <p className="text-lg">$[X]M</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">Customers</p>
                  <p className="text-lg">[X,XXX]</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">Growth</p>
                  <p className="text-lg">[X]% MoM</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">NRR</p>
                  <p className="text-lg">[X]%</p>
                </div>
              </div>
            </div>

            {/* Market Opportunity */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">Market Opportunity</h2>
              <div className="flex gap-3">
                <div className={`flex-1 p-3 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">TAM</p>
                  <p className="text-lg">$[X]B</p>
                </div>
                <div className={`flex-1 p-3 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">SAM</p>
                  <p className="text-lg">$[X]B</p>
                </div>
                <div className={`flex-1 p-3 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                  <p className="text-xs mb-1 opacity-60">SOM (5yr)</p>
                  <p className="text-lg">$[X]M</p>
                </div>
              </div>
            </div>

            {/* Business Model */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">Business Model</h2>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                [How you make money: pricing model, revenue streams, unit economics (LTV, CAC, etc.)]
              </p>
            </div>

            {/* Competitive Advantage */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">Why We Win</h2>
              <ul className={`list-disc list-inside space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <li>[Unique advantage #1]</li>
                <li>[Unique advantage #2]</li>
                <li>[Unique advantage #3]</li>
              </ul>
            </div>

            {/* Team */}
            <div className="mb-6">
              <h2 className="text-xl mb-2 text-[#6366f1]">Team</h2>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <strong>[CEO Name]</strong> - [previous role/company]<br/>
                <strong>[CTO Name]</strong> - [previous role/company]<br/>
                Backed by [investors/advisors]
              </p>
            </div>

            {/* The Ask */}
            <div className={`p-5 rounded-lg ${
              darkMode ? 'bg-gradient-to-r from-[#6366f1]/20 to-[#8b5cf6]/20' : 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10'
            }`}>
              <h2 className="text-xl mb-2 text-[#6366f1]">The Ask</h2>
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Raising <strong>$[X]M</strong> to [primary use of funds] • 
                $[X]M pre-money valuation • 
                [12-18] month runway
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
