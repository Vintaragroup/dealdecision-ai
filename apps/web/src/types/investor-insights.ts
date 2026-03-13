/**
 * investor-insights.ts — UI-side adapted types for the Investor Insights tab.
 *
 * This file defines the UI data model (NOT the raw backend model) and contains:
 *  - Adapted type definitions consumed by all Investor Insights components
 *  - Parse helpers for limited_scoring_v1 and deal_risk_radar_v1 section bodies
 *  - `deriveInsightsState` — maps hook status + report to an 8-state UI machine
 *  - `adaptReportToInsightsData` — the single bridge from InvestorInsightsReport → InvestorInsightsData
 *
 * IMPORTANT: Do not import from the worker packages. All parsing is re-implemented here.
 */

import type { InvestorInsightsReport } from '../lib/apiClient';
import type { UseInvestorInsightsStatus } from '../hooks/useInvestorInsights';
import {
  parseLlmInterpretationBody,
  type LlmInterpretationV1,
  type LlmInterpretationPosture,
  type LlmInterpretationConfidence,
} from '../components/workspace/investorInsightsUtils';

// ─── UI state machine ─────────────────────────────────────────────────────────

export type InsightsState =
  | 'initial'         // hook idle, nothing fetched yet
  | 'loading'         // first-load fetch in progress
  | 'error'           // fetch failed with no prior data
  | 'empty'           // fetch succeeded but no sections to display
  | 'stale_data'      // data present but aged (see tab auto-refresh)
  | 'partial_error'   // background refresh failed but prior data available
  | 'partial_loading' // background refresh in progress with prior data shown
  | 'ready';          // data present and up-to-date

export function deriveInsightsState(
  status: UseInvestorInsightsStatus,
  report: InvestorInsightsReport | null,
): InsightsState {
  if (status === 'idle') return 'initial';
  if (status === 'loading') {
    return report !== null ? 'partial_loading' : 'loading';
  }
  if (status === 'error') {
    return report !== null ? 'partial_error' : 'error';
  }
  // status === 'ready'
  const hasSections = (report?.render_package?.sections?.length ?? 0) > 0;
  if (!hasSections) return 'empty';
  return 'ready';
}

// ─── View mode ────────────────────────────────────────────────────────────────

export type ViewMode = 'quick' | 'detailed' | 'executive';

// ─── Module IDs ───────────────────────────────────────────────────────────────

export type ModuleId =
  | 'market_opportunity'
  | 'product_technology'
  | 'traction_growth'
  | 'financial_outlook'
  | 'team_assessment'
  | 'risk_factors'
  | 'investment_thesis';

export const MODULE_TITLES: Record<ModuleId, string> = {
  market_opportunity: 'Market Opportunity',
  product_technology: 'Product & Technology',
  traction_growth: 'Traction & Growth',
  financial_outlook: 'Financial Outlook',
  team_assessment: 'Team Assessment',
  risk_factors: 'Risk Factors',
  investment_thesis: 'Investment Thesis',
};

export const MODULE_ORDER: ModuleId[] = [
  'investment_thesis',
  'market_opportunity',
  'traction_growth',
  'financial_outlook',
  'product_technology',
  'risk_factors',
  'team_assessment',
];

// ─── Investment recommendation ────────────────────────────────────────────────

export type InvestmentRecommendation =
  | 'strong_pass'
  | 'pass'
  | 'watch'
  | 'consider'
  | 'pursue';

export const RECOMMENDATION_LABELS: Record<InvestmentRecommendation, string> = {
  strong_pass: 'Strong Pass',
  pass: 'Pass',
  watch: 'Watch',
  consider: 'Consider',
  pursue: 'Pursue',
};

export const RECOMMENDATION_COLORS: Record<InvestmentRecommendation, string> = {
  strong_pass: '#ef4444',
  pass: '#f97316',
  watch: '#eab308',
  consider: '#3b82f6',
  pursue: '#22c55e',
};

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface EvidenceItem {
  evidence_id?: string;
  source_document: string;
  source_location: string;
  data_point: string;
  confidence: 'High' | 'Medium' | 'Low';
  page_number?: number;
}

// ─── Analysis module ──────────────────────────────────────────────────────────

