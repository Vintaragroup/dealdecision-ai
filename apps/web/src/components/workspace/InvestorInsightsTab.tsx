import { CheckCircle2, XCircle, Lightbulb, RefreshCw, AlertCircle, ChevronRight, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { useInvestorInsights } from '../../hooks/useInvestorInsights';
import { useState } from 'react';
import type { InvestorInsightsSection, InvestorInsightsGateResult } from '../../lib/apiClient';

interface InvestorInsightsTabProps {
  darkMode: boolean;
  dealId: string;
}

// ── Section renderers ────────────────────────────────────────────────────────

function GateStateSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
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

function EmptyFallback({ text, darkMode }: { text: string; darkMode: boolean }) {
  return (
    <p className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{text}</p>
  );
}

// ── Insight Slots ─────────────────────────────────────────────────────────────

interface SlotRow {
  slot: string;
  state: 'Computable' | 'NotComputable' | string;
  value: string;
  evidence: string;
  reason: string;
}

function parseInsightSlotBody(body: string): SlotRow[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): SlotRow[] => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return [];
      const slot = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      const parts = rest.split('|').map((p) => p.trim());
      const state = (parts[0] ?? '').trim();
      const pick = (key: string) => {
        const part = parts.find((p) => p.startsWith(`${key}=`));
        return part ? part.slice(key.length + 1).trim() : 'none';
      };
      return [{ slot, state, value: pick('value'), evidence: pick('evidence'), reason: pick('reason') }];
    });
}

function slotLabel(raw: string): string {
  // "raise_terms" → "Raise Terms"
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(raw: string): string {
  if (raw === 'none') return '—';
  // Strip surrounding quotes if present
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) return raw.slice(1, -1);
  return raw;
}

function EvidencePill({ evidenceRef, darkMode }: { evidenceRef: string; darkMode: boolean }) {
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

function CoverageSnapshotSection({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const body = typeof section.body === 'string' ? section.body : '';
  const rows = parseCoverageBody(body);

  if (rows.length === 0) {
    return <EmptyFallback text={section.fallback ?? 'No coverage data available.'} darkMode={darkMode} />;
  }

  const errorRow = rows.find((r) => r.key === 'coverage_query_errors');
  const hasErrors = errorRow !== undefined && errorRow.value !== 'none';

  return (
    <div className="space-y-3">
      {hasErrors && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 ${
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

function SectionCard({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  const isSpecialKey = section.key === 'insight_slots' || section.key === 'coverage_snapshot';
  return (
    <div className={`rounded-xl border p-5 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-4">
        <ChevronRight className={`w-4 h-4 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <h4 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{section.title}</h4>
      </div>
      {section.kind === 'gate_state' && (
        <GateStateSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'insight_slots' && section.kind !== 'gate_state' && (
        <InsightSlotsSection section={section} darkMode={darkMode} />
      )}
      {section.key === 'coverage_snapshot' && section.kind !== 'gate_state' && (
        <CoverageSnapshotSection section={section} darkMode={darkMode} />
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
  const { status, report, error, refresh, generate } = useInvestorInsights(dealId);
  const [generateState, setGenerateState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);

  const reportStatus = report?.status ?? null;
  const isGeneratable =
    status === 'ready' &&
    (reportStatus === null ||
      reportStatus === 'not_started' ||
      reportStatus === 'failed' ||
      reportStatus === 'quarantined');

  const sections: InvestorInsightsSection[] =
    ((report?.render_package?.sections ??
      (report as Record<string, unknown> | null | undefined)?.["sections"]) as
      | InvestorInsightsSection[]
      | undefined) ?? [];

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

  const handleGenerate = async () => {
    console.log("generate_click", dealId);
    setGenerateState('loading');
    setGenerateError(null);
    try {
      await generate();
      setGenerateState('ok');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
      setGenerateState('error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Investor Insights
          </h3>
          <p className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Stage 0 deterministic analysis — gates, signals, and coverage summary.
          </p>
        </div>
        <Button
          size="sm"
          variant={darkMode ? 'secondary' : 'outline'}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          onClick={refresh}
          loading={status === 'loading'}
          disabled={status === 'loading'}
        >
          Refresh
        </Button>
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
        <div className={`text-center py-14 rounded-xl border-2 border-dashed ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'}`}>
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
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
            report.status === 'deterministic_only' || report.status === 'complete'
              ? (darkMode ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
              : report.status === 'failed'
              ? (darkMode ? 'bg-red-500/15 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700')
              : (darkMode ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-700')
          }`}>
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
        <div className="space-y-4">
          {sections.map((section) => (
            <SectionCard key={section.key} section={section} darkMode={darkMode} />
          ))}
        </div>
      )}

      {/* Report present but no sections */}
      {status === 'ready' && report && report.status !== 'not_started' && sections.length === 0 && (
        <div className={`rounded-xl border px-4 py-3 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            No sections available for this report.
          </p>
        </div>
      )}
    </div>
  );
}
