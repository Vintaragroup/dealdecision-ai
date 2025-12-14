import { useState } from 'react';
import { Button } from './ui/Button';
import { 
  X, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  CheckSquare, 
  Square,
  ChevronDown,
  ChevronUp,
  Eye,
  Settings
} from 'lucide-react';

interface Deal {
  id: string;
  name: string;
  stage: string;
  score: number;
  lastUpdated: string;
  documents: number;
  completeness: number;
  fundingTarget: string;
  owner: string;
}

interface ExportDealsModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  deals: Deal[];
}

type ExportFormat = 'csv' | 'excel' | 'pdf';

interface ExportField {
  key: string;
  label: string;
  enabled: boolean;
}

export function ExportDealsModal({ isOpen, onClose, darkMode, deals }: ExportDealsModalProps) {
  const [selectedDeals, setSelectedDeals] = useState<string[]>(deals.map(d => d.id));
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [exportFields, setExportFields] = useState<ExportField[]>([
    { key: 'name', label: 'Deal Name', enabled: true },
    { key: 'stage', label: 'Stage', enabled: true },
    { key: 'score', label: 'AI Score', enabled: true },
    { key: 'completeness', label: 'Completeness %', enabled: true },
    { key: 'documents', label: 'Document Count', enabled: true },
    { key: 'fundingTarget', label: 'Funding Target', enabled: true },
    { key: 'owner', label: 'Owner', enabled: true },
    { key: 'lastUpdated', label: 'Last Updated', enabled: false },
  ]);

  if (!isOpen) return null;

  const allSelected = selectedDeals.length === deals.length;
  const someSelected = selectedDeals.length > 0 && selectedDeals.length < deals.length;

  const toggleDeal = (dealId: string) => {
    setSelectedDeals(prev =>
      prev.includes(dealId)
        ? prev.filter(id => id !== dealId)
        : [...prev, dealId]
    );
  };

  const toggleSelectAll = () => {
    setSelectedDeals(allSelected ? [] : deals.map(d => d.id));
  };

  const toggleField = (key: string) => {
    setExportFields(prev =>
      prev.map(field =>
        field.key === key ? { ...field, enabled: !field.enabled } : field
      )
    );
  };

  const handleExport = () => {
    const selectedDealData = deals.filter(d => selectedDeals.includes(d.id));
    const enabledFields = exportFields.filter(f => f.enabled);
    
    console.log('Exporting:', {
      format: exportFormat,
      deals: selectedDealData.length,
      fields: enabledFields.map(f => f.key)
    });

    // Simulate download
    const filename = `deals-export-${new Date().toISOString().split('T')[0]}.${exportFormat === 'excel' ? 'xlsx' : exportFormat}`;
    alert(`Downloading ${filename} with ${selectedDealData.length} deals and ${enabledFields.length} fields`);
    onClose();
  };

  const getFormatIcon = (format: ExportFormat) => {
    switch (format) {
      case 'csv':
        return <FileText className="w-4 h-4" />;
      case 'excel':
        return <FileSpreadsheet className="w-4 h-4" />;
      case 'pdf':
        return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div 
        className={`relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border ${
          darkMode
            ? 'bg-gradient-to-br from-[#18181b]/95 to-[#27272a]/95 border-white/10'
            : 'bg-gradient-to-br from-white/95 to-gray-50/95 border-gray-200'
        } backdrop-blur-xl shadow-2xl`}
      >
        {/* Header */}
        <div className={`p-6 border-b ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Export Deals
            </h2>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode
                  ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                  : 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Select deals and configure export settings
          </p>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="space-y-6">
            {/* Export Format */}
            <div>
              <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Export Format
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(['csv', 'excel', 'pdf'] as ExportFormat[]).map((format) => (
                  <button
                    key={format}
                    onClick={() => setExportFormat(format)}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      exportFormat === format
                        ? darkMode
                          ? 'border-[#6366f1] bg-[#6366f1]/10'
                          : 'border-[#6366f1] bg-[#6366f1]/5'
                        : darkMode
                        ? 'border-white/10 hover:border-white/20 bg-white/5'
                        : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={exportFormat === format ? 'text-[#6366f1]' : darkMode ? 'text-gray-400' : 'text-gray-600'}>
                        {getFormatIcon(format)}
                      </div>
                      <span className={`text-sm uppercase ${
                        exportFormat === format
                          ? 'text-[#6366f1]'
                          : darkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {format}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Deal Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Select Deals ({selectedDeals.length} of {deals.length})
                </label>
                <button
                  onClick={toggleSelectAll}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    darkMode
                      ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                      : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {allSelected ? (
                    <>
                      <CheckSquare className="w-4 h-4" />
                      Deselect All
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4" />
                      Select All
                    </>
                  )}
                </button>
              </div>

              <div className={`rounded-xl border overflow-hidden ${
                darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="max-h-64 overflow-y-auto">
                  {deals.map((deal) => (
                    <label
                      key={deal.id}
                      className={`flex items-center gap-3 p-4 cursor-pointer transition-colors border-b last:border-b-0 ${
                        darkMode
                          ? 'border-white/5 hover:bg-white/5'
                          : 'border-gray-200 hover:bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDeals.includes(deal.id)}
                        onChange={() => toggleDeal(deal.id)}
                        className="w-4 h-4 rounded border-gray-300 text-[#6366f1] focus:ring-[#6366f1] focus:ring-offset-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {deal.name}
                        </div>
                        <div className={`text-xs flex items-center gap-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="capitalize">{deal.stage}</span>
                          <span>•</span>
                          <span>Score: {deal.score}%</span>
                          <span>•</span>
                          <span>{deal.documents} docs</span>
                        </div>
                      </div>
                      <div className={`px-2 py-1 rounded text-xs ${
                        deal.completeness >= 80
                          ? darkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                          : deal.completeness >= 50
                          ? darkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                          : darkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
                      }`}>
                        {deal.completeness}% complete
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={`flex items-center gap-2 text-sm mb-3 ${
                  darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'
                } transition-colors`}
              >
                <Settings className="w-4 h-4" />
                Advanced Settings
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvanced && (
                <div className={`rounded-xl border p-4 ${
                  darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
                }`}>
                  <label className={`block text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Include Fields
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {exportFields.map((field) => (
                      <label
                        key={field.key}
                        className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                          darkMode
                            ? 'hover:bg-white/5'
                            : 'hover:bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={() => toggleField(field.key)}
                          className="w-4 h-4 rounded border-gray-300 text-[#6366f1] focus:ring-[#6366f1] focus:ring-offset-0"
                        />
                        <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {field.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Export Summary */}
            <div className={`rounded-xl border p-4 ${
              darkMode
                ? 'border-[#6366f1]/30 bg-[#6366f1]/5'
                : 'border-[#6366f1]/30 bg-[#6366f1]/5'
            }`}>
              <div className="flex items-start gap-3">
                <Eye className="w-5 h-5 text-[#6366f1] mt-0.5" />
                <div className="flex-1">
                  <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    Export Preview
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {selectedDeals.length} deal{selectedDeals.length !== 1 ? 's' : ''} • {exportFields.filter(f => f.enabled).length} field{exportFields.filter(f => f.enabled).length !== 1 ? 's' : ''} • {exportFormat.toUpperCase()} format
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`p-6 border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="secondary"
              darkMode={darkMode}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              darkMode={darkMode}
              icon={<Download className="w-4 h-4" />}
              onClick={handleExport}
              disabled={selectedDeals.length === 0}
            >
              Export {selectedDeals.length} Deal{selectedDeals.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
