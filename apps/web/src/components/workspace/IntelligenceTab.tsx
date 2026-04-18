/**
 * apps/web/src/components/workspace/IntelligenceTab.tsx
 * Stage 5 Intelligence (challenge_pass) read-only inspection view.
 *
 * Displays challenge_pass records for a deal, sorted by most-recent first.
 * Each entry shows: timestamp, resistance label/score, primary challenge reason,
 * and a collapsible raw JSON view of all fields.
 *
 * Data flow: API → apiGetDealIntelligence → DealIntelligenceRecord[] → this component
 * No transforms, no business logic — pure display of what's in the DB.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGetDealIntelligence, type DealIntelligenceRecord } from '../../lib/apiClient';

interface IntelligenceTabProps {
  dealId: string;
  darkMode: boolean;
}

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  'Robust':      { bg: 'bg-emerald-500/10', text: 'text-emerald-300' },
  'Moderate':    { bg: 'bg-blue-500/10',    text: 'text-blue-300'    },
  'Fragile':     { bg: 'bg-amber-500/10',   text: 'text-amber-300'   },
  'Very Fragile':{ bg: 'bg-red-500/10',     text: 'text-red-300'     },
};

function ResistanceBadge({ label, score, darkMode }: { label: string; score: number; darkMode: boolean }) {
  const colors = LABEL_COLORS[label] ?? { bg: 'bg-white/10', text: darkMode ? 'text-gray-300' : 'text-gray-600' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
      {label} <span className="opacity-70">({score})</span>
    </span>
  );
}

function FlagCounts({ critical, error, warn, darkMode }: { critical: number; error: number; warn: number; darkMode: boolean }) {
  if (critical === 0 && error === 0 && warn === 0) return null;
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {critical > 0 && <span className={`${darkMode ? 'text-red-400' : 'text-red-600'}`}>{critical} critical</span>}
      {error > 0   && <span className={`${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>{error} error</span>}
      {warn > 0    && <span className={`${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>{warn} warn</span>}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function CollapsibleJson({ label, data, darkMode }: { label: string; data: unknown; darkMode: boolean }) {
  const [open, setOpen] = useState(false);
  const isEmpty = data == null || (Array.isArray(data) && data.length === 0);
  const muted = darkMode ? 'text-gray-500' : 'text-gray-400';
  const border = darkMode ? 'border-white/10' : 'border-gray-200';

  return (
    <div className={`border rounded ${border} overflow-hidden`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
          darkMode ? 'bg-white/[0.02] hover:bg-white/[0.05]' : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{label}</span>
        <span className={muted}>{isEmpty ? 'empty' : open ? '▲ collapse' : '▼ expand'}</span>
      </button>
      {open && !isEmpty && (
        <pre className={`text-xs p-3 overflow-auto max-h-64 ${darkMode ? 'bg-[#0d1117] text-gray-300' : 'bg-white text-gray-700'}`}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function IntelligenceRecordRow({ record, darkMode }: { record: DealIntelligenceRecord; darkMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const bg = darkMode ? 'bg-white/[0.02]' : 'bg-white';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';

  return (
    <div className={`rounded-lg border overflow-hidden ${border}`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-start gap-3 p-4 text-left transition-colors ${
          darkMode ? 'bg-white/[0.02] hover:bg-white/[0.04]' : 'bg-white hover:bg-gray-50'
        }`}
      >
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ResistanceBadge
              label={record.verdict_resistance_label}
              score={record.verdict_resistance_score}
              darkMode={darkMode}
            />
            <FlagCounts
              critical={record.flag_count_critical}
              error={record.flag_count_error}
              warn={record.flag_count_warn}
              darkMode={darkMode}
            />
            <span className={`text-xs ${muted}`}>{formatTimestamp(record.created_at)}</span>
          </div>
          <p className={`text-sm ${body} line-clamp-2`}>{record.primary_challenge_reason}</p>
        </div>
        <span className={`text-xs shrink-0 mt-0.5 ${muted}`}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className={`px-4 pb-4 space-y-4 border-t ${border} ${bg}`}>

          <div className="pt-3 space-y-1.5">
            <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>Run ID</p>
            <p className={`text-xs font-mono ${muted}`}>{record.intelligence_run_id}</p>
          </div>

          <div className="space-y-1.5">
            <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>Opposing Case Summary</p>
            <p className={`text-sm ${body} whitespace-pre-wrap`}>{record.opposing_case_summary}</p>
          </div>

          {record.memory_challenge_used && record.memory_challenge_summary && (
            <div className="space-y-1.5">
              <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>Memory Signal</p>
              <p className={`text-sm ${body}`}>{record.memory_challenge_summary}</p>
            </div>
          )}

          <div className="space-y-2">
            <CollapsibleJson label="Challenge Factors" data={record.challenge_factors} darkMode={darkMode} />
            <CollapsibleJson label="Missing Evidence" data={record.missing_evidence} darkMode={darkMode} />
            <CollapsibleJson label="Diligence Gaps" data={record.diligence_gaps} darkMode={darkMode} />
            <CollapsibleJson label="Overconfident Claims" data={record.overconfident_claims} darkMode={darkMode} />
          </div>
        </div>
      )}
    </div>
  );
}

export function IntelligenceTab({ dealId, darkMode }: IntelligenceTabProps) {
  const [records, setRecords] = useState<DealIntelligenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetDealIntelligence(dealId);
      setRecords(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load intelligence data');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';

  if (loading) {
    return (
      <div className="py-8 text-center">
        <p className={`text-sm ${muted}`}>Loading intelligence records…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center space-y-3">
        <p className={`text-sm ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
        <button
          onClick={() => void load()}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/20 text-gray-300 hover:bg-white/10'
              : 'border-gray-300 text-gray-700 hover:bg-gray-100'
          }`}
        >
          Retry
        </button>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className={`text-sm font-medium ${heading}`}>No intelligence records</p>
        <p className={`text-xs ${muted}`}>
          Challenge pass results will appear here after the intelligence stage has run for this deal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className={`text-xs ${muted}`}>{records.length} run{records.length !== 1 ? 's' : ''} · most recent first</p>
        <button
          onClick={() => void load()}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            darkMode
              ? 'border-white/20 text-gray-400 hover:bg-white/10'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          Refresh
        </button>
      </div>

      <div className="space-y-3">
        {records.map((record) => (
          <IntelligenceRecordRow key={record.id ?? record.intelligence_run_id} record={record} darkMode={darkMode} />
        ))}
      </div>
    </div>
  );
}
