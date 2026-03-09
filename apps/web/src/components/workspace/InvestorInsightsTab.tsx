import { CheckCircle2, XCircle, Lightbulb, RefreshCw, AlertCircle, ChevronRight, Zap, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Stack } from '../ui/layout';
import { H3, MutedText } from '../ui/typography';
import { useInvestorInsightsStatusSummary } from '../../hooks/useInvestorInsightsStatusSummary';
import { useState, useRef, useEffect } from 'react';
import { apiGetInvestorInsights } from '../../lib/apiClient';
import type { InvestorInsightsSection, InvestorInsightsGateResult } from '../../lib/apiClient';
import { deriveInsightsDisplayState } from '../../lib/investorInsightsDisplayPolicy';
import { getConfidenceDisplayPolicy } from '../../lib/confidenceDisplayPolicy';
import {
  SlotRow, parseInsightSlotBody, slotLabel, displayValue,
  CanonicalFieldRow, parseCanonicalFieldsBody, fieldLabel,
  ConflictRow, parseConflictsBody,
  GovernedSummaryV1, parseGovernedSummaryBody,
  LlmInterpretationV1, LlmInterpretationPosture, LlmInterpretationConfidence, parseLlmInterpretationBody,
  ExternalDiligenceV1, parseExternalDiligenceBody, ExternalSignalSynthesisV1,
  DealRiskRadarV1, parseMonitoringBody, SignalConsensus,
  NarrativeContradictionBundle,
  DATA_SECTION_KEYS,
  REPORT_SUMMARY_KEYS,
} from './investorInsightsUtils';

// ── PR Refactor: new high-density decision surface components ─────────────────
import { ExecutivePulse } from './investor-insights/ExecutivePulse';
import { IntelligenceGrid } from './investor-insights/IntelligenceGrid';
import { SwotPanel } from './investor-insights/SwotPanel';
import { SynthesizedNarrative } from './investor-insights/SynthesizedNarrative';
import {
  SentimentFilterToggle,
  applyBucketSentimentFilter,
} from './investor-insights/SentimentFilterToggle';
import type { SentimentFilter } from './investor-insights/SentimentFilterToggle';
import { ExternalDiligenceSkeleton } from './investor-insights/ExternalDiligenceSkeleton';

interface InvestorInsightsTabProps {
  darkMode: boolean;
  dealId: string;
}

// ── Section renderers ────────────────────────────────────────────────────────

