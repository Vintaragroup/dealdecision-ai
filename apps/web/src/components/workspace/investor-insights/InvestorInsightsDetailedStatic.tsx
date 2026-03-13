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

import type {
  ExecutiveSummaryData,
  DealSignalsData,
  VisualIntelligenceData,
  InsightModuleData,
  EvidenceItem,
  ModuleId,
} from '../../../types/investor-insights';
import { ExecutiveInsightSection } from './ExecutiveInsightSection';
import { VisualIntelligencePanel } from './VisualIntelligencePanel';
import { InsightModuleCard } from './InsightModuleCard';

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

// ─── Mock: visual intelligence ────────────────────────────────────────────────

const MOCK_VISUAL_INTELLIGENCE: VisualIntelligenceData = {
  market_growth: {
    data_points: [
      { year: '2023', market_size: 12_000_000_000 },
      { year: '2024', market_size: 14_200_000_000 },
      { year: '2025', market_size: 16_800_000_000 },
      { year: '2026', market_size: 19_500_000_000 },
      { year: '2027', market_size: 22_400_000_000 },
      { year: '2028', market_size: 25_800_000_000 },
    ],
    cagr: 15.0,
    summary: 'Network management market projected at 15% CAGR through 2028',
  },
  financial_projections: {
    data_points: [
      { period: 'Q1 24', revenue: 380_000, gross_margin: 240_000 },
      { period: 'Q2 24', revenue: 510_000, gross_margin: 340_000 },
      { period: 'Q3 24', revenue: 720_000, gross_margin: 500_000 },
      { period: 'Q4 24', revenue: 940_000, gross_margin: 660_000 },
      { period: 'Q1 25', revenue: 1_180_000, gross_margin: 860_000 },
      { period: 'Q2 25', revenue: 1_520_000, gross_margin: 1_140_000 },
    ],
    summary: '25% QoQ revenue growth with expanding gross margins from 63% → 75%',
  },
  risk_assessment: {
    categories: [
      { category: 'Market', risk_score: 28 },
      { category: 'Technology', risk_score: 22 },
      { category: 'Competition', risk_score: 45 },
      { category: 'Execution', risk_score: 38 },
      { category: 'Financial', risk_score: 42 },
    ],
    overall_risk_level: 'medium',
  },
};

// ─── Mock: analysis modules ───────────────────────────────────────────────────

const MOCK_INVESTMENT_THESIS: InsightModuleData = {
  module_id: 'investment_thesis',
  title: 'Investment Thesis',
  icon: 'target',
  score: 82,
  confidence_score: 88,
  summary:
    "NovaMesh's competitive differentiation, strong retention, and large addressable market support a high-conviction investment case at current Series A terms.",
  key_insight:
    'Strong alignment between product capability and market timing creates a compelling entry point with defensible upside.',
  strengths: [
    'Clearly articulated TAM expansion path from core networking to full IT operations platforms',
    'Network effects and deep ITSM integrations create an 18–24 month competitive lead time',
  ],
  risks: [
    'Valuation implies aggressive growth assumptions that depend on sustained enterprise sales execution',
  ],
  deeper_analysis:
    'The investment thesis is supported by a strong proprietary technology position and a proven founding team. Key dependencies include continued strong revenue retention and successful enterprise channel expansion in FY2025.',
};

const MOCK_MARKET_OPPORTUNITY: InsightModuleData = {
  module_id: 'market_opportunity',
  title: 'Market Opportunity',
  icon: 'trending-up',
  score: 79,
  confidence_score: 81,
  summary:
    'The $22B enterprise network management market is undergoing a structural shift driven by cloud migration and AI-driven automation, creating substantial greenfield opportunity for NovaMesh.',
  key_insight:
    '80% of Fortune 500 network operations teams still rely on manual CLI processes — the addressable market is poorly served by existing vendors.',
  strengths: [
    '15% CAGR through 2028 driven by cloud migration mandates and compliance requirements',
    'Clear vertical expansion roadmap into healthcare, financial services, and federal markets',
  ],
  risks: [
    'Market education burden may extend initial sales cycles in conservative enterprise verticals',
  ],
  deeper_analysis:
    'Bottom-up TAM modeling based on enterprise customer counts and average contract values supports a serviceable addressable market of $4.2B in the initial ICP of mid-market enterprises.',
};

