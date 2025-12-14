import { X, FileText, Download, Mail, Lock, Calendar, Eye, CheckCircle2, AlertCircle, Sparkles, DollarSign, TrendingUp, Users, Shield, BarChart3, Target, FileCheck, Briefcase, Zap, Clock, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { ReportPreview } from './report-templates/ReportPreview';

interface ReportSection {
  id: string;
  category: string;
  label: string;
  pages: number;
  enabled: boolean;
  recommended?: boolean;
  warning?: string;
  icon: any;
}

interface ExportReportModalProps {
  isOpen: boolean;
  darkMode: boolean;
  dealName?: string;
  dealId?: string;
  onClose: () => void;
  onExport?: (config: ExportConfig) => void;
}

export interface ExportConfig {
  preset: 'complete' | 'investor' | 'quick' | 'custom';
  sections: string[];
  format: 'pdf' | 'ppt' | 'word' | 'excel' | 'weblink';
  branding: {
    includeLogo: boolean;
    watermark: boolean;
  };
  security: {
    password: string;
    expiration: string;
  };
  recipients: string[];
}

export function ExportReportModal({ isOpen, darkMode, dealName = 'TechVision AI', dealId, onClose, onExport }: ExportReportModalProps) {
  const [preset, setPreset] = useState<'complete' | 'investor' | 'quick' | 'custom'>('investor');
  const [format, setFormat] = useState<'pdf' | 'ppt' | 'word' | 'excel' | 'weblink'>('pdf');
  const [includeLogo, setIncludeLogo] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [passwordProtect, setPasswordProtect] = useState(true);
  const [password, setPassword] = useState('');
  const [expiration, setExpiration] = useState('30');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState('');
  const [showAllSections, setShowAllSections] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const [sections, setSections] = useState<ReportSection[]>([
    // Core Analysis
    { id: 'executive-summary', category: 'Core Analysis', label: 'Executive Summary', pages: 2, enabled: true, recommended: true, icon: FileText },
    { id: 'go-no-go', category: 'Core Analysis', label: 'Go/No-Go Recommendation', pages: 1, enabled: true, recommended: true, icon: Target },
    { id: 'market-analysis', category: 'Core Analysis', label: 'Market Analysis', pages: 8, enabled: true, icon: TrendingUp },
    { id: 'team-assessment', category: 'Core Analysis', label: 'Team Assessment', pages: 4, enabled: true, icon: Users },
    { id: 'risk-map', category: 'Core Analysis', label: 'Risk Map', pages: 3, enabled: true, icon: Shield },
    { id: 'verification-checklist', category: 'Core Analysis', label: 'Verification Checklist', pages: 2, enabled: true, icon: FileCheck },
    
    // Financial & Business
    { id: 'financial-analysis', category: 'Financial & Business', label: 'Financial Analysis', pages: 12, enabled: true, icon: BarChart3 },
    { id: 'competitive-landscape', category: 'Financial & Business', label: 'Competitive Landscape', pages: 6, enabled: true, icon: Target },
    { id: 'deal-terms', category: 'Financial & Business', label: 'Deal Terms Summary', pages: 2, enabled: false, icon: Briefcase },
    { id: 'traction-metrics', category: 'Financial & Business', label: 'Customer/Traction Metrics', pages: 5, enabled: true, icon: TrendingUp },
    
    // Technical & Product
    { id: 'product-technical-assessment', category: 'Technical & Product', label: 'Product/Technical Assessment', pages: 7, enabled: true, icon: Zap },
    { id: 'roadmap', category: 'Technical & Product', label: 'Roadmap & Milestones', pages: 3, enabled: false, icon: Clock },
    
    // Legal & Compliance
    { id: 'legal', category: 'Legal & Compliance', label: 'Legal & Compliance Review', pages: 8, enabled: false, icon: Shield },
    { id: 'regulatory', category: 'Legal & Compliance', label: 'Regulatory Assessment', pages: 4, enabled: false, icon: FileCheck },
    
    // Platform Value
    { id: 'roi-summary', category: 'Platform Value', label: 'ROI/Savings Summary', pages: 1, enabled: true, recommended: true, icon: DollarSign },
    { id: 'ai-confidence-scores', category: 'Platform Value', label: 'AI Confidence Scores', pages: 2, enabled: true, icon: Sparkles },
    { id: 'key-findings', category: 'Platform Value', label: 'Key Findings & Red Flags', pages: 3, enabled: true, recommended: true, icon: AlertCircle },
    
    // Supporting
    { id: 'comparables', category: 'Supporting', label: 'Comparable Deals', pages: 5, enabled: false, icon: BarChart3 },
    { id: 'documents', category: 'Supporting', label: 'Supporting Documents', pages: 15, enabled: false, icon: FileText },
    { id: 'appendix', category: 'Supporting', label: 'Appendix/Data Tables', pages: 8, enabled: false, icon: FileText },
  ]);

  const presets = {
    complete: 'Complete Package',
    investor: 'Investor Summary',
    quick: 'Quick Overview',
    custom: 'Custom Selection',
  };

  const applyPreset = (presetType: 'complete' | 'investor' | 'quick' | 'custom') => {
    setPreset(presetType);
    
    const updatedSections = sections.map(section => {
      switch (presetType) {
        case 'complete':
          return { ...section, enabled: true };
        case 'investor':
          return { 
            ...section, 
            enabled: ['executive-summary', 'go-no-go', 'market-analysis', 'team-assessment', 'risk-map', 'verification-checklist', 'financial-analysis', 'roi-summary', 'ai-confidence-scores', 'key-findings'].includes(section.id)
          };
        case 'quick':
          return { 
            ...section, 
            enabled: ['executive-summary', 'go-no-go', 'key-findings'].includes(section.id)
          };
        default:
          return section;
      }
    });
    
    setSections(updatedSections);
  };

  const toggleSection = (id: string) => {
    setSections(sections.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
    setPreset('custom');
  };

  const addRecipient = () => {
    if (newRecipient && newRecipient.includes('@')) {
      setRecipients([...recipients, newRecipient]);
      setNewRecipient('');
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter(r => r !== email));
  };

  const handleExport = () => {
    const config: ExportConfig = {
      preset,
      sections: sections.filter(s => s.enabled).map(s => s.id),
      format,
      branding: { includeLogo, watermark },
      security: { password: passwordProtect ? password : '', expiration },
      recipients,
    };

    setIsExporting(true);
    setExportProgress(0);

    // Simulate export progress
    const interval = setInterval(() => {
      setExportProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsExporting(false);
          setExportComplete(true);
          return 100;
        }
        return prev + 10;
      });
    }, 400);

    if (onExport) {
      onExport(config);
    }
  };

  const totalPages = sections.filter(s => s.enabled).reduce((sum, s) => sum + s.pages, 0);
  const enabledCount = sections.filter(s => s.enabled).length;
  const totalSections = sections.length;
  const completionScore = Math.round((enabledCount / totalSections) * 100);
  const estimatedTime = Math.ceil(totalPages * 0.8);
  
  const warnings = sections.filter(s => s.enabled && s.warning);
  const hasWarnings = warnings.length > 0;

  const categorizedSections = sections.reduce((acc, section) => {
    if (!acc[section.category]) {
      acc[section.category] = [];
    }
    acc[section.category].push(section);
    return acc;
  }, {} as Record<string, ReportSection[]>);

  const visibleCategories = showAllSections 
    ? Object.keys(categorizedSections)
    : Object.keys(categorizedSections).slice(0, 2);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border shadow-2xl ${
        darkMode 
          ? 'bg-[#0f0f0f] border-white/10' 
          : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-lg flex items-center justify-center shadow-lg">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Export Due Diligence Report
              </h2>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {dealName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-100'
            }`}
          >
            <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-160px)] p-6">
          {!isExporting && !exportComplete && (
            <>
              {/* Quick Presets */}
              <div className="mb-6">
                <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  📦 Quick Presets
                </h3>
                <div className="grid grid-cols-4 gap-3">
                  {Object.entries(presets).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => applyPreset(key as any)}
                      className={`px-4 py-3 rounded-lg border transition-all ${
                        preset === key
                          ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white border-transparent shadow-lg'
                          : darkMode
                          ? 'border-white/10 text-gray-300 hover:border-white/20 hover:bg-white/5'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-sm">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Select Sections */}
              <div className="mb-6">
                <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  📄 Select Sections
                </h3>
                
                <div className={`backdrop-blur-xl border rounded-xl overflow-hidden ${
                  darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                }`}>
                  {visibleCategories.map((category, catIndex) => (
                    <div key={category} className={catIndex > 0 ? `border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}` : ''}>
                      <div className={`px-4 py-2 ${darkMode ? 'bg-white/5' : 'bg-gray-100/50'}`}>
                        <span className={`text-xs uppercase tracking-wider ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          {category}
                        </span>
                      </div>
                      <div className="p-2 space-y-1">
                        {categorizedSections[category].map(section => {
                          const Icon = section.icon;
                          return (
                            <label
                              key={section.id}
                              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                                darkMode ? 'hover:bg-white/5' : 'hover:bg-white'
                              } ${section.enabled ? darkMode ? 'bg-white/5' : 'bg-white' : ''}`}
                            >
                              <div className="flex items-center gap-3 flex-1">
                                <input
                                  type="checkbox"
                                  checked={section.enabled}
                                  onChange={() => toggleSection(section.id)}
                                  className="w-4 h-4 rounded accent-[#6366f1]"
                                />
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                  section.enabled
                                    ? 'bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]'
                                    : darkMode ? 'bg-white/5' : 'bg-gray-200'
                                }`}>
                                  <Icon className={`w-4 h-4 ${section.enabled ? 'text-white' : darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm ${
                                      section.enabled 
                                        ? darkMode ? 'text-white' : 'text-gray-900'
                                        : darkMode ? 'text-gray-400' : 'text-gray-600'
                                    }`}>
                                      {section.label}
                                    </span>
                                    {section.recommended && (
                                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                                        darkMode 
                                          ? 'bg-emerald-500/20 text-emerald-300' 
                                          : 'bg-emerald-100 text-emerald-700'
                                      }`}>
                                        Recommended
                                      </span>
                                    )}
                                  </div>
                                  {section.warning && section.enabled && (
                                    <p className={`text-xs mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                                      ⚠️ {section.warning}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {section.pages} {section.pages === 1 ? 'page' : 'pages'}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  
                  {Object.keys(categorizedSections).length > 2 && (
                    <button
                      onClick={() => setShowAllSections(!showAllSections)}
                      className={`w-full px-4 py-3 border-t flex items-center justify-center gap-2 transition-colors ${
                        darkMode 
                          ? 'border-white/10 text-gray-400 hover:bg-white/5' 
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {showAllSections ? (
                        <>
                          <ChevronUp className="w-4 h-4" />
                          <span className="text-sm">Show Less</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          <span className="text-sm">Show {Object.keys(categorizedSections).length - 2} More Categories</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Export Options */}
              <div className="mb-6">
                <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  📤 Export Options
                </h3>
                
                <div className="space-y-4">
                  {/* Format */}
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Format
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { value: 'pdf', label: 'PDF', icon: FileText },
                        { value: 'ppt', label: 'PowerPoint', icon: FileText },
                        { value: 'word', label: 'Word', icon: FileText },
                        { value: 'excel', label: 'Excel', icon: BarChart3 },
                        { value: 'weblink', label: 'Web Link', icon: Eye },
                      ].map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          onClick={() => setFormat(value as any)}
                          className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                            format === value
                              ? 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white border-transparent'
                              : darkMode
                              ? 'border-white/10 text-gray-300 hover:border-white/20'
                              : 'border-gray-200 text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          <Icon className="w-4 h-4 mx-auto mb-1" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Branding */}
                  <div className="grid grid-cols-2 gap-4">
                    <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${
                      darkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input
                        type="checkbox"
                        checked={includeLogo}
                        onChange={(e) => setIncludeLogo(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#6366f1]"
                      />
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Include your logo
                      </span>
                    </label>
                    
                    <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${
                      darkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input
                        type="checkbox"
                        checked={watermark}
                        onChange={(e) => setWatermark(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#6366f1]"
                      />
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Watermark as confidential
                      </span>
                    </label>
                  </div>

                  {/* Security */}
                  <div>
                    <label className={`flex items-center gap-2 mb-3 cursor-pointer`}>
                      <input
                        type="checkbox"
                        checked={passwordProtect}
                        onChange={(e) => setPasswordProtect(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#6366f1]"
                      />
                      <Lock className="w-4 h-4" />
                      <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Password protect
                      </span>
                    </label>
                    
                    {passwordProtect && (
                      <div className="grid grid-cols-2 gap-4">
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter password..."
                          className={`px-3 py-2 rounded-lg border text-sm ${
                            darkMode
                              ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                              : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                          }`}
                        />
                        
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <select
                            value={expiration}
                            onChange={(e) => setExpiration(e.target.value)}
                            className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                              darkMode
                                ? 'bg-white/5 border-white/10 text-white'
                                : 'bg-white border-gray-200 text-gray-900'
                            }`}
                          >
                            <option value="7">Expires in 7 days</option>
                            <option value="30">Expires in 30 days</option>
                            <option value="90">Expires in 90 days</option>
                            <option value="never">Never expires</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Recipients */}
                  <div>
                    <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <Mail className="w-4 h-4 inline mr-2" />
                      Send to (optional)
                    </label>
                    
                    <div className="flex gap-2 mb-2">
                      <input
                        type="email"
                        value={newRecipient}
                        onChange={(e) => setNewRecipient(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addRecipient()}
                        placeholder="investor@example.com"
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                          darkMode
                            ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                            : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                        }`}
                      />
                      <button
                        onClick={addRecipient}
                        className="px-4 py-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-lg text-sm hover:shadow-lg transition-shadow"
                      >
                        Add
                      </button>
                    </div>
                    
                    {recipients.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {recipients.map(email => (
                          <span
                            key={email}
                            className={`px-3 py-1 rounded-full text-sm flex items-center gap-2 ${
                              darkMode
                                ? 'bg-white/5 text-gray-300'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {email}
                            <button
                              onClick={() => removeRecipient(email)}
                              className="hover:text-red-500"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Export Summary */}
              <div className={`backdrop-blur-xl border rounded-xl p-4 ${
                darkMode 
                  ? 'bg-gradient-to-r from-[#6366f1]/10 to-[#8b5cf6]/10 border-[#6366f1]/20' 
                  : 'bg-gradient-to-r from-[#6366f1]/5 to-[#8b5cf6]/5 border-[#6366f1]/20'
              }`}>
                <h3 className={`text-sm mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  📊 Export Summary
                </h3>
                
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <div>
                    <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Total pages
                    </p>
                    <p className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      ~{totalPages}
                    </p>
                  </div>
                  <div>
                    <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Estimated time
                    </p>
                    <p className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      ~{estimatedTime}s
                    </p>
                  </div>
                  <div>
                    <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Quality
                    </p>
                    <p className={`text-xl flex items-center gap-1 ${
                      completionScore >= 80 
                        ? 'text-emerald-500' 
                        : completionScore >= 50 
                        ? 'text-amber-500' 
                        : 'text-rose-500'
                    }`}>
                      {completionScore}%
                      {completionScore >= 80 && <CheckCircle2 className="w-4 h-4" />}
                    </p>
                  </div>
                </div>
                
                {hasWarnings && (
                  <div className={`flex items-start gap-2 p-2 rounded-lg ${
                    darkMode ? 'bg-amber-500/10' : 'bg-amber-50'
                  }`}>
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className={`text-xs ${darkMode ? 'text-amber-200' : 'text-amber-900'}`}>
                        {warnings.length} {warnings.length === 1 ? 'section has' : 'sections have'} warnings:
                      </p>
                      <p className={`text-xs ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                        {warnings.map(w => w.label).join(', ')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Exporting State */}
          {isExporting && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#6366f1]/50 animate-pulse">
                <Download className="w-8 h-8 text-white" />
              </div>
              <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Generating Report...
              </h3>
              <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Creating your {totalPages}-page report
              </p>
              
              {/* Progress Bar */}
              <div className={`w-full max-w-md mx-auto h-2 rounded-full overflow-hidden ${
                darkMode ? 'bg-white/10' : 'bg-gray-200'
              }`}>
                <div 
                  className="h-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all duration-500"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {exportProgress}% complete
              </p>
            </div>
          )}

          {/* Export Complete */}
          {exportComplete && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/50">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h3 className={`text-lg mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Report Ready!
              </h3>
              <p className={`text-sm mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Your {totalPages}-page report has been generated
              </p>
              
              <div className="flex gap-3 justify-center">
                <button className="px-6 py-3 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-lg shadow-lg hover:shadow-xl transition-shadow">
                  <Download className="w-4 h-4 inline mr-2" />
                  Download Report
                </button>
                {recipients.length > 0 && (
                  <button className={`px-6 py-3 rounded-lg border ${
                    darkMode 
                      ? 'border-white/10 text-white hover:bg-white/5' 
                      : 'border-gray-200 text-gray-900 hover:bg-gray-50'
                  }`}>
                    <Send className="w-4 h-4 inline mr-2" />
                    Send to {recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isExporting && !exportComplete && (
          <div className={`flex items-center justify-between p-6 border-t ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg transition-colors ${
                darkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              Cancel
            </button>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowPreview(true)}
                disabled={enabledCount === 0}
                className={`px-4 py-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  darkMode 
                    ? 'border-white/10 text-white hover:bg-white/5' 
                    : 'border-gray-200 text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Eye className="w-4 h-4 inline mr-2" />
                Preview
              </button>
              <button
                onClick={handleExport}
                disabled={enabledCount === 0}
                className={`px-6 py-2 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Download className="w-4 h-4 inline mr-2" />
                Export Package
              </button>
            </div>
          </div>
        )}

        {exportComplete && (
          <div className={`flex items-center justify-center p-6 border-t ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <button
              onClick={() => {
                setExportComplete(false);
                setExportProgress(0);
                onClose();
              }}
              className={`px-6 py-2 rounded-lg transition-colors ${
                darkMode ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Report Preview Modal */}
      <ReportPreview
        isOpen={showPreview}
        darkMode={darkMode}
        dealName={dealName}
        dealId={dealId}
        selectedSections={sections.filter(s => s.enabled).map(s => s.id)}
        onClose={() => setShowPreview(false)}
      />
    </div>
  );
}