/**
 * Investor Insights Tab — design-lock static implementation.
 *
 * Owns the shared ViewModeToggle and delegates each view to its own
 * static component. Quick View and Detailed View are structurally
 * separate — they do not share rendering logic.
 *
 * API wiring, adapter logic, and full state machine will be layered in
 * after all views are design-locked and approved.
 */

import { useState, useEffect, useRef } from 'react';
import type { ViewMode } from '../../../types/investor-insights';
import { adaptReportToInsightsData } from '../../../types/investor-insights';
import { useInvestorInsights } from '../../../hooks/useInvestorInsights';
import { ViewModeToggle } from './ViewModeToggle';
import { InvestorInsightsQuickStatic } from './InvestorInsightsQuickStatic';
import { InvestorInsightsDetailedStatic } from './InvestorInsightsDetailedStatic';
import { InvestorInsightsExecutiveStatic } from './InvestorInsightsExecutiveStatic';
import { InvestorInsightsTabLoading } from './InvestorInsightsLoading';
import { InvestorInsightsError } from './InvestorInsightsError';

export interface InvestorInsightsTabProps {
  dealId: string;
  darkMode: boolean;
  dealName?: string;
}

export function InvestorInsightsTab({ dealId, darkMode, dealName }: InvestorInsightsTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('quick');
  const [isGenerating, setIsGenerating] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Records report.updated_at (or click timestamp) at the moment generate is clicked.
  // The stop-polling effect only clears isGenerating when the report is newer than this,
  // preventing Refresh Insights from immediately stopping before new sections arrive.
  const generationStartedAtRef = useRef<string | null>(null);
  const { status, report, error, refresh, generate } = useInvestorInsights(dealId);

  // Poll every 3 seconds after generate() is called until sections arrive.
  useEffect(() => {
    if (!isGenerating) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      return;
    }
    pollingRef.current = setInterval(() => { void refresh(); }, 3000);
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [isGenerating, refresh]);

  // Clear generating state once the report has been updated *after* generation started.
  // Comparing updated_at against generationStartedAtRef prevents Refresh Insights from
  // immediately stopping because the pre-existing sections already satisfy the length check.
  useEffect(() => {
    if (!isGenerating || !report?.render_package?.sections?.length) return;
    const reportTs = report?.updated_at;
    const startTs = generationStartedAtRef.current;
    // Clear when: no start timestamp recorded (Generate Insights from scratch), or the
    // report has been updated after the generation click (Refresh Insights flow).
    if (!startTs || !reportTs || reportTs > startTs) {
      setIsGenerating(false);
    }
  }, [report, isGenerating]);

  // Show full-screen loading on first load (no prior data available).
  if ((status === 'idle' || status === 'loading') && report === null) {
    return <InvestorInsightsTabLoading darkMode={darkMode} viewMode={viewMode} />;
  }

  // Show full-screen error only when no prior data is available.
  if (status === 'error' && report === null) {
    return (
      <InvestorInsightsError
        darkMode={darkMode}
        error={error ? new Error(error) : null}
        onRetry={refresh}
      />
    );
  }

  // Derive report and analysis status from the status_summary when available.
  const reportStatus = report?.status_summary?.report_status ?? report?.status;
  const analysisStatus = report?.status_summary?.analysis_status;

  // Analysis is currently running — show loading skeleton rather than empty data.
  if (analysisStatus === 'running' || reportStatus === 'running') {
    return <InvestorInsightsTabLoading darkMode={darkMode} viewMode={viewMode} />;
  }

  // No report has been generated yet — show empty state with generate action.
  if (reportStatus === 'not_started' || !report?.render_package?.sections?.length) {
    return (
      <div className="space-y-4">
        <ViewModeToggle darkMode={darkMode} value={viewMode} onChange={setViewMode} />
        <div
          className={`p-10 rounded-xl border flex flex-col items-center gap-4 text-center ${
            darkMode
              ? 'bg-white/5 border-white/10 text-gray-400'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}
        >
          <p className="text-sm">No investor insights have been generated yet for this deal.</p>
          <button
            disabled={isGenerating}
            onClick={() => {
              if (!isGenerating) {
                generationStartedAtRef.current = report?.updated_at ?? new Date().toISOString();
                setIsGenerating(true);
                void generate().catch(() => setIsGenerating(false));
              }
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isGenerating
                ? 'opacity-50 cursor-not-allowed bg-[#6366f1] text-white'
                : 'bg-[#6366f1] hover:bg-[#5254cc] text-white'
            }`}
          >
            {isGenerating ? 'Generating...' : 'Generate Insights'}
          </button>
        </div>
      </div>
    );
  }

  // Adapt the report. report is non-null here (guarded above), but TypeScript needs narrowing.
  const data = report ? adaptReportToInsightsData(report, dealName) : null;
  if (!data) {
    return <InvestorInsightsTabLoading darkMode={darkMode} viewMode={viewMode} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ViewModeToggle darkMode={darkMode} value={viewMode} onChange={setViewMode} />
        <button
          disabled={isGenerating}
          onClick={() => {
            if (!isGenerating) {
              generationStartedAtRef.current = report?.updated_at ?? new Date().toISOString();
              setIsGenerating(true);
              void generate().catch(() => setIsGenerating(false));
            }
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isGenerating
              ? 'opacity-50 cursor-not-allowed bg-[#6366f1] text-white'
              : 'bg-[#6366f1] hover:bg-[#5254cc] text-white'
          }`}
        >
          {isGenerating ? 'Generating...' : 'Refresh Insights'}
        </button>
      </div>

      {viewMode === 'quick' && <InvestorInsightsQuickStatic darkMode={darkMode} data={data} />}
      {viewMode === 'detailed' && <InvestorInsightsDetailedStatic darkMode={darkMode} data={data} />}
      {viewMode === 'executive' && <InvestorInsightsExecutiveStatic darkMode={darkMode} data={data} />}
    </div>
  );
}
