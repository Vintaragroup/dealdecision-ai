/**
 * FinancialFactsRegistryPanel.tsx
 *
 * Renders the financial facts registry for a deal — all extracted FinancialFactV1
 * rows from the DB, with inline provenance metadata (formula, scale, dep-depth, etc.)
 * when available.
 *
 * Layout:
 *   - Table-style rows: metric_key | period | value | unit | confidence | source
 *   - Each row is expandable to reveal provenance lines from formatExtractionAssumptions()
 *   - Provenance section hidden entirely when fact has no provenance metadata
 *   - Empty state, loading state, error state handled cleanly
 */

import { useEffect, useState } from 'react';
import type { FinancialFactV1 } from '@dealdecision/core';
import { apiGetDealFinancialFacts } from '../../lib/apiClient';
import {
  formatExtractionAssumptions,
  type ExtractionAssumptionLine,
} from '../../lib/formatExtractionAssumptions';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';

interface Props {
  dealId: string;
  darkMode: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function formatValue(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null) return '—';
  const formatted =
    Math.abs(v) >= 1_000_000
      ? `${(v / 1_000_000).toFixed(2)}M`
      : Math.abs(v) >= 1_000
        ? `${(v / 1_000).toFixed(1)}K`
        : String(v);
  return unit ? `${formatted} ${unit}` : formatted;
}

function confidenceBadgeClass(
  confidence: string | null | undefined,
  darkMode: boolean
): string {
  if (!confidence) return darkMode ? 'text-gray-500' : 'text-gray-400';
  if (confidence === 'high') return darkMode ? 'text-emerald-400' : 'text-emerald-600';
  if (confidence === 'medium') return darkMode ? 'text-yellow-400' : 'text-yellow-600';
  return darkMode ? 'text-red-400' : 'text-red-600';
}

// ── ProvenanceLines ──────────────────────────────────────────────────────────

function ProvenanceLines({
  lines,
  darkMode,
}: {
  lines: ExtractionAssumptionLine[];
  darkMode: boolean;
}) {
  if (lines.length === 0) return null;

  return (
    <div
      className={`mt-2 pl-4 border-l-2 space-y-0.5 ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
    >
      {lines.map((ln) => (
        <div key={ln.label} className="flex gap-2 text-xs">
          <span
            className={`shrink-0 w-24 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
          >
            {ln.label}
          </span>
          <span
            className={`font-mono ${darkMode ? 'text-gray-200' : 'text-gray-700'} break-all`}
          >
            {ln.display}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── FactRow ──────────────────────────────────────────────────────────────────

function FactRow({ fact, darkMode }: { fact: FinancialFactV1; darkMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const provenanceLines = formatExtractionAssumptions(fact);
  const hasProvenance = provenanceLines.length > 0;

  return (
    <div
      className={`border-b last:border-0 ${darkMode ? 'border-white/5' : 'border-gray-100'}`}
    >
      {/* main row */}
      <div
        className={`flex items-start gap-2 px-4 py-3 ${
          hasProvenance
            ? darkMode
              ? 'cursor-pointer hover:bg-white/5'
              : 'cursor-pointer hover:bg-gray-50'
            : ''
        }`}
        onClick={hasProvenance ? () => setExpanded((v) => !v) : undefined}
        role={hasProvenance ? 'button' : undefined}
        tabIndex={hasProvenance ? 0 : undefined}
        onKeyDown={
          hasProvenance
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') setExpanded((v) => !v);
              }
            : undefined
        }
      >
        {/* expand chevron */}
        <div className="mt-0.5 shrink-0 w-4 h-4">
          {hasProvenance ? (
            expanded ? (
              <ChevronDown className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            ) : (
              <ChevronRight className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            )
          ) : null}
        </div>

        {/* metric key + source kind */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span
              className={`text-sm font-medium font-mono truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}
            >
              {fact.metric_key}
            </span>
            {fact.source_kind && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {fact.source_kind}
              </span>
            )}
          </div>
          <div className={`mt-0.5 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} flex flex-wrap gap-x-3 gap-y-0.5`}>
            <span>
              {fact.normalized_period_label ?? fact.period_label ?? '—'}
            </span>
            {fact.scenario && <span className="opacity-70">{fact.scenario}</span>}
          </div>
        </div>

        {/* value + confidence */}
        <div className="shrink-0 text-right">
          <div className={`text-sm font-mono ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {formatValue(fact.value, fact.unit)}
          </div>
          <div
            className={`text-xs ${confidenceBadgeClass(fact.confidence, darkMode)}`}
          >
            {fact.confidence ?? '—'}
          </div>
        </div>
      </div>

      {/* provenance drawer */}
      {expanded && hasProvenance && (
        <div className={`px-4 pb-3 ${darkMode ? 'bg-white/[0.02]' : 'bg-gray-50/60'}`}>
          <ProvenanceLines lines={provenanceLines} darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}

// ── FinancialFactsRegistryPanel ───────────────────────────────────────────────

export function FinancialFactsRegistryPanel({ dealId, darkMode }: Props) {
  const [facts, setFacts] = useState<FinancialFactV1[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dealId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    apiGetDealFinancialFacts(dealId, { limit: 100 })
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res?.facts) ? res.facts : [];
        setFacts(rows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load financial facts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading) {
    return (
      <div className={`text-sm py-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Loading financial facts…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`p-4 rounded-lg border text-sm ${
          darkMode
            ? 'bg-red-500/10 border-red-500/40 text-red-200'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}
      >
        {error}
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div
        className={`py-10 text-center rounded-lg border-2 border-dashed ${
          darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'
        }`}
      >
        <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <div className="text-sm">No financial facts registered yet for this deal.</div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border overflow-hidden ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
    >
      {/* header */}
      <div
        className={`px-4 py-2.5 text-xs flex items-center justify-between ${
          darkMode ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'
        }`}
      >
        <span>
          {facts.length} fact{facts.length !== 1 ? 's' : ''} — click a row to reveal
          provenance
        </span>
        <span>value · confidence</span>
      </div>

      {/* rows */}
      <div>
        {facts.map((fact) => (
          <FactRow
            key={`${fact.deal_id}:${fact.metric_key}:${fact.period_label ?? ''}:${fact.source_kind ?? ''}`}
            fact={fact}
            darkMode={darkMode}
          />
        ))}
      </div>
    </div>
  );
}
