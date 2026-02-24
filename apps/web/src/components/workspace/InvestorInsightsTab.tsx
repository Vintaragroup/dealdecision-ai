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

function SectionCard({ section, darkMode }: { section: InvestorInsightsSection; darkMode: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-4">
        <ChevronRight className={`w-4 h-4 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <h4 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{section.title}</h4>
      </div>
      {section.kind === 'gate_state' && (
        <GateStateSection section={section} darkMode={darkMode} />
      )}
      {section.kind === 'message' && (
        <MessageSection section={section} darkMode={darkMode} />
      )}
      {section.kind !== 'gate_state' && section.kind !== 'message' && (
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

  const isNotStarted = status === 'ready' && (!report || reportStatus === 'not_started');

  const handleGenerate = async () => {
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

  const sections: InvestorInsightsSection[] =
    (report?.render_package?.sections as InvestorInsightsSection[] | undefined) ?? [];

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
      {generateState === 'ok' && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${darkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className={`text-sm font-medium ${darkMode ? 'text-emerald-200' : 'text-emerald-800'}`}>Generation queued</span>
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
