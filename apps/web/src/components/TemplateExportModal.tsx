import { useState } from 'react';
import { X, Download, Eye, Settings, Check, Edit } from 'lucide-react';
import { Button } from './ui/Button';
import { DealFormData } from './NewDealModal';
import { TemplateCustomizer, TemplateCustomization } from './TemplateCustomizer';
import { TemplateEditor } from './TemplateEditor';

interface TemplateExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  dealData: DealFormData | null;
}

interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  preview: string;
}

const templates: Template[] = [
  {
    id: 'pitch-deck',
    name: 'Investor Pitch Deck',
    category: 'Pitch Materials',
    description: '15-slide presentation with your deal data',
    preview: '📊'
  },
  {
    id: 'executive-summary',
    name: 'Executive Summary',
    category: 'Pitch Materials',
    description: '2-page overview document',
    preview: '📄'
  },
  {
    id: 'financial-model',
    name: 'Financial Model',
    category: 'Financial',
    description: '3-year projections with your metrics',
    preview: '💰'
  },
  {
    id: 'one-pager',
    name: 'One-Pager',
    category: 'Pitch Materials',
    description: 'Concise single-page summary',
    preview: '📋'
  },
  {
    id: 'due-diligence',
    name: 'Due Diligence Report',
    category: 'Due Diligence',
    description: 'Complete investor-ready report',
    preview: '🔍'
  },
  {
    id: 'term-sheet',
    name: 'Term Sheet',
    category: 'Legal',
    description: 'Investment terms document',
    preview: '📝'
  }
];

