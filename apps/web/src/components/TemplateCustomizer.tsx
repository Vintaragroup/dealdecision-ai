import { useState } from 'react';
import { ArrowLeft, Upload, Check, X } from 'lucide-react';
import { Button } from './ui/Button';

export interface TemplateCustomization {
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  logoUrl: string;
  companyName: string;
  includeSections: {
    coverSlide: boolean;
    problem: boolean;
    solution: boolean;
    market: boolean;
    product: boolean;
    businessModel: boolean;
    traction: boolean;
    team: boolean;
    financials: boolean;
    competition: boolean;
    useOfFunds: boolean;
    theAsk: boolean;
  };
}

interface TemplateCustomizerProps {
  darkMode: boolean;
  customization: TemplateCustomization;
  onCustomizationChange: (customization: TemplateCustomization) => void;
  onBack: () => void;
}

const colorPresets = [
  { name: 'Indigo/Purple', primary: '#6366f1', secondary: '#8b5cf6' },
  { name: 'Blue/Cyan', primary: '#3b82f6', secondary: '#06b6d4' },
  { name: 'Emerald/Teal', primary: '#10b981', secondary: '#14b8a6' },
  { name: 'Orange/Red', primary: '#f97316', secondary: '#ef4444' },
  { name: 'Pink/Rose', primary: '#ec4899', secondary: '#f43f5e' },
  { name: 'Violet/Fuchsia', primary: '#8b5cf6', secondary: '#d946ef' },
  { name: 'Professional Gray', primary: '#64748b', secondary: '#475569' },
  { name: 'Warm Sunset', primary: '#fb923c', secondary: '#fbbf24' }
];

const fontOptions = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans Pro',
  'Raleway',
  'PT Sans',
  'Ubuntu'
];

