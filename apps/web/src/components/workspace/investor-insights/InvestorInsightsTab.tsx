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

import { useState } from 'react';
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
  const { status, report, error, refresh } = useInvestorInsights(dealId);

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

  // Adapt the report. report is non-null here (guarded above), but TypeScript needs narrowing.
  const data = report ? adaptReportToInsightsData(report, dealName) : null;
  if (!data) {
    return <InvestorInsightsTabLoading darkMode={darkMode} viewMode={viewMode} />;
  }

  return (
    <div className="space-y-4">
      <ViewModeToggle darkMode={darkMode} value={viewMode} onChange={setViewMode} />

      {viewMode === 'quick' && <InvestorInsightsQuickStatic darkMode={darkMode} data={data} />}
      {viewMode === 'detailed' && <InvestorInsightsDetailedStatic darkMode={darkMode} data={data} />}
      {viewMode === 'executive' && <InvestorInsightsExecutiveStatic darkMode={darkMode} data={data} />}
    </div>
  );
}
