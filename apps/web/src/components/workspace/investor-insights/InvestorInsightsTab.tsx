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
import { ViewModeToggle } from './ViewModeToggle';
import { InvestorInsightsQuickStatic } from './InvestorInsightsQuickStatic';
import { InvestorInsightsDetailedStatic } from './InvestorInsightsDetailedStatic';
import { InvestorInsightsExecutiveStatic } from './InvestorInsightsExecutiveStatic';

export interface InvestorInsightsTabProps {
  dealId: string;
  darkMode: boolean;
  dealName?: string;
}

export function InvestorInsightsTab({ darkMode }: InvestorInsightsTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('quick');

  return (
    <div className="space-y-4">
      <ViewModeToggle darkMode={darkMode} value={viewMode} onChange={setViewMode} />

      {viewMode === 'quick' && <InvestorInsightsQuickStatic darkMode={darkMode} />}
      {viewMode === 'detailed' && <InvestorInsightsDetailedStatic darkMode={darkMode} />}
      {viewMode === 'executive' && <InvestorInsightsExecutiveStatic darkMode={darkMode} />}
    </div>
  );
}
