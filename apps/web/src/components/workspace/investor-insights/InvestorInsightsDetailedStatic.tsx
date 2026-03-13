/**
 * InvestorInsightsDetailedStatic — Design-lock static implementation of the Detailed View.
 *
 * Uses hardcoded mock content only.
 * No API wiring. No adapter logic. No loading/error branching. No null-state substitutions.
 *
 * Layout (top → bottom):
 *   ViewModeToggle
 *   ExecutiveInsightSection
 *   VisualIntelligencePanel
 *   InsightModuleCard × 7  (Fragment, no wrapper)
 */

import type { ModuleId, InvestorInsightsData } from '../../../types/investor-insights';
import { MODULE_ORDER } from '../../../types/investor-insights';
import { ExecutiveInsightSection } from './ExecutiveInsightSection';
import { VisualIntelligencePanel } from './VisualIntelligencePanel';
import { InsightModuleCard } from './InsightModuleCard';

// ─── Component ────────────────────────────────────────────────────────────────

interface InvestorInsightsDetailedStaticProps {
  darkMode: boolean;
  data: InvestorInsightsData;
}

export function InvestorInsightsDetailedStatic({ darkMode, data }: InvestorInsightsDetailedStaticProps) {
  const liveModules = MODULE_ORDER
    .filter((id) => data.analysis_modules[id] !== undefined)
    .map((id) => ({
      id,
      module: data.analysis_modules[id]!,
      evidence: data.evidence_base?.[id] ?? null,
    }));

  return (
    <>
      {/* Executive Insight Section */}
      <ExecutiveInsightSection
        darkMode={darkMode}
        data={data.executive_summary}
        signals={data.deal_signals}
      />

      {/* Visual Intelligence Panel */}
      <VisualIntelligencePanel darkMode={darkMode} data={data.visual_intelligence} />

      {/* Analysis Module Cards — Fragment, modules rendered directly */}
      {liveModules.map(({ id, module, evidence }) => (
        <InsightModuleCard
          key={id}
          darkMode={darkMode}
          module={module}
          variant="expanded"
          evidence={evidence}
        />
      ))}
    </>
  );
}

