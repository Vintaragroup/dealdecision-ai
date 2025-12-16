import { useState } from 'react';
import { X, Sparkles, RefreshCw, Copy, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { DealFormData } from '../NewDealModal';

interface AITextGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (text: string) => void;
  darkMode: boolean;
  dealData: DealFormData | null;
  currentText: string;
  slideContext: string;
}

export function AITextGenerator({ 
  isOpen, 
  onClose, 
  onGenerate, 
  darkMode, 
  dealData, 
  currentText,
  slideContext 
}: AITextGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedOptions, setGeneratedOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setGenerating(true);
    
    // Simulate AI generation with context-aware content
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const options = generateContextualContent(slideContext, prompt, dealData);
    setGeneratedOptions(options);
    setSelectedOption(0);
    setGenerating(false);
  };

  const handleUseText = () => {
    if (selectedOption !== null && generatedOptions[selectedOption]) {
      onGenerate(generatedOptions[selectedOption]);
    }
  };

  const generateContextualContent = (context: string, userPrompt: string, data: DealFormData | null): string[] => {
    const companyName = data?.companyName || 'Your Company';
    const industry = data?.industry || 'your industry';
    const fundingAmount = data?.fundingAmount || '$5M';
    
    // Generate different content based on slide context
    const contextMap: Record<string, string[]> = {
      'Cover Slide': [
        `${companyName}\n\nTransforming ${industry} with innovative solutions`,
        `${companyName}\n\nThe future of ${industry} starts here`,
        `${companyName}\n\nReinventing how ${industry} works`
      ],
      'Problem': [
        `The Challenge in ${industry}\n\nCompanies in ${industry} struggle with inefficiency, high costs, and outdated processes. The market lacks a modern solution that addresses these critical pain points.\n\nThis creates a $2.5B opportunity for disruption.`,
        `Market Problem\n\nCurrent solutions in ${industry} are fragmented, expensive, and difficult to implement. Organizations waste 40+ hours per month on manual processes.\n\nCustomers are actively seeking better alternatives.`,
        `The Pain Point\n\n• Inefficient workflows costing time and money\n• Lack of modern, integrated solutions\n• High switching costs from legacy systems\n• Growing demand for innovation in ${industry}`
      ],
      'Solution': [
        `Our Solution\n\n${companyName} provides a comprehensive platform that ${userPrompt || 'solves the key challenges'}. Our approach combines cutting-edge technology with deep industry expertise.\n\nKey Benefits:\n• 10x faster implementation\n• 50% cost reduction\n• Seamless integration`,
        `How We Solve It\n\nWe've built a modern, scalable platform specifically designed for ${industry}. Our solution eliminates manual processes and delivers measurable ROI from day one.\n\n✓ Automated workflows\n✓ Real-time insights\n✓ Enterprise-grade security`,
        `The ${companyName} Advantage\n\nUnlike traditional solutions, we offer:\n\n• Cloud-native architecture for scale\n• AI-powered automation\n• Intuitive user experience\n• 24/7 support and training`
      ],
      'Market Opportunity': [
        `Market Opportunity\n\nTAM: $15B - Total addressable market\nSAM: $4.5B - Serviceable addressable market\nSOM: $450M - Serviceable obtainable market (Year 5)\n\nThe ${industry} market is growing at 24% CAGR, driven by digital transformation and increased demand for automation.`,
        `Massive Market Potential\n\n$15B Total Market\n\nWe're targeting the enterprise segment of ${industry}, with 10,000+ potential customers. Early adopters are already seeing 3x ROI.\n\nMarket drivers:\n• Digital transformation initiatives\n• Regulatory compliance needs\n• Cost optimization pressure`,
        `The Opportunity\n\nGlobal ${industry} market: $15B and growing\n\n• Underserved mid-market segment\n• Limited modern solutions\n• High willingness to pay\n• Network effects once at scale`
      ],
      'Traction': [
        `Traction & Metrics\n\nWe've achieved significant early traction:\n\n• $850K ARR (40% MoM growth)\n• 15 enterprise customers\n• 125% Net Revenue Retention\n• 3.5% monthly churn\n\nCustomer testimonials show consistent 5x ROI within 6 months.`,
        `Momentum\n\nKey Metrics:\n✓ Revenue: $850K ARR\n✓ Growth: 40% month-over-month\n✓ Customers: 15 enterprise accounts\n✓ Pipeline: $2.5M qualified opportunities\n\nRecent wins: Fortune 500 pilot, industry award, featured in TechCrunch`,
        `Proof of Concept\n\nRevenue Growth:\nQ1: $120K\nQ2: $240K\nQ3: $490K\n\nCustomer Metrics:\n• 95% customer satisfaction\n• 8/10 NPS score\n• 18-month average contract`
      ],
      'Team': [
        `World-Class Team\n\nOur founding team brings 40+ years of combined experience:\n\n• CEO: 2 prior exits, ex-Google PM\n• CTO: ML expert, ex-Meta engineer\n• COO: 15 years ops at Fortune 500\n\nAdvisors from Sequoia, a16z, and industry veterans.`,
        `The Team\n\nWhy We'll Win:\n\n✓ Proven entrepreneurs (2 exits)\n✓ Deep technical expertise (FAANG background)\n✓ Industry domain knowledge\n✓ Strong advisory board\n\nWe've built and scaled companies before. This is our best work yet.`,
        `Led by Serial Entrepreneurs\n\nFounders:\n• [CEO Name] - Former VP at [Company], 2 successful exits\n• [CTO Name] - AI researcher, 10+ patents\n• [COO Name] - Scaled ops from 0 to $50M\n\n5 engineers, all from top tech companies`
      ],
      'The Ask': [
        `The Ask\n\nWe're raising ${fundingAmount} to:\n\n• Scale go-to-market (50%)\n• Expand engineering team (30%)\n• Product development (20%)\n\nThis provides 18-month runway to reach $5M ARR and series B milestones.`,
        `Investment Opportunity\n\n${fundingAmount} Series A\n$25M pre-money valuation\n\nUse of Funds:\n→ Sales & Marketing: $2.5M\n→ Engineering: $1.5M\n→ Operations: $1M\n\nKey Milestones: 10x revenue, 100+ customers, break-even in 24 months`,
        `Join Us\n\nRaising: ${fundingAmount}\nValuation: $25M pre-money\n\nWith this capital, we will:\n✓ Expand to 3 new markets\n✓ Launch enterprise features\n✓ Build strategic partnerships\n\nProjected: $8.5M ARR in 18 months`
      ]
    };

    // If user provided a custom prompt, generate custom content
    if (userPrompt) {
      return [
        `${userPrompt}\n\nOur approach leverages ${companyName}'s unique position in ${industry} to deliver exceptional results.`,
        `${userPrompt}\n\nThis represents a significant opportunity for ${companyName} to lead the transformation of ${industry}.`,
        `${userPrompt}\n\nWith ${companyName}'s proven track record and innovative technology, we're well-positioned to capture this market.`
      ];
    }

    return contextMap[context] || [
      `[${context}]\n\nCustom content for this slide. Edit or regenerate to refine.`,
      `${context} - Option 2\n\nAlternative approach to this content.`,
      `${context} - Option 3\n\nAnother perspective on this topic.`
    ];
  };

  const suggestedPrompts = [
    'Write a compelling problem statement',
    'Explain our unique solution',
    'Highlight our competitive advantages',
    'Describe our target market',
    'Summarize our traction and growth'
  ];

  return (
    <div 
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                AI Text Generator
              </h2>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Generating for: {slideContext}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Left Column - Input */}
            <div className="space-y-4">
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  What would you like to generate?
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="E.g., Write a compelling problem statement about inefficiencies in enterprise software..."
                  className={`w-full h-32 px-3 py-2 rounded-lg border text-sm resize-none ${
                    darkMode 
                      ? 'bg-[#27272a] border-white/10 text-white placeholder-gray-500' 
                      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
              </div>

              {currentText && (
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Current Text (will be replaced)
                  </label>
                  <div className={`p-3 rounded-lg border text-sm ${
                    darkMode ? 'bg-[#27272a] border-white/10 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-600'
                  }`}>
                    {currentText}
                  </div>
                </div>
              )}

              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Suggested Prompts
                </label>
                <div className="space-y-2">
                  {suggestedPrompts.map((suggested, i) => (
                    <button
                      key={i}
                      onClick={() => setPrompt(suggested)}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                        darkMode
                          ? 'border-white/10 hover:bg-white/5 text-gray-300'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {suggested}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                variant="primary"
                darkMode={darkMode}
                onClick={handleGenerate}
                loading={generating}
                icon={<Sparkles className="w-4 h-4" />}
                className="w-full"
              >
                {generating ? 'Generating...' : 'Generate with AI'}
              </Button>
            </div>

            {/* Right Column - Generated Options */}
            <div className="space-y-4">
              <label className={`block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Generated Options {generatedOptions.length > 0 && `(${generatedOptions.length})`}
              </label>

              {generatedOptions.length === 0 ? (
                <div className={`h-full flex items-center justify-center text-center p-8 rounded-lg border ${
                  darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'
                }`}>
                  <div>
                    <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Generated content will appear here</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {generatedOptions.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedOption(index)}
                      className={`w-full text-left p-4 rounded-lg border transition-all ${
                        selectedOption === index
                          ? darkMode
                            ? 'border-[#6366f1] bg-[#6366f1]/10'
                            : 'border-[#6366f1] bg-[#6366f1]/5'
                          : darkMode
                            ? 'border-white/10 hover:border-white/20'
                            : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className={`text-xs px-2 py-1 rounded ${
                          darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-600'
                        }`}>
                          Option {index + 1}
                        </span>
                        {selectedOption === index && (
                          <Check className="w-4 h-4 text-[#6366f1]" />
                        )}
                      </div>
                      <p className={`text-sm whitespace-pre-wrap ${
                        darkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {option}
                      </p>
                    </button>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    darkMode={darkMode}
                    onClick={handleGenerate}
                    icon={<RefreshCw className="w-4 h-4" />}
                    className="w-full"
                  >
                    Regenerate
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <Button
            variant="outline"
            darkMode={darkMode}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            darkMode={darkMode}
            onClick={handleUseText}
            disabled={selectedOption === null || generatedOptions.length === 0}
            icon={<Check className="w-4 h-4" />}
          >
            Use This Text
          </Button>
        </div>
      </div>
    </div>
  );
}
