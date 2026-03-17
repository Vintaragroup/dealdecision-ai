/**
 * InvestorInsightsExecutiveStatic — Design-lock static implementation of Executive Brief.
 *
 * Uses hardcoded mock content only.
 * No API wiring. No adapter logic. No loading/error branching.
 *
 * Delegates directly to ExecutiveBrief with a fully-populated InvestorInsightsData object.
 */

import type { InvestorInsightsData } from '../../../types/investor-insights';
import { ExecutiveBrief } from './ExecutiveBrief';

// ─── Component ────────────────────────────────────────────────────────────────

interface InvestorInsightsExecutiveStaticProps {
  darkMode: boolean;
  data: InvestorInsightsData;
}

export function InvestorInsightsExecutiveStatic({ darkMode, data }: InvestorInsightsExecutiveStaticProps) {
  return <ExecutiveBrief darkMode={darkMode} data={data} />;
}
