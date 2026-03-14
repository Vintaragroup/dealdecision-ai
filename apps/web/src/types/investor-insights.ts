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
  parseGovernedSummaryBody,
  parseCanonicalFieldsBody,
  type LlmInterpretationV1,
  type LlmInterpretationPosture,
  type LlmInterpretationConfidence,
  type GovernedSummaryV1,
  type CanonicalFieldRow,
} from '../components/workspace/investorInsightsUtils';

// ─── UI state machine ─────────────────────────────────────────────────────────

export type InsightsState =
  | 'initial'            // hook idle, nothing fetched yet
  | 'loading'            // first-load fetch in progress
  | 'error'              // fetch failed with no prior data
  | 'empty'              // fetch succeeded but no sections to display
  | 'stale_data'         // data present but aged (see tab auto-refresh)
  | 'partial_error'      // background refresh failed but prior data available
  | 'partial_loading'    // background refresh in progress with prior data shown
  | 'deterministic_only' // sections present but no llm_interpretation_v1 (evidence-gate limited)
  | 'ready';             // sections present including llm_interpretation_v1

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
  const sections = report?.render_package?.sections ?? [];
  if (sections.length === 0) return 'empty';
  const hasLlm = sections.some((s) => s.key === 'llm_interpretation_v1');
  return hasLlm ? 'ready' : 'deterministic_only';
}

// ─── Report quality state classifier ────────────────────────────────────────

/**
 * Describes the *content quality* of a report — what sections are present and
 * usable — independent of the fetch/hook interaction state in InsightsState.
 *
 * Used by the adapter's source-priority logic to select the strongest available
 * source for each module.
 *
 * Detection rules (checked top-to-bottom):
 *   none              — report is null
 *   not_started       — report_status = 'not_started' or sections array is empty
 *   running           — report_status = 'running' or analysis_status = 'running'
 *   failed            — report_status = 'failed'
 *   governed_usable   — governed_summary_v1 section present (primary rendering foundation)
 *   partial           — llm_interpretation_v1 present but governed_summary_v1 absent
 *   deterministic_only— only scoring/canonical sections; no narrative at all
 */
export type ReportQualityState =
  | 'none'               // report === null
  | 'not_started'        // no sections generated yet
  | 'running'            // generation actively in progress
  | 'deterministic_only' // scoring/canonical only; no narrative sections
  | 'governed_usable'    // governed_summary_v1 present; primary rendering foundation
  | 'partial'            // llm present but governed absent (edge case)
  | 'failed';            // generation failed

export function classifyReportQuality(
  report: InvestorInsightsReport | null,
): ReportQualityState {
  if (!report) return 'none';

  const reportStatus = (report.status_summary?.report_status ?? report.status ?? '') as string;
  const analysisStatus = (report.status_summary?.analysis_status ?? '') as string;

  if (reportStatus === 'failed') return 'failed';
  if (reportStatus === 'running' || analysisStatus === 'running') return 'running';
  if (reportStatus === 'not_started') return 'not_started';

  const sections = report.render_package?.sections ?? [];
  if (sections.length === 0) return 'not_started';

  const hasGoverned = sections.some((s) => s.key === 'governed_summary_v1');
  const hasLlm = sections.some((s) => s.key === 'llm_interpretation_v1');

  if (hasGoverned) return 'governed_usable'; // governed present — can render narrative
  if (hasLlm) return 'partial';              // llm only, no governed (edge case)
  return 'deterministic_only';
}

// ─── Report completeness classifier ─────────────────────────────────────────

/**
 * Classifies the *completeness* of a report for UI display (badges, banners).
 *
 * Four mutually exclusive states, checked top-to-bottom:
 *   not_generated    — report absent, not started, failed, or running with no prior data
 *   evidence_limited — extraction ran but LLM pipeline blocked (deterministic-only / evidence gate)
 *   partial_analysis — at least one narrative section present, but not the full required set
 *   full_analysis    — llm_interpretation_v1 + governed_summary_v1 + limited_scoring_v1 all present
 *
 * Signals checked:
 *   status_summary.report_status         'deterministic_only' → evidence_limited
 *   render_package['status']             'deterministic_only' → evidence_limited
 *   status_summary.evidence_gate.passed  false → evidence_limited
 *   render_package.evidence_gate.passed  false → evidence_limited
 *   sections key presence                llm_interpretation_v1, governed_summary_v1, limited_scoring_v1
 */
