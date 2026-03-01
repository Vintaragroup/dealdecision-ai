/**
 * DocumentReadinessCard — AI Analysis Tab exclusive component
 *
 * Renders a collapsible "Document Readiness" panel showing the Gate 1 DPU
 * readiness state directly from the API. Read-only diagnostic display.
 *
 * Data source: GET /api/v1/deals/:deal_id/readiness?page_understanding_version=page_understanding_v1
 * Fetched once on mount via apiGetDealReadiness(dealId, 'page_understanding_v1').
 *
 * SCOPE: used by OrchestratorFullReportView only (AI Analysis tab).
 * Must NOT be imported by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, FileCheck, AlertTriangle } from 'lucide-react';
import {
  apiGetDealReadiness,
  type PageUnderstandingReadiness,
  type PageUnderstandingReadinessDocument,
} from '../../../lib/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Extended local type (API may return extra fields not yet in the exported type)
// ─────────────────────────────────────────────────────────────────────────────

type ReadinessData = PageUnderstandingReadiness & {
  docs_fingerprint?: string | null;
  latest_dpu_created_at?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentReadinessCardProps {
  dealId: string;
  darkMode?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pill / badge helpers
// ─────────────────────────────────────────────────────────────────────────────

function ReadyPill({ darkMode }: { darkMode: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        darkMode
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-emerald-300 bg-emerald-50 text-emerald-700'
      }`}
      data-testid="readiness-pill-ready"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      Ready
    </span>
  );
}

function BlockedPill({ reason, darkMode }: { reason: string; darkMode: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        darkMode
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-amber-300 bg-amber-50 text-amber-700'
      }`}
      data-testid="readiness-pill-blocked"
    >
      <AlertTriangle className="w-3 h-3 shrink-0" />
      {reason}
    </span>
  );
}

function ActionPill({ action, darkMode }: { action: string; darkMode: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        darkMode
          ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
          : 'border-blue-300 bg-blue-50 text-blue-700'
      }`}
      data-testid="readiness-pill-action"
    >
      {action}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-document table (shown when expanded)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PAGES_INLINE = 10;

function pageListString(pages: number[] | undefined): string {
  if (!pages || pages.length === 0) return '';
  const preview = pages.slice(0, MAX_PAGES_INLINE).join(', ');
  return pages.length > MAX_PAGES_INLINE ? `${preview}…` : preview;
}

function DocTable({
  documents,
  darkMode,
}: {
  documents: PageUnderstandingReadinessDocument[];
  darkMode: boolean;
}) {
  const th = `text-xs font-semibold uppercase tracking-wide py-1.5 px-2 text-left ${
    darkMode ? 'text-zinc-400 border-b border-white/10' : 'text-zinc-500 border-b border-gray-200'
  }`;
  const td = `text-xs py-1.5 px-2 align-top ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`;
  const trClass = `border-b last:border-0 ${darkMode ? 'border-white/5' : 'border-gray-100'}`;

  return (
    <div className="overflow-x-auto" data-testid="readiness-doc-table">
      <table className="w-full">
        <thead>
          <tr>
            <th className={th}>Document</th>
            <th className={`${th} text-right`}>Pages</th>
            <th className={`${th} text-right`}>DPU rows</th>
            <th className={`${th} text-right`}>Missing</th>
            <th className={`${th} text-right`}>Hard missing</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const missingList = pageListString(doc.missing_pages);
            const hardList = pageListString(doc.hard_missing_pages);
            return (
              <tr key={doc.document_id} className={trClass} data-testid="readiness-doc-row">
                <td className={td}>
                  <div className="max-w-[200px]">
                    <p className="truncate">{doc.title ?? '—'}</p>
                    <p
                      className={`font-mono text-xs leading-tight mt-0.5 ${
                        darkMode ? 'text-zinc-500' : 'text-zinc-400'
                      }`}
                    >
                      {doc.document_id}
                    </p>
                  </div>
                </td>
                <td className={`${td} text-right tabular-nums`}>{doc.page_count}</td>
                <td className={`${td} text-right tabular-nums`}>{doc.dpu_rows}</td>
                <td className={`${td} text-right tabular-nums`}>
                  {doc.missing_pages.length > 0 ? (
                    <div>
                      <span
                        className={darkMode ? 'text-amber-300' : 'text-amber-700'}
                      >
                        {doc.missing_pages.length}
                      </span>
                      {missingList && (
                        <p
                          className={`font-mono text-xs leading-tight mt-0.5 ${
                            darkMode ? 'text-zinc-500' : 'text-zinc-400'
                          }`}
                        >
                          pages: {missingList}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className={darkMode ? 'text-zinc-500' : 'text-zinc-400'}>0</span>
                  )}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {(doc.hard_missing_pages ?? []).length > 0 ? (
                    <div>
                      <span
                        className={darkMode ? 'text-red-300' : 'text-red-700'}
                      >
                        {(doc.hard_missing_pages ?? []).length}
                      </span>
                      {hardList && (
                        <p
                          className={`font-mono text-xs leading-tight mt-0.5 ${
                            darkMode ? 'text-zinc-500' : 'text-zinc-400'
                          }`}
                        >
                          pages: {hardList}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className={darkMode ? 'text-zinc-500' : 'text-zinc-400'}>0</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaRow — key/value pair inside the summary grid
// ─────────────────────────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  mono,
  darkMode,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  darkMode: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span
        className={`text-xs shrink-0 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}
      >
        {label}
      </span>
      <span
        className={`text-xs text-right ${
          mono ? 'font-mono' : ''
        } ${darkMode ? 'text-zinc-200' : 'text-zinc-800'}`}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentReadinessCard (main export)
// ─────────────────────────────────────────────────────────────────────────────

export function DocumentReadinessCard({ dealId, darkMode = false }: DocumentReadinessCardProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<ReadinessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchReadiness = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await apiGetDealReadiness(dealId, 'page_understanding_v1');
      setData(result as ReadinessData);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load readiness');
      setStatus('error');
    }
  }, [dealId]);

  useEffect(() => {
    void fetchReadiness();
  }, [fetchReadiness]);

  // ── Card shell styles ──────────────────────────────────────────────────────
  const cardClass = `rounded-lg border ${
    darkMode
      ? 'border-white/10 bg-white/3'
      : 'border-gray-200 bg-gray-50/60'
  }`;

  const divider = `border-t ${darkMode ? 'border-white/8' : 'border-gray-200'}`;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className={cardClass} data-testid="readiness-card">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-[#6366f1] shrink-0" />
            <span
              className={`text-sm font-medium ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}
            >
              Document Readiness
            </span>
          </div>
          <div
            className={`h-4 w-16 rounded animate-pulse ${
              darkMode ? 'bg-white/10' : 'bg-gray-200'
            }`}
            data-testid="readiness-skeleton"
          />
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className={cardClass} data-testid="readiness-card">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-[#6366f1] shrink-0" />
            <span
              className={`text-sm font-medium ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}
            >
              Document Readiness
            </span>
          </div>
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-xs ${
              darkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => void fetchReadiness()}
            data-testid="readiness-retry"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
        {error && (
          <div className={`px-4 pb-3 text-xs ${darkMode ? 'text-red-300' : 'text-red-600'}`}
            data-testid="readiness-error">
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  if (!data) return null;

  const blockedReason = data.blocked_reason ?? null;
  const actionType = data.action?.type ?? null;
  const fingerprint = data.docs_fingerprint ?? null;
  const latestDpu = data.latest_dpu_created_at ?? null;

  return (
    <div className={cardClass} data-testid="readiness-card">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileCheck className="w-4 h-4 text-[#6366f1] shrink-0" />
          <span
            className={`text-sm font-medium ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}
          >
            Document Readiness
          </span>
        </div>
        {/* Badge pills */}
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {data.ready ? (
            <ReadyPill darkMode={darkMode} />
          ) : (
            blockedReason && <BlockedPill reason={blockedReason} darkMode={darkMode} />
          )}
          {actionType && <ActionPill action={actionType} darkMode={darkMode} />}
          {/* Toggle button */}
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse readiness details' : 'View readiness'}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${
              darkMode
                ? 'border-white/15 text-zinc-400 hover:text-zinc-200 hover:border-white/25'
                : 'border-gray-200 text-zinc-500 hover:text-zinc-700 hover:border-gray-300'
            }`}
            onClick={() => setExpanded((v) => !v)}
            data-testid="readiness-toggle"
          >
            {expanded ? (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>Hide</span>
              </>
            ) : (
              <>
                <ChevronRight className="w-3 h-3" />
                <span>View readiness</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Collapsed summary (always visible when not loading/error) ── */}
      <div className={`px-4 pb-3 ${divider} pt-3`} data-testid="readiness-summary">
        <div className="grid grid-cols-2 gap-x-4">
          <MetaRow
            label="Ready"
            value={data.ready ? 'Yes' : 'No'}
            darkMode={darkMode}
          />
          <MetaRow
            label="Expected pages"
            value={data.expected_pages_total}
            darkMode={darkMode}
          />
          <MetaRow
            label="DPU rows"
            value={data.dpu_rows_total}
            darkMode={darkMode}
          />
          <MetaRow
            label="Missing pages"
            value={data.missing_pages_total > 0 ? (
              <span className={darkMode ? 'text-amber-300' : 'text-amber-700'}>
                {data.missing_pages_total}
              </span>
            ) : (
              '0'
            )}
            darkMode={darkMode}
          />
          {(data.hard_missing_pages_total ?? 0) > 0 && (
            <MetaRow
              label="Hard missing"
              value={
                <span className={darkMode ? 'text-red-300' : 'text-red-700'}>
                  {data.hard_missing_pages_total}
                </span>
              }
              darkMode={darkMode}
            />
          )}
          {fingerprint && (
            <MetaRow
              label="Fingerprint"
              value={fingerprint}
              mono
              darkMode={darkMode}
            />
          )}
          {latestDpu && (
            <MetaRow
              label="Latest DPU"
              value={latestDpu}
              mono
              darkMode={darkMode}
            />
          )}
        </div>
      </div>

      {/* ── Expanded: per-document table ── */}
      {expanded && data.documents.length > 0 && (
        <div className={`px-4 pb-3 ${divider} pt-3`} data-testid="readiness-expanded">
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
              darkMode ? 'text-zinc-400' : 'text-zinc-500'
            }`}
          >
            Per-Document Breakdown
          </p>
          <DocTable documents={data.documents} darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}