const MOCK_TRACTION_GROWTH: InsightModuleData = {
  module_id: 'traction_growth',
  title: 'Traction & Growth',
  icon: 'zap',
  score: 85,
  confidence_score: 91,
  summary:
    'NovaMesh demonstrates exceptional growth velocity with $1.8M ARR, 180% YoY growth, and 38 enterprise logos acquired within 24 months of launch.',
  key_insight:
    '94% net revenue retention with 112% NRR signals strong product-market fit and durable expansion revenue within existing accounts.',
  strengths: [
    'Time to value under 30 days enables fast proof-of-concept to production conversion',
    'Land-and-expand motion: average ACV grew from $28K to $47K over the past 12 months',
    '3 enterprise lighthouse accounts in the Fortune 500 providing strong category social proof',
  ],
  risks: [
    'Top 5 customers represent 42% of ARR — concentration risk requires active management',
  ],
  deeper_analysis:
    'Traction metrics are particularly strong relative to the 24-month go-to-market timeline. Pipeline coverage of 4.2x against the next 12-month plan provides credible visibility into Series A deployment capital.',
};

const MOCK_FINANCIAL_OUTLOOK: InsightModuleData = {
  module_id: 'financial_outlook',
  title: 'Financial Outlook',
  icon: 'bar-chart',
  score: 71,
  confidence_score: 74,
  summary:
    'Revenue projections are achievable given pipeline quality, but the path to profitability requires disciplined headcount management and gross margin expansion toward 80%.',
  key_insight:
    "The company's current 72% gross margin has headroom to expand to 80%+ as infrastructure unit economics improve with scale.",
  strengths: [
    'Current ARR of $1.8M with clear line-of-sight to $4M ARR by end of calendar year',
    'LTV/CAC of 3.8x demonstrates capital-efficient customer acquisition',
  ],
  risks: [
    '14-month cash runway creates timeline pressure on Series A close execution',
    'COGS heavily dependent on AWS — margin expansion requires infrastructure migration',
  ],
  deeper_analysis:
    'Pro forma financial model shows FCF positive by Q3 2026 assuming $7M ARR target is met. Sensitivity analysis shows the business remains viable with 15% downside to revenue projections.',
};

const MOCK_PRODUCT_TECHNOLOGY: InsightModuleData = {
  module_id: 'product_technology',
  title: 'Product & Technology',
  icon: 'cpu',
  score: 76,
  confidence_score: 78,
  summary:
    "NovaMesh's proprietary AI routing engine represents genuine technological differentiation, with 3 granted patents forming a solid defensive IP position.",
  key_insight:
    'The core algorithm has demonstrated 40% latency improvement in independent benchmarks — a performance gap that takes 18–24 months for incumbents to close.',
  strengths: [
    '3 granted patents, 2 pending, specifically covering the inference-based routing architecture',
    'API-first design enables 200+ enterprise integrations with major ITSM and monitoring platforms',
  ],
  risks: [
    'Roadmap dependency on a single principal engineer creates key-person concentration risk',
  ],
  deeper_analysis:
    'Technical due diligence confirms architectural differentiation is real and not easily replicable. The primary risk is execution as the platform scales to fully multi-tenant production environments.',
};

const MOCK_RISK_FACTORS: InsightModuleData = {
  module_id: 'risk_factors',
  title: 'Risk Factors',
  icon: 'shield',
  score: 58,
  confidence_score: 65,
  summary:
    'Key risks center on competitive dynamics, customer concentration, and a narrow runway requiring a successful Series A close within the next 60 days.',
  key_insight:
    'Cisco and Juniper have both announced competing AI automation initiatives, signaling near-term increase in competitive intensity that may require accelerated feature velocity.',
  strengths: [
    'Technical moat provides an estimated 18–24 month runway before incumbent products approach feature parity',
  ],
  risks: [
    'Customer concentration — top 5 accounts represent 42% of current ARR',
    'Runway of 14 months requires immediate fundraising execution with no material delays',
    'Key-person dependency in both technical leadership and enterprise sales roles',
  ],
  deeper_analysis:
    'Risk profile is consistent with a well-performing Series A opportunity. Mitigants for customer concentration include 6 enterprise commitments in late-stage pipeline. Runway risk is partially de-risked by advanced conversations with two strategic lead investors.',
};

const MOCK_TEAM_ASSESSMENT: InsightModuleData = {
  module_id: 'team_assessment',
  title: 'Team Assessment',
  icon: 'users',
  score: 68,
  confidence_score: 70,
  summary:
    'Founding team brings deep domain expertise from Cisco and Arista Networks, with direct experience building and scaling enterprise networking products.',
  key_insight:
    "CEO's prior experience as VP of Networking at Arista provides pre-existing relationships with over 40% of the target customer base.",
  strengths: [
    'CEO and CTO both have prior successful exits in the enterprise infrastructure space',
    '19 FTE with a notably lean structure given $1.8M ARR demonstrates strong operational discipline',
  ],
  risks: [
    'Commercial function is nascent — VP of Sales hired 6 months ago with limited track record in this role',
    'Board composition lacks a seasoned enterprise software operator to complement technical leadership',
  ],
  deeper_analysis:
    'Team is strong on the product and technical side but the go-to-market function is still maturing. The Series A milestone would benefit from an experienced enterprise GTM operator joining within 6 months of close.',
};