export type ReportCompletenessClass =
  | 'not_generated'    // no report / not started / failed / running without prior data
  | 'evidence_limited' // deterministic extraction only; LLM blocked by evidence gate
  | 'partial_analysis' // some narrative generated but not the full required section set
  | 'full_analysis';   // llm_interpretation_v1 + governed_summary_v1 + limited_scoring_v1 all present

export function classifyReportCompleteness(
  report: InvestorInsightsReport | null,
): ReportCompletenessClass {
  if (!report) return 'not_generated';

  const reportStatus = (report.status_summary?.report_status ?? report.status ?? '') as string;
  const hasExistingPackage = report.status_summary?.has_existing_render_package ?? false;

  // Terminal non-content states
  if (reportStatus === 'failed' || reportStatus === 'not_started') return 'not_generated';
  if (reportStatus === 'running' && !hasExistingPackage) return 'not_generated';

  const sections = report.render_package?.sections ?? [];
  if (sections.length === 0) return 'not_generated';

  // Evidence-limited: LLM pipeline explicitly blocked by deterministic-only route or evidence gate
  const rpStatus = (report.render_package as Record<string, unknown> | undefined)?.['status'] as string | undefined;
  const isDeterministicOnly = reportStatus === 'deterministic_only' || rpStatus === 'deterministic_only';
  const statusSummaryGateFailed = report.status_summary?.evidence_gate?.passed === false;
  const packageGateFailed = report.render_package?.evidence_gate?.passed === false;

  const hasLlm = sections.some((s) => s.key === 'llm_interpretation_v1');
  const hasGoverned = sections.some((s) => s.key === 'governed_summary_v1');
  const hasScoring = sections.some((s) => s.key === 'limited_scoring_v1');

  if (isDeterministicOnly || statusSummaryGateFailed || packageGateFailed) {
    // Even if some narrative snuck through, the gate verdict takes precedence
    if (!hasLlm && !hasGoverned) return 'evidence_limited';
    // Rare: gate says deterministic-only but narrative sections are present — treat as partial
    return hasLlm && hasGoverned && hasScoring ? 'full_analysis' : 'partial_analysis';
  }

  // Full: all three core sections generated
  if (hasLlm && hasGoverned && hasScoring) return 'full_analysis';

  // Partial: at least one narrative section present
  if (hasLlm || hasGoverned) return 'partial_analysis';

  // Scoring-only without any narrative: deterministic path ran, LLM didn't produce output
  if (hasScoring) return 'evidence_limited';

  return 'not_generated';
}

// ─── Source-priority helpers ──────────────────────────────────────────────────

/** Pick the first computable, non-empty canonical value for a category + field. */
function canonicalValue(
  rows: CanonicalFieldRow[],
  category: string,
  field: string,
): string | null {
  return (
    rows.find(
      (r) => r.category === category && r.field === field && r.computability === 'Computable' && !!r.value,
    )?.value ?? null
  );
}

/**
 * Patterns that identify obviously weak or placeholder text.
 * Used to suppress weak narrative when stronger evidence is available.
 */
const WEAK_TEXT_RE = /^(not\s+disclosed|not\s+available|n\/a|none|no\s+data|\u2014|-)$/i;

function isWeakText(s: string | null | undefined): boolean {
  if (s == null) return true;
  return WEAK_TEXT_RE.test(s.trim());
}

/**
 * Build a financial summary sentence from computable canonical fields.
 * Preferred source order: ARR/MRR/Revenue → growth_rate → runway → burn → cash.
 * Returns null when no computable financial/revenue signal exists.
 */
