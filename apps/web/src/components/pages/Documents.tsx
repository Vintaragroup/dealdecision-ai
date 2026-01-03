import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { DocumentUpload } from '../documents/DocumentUpload';
import { DocumentLibrary } from '../documents/DocumentLibrary';
import { DocumentBatchUploadModal } from '../documents/DocumentBatchUploadModal';
import { NewDealModal } from '../NewDealModal';
import { apiGetDeals, isLiveBackend } from '../../lib/apiClient';
import { 
  Upload, 
  FolderOpen,
  FileText,
  Sparkles,
  TrendingUp,
  Plus,
  ChevronDown,
  Loader,
  AlertCircle
} from 'lucide-react';

interface DocumentsProps {
  darkMode: boolean;
}

export function Documents({ darkMode }: DocumentsProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [showCreateDealModal, setShowCreateDealModal] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<any[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string>('');
  const [showDealSelector, setShowDealSelector] = useState(false);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [availableDeals, setAvailableDeals] = useState<any[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveBackend()) {
      setDealsLoading(false);
      return;
    }

    setDealsLoading(true);
    setDealsError(null);

    apiGetDeals()
      .then(deals => {
        setAvailableDeals(deals);
        setDealsError(null);
      })
      .catch(err => {
        setDealsError(err instanceof Error ? err.message : 'Failed to load deals');
        setAvailableDeals([]);
      })
      .finally(() => setDealsLoading(false));
  }, []);

  const handleUploadComplete = (files: any[]) => {
    setUploadedDocuments(prev => [...prev, ...files]);
    setShowUpload(false);
  };

  const refreshDeals = () => {
    if (!isLiveBackend()) return;
    apiGetDeals()
      .then(deals => setAvailableDeals(deals))
      .catch(() => {});
  };

  const stats = [
    {
      label: 'Total Documents',
      value: '24',
      change: '+6 this month',
      icon: FileText,
      color: '#6366f1'
    },
    {
      label: 'AI Processed',
      value: '18',
      change: '75% of total',
      icon: Sparkles,
      color: '#8b5cf6'
    },
    {
      label: 'Storage Used',
      value: '28.4 MB',
      change: 'of 5 GB',
      icon: FolderOpen,
      color: '#10b981'
    },
    {
      label: 'Avg. Processing Time',
      value: '2.3s',
      change: '-15% faster',
      icon: TrendingUp,
      color: '#f59e0b'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div>
          <h1 className={`text-2xl mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Documents
          </h1>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Upload, manage, and analyze your deal documents with AI
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => setShowBatchUpload(true)}
            className="flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            Batch Upload
          </Button>
          <Button
            variant="primary"
            onClick={() => setShowUpload(!showUpload)}
          >
            <Upload className="w-4 h-4" />
            {showUpload ? 'Close Upload' : 'Upload Documents'}
          </Button>
        </div>
      </div>

      {/* Batch Upload Modal */}
      {showBatchUpload && (
        <DocumentBatchUploadModal
          onClose={() => setShowBatchUpload(false)}
          onSuccess={(results) => {
            setShowBatchUpload(false);
            refreshDeals();
          }}
        />
      )}

      {showCreateDealModal && (
        <NewDealModal
          isOpen={showCreateDealModal}
          darkMode={darkMode}
          onClose={() => setShowCreateDealModal(false)}
          onSuccess={(dealData, createdDeal) => {
            const newId = createdDeal?.id ?? dealData.id;
            if (newId) {
              setSelectedDealId(newId);
              setUploadError(null);
              setShowDealSelector(false);
            }
            refreshDeals();
          }}
          onCreatedDeal={(deal) => {
            if (deal?.id) setSelectedDealId(deal.id);
          }}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className={`p-5 rounded-xl border ${
                darkMode
                  ? 'bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: stat.color + '20' }}
                >
                  <Icon className="w-5 h-5" style={{ color: stat.color }} />
                </div>
              </div>
              <div className={`text-2xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {stat.value}
              </div>
              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {stat.label}
              </div>
              <div className="text-xs text-emerald-500">
                {stat.change}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload Section */}
      {showUpload && (
        <div
          className={`p-6 rounded-xl border ${
            darkMode
              ? 'bg-white/5 border-white/10'
              : 'bg-white border-gray-200'
          }`}
        >
          <h2 className={`text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Upload New Documents
          </h2>
          
          {/* Deal Selector */}
          <div className="mb-6">
            <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Associated Deal
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <button
                  onClick={() => setShowDealSelector(!showDealSelector)}
                  className={`w-full px-4 py-2 rounded-lg border text-left flex items-center justify-between ${
                    darkMode
                      ? 'bg-white/5 border-white/10 text-white hover:bg-white/10'
                      : 'bg-white border-gray-300 text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <span>
                    {selectedDealId 
                      ? availableDeals.find(d => d.id === selectedDealId)?.name 
                      : dealsLoading ? 'Loading deals...' : 'Select a deal or create new...'}
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showDealSelector ? 'rotate-180' : ''}`} />
                </button>
                
                {showDealSelector && (
                  <div className={`absolute top-full left-0 right-0 mt-1 rounded-lg border z-10 ${
                    darkMode
                      ? 'bg-gray-900 border-white/10'
                      : 'bg-white border-gray-300'
                  } shadow-lg`}>
                    {dealsLoading ? (
                      <div className="px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                        <Loader className="w-4 h-4 animate-spin" />
                        Loading deals...
                      </div>
                    ) : dealsError ? (
                      <div className="px-4 py-3 text-sm text-red-500 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {dealsError}
                      </div>
                    ) : availableDeals.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        No deals found. Create one to get started.
                      </div>
                    ) : null}
                    {availableDeals.map(deal => (
                      <button
                        key={deal.id}
                        onClick={() => {
                          setSelectedDealId(deal.id);
                          setUploadError(null);
                          setShowDealSelector(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-white/10 first:rounded-t-lg last:rounded-b-lg ${
                          selectedDealId === deal.id
                            ? darkMode ? 'bg-purple-500/30 text-purple-300' : 'bg-purple-100 text-purple-900'
                            : darkMode ? 'text-gray-300' : 'text-gray-900'
                        }`}
                      >
                        <div className="font-medium">{deal.name}</div>
                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                          {deal.stage}
                        </div>
                      </button>
                    ))}
                    <div className={`border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                      <button
                        onClick={() => {
                          setShowDealSelector(false);
                          setShowCreateDealModal(true);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm text-purple-500 hover:bg-white/10 flex items-center gap-2 rounded-b-lg`}
                      >
                        <Plus className="w-4 h-4" />
                        Create New Deal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {selectedDealId && (
              <p className="mt-2 text-xs text-emerald-500">
                ✓ Documents will be associated with {availableDeals.find(d => d.id === selectedDealId)?.name}
              </p>
            )}
            {!selectedDealId && isLiveBackend() && (
              <p className={`mt-2 text-xs ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                Select a deal (or create a new one) before uploading.
              </p>
            )}
            {uploadError && (
              <p className="mt-2 text-xs text-red-500">{uploadError}</p>
            )}
          </div>

          <DocumentUpload
            darkMode={darkMode}
            dealId={selectedDealId}
            onUploadComplete={handleUploadComplete}
            onError={(message) => setUploadError(message)}
            enableAIExtraction={true}
          />
        </div>
      )}

      {/* Document Library */}
      <div
        className={`p-6 rounded-xl border ${
          darkMode
            ? 'bg-white/5 border-white/10'
            : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Document Library
          </h2>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
            darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
          }`}>
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm text-purple-500">
              AI-Powered Analysis
            </span>
          </div>
        </div>
        <DocumentLibrary darkMode={darkMode} documents={uploadedDocuments} />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          className={`p-5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
            darkMode
              ? 'bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-blue-500/20'
              : 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
            <FileText className="w-5 h-5 text-blue-500" />
          </div>
          <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Bulk Upload
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Upload multiple documents at once with folder support
          </p>
        </div>

        <div
          className={`p-5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
            darkMode
              ? 'bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/20'
              : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5 text-purple-500" />
          </div>
          <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            AI Analysis
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Automatically extract key data from your documents
          </p>
        </div>

        <div
          className={`p-5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
            darkMode
              ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20'
              : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200'
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-3">
            <FolderOpen className="w-5 h-5 text-emerald-500" />
          </div>
          <h3 className={`text-sm mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Smart Organization
          </h3>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Auto-categorize documents by type and content
          </p>
        </div>
      </div>
    </div>
  );
}