export function TemplateCustomizer({ darkMode, customization, onCustomizationChange, onBack }: TemplateCustomizerProps) {
  const [activeTab, setActiveTab] = useState<'colors' | 'fonts' | 'branding' | 'sections'>('colors');

  const updateCustomization = (updates: Partial<TemplateCustomization>) => {
    onCustomizationChange({ ...customization, ...updates });
  };

  const toggleSection = (section: keyof TemplateCustomization['includeSections']) => {
    onCustomizationChange({
      ...customization,
      includeSections: {
        ...customization.includeSections,
        [section]: !customization.includeSections[section]
      }
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6">
        {/* Back Button */}
        <button
          onClick={onBack}
          className={`flex items-center gap-2 mb-6 text-sm transition-colors ${
            darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Template Selection
        </button>

        <div className="grid grid-cols-3 gap-6">
          {/* Customization Options */}
          <div className="col-span-2 space-y-6">
            {/* Tabs */}
            <div className={`flex gap-2 p-1 rounded-xl ${
              darkMode ? 'bg-[#27272a]' : 'bg-gray-100'
            }`}>
              <button
                onClick={() => setActiveTab('colors')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all ${
                  activeTab === 'colors'
                    ? darkMode
                      ? 'bg-[#6366f1] text-white'
                      : 'bg-white text-gray-900 shadow-sm'
                    : darkMode
                      ? 'text-gray-400 hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Colors
              </button>
              <button
                onClick={() => setActiveTab('fonts')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all ${
                  activeTab === 'fonts'
                    ? darkMode
                      ? 'bg-[#6366f1] text-white'
                      : 'bg-white text-gray-900 shadow-sm'
                    : darkMode
                      ? 'text-gray-400 hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Fonts
              </button>
              <button
                onClick={() => setActiveTab('branding')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all ${
                  activeTab === 'branding'
                    ? darkMode
                      ? 'bg-[#6366f1] text-white'
                      : 'bg-white text-gray-900 shadow-sm'
                    : darkMode
                      ? 'text-gray-400 hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Branding
              </button>
              <button
                onClick={() => setActiveTab('sections')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all ${
                  activeTab === 'sections'
                    ? darkMode
                      ? 'bg-[#6366f1] text-white'
                      : 'bg-white text-gray-900 shadow-sm'
                    : darkMode
                      ? 'text-gray-400 hover:text-white'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Sections
              </button>
            </div>

            {/* Colors Tab */}
            {activeTab === 'colors' && (
              <div className={`p-6 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Brand Color Palette
                </h3>
                
                {/* Color Presets */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {colorPresets.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => updateCustomization({ 
                        primaryColor: preset.primary, 
                        secondaryColor: preset.secondary 
                      })}
                      className={`p-3 rounded-lg border transition-all ${
                        customization.primaryColor === preset.primary
                          ? darkMode
                            ? 'border-[#6366f1] bg-[#6366f1]/10'
                            : 'border-[#6366f1] bg-[#6366f1]/5'
                          : darkMode
                            ? 'border-white/10 hover:border-white/20'
                            : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div 
                        className="w-full h-12 rounded mb-2"
                        style={{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})` }}
                      />
                      <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {preset.name}
                      </p>
                      {customization.primaryColor === preset.primary && (
                        <Check className="w-4 h-4 text-[#6366f1] mx-auto mt-1" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Custom Colors */}
                <div className="space-y-4">
                  <div>
                    <label className={`block text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Primary Color
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={customization.primaryColor}
                        onChange={(e) => updateCustomization({ primaryColor: e.target.value })}
                        className="w-12 h-12 rounded border cursor-pointer"
                        style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
                      />
                      <input
                        type="text"
                        value={customization.primaryColor}
                        onChange={(e) => updateCustomization({ primaryColor: e.target.value })}
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                          darkMode 
                            ? 'bg-[#18181b] border-white/10 text-white' 
                            : 'bg-white border-gray-200 text-gray-900'
                        }`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={`block text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Secondary Color
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={customization.secondaryColor}
                        onChange={(e) => updateCustomization({ secondaryColor: e.target.value })}
                        className="w-12 h-12 rounded border cursor-pointer"
                        style={{ borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}
                      />
                      <input
                        type="text"
                        value={customization.secondaryColor}
                        onChange={(e) => updateCustomization({ secondaryColor: e.target.value })}
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                          darkMode 
                            ? 'bg-[#18181b] border-white/10 text-white' 
                            : 'bg-white border-gray-200 text-gray-900'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fonts Tab */}
            {activeTab === 'fonts' && (
              <div className={`p-6 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Typography
                </h3>
                
                <div className="grid grid-cols-2 gap-3">
                  {fontOptions.map((font) => (
                    <button
                      key={font}
                      onClick={() => updateCustomization({ fontFamily: font })}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        customization.fontFamily === font
                          ? darkMode
                            ? 'border-[#6366f1] bg-[#6366f1]/10'
                            : 'border-[#6366f1] bg-[#6366f1]/5'
                          : darkMode
                            ? 'border-white/10 hover:border-white/20'
                            : 'border-gray-200 hover:border-gray-300'
                      }`}
                      style={{ fontFamily: font }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {font}
                        </span>
                        {customization.fontFamily === font && (
                          <Check className="w-4 h-4 text-[#6366f1]" />
                        )}
                      </div>
                      <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        The quick brown fox jumps
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Branding Tab */}
            {activeTab === 'branding' && (
              <div className={`p-6 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Company Branding
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className={`block text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={customization.companyName}
                      onChange={(e) => updateCustomization({ companyName: e.target.value })}
                      placeholder="Your Company Name"
                      className={`w-full px-3 py-2 rounded-lg border text-sm ${
                        darkMode 
                          ? 'bg-[#18181b] border-white/10 text-white placeholder-gray-500' 
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                      }`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Company Logo
                    </label>
                    <div className={`p-8 rounded-lg border-2 border-dashed text-center ${
                      darkMode ? 'border-white/20 bg-white/5' : 'border-gray-300 bg-gray-50'
                    }`}>
                      {customization.logoUrl ? (
                        <div className="relative inline-block">
                          <img 
                            src={customization.logoUrl} 
                            alt="Logo" 
                            className="max-h-20 mx-auto"
                          />
                          <button
                            onClick={() => updateCustomization({ logoUrl: '' })}
                            className={`absolute -top-2 -right-2 p-1 rounded-full ${
                              darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600'
                            }`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Upload className={`w-8 h-8 mx-auto mb-2 ${
                            darkMode ? 'text-gray-500' : 'text-gray-400'
                          }`} />
                          <p className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Upload your company logo
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            darkMode={darkMode}
                          >
                            Choose File
                          </Button>
                          <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                            PNG, JPG or SVG (max 2MB)
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sections Tab */}
            {activeTab === 'sections' && (
              <div className={`p-6 rounded-xl border ${
                darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
              }`}>
                <h3 className={`text-sm mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Include Sections
                </h3>
                
                <div className="space-y-2">
                  {Object.entries(customization.includeSections).map(([key, value]) => (
                    <label
                      key={key}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        darkMode 
                          ? 'border-white/10 hover:bg-white/5' 
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className={`text-sm capitalize ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                      <button
                        onClick={() => toggleSection(key as keyof TemplateCustomization['includeSections'])}
                        className={`w-10 h-6 rounded-full transition-colors ${
                          value
                            ? 'bg-[#6366f1]'
                            : darkMode
                              ? 'bg-white/20'
                              : 'bg-gray-300'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          value ? 'translate-x-5' : 'translate-x-1'
                        }`} />
                      </button>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div className="space-y-4">
            <h3 className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Live Preview
            </h3>
            
            {/* Preview Card */}
            <div 
              className={`p-8 rounded-xl border min-h-[500px]`}
              style={{
                background: darkMode 
                  ? `linear-gradient(135deg, ${customization.primaryColor}15, ${customization.secondaryColor}15)`
                  : `linear-gradient(135deg, ${customization.primaryColor}10, ${customization.secondaryColor}10)`,
                borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
              }}
            >
              {/* Mock Slide */}
              <div className="text-center mb-8">
                <div 
                  className="inline-block px-4 py-2 rounded-lg mb-4"
                  style={{ 
                    backgroundColor: `${customization.primaryColor}30`,
                    color: customization.primaryColor
                  }}
                >
                  <span className="text-xs" style={{ fontFamily: customization.fontFamily }}>
                    {customization.companyName || 'Your Company'}
                  </span>
                </div>
                <h1 
                  className="text-2xl mb-3"
                  style={{ 
                    fontFamily: customization.fontFamily,
                    background: `linear-gradient(135deg, ${customization.primaryColor}, ${customization.secondaryColor})`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                  }}
                >
                  Pitch Deck Title
                </h1>
                <p 
                  className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                  style={{ fontFamily: customization.fontFamily }}
                >
                  Your compelling subtitle here
                </p>
              </div>

              {/* Mock Content */}
              <div className="space-y-4">
                <div 
                  className="p-4 rounded-lg"
                  style={{ 
                    backgroundColor: `${customization.primaryColor}20`,
                    borderLeft: `3px solid ${customization.primaryColor}`
                  }}
                >
                  <p 
                    className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
                    style={{ fontFamily: customization.fontFamily }}
                  >
                    This is how your content will look with your selected customizations.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div 
                    className="p-3 rounded-lg text-center"
                    style={{ backgroundColor: `${customization.primaryColor}15` }}
                  >
                    <p 
                      className="text-xs mb-1"
                      style={{ 
                        fontFamily: customization.fontFamily,
                        color: darkMode ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      Metric 1
                    </p>
                    <p 
                      className="text-lg"
                      style={{ 
                        fontFamily: customization.fontFamily,
                        color: customization.primaryColor
                      }}
                    >
                      $2.5M
                    </p>
                  </div>
                  <div 
                    className="p-3 rounded-lg text-center"
                    style={{ backgroundColor: `${customization.secondaryColor}15` }}
                  >
                    <p 
                      className="text-xs mb-1"
                      style={{ 
                        fontFamily: customization.fontFamily,
                        color: darkMode ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      Metric 2
                    </p>
                    <p 
                      className="text-lg"
                      style={{ 
                        fontFamily: customization.fontFamily,
                        color: customization.secondaryColor
                      }}
                    >
                      125%
                    </p>
                  </div>
                </div>

                <button
                  className="w-full py-3 rounded-lg text-white text-sm transition-opacity hover:opacity-90"
                  style={{ 
                    background: `linear-gradient(135deg, ${customization.primaryColor}, ${customization.secondaryColor})`,
                    fontFamily: customization.fontFamily
                  }}
                >
                  Call to Action
                </button>
              </div>
            </div>

            {/* Section Count */}
            <div className={`p-4 rounded-lg border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-gray-50 border-gray-200'
            }`}>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {Object.values(customization.includeSections).filter(Boolean).length} of{' '}
                {Object.keys(customization.includeSections).length} sections included
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
