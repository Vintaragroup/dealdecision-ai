/**
 * DealTermsCard  — AI Analysis Tab exclusive component
 *
 * Renders a governed LLM narrative + structured assessment visualisation for
 * deal structure.  Replaces the raw deterministic Deal Terms table in the AI
 * Analysis Tab.
 *
 * SCOPE: used by AnalysisTab (standalone card) and InvestorReportView (embedded
 * inside the Deal Terms section via the `embedded` prop).  Must NOT be imported
 * by InvestorInsightsTab, DueDiligenceReport, or any export route.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { DealTermsAnalysisResult, DealTermsAssessmentLevel } from '../../lib/apiClient';
import { parseCanonicalFieldsBody, fieldLabel } from './investorInsightsUtils';
import type { InvestorInsightsReport } from '../../lib/apiClient';
import { useDealTermsAnalysis } from '../../hooks/useDealTermsAnalysis';

// ─── Color helpers ────────────────────────────────────────────────────────────

interface LevelColors {
  bar: string;          // tailwind bg class
  badge: string;        // tailwind text + bg + border classes
  label: string;        // display text
}

function levelColors(level: DealTermsAssessmentLevel, darkMode: boolean): LevelColors {
  if (level === 'High') {
    return {
      bar: 'bg-emerald-500',
      badge: darkMode
        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        : 'bg-emerald-50 border-emerald-300 text-emerald-700',
      label: 'High',
    };
  }
  if (level === 'Medium') {
    return {
      bar: 'bg-amber-500',
      badge: darkMode
        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
        : 'bg-amber-50 border-amber-300 text-amber-700',
      label: 'Medium',
    };
  }
  // Low
  return {
    bar: 'bg-red-500',
    badge: darkMode
      ? 'bg-red-500/15 border-red-500/40 text-red-300'
      : 'bg-red-50 border-red-300 text-red-700',
    label: 'Low',
  };
}

function barWidth(level: DealTermsAssessmentLevel): string {
  if (level === 'High') return 'w-full';
  if (level === 'Medium') return 'w-3/5';
  return 'w-2/5';
}

// ─── Single assessment row ────────────────────────────────────────────────────

function AssessmentRow({
  label,
  level,
  darkMode,
}: {
  label: string;
  level: DealTermsAssessmentLevel;
  darkMode: boolean;
}) {
  const colors = levelColors(level, darkMode);
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-40 shrink-0 text-xs font-medium ${darkMode ? 'text-zinc-300' : 'text-gray-600'}`}
      >
        {label}
      </span>
      {/* Mini bar */}
      <div
        className={`flex-1 h-1.5 rounded-full overflow-hidden ${
          darkMode ? 'bg-white/10' : 'bg-gray-200'
        }`}
      >
        <div className={`h-full rounded-full transition-all duration-700 ${colors.bar} ${barWidth(level)}`} />
      </div>
      {/* Badge */}
      <span
        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${colors.badge}`}
      >
        {level}
      </span>
    </div>
  );
}

// ─── Raw canonical field table (Details inspector) ───────────────────────────

const RAISE_TERM_CATEGORIES = new Set([
  'raise_terms',
  'raise',
  'terms',
  'investment',
  'funding',
]);

function RawFieldTable({
  canonicalSection,
  darkMode,
}: {
  canonicalSection: { body?: string } | undefined;
  darkMode: boolean;
}) {
  if (!canonicalSection || typeof canonicalSection.body !== 'string') {
    return (
      <p className={`text-xs italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        No canonical field data available.
      </p>
    );
  }

  const allRows = parseCanonicalFieldsBody(canonicalSection.body);
  const rows = allRows.filter(
    (r) =>
      RAISE_TERM_CATEGORIES.has(r.category.toLowerCase()) ||
      r.category.toLowerCase().includes('raise') ||
      r.category.toLowerCase().includes('term') ||
      r.category.toLowerCase().includes('valuat') ||
      r.category.toLowerCase().includes('note'),
  );
  const displayRows = rows.length > 0 ? rows : allRows.slice(0, 15);

  if (displayRows.length === 0) {
    return (
      <p className={`text-xs italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        No raise-terms fields found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr
            className={`border-b ${
              darkMode ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
            }`}
          >
            <th className="text-left py-2 pr-3 font-medium w-32">Field</th>
            <th className="text-left py-2 pr-3 font-medium">Value</th>
            <th className="text-left py-2 font-medium w-24">Computability</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr
              key={i}
              className={`border-b ${
                darkMode ? 'border-white/5 text-gray-300' : 'border-gray-100 text-gray-700'
              }`}
            >
              <td className="py-1.5 pr-3 font-mono text-xs opacity-80">{fieldLabel(row.field)}</td>
              <td className={`py-1.5 pr-3 ${row.value ? '' : 'italic opacity-40'}`}>
                {row.value ?? 'not disclosed'}
              </td>
              <td
                className={`py-1.5 text-xs ${
                  row.computability === 'Computable'
                    ? darkMode ? 'text-emerald-400' : 'text-emerald-600'
                    : darkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                {row.computability}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DealTermsSkeleton({ darkMode }: { darkMode: boolean }) {
  const shimmer = darkMode ? 'bg-white/8 animate-pulse' : 'bg-gray-200 animate-pulse';
  return (
    <div className="space-y-4" aria-label="Loading deal terms analysis">
      <div className={`h-4 rounded ${shimmer} w-3/4`} />
      <div className={`h-4 rounded ${shimmer} w-full`} />
      <div className={`h-4 rounded ${shimmer} w-5/6`} />
      <div className="pt-2 space-y-3">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-center gap-3">
            <div className={`h-3 rounded ${shimmer} w-40`} />
            <div className={`flex-1 h-1.5 rounded-full ${shimmer}`} />
            <div className={`h-5 w-14 rounded ${shimmer}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

interface DealTermsCardProps {
  dealId: string;
  report: InvestorInsightsReport;
  darkMode: boolean;
  /**
   * When true, omits the outer card border/bg and the "Deal Terms" h3 title.
   * Use when embedding inside InvestorReportView's Deal Terms ReportSection
   * (which already provides the section heading and card background).
   */
  embedded?: boolean;
}

export function DealTermsCard({ dealId, report, darkMode, embedded }: DealTermsCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const { status, data, canonicalFields, error, refresh } = useDealTermsAnalysis(dealId, report);

  const canonicalSection = report.render_package?.sections?.find(
    (s) => s.key === 'canonical_fields',
  );

  // ── Loading ──
  if (status === 'idle' || status === 'loading') {
    const governedBadge = (
      <span
        className={`text-xs px-1.5 py-0.5 rounded border ${
          darkMode
            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
            : 'bg-indigo-50 border-indigo-200 text-indigo-700'
        }`}
      >
        AI Governed
      </span>
    );
    if (embedded) {
      return (
        <div className="space-y-3" data-testid="deal-terms-loading-skeleton">
          <div className="flex items-center gap-2">{governedBadge}</div>
          <DealTermsSkeleton darkMode={darkMode} />
        </div>
      );
    }
    return (
      <div
        className={`rounded-xl border p-5 ${
          darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Deal Terms
          </h3>
          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded border ${
            darkMode
              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
              : 'bg-indigo-50 border-indigo-200 text-indigo-700'
          }`}>
            AI Governed
          </span>
        </div>
        <DealTermsSkeleton darkMode={darkMode} />
      </div>
    );
  }

  // ── No data ──
  if (status === 'no_data') {
    const noDataMsg = (
      <p className={`text-sm italic ${darkMode ? 'text-zinc-400' : 'text-gray-400'}`}>
        No deal terms found in canonical fields. Regenerate investor insights after uploading term
        sheet or pitch deck.
      </p>
    );
    if (embedded) return <div className="space-y-2">{noDataMsg}</div>;
    return (
      <div
        className={`rounded-xl border p-5 ${
          darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Deal Terms
          </h3>
        </div>
        {noDataMsg}
      </div>
    );
  }

  // ── Error ──
  if (status === 'error' || !data) {
    const errorContent = (
      <>
        <div
          className={`flex items-start gap-2 text-sm rounded-lg border p-3 mb-3 ${
            darkMode ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error ?? 'Deal terms synthesis failed.'}</span>
        </div>
        <button
          onClick={refresh}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/15 text-zinc-300 hover:bg-white/5'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
        {/* Still expose raw table in error state for developer inspection */}
        <div className="mt-4">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
              darkMode
                ? 'border-white/15 text-zinc-400 hover:bg-white/5'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            data-testid="deal-terms-details-toggle"
          >
            {showDetails ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showDetails ? 'Hide Details' : 'View Details'}
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showDetails && (
            <div className={`mt-3 rounded-lg border p-3 ${darkMode ? 'border-white/8 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
              <RawFieldTable canonicalSection={canonicalSection} darkMode={darkMode} />
            </div>
          )}
        </div>
      </>
    );
    if (embedded) return <div className="space-y-2">{errorContent}</div>;
    return (
      <div
        className={`rounded-xl border p-5 ${
          darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Deal Terms
          </h3>
        </div>
        <div
          className={`flex items-start gap-2 text-sm rounded-lg border p-3 mb-3 ${
            darkMode ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error ?? 'Deal terms synthesis failed.'}</span>
        </div>
        <button
          onClick={refresh}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/15 text-zinc-300 hover:bg-white/5'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>

        {/* Still expose raw table in error state for developer inspection */}
        <div className="mt-4">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
              darkMode
                ? 'border-white/15 text-zinc-400 hover:bg-white/5'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            data-testid="deal-terms-details-toggle"
          >
            {showDetails ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showDetails ? 'Hide Details' : 'View Details'}
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showDetails && (
            <div className={`mt-3 rounded-lg border p-3 ${darkMode ? 'border-white/8 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
              <RawFieldTable canonicalSection={canonicalSection} darkMode={darkMode} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Ready ──
  const assessment = data.structure_assessment;
  const assessmentRows: Array<{ label: string; level: DealTermsAssessmentLevel }> = [
    { label: 'Simplicity', level: assessment.simplicity },
    { label: 'Dilution Visibility', level: assessment.dilution_visibility },
    { label: 'Valuation Clarity', level: assessment.valuation_clarity },
    { label: 'Downside Protection', level: assessment.downside_protection },
  ];
  const hasMissing = data.missing_terms.length > 0;

  // Shared body used by both embedded and standalone paths
  const readyBody = (
    <>
      {/* Narrative paragraph */}
      <p
        className={`text-sm leading-relaxed ${darkMode ? 'text-zinc-100' : 'text-gray-700'}`}
        data-testid="deal-terms-narrative"
      >
        {data.structure_summary}
      </p>

      {/* Assessment badges */}
      <div
        className={`rounded-lg border p-4 space-y-3 ${
          darkMode ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-100'
        }`}
        data-testid="deal-terms-assessment"
      >
        <p
          className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
            darkMode ? 'text-zinc-400' : 'text-gray-400'
          }`}
        >
          Structure Assessment
        </p>
        {assessmentRows.map((row) => (
          <AssessmentRow
            key={row.label}
            label={row.label}
            level={row.level}
            darkMode={darkMode}
          />
        ))}
      </div>

      {/* Missing terms callout */}
      {hasMissing && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border p-3 ${
            darkMode
              ? 'bg-amber-500/8 border-amber-500/25'
              : 'bg-amber-50 border-amber-200'
          }`}
          data-testid="deal-terms-missing"
        >
          <AlertTriangle
            className={`w-4 h-4 shrink-0 mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}
          />
          <div>
            <p
              className={`text-xs font-semibold mb-1 ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}
            >
              Undisclosed Terms
            </p>
            <ul className={`text-xs space-y-0.5 ${darkMode ? 'text-amber-400/80' : 'text-amber-700'}`}>
              {data.missing_terms.map((term) => (
                <li key={term} className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                  {term}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* View Details toggle */}
      <div>
        <button
          onClick={() => setShowDetails((v) => !v)}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
            darkMode
              ? 'border-white/15 text-zinc-400 hover:bg-white/5'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
          data-testid="deal-terms-details-toggle"
        >
          {showDetails ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showDetails ? 'Hide Details' : 'View Details'}
          {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {showDetails && (
          <div
            className={`mt-3 rounded-lg border p-3 ${
              darkMode ? 'border-white/8 bg-white/3' : 'border-gray-100 bg-gray-50'
            }`}
            data-testid="deal-terms-raw-table"
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                darkMode ? 'text-zinc-400' : 'text-gray-400'
              }`}
            >
              Raw Canonical Fields — Developer Inspector
            </p>
            <RawFieldTable canonicalSection={canonicalSection} darkMode={darkMode} />
          </div>
        )}
      </div>
    </>
  );

  // Embedded mode — ReportSection provides the outer card + heading
  if (embedded) {
    return (
      <div className="space-y-4" data-testid="deal-terms-card">
        {/* AI Governed badge + refresh */}
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-1.5 py-0.5 rounded border ${
              darkMode
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                : 'bg-indigo-50 border-indigo-200 text-indigo-700'
            }`}
          >
            AI Governed
          </span>
          <button
            onClick={refresh}
            title="Refresh deal terms analysis"
            className={`p-1 rounded transition-colors ${
              darkMode ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {readyBody}
      </div>
    );
  }

  // Standalone mode — renders full card with header
  return (
    <div
      className={`rounded-xl border ${
        darkMode ? 'bg-[#0f1117] border-white/10' : 'bg-white border-gray-200'
      }`}
      data-testid="deal-terms-card"
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-5 py-4 border-b ${darkMode ? 'border-white/8' : 'border-gray-100'}`}>
        <Sparkles className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
        <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Deal Terms
        </h3>
        <span
          className={`ml-auto text-xs px-1.5 py-0.5 rounded border ${
            darkMode
              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
              : 'bg-indigo-50 border-indigo-200 text-indigo-700'
          }`}
        >
          AI Governed
        </span>
        <button
          onClick={refresh}
          title="Refresh deal terms analysis"
          className={`ml-1 p-1 rounded transition-colors ${
            darkMode ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {readyBody}
      </div>
    </div>
  );
}
