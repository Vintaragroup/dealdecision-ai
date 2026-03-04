import { CheckCircle2, XCircle, Lightbulb, RefreshCw, AlertCircle, ChevronRight, Zap, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Stack } from '../ui/layout';
import { H3, MutedText } from '../ui/typography';
import { useInvestorInsightsStatusSummary } from '../../hooks/useInvestorInsightsStatusSummary';
import { useState, useRef, useEffect } from 'react';
import { apiGetInvestorInsights } from '../../lib/apiClient';
import type { InvestorInsightsSection, InvestorInsightsGateResult } from '../../lib/apiClient';

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

export interface SlotRow {
  slot: string;
  state: 'Computable' | 'NotComputable' | string;
  value: string;
  evidence: string;
  reason: string;
}

export function parseInsightSlotBody(body: string): SlotRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): SlotRow[] => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return [];
      const slot = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      // Split on " | " (with spaces) to avoid false splits inside a quoted value like
      // value="Retention ratio / 60.00%". The worker sanitizes | → / in values,
      // but we parse defensively here anyway.
      const parts = rest.split(/ \| /).map((p) => p.trim());
      const state = (parts[0] ?? '').trim();
      const pick = (key: string) => {
        const part = parts.find((p) => p.startsWith(`${key}=`));
        if (!part) return 'none';
        const raw = part.slice(key.length + 1).trim();
        // Strip surrounding double-quotes if present (value="...").
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1);
        return raw;
      };
      return [{ slot, state, value: pick('value'), evidence: pick('evidence'), reason: pick('reason') }];
    });
}

export function slotLabel(raw: string): string {
  // "raise_terms" → "Raise Terms"
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function displayValue(raw: string): string {
  if (raw === 'none') return '—';
  // Strip surrounding quotes if present
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1);
  return raw;
}

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

function InsightSlotsSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
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

export interface CanonicalFieldRow {
  category: string;
  field: string;
  computability: 'Computable' | 'NotComputable' | string;
  value: string | null;
  evidence: string | null;
  reason: string | null;
}

export function parseCanonicalFieldsBody(body: string): CanonicalFieldRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): CanonicalFieldRow[] => {
      const tokens = line.split(' | ');
      const pick = (key: string): string => {
        const token = tokens.find((t) => t.startsWith(`${key}=`));
        if (!token) return 'none';
        return token.slice(key.length + 1).trim();
      };
      const category = pick('category');
      const field = pick('field');
      if (!category || category === 'none' || !field || field === 'none') return [];
      const computability = pick('computability');
      const rawValue = pick('value');
      const rawEvidence = pick('evidence');
      const rawReason = pick('reason');

      const parseNullable = (raw: string): string | null => {
        if (raw === 'none' || raw === '') return null;
        // Strip surrounding quotes, then trim trailing whitespace
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) {
          return raw.slice(1, -1).trimEnd();
        }
        return raw.trimEnd();
      };

      return [{
        category,
        field,
        computability,
        value: parseNullable(rawValue),
        evidence: parseNullable(rawEvidence),
        reason: parseNullable(rawReason),
      }];
    });
}

export function fieldLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
            {(['Category', 'Field', 'Status', 'Value', 'Evidence', 'Reason'] as const).map((col) => (
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

function CompletenessSummarySection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
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

export interface ConflictRow {
  field: string;
  valueA: string;
  evidenceA: string;
  valueB: string;
  evidenceB: string;
}

export function parseConflictsBody(body: string): ConflictRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): ConflictRow[] => {
      const tokens = line.split(' | ');
      const pick = (key: string): string => {
        const token = tokens.find((t) => t.startsWith(`${key}=`));
        if (!token) return '';
        const raw = token.slice(key.length + 1).trim();
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1).trimEnd();
        return raw.trimEnd();
      };
      const field = pick('field');
      if (!field) return [];
      return [{ field, valueA: pick('value_a'), evidenceA: pick('evidence_a'), valueB: pick('value_b'), evidenceB: pick('evidence_b') }];
    });
}

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

function NormalizationDiffSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
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

export interface GovernedSummaryV1 {
  schema_version: 'governed_summary_v1';
  executive_summary: string;
  strengths: string[];
  risks: string[];
  open_questions: string[];
  validated: boolean;
}

export function parseGovernedSummaryBody(body: string): GovernedSummaryV1 | null {
  const delimiter = '---governed_summary_v1_json---\n';
  const idx = body.indexOf(delimiter);
  if (idx === -1) return null;
  try {
    const json = body.slice(idx + delimiter.length).trim();
    const parsed = JSON.parse(json) as GovernedSummaryV1;
    if (parsed?.schema_version !== 'governed_summary_v1') return null;
    return parsed;
  } catch {
    return null;
  }
}

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

const PHASE2_KEYS = new Set([
  'insight_slots', 'coverage_snapshot', 'canonical_fields', 'completeness_summary',
  'conflicts', 'debug.normalization_diff', 'governed_summary_v1',
  'governed_executive_summary_v1',  // AI-governed sections require dedicated renderers
]);

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

function SectionCard({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
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

  // Amber evidence gate banner: shown when deterministic_only AND evidence gate explicitly failed.
  const evidenceGateFromPkg = report?.render_package?.evidence_gate ?? null;
  const showEvidenceGateBanner =
    reportStatus === 'deterministic_only' &&
    evidenceGateFromPkg !== null &&
    evidenceGateFromPkg.passed === false;

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
            Stage 0 deterministic analysis — gates, signals, and coverage summary.
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

      {/* Background running banner — auto-polling detected an in-flight job */}
      {showBackgroundRunningBanner && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${darkMode ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}>
          <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
          <span className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>Analysis running — checking for updates…</span>
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
      {showEvidenceGateBanner && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${darkMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className={`text-sm font-medium ${darkMode ? 'text-amber-200' : 'text-amber-800'}`}>
              Full interpretation paused — insufficient evidence
            </p>
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-amber-300/80' : 'text-amber-700/70'}`}>
              Coverage {Math.round((evidenceGateFromPkg?.metrics?.coverage_pct ?? 0) * 100)}%,{' '}
              Evidence {evidenceGateFromPkg?.metrics?.evidence_count ?? 0} items.{' '}
              Re-run document extraction to improve coverage.
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
            report.status === 'deterministic_only' || report.status === 'complete'
              ? (darkMode ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
              : report.status === 'failed'
              ? (darkMode ? 'bg-red-500/15 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700')
              : isRunning
              ? (darkMode ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-700')
              : (darkMode ? 'bg-white/10 border-white/20 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700')
          }`}>
            {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
            {report.status}
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

      {/* Sections */}
      {status === 'ready' && sections.length > 0 && (
        <Stack gap={4}>
          {sections.map((section) => (
            <SectionCard key={section.key} section={section} darkMode={darkMode} />
          ))}
        </Stack>
      )}

      {/* Report present but no sections */}
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
