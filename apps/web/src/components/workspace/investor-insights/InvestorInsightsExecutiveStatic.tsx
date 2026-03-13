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

const MOCK_DATA: InvestorInsightsData = {
  deal_metadata: {
    deal_id: 'mock_novamesh_001',
    company_name: 'NovaMesh',
    investment_stage: 'Series A',
    generated_at: '2026-03-12T00:00:00Z',
    industry: 'Enterprise Infrastructure',
  },
  deal_signals: {
    overall_score: 78,
    recommendation: 'pursue',
    confidence_level: 'high',
  },
  executive_summary: {
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
  },
  analysis_modules: {
    investment_thesis: {
      module_id: 'investment_thesis',
      title: 'Investment Thesis',
      icon: 'target',
      score: 82,
      confidence_score: 88,
      summary: "NovaMesh's differentiation, retention, and addressable market support a high-conviction case.",
      key_insight: 'Strong alignment between product capability and market timing.',
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
      summary: '$22B network management market undergoing structural disruption at 15% CAGR.',
      key_insight: '80% of Fortune 500 network teams still rely on manual CLI processes.',
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
      summary: '$1.8M ARR, 180% YoY growth, 38 enterprise logos in 24 months.',
      key_insight: '112% NRR signals strong product-market fit and durable expansion revenue.',
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
      summary: 'Revenue trajectory achievable; path to profitability requires disciplined burn management.',
      key_insight: '72% gross margin has headroom to 80%+ as infrastructure unit economics improve.',
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
      summary: 'Proprietary AI routing engine backed by 3 granted patents.',
      key_insight: '40% latency advantage represents an 18–24 month competitive lead time.',
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
      summary: 'Key risks: customer concentration, 14-month runway, increasing incumbent competition.',
      key_insight: 'Cisco and Juniper automation initiatives signal near-term competitive intensity increase.',
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
      summary: 'Founding team from Cisco and Arista with prior exits.',
      key_insight: "CEO's VP Networking background covers 40%+ of the target ICP.",
      strengths: [],
      risks: [],
      deeper_analysis: null,
    },
  },
  visual_intelligence: {
    market_growth: null,
    financial_projections: null,
    risk_assessment: null,
  },
  critical_metrics: {
    financial: {
      current_arr: '$1.8M',
      yoy_growth: '180%',
      gross_margin: '72%',
      ltv_cac_ratio: '3.8x',
      runway_months: '14 mo',
    },
    product: {
      retention_rate: '94%',
    },
    market: {
      tam: '$22B',
      market_cagr: '15%',
    },
  },
  evidence_base: null,
};

interface InvestorInsightsExecutiveStaticProps {
  darkMode: boolean;
  data: InvestorInsightsData;
}

export function InvestorInsightsExecutiveStatic({ darkMode, data }: InvestorInsightsExecutiveStaticProps) {
  return <ExecutiveBrief darkMode={darkMode} data={data} />;
}
