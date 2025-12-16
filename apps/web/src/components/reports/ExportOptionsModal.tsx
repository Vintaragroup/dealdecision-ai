import { useState } from 'react';
import { Button } from '../ui/button';
import {
  X,
  Download,
  Mail,
  Link2,
  FileText,
  Image,
  Settings,
  Lock,
  Droplet,
  Calendar,
  CheckCircle
} from 'lucide-react';

interface ExportOptionsModalProps {
  darkMode: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  dealName: string;
}

export interface ExportOptions {
  format: 'pdf' | 'docx' | 'pptx';
  pageSize: 'letter' | 'a4' | 'legal';
  orientation: 'portrait' | 'landscape';
  includeCover: boolean;
  includeAppendix: boolean;
  colorMode: 'color' | 'grayscale';
  quality: 'print' | 'screen' | 'draft';
  password?: string;
  watermark?: string;
  expiringLink?: boolean;
  linkExpiryDays?: number;
}

export function ExportOptionsModal({ 
  darkMode, 
  onClose, 
  onExport,
  dealName 
}: ExportOptionsModalProps) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'pdf',
    pageSize: 'letter',
    orientation: 'portrait',
    includeCover: true,
    includeAppendix: false,
    colorMode: 'color',
    quality: 'print',
    password: '',
    watermark: '',
    expiringLink: false,
    linkExpiryDays: 7
  });

  const [exportMethod, setExportMethod] = useState<'download' | 'email' | 'link'>('download');
  const [emailAddress, setEmailAddress] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    
    // Simulate export process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setExporting(false);
    setExportComplete(true);
    
    // Actually trigger the export
    onExport(options);
    
    // Close after showing success
    setTimeout(() => {
      onClose();
    }, 2000);
  };

  const updateOption = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl ${
        darkMode ? 'bg-[#18181b]' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div>
            <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Export Report
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {dealName}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
          >
            <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {exportComplete ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-[#10b981]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-[#10b981]" />
              </div>
              <h3 className={`text-xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Export Complete!
              </h3>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {exportMethod === 'download' && 'Your report has been downloaded'}
                {exportMethod === 'email' && `Report sent to ${emailAddress}`}
                {exportMethod === 'link' && 'Shareable link has been copied to your clipboard'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Export Method */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Export Method
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'download', label: 'Download', icon: Download },
                    { id: 'email', label: 'Email', icon: Mail },
                    { id: 'link', label: 'Share Link', icon: Link2 }
                  ].map(method => {
                    const Icon = method.icon;
                    return (
                      <button
                        key={method.id}
                        onClick={() => setExportMethod(method.id as any)}
                        className={`p-4 rounded-lg border text-center transition-all ${
                          exportMethod === method.id
                            ? darkMode
                              ? 'bg-[#6366f1]/20 border-[#6366f1]'
                              : 'bg-[#6366f1]/10 border-[#6366f1]'
                            : darkMode
                              ? 'bg-white/5 border-white/10 hover:border-white/20'
                              : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Icon className={`w-6 h-6 mx-auto mb-2 ${
                          exportMethod === method.id ? 'text-[#6366f1]' : darkMode ? 'text-gray-400' : 'text-gray-600'
                        }`} />
                        <div className={`text-sm ${
                          exportMethod === method.id ? 'text-[#6366f1]' : darkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                          {method.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Email Address (if email selected) */}
              {exportMethod === 'email' && (
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    placeholder="investor@example.com"
                    className={`w-full px-4 py-2 rounded-lg border ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                        : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                    }`}
                  />
                </div>
              )}

              {/* Format Selection */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  File Format
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'pdf', label: 'PDF', desc: 'Universal format' },
                    { id: 'docx', label: 'Word', desc: 'Editable document' },
                    { id: 'pptx', label: 'PowerPoint', desc: 'Presentation' }
                  ].map(format => (
                    <button
                      key={format.id}
                      onClick={() => updateOption('format', format.id as any)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        options.format === format.id
                          ? darkMode
                            ? 'bg-[#6366f1]/20 border-[#6366f1]'
                            : 'bg-[#6366f1]/10 border-[#6366f1]'
                          : darkMode
                            ? 'bg-white/5 border-white/10 hover:border-white/20'
                            : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`text-sm mb-1 ${
                        options.format === format.id ? 'text-[#6366f1]' : darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {format.label}
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {format.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Page Size */}
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Page Size
                  </label>
                  <select
                    value={options.pageSize}
                    onChange={(e) => updateOption('pageSize', e.target.value as any)}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="letter">Letter (8.5" × 11")</option>
                    <option value="a4">A4 (210mm × 297mm)</option>
                    <option value="legal">Legal (8.5" × 14")</option>
                  </select>
                </div>

                {/* Orientation */}
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Orientation
                  </label>
                  <select
                    value={options.orientation}
                    onChange={(e) => updateOption('orientation', e.target.value as any)}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Color Mode */}
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Color Mode
                  </label>
                  <select
                    value={options.colorMode}
                    onChange={(e) => updateOption('colorMode', e.target.value as any)}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="color">Full Color</option>
                    <option value="grayscale">Black & White</option>
                  </select>
                </div>

                {/* Quality */}
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Quality
                  </label>
                  <select
                    value={options.quality}
                    onChange={(e) => updateOption('quality', e.target.value as any)}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="print">Print Quality (Large)</option>
                    <option value="screen">Screen Quality (Medium)</option>
                    <option value="draft">Draft Quality (Small)</option>
                  </select>
                </div>
              </div>

              {/* Include Options */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Include
                </label>
                <div className="space-y-2">
                  <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                    darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                  }`}>
                    <input
                      type="checkbox"
                      checked={options.includeCover}
                      onChange={(e) => updateOption('includeCover', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Cover page with branding
                    </span>
                  </label>
                  <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                    darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                  }`}>
                    <input
                      type="checkbox"
                      checked={options.includeAppendix}
                      onChange={(e) => updateOption('includeAppendix', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#6366f1]"
                    />
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Appendix with supporting data
                    </span>
                  </label>
                </div>
              </div>

              {/* Security & Sharing Options */}
              <div>
                <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Security & Sharing
                </label>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="w-4 h-4 text-gray-400" />
                      <label className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Password Protection (Optional)
                      </label>
                    </div>
                    <input
                      type="password"
                      value={options.password}
                      onChange={(e) => updateOption('password', e.target.value)}
                      placeholder="Leave blank for no password"
                      className={`w-full px-3 py-2 rounded-lg border text-sm ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                      }`}
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Droplet className="w-4 h-4 text-gray-400" />
                      <label className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Watermark Text (Optional)
                      </label>
                    </div>
                    <input
                      type="text"
                      value={options.watermark}
                      onChange={(e) => updateOption('watermark', e.target.value)}
                      placeholder="e.g., CONFIDENTIAL, DRAFT, etc."
                      className={`w-full px-3 py-2 rounded-lg border text-sm ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                      }`}
                    />
                  </div>

                  {exportMethod === 'link' && (
                    <div>
                      <label className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                        darkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                      }`}>
                        <input
                          type="checkbox"
                          checked={options.expiringLink}
                          onChange={(e) => updateOption('expiringLink', e.target.checked)}
                          className="w-4 h-4 rounded accent-[#6366f1]"
                        />
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className={`text-sm flex-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Expiring link
                        </span>
                      </label>
                      {options.expiringLink && (
                        <div className="ml-10 mt-2">
                          <select
                            value={options.linkExpiryDays}
                            onChange={(e) => updateOption('linkExpiryDays', parseInt(e.target.value))}
                            className={`w-full px-3 py-2 rounded-lg border text-sm ${
                              darkMode
                                ? 'bg-white/5 border-white/10 text-white'
                                : 'bg-white border-gray-200 text-gray-900'
                            }`}
                          >
                            <option value="1">1 day</option>
                            <option value="3">3 days</option>
                            <option value="7">7 days</option>
                            <option value="14">14 days</option>
                            <option value="30">30 days</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!exportComplete && (
          <div className={`px-6 py-4 border-t flex items-center justify-between ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }`}>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {options.format.toUpperCase()} • {options.pageSize.toUpperCase()} • {options.quality}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                darkMode={darkMode}
                onClick={onClose}
                disabled={exporting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                darkMode={darkMode}
                onClick={handleExport}
                disabled={exporting || (exportMethod === 'email' && !emailAddress)}
                icon={exporting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
              >
                {exporting ? 'Exporting...' : exportMethod === 'download' ? 'Download' : exportMethod === 'email' ? 'Send Email' : 'Generate Link'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