// Ordered per MODULE_ORDER: investment_thesis, market_opportunity, traction_growth,
// financial_outlook, product_technology, risk_factors, team_assessment
const MOCK_MODULES: { id: ModuleId; data: InsightModuleData; evidence: EvidenceItem[] | null }[] = [
  {
    id: 'investment_thesis',
    data: MOCK_INVESTMENT_THESIS,
    evidence: [
      {
        evidence_id: 'ev_001',
        source_document: 'NovaMesh Series A Pitch Deck',
        source_location: 'Slide 4 — Why Now',
        data_point: 'Network automation market timing driven by cloud migration wave',
        confidence: 'High',
        page_number: 4,
      },
      {
        evidence_id: 'ev_002',
        source_document: 'NovaMesh Financial Model v3.xlsx',
        source_location: 'Sheet: ARR Projections',
        data_point: '$1.8M current ARR, 180% YoY growth rate confirmed',
        confidence: 'High',
      },
    ],
  },
  {
    id: 'market_opportunity',
    data: MOCK_MARKET_OPPORTUNITY,
    evidence: [
      {
        evidence_id: 'ev_003',
        source_document: 'Gartner Network Automation Report 2025',
        source_location: 'Section 3 — Market Sizing',
        data_point: '$22B TAM with 15% CAGR projection through 2028',
        confidence: 'Medium',
        page_number: 14,
      },
    ],
  },
  {
    id: 'traction_growth',
    data: MOCK_TRACTION_GROWTH,
    evidence: [
      {
        evidence_id: 'ev_010',
        source_document: 'NovaMesh Series A Pitch Deck',
        source_location: 'Slide 8 — Traction',
        data_point: '38 enterprise accounts, NRR 112%',
        confidence: 'High',
        page_number: 8,
      },
      {
        evidence_id: 'ev_011',
        source_document: 'Customer Cohort Analysis Q4 2024',
        source_location: 'Retention waterfall chart',
        data_point: '94% gross revenue retention across all cohorts',
        confidence: 'High',
      },
    ],
  },
  {
    id: 'financial_outlook',
    data: MOCK_FINANCIAL_OUTLOOK,
    evidence: [
      {
        evidence_id: 'ev_020',
        source_document: 'NovaMesh Financial Model v3.xlsx',
        source_location: 'Sheet: P&L Summary',
        data_point: 'LTV/CAC ratio of 3.8x as of Q4 2024',
        confidence: 'High',
      },
      {
        evidence_id: 'ev_021',
        source_document: 'NovaMesh Series A Pitch Deck',
        source_location: 'Slide 12 — Unit Economics',
        data_point: '14-month cash runway at current burn rate',
        confidence: 'Medium',
        page_number: 12,
      },
    ],
  },
  {
    id: 'product_technology',
    data: MOCK_PRODUCT_TECHNOLOGY,
    evidence: [
      {
        evidence_id: 'ev_030',
        source_document: 'Independent Technical Benchmark Report — Jan 2025',
        source_location: 'Latency comparison table',
        data_point: '40% latency improvement over next-best competitor in controlled benchmark',
        confidence: 'High',
        page_number: 6,
      },
    ],
  },
  {
    id: 'risk_factors',
    data: MOCK_RISK_FACTORS,
    evidence: [
      {
        evidence_id: 'ev_040',
        source_document: 'NovaMesh Series A Pitch Deck',
        source_location: 'Slide 15 — Risk Factors',
        data_point: 'Customer concentration: top 5 accounts = 42% ARR',
        confidence: 'High',
        page_number: 15,
      },
    ],
  },
  {
    id: 'team_assessment',
    data: MOCK_TEAM_ASSESSMENT,
    evidence: null,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface InvestorInsightsDetailedStaticProps {
  darkMode: boolean;
}

export function InvestorInsightsDetailedStatic({ darkMode }: InvestorInsightsDetailedStaticProps) {
  return (
    <>
      {/* Executive Insight Section */}
      <ExecutiveInsightSection
        darkMode={darkMode}
        data={MOCK_EXECUTIVE_SUMMARY}
        signals={MOCK_SIGNALS}
      />

      {/* Visual Intelligence Panel */}
      <VisualIntelligencePanel darkMode={darkMode} data={MOCK_VISUAL_INTELLIGENCE} />

      {/* Analysis Module Cards — Fragment, modules rendered directly */}
      {MOCK_MODULES.map(({ id, data, evidence }) => (
        <InsightModuleCard
          key={id}
          darkMode={darkMode}
          module={data}
          variant="expanded"
          evidence={evidence}
        />
      ))}
    </>
  );
}