export function TemplateExportModal({ isOpen, onClose, darkMode, dealData }: TemplateExportModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [customization, setCustomization] = useState<TemplateCustomization>({
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    fontFamily: 'Inter',
    logoUrl: '',
    companyName: dealData?.companyName || '',
    includeSections: {
      coverSlide: true,
      problem: true,
      solution: true,
      market: true,
      product: true,
      businessModel: true,
      traction: true,
      team: true,
      financials: true,
      competition: true,
      useOfFunds: true,
      theAsk: true
    }
  });

  if (!isOpen) return null;

  const handleExport = (format: 'pdf' | 'pptx' | 'docx') => {
    // In a real app, this would generate the document with deal data + customization
    console.log('Exporting template:', {
      template: selectedTemplate,
      format,
      dealData,
      customization
    });
    
    // Simulate export
    alert(`Exporting ${selectedTemplate?.name} as ${format.toUpperCase()} with your deal data and customizations!`);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-6xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
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
              Export Deal with Template
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {dealData?.companyName || 'Your Deal'} • Select a template to populate with your data
            </p>
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
        {!showCustomizer && !showEditor ? (
          <div className="flex-1 overflow-auto p-6">
            <div className="grid grid-cols-2 gap-6">
              {/* Template Selection */}
              <div>
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Choose Template
                </h3>
                <div className="space-y-3">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template)}
                      className={`w-full p-4 rounded-xl border text-left transition-all ${
                        selectedTemplate?.id === template.id
                          ? darkMode
                            ? 'bg-[#6366f1]/20 border-[#6366f1]'
                            : 'bg-[#6366f1]/10 border-[#6366f1]'
                          : darkMode
                            ? 'bg-[#27272a]/50 border-white/10 hover:border-white/20'
                            : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-3xl">{template.preview}</div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {template.name}
                            </h4>
                            {selectedTemplate?.id === template.id && (
                              <Check className="w-4 h-4 text-[#6366f1]" />
                            )}
                          </div>
                          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {template.description}
                          </p>
                          <div className={`mt-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                            {template.category}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview & Data Mapping */}
              <div>
                {selectedTemplate ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Data Preview
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        darkMode={darkMode}
                        onClick={() => setShowCustomizer(true)}
                        icon={<Settings className="w-4 h-4" />}
                      >
                        Customize
                      </Button>
                    </div>

                    {/* Data Mapping Preview */}
                    <div className={`p-5 rounded-xl border ${
                      darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-gray-50 border-gray-200'
                    }`}>
                      <h4 className={`text-sm mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Your Deal Data
                      </h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Company Name:</span>
                          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{dealData?.companyName || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Industry:</span>
                          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{dealData?.industry || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Stage:</span>
                          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{dealData?.stage || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Funding Amount:</span>
                          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{dealData?.fundingAmount || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Revenue:</span>
                          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{dealData?.revenue || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Team Size:</span>
                          <span className={darkMode ? 'text-white' : 'text-gray-900'}>{dealData?.teamSize || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Template Preview */}
                    <div className={`p-5 rounded-xl border ${
                      darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-gray-50 border-gray-200'
                    }`}>
                      <h4 className={`text-sm mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Template Sections
                      </h4>
                      <div className="space-y-2 text-xs">
                        {selectedTemplate.id === 'pitch-deck' && (
                          <>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Cover Slide with {dealData?.companyName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Problem ({dealData?.industry} industry)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Solution & Product</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Market Opportunity</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Traction (Revenue: {dealData?.revenue})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Team ({dealData?.teamSize} members)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>The Ask ({dealData?.fundingAmount})</span>
                            </div>
                          </>
                        )}
                        {selectedTemplate.id === 'executive-summary' && (
                          <>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Company Overview</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Market Analysis</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Financial Projections</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Investment Ask</span>
                            </div>
                          </>
                        )}
                        {selectedTemplate.id === 'financial-model' && (
                          <>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Revenue Projections (starting at {dealData?.revenue})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>P&L Statement</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Cash Flow Analysis</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 text-green-500" />
                              <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Unit Economics</span>
                            </div>
                          </>
                        )}
                        {!['pitch-deck', 'executive-summary', 'financial-model'].includes(selectedTemplate.id) && (
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            All relevant sections will be populated with your deal data
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Customization Preview */}
                    <div className={`p-5 rounded-xl border ${
                      darkMode ? 'bg-gradient-to-br from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/30' : 'bg-gradient-to-br from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/30'
                    }`}>
                      <h4 className={`text-sm mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Current Customization
                      </h4>
                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-6 h-6 rounded border"
                            style={{ 
                              background: `linear-gradient(135deg, ${customization.primaryColor}, ${customization.secondaryColor})`,
                              borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                            }}
                          />
                          <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Brand Colors</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded ${darkMode ? 'bg-white/10' : 'bg-black/5'}`} style={{ fontFamily: customization.fontFamily }}>
                            Aa
                          </span>
                          <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>{customization.fontFamily}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`h-full flex items-center justify-center text-center p-8 rounded-xl border ${
                    darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'
                  }`}>
                    <div>
                      <Eye className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">Select a template to preview how your data will be mapped</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : showCustomizer ? (
          <TemplateCustomizer
            darkMode={darkMode}
            customization={customization}
            onCustomizationChange={setCustomization}
            onBack={() => setShowCustomizer(false)}
          />
        ) : (
          <TemplateEditor
            isOpen={showEditor}
            onClose={() => setShowEditor(false)}
            darkMode={darkMode}
            templateName={selectedTemplate?.name || 'Template'}
            dealData={dealData}
          />
        )}

        {/* Footer */}
        {!showCustomizer && !showEditor && (
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
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                darkMode={darkMode}
                disabled={!selectedTemplate}
                onClick={() => setShowEditor(true)}
                icon={<Edit className="w-4 h-4" />}
              >
                Edit with AI
              </Button>
              <Button
                variant="outline"
                darkMode={darkMode}
                disabled={!selectedTemplate}
                onClick={() => handleExport('pdf')}
                icon={<Download className="w-4 h-4" />}
              >
                Export PDF
              </Button>
              <Button
                variant="outline"
                darkMode={darkMode}
                disabled={!selectedTemplate}
                onClick={() => handleExport('pptx')}
              >
                Export PowerPoint
              </Button>
              <Button
                variant="primary"
                darkMode={darkMode}
                disabled={!selectedTemplate}
                onClick={() => handleExport('docx')}
              >
                Export Word
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}