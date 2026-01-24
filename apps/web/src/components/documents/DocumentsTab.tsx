import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { DocumentUpload } from './DocumentUpload';
import { DocumentLibrary } from './DocumentLibrary';
import { Upload, Sparkles, FileText } from 'lucide-react';
import { apiGetDocuments, apiRetryDocument, isLiveBackend } from '../../lib/apiClient';
import type { Document } from '@dealdecision/contracts';
import { ExtractionReportModal } from './ExtractionReportModal';
import { ToastContainer, type ToastType } from '../ui/Toast';

interface DocumentsTabProps {
  dealId: string;
  darkMode?: boolean;
  reloadKey?: number;
}

export function DocumentsTab({ dealId, darkMode = true, reloadKey = 0 }: DocumentsTabProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [showExtractionReport, setShowExtractionReport] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; type: ToastType; title: string; message?: string }>>([]);

  const addToast = (type: ToastType, title: string, message?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, title, message }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const loadDocuments = async () => {
    if (!dealId || !isLiveBackend()) return;
    setLoading(true);
    try {
      const res = await apiGetDocuments(dealId);
      const normalized = (res.documents || []).map((doc) => ({
        ...doc,
        type: doc.type as Document['type'],
        status: doc.status as Document['status'],
      }));
      setDocuments(normalized);
    } catch (err) {
      addToast('error', 'Failed to load documents', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [dealId, reloadKey]);

  const handleRetry = async (documentId: string) => {
    if (!dealId || !isLiveBackend()) return;
    try {
      await apiRetryDocument(dealId, documentId);
      await loadDocuments();
    } catch (err) {
      addToast('error', 'Retry failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Toggle */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
          darkMode ? 'bg-purple-500/20' : 'bg-purple-100'
        }`}>
          <Sparkles className="w-4 h-4 text-purple-500" />
          <span className="text-sm text-purple-500">
            AI-Powered Extraction
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowExtractionReport(true)}
          >
            <FileText className="w-4 h-4" />
            Extraction Report
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowUpload(!showUpload)}
          >
            <Upload className="w-4 h-4" />
            {showUpload ? 'Close Upload' : 'Upload'}
          </Button>
        </div>
      </div>

      {/* Upload Section */}
      {showUpload && (
        <div
          className={`p-4 rounded-xl border ${
            darkMode
              ? 'bg-white/5 border-white/10'
              : 'bg-white border-gray-200'
          }`}
        >
          <DocumentUpload
            darkMode={darkMode}
            dealId={dealId}
            enableAIExtraction={!isLiveBackend()}
            onUploaded={async () => {
              await loadDocuments();
            }}
            onError={(message) => addToast('error', 'Upload failed', message)}
          />
        </div>
      )}

      {/* Document Library */}
      <DocumentLibrary
        darkMode={darkMode}
        dealId={dealId}
        documents={documents}
        loading={loading}
        onRetry={handleRetry}
        onDeleted={loadDocuments}
      />

      {showExtractionReport && (
        <ExtractionReportModal
          dealId={dealId}
          darkMode={darkMode}
          onClose={() => setShowExtractionReport(false)}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} darkMode={darkMode} />
    </div>
  );
}