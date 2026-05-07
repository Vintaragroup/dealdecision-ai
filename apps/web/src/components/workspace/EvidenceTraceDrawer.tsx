/**
 * EvidenceTraceDrawer — lightweight slide-over drawer for evidence lineage inspection.
 *
 * Phase 4B.1: Evidence chips + trace drawer.
 *
 * Design intent:
 * - Institutional audit-trace layer, not annotation noise
 * - Progressive disclosure: compact chips → click → drawer → source details
 * - Never renders fake lineage data
 * - Empty states are clean and honest
 *
 * API contract: calls GET /api/v1/evidence/resolve?ids=... on open
 * Falls back gracefully if the endpoint returns no results or errors.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, FileText, Sheet, Mic2, Eye } from 'lucide-react';
import { apiResolveEvidenceIds, type EvidenceResolveResult } from '../../lib/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvidenceTraceDrawerProps = {
  open: boolean;
  onClose: () => void;
  evidenceRefs: string[];
  /** Context label shown in the drawer title (e.g. the claim text or contributor label). */
  context?: string;
  darkMode?: boolean;
};

type LoadState = 'idle' | 'loading' | 'done' | 'error';

// ─── Source icon helpers ──────────────────────────────────────────────────────

function sourceIcon(item: EvidenceResolveResult, darkMode: boolean) {
  const title = (item.document_title ?? '').toLowerCase();
  const cls = `w-3.5 h-3.5 shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`;
  if (/\.xlsx|spreadsheet|financial model|model/i.test(title)) return <Sheet className={cls} />;
  if (/deck|pitch|slides?|presentation/i.test(title)) return <Mic2 className={cls} />;
  if (/memo|document|pdf|report/i.test(title)) return <FileText className={cls} />;
  return <Eye className={cls} />;
}

/**
 * Derive a compact provenance label from a resolved evidence item.
 * Examples: "Page 14", "Sheet: Revenue_Forecast", "OCR Extract"
 */
function provenanceLabel(item: EvidenceResolveResult): string | null {
  if (!item.ok) return null;
  const title = (item.document_title ?? '').toLowerCase();
  // XLSX: prefer sheet reference if inferrable from snippet/title
  if (/xlsx|spreadsheet|financial model/i.test(title)) {
    if (typeof item.page === 'number') return `Sheet row ~${item.page}`;
    return 'Spreadsheet';
  }
  if (typeof item.page === 'number' && item.page > 0) {
    return `Page ${item.page}`;
  }
  return null;
}

