import { RefreshCw, Sparkles } from 'lucide-react';
import { EvidenceChip } from './EvidenceChip';
import { Button } from '../ui/button';

export type EvidenceCard = {
  evidence_id: string;
  deal_id: string;
  document_id?: string;
  source: string;
  kind: string;
  text: string;
  excerpt?: string;
  created_at?: string;
};

interface EvidencePanelProps {
  darkMode: boolean;
  evidence: EvidenceCard[];
  loading: boolean;
  lastUpdated?: string | null;
  onRefresh: () => void;
  onFetchEvidence: () => void;
}

export function EvidencePanel({
  darkMode,
  evidence,
  loading,
  lastUpdated,
  onRefresh,
  onFetchEvidence,
}: EvidencePanelProps) {
  return (
    <div
      className={`rounded-2xl border p-4 sm:p-6 ${
        darkMode
          ? 'bg-gradient-to-br from-[#0f172a] via-[#111827] to-[#0b1220] border-white/10'
          : 'bg-gradient-to-br from-white via-gray-50 to-white border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Evidence</div>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Latest extracted signals per document. Auto-refreshes when fetch jobs finish.
          </p>
          {lastUpdated && (
            <div className={`text-[11px] mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            darkMode={darkMode}
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={onRefresh}
            loading={loading}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            darkMode={darkMode}
            icon={<Sparkles className="w-4 h-4" />}
            onClick={onFetchEvidence}
            disabled={loading}
          >
            Fetch Evidence
          </Button>
        </div>
      </div>

      {evidence.length === 0 && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            darkMode ? 'border-dashed border-white/10 text-gray-400' : 'border-dashed border-gray-200 text-gray-600'
          }`}
        >
          {loading ? 'Loading evidence...' : 'No evidence yet. Run Fetch Evidence to populate items.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {evidence.map((item) => (
          <div
            key={item.evidence_id}
            className={`rounded-xl border p-4 space-y-2 ${
              darkMode
                ? 'bg-white/5 border-white/10 text-gray-200'
                : 'bg-white border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <EvidenceChip evidenceId={item.evidence_id} excerpt={item.excerpt} darkMode={darkMode} />
              {item.document_id && (
                <span className={`text-[11px] px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                  Doc {item.document_id}
                </span>
              )}
            </div>
            <div className={`text-xs uppercase tracking-wide ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
              {item.source} • {item.kind}
            </div>
            <div className="text-sm font-semibold">{item.text}</div>
            {item.excerpt && (
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{item.excerpt}</p>
            )}
            {item.created_at && (
              <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                {new Date(item.created_at).toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
