/**
 * EvidencePanel — Collapsible list of evidence citations for a module.
 * Null-safe: renders nothing when evidence is absent.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { EvidenceItem } from '../../../types/investor-insights';

interface EvidencePanelProps {
  darkMode: boolean;
  evidence: EvidenceItem[] | null | undefined;
}

const CONFIDENCE_PILL: Record<string, string> = {
  High: 'bg-green-500/20 text-green-400',
  Medium: 'bg-yellow-500/20 text-yellow-400',
  Low: 'bg-red-500/20 text-red-400',
};

export function EvidencePanel({ darkMode, evidence }: EvidencePanelProps) {
  const [open, setOpen] = useState(false);

  if (!evidence || evidence.length === 0) return null;

  return (
    <div className={`mt-3 rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-2.5 text-left rounded-lg transition-colors ${
          darkMode ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-50 text-gray-500'
        }`}
      >
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">
            {evidence.length} source{evidence.length !== 1 ? 's' : ''}
          </span>
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Evidence list */}
      {open && (
        <ul className="px-4 pb-3 space-y-2.5 border-t border-inherit">
          {evidence.map((item, i) => (
            <li key={item.evidence_id ?? i} className="pt-2.5">
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
                >
                  {item.data_point}
                </span>
                <span
                  className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    CONFIDENCE_PILL[item.confidence] ?? 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {item.confidence}
                </span>
              </div>
              <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {item.source_document}
                {item.source_location ? ` — ${item.source_location}` : ''}
                {item.page_number != null ? ` (p. ${item.page_number})` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