function buildFinancialNarrativeFromCanonical(rows: CanonicalFieldRow[]): string | null {
  const parts: string[] = [];
  const arr = canonicalValue(rows, 'traction_signal', 'arr_value');
  const mrr = canonicalValue(rows, 'traction_signal', 'mrr_value');
  const rev = canonicalValue(rows, 'traction_signal', 'revenue_value');
  const growth = canonicalValue(rows, 'traction_signal', 'growth_rate');
  const runway = canonicalValue(rows, 'financial_health', 'runway_months');
  const burn = canonicalValue(rows, 'financial_health', 'net_cash_burn_monthly');
  const cash = canonicalValue(rows, 'financial_health', 'cash_balance');

  if (arr) parts.push(`ARR: ${arr}`);
  else if (mrr) parts.push(`MRR: ${mrr}`);
  else if (rev) parts.push(`Revenue: ${rev}`);
  if (growth) parts.push(`Growth: ${growth}`);
  if (runway) parts.push(`Runway: ${runway} months`);
  if (burn) parts.push(`Burn: ${burn}/mo`);
  if (cash) parts.push(`Cash: ${cash}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Build a traction summary from computable canonical fields.
 * Preferred source order: ARR/MRR/Revenue → growth_rate → customer_count → retention.
 * Returns null when no computable traction signal exists.
 */
function buildTractionNarrativeFromCanonical(rows: CanonicalFieldRow[]): string | null {
  const parts: string[] = [];
  const arr = canonicalValue(rows, 'traction_signal', 'arr_value');
  const mrr = canonicalValue(rows, 'traction_signal', 'mrr_value');
  const rev = canonicalValue(rows, 'traction_signal', 'revenue_value');
  const growth = canonicalValue(rows, 'traction_signal', 'growth_rate');
  const customers = canonicalValue(rows, 'traction_signal', 'customer_count');
  const retention = canonicalValue(rows, 'saas_metrics', 'retention_pct');

  if (arr) parts.push(`ARR: ${arr}`);
  else if (mrr) parts.push(`MRR: ${mrr}`);
  else if (rev) parts.push(`Revenue: ${rev}`);
  if (growth) parts.push(`Growth: ${growth}`);
  if (customers) parts.push(`Customers: ${customers}`);
  if (retention) parts.push(`Retention: ${retention}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Build a market claims summary from computable canonical fields.
 * Preferred source order: TAM → SAM → SOM → CAGR.
 * Returns null when no computable market claim exists.
 */
function buildMarketNarrativeFromCanonical(rows: CanonicalFieldRow[]): string | null {
  const parts: string[] = [];
  const tam = canonicalValue(rows, 'market_claims', 'tam_value');
  const sam = canonicalValue(rows, 'market_claims', 'sam_value');
  const som = canonicalValue(rows, 'market_claims', 'som_value');
  const cagr = canonicalValue(rows, 'market_claims', 'market_cagr');

  if (tam) parts.push(`TAM: ${tam}`);
  if (sam) parts.push(`SAM: ${sam}`);
  if (som) parts.push(`SOM: ${som}`);
  if (cagr) parts.push(`CAGR: ${cagr}`);

  return parts.length > 0 ? parts.join(' · ') : null;
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
  /** Four-state completeness classification derived from the raw report's signals. */
  completeness_class: ReportCompletenessClass;
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

  const governedSection = findSection('governed_summary_v1');
  const governed: GovernedSummaryV1 | null = governedSection?.body
    ? parseGovernedSummaryBody(governedSection.body)
    : null;

  const canonicalSection = findSection('canonical_fields');
  const canonicalRows: CanonicalFieldRow[] = canonicalSection?.body
    ? parseCanonicalFieldsBody(canonicalSection.body)
    : [];
  // canonicalValue() already handles the 'none'→null and Computable guard; wrap for local shorthand.
  const getCanonical = (cat: string, field: string): string | undefined =>
    canonicalValue(canonicalRows, cat, field) ?? undefined;

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
    investment_summary: llm?.executive_summary ?? governed?.executive_summary ?? '',
    key_insight: llm?.business_quality ?? '',
    top_strengths: llm?.strengths ?? governed?.strengths ?? [],
    top_risks: llm?.risks ?? governed?.risks ?? [],
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

    // Canonical market claims (TAM/SAM/SOM) are deterministic evidence; prefer as key_insight.
    const canonicalMarket = buildMarketNarrativeFromCanonical(canonicalRows);
    analysis_modules.market_opportunity = {
      module_id: 'market_opportunity',
      title: MODULE_TITLES.market_opportunity,
      icon: 'Globe',
      score: scoring?.market_presence_score ?? null,
      summary: llm.market_position,
      key_insight: canonicalMarket ?? (llm.external_market_context || llm.market_position),
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

    // Canonical traction signals are deterministic evidence; prefer over llm.business_quality
    // (which describes general business model quality, not traction specifically).
    const canonicalTraction = buildTractionNarrativeFromCanonical(canonicalRows);
    analysis_modules.traction_growth = {
      module_id: 'traction_growth',
      title: MODULE_TITLES.traction_growth,
      icon: 'TrendingUp',
      score: scoring?.traction_signal_score ?? null,
      summary: canonicalTraction ?? llm.business_quality,
      key_insight: canonicalTraction ?? llm.business_quality,
      strengths: [],
      risks: [],
      deeper_analysis: isWeakText(canonicalTraction) ? null : llm.business_quality,
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

  // ── Governed + canonical fallback modules (when llm_interpretation_v1 was not produced) ──
  // Source-priority order for each module:
  //   financial_outlook  : canonical financial signals (ARR/MRR/revenue/runway/burn/cash)
  //   traction_growth    : canonical traction signals (ARR/MRR/revenue/growth/customers)
  //   market_opportunity : canonical market claims (TAM/SAM/SOM)
  //   investment_thesis  : governed executive_summary + strengths/risks
  if (!llm && governed) {
    analysis_modules.investment_thesis = {
      module_id: 'investment_thesis',
      title: MODULE_TITLES.investment_thesis,
      icon: 'Star',
      score: scoring?.overall_limited_score ?? null,
      summary: governed.executive_summary ?? '',
      key_insight: governed.executive_summary ?? '',
      strengths: governed.strengths ?? [],
      risks: governed.risks ?? [],
      deeper_analysis: null,
      confidence_score: scoring?.overall_limited_score ?? null,
    };

    // Financial outlook: canonical financial signals first; suppress if nothing computable.
    const canonicalFinancial = buildFinancialNarrativeFromCanonical(canonicalRows);
    if (canonicalFinancial) {
      analysis_modules.financial_outlook = {
        module_id: 'financial_outlook',
        title: MODULE_TITLES.financial_outlook,
        icon: 'DollarSign',
        score: null,
        summary: canonicalFinancial,
        key_insight: canonicalFinancial,
        strengths: [],
        // Surface governed risk bullets that mention financial themes.
        risks: (governed.risks ?? []).filter((r) => /financ|revenue|burn|cash|raise/i.test(r)),
        deeper_analysis: null,
        confidence_score: null,
      };
    }

    // Traction: canonical traction signals first; suppress if nothing computable.
    const canonicalTractionFb = buildTractionNarrativeFromCanonical(canonicalRows);
    if (canonicalTractionFb) {
      analysis_modules.traction_growth = {
        module_id: 'traction_growth',
        title: MODULE_TITLES.traction_growth,
        icon: 'TrendingUp',
        score: scoring?.traction_signal_score ?? null,
        summary: canonicalTractionFb,
        key_insight: canonicalTractionFb,
        strengths: [],
        risks: [],
        deeper_analysis: null,
        confidence_score: scoring?.traction_signal_score ?? null,
      };
    }

    // Market: canonical market claims first; suppress if nothing computable.
    const canonicalMarketFb = buildMarketNarrativeFromCanonical(canonicalRows);
    if (canonicalMarketFb) {
      analysis_modules.market_opportunity = {
        module_id: 'market_opportunity',
        title: MODULE_TITLES.market_opportunity,
        icon: 'Globe',
        score: scoring?.market_presence_score ?? null,
        summary: canonicalMarketFb,
        key_insight: canonicalMarketFb,
        strengths: [],
        risks: [],
        deeper_analysis: null,
        confidence_score: scoring?.market_presence_score ?? null,
      };
    }
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
    critical_metrics: {
      financial: {
        current_arr: getCanonical('traction_signal', 'arr_value'),
        yoy_growth: getCanonical('traction_signal', 'growth_rate'),
        runway_months: getCanonical('financial_health', 'runway_months'),
      },
      product: {},
      market: {
        tam: getCanonical('market_claims', 'tam_value'),
        market_cagr: getCanonical('market_claims', 'market_cagr'),
      },
    },
    evidence_base: null,
    completeness_class: classifyReportCompleteness(report),
  };
}