function confidenceLabel(item: EvidenceResolveResult): { label: string; color: string } | null {
  // The resolve endpoint doesn't return confidence directly; we surface what we have.
  if (!item.ok || !item.resolvable) return null;
  // If the item has a snippet we treat it as higher confidence than bare ID
  if (item.snippet && item.snippet.trim().length > 20) return { label: 'Referenced', color: 'text-emerald-400' };
  if (item.document_title) return { label: 'Located', color: 'text-sky-400' };
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EvidenceTraceDrawer({
  open,
  onClose,
  evidenceRefs,
  context,
  darkMode = true,
}: EvidenceTraceDrawerProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [results, setResults] = useState<EvidenceResolveResult[]>([]);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Resolve on open
  useEffect(() => {
    if (!open || evidenceRefs.length === 0) return;
    setLoadState('loading');
    setResults([]);
    let cancelled = false;
    apiResolveEvidenceIds(evidenceRefs)
      .then((resolved) => {
        if (!cancelled) {
          setResults(resolved);
          setLoadState('done');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [open, evidenceRefs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap: close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const resolvedItems = results.filter((r) => r.ok && r.resolvable);
  const unresolvedCount = results.filter((r) => !r.ok || !r.resolvable).length;
  const hasResults = loadState === 'done';

  const bg = darkMode ? 'bg-[#111318]' : 'bg-white';
  const border = darkMode ? 'border-white/[0.08]' : 'border-gray-200';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const subCard = darkMode ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-gray-50 border-gray-200';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: darkMode ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.15)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Evidence Trace"
        className={[
          'fixed right-0 top-0 bottom-0 z-50',
          'w-full max-w-sm',
          'flex flex-col',
          `border-l ${border}`,
          bg,
          'shadow-2xl',
        ].join(' ')}
      >
        {/* Header */}
        <div className={`flex items-start justify-between gap-3 px-4 py-3.5 border-b ${border}`}>
          <div className="min-w-0">
            <div className={`text-[10px] uppercase tracking-widest font-medium mb-0.5 ${muted}`}>
              Evidence Trace
            </div>
            {context && (
              <p className={`text-xs leading-snug line-clamp-2 ${heading}`}>
                {context}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`shrink-0 p-1 rounded-md transition-colors ${
              darkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

          {/* Loading state */}
          {loadState === 'loading' && (
            <div className={`flex items-center gap-2 py-6 text-sm ${muted}`}>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
              Resolving evidence references…
            </div>
          )}

          {/* Error state */}
          {loadState === 'error' && (
            <div className={`py-4 text-sm ${muted}`}>
              Evidence references unavailable.
            </div>
          )}

          {/* No refs provided */}
          {evidenceRefs.length === 0 && (
            <div className={`py-4 text-sm ${muted}`}>
              No evidence references attached.
            </div>
          )}

          {/* Results */}
          {hasResults && results.length === 0 && evidenceRefs.length > 0 && (
            <div className={`py-4 text-sm ${muted}`}>
              Evidence references could not be loaded.
            </div>
          )}

          {hasResults && resolvedItems.length === 0 && unresolvedCount > 0 && results.length > 0 && (
            <div className={`py-4 text-sm ${muted}`}>
              Evidence reference unavailable.
            </div>
          )}

          {hasResults && resolvedItems.map((item) => {
            const provenance = provenanceLabel(item);
            const conf = confidenceLabel(item);
            const hasSnippet = item.snippet && item.snippet.trim().length > 0;

            return (
              <div
                key={item.id}
                className={`rounded-lg border p-3.5 space-y-2.5 ${subCard}`}
              >
                {/* Source header */}
                <div className="flex items-start gap-2">
                  {sourceIcon(item, darkMode)}
                  <div className="min-w-0 flex-1">
                    {item.document_title ? (
                      <p className={`text-xs font-medium leading-snug truncate ${heading}`}>
                        {item.document_title}
                      </p>
                    ) : (
                      <p className={`text-xs ${muted}`}>Unknown document</p>
                    )}
                    {provenance && (
                      <p className={`text-[10px] mt-0.5 ${muted}`}>{provenance}</p>
                    )}
                  </div>
                  {conf && (
                    <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wide ${conf.color}`}>
                      {conf.label}
                    </span>
                  )}
                </div>

                {/* Snippet */}
                {hasSnippet && (
                  <div className={`rounded-md px-3 py-2.5 ${darkMode ? 'bg-white/[0.04]' : 'bg-gray-100'}`}>
                    <p className={`text-[11px] leading-relaxed italic line-clamp-4 ${body}`}>
                      "{item.snippet!.trim()}"
                    </p>
                  </div>
                )}

                {/* No snippet available */}
                {!hasSnippet && (
                  <p className={`text-[10px] ${muted}`}>
                    Source located — no excerpt available.
                  </p>
                )}
              </div>
            );
          })}

          {/* Summary footer */}
          {hasResults && results.length > 0 && (
            <div className={`pt-2 border-t ${border}`}>
              <p className={`text-[10px] ${muted}`}>
                {resolvedItems.length} of {results.length} reference{results.length === 1 ? '' : 's'} resolved
                {unresolvedCount > 0
                  ? ` · ${unresolvedCount} unavailable`
                  : ''}
              </p>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className={`px-4 py-2.5 border-t ${border}`}>
          <p className={`text-[10px] leading-relaxed ${muted}`}>
            Evidence lineage is institutional-grade.
            Line-level references are not yet available.
          </p>
        </div>
      </div>
    </>
  );
}