export interface InsightModuleData {
  module_id: ModuleId;
  title: string;
  icon: string;
  /** Score 0–100, or null when not scoreable. */
  score: number | null;
  summary: string;
  key_insight: string;
  strengths: string[];
  risks: string[];
  deeper_analysis: string | null;
  /** Score 0–100 or null, used as confidence display in cards. */
  confidence_score: number | null;
}

// ─── Executive summary ────────────────────────────────────────────────────────

export interface ExecutiveSummaryData {
  investment_summary: string;
  key_insight: string;
  top_strengths: string[];
  top_risks: string[];
  investment_thesis: string | null;
}

// ─── Deal signals (scores + recommendation) ───────────────────────────────────

export interface DealSignalsData {
  overall_score: number | null;
  recommendation: InvestmentRecommendation | null;
  confidence_level: 'low' | 'medium' | 'high';
}

// ─── Visual intelligence (chart data) ────────────────────────────────────────

export interface MarketGrowthDataPoint {
  year: string;
  market_size: number;
}

export interface MarketGrowthData {
  data_points: MarketGrowthDataPoint[];
  summary: string;
  cagr?: number;
}

export interface FinancialProjectionDataPoint {
  period: string;
  revenue: number;
  gross_margin: number;
}

export interface FinancialProjectionData {
  data_points: FinancialProjectionDataPoint[];
  summary: string;
}

export interface RiskAssessmentDataPoint {
  category: string;
  risk_score: number;
  description?: string;
}

export interface RiskAssessmentData {
  categories: RiskAssessmentDataPoint[];
  overall_risk_level?: 'low' | 'medium' | 'high';
}

export interface VisualIntelligenceData {
  market_growth: MarketGrowthData | null;
  financial_projections: FinancialProjectionData | null;
  risk_assessment: RiskAssessmentData | null;
}

// ─── Critical metrics ─────────────────────────────────────────────────────────

export interface CriticalMetrics {
  financial: {
    current_arr?: string;
    yoy_growth?: string;
    gross_margin?: string;
    ltv_cac_ratio?: string;
    runway_months?: string;
  };
  product: {
    retention_rate?: string;
  };
  market: {
    tam?: string;
    market_cagr?: string;
  };
}

// ─── Deal metadata ────────────────────────────────────────────────────────────

export interface InvestorInsightsDealMetadata {
  deal_id: string;
  company_name: string;
  investment_stage: string;
  generated_at: string;
  industry?: string;
}

// ─── Top-level UI data model ──────────────────────────────────────────────────

export interface InvestorInsightsData {
  deal_metadata: InvestorInsightsDealMetadata;
  deal_signals: DealSignalsData;
  executive_summary: ExecutiveSummaryData;
  analysis_modules: Partial<Record<ModuleId, InsightModuleData>>;
  visual_intelligence: VisualIntelligenceData;
  critical_metrics: CriticalMetrics | null;
  evidence_base: Partial<Record<ModuleId, EvidenceItem[]>> | null;
}

// ─── Internal parse types (mirrored from worker, not exported from packages) ──

interface LimitedScoringV1 {
  schema_version: 'limited_scoring_v1';
  completeness_score: number | null;
  completeness_confidence: 'high' | 'medium' | 'low';
  completeness_notes: string[];
  deal_terms_score: number | null;
  deal_terms_confidence: 'high' | 'medium' | 'low';
  deal_terms_notes: string[];
  traction_signal_score: number | null;
  traction_signal_confidence: 'high' | 'medium' | 'low';
  traction_signal_notes: string[];
  market_presence_score: number | null;
  market_presence_confidence: 'high' | 'medium' | 'low';
  market_presence_notes: string[];
  overall_limited_score: number | null;
  scoring_confidence: 'high' | 'medium' | 'low' | 'not_scoreable';
  scoring_notes: string[];
  deferred_categories: string[];
  scored_at: string;
}

