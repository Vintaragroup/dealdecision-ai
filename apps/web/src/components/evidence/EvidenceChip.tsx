interface EvidenceChipProps {
  evidenceId: string;
  excerpt?: string;
  darkMode?: boolean;
}

export function EvidenceChip({ evidenceId, excerpt, darkMode = true }: EvidenceChipProps) {
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs ${
        darkMode
          ? 'bg-white/5 border-white/10 text-gray-200'
          : 'bg-gray-100 border-gray-200 text-gray-700'
      }`}
      title={excerpt}
    >
      <span className="font-semibold">Evidence</span>
      <span className={darkMode ? 'text-emerald-300' : 'text-emerald-600'}>#{evidenceId}</span>
      {excerpt && (
        <span className={`truncate max-w-[160px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {excerpt}
        </span>
      )}
    </div>
  );
}
