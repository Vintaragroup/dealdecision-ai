import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { apiGetDealExtractionReport, isLiveBackend } from '../../lib/apiClient';

type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';
type RecommendedAction = 'proceed' | 'remediate' | 're_extract' | 'wait';

type DocumentExtractionReport = {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  verification_status: string;
  pages: number;
  file_size_bytes: number;
  extraction_quality_score: number | null;
  confidence_band: ConfidenceBand;
  recommended_action: RecommendedAction;
  recommendation_reason: string;
  verification_warnings?: string[];
  verification_recommendations?: string[];
};

type DealExtractionReport = {
  deal_id: string;
  overall_confidence_score: number | null;
  confidence_band: ConfidenceBand;
  counts: {
    total_documents: number;
    completed_verification: number;
    failed_verification: number;
    total_pages: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    unknown_confidence: number;
  };
  recommended_action: RecommendedAction;
  recommendation_reason: string;
};

type ExtractionReportResponse = {
  deal_id: string;
  extraction_report: DealExtractionReport;
  documents: DocumentExtractionReport[];
  last_updated?: string;
};

interface ExtractionReportModalProps {
  dealId: string;
  darkMode: boolean;
  onClose: () => void;
}

function formatScore(score: number | null) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return score.toFixed(2);
}

export function ExtractionReportModal({ dealId, darkMode, onClose }: ExtractionReportModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractionReportResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isLiveBackend()) {
        setError('Extraction report is only available in live backend mode.');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await apiGetDealExtractionReport(dealId);
        if (cancelled) return;
        setData(res);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load extraction report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const sortedDocs = useMemo(() => {
    const docs = data?.documents ?? [];
    const priority: Record<RecommendedAction, number> = {
      re_extract: 0,
      remediate: 1,
      wait: 2,
      proceed: 3,
    };
    return [...docs].sort((a, b) => {
      const ap = priority[a.recommended_action] ?? 99;
      const bp = priority[b.recommended_action] ?? 99;
      if (ap !== bp) return ap - bp;

      const as = typeof a.extraction_quality_score === 'number' ? a.extraction_quality_score : 999;
      const bs = typeof b.extraction_quality_score === 'number' ? b.extraction_quality_score : 999;
      if (as !== bs) return as - bs;

      return (a.title ?? '').localeCompare(b.title ?? '');
    });
  }, [data]);

  const report = data?.extraction_report;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className={`w-full max-w-5xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
      >
        <div className={`p-6 border-b ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className={`text-xl mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Extraction Report
              </h2>
              <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Deal-level extraction quality and recommendations
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
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && (
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Loading extraction report...
            </div>
          )}

          {error && (
            <div
              className={`p-4 rounded-xl border text-sm ${
                darkMode ? 'bg-red-500/10 border-red-500/20 text-red-200' : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {error}
            </div>
          )}

          {report && (
            <div
              className={`p-4 rounded-xl border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Overall confidence</div>
                  <div className={`text-2xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {formatScore(report.overall_confidence_score)}
                    <span className={`ml-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      ({report.confidence_band})
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-right">
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Recommended action</div>
                  <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{report.recommended_action}</div>
                </div>
              </div>
              <div className={`mt-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {report.recommendation_reason}
              </div>

              <div className="grid grid-cols-4 gap-3 mt-4">
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white'}`}>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Docs</div>
                  <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{report.counts.total_documents}</div>
                </div>
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white'}`}>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Completed</div>
                  <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{report.counts.completed_verification}</div>
                </div>
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white'}`}>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Failed</div>
                  <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{report.counts.failed_verification}</div>
                </div>
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white'}`}>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Pages</div>
                  <div className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>{report.counts.total_pages}</div>
                </div>
              </div>
            </div>
          )}

          {data && (
            <div className="space-y-2">
              <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-900'}`}>Documents</div>
              <div className={`rounded-xl border overflow-hidden ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
                <table className="w-full text-sm">
                  <thead className={darkMode ? 'bg-white/5' : 'bg-gray-50'}>
                    <tr>
                      <th className={`text-left py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Title</th>
                      <th className={`text-left py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Score</th>
                      <th className={`text-left py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Band</th>
                      <th className={`text-left py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Action</th>
                      <th className={`text-left py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDocs.map((doc) => (
                      <tr
                        key={doc.id}
                        className={`border-t ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                      >
                        <td className={`py-2 px-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {doc.title || 'Document'}
                        </td>
                        <td className={`py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {formatScore(doc.extraction_quality_score)}
                        </td>
                        <td className={`py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {doc.confidence_band}
                        </td>
                        <td className={`py-2 px-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {doc.recommended_action}
                        </td>
                        <td className={`py-2 px-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {doc.recommendation_reason}
                        </td>
                      </tr>
                    ))}
                    {sortedDocs.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className={`py-4 px-3 text-center ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                        >
                          No documents found for this deal.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end pt-2">
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && !data && (
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>No report loaded.</div>
          )}
        </div>
      </div>
    </div>
  );
}
