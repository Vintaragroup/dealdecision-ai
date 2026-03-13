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

import type {
  ExecutiveSummaryData,
  DealSignalsData,
  InsightModuleData,
  ModuleId,
  InvestorInsightsData,
} from '../../../types/investor-insights';
import { ExecutiveInsightSection } from './ExecutiveInsightSection';
import { QuickInsightCards } from './QuickInsightCards';

// ─── Mock: deal signals ───────────────────────────────────────────────────────

const MOCK_SIGNALS: DealSignalsData = {
  overall_score: 78,
  recommendation: 'pursue',
  confidence_level: 'high',
};

// ─── Mock: executive summary ──────────────────────────────────────────────────

const MOCK_EXECUTIVE_SUMMARY: ExecutiveSummaryData = {
  investment_summary:
    'NovaMesh presents a compelling Series A opportunity in the network infrastructure automation space. The company has demonstrated strong early traction with an AI-driven platform that reduces manual network operations by 60%, targeting the $22B enterprise network management market with a differentiated and defensible technology position.',
  key_insight:
    "NovaMesh's proprietary routing algorithm delivers 40% latency improvement over incumbents, creating deep technical switching costs and a defensible moat in a market ripe for automation-driven disruption.",
  top_strengths: [
    'Differentiated AI-native architecture with 3 granted patents and 2 pending applications',
    '180% YoY ARR growth with 94% net revenue retention across 38 enterprise accounts',
    'Experienced founding team with prior exits from Cisco, Arista, and Juniper Networks',
  ],
  top_risks: [
    'Sales cycles of 6–9 months limit near-term revenue acceleration',
    'Heavy reliance on AWS infrastructure creates margin pressure and vendor dependency',
    'Emerging competition from well-funded incumbents entering the AI automation segment',
  ],
  investment_thesis:
    'NovaMesh is positioned to capture significant share of the $22B network management market by leveraging AI to replace legacy manual workflows, with a proven product, strong retention, and a category-defining founding team.',
};

// ─── Mock: modules (compact cards — no evidence needed) ───────────────────────

const MOCK_MODULES: Partial<Record<ModuleId, InsightModuleData>> = {
  investment_thesis: {
    module_id: 'investment_thesis',
    title: 'Investment Thesis',
    icon: 'target',
    score: 82,
    confidence_score: 88,
    summary:
      "NovaMesh's differentiation, strong retention, and large addressable market support a high-conviction case.",
    key_insight:
      'Strong alignment between product capability and market timing creates a compelling entry point.',
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
  market_opportunity: {
    module_id: 'market_opportunity',
    title: 'Market Opportunity',
    icon: 'trending-up',
    score: 79,
    confidence_score: 81,
    summary:
      'The $22B network management market is undergoing structural disruption with 15% CAGR through 2028.',
    key_insight:
      '80% of Fortune 500 network teams still rely on manual CLI processes — the market is poorly served.',
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
  traction_growth: {
    module_id: 'traction_growth',
    title: 'Traction & Growth',
    icon: 'zap',
    score: 85,
    confidence_score: 91,
    summary:
      '$1.8M ARR, 180% YoY growth, and 38 enterprise logos within 24 months of launch.',
    key_insight:
      '94% gross retention and 112% NRR signal strong product-market fit and durable expansion revenue.',
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
  financial_outlook: {
    module_id: 'financial_outlook',
    title: 'Financial Outlook',
    icon: 'bar-chart',
    score: 71,
    confidence_score: 74,
    summary:
      'Revenue trajectory is achievable — path to profitability requires disciplined burn management.',
    key_insight:
      '72% gross margin has clear headroom to 80%+ as infrastructure unit economics improve with scale.',
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
  product_technology: {
    module_id: 'product_technology',
    title: 'Product & Technology',
    icon: 'cpu',
    score: 76,
    confidence_score: 78,
    summary:
      'Proprietary AI routing engine backed by 3 granted patents and validated performance benchmarks.',
    key_insight:
      '40% latency advantage over incumbents represents an 18–24 month competitive lead time.',
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
  risk_factors: {
    module_id: 'risk_factors',
    title: 'Risk Factors',
    icon: 'shield',
    score: 58,
    confidence_score: 65,
    summary:
      'Key risks include customer concentration, a 14-month runway, and increasing incumbent competition.',
    key_insight:
      'Cisco and Juniper automation initiatives signal near-term competitive intensity increase.',
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
  team_assessment: {
    module_id: 'team_assessment',
    title: 'Team Assessment',
    icon: 'users',
    score: 68,
    confidence_score: 70,
    summary:
      'Founding team brings deep domain expertise from Cisco and Arista with prior successful exits.',
    key_insight:
      "CEO's VP Networking background at Arista provides pre-existing relationships with 40%+ of the ICP.",
    strengths: [],
    risks: [],
    deeper_analysis: null,
  },
};

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