export function GateStateSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const items = (section.items ?? []) as InvestorInsightsGateResult[];
  const fallback = section.fallback ?? 'Gate data unavailable.';

  if (items.length === 0) {
    return (
      <EmptyFallback text={fallback} darkMode={darkMode} />
    );
  }

  return (
    <div className={`overflow-x-auto rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
            <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Gate</th>
            <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Status</th>
            <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={item.gate ?? idx}
              className={`border-b last:border-0 ${darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'}`}
            >
              <td className={`px-4 py-3 font-mono text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{item.gate}</td>
              <td className="px-4 py-3">
                {item.passed ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className={`text-xs font-medium ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Pass</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <span className={`text-xs font-medium ${darkMode ? 'text-red-300' : 'text-red-700'}`}>Fail</span>
                  </span>
                )}
              </td>
              <td className={`px-4 py-3 text-xs font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {item.reason_code ?? <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' && section.body.trim().length > 0
    ? section.body
    : null;
  const text = body ?? section.fallback ?? 'No information available.';

  return (
    <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{text}</p>
  );
}

export function EmptyFallback({ text, darkMode }: { text: string; darkMode: boolean }) {
  return (
    <p className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{text}</p>
  );
}

// ── Insight Slots ─────────────────────────────────────────────────────────────
// (SlotRow, parseInsightSlotBody, slotLabel, displayValue — moved to investorInsightsUtils.ts)

export function EvidencePill({ evidenceRef, darkMode }: { evidenceRef: string; darkMode: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    void navigator.clipboard.writeText(evidenceRef).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy evidence ref"
      className={`inline-block font-mono px-1.5 py-0.5 rounded text-xs transition-colors cursor-pointer select-text ${
        copied
          ? darkMode
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : darkMode
          ? 'bg-white/10 text-gray-300 hover:bg-white/20'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {copied ? 'Copied' : evidenceRef}
    </button>
  );
}

export function InsightSlotsSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseInsightSlotBody(body);

  if (rows.length === 0) {
    return <EmptyFallback text={section.fallback ?? 'No slot data available.'} darkMode={darkMode} />;
  }

  return (
    <div className={`overflow-x-auto rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
            {(['Slot', 'Status', 'Value', 'Evidence', 'Reason'] as const).map((col) => (
              <th
                key={col}
                className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isComputable = row.state === 'Computable';
            return (
              <tr
                key={row.slot ?? idx}
                className={`border-b last:border-0 ${
                  darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'
                }`}
              >
                {/* Slot */}
                <td className={`px-4 py-3 font-medium text-sm whitespace-nowrap ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {slotLabel(row.slot)}
                </td>
                {/* Status */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {isComputable ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                        darkMode
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      Computable
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                        darkMode
                          ? 'bg-white/5 border-white/15 text-gray-400'
                          : 'bg-gray-100 border-gray-200 text-gray-500'
                      }`}
                    >
                      NotComputable
                    </span>
                  )}
                </td>
                {/* Value */}
                <td className={`px-4 py-3 text-xs max-w-[180px] truncate ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {displayValue(row.value)}
                </td>
                {/* Evidence */}
                <td className="px-4 py-3 text-xs">
                  {row.evidence === 'none' ? (
                    <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>
                  ) : (
                    <EvidencePill evidenceRef={row.evidence} darkMode={darkMode} />
                  )}
                </td>
                {/* Reason */}
                <td className={`px-4 py-3 text-xs font-mono ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {row.reason === 'none' ? (
                    <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>—</span>
                  ) : (
                    row.reason
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

// ── Canonical Fields ─────────────────────────────────────────────────────────
// (CanonicalFieldRow, parseCanonicalFieldsBody, fieldLabel — moved to investorInsightsUtils.ts)

// ── Confidence badge chip (used in CanonicalFieldsSection) ─────────────────
const CONFIDENCE_BADGE_COLORS_DARK: Record<string, string> = {
  verified:    'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  strong:      'bg-teal-500/15 border-teal-500/30 text-teal-300',
  weak:        'bg-amber-500/15 border-amber-500/30 text-amber-300',
  conflict:    'bg-red-500/15 border-red-500/30 text-red-300',
  provisional: 'bg-white/5 border-white/15 text-gray-400',
  suppressed:  'bg-white/3 border-white/10 text-gray-600',
};
const CONFIDENCE_BADGE_COLORS_LIGHT: Record<string, string> = {
  verified:    'bg-emerald-50 border-emerald-200 text-emerald-700',
  strong:      'bg-teal-50 border-teal-200 text-teal-700',
  weak:        'bg-amber-50 border-amber-200 text-amber-700',
  conflict:    'bg-red-50 border-red-200 text-red-700',
  provisional: 'bg-gray-100 border-gray-200 text-gray-500',
  suppressed:  'bg-gray-50 border-gray-200 text-gray-400',
};

function ConfidenceBadgeChip({ confidence, darkMode }: { confidence?: string; darkMode: boolean }) {
  const policy = getConfidenceDisplayPolicy(confidence);
  if (!policy.badgeLabel) return null; // legacy/unknown — no badge
  const palette = darkMode ? CONFIDENCE_BADGE_COLORS_DARK : CONFIDENCE_BADGE_COLORS_LIGHT;
  const cls =
    palette[policy.badgeVariant] ??
    (darkMode ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-100 border-gray-200 text-gray-500');
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {policy.badgeLabel}
    </span>
  );
}

export function CanonicalFieldsSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseCanonicalFieldsBody(body);

  if (rows.length === 0) {
    return <EmptyFallback text={section.fallback ?? 'No canonical field data available.'} darkMode={darkMode} />;
  }

  return (
    <div className={`overflow-x-auto rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
            {(['Category', 'Field', 'Status', 'Value', 'Evidence', 'Reason', 'Confidence'] as const).map((col) => (
              <th
                key={col}
                className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isComputable = row.computability === 'Computable';
            return (
              <tr
                key={`${row.category}-${row.field}-${idx}`}
                className={`border-b last:border-0 ${
                  darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'
                }`}
              >
                {/* Category */}
                <td className={`px-4 py-3 text-xs font-medium whitespace-nowrap ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {fieldLabel(row.category)}
                </td>
                {/* Field */}
                <td className={`px-4 py-3 font-medium text-sm whitespace-nowrap ${
                  darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {fieldLabel(row.field)}
                </td>
                {/* Status */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {isComputable ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                        darkMode
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      Computable
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                        darkMode
                          ? 'bg-white/5 border-white/15 text-gray-400'
                          : 'bg-gray-100 border-gray-200 text-gray-500'
                      }`}
                    >
                      NotComputable
                    </span>
                  )}
                </td>
                {/* Value */}
                <td className={`px-4 py-3 text-xs max-w-[180px] truncate ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {row.value ?? <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>}
                </td>
                {/* Evidence */}
                <td className="px-4 py-3 text-xs">
                  {row.evidence ? (
                    <EvidencePill evidenceRef={row.evidence} darkMode={darkMode} />
                  ) : (
                    <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>
                  )}
                </td>
                {/* Reason */}
                <td className={`px-4 py-3 text-xs font-mono ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {row.reason ?? <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>—</span>}
                </td>
                {/* Confidence — PR36.7 */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <ConfidenceBadgeChip confidence={row.confidence} darkMode={darkMode} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Completeness Summary ───────────────────────────────────────────────────────

interface CompletenessRow {
  category: string;
  status: 'Present' | 'Missing' | 'Conflicting' | string;
}

function parseCompletenessBody(body: string): CompletenessRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): CompletenessRow[] => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return [];
      return [{ category: line.slice(0, colonIdx).trim(), status: line.slice(colonIdx + 1).trim() }];
    });
}

function CompletenessStatusBadge({ status, darkMode }: { status: string; darkMode: boolean }) {
  if (status === 'Present') {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        darkMode
          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
      }`}>
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        Present
      </span>
    );
  }
  if (status === 'Conflicting') {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        darkMode
          ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
          : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}>
        <AlertCircle className="w-3 h-3 shrink-0" />
        Conflicting
      </span>
    );
  }
  // Missing (default)
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
      darkMode
        ? 'bg-white/5 border-white/15 text-gray-400'
        : 'bg-gray-100 border-gray-200 text-gray-500'
    }`}>
      Missing
    </span>
  );
}

export function CompletenessSummarySection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseCompletenessBody(body);

  if (rows.length === 0) {
    return <EmptyFallback text={section.fallback ?? 'No completeness data available.'} darkMode={darkMode} />;
  }

  return (
    <div className={`overflow-x-auto rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
            <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>Category</th>
            <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.category ?? idx}
              className={`border-b last:border-0 ${
                darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'
              }`}
            >
              <td className={`px-4 py-3 font-medium text-sm whitespace-nowrap ${
                darkMode ? 'text-white' : 'text-gray-900'
              }`}>
                {fieldLabel(row.category)}
              </td>
              <td className="px-4 py-3">
                <CompletenessStatusBadge status={row.status} darkMode={darkMode} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Conflicts ─────────────────────────────────────────────────────────────────
// (ConflictRow, parseConflictsBody — moved to investorInsightsUtils.ts)

export function ConflictsSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseConflictsBody(body);

  return (
    <div className="space-y-3">
      <div
        className={`flex items-start gap-2.5 rounded-lg border px-4 py-2.5 ${
          darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'
        }`}
        role="alert"
      >
        <AlertCircle className={`w-4 h-4 mt-0.5 shrink-0 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
        <p className={`text-xs font-medium ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
          Conflicting values were detected across documents. Review evidence refs before relying on these fields.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyFallback text={section.fallback ?? 'No conflict detail available.'} darkMode={darkMode} />
      ) : (
        <div className={`overflow-x-auto rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                {(['Field', 'Value A', 'Evidence A', 'Value B', 'Evidence B'] as const).map((col) => (
                  <th key={col} className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap ${
                    darkMode ? 'text-gray-400' : 'text-gray-500'
                  }`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={`${row.field}-${idx}`}
                  className={`border-b last:border-0 ${
                    darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'
                  }`}
                >
                  <td className={`px-4 py-3 font-medium text-sm whitespace-nowrap ${
                    darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    {fieldLabel(row.field)}
                  </td>
                  <td className={`px-4 py-3 text-xs max-w-[140px] truncate ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {row.valueA || <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.evidenceA ? <EvidencePill evidenceRef={row.evidenceA} darkMode={darkMode} /> : <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>}
                  </td>
                  <td className={`px-4 py-3 text-xs max-w-[140px] truncate ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {row.valueB || <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.evidenceB ? <EvidencePill evidenceRef={row.evidenceB} darkMode={darkMode} /> : <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Normalization Diff ─────────────────────────────────────────────────────

interface NormDiffRow {
  pageIndex: number;
  ref: string;
  events: number;
  rules: string;
  rawPreview: string;
  normPreview: string;
}

function parseNormalizationDiffBody(body: string): NormDiffRow[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('page='))
    .flatMap((line): NormDiffRow[] => {
      const parts = line.split(' | ');
      const pick = (key: string) => {
        const p = parts.find((x) => x.startsWith(`${key}=`));
        return p ? p.slice(key.length + 1) : '';
      };
      const pageIdx = parseInt(pick('page'), 10);
      const ref = pick('ref');
      const events = parseInt(pick('events'), 10);
      const rules = pick('rules');
      const raw = pick('raw');
      const norm = pick('norm');
      if (isNaN(pageIdx) || !ref) return [];
      return [{ pageIndex: pageIdx, ref, events, rules, rawPreview: raw, normPreview: norm }];
    });
}

export function NormalizationDiffSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseNormalizationDiffBody(body);

  const headerLines = body.split('\n').slice(0, 3);
  const findStat = (prefix: string) => {
    const l = headerLines.find((x) => x.startsWith(prefix));
    return l ? l.slice(prefix.length) : '?';
  };
  const totalEvents = findStat('total_events: ');
  const affectedPages = findStat('affected_pages: ');

  if (rows.length === 0) {
    return <EmptyFallback text={section.fallback ?? 'No normalization diff data available.'} darkMode={darkMode} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs">
        <span className={`font-mono px-2 py-0.5 rounded ${darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
          total events: {totalEvents}
        </span>
        <span className={`font-mono px-2 py-0.5 rounded ${darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
          affected pages: {affectedPages}
        </span>
      </div>
      <div className={`overflow-x-auto rounded-lg border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
              <th className={`text-left px-3 py-2 font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Page</th>
              <th className={`text-left px-3 py-2 font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Ref</th>
              <th className={`text-left px-3 py-2 font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Events</th>
              <th className={`text-left px-3 py-2 font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Raw → Normalized</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className={`border-b last:border-0 ${darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'}`}>
                <td className={`px-3 py-2.5 font-mono font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{row.pageIndex}</td>
                <td className="px-3 py-2.5">
                  <EvidencePill evidenceRef={row.ref} darkMode={darkMode} />
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block font-mono px-1.5 py-0.5 rounded ${darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    {row.events}
                  </span>
                </td>
                <td className={`px-3 py-2.5 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <div className="space-y-1">
                    <div className={`font-mono text-xs ${darkMode ? 'text-red-300/80' : 'text-red-700/80'}`}>
                      <span className={`text-xs font-semibold mr-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>raw:</span>
                      {row.rawPreview || <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>(empty)</span>}
                    </div>
                    <div className={`font-mono text-xs ${darkMode ? 'text-emerald-300/80' : 'text-emerald-700/80'}`}>
                      <span className={`text-xs font-semibold mr-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>norm:</span>
                      {row.normPreview || <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>(empty)</span>}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Coverage Snapshot ──────────────────────────────────────────────────────

interface CoverageRow {
  key: string;
  value: string;
}

function parseCoverageBody(body: string): CoverageRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): CoverageRow[] => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return [];
      return [{ key: line.slice(0, colonIdx).trim(), value: line.slice(colonIdx + 1).trim() }];
    });
}

function metricLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CoverageSnapshotSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseCoverageBody(body);

  if (rows.length === 0) {
    return <EmptyFallback text={section.fallback ?? 'No coverage data available.'} darkMode={darkMode} />;
  }

  const errorRow = rows.find((r) => r.key === 'coverage_query_errors');
  const hasErrors = errorRow !== undefined && errorRow.value !== 'none';

  const dpuTotalRow = rows.find((r) => r.key === 'dpu_page_count');
  const dpuNonEmptyRow = rows.find((r) => r.key === 'dpu_nonempty_pages');
  const dpuTotal = dpuTotalRow ? parseInt(dpuTotalRow.value, 10) : 0;
  const dpuNonEmpty = dpuNonEmptyRow ? parseInt(dpuNonEmptyRow.value, 10) : 0;
  const showLowCoverageBanner = dpuTotal > 0 && dpuNonEmpty / dpuTotal < 0.6;

  return (
    <div className="space-y-3">
      {showLowCoverageBanner && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border px-4 py-2.5 ${
            darkMode
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-amber-50 border-amber-200'
          }`}
          role="alert"
          data-testid="low-coverage-banner"
        >
          <AlertCircle
            className={`w-4 h-4 mt-0.5 shrink-0 ${
              darkMode ? 'text-amber-400' : 'text-amber-600'
            }`}
          />
          <p className={`text-xs font-medium ${
            darkMode ? 'text-amber-300' : 'text-amber-800'
          }`}>
            Low text coverage detected ({dpuNonEmpty}/{dpuTotal} pages have text). Missing fields may
            result from limited OCR output — consider re-running document extraction.
          </p>
        </div>
      )}
      {hasErrors && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border px-4 py-2.5 ${
            darkMode
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-amber-50 border-amber-200'
          }`}
          role="alert"
        >
          <AlertCircle
            className={`w-4 h-4 mt-0.5 shrink-0 ${
              darkMode ? 'text-amber-400' : 'text-amber-600'
            }`}
          />
          <p className={`text-xs font-medium ${
            darkMode ? 'text-amber-300' : 'text-amber-800'
          }`}>
            Coverage query errors detected:{' '}
            <span className="font-mono">{errorRow!.value}</span>
          </p>
        </div>
      )}
      <div className={`overflow-x-auto rounded-lg border ${
        darkMode ? 'border-white/10' : 'border-gray-200'
      }`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`border-b ${
              darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
            }`}>
              <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>Metric</th>
              <th className={`text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.key ?? idx}
                className={`border-b last:border-0 ${
                  darkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50/50'
                }`}
              >
                <td className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap ${
                  darkMode ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {metricLabel(row.key)}
                </td>
                <td className={`px-4 py-2.5 text-xs font-mono ${
                  row.value === 'none' || row.value === 'false'
                    ? darkMode ? 'text-gray-500' : 'text-gray-400'
                    : row.value === 'true'
                    ? darkMode ? 'text-emerald-300' : 'text-emerald-700'
                    : darkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Governed Summary V1 ─────────────────────────────────────────────────────
// (GovernedSummaryV1, parseGovernedSummaryBody — moved to investorInsightsUtils.ts)

export function GovernedSummarySection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const data = parseGovernedSummaryBody(body);

  if (!data) {
    return <EmptyFallback text={section.fallback ?? 'Executive summary unavailable.'} darkMode={darkMode} />;
  }

  const colClass = `rounded-lg border p-4 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`;
  const headingClass = `text-xs font-semibold uppercase tracking-wide mb-2 ${
    darkMode ? 'text-blue-400' : 'text-blue-600'
  }`;
  const bulletClass = `text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;

  return (
    <div className="space-y-4">
      {/* Executive summary */}
      <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
        {data.executive_summary}
      </p>

      {/* Three-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Strengths */}
        <div className={colClass}>
          <div className={headingClass}>Strengths</div>
          <ul className="space-y-1">
            {data.strengths.map((s, i) => (
              <li key={i} className={bulletClass}>• {s}</li>
            ))}
            {data.strengths.length === 0 && (
              <li className={bulletClass + ' opacity-50'}>None identified</li>
            )}
          </ul>
        </div>

        {/* Risks */}
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-red-400' : 'text-red-600'}`}>Risks</div>
          <ul className="space-y-1">
            {data.risks.map((r, i) => (
              <li key={i} className={bulletClass}>• {r}</li>
            ))}
            {data.risks.length === 0 && (
              <li className={bulletClass + ' opacity-50'}>None identified</li>
            )}
          </ul>
        </div>

        {/* Open Questions */}
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>Open Questions</div>
          <ul className="space-y-1">
            {data.open_questions.map((q, i) => (
              <li key={i} className={bulletClass}>• {q}</li>
            ))}
            {data.open_questions.length === 0 && (
              <li className={bulletClass + ' opacity-50'}>None identified</li>
            )}
          </ul>
        </div>
      </div>

      {/* Validation badge */}
      {data.validated && (
        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          ✓ Numeric-parity validated — no hallucinated figures
        </p>
      )}
    </div>
  );
}

// ── LLM Interpretation V1 (PR34) ─────────────────────────────────────────────

const POSTURE_CONFIG: Record<
  LlmInterpretationPosture,
  { label: string; icon: string; bg: string; text: string; border: string; darkBg: string; darkText: string; darkBorder: string }
> = {
  GO: {
    label: 'GO',
    icon: '◆',
    bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200',
    darkBg: 'bg-emerald-500/15', darkText: 'text-emerald-300', darkBorder: 'border-emerald-500/30',
  },
  INVESTIGATE: {
    label: 'INVESTIGATE',
    icon: '◈',
    bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200',
    darkBg: 'bg-amber-500/15', darkText: 'text-amber-300', darkBorder: 'border-amber-500/30',
  },
  CAUTION: {
    label: 'CAUTION',
    icon: '⚑',
    bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200',
    darkBg: 'bg-orange-500/15', darkText: 'text-orange-300', darkBorder: 'border-orange-500/30',
  },
  PASS: {
    label: 'PASS',
    icon: '✕',
    bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200',
    darkBg: 'bg-red-500/10', darkText: 'text-red-300', darkBorder: 'border-red-500/25',
  },
};

export function PostureBadge({ posture, confidence, darkMode }: {
  posture: LlmInterpretationPosture;
  confidence: LlmInterpretationConfidence;
  darkMode: boolean;
}) {
  const cfg = POSTURE_CONFIG[posture] ?? POSTURE_CONFIG['INVESTIGATE'];
  const confidenceLabel = confidence === 'HIGH' ? 'High confidence'
    : confidence === 'MEDIUM' ? 'Medium confidence'
    : 'Low confidence';
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${
      darkMode
        ? `${cfg.darkBg} ${cfg.darkText} ${cfg.darkBorder}`
        : `${cfg.bg} ${cfg.text} ${cfg.border}`
    }`}>
      <span className="text-xs">{cfg.icon}</span>
      {cfg.label}
      <span className={`text-xs font-normal opacity-70`}>{confidenceLabel}</span>
    </span>
  );
}

/**
 * Guard for PR36 external intelligence fields — suppresses empty strings and
 * LLM placeholder phrases ("Not disclosed.") that should be treated as absent.
 */
function hasExtField(v: string | undefined): v is string {
  if (!v) return false;
  const trimmed = v.trim();
  if (!trimmed) return false;
  // LLM sometimes writes "Not disclosed." instead of empty string — treat as absent.
  if (trimmed === 'Not disclosed.' || trimmed === 'Not disclosed') return false;
  return true;
}

export function LlmInterpretationSection({
  section,
  darkMode,
  contradictions,
}: {
  section: InvestorInsightsSection;
  darkMode: boolean;
  /** PR36.9: optional contradiction bundle for mixed-evidence display states. */
  contradictions?: NarrativeContradictionBundle | null;
}) {
  const body = typeof section.body === 'string' ? section.body : '';
  const data: LlmInterpretationV1 | null = parseLlmInterpretationBody(body);

  if (!data) {
    return <EmptyFallback text={section.fallback ?? 'Investment interpretation unavailable.'} darkMode={darkMode} />;
  }

  const colClass = `rounded-lg border p-4 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`;
  const textClass = `text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;

  return (
    <div className="space-y-4">
      {/* ── Executive Pulse hero: posture gauge + vital signs ── */}
      <ExecutivePulse data={data} darkMode={darkMode} />

      {/* ── Synthesized narrative: executive + business quality + capital/raise ── */}
      <SynthesizedNarrative data={data} darkMode={darkMode} />

      {/* ── Intelligence Grid: 4-topic 2×2 signal cards (with contradiction callouts) ── */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-widest mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Intelligence Signals
        </div>
        <IntelligenceGrid data={data} darkMode={darkMode} contradictions={contradictions} />
      </div>

      {/* ── External context — only when PR36 web research signals are present ── */}
      {(hasExtField(data.external_market_context) || hasExtField(data.competitive_landscape)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {hasExtField(data.external_market_context) && (
            <div className={colClass}>
              <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                External Market Context
              </div>
              <p className={textClass}>{data.external_market_context}</p>
            </div>
          )}
          {hasExtField(data.competitive_landscape) && (
            <div className={colClass}>
              <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-lime-400' : 'text-lime-700'}`}>
                Competitive Landscape
              </div>
              <p className={textClass}>{data.competitive_landscape}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Claim Verification ── */}
      {hasExtField(data.claim_verification_summary) && (
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`}>
            Claim Verification
          </div>
          <p className={textClass}>{data.claim_verification_summary}</p>
        </div>
      )}

      {/* ── External Risk Signals ── */}
      {hasExtField(data.external_risk_signals) && (
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-rose-400' : 'text-rose-700'}`}>
            External Risk Signals
          </div>
          <p className={textClass}>{data.external_risk_signals}</p>
        </div>
      )}

      {/* ── SWOT: Strengths, Risks, Key Unknowns, Diligence Questions ── */}
      <SwotPanel data={data} darkMode={darkMode} contradictions={contradictions} />

      {/* Validation footnote */}
      {data.validated && (
        <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
          ✓ Numeric-parity validated — no hallucinated figures
        </p>
      )}
    </div>
  );
}

const PHASE2_KEYS = new Set([
  'insight_slots', 'coverage_snapshot', 'canonical_fields', 'completeness_summary',
  'conflicts', 'debug.normalization_diff', 'governed_summary_v1',
  'governed_executive_summary_v1',  // AI-governed sections require dedicated renderers
  'llm_interpretation_v1',          // PR34: LLM interpretation — dedicated renderer
  'external_diligence_v1',          // PR35: External diligence — dedicated renderer
  'deal_risk_radar_v1',             // PR37: Deal risk radar — dedicated renderer
]);

// DATA_SECTION_KEYS — moved to investorInsightsUtils.ts (imported above)

// ─── Governed Executive Summary V1 renderer (inline — cannot import from InvestorReportView due to circular dep) ────

interface GovernedExecSummaryV1 {
  schema_version: 'governed_executive_summary_v1';
  headline: string;
  one_liner?: string;
  summary_paragraphs?: string[];
  paragraphs?: string[]; // compat
  strengths: string[];
  risks: string[];
  open_questions: string[];
  coverage_note: string;
  validated: boolean;
}

function parseGovernedExecSummaryV1Body(body: string): GovernedExecSummaryV1 | null {
  const delimiter = '---governed_executive_summary_v1_json---\n';
  const idx = body.indexOf(delimiter);
  if (idx === -1) return null;
  try {
    const parsed = JSON.parse(body.slice(idx + delimiter.length).trim()) as GovernedExecSummaryV1;
    if (parsed?.schema_version !== 'governed_executive_summary_v1') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── PR36.3: External Signal Synthesis Panel ─────────────────────────────────

const SYNTHESIS_LABELS: Record<string, string> = {
  market_attractiveness:    'Market Attractiveness',
  competitive_pressure:     'Competitive Pressure',
  company_visibility:       'Company Visibility',
  founder_credibility:      'Founder Credibility',
  external_risk:            'External Risk',
  claim_validation_posture: 'Claim Validation',
};

const RATING_STYLES: Record<string, { pillLight: string; pillDark: string }> = {
  high:     { pillLight: 'bg-emerald-100 text-emerald-700', pillDark: 'bg-emerald-900/40 text-emerald-300' },
  moderate: { pillLight: 'bg-amber-100 text-amber-700',    pillDark: 'bg-amber-900/40 text-amber-300' },
  low:      { pillLight: 'bg-red-100 text-red-700',        pillDark: 'bg-red-900/40 text-red-300' },
  unknown:  { pillLight: 'bg-gray-100 text-gray-500',      pillDark: 'bg-gray-800 text-gray-400' },
  positive: { pillLight: 'bg-emerald-100 text-emerald-700', pillDark: 'bg-emerald-900/40 text-emerald-300' },
  neutral:  { pillLight: 'bg-gray-100 text-gray-500',       pillDark: 'bg-gray-800 text-gray-400' },
  negative: { pillLight: 'bg-red-100 text-red-700',         pillDark: 'bg-red-900/40 text-red-300' },
  mixed:    { pillLight: 'bg-amber-100 text-amber-700',     pillDark: 'bg-amber-900/40 text-amber-300' },
};

function ExternalSynthesisPanel({
  synthesis,
  darkMode,
}: {
  synthesis: ExternalSignalSynthesisV1;
  darkMode: boolean;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const items = [
    { key: 'market_attractiveness',    item: synthesis.market_attractiveness },
    { key: 'competitive_pressure',     item: synthesis.competitive_pressure },
    { key: 'company_visibility',       item: synthesis.company_visibility },
    { key: 'founder_credibility',      item: synthesis.founder_credibility },
    { key: 'external_risk',            item: synthesis.external_risk },
    { key: 'claim_validation_posture', item: synthesis.claim_validation_posture },
  ] as const;

  const cardClass = `rounded-lg border p-3 text-left transition-colors cursor-pointer ${
    darkMode
      ? 'border-white/10 bg-white/5 hover:bg-white/10'
      : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
  }`;

  const headerClass = `text-xs font-semibold uppercase tracking-wide mb-3 ${
    darkMode ? 'text-gray-300' : 'text-gray-700'
  }`;

  return (
    <div className={`rounded-xl border p-4 ${darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-white'}` }>
      <div className={headerClass}>External Intelligence Summary</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map(({ key, item }) => {
          const ratingStyle = RATING_STYLES[item.rating] ?? RATING_STYLES.unknown;
          const pillClass = `text-xs font-semibold px-2 py-0.5 rounded-full ${
            darkMode ? ratingStyle.pillDark : ratingStyle.pillLight
          }`;
          const isExpanded = expandedKey === key;
          const hasDrivers = item.drivers.length > 0;
          return (
            <button
              key={key}
              className={cardClass}
              onClick={() => hasDrivers && setExpandedKey(isExpanded ? null : key)}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {SYNTHESIS_LABELS[key]}
                </span>
                <span className={pillClass}>{item.rating}</span>
              </div>
              <p className={`text-sm leading-snug ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {item.summary}
              </p>
              {isExpanded && hasDrivers && (
                <ul className={`mt-2 space-y-0.5 border-t pt-2 ${
                  darkMode ? 'border-white/10' : 'border-gray-200'
                }`}>
                  {item.drivers.map((driver, i) => (
                    <li key={i} className={`text-xs flex gap-1 ${
                      darkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      <span className="mt-0.5 shrink-0">·</span>
                      <span>{driver}</span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── PR35: External Due Diligence Section ────────────────────────────────────

const BUCKET_LABELS: Record<string, string> = {
  company_footprint: 'Company Footprint',
  competitive_landscape: 'Competitive Landscape',
  market_outlook: 'Market Outlook',
  external_risks: 'External Risks',
  founder_team_signals: 'Founder / Team',
  financial_context: 'Financial Context',
};

const BUCKET_COLORS: Record<string, { dark: string; light: string }> = {
  company_footprint: { dark: 'text-blue-400', light: 'text-blue-700' },
  competitive_landscape: { dark: 'text-red-400', light: 'text-red-700' },
  market_outlook: { dark: 'text-teal-400', light: 'text-teal-700' },
  external_risks: { dark: 'text-amber-400', light: 'text-amber-700' },
  founder_team_signals: { dark: 'text-violet-400', light: 'text-violet-700' },
  financial_context: { dark: 'text-sky-400', light: 'text-sky-700' },
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 30);
  }
}

function RunStatusBadge({ status, darkMode }: { status: ExternalDiligenceV1['run_status']; darkMode: boolean }) {
  const styles: Record<string, string> = {
    succeeded: darkMode ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial:   darkMode ? 'bg-amber-900/40 text-amber-300 border-amber-700'   : 'bg-amber-50 text-amber-700 border-amber-200',
    failed:    darkMode ? 'bg-red-900/40 text-red-300 border-red-700'         : 'bg-red-50 text-red-700 border-red-200',
    skipped:   darkMode ? 'bg-gray-800 text-gray-400 border-gray-700'         : 'bg-gray-100 text-gray-500 border-gray-200',
  };
  const labels: Record<string, string> = {
    succeeded: 'Web research complete',
    partial: 'Partial results',
    failed: 'Web research failed',
    skipped: 'Web research disabled',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${styles[status] ?? styles.skipped}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {labels[status] ?? status}
    </span>
  );
}

export function ExternalDiligenceSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const data: ExternalDiligenceV1 | null = parseExternalDiligenceBody(body);
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');

  if (!data) {
    // Show skeleton when body is absent (still loading) vs empty fallback for parse failures.
    if (!body || body.trim() === '') {
      return <ExternalDiligenceSkeleton darkMode={darkMode} />;
    }
    return <EmptyFallback text={section.fallback ?? 'External due diligence data unavailable.'} darkMode={darkMode} />;
  }

  const colClass = `rounded-lg border p-4 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`;
  const metaClass = `text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`;
  const snippetClass = `text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const titleClass = `text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`;
  const domainClass = `text-xs font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`;

  // Buckets with results
  const activeBuckets = data.buckets.filter((b) => b.results.length > 0);
  // Apply sentiment filter
  const filteredBuckets = applyBucketSentimentFilter(activeBuckets, sentimentFilter);
  // Corroborations
  const corroborations = data.claim_corroborations ?? [];

  // Counts per filter choice for badge display
  const filterCounts: Partial<Record<SentimentFilter, number>> = {
    all: activeBuckets.length,
    positive: applyBucketSentimentFilter(activeBuckets, 'positive').length,
    risk: applyBucketSentimentFilter(activeBuckets, 'risk').length,
    mixed: applyBucketSentimentFilter(activeBuckets, 'mixed').length,
  };

  return (
    <div className="space-y-4">
      {/* PR36.3: Synthesis summary — cross-bucket investor conclusions */}
      {data.synthesis && (
        <ExternalSynthesisPanel synthesis={data.synthesis} darkMode={darkMode} />
      )}

      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <RunStatusBadge status={data.run_status} darkMode={darkMode} />
        {data.company_name_used && (
          <span className={metaClass}>
            <span className="font-medium">{data.company_name_used}</span>
            {data.sector_used && <> · {data.sector_used}</>}
          </span>
        )}
        <span className={metaClass}>
          {data.total_results_fetched} results · {data.queries_run} queries
          {data.tavily_credits_used != null && <> · {data.tavily_credits_used} credits</>}
        </span>
      </div>

      {/* Filter by Sentiment — only when there are multiple buckets to filter */}
      {activeBuckets.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Filter by Sentiment:
          </span>
          <SentimentFilterToggle
            value={sentimentFilter}
            onChange={setSentimentFilter}
            darkMode={darkMode}
            counts={filterCounts}
          />
        </div>
      )}

      {/* Buckets */}
      {filteredBuckets.length > 0 && (
        <div className="space-y-3">
          {filteredBuckets.map((bucket) => {
            const colorDef = BUCKET_COLORS[bucket.bucket] ?? BUCKET_COLORS.company_footprint;
            const labelColor = darkMode ? colorDef.dark : colorDef.light;
            return (
              <div key={bucket.bucket} className={colClass}>
                <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${labelColor}`}>
                  {BUCKET_LABELS[bucket.bucket] ?? bucket.bucket}
                </div>
                {/* PR36.2: signal summary — insight-first before raw evidence */}
                {bucket.signal?.summary && (
                  <p className={`text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {bucket.signal.summary}
                  </p>
                )}
                <div className="space-y-2">
                  {bucket.results.map((result, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className={titleClass}>{result.title}</span>
                        <span className={domainClass}>{extractDomain(result.url)}</span>
                      </div>
                      {result.published_date && (
                        <span className={metaClass}>{result.published_date}</span>
                      )}
                      <p className={snippetClass}>{result.snippet}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Claim corroborations */}
      {corroborations.length > 0 && (
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-orange-400' : 'text-orange-700'}`}>
            Claim Corroboration
          </div>
          <div className="space-y-2">
            {corroborations.map((c, i) => {
              const verdictStyle =
                c.verdict === 'corroborated'
                  ? darkMode ? 'text-emerald-400' : 'text-emerald-600'
                  : c.verdict === 'contradicted'
                  ? darkMode ? 'text-red-400' : 'text-red-600'
                  : darkMode ? 'text-gray-400' : 'text-gray-500';
              const verdictLabel =
                c.verdict === 'corroborated' ? '✓ corroborated'
                : c.verdict === 'contradicted' ? '✗ contradicted'
                : '? not confirmed';
              return (
                <div key={i}>
                  <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {c.claim_field} = &quot;{c.claim_value}&quot;
                  </span>
                  <span className={`ml-2 text-xs font-medium ${verdictStyle}`}>{verdictLabel}</span>
                  <p className={snippetClass + ' mt-0.5'}>{c.web_signal}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {activeBuckets.length === 0 && corroborations.length === 0 && (
        <EmptyFallback text="No external research results available." darkMode={darkMode} />
      )}
    </div>
  );
}

// ── Deal Risk Radar Section (PR37) ──────────────────────────────────────────

const IMPACT_BADGE: Record<string, { light: string; dark: string }> = {
  high:   { light: 'bg-red-100 text-red-700',     dark: 'bg-red-900/40 text-red-300' },
  medium: { light: 'bg-yellow-100 text-yellow-700', dark: 'bg-yellow-900/40 text-yellow-300' },
  low:    { light: 'bg-gray-100 text-gray-600',   dark: 'bg-white/10 text-gray-400' },
};

const DIRECTION_BADGE: Record<string, { light: string; dark: string }> = {
  positive: { light: 'bg-emerald-100 text-emerald-700', dark: 'bg-emerald-900/40 text-emerald-300' },
  negative: { light: 'bg-red-100 text-red-700',         dark: 'bg-red-900/40 text-red-300' },
  neutral:  { light: 'bg-gray-100 text-gray-500',       dark: 'bg-white/10 text-gray-400' },
};

const CONSENSUS_BADGE: Record<string, { light: string; dark: string }> = {
  bullish:           { light: 'bg-emerald-100 text-emerald-700', dark: 'bg-emerald-900/40 text-emerald-300' },
  bearish:           { light: 'bg-red-100 text-red-700',         dark: 'bg-red-900/40 text-red-300' },
  mixed:             { light: 'bg-yellow-100 text-yellow-700',   dark: 'bg-yellow-900/40 text-yellow-300' },
  neutral:           { light: 'bg-blue-100 text-blue-700',       dark: 'bg-blue-900/40 text-blue-300' },
  insufficient_data: { light: 'bg-gray-100 text-gray-500',       dark: 'bg-white/10 text-gray-400' },
};

const CATEGORY_LABEL: Record<string, string> = {
  legal: 'Legal', funding: 'Funding', product: 'Product', press: 'Press', other: 'Other',
};

function ImpactBadge({ impact, darkMode }: { impact: string; darkMode: boolean }) {
  const c = IMPACT_BADGE[impact] ?? IMPACT_BADGE.low;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold uppercase ${darkMode ? c.dark : c.light}`}>
      {impact}
    </span>
  );
}

function DirectionBadge({ direction, darkMode }: { direction: string; darkMode: boolean }) {
  const c = DIRECTION_BADGE[direction] ?? DIRECTION_BADGE.neutral;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold uppercase ${darkMode ? c.dark : c.light}`}>
      {direction}
    </span>
  );
}

function ConsensusBadge({ consensus, darkMode }: { consensus: SignalConsensus; darkMode: boolean }) {
  const c = CONSENSUS_BADGE[consensus] ?? CONSENSUS_BADGE.insufficient_data;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${darkMode ? c.dark : c.light}`}>
      {consensus.replace('_', ' ')}
    </span>
  );
}

export function DealRiskRadarSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const data: DealRiskRadarV1 | null = parseMonitoringBody(body);

  if (!data) {
    return <EmptyFallback text={section.fallback ?? 'Monitoring data not yet available.'} darkMode={darkMode} />;
  }

  const colClass = `rounded-lg border p-4 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`;
  const headingClass = (color: string) => `text-xs font-semibold uppercase tracking-wide mb-2 ${color}`;
  const metaClass = `text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`;
  const itemBodyClass = `text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const domainClass = `text-xs font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`;
  const ranAt = data.ran_at ? new Date(data.ran_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <RunStatusBadge status={data.run_status as ExternalDiligenceV1['run_status']} darkMode={darkMode} />
        {data.company_name_used && (
          <span className={metaClass}>
            <span className="font-medium">{data.company_name_used}</span>
            {data.sector_used && <> · {data.sector_used}</>}
          </span>
        )}
        <span className={metaClass}>
          {data.source_count} sources · {data.total_sources_fetched} fetched
        </span>
        {ranAt && <span className={metaClass}>Ran {ranAt}</span>}
        <ConsensusBadge consensus={data.signal_consensus} darkMode={darkMode} />
      </div>

      {/* Competitor events */}
      {data.competitor_events.length > 0 && (
        <div className={colClass}>
          <div className={headingClass(darkMode ? 'text-purple-400' : 'text-purple-700')}>Competitor Activity</div>
          <div className="space-y-3">
            {data.competitor_events.map((ev, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <ImpactBadge impact={ev.impact} darkMode={darkMode} />
                  <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{ev.company}</span>
                </div>
                <p className={itemBodyClass}>{ev.event}</p>
                {ev.evidence_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ev.evidence_urls.slice(0, 2).map((u, j) => (
                      <span key={j} className={domainClass}>{extractDomain(u)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company events */}
      {data.company_events.length > 0 && (
        <div className={colClass}>
          <div className={headingClass(darkMode ? 'text-blue-400' : 'text-blue-700')}>Company Signals</div>
          <div className="space-y-3">
            {data.company_events.map((ev, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <ImpactBadge impact={ev.impact} darkMode={darkMode} />
                  <span className={`text-xs px-1.5 py-0.5 rounded ${darkMode ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    {CATEGORY_LABEL[ev.category] ?? ev.category}
                  </span>
                </div>
                <p className={itemBodyClass}>{ev.event}</p>
                {ev.evidence_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ev.evidence_urls.slice(0, 2).map((u, j) => (
                      <span key={j} className={domainClass}>{extractDomain(u)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Market events */}
      {data.market_events.length > 0 && (
        <div className={colClass}>
          <div className={headingClass(darkMode ? 'text-teal-400' : 'text-teal-700')}>Market Signals</div>
          <div className="space-y-3">
            {data.market_events.map((ev, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <DirectionBadge direction={ev.direction} darkMode={darkMode} />
                  <span className={metaClass}>{ev.sector}</span>
                </div>
                <p className={itemBodyClass}>{ev.description}</p>
                {ev.evidence_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ev.evidence_urls.slice(0, 2).map((u, j) => (
                      <span key={j} className={domainClass}>{extractDomain(u)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Founder signals */}
      {data.founder_signals.length > 0 && (
        <div className={colClass}>
          <div className={headingClass(darkMode ? 'text-orange-400' : 'text-orange-700')}>Founder / Team</div>
          <div className="space-y-3">
            {data.founder_signals.map((fs, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <ImpactBadge impact={fs.impact} darkMode={darkMode} />
                  <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{fs.name}</span>
                </div>
                <p className={itemBodyClass}>{fs.signal}</p>
                {fs.evidence_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {fs.evidence_urls.slice(0, 2).map((u, j) => (
                      <span key={j} className={domainClass}>{extractDomain(u)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {data.competitor_events.length === 0 &&
        data.company_events.length === 0 &&
        data.market_events.length === 0 &&
        data.founder_signals.length === 0 && (
          <EmptyFallback text="No significant signals detected in this monitoring run." darkMode={darkMode} />
        )}
    </div>
  );
}

function GovernedExecSummaryV1Section({
  section, darkMode,
}: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const data = parseGovernedExecSummaryV1Body(body);
  if (!data) {
    return <EmptyFallback text={section.fallback ?? 'Executive summary unavailable.'} darkMode={darkMode} />;
  }
  const paras = data.summary_paragraphs ?? data.paragraphs ?? [];
  const colClass = `rounded-lg border p-4 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`;
  const headingClass = `text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`;
  const bulletClass = `text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`;
  return (
    <div className="space-y-4">
      <p className={`text-sm font-semibold leading-snug ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {data.headline}
      </p>
      {paras.map((p, i) => (
        <p key={i} className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{p}</p>
      ))}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={colClass}>
          <div className={headingClass}>Strengths</div>
          <ul className="space-y-1">
            {data.strengths.map((s, i) => <li key={i} className={bulletClass}>• {s}</li>)}
            {data.strengths.length === 0 && <li className={bulletClass + ' opacity-50'}>None identified</li>}
          </ul>
        </div>
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-red-400' : 'text-red-600'}`}>Risks</div>
          <ul className="space-y-1">
            {data.risks.map((r, i) => <li key={i} className={bulletClass}>• {r}</li>)}
            {data.risks.length === 0 && <li className={bulletClass + ' opacity-50'}>None identified</li>}
          </ul>
        </div>
        <div className={colClass}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>Open Questions</div>
          <ul className="space-y-1">
            {data.open_questions.map((q, i) => <li key={i} className={bulletClass}>• {q}</li>)}
            {data.open_questions.length === 0 && <li className={bulletClass + ' opacity-50'}>None identified</li>}
          </ul>
        </div>
      </div>
      {data.validated && (
        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          ✓ Numeric-parity validated — no hallucinated figures
        </p>
      )}
    </div>
  );
}

function SectionCard({
  section,
  darkMode,
  contradictions,
}: {
  section: InvestorInsightsSection;
  darkMode: boolean;
  /** PR36.9: optional contradiction bundle threaded from the report root. */
  contradictions?: NarrativeContradictionBundle | null;
}) {
  const isSpecialKey = PHASE2_KEYS.has(section.key);
  return (
    <div className={`rounded-xl border p-5 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-4">
        <ChevronRight className={`w-4 h-4 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <h4 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{section.title}</h4>
      </div>
      {/* Key-specific renderers take absolute priority over kind-based routing.        */}
      {/* This prevents a gate_state-kinded section from swallowing insight_slots body.  */}
      {section.key === 'insight_slots' && (
        <InsightSlotsSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'canonical_fields' && (
        <CanonicalFieldsSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'completeness_summary' && (
        <CompletenessSummarySection section={section} darkMode={darkMode} />
      )}
      {section.key === 'conflicts' && (
        <ConflictsSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'coverage_snapshot' && (
        <CoverageSnapshotSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'debug.normalization_diff' && (
        <NormalizationDiffSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'governed_summary_v1' && (
        <GovernedSummarySection section={section} darkMode={darkMode} />
      )}
      {section.key === 'governed_executive_summary_v1' && (
        <GovernedExecSummaryV1Section section={section} darkMode={darkMode} />
      )}
      {section.key === 'llm_interpretation_v1' && (
        <LlmInterpretationSection section={section} darkMode={darkMode} contradictions={contradictions} />
      )}
      {section.key === 'external_diligence_v1' && (
        <ExternalDiligenceSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'deal_risk_radar_v1' && (
        <DealRiskRadarSection section={section} darkMode={darkMode} />
      )}
      {/* Kind-based fallback only for sections whose key has no dedicated renderer. */}
      {!isSpecialKey && section.kind === 'gate_state' && (
        <GateStateSection section={section} darkMode={darkMode} />
      )}
      {!isSpecialKey && section.kind === 'message' && (
        <MessageSection section={section} darkMode={darkMode} />
      )}
      {!isSpecialKey && section.kind !== 'gate_state' && section.kind !== 'message' && (
        <EmptyFallback text={section.fallback ?? 'Section type not yet rendered.'} darkMode={darkMode} />
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function InvestorInsightsTab({ darkMode, dealId }: InvestorInsightsTabProps) {
  const { status, report, error, refresh, generate, isRunning, isStalled } =
    useInvestorInsightsStatusSummary(dealId);
  const [generateState, setGenerateState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Track mount status so the post-generate poll loop does not call setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reportStatus = report?.status ?? null;
  const isGeneratable =
    status === 'ready' &&
    (reportStatus === null ||
      reportStatus === 'not_started' ||
      reportStatus === 'failed' ||
      reportStatus === 'quarantined' ||
      reportStatus === 'deterministic_only' ||
      reportStatus === 'complete');

  // Gate results live at render_package.gate_state (top-level inside render_package).
  // The sections array's gate_state section intentionally has no items in real API responses.
  // We inject the results into the section so GateStateSection can render without knowing the
  // full report shape. Fall back gracefully when render_package.gate_state is absent (test mocks
  // that still populate section.items directly will continue to work unchanged).
  const gateResultsFromPkg = report?.render_package?.gate_state?.results ?? null;

  const sections: InvestorInsightsSection[] = (report?.render_package?.sections ?? []).map(
    (section) => {
      if (section.key === 'gate_state' && gateResultsFromPkg !== null) {
        // Prefer render_package.gate_state over whatever section.items says.
        return { ...section, items: gateResultsFromPkg };
      }
      return section;
    }
  );

  const hasSections = sections.length > 0;

  // Decision-surface sections only.
  // DATA_SECTION_KEYS  → routed to the Data tab (extracted fields, coverage, diagnostics).
  // REPORT_SUMMARY_KEYS → routed to the Report tab (long-form narrative summary blocks).
  // PR36.6A: governed_executive_summary_v1 and governed_summary_v1 are report-only sections
  //          and must NOT render here. The Investor Insights tab is a decision surface for
  //          investment posture, diligence signals, and risk analysis — not a report viewer.
  const decisionSurface = sections.filter(
    (s) => !DATA_SECTION_KEYS.has(s.key) && !REPORT_SUMMARY_KEYS.has(s.key)
  );

  // Placeholder shows only when there is genuinely nothing to render.
  const isNotStarted =
    status === 'ready' && (!report || reportStatus === 'not_started') && !hasSections;

  // Green "queued" banner: only while job is still in-flight.
  const showQueuedBanner =
    generateState === 'ok' &&
    (reportStatus === null ||
      reportStatus === 'not_started' ||
      reportStatus === 'queued' ||
      reportStatus === 'running');

  // Red failure banner: shown whenever the persisted report status is failed.
  const showGenerateFailedBanner = reportStatus === 'failed';

  // Blue "analysis/report running" banner: shown when background polling detected an
  // in-flight job that the user did NOT explicitly trigger from this session.
  const showBackgroundRunningBanner = isRunning && generateState !== 'ok' && generateState !== 'loading';

  // Amber stall banner: running but no activity for > 10 minutes.
  const showStalledBanner = isStalled;

  // Amber/blue evidence gate banner — mode driven by policy helper (PR32).
  // Prefer status_summary.evidence_gate (authoritative) over render_package.evidence_gate.
  const evidenceGateFromPkg = report?.render_package?.evidence_gate ?? null;
  const evidenceGateForPolicy =
    report?.status_summary?.evidence_gate ?? evidenceGateFromPkg ?? null;

  const displayState = deriveInsightsDisplayState({
    reportStatus: report?.status_summary?.report_status ?? reportStatus,
    evidenceGate: evidenceGateForPolicy,
    isRunning,
  });

  // Amber blocked banner: only when gate failed AND no rerun in flight.
  const showEvidenceGateBanner = displayState.evidenceGateBannerMode === 'blocked';
  // Blue auto-refresh banner: gate was failed but a job is now running.
  const showAutoRefreshingBanner = displayState.evidenceGateBannerMode === 'auto_refreshing';

  // Coverage metrics for the evidence gate banners — prefer render_package detail, fall back to status_summary.
  const gateCoveragePct =
    evidenceGateFromPkg?.metrics?.coverage_pct ??
    report?.status_summary?.evidence_gate?.coverage_pct ?? 0;
  const gateEvidenceCount =
    evidenceGateFromPkg?.metrics?.evidence_count ??
    report?.status_summary?.evidence_gate?.evidence_count ?? 0;

  const handleGenerate = async () => {
    // eslint-disable-next-line no-console
    console.log('[InvestorInsights] generate_click', dealId);
    setGenerateState('loading');
    setGenerateError(null);
    const capturedUpdatedAt = report?.updated_at;
    const capturedFingerprint = report?.render_package?.upstream_fingerprint as string | undefined;
    try {
      const freshReport = await generate();
      setGenerateState('ok');
      // Only skip polling when the IMMEDIATE refresh returned a NEW terminal report.
      // If updated_at is unchanged the worker hasn't finished yet — keep polling.
      const TERMINAL_STATUSES = new Set(['deterministic_only', 'complete', 'failed']);
      const reportIsNew = freshReport?.updated_at !== capturedUpdatedAt;
      if (freshReport && TERMINAL_STATUSES.has(freshReport.status) && reportIsNew) return;
      // Bounded poll: every 2s for up to 60s — stop when the report changes.
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLLS = 30;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise<void>((res) => setTimeout(res, POLL_INTERVAL_MS));
        if (!mountedRef.current) break;
        let latest = null;
        try { latest = await apiGetInvestorInsights(dealId); } catch { break; }
        if (!mountedRef.current) break;
        const updatedChanged = !!latest?.updated_at && latest.updated_at !== capturedUpdatedAt;
        const fpChanged = !!latest?.render_package?.upstream_fingerprint &&
          latest.render_package.upstream_fingerprint !== capturedFingerprint;
        const isTerminal = TERMINAL_STATUSES.has(latest?.status ?? '');
        const hasAuditFooter = !!(latest?.render_package as Record<string, unknown> | undefined)?.['audit_footer'];
        if (updatedChanged || fpChanged || (isTerminal && hasAuditFooter)) {
          await refresh();
          break;
        }
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
      setGenerateState('error');
    }
  };

  return (
    <Stack gap={6}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <H3 darkMode={darkMode} className="text-lg">
            Investor Insights
          </H3>
          <MutedText darkMode={darkMode} className="mt-0.5">
            AI decision surface — investment posture, diligence signals, and risk analysis.
          </MutedText>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={refresh}
            loading={status === 'loading'}
            disabled={status === 'loading' || generateState === 'loading'}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            variant={darkMode ? 'secondary' : 'outline'}
            icon={<Zap className="w-3.5 h-3.5" />}
            onClick={handleGenerate}
            loading={generateState === 'loading'}
            disabled={generateState === 'loading' || status === 'loading'}
          >
            {generateState === 'loading' ? 'Regenerating…' : 'Regenerate Report'}
          </Button>
        </div>
      </div>

      {/* Loading skeleton */}
      {status === 'loading' && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-16 rounded-xl animate-pulse ${darkMode ? 'bg-white/5' : 'bg-gray-100'}`}
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}`}>
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-red-200' : 'text-red-800'}`}>Failed to load insights</p>
            {error && <p className={`text-xs mt-0.5 ${darkMode ? 'text-red-300/80' : 'text-red-700/70'}`}>{error}</p>}
          </div>
        </div>
      )}

      {/* Background running banner — auto-polling detected an in-flight job.
           When auto-rerun is in flight the copy is more specific (PR32). */}
      {showBackgroundRunningBanner && !showAutoRefreshingBanner && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${darkMode ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}>
          <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
          <span className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>{displayState.backgroundRunningLabel}</span>
        </div>
      )}

      {/* Auto-refreshing banner — replaces both the generic running banner and the amber
           evidence-gate blocked banner when a rerun is in flight after OCR improvement (PR32). */}
      {showAutoRefreshingBanner && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-indigo-50 border-indigo-200'}`} data-testid="auto-refresh-banner">
          <Loader2 className={`w-4 h-4 shrink-0 animate-spin mt-0.5 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-indigo-200' : 'text-indigo-800'}`}>
              Auto-refreshing after OCR improvement
            </p>
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-indigo-300/80' : 'text-indigo-700/70'}`}>
              Coverage improved — re-evaluating evidence gate. The report will update automatically.
            </p>
          </div>
        </div>
      )}

      {/* Stall banner — running but no recent activity */}
      {showStalledBanner && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-amber-200' : 'text-amber-800'}`}>Analysis may be stalled</p>
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-amber-300/80' : 'text-amber-700/70'}`}>
              No activity detected for over 10 minutes. Try clicking Regenerate Report to restart.
            </p>
          </div>
        </div>
      )}

      {/* Generate feedback */}
      {showQueuedBanner && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className={`text-sm font-medium ${darkMode ? 'text-emerald-200' : 'text-emerald-800'}`}>Generation queued</span>
        </div>
      )}
      {showGenerateFailedBanner && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}`}>
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className={`text-sm font-medium ${darkMode ? 'text-red-200' : 'text-red-800'}`}>Generation failed (see gates below)</p>
        </div>
      )}
      {/* Blocked banner (amber) — gate failed + nothing running.  Copy reflects backend truth (PR32). */}
      {showEvidenceGateBanner && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`} data-testid="evidence-gate-blocked-banner">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-amber-200' : 'text-amber-800'}`}>
              Blocked by evidence gate — insufficient coverage
            </p>
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-amber-300/80' : 'text-amber-700/70'}`}>
              Coverage {Math.round(gateCoveragePct * 100)}%,{' '}
              Evidence {gateEvidenceCount} items.{' '}
              OCR backfill will run automatically to improve coverage.
            </p>
          </div>
        </div>
      )}
      {generateState === 'error' && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}`}>
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-red-200' : 'text-red-800'}`}>Generation failed</p>
            {generateError && <p className={`text-xs mt-0.5 ${darkMode ? 'text-red-300/80' : 'text-red-700/70'}`}>{generateError}</p>}
          </div>
        </div>
      )}

      {/* Not started placeholder */}
      {isNotStarted && (
        <div className={`text-center py-12 rounded-xl border-2 border-dashed ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'}`}>
          <Lightbulb className={`w-10 h-10 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
          <h4 className={`text-sm font-semibold mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Not generated yet</h4>
          <p className={`text-xs mb-4 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Insights are generated automatically after analysis completes.
          </p>
          {isGeneratable && generateState !== 'ok' && (
            <Button
              size="sm"
              variant="primary"
              icon={<Zap className="w-3.5 h-3.5" />}
              onClick={handleGenerate}
              loading={generateState === 'loading'}
              disabled={generateState === 'loading'}
            >
              Generate Investor Insights
            </Button>
          )}
        </div>
      )}

      {/* Report status badge + generate action for retriable states */}
      {status === 'ready' && report && report.status !== 'not_started' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            report.status === 'deterministic_only' || report.status === 'complete' || report.status === 'succeeded'
              ? (darkMode ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
              : report.status === 'failed'
              ? (darkMode ? 'bg-red-500/15 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700')
              : isRunning
              ? (darkMode ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-700')
              : (darkMode ? 'bg-white/10 border-white/20 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700')
          }`}>
            {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
            {displayState.reportStatusLabel}
          </span>
          {report.engine_version && (
            <span className={`text-xs font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              engine {report.engine_version}
            </span>
          )}
          {report.updated_at && (
            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              · {new Date(report.updated_at).toLocaleString()}
            </span>
          )}
          {isGeneratable && generateState !== 'ok' && (
            <Button
              size="sm"
              variant={darkMode ? 'secondary' : 'outline'}
              icon={<Zap className="w-3.5 h-3.5" />}
              onClick={handleGenerate}
              loading={generateState === 'loading'}
              disabled={generateState === 'loading'}
            >
              Regenerate
            </Button>
          )}
        </div>
      )}

      {/* Sections — decision-surface only (data/diagnostic sections are in the Data tab) */}
      {status === 'ready' && decisionSurface.length > 0 && (
        <Stack gap={4}>
          {decisionSurface.map((section) => (
            <SectionCard
              key={section.key}
              section={section}
              darkMode={darkMode}
              contradictions={report?.narrative_contradiction_bundle ?? null}
            />
          ))}
        </Stack>
      )}

      {/* Report has content, but all sections are data-only — point user to Data tab */}
      {status === 'ready' && report && report.status !== 'not_started' && decisionSurface.length === 0 && hasSections && (
        <div className={`rounded-xl border px-4 py-3 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Extracted fields, conflicts, and coverage data are available in the{' '}
            <strong>Data tab</strong>.
          </p>
        </div>
      )}

      {/* Report present but no sections at all */}
      {status === 'ready' && report && report.status !== 'not_started' && sections.length === 0 && (
        <div className={`rounded-xl border px-4 py-3 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            No sections available for this report.
          </p>
        </div>
      )}
    </Stack>
  );
}
