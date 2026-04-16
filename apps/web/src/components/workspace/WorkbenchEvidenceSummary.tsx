type SupportStatus = 'supported' | 'weak' | 'missing' | 'unknown';

interface SectionRow {
  key: string;
  label: string;
  support_status?: SupportStatus;
  evidence_count_linked?: number;
  evidence_count_total?: number;
  missing_reasons?: string[];
}

interface EvidenceCard {
  evidence_id: string;
  source: string;
  kind: string;
  text: string;
}

interface Props {
  evidence: EvidenceCard[];
  evidenceLoading: boolean;
  scoreBreakdownSections: SectionRow[];
  documentTitles: Record<string, string>;
  darkMode: boolean;
  onOpenFull?: () => void;
}

export function WorkbenchEvidenceSummary({
  evidence,
  evidenceLoading,
  scoreBreakdownSections,
  documentTitles,
  darkMode,
  onOpenFull,
}: Props) {
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const sub = darkMode ? 'text-gray-300' : 'text-gray-700';
  const cardBg = darkMode ? 'bg-white/[0.03]' : 'bg-gray-50';

  const docCount = Object.keys(documentTitles).length;
  const evidenceCount = evidence.length;

  const supported = scoreBreakdownSections.filter((s) => s.support_status === 'supported');
  const unsupported = scoreBreakdownSections.filter((s) => s.support_status === 'missing');
  const weak = scoreBreakdownSections.filter((s) => s.support_status === 'weak');

  const topEvidence = [...evidence]
    .filter((e) => typeof e.text === 'string' && e.text.trim().length > 20)
    .sort((a, b) => {
      const ca = typeof a.confidence === 'number' ? a.confidence : 0;
      const cb = typeof b.confidence === 'number' ? b.confidence : 0;
      return cb - ca;
    })
    .slice(0, 3);

  const hasAnything =
    evidenceCount > 0 ||
    scoreBreakdownSections.length > 0 ||
    docCount > 0;

  if (evidenceLoading) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted}`}>Loading evidence…</div>
      </div>
    );
  }

  if (!hasAnything) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted} mb-3`}>Summary not available yet.</div>
        {onOpenFull && (
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full evidence explorer
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`border-t ${border} divide-y ${darkMode ? 'divide-white/5' : 'divide-gray-100'}`}>

      {/* Coverage header */}
      {(docCount > 0 || evidenceCount > 0) && (
        <div className="px-4 py-3 flex items-center gap-4">
          {docCount > 0 && (
            <div className="text-center">
              <div className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{docCount}</div>
              <div className={`text-xs ${muted}`}>Sources</div>
            </div>
          )}
          {evidenceCount > 0 && (
            <div className="text-center">
              <div className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{evidenceCount}</div>
              <div className={`text-xs ${muted}`}>Evidence items</div>
            </div>
          )}
          {supported.length > 0 && (
            <div className="text-center">
              <div className="text-base font-semibold text-emerald-400">{supported.length}</div>
              <div className={`text-xs ${muted}`}>Sections Supported</div>
              <div className={`text-xs ${muted} opacity-60`}>analysis snapshot</div>
            </div>
          )}
          {unsupported.length > 0 && (
            <div className="text-center">
              <div className="text-base font-semibold text-red-400">{unsupported.length}</div>
              <div className={`text-xs ${muted}`}>Sections Missing</div>
              <div className={`text-xs ${muted} opacity-60`}>analysis snapshot</div>
            </div>
          )}
        </div>
      )}

      {/* Section coverage summary */}
      {scoreBreakdownSections.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Section Coverage</div>
          {scoreBreakdownSections.slice(0, 6).map((s) => {
            const dot =
              s.support_status === 'supported'
                ? 'text-emerald-400'
                : s.support_status === 'weak'
                ? 'text-amber-400'
                : s.support_status === 'missing'
                ? 'text-red-400'
                : muted;
            const symbol =
              s.support_status === 'supported' ? '●' : s.support_status === 'weak' ? '◐' : s.support_status === 'missing' ? '○' : '–';
            return (
              <div key={s.key} className="flex items-center justify-between gap-2">
                <div className={`flex items-center gap-1.5 text-xs ${sub}`}>
                  <span className={dot}>{symbol}</span>
                  <span>{s.label ?? s.key}</span>
                </div>
                {(s.evidence_count_linked != null || s.evidence_count_total != null) && (
                  <span className={`text-xs ${muted}`}>{s.evidence_count_linked ?? s.evidence_count_total} items</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unsupported claims */}
      {unsupported.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Unsupported Claims</div>
          {unsupported.slice(0, 3).map((s) => (
            <div key={s.key} className={`text-xs ${muted} flex items-start gap-1.5`}>
              <span className="mt-0.5 shrink-0 text-red-400">○</span>
              <span>{s.label ?? s.key}{s.missing_reasons?.[0] ? ` — ${s.missing_reasons[0]}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top linked evidence snippets */}
      {topEvidence.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Top Evidence</div>
          {topEvidence.map((e) => (
            <div key={e.evidence_id} className={`text-xs ${sub} line-clamp-2 leading-relaxed`}>
              <span className={`font-medium ${muted} mr-1`}>{e.kind}:</span>
              {e.text}
            </div>
          ))}
        </div>
      )}

      {/* CTA footer */}
      {onOpenFull && (
        <div className={`px-4 py-3 ${cardBg}`}>
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full evidence explorer →
          </button>
        </div>
      )}
    </div>
  );
}
