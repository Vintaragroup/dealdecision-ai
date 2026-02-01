import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import {
  apiGetDealExtractionReport,
  apiGetDocumentAnalysis,
  isLiveBackend,
  type DealExtractionReport,
  type DocumentExtractionReport,
  type DocumentAnalysisResponse,
} from '../../lib/apiClient';
import { AlertCircle, RefreshCw } from 'lucide-react';

type DataTabProps = {
  dealId: string;
  darkMode: boolean;
};

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DataTab({ dealId, darkMode }: DataTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [extractionReport, setExtractionReport] = useState<DealExtractionReport | null>(null);
  const [documents, setDocuments] = useState<DocumentExtractionReport[]>([]);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docAnalysis, setDocAnalysis] = useState<DocumentAnalysisResponse | null>(null);

  const selectedDocument = useMemo(
    () => documents.find((d) => d.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  );

  const refresh = async () => {
    if (!dealId || !isLiveBackend()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await apiGetDealExtractionReport(dealId);
      setExtractionReport(res.extraction_report);
      setDocuments(Array.isArray(res.documents) ? res.documents : []);

      // Pick a stable default selection.
      const firstDoc = Array.isArray(res.documents) && res.documents.length > 0 ? res.documents[0] : null;
      setSelectedDocumentId((prev) => prev ?? firstDoc?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load extracted data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    const run = async () => {
      if (!dealId || !selectedDocumentId || !isLiveBackend()) {
        setDocAnalysis(null);
        return;
      }

      setDocLoading(true);
      setDocError(null);
      try {
        const res = await apiGetDocumentAnalysis(dealId, selectedDocumentId);
        setDocAnalysis(res);
      } catch (e) {
        setDocError(e instanceof Error ? e.message : 'Failed to load document structured data');
        setDocAnalysis(null);
      } finally {
        setDocLoading(false);
      }
    };

    run();
  }, [dealId, selectedDocumentId]);

  if (!isLiveBackend()) {
    return (
      <div className={`text-center py-12 rounded-lg border-2 border-dashed ${
        darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
      }`}>
        <AlertCircle className={`w-12 h-12 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <h3 className={`text-base mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Live mode required</h3>
        <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
          Switch to the live backend to view extracted data used for analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Data</h3>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Stored extracted fields (structured data) that the system uses during analysis.
          </p>
        </div>
        <Button
          variant="secondary"
          darkMode={darkMode}
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={refresh}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className={`p-4 rounded-lg border ${darkMode ? 'bg-red-500/10 border-red-500/40 text-red-200' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {error}
        </div>
      )}

      {extractionReport && (
        <div className={`p-4 rounded-lg border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Overall confidence: <span className="font-medium">{extractionReport.overall_confidence_score ?? 'N/A'}</span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Band: <span className="font-medium">{extractionReport.confidence_band}</span>
            </div>
            <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Recommended action: <span className="font-medium">{extractionReport.recommended_action}</span>
            </div>
            {extractionReport.note ? (
              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{extractionReport.note}</div>
            ) : null}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`rounded-lg border overflow-hidden ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`px-4 py-3 text-sm ${darkMode ? 'bg-white/5 text-gray-300' : 'bg-gray-50 text-gray-700'}`}>
            Documents
          </div>
          <div className="divide-y divide-white/5">
            {documents.length === 0 ? (
              <div className={`p-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                No documents found for this deal.
              </div>
            ) : (
              documents.map((doc) => {
                const isSelected = doc.id === selectedDocumentId;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDocumentId(doc.id)}
                    className={`w-full text-left px-4 py-3 transition ${
                      isSelected
                        ? darkMode
                          ? 'bg-white/10'
                          : 'bg-gray-100'
                        : darkMode
                          ? 'hover:bg-white/5'
                          : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'} truncate`}>
                      {doc.title || 'Untitled document'}
                    </div>
                    <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'} flex flex-wrap gap-x-3 gap-y-1`}>
                      <span>Type: {doc.type || 'unknown'}</span>
                      <span>Status: {doc.verification_status}</span>
                      <span>Band: {doc.confidence_band}</span>
                      <span>Score: {typeof doc.extraction_quality_score === 'number' ? doc.extraction_quality_score.toFixed(2) : 'N/A'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className={`lg:col-span-2 rounded-lg border overflow-hidden ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`px-4 py-3 text-sm ${darkMode ? 'bg-white/5 text-gray-300' : 'bg-gray-50 text-gray-700'} flex items-center justify-between`}>
            <span>Extracted fields</span>
            {selectedDocument ? (
              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'} truncate max-w-[60%]`}>
                {selectedDocument.title || selectedDocument.id}
              </span>
            ) : null}
          </div>

          <div className="p-4 space-y-4">
            {!selectedDocumentId ? (
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Select a document to view its stored extracted data.
              </div>
            ) : (
              <>
                {docError && (
                  <div className={`p-4 rounded-lg border ${darkMode ? 'bg-red-500/10 border-red-500/40 text-red-200' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {docError}
                  </div>
                )}

                {docLoading ? (
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading…</div>
                ) : (
                  <>
                    <div>
                      <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>structured_data</div>
                      <pre className={`text-xs p-3 rounded-lg overflow-auto max-h-[420px] ${
                        darkMode ? 'bg-black/30 text-gray-200 border border-white/10' : 'bg-white text-gray-800 border border-gray-200'
                      }`}>
                        {formatJson(docAnalysis?.structured_data ?? null)}
                      </pre>
                    </div>

                    <div>
                      <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>extraction_metadata</div>
                      <pre className={`text-xs p-3 rounded-lg overflow-auto max-h-[260px] ${
                        darkMode ? 'bg-black/30 text-gray-200 border border-white/10' : 'bg-white text-gray-800 border border-gray-200'
                      }`}>
                        {formatJson(docAnalysis?.extraction_metadata ?? null)}
                      </pre>
                    </div>

                    {(docAnalysis?.job_status || docAnalysis?.job_message) && (
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Last job: {docAnalysis.job_status ?? 'unknown'}
                        {docAnalysis.job_progress !== null && typeof docAnalysis.job_progress === 'number'
                          ? ` (${docAnalysis.job_progress}%)`
                          : ''}
                        {docAnalysis.job_message ? ` — ${docAnalysis.job_message}` : ''}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