interface DealRiskRadarV1 {
  schema_version: 'deal_risk_radar_v1';
  competitor_events: Array<{ company: string; event: string; impact: string; evidence_urls: string[] }>;
  market_events: Array<{ description: string; sector: string; direction: string; evidence_urls: string[] }>;
  company_events: Array<{ event: string; category: string; impact: string; evidence_urls: string[] }>;
  founder_signals: Array<{ name: string; signal: string; impact: string; evidence_urls: string[] }>;
  source_count: number;
  signal_consensus: string;
  deal_id: string;
  ran_at: string;
  next_scheduled_at: string | null;
  run_status: string;
  total_sources_fetched: number;
  company_name_used: string | null;
  sector_used: string | null;
}

// ─── Body parsers ─────────────────────────────────────────────────────────────

/**
 * Parse a LimitedScoringV1 from the plain key-value text body produced by
 * `buildLimitedScoringSection` on the worker side.
 */
export function parseLimitedScoringBody(body: string): LimitedScoringV1 | null {
  const parseNum = (v: string | undefined): number | null => {
    if (!v || v === 'not_scoreable') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  const kv: Record<string, string> = {};
  const notes: Record<string, string[]> = {};

  for (const line of body.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const rawKey = line.slice(0, colon).trim();
    const rawVal = line.slice(colon + 1).trim();
    if (!rawKey) continue;

    // Indented lines are note continuations
    if (line.startsWith('  ') || line.startsWith('\t')) {
      if (!notes[rawKey]) notes[rawKey] = [];
      notes[rawKey].push(rawVal);
    } else {
      kv[rawKey] = rawVal;
    }
  }

  if (kv['schema_version'] !== 'limited_scoring_v1') return null;

  const toConf = (v: string | undefined): 'high' | 'medium' | 'low' =>
    v === 'high' || v === 'medium' || v === 'low' ? v : 'low';

  const toScoringConf = (v: string | undefined): 'high' | 'medium' | 'low' | 'not_scoreable' =>
    v === 'high' || v === 'medium' || v === 'low' || v === 'not_scoreable' ? v : 'not_scoreable';

  return {
    schema_version: 'limited_scoring_v1',
    completeness_score: parseNum(kv['completeness_score']),
    completeness_confidence: toConf(kv['completeness_confidence']),
    completeness_notes: notes['completeness_note'] ?? [],
    deal_terms_score: parseNum(kv['deal_terms_score']),
    deal_terms_confidence: toConf(kv['deal_terms_confidence']),
    deal_terms_notes: notes['deal_terms_note'] ?? [],
    traction_signal_score: parseNum(kv['traction_signal_score']),
    traction_signal_confidence: toConf(kv['traction_signal_confidence']),
    traction_signal_notes: notes['traction_note'] ?? [],
    market_presence_score: parseNum(kv['market_presence_score']),
    market_presence_confidence: toConf(kv['market_presence_confidence']),
    market_presence_notes: notes['market_note'] ?? [],
    overall_limited_score: parseNum(kv['overall_limited_score']),
    scoring_confidence: toScoringConf(kv['scoring_confidence']),
    scoring_notes: notes['scoring_note'] ?? [],
    deferred_categories: kv['deferred_categories']
      ? kv['deferred_categories'].split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    scored_at: kv['scored_at'] ?? '',
  };
}

/**
 * Parse a DealRiskRadarV1 from a section body string produced by
 * `serializeMonitoringBody` on the worker side.
 * Mirrors the logic in serialize-monitoring-body.ts without importing from worker.
 */
export function parseMonitoringBody(body: string): DealRiskRadarV1 | null {
  const DELIMITER = '---deal_risk_radar_v1_json---';
  const delimIdx = body.indexOf(DELIMITER);
  if (delimIdx === -1) return null;
  const jsonStr = body.slice(delimIdx + DELIMITER.length).trim();
  if (!jsonStr) return null;
  try {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>;
    if (raw['schema_version'] !== 'deal_risk_radar_v1') return null;
    return raw as unknown as DealRiskRadarV1;
  } catch {
    return null;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function postureToRecommendation(posture: LlmInterpretationPosture): InvestmentRecommendation {
  switch (posture) {
    case 'GO': return 'pursue';
    case 'INVESTIGATE': return 'consider';
    case 'CAUTION': return 'watch';
    case 'PASS': return 'pass';
  }
}

function confidenceToLevel(c: LlmInterpretationConfidence): 'low' | 'medium' | 'high' {
  return c.toLowerCase() as 'low' | 'medium' | 'high';
}

function impactToScore(impact: string): number {
  if (impact === 'high') return 80;
  if (impact === 'medium') return 50;
  return 20;
}

function buildRiskAssessmentData(radar: DealRiskRadarV1): RiskAssessmentData {
  const categories: RiskAssessmentDataPoint[] = [];

  if (radar.competitor_events.length > 0) {
    const avg = Math.round(
      radar.competitor_events.reduce((s, e) => s + impactToScore(e.impact), 0) /
        radar.competitor_events.length,
    );
    categories.push({ category: 'Competitive', risk_score: avg });
  }
  if (radar.company_events.length > 0) {
    const avg = Math.round(
      radar.company_events.reduce((s, e) => s + impactToScore(e.impact), 0) /
        radar.company_events.length,
    );
    categories.push({ category: 'Operational', risk_score: avg });
  }
  if (radar.market_events.length > 0) {
    const negCount = radar.market_events.filter((e) => e.direction === 'negative').length;
    categories.push({
      category: 'Market',
      risk_score: Math.round((negCount / radar.market_events.length) * 100),
    });
  }
  if (radar.founder_signals.length > 0) {
    const avg = Math.round(
      radar.founder_signals.reduce((s, f) => s + impactToScore(f.impact), 0) /
        radar.founder_signals.length,
    );
    categories.push({ category: 'Team', risk_score: avg });
  }

  const consensus = radar.signal_consensus;
  const overall_risk_level: 'low' | 'medium' | 'high' =
    consensus === 'bearish' ? 'high' : consensus === 'bullish' ? 'low' : 'medium';

  return { categories, overall_risk_level };
}

function buildRiskModule(llm: LlmInterpretationV1 | null, radar: DealRiskRadarV1): InsightModuleData {
  const allRisks = [
    ...radar.competitor_events
      .filter((e) => e.impact !== 'low')
      .map((e) => `${e.company}: ${e.event}`),
    ...radar.company_events
      .filter((e) => e.impact !== 'low')
      .map((e) => e.event),
    ...radar.market_events
      .filter((e) => e.direction === 'negative')
      .map((e) => e.description),
  ].slice(0, 5);

  const externalRisks = llm?.external_risk_signals || null;

  return {
    module_id: 'risk_factors',
    title: MODULE_TITLES.risk_factors,
    icon: 'AlertTriangle',
    score: null,
    summary: `Signal consensus: ${radar.signal_consensus}. ${allRisks.length} notable risk signal(s) detected.`,
    key_insight: radar.signal_consensus,
    strengths: [],
    risks: allRisks,
    deeper_analysis: externalRisks || null,
    confidence_score: null,
  };
}

// ─── The single adapter function ──────────────────────────────────────────────

/**
 * Adapt a raw `InvestorInsightsReport` from the API into the UI `InvestorInsightsData` model.
 *
 * This is the only bridge between the backend shape and the component tree.
 * All data access in Investor Insights components must go through this transformed model.
 */
export function adaptReportToInsightsData(
  report: InvestorInsightsReport,
  dealName?: string,
): InvestorInsightsData {
  const sections = report.render_package?.sections ?? [];
  const findSection = (key: string) => sections.find((s) => s.key === key);

  // Parse core sections
  const llmSection = findSection('llm_interpretation_v1');
  const llm: LlmInterpretationV1 | null = llmSection?.body
    ? parseLlmInterpretationBody(llmSection.body)
    : null;

  const scoringSection = findSection('limited_scoring_v1');
  const scoring: LimitedScoringV1 | null = scoringSection?.body
    ? parseLimitedScoringBody(scoringSection.body)
    : null;

  const radarSection = findSection('deal_risk_radar_v1');
  const radar: DealRiskRadarV1 | null = radarSection?.body
    ? parseMonitoringBody(radarSection.body)
    : null;

  // ── Deal metadata ───────────────────────────────────────────────────────────
  const deal_metadata: InvestorInsightsDealMetadata = {
    deal_id: '',
    company_name: dealName ?? 'Unknown Company',
    investment_stage: '',
    generated_at: report.updated_at ?? new Date().toISOString(),
  };

  // ── Deal signals ────────────────────────────────────────────────────────────
  const deal_signals: DealSignalsData = {
    overall_score: scoring?.overall_limited_score ?? null,
    recommendation: llm ? postureToRecommendation(llm.posture) : null,
    confidence_level: llm ? confidenceToLevel(llm.confidence) : 'low',
  };

  // ── Executive summary ───────────────────────────────────────────────────────
  const executive_summary: ExecutiveSummaryData = {
    investment_summary: llm?.executive_summary ?? '',
    key_insight: llm?.business_quality ?? '',
    top_strengths: llm?.strengths ?? [],
    top_risks: llm?.risks ?? [],
    investment_thesis: llm
      ? [llm.product_differentiation, llm.go_to_market_strategy]
          .filter(Boolean)
          .join(' ')
          .trim() || null
      : null,
  };

  // ── Analysis modules ────────────────────────────────────────────────────────
  const analysis_modules: Partial<Record<ModuleId, InsightModuleData>> = {};

  if (llm) {
    analysis_modules.investment_thesis = {
      module_id: 'investment_thesis',
      title: MODULE_TITLES.investment_thesis,
      icon: 'Star',
      score: scoring?.overall_limited_score ?? null,
      summary: llm.executive_summary,
      key_insight: llm.executive_summary,
      strengths: llm.strengths,
      risks: llm.risks,
      deeper_analysis: llm.claim_verification_summary || null,
      confidence_score: scoring?.overall_limited_score ?? null,
    };

    analysis_modules.market_opportunity = {
      module_id: 'market_opportunity',
      title: MODULE_TITLES.market_opportunity,
      icon: 'Globe',
      score: scoring?.market_presence_score ?? null,
      summary: llm.market_position,
      key_insight: llm.external_market_context || llm.market_position,
      strengths: [],
      risks: [],
      deeper_analysis: llm.competitive_landscape || null,
      confidence_score: scoring?.market_presence_score ?? null,
    };

    analysis_modules.product_technology = {
      module_id: 'product_technology',
      title: MODULE_TITLES.product_technology,
      icon: 'Layers',
      score: null,
      summary: llm.product_differentiation,
      key_insight: llm.product_differentiation,
      strengths: [],
      risks: [],
      deeper_analysis: null,
      confidence_score: null,
    };

    analysis_modules.traction_growth = {
      module_id: 'traction_growth',
      title: MODULE_TITLES.traction_growth,
      icon: 'TrendingUp',
      score: scoring?.traction_signal_score ?? null,
      summary: llm.business_quality,
      key_insight: llm.business_quality,
      strengths: [],
      risks: [],
      deeper_analysis: null,
      confidence_score: scoring?.traction_signal_score ?? null,
    };

    analysis_modules.financial_outlook = {
      module_id: 'financial_outlook',
      title: MODULE_TITLES.financial_outlook,
      icon: 'DollarSign',
      score: scoring?.deal_terms_score ?? null,
      summary: llm.financial_outlook,
      key_insight: llm.financial_outlook,
      strengths: [],
      risks: [],
      deeper_analysis: llm.capital_and_raise_interpretation || null,
      confidence_score: scoring?.deal_terms_score ?? null,
    };
  }

  if (radar) {
    analysis_modules.risk_factors = buildRiskModule(llm, radar);
  } else if (llm?.external_risk_signals) {
    // Fallback: derive risk module from LLM external risk signals only
    analysis_modules.risk_factors = {
      module_id: 'risk_factors',
      title: MODULE_TITLES.risk_factors,
      icon: 'AlertTriangle',
      score: null,
      summary: llm.external_risk_signals,
      key_insight: llm.external_risk_signals,
      strengths: [],
      risks: [],
      deeper_analysis: null,
      confidence_score: null,
    };
  }

  // team_assessment: intentionally absent — no backend source

  // ── Visual intelligence ─────────────────────────────────────────────────────
  const visual_intelligence: VisualIntelligenceData = {
    market_growth: null,      // no backend source today
    financial_projections: null, // no backend source today
    risk_assessment: radar ? buildRiskAssessmentData(radar) : null,
  };

  return {
    deal_metadata,
    deal_signals,
    executive_summary,
    analysis_modules,
    visual_intelligence,
    critical_metrics: null,
    evidence_base: null,
  };
}
