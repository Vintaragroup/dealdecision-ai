interface EvidenceChipProps {
  evidenceId: string;
  label?: string;
  excerpt?: string;
  darkMode?: boolean;
}

function shortEvidenceId(id: string): string {
  const s = String(id ?? '').trim();
  if (!s) return '';
  if (s.length <= 12) return s;
  return `…${s.slice(-8)}`;
}

export function EvidenceChip({ evidenceId, label, excerpt, darkMode = true }: EvidenceChipProps) {
  const fullId = String(evidenceId ?? '');
  const shortId = shortEvidenceId(fullId);
  const titleParts = [label ? label.trim() : 'Evidence', fullId ? `#${fullId}` : '', excerpt ? `— ${excerpt}` : '']
    .filter((p) => typeof p === 'string' && p.trim().length > 0);

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs ${
        darkMode
          ? 'bg-white/5 border-white/10 text-gray-200'
          : 'bg-gray-100 border-gray-200 text-gray-700'
      }`}
      title={titleParts.join(' ')}
    >
      <span className="font-semibold">{label && label.trim().length > 0 ? label.trim() : 'Evidence'}</span>
      {shortId ? (
        <span className={darkMode ? 'text-emerald-300' : 'text-emerald-600'}>#{shortId}</span>
      ) : null}
      {excerpt && (
        <span className={`truncate max-w-[160px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {excerpt}
        </span>
      )}
    </div>
  );
}
