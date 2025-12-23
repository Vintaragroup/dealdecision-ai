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
  confidence?: number;
  created_at?: string;
};

type ReportSectionRef = { title: string; evidence_ids?: string[] };

interface EvidencePanelProps {
  darkMode: boolean;
  evidence: EvidenceCard[];
  loading: boolean;
  lastUpdated?: string | null;
  onRefresh: () => void;
  onFetchEvidence: () => void;
  reportSections?: ReportSectionRef[];
  documentTitles?: Record<string, string>;
}

function labelForEvidence(item: EvidenceCard) {
  if (item.source === 'extraction' && item.kind === 'summary') return 'Extraction Summary';
  if (item.source === 'extraction' && item.kind === 'metric') return 'Extracted Metric';
  if (item.source === 'extraction' && item.kind === 'section') return 'Extracted Section';
  if (item.source === 'fetch_evidence' && item.kind === 'document') return 'Document';
  return `${item.source} • ${item.kind}`;
}

function formatMetricText(text: string) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { title: 'Metric', details: '' };

  const [head, ...rest] = trimmed.split(' • ');
  const headLower = head.toLowerCase();
  const isExtractedNumber = headLower.startsWith('extracted_number');
  const title = isExtractedNumber ? 'Extracted number (unlabeled)' : 'Metric';
  const details = [head, ...rest].join(' • ');
  return { title, details };
}

function confidencePct(confidence?: number) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `${pct}%`;
}

export function EvidencePanel({
  darkMode,
  evidence,
  loading,
  lastUpdated,
  onRefresh,
  onFetchEvidence,
  reportSections = [],
  documentTitles = {},
}: EvidencePanelProps) {
  const usedIn = new Map<string, string[]>();
  for (const section of reportSections) {
    const ids = Array.isArray(section?.evidence_ids) ? section.evidence_ids : [];
    for (const id of ids) {
      const list = usedIn.get(id) ?? [];
      list.push(section.title);
      usedIn.set(id, list);
    }
  }

  const metrics = evidence.filter((e) => e.source === 'extraction' && e.kind === 'metric');
  const summaries = evidence.filter((e) => e.source === 'extraction' && e.kind === 'summary');
  const sections = evidence.filter((e) => e.source === 'extraction' && e.kind === 'section');
  const other = evidence.filter((e) => !((e.source === 'extraction') && (e.kind === 'metric' || e.kind === 'summary' || e.kind === 'section')));
  const referencedCount = evidence.filter((e) => usedIn.has(e.evidence_id)).length;

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
            Evidence items derived from documents and used to support the report recommendation.
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

      {evidence.length > 0 && (
        <div className={`rounded-xl border p-4 mb-4 ${darkMode ? 'bg-white/5 border-white/10 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Summaries</div>
              <div className="text-sm font-semibold">{summaries.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Metrics</div>
              <div className="text-sm font-semibold">{metrics.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Sections</div>
              <div className="text-sm font-semibold">{sections.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Referenced in report</div>
              <div className="text-sm font-semibold">{referencedCount}/{evidence.length}</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[...summaries, ...metrics, ...sections, ...other].map((item) => {
          const usedInSections = usedIn.get(item.evidence_id) ?? [];
          const docLabel = item.document_id ? (documentTitles[item.document_id] || item.document_id) : null;
          const conf = confidencePct(item.confidence);
          const label = labelForEvidence(item);
          const metric = item.kind === 'metric' ? formatMetricText(item.text) : null;
          return (
          <div
            key={item.evidence_id}
            className={`rounded-xl border p-4 space-y-2 ${
              darkMode
                ? 'bg-white/5 border-white/10 text-gray-200'
                : 'bg-white border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <EvidenceChip evidenceId={item.evidence_id} darkMode={darkMode} />
              <div className="flex items-center gap-2">
                {conf && (
                  <span className={`text-[11px] px-2 py-1 rounded-full border ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                    Confidence {conf}
                  </span>
                )}
                {docLabel && (
                  <span className={`text-[11px] px-2 py-1 rounded-full border max-w-[220px] truncate ${darkMode ? 'border-white/10 text-gray-300' : 'border-gray-200 text-gray-700'}`}>
                    {docLabel}
                  </span>
                )}
              </div>
            </div>
            <div className={`text-xs uppercase tracking-wide ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
              {label}
            </div>
            {metric ? (
              <>
                <div className="text-sm font-semibold">{metric.title}</div>
                <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{metric.details}</div>
              </>
            ) : (
              <div className="text-sm font-semibold">{item.text}</div>
            )}

            {usedInSections.length > 0 && (
              <div className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Used in report: {usedInSections.slice(0, 3).join(', ')}{usedInSections.length > 3 ? ` (+${usedInSections.length - 3} more)` : ''}
              </div>
            )}
            {item.created_at && (
              <div className={`text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                {new Date(item.created_at).toLocaleString()}
              </div>
            )}
          </div>
        );
        })}
      </div>
    </div>
  );
}
