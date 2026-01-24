import { useMemo, useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { DocumentUpload } from '../documents/DocumentUpload';
import { DocumentLibrary } from '../documents/DocumentLibrary';
import { DocumentBatchUploadModal } from '../documents/DocumentBatchUploadModal';
import { DealExtractionReportModal } from '../documents/DealExtractionReportModal';
import { NewDealModal } from '../NewDealModal';
import type { Document as ApiDocument } from '@dealdecision/contracts';
import { apiGetDeals, apiGetDocuments, apiRetryDocument, isLiveBackend } from '../../lib/apiClient';
import { useAuth } from '@clerk/clerk-react';
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
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [showCreateDealModal, setShowCreateDealModal] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string>('');
  const [showDealSelector, setShowDealSelector] = useState(false);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [availableDeals, setAvailableDeals] = useState<any[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);

  const [showAiAnalysis, setShowAiAnalysis] = useState(false);
  const [focusLibrarySignal, setFocusLibrarySignal] = useState(0);

  // Informational only: do not use this to disable production behavior.
  const backendIsLive = isLiveBackend();

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn || !orgId) {
      setDealsLoading(false);
      setDealsError(null);
      setAvailableDeals([]);
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
  }, [authLoaded, isSignedIn, orgId]);

  const refreshDocuments = async (dealId: string) => {
    if (!dealId) return;
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const res = await apiGetDocuments(dealId);
      setDocuments(res.documents as ApiDocument[]);
      setDocumentsError(null);
    } catch (err) {
      setDocuments([]);
      setDocumentsError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setDocumentsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDealId) {
      setDocuments([]);
      setDocumentsError(null);
      setDocumentsLoading(false);
      return;
    }

    void refreshDocuments(selectedDealId);
  }, [selectedDealId]);

  const refreshDeals = () => {
    if (!authLoaded) return;
    if (!isSignedIn || !orgId) return;
    apiGetDeals()
      .then(deals => setAvailableDeals(deals))
      .catch(() => {});
  };

  const selectedDealName = useMemo(() => {
    if (!selectedDealId) return null;
    return availableDeals.find((d) => d.id === selectedDealId)?.name ?? null;
  }, [availableDeals, selectedDealId]);

  const docsSummary = useMemo(() => {
    const total = documents.length;
    const completed = documents.filter((d) => d.status === 'completed').length;
    const pending = documents.filter((d) => d.status === 'pending' || d.status === 'processing').length;
    return { total, completed, pending };
  }, [documents]);

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

      {!backendIsLive && (
        <div
          className={`p-4 rounded-xl border text-sm ${
            darkMode
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          Backend mode is set to mock. The UI will still attempt real API calls (no silent local-only fallbacks).
        </div>
      )}

      {/* Batch Upload Modal */}
      {showBatchUpload && (
        <DocumentBatchUploadModal
          onClose={() => setShowBatchUpload(false)}
          onSuccess={(results) => {
            setShowBatchUpload(false);
            refreshDeals();
            if (selectedDealId) void refreshDocuments(selectedDealId);
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

      {/* Deal Selector */}
      <div
        className={`p-5 rounded-xl border ${
          darkMode
            ? 'bg-white/5 border-white/10'
            : 'bg-white border-gray-200'
        }`}
      >
          <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Current Deal
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
                    ? availableDeals.find((d) => d.id === selectedDealId)?.name
                    : dealsLoading
                      ? 'Loading deals...'
                      : 'Select a deal...'}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showDealSelector ? 'rotate-180' : ''}`} />
              </button>

              {showDealSelector && (
                <div
                  className={`absolute top-full left-0 right-0 mt-1 rounded-lg border z-10 ${
                    darkMode
                      ? 'bg-gray-900 border-white/10'
                      : 'bg-white border-gray-300'
                  } shadow-lg`}
                >
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
                    <div className="px-4 py-3 text-sm text-gray-500">No deals found. Create one to get started.</div>
                  ) : null}

                  {availableDeals.map((deal) => (
                    <button
                      key={deal.id}
                      onClick={() => {
                        setSelectedDealId(deal.id);
                        setUploadError(null);
                        setShowDealSelector(false);
                      }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-white/10 first:rounded-t-lg last:rounded-b-lg ${
                        selectedDealId === deal.id
                          ? darkMode
                            ? 'bg-purple-500/30 text-purple-300'
                            : 'bg-purple-100 text-purple-900'
                          : darkMode
                            ? 'text-gray-300'
                            : 'text-gray-900'
                      }`}
                    >
                      <div className="font-medium">{deal.name}</div>
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{deal.stage}</div>
                    </button>
                  ))}

                  <div className={`border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                    <button
                      onClick={() => {
                        setShowDealSelector(false);
                        setShowCreateDealModal(true);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-purple-500 hover:bg-white/10 flex items-center gap-2 rounded-b-lg"
                    >
                      <Plus className="w-4 h-4" />
                      Create New Deal
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Button variant="secondary" onClick={() => setShowUpload(true)} className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload
            </Button>
          </div>

          {!selectedDealId && (
            <p className={`mt-2 text-xs ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
              Select a deal to view and upload documents.
            </p>
          )}
      </div>

      {selectedDealId && (
        <div
          className={`p-5 rounded-xl border ${
            darkMode
              ? 'bg-gradient-to-br from-white/5 to-white/[0.02] border-white/10'
              : 'bg-white border-gray-200'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Viewing documents for
              </div>
              <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {selectedDealName ?? 'Selected deal'}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className={`flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <FileText className="w-4 h-4" />
                {docsSummary.total} total
              </div>
              <div className={`flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <Sparkles className="w-4 h-4" />
                {docsSummary.completed} completed
              </div>
              <div className={`flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <TrendingUp className="w-4 h-4" />
                {docsSummary.pending} in progress
              </div>
            </div>
          </div>
        </div>
      )}

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

          {uploadError && <p className="mb-4 text-xs text-red-500">{uploadError}</p>}

          <DocumentUpload
            darkMode={darkMode}
            dealId={selectedDealId}
            onUploaded={() => {
              if (selectedDealId) void refreshDocuments(selectedDealId);
              setShowUpload(false);
            }}
            onUploadComplete={() => setShowUpload(false)}
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
        {!selectedDealId && (
          <div className={`p-4 rounded-lg border text-sm ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
            Select a deal in the upload panel to view its documents here.
          </div>
        )}
        {documentsError && (
          <div className={`p-4 rounded-lg border text-sm ${darkMode ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {documentsError}
          </div>
        )}
        <DocumentLibrary
          darkMode={darkMode}
          dealId={selectedDealId || undefined}
          documents={documents}
          loading={documentsLoading}
          onRetry={async (documentId) => {
            if (!selectedDealId) return;
            try {
              await apiRetryDocument(selectedDealId, documentId);
              void refreshDocuments(selectedDealId);
            } catch (err) {
              setDocumentsError(err instanceof Error ? err.message : 'Failed to retry document');
            }
          }}
          onDeleted={() => {
            if (selectedDealId) void refreshDocuments(selectedDealId);
          }}
          focusSearchSignal={focusLibrarySignal}
        />
      </div>

      {showAiAnalysis && selectedDealId && (
        <DealExtractionReportModal
          dealId={selectedDealId}
          darkMode={darkMode}
          onClose={() => setShowAiAnalysis(false)}
        />
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          onClick={() => setShowBatchUpload(true)}
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
          onClick={() => {
            if (!selectedDealId) {
              setShowUpload(false);
              return;
            }
            setShowAiAnalysis(true);
          }}
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
          onClick={() => setFocusLibrarySignal((n) => n + 1)}
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