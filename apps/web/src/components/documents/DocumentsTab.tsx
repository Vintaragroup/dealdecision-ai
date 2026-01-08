import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { DocumentUpload } from './DocumentUpload';
import { DocumentLibrary } from './DocumentLibrary';
import { Upload, Sparkles, FileText } from 'lucide-react';
import { apiGetDocuments, apiRetryDocument, isLiveBackend } from '../../lib/apiClient';
import type { Document } from '@dealdecision/contracts';
import { ExtractionReportModal } from './ExtractionReportModal';

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
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [dealId, reloadKey]);

  const handleRetry = async (documentId: string) => {
    if (!dealId || !isLiveBackend()) return;
    await apiRetryDocument(dealId, documentId);
    await loadDocuments();
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
            onError={(message) => console.error(message)}
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
    </div>
  );
}