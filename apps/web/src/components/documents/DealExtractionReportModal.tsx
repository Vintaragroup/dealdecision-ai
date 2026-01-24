import { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Loader, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import {
  apiGetDealExtractionReport,
  apiPostReextractDocuments,
  apiPostVerifyDealDocuments,
  isLiveBackend,
  type DealExtractionReport,
  type DocumentExtractionReport,
} from '../../lib/apiClient';

interface DealExtractionReportModalProps {
  dealId: string;
  darkMode: boolean;
  onClose: () => void;
}

function labelConfidenceBand(band: string): string {
  switch (band) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Unknown';
  }
}

function labelRecommendedAction(action: string): string {
  switch (action) {
    case 'proceed':
      return 'Proceed';
    case 'remediate':
      return 'Remediate';
    case 're_extract':
      return 'Re-extract';
    case 'wait':
      return 'Wait';
    default:
      return action || '—';
  }
}

export function DealExtractionReportModal({ dealId, darkMode, onClose }: DealExtractionReportModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dealReport, setDealReport] = useState<DealExtractionReport | null>(null);
  const [documents, setDocuments] = useState<DocumentExtractionReport[]>([]);
  const [actionBusy, setActionBusy] = useState(false);

  const canRead = isLiveBackend() && !!dealId;

  const refresh = async () => {
    if (!canRead) {
      setError('This view requires live backend mode.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiGetDealExtractionReport(dealId);
      setDealReport(res.extraction_report);
      setDocuments(res.documents);
      setError(null);
    } catch (err) {
      setDealReport(null);
      setDocuments([]);
      setError(err instanceof Error ? err.message : 'Failed to load extraction report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const summary = useMemo(() => {
    const r = dealReport;
    if (!r) return null;
    return {
      overallBand: labelConfidenceBand(r.confidence_band),
      recommendedAction: labelRecommendedAction(r.recommended_action),
      reason: r.recommendation_reason,
      counts: r.counts,
    };
  }, [dealReport]);

  const handleVerify = async () => {
    if (!dealId) return;
    setActionBusy(true);
    try {
      await apiPostVerifyDealDocuments(dealId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enqueue verification');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReextract = async () => {
    if (!dealId) return;
    setActionBusy(true);
    try {
      await apiPostReextractDocuments(dealId, { include_warnings: true });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enqueue re-extraction');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      style={{ zIndex: 1000 }}
      onMouseDown={onClose}
    >
      <div className="min-h-screen flex items-center justify-center p-4">
        <div
          className={`w-full max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col ${
            darkMode ? 'bg-[#18181b]' : 'bg-white'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={`p-5 border-b ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>AI Analysis Status</div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Extraction quality, verification, and recommended next actions for this deal.
                </div>
              </div>
              <button
                onClick={onClose}
                className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="secondary"
                size="sm"
                darkMode={darkMode}
                onClick={() => void refresh()}
                disabled={loading || actionBusy}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                darkMode={darkMode}
                onClick={() => void handleVerify()}
                disabled={loading || actionBusy}
              >
                <ShieldCheck className="w-4 h-4" />
                Verify
              </Button>
              <Button
                variant="secondary"
                size="sm"
                darkMode={darkMode}
                onClick={() => void handleReextract()}
                disabled={loading || actionBusy}
              >
                <RefreshCw className="w-4 h-4" />
                Re-extract
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loading && (
              <div className={`p-4 rounded-lg border text-sm flex items-center gap-2 ${
                darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'
              }`}>
                <Loader className="w-4 h-4 animate-spin" />
                Loading extraction report…
              </div>
            )}

            {error && (
              <div className={`p-4 rounded-lg border text-sm flex items-center gap-2 ${
                darkMode
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}>
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {summary && (
              <div className={`p-4 rounded-xl border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Overall confidence</div>
                    <div className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>{summary.overallBand}</div>
                  </div>
                  <div>
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Recommended action</div>
                    <div className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>{summary.recommendedAction}</div>
                  </div>
                  <div>
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Documents</div>
                    <div className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>{summary.counts.total_documents}</div>
                  </div>
                </div>

                <div className={`mt-3 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{summary.reason}</div>
              </div>
            )}

            {documents.length > 0 && (
              <div className={`rounded-xl border overflow-hidden ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                <div className={`px-4 py-3 text-sm ${darkMode ? 'bg-white/5 text-white' : 'bg-gray-50 text-gray-900'}`}>
                  Document-level recommendations
                </div>
                <div className="divide-y divide-white/10">
                  {documents.map((d) => (
                    <div key={d.id} className={`px-4 py-3 text-sm ${darkMode ? 'bg-[#18181b]' : 'bg-white'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{d.title ?? 'Untitled'}</div>
                          <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                            {String(d.type ?? 'other')} • {String(d.status ?? 'unknown')} • {labelConfidenceBand(d.confidence_band)}
                          </div>
                        </div>
                        <div className={`text-xs px-2 py-1 rounded-full border ${
                          d.recommended_action === 'proceed'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : d.recommended_action === 'wait'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                              : d.recommended_action === 're_extract'
                                ? 'bg-red-500/10 text-red-300 border-red-500/30'
                                : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                        }`}
                        >
                          {labelRecommendedAction(d.recommended_action)}
                        </div>
                      </div>
                      <div className={`text-xs mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{d.recommendation_reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
