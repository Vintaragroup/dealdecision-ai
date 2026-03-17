/**
 * InvestorInsightsQuickStatic — Design-lock static implementation of the Quick View.
 *
 * Uses hardcoded mock content only.
 * No API wiring. No adapter logic. No loading/error branching. No null-state substitutions.
 *
 * Layout (top → bottom):
 *   ExecutiveInsightSection   — p-8 rounded-xl border backdrop-blur-xl gradient card
 *   QuickInsightCards         — "Module Scores" h3 + grid-cols-3 compact InsightModuleCard grid
 *
 * Components this view uses:
 *   ExecutiveInsightSection, QuickInsightCards (→ InsightModuleCard variant="compact")
 *
 * Components this view does NOT use:
 *   VisualIntelligencePanel, InsightModules, InsightModuleCard variant="expanded", ExecutiveBrief, EvidencePanel
 */

import type { InvestorInsightsData } from '../../../types/investor-insights';
import { ExecutiveInsightSection } from './ExecutiveInsightSection';
import { QuickInsightCards } from './QuickInsightCards';

// ─── Component ────────────────────────────────────────────────────────────────

interface InvestorInsightsQuickStaticProps {
  darkMode: boolean;
  data: InvestorInsightsData;
}

export function InvestorInsightsQuickStatic({ darkMode, data }: InvestorInsightsQuickStaticProps) {
  return (
    <>
      {/* Executive Insight Section */}
      <ExecutiveInsightSection
        darkMode={darkMode}
        data={data.executive_summary}
        signals={data.deal_signals}
      />

      {/* Compact module score card grid */}
      <QuickInsightCards darkMode={darkMode} modules={data.analysis_modules} />
    </>
  );
}
