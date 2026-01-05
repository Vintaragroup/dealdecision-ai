/**
 * Simple DIO to ReportDTO compiler
 * Works with actual DIO schema v1.0.0
 */

import type { DealIntelligenceObject } from '../types/dio.js';
import { buildScoreExplanationFromDIO } from './score-explanation.js';

// Import ReportDTO types directly from contracts
type ReportDTO = {
  dealId: string;
  generatedAt: string;
  version: number;
  overallScore: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' | 'Insufficient Information';
  recommendation: 'strong_yes' | 'yes' | 'consider' | 'pass';
  categories: Array<{
    name: string;
    score: number;
    maxScore?: number;
    color?: string;
    issues: string[];
    strengths: string[];
    recommendations: string[];
  }>;
  redFlags: Array<{ severity: 'high' | 'medium' | 'low'; message: string; action: string }>;
  greenFlags: string[];
  sections: ReportSection[];
  completeness: number;
  metadata?: Record<string, any>;
};

type ReportSection = {
  id: string;
  title: string;
  content: string;
  evidence_ids?: string[];
  metrics?: Array<{
    label: string;
    value: number;
    evidence_ids?: string[];
  }>;
};

type DIO = DealIntelligenceObject;

function formatWhyThisScore(debug_scoring: any): string {
  if (!debug_scoring || !Array.isArray(debug_scoring.rules) || debug_scoring.rules.length === 0) return "";

  const inputs = Array.isArray(debug_scoring.inputs_used) ? debug_scoring.inputs_used.filter((x: any) => typeof x === "string") : [];
  const exclusion = typeof debug_scoring.exclusion_reason === "string" ? debug_scoring.exclusion_reason : null;

  const maxRules = 15;
  const rules = debug_scoring.rules.slice(0, maxRules);
  const ruleLines = rules
    .map((r: any) => {
      const id = typeof r?.rule_id === "string" ? r.rule_id : "rule";
      const desc = typeof r?.description === "string" ? r.description : "";
      const delta = typeof r?.delta === "number" ? r.delta : 0;
      const running = typeof r?.running_total === "number" ? r.running_total : 0;
      return `• ${id}: ${desc} (Δ ${delta}, total ${running})`;
    })
    .join("\n");

  const truncated = debug_scoring.rules.length > maxRules
    ? `\n• … (${debug_scoring.rules.length - maxRules} more rules omitted)`
    : "";

  const inputsLine = inputs.length > 0 ? `Inputs used: ${inputs.join(", ")}` : "Inputs used: (not provided)";
  const exclusionLine = exclusion ? `Exclusion reason: ${exclusion}` : "";
  const header = "\n\nWhy this score?\n";
  const body = `${inputsLine}${exclusionLine ? `\n${exclusionLine}` : ""}\nRules:\n${ruleLines}${truncated}`;
  return header + body;
}

/**
 * Compile DIO into ReportDTO for frontend display
 */
export function compileDIOToReport(dio: DIO): ReportDTO {
  const results = dio.analyzer_results;

  const existingExplanation = (dio as any).score_explanation;
  const scoreExplanation = existingExplanation ?? buildScoreExplanationFromDIO(dio);
  const persistedOverall = (dio as any).overall_score;
  
  const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isOk = (status: unknown): status is 'ok' => status === 'ok';

  // Calculate overall score (status-aware + null-aware)
  const scores: number[] = [];

  if (isOk(results.slide_sequence?.status) && isFiniteNumber(results.slide_sequence?.score)) {
    scores.push(results.slide_sequence.score);
  }
  if (isOk(results.metric_benchmark?.status) && isFiniteNumber(results.metric_benchmark?.overall_score)) {
    scores.push(results.metric_benchmark.overall_score);
  }
  if (isOk(results.visual_design?.status) && isFiniteNumber(results.visual_design?.design_score)) {
    scores.push(results.visual_design.design_score);
  }
  if (isOk(results.narrative_arc?.status) && isFiniteNumber(results.narrative_arc?.pacing_score)) {
    scores.push(results.narrative_arc.pacing_score);
  }
  if (isOk(results.financial_health?.status) && isFiniteNumber(results.financial_health?.health_score)) {
    scores.push(results.financial_health.health_score);
  }
  if (isOk(results.risk_assessment?.status) && isFiniteNumber(results.risk_assessment?.overall_risk_score)) {
    // Invert risk score (lower risk = higher investment score)
    // If the analyzer ran but detected no explicit risks, treat it as neutral baseline (50).
    const ra = results.risk_assessment;
    const riskScore = results.risk_assessment.overall_risk_score;
    const noSignalRisk = riskScore === 0 && ra.total_risks === 0;
    scores.push(noSignalRisk ? 50 : (100 - riskScore));
  }

  const overallScoreComputed: number | null = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  const explanationOverall = (scoreExplanation as any)?.totals?.overall_score;

  const computeOverallFromExplanation = (se: any): number | null => {
    if (!se || typeof se !== 'object') return null;
    const weights = se?.aggregation?.weights && typeof se.aggregation.weights === 'object' ? se.aggregation.weights : null;
    const components = se?.components && typeof se.components === 'object' ? se.components : null;
    if (!components) return null;

    const keys = Object.keys(components);
    if (keys.length === 0) return null;

    const pairs: Array<{ key: string; w: number; eff: number }> = [];
    for (const key of keys) {
      const comp = components[key];
      if (!comp || typeof comp !== 'object') continue;
      const used = typeof comp.used_score === 'number' && Number.isFinite(comp.used_score) ? comp.used_score : null;
      const penalty = typeof comp.penalty === 'number' && Number.isFinite(comp.penalty) ? comp.penalty : 0;
      if (used == null) continue;
      const eff = Math.max(0, Math.min(100, used - penalty));
      const wRaw = weights && typeof weights[key] === 'number' && Number.isFinite(weights[key]) ? weights[key] : null;
      pairs.push({ key, w: wRaw ?? 1, eff });
    }

    if (pairs.length === 0) return null;
    const totalW = pairs.reduce((s, p) => s + p.w, 0);
    if (!(totalW > 0)) {
      const avg = pairs.reduce((s, p) => s + p.eff, 0) / pairs.length;
      return Math.round(avg);
    }
    const weighted = pairs.reduce((s, p) => s + (p.w / totalW) * p.eff, 0);
    return Math.round(weighted);
  };

  const explanationFallback = computeOverallFromExplanation(scoreExplanation);
  const overallScoreNullable: number | null = (typeof persistedOverall === 'number' && Number.isFinite(persistedOverall))
    ? persistedOverall
    : (typeof explanationOverall === 'number' && Number.isFinite(explanationOverall))
      ? explanationOverall
      : (typeof explanationFallback === 'number' && Number.isFinite(explanationFallback))
        ? explanationFallback
        : overallScoreComputed;

  const scoreAvailable = typeof overallScoreNullable === 'number' && Number.isFinite(overallScoreNullable);
  const overallScoreFinal = scoreAvailable ? Math.round(overallScoreNullable) : 0;

  const includedCount = scoreExplanation && (scoreExplanation as any).components
    ? Object.values((scoreExplanation as any).components)
      .filter((c: any) => c && typeof c === 'object' && c.status === 'ok')
      .length
    : scores.length;

  let grade: ReportDTO['grade'] = scoreAvailable ? scoreToGrade(overallScoreFinal) : 'Needs Improvement';
  if (includedCount < 3) {
    grade = 'Insufficient Information';
  }
  const recommendation = scoreAvailable ? scoreToRecommendation(overallScoreFinal) : 'pass';
  
  // Extract category scores
  const categories = [];
  
  // Presentation Quality
  if (results.slide_sequence || results.visual_design) {
    const slideScore = results.slide_sequence?.score ?? null;
    const visualScore = results.visual_design?.design_score ?? null;
    const available = [slideScore, visualScore].filter((v): v is number => typeof v === 'number');
    if (available.length > 0) {
      const avgScore = Math.round(available.reduce((a, b) => a + b, 0) / available.length);
      categories.push({
        name: 'Presentation Quality',
        score: avgScore,
        maxScore: 100,
        color: '#3b82f6',
        issues: results.visual_design?.weaknesses || [],
        strengths: results.visual_design?.strengths || [],
        recommendations: []
      });
    }
  }
  
  // Business Metrics
  if (results.metric_benchmark?.overall_score != null) {
    categories.push({
      name: 'Business Metrics',
      score: Math.round(results.metric_benchmark.overall_score),
      maxScore: 100,
      color: '#8b5cf6',
      issues: [],
      strengths: [],
      recommendations: []
    });
  }
  
  // Narrative Quality
  if (results.narrative_arc?.pacing_score != null) {
    categories.push({
      name: 'Narrative & Story',
      score: Math.round(results.narrative_arc.pacing_score),
      maxScore: 100,
      color: '#f59e0b',
      issues: [],
      strengths: [`Story archetype: ${results.narrative_arc.archetype}`],
      recommendations: []
    });
  }
  
  // Financial Health
  if (results.financial_health?.health_score != null) {
    const risks = results.financial_health.risks || [];
    categories.push({
      name: 'Financial Health',
      score: Math.round(results.financial_health.health_score),
      maxScore: 100,
      color: '#10b981',
      issues: risks.map(r => r.description),
      strengths: results.financial_health.runway_months 
        ? [`Runway: ${results.financial_health.runway_months} months`]
        : [],
      recommendations: []
    });
  }
  
  // Risk Assessment
  if (results.risk_assessment?.overall_risk_score != null) {
    const allRisks = [
      ...(results.risk_assessment.risks_by_category?.market || []),
      ...(results.risk_assessment.risks_by_category?.team || []),
      ...(results.risk_assessment.risks_by_category?.financial || []),
      ...(results.risk_assessment.risks_by_category?.execution || []),
    ];
    
    const investmentScore = 100 - results.risk_assessment.overall_risk_score;
    
    categories.push({
      name: 'Risk Assessment',
      score: Math.round(investmentScore),
      maxScore: 100,
      color: '#ef4444',
      issues: allRisks.map(r => `[${r.severity}] ${r.description}`),
      strengths: [],
      recommendations: allRisks.filter(r => r.mitigation).map(r => r.mitigation!)
    });
  }
  
  // Identify red flags
  const redFlags: Array<{ severity: 'high' | 'medium' | 'low'; message: string; action: string }> = [];
  if (results.risk_assessment) {
    const allRisks = [
      ...(results.risk_assessment.risks_by_category?.market || []),
      ...(results.risk_assessment.risks_by_category?.team || []),
      ...(results.risk_assessment.risks_by_category?.financial || []),
      ...(results.risk_assessment.risks_by_category?.execution || []),
    ];
    
    for (const risk of allRisks) {
      const severity: 'high' | 'medium' | 'low' = 
        risk.severity === 'critical' || risk.severity === 'high' ? 'high' :
        risk.severity === 'medium' ? 'medium' : 'low';
      
      redFlags.push({
        severity,
        message: risk.description,
        action: risk.mitigation || 'Monitor closely'
      });
    }
  }
  
  // Identify green flags (strengths)
  const greenFlags: string[] = [];
  if (results.visual_design?.strengths) {
    greenFlags.push(...results.visual_design.strengths);
  }
  if (results.metric_benchmark) {
    const strong = results.metric_benchmark.metrics_analyzed.filter(m => m.rating === 'Strong');
    if (strong.length > 0) {
      greenFlags.push(`${strong.length} strong business metrics`);
    }
  }
  
  // Build report sections
  const sections: ReportSection[] = [];
  
  // Executive Summary
  const overallScoreText = scoreAvailable ? `${overallScoreFinal}/100 (${grade})` : 'N/A (insufficient data)';
  sections.push({
    id: 'executive-summary',
    title: 'Executive Summary',
    content: `Overall Score: ${overallScoreText}\\n\\nRecommendation: ${recommendation.replace('_', ' ').toUpperCase()}\\n\\nBased on analysis of ${scores.length} evaluation dimensions.`,
    evidence_ids: []
  });
  
  // Detailed sections for each analyzer
  if (results.slide_sequence) {
    const deviations = results.slide_sequence.deviations || [];
    const seqScoreText = results.slide_sequence.score == null ? 'N/A' : `${results.slide_sequence.score}/100`;
    sections.push({
      id: 'slide-sequence',
      title: 'Presentation Structure',
      content: `Score: ${seqScoreText}\n\nPattern: ${results.slide_sequence.pattern_match}\n\n` +
        (deviations.length > 0 
          ? `Deviations:\\n${deviations.map(d => `• ${d.actual} at position ${d.position} (expected: ${d.expected})`).join('\\n')}`
          : 'Follows expected structure') +
        formatWhyThisScore((results.slide_sequence as any).debug_scoring),
      evidence_ids: results.slide_sequence.evidence_ids,
      metrics: results.slide_sequence.score == null
        ? undefined
        : [{ label: 'Sequence Score', value: results.slide_sequence.score, evidence_ids: results.slide_sequence.evidence_ids }]
    });
  }

  if (results.metric_benchmark) {
    const mb = results.metric_benchmark;
    const mbScoreText = mb.overall_score == null ? 'N/A' : `${mb.overall_score}/100`;
    const analyzed = Array.isArray(mb.metrics_analyzed) ? mb.metrics_analyzed : [];
    sections.push({
      id: 'metric-benchmark',
      title: 'Business Metrics',
      content: `Score: ${mbScoreText}\n\n` +
        (analyzed.length > 0
          ? `Metrics Analyzed:\\n${analyzed.slice(0, 8).map((m: any) => `• ${m.metric}: ${m.value} vs ${m.benchmark_value} (${m.rating})`).join('\\n')}`
          : 'No metrics analyzed') +
        formatWhyThisScore((mb as any).debug_scoring),
      evidence_ids: mb.evidence_ids,
      metrics: mb.overall_score == null
        ? undefined
        : [{ label: 'Metrics Score', value: mb.overall_score, evidence_ids: mb.evidence_ids }]
    });
  }

  if (results.visual_design) {
    const vd = results.visual_design;
    const vdScoreText = vd.design_score == null ? 'N/A' : `${vd.design_score}/100`;
    sections.push({
      id: 'visual-design',
      title: 'Visual Design',
      content: `Score: ${vdScoreText}\n\n` +
        (Array.isArray(vd.strengths) && vd.strengths.length > 0 ? `Strengths:\\n${vd.strengths.slice(0, 6).map((s: string) => `• ${s}`).join('\\n')}\\n\\n` : '') +
        (Array.isArray(vd.weaknesses) && vd.weaknesses.length > 0 ? `Weaknesses:\\n${vd.weaknesses.slice(0, 6).map((s: string) => `• ${s}`).join('\\n')}` : '') +
        formatWhyThisScore((vd as any).debug_scoring),
      evidence_ids: vd.evidence_ids,
      metrics: vd.design_score == null
        ? undefined
        : [{ label: 'Design Score', value: vd.design_score, evidence_ids: vd.evidence_ids }]
    });
  }

  if (results.narrative_arc) {
    const na = results.narrative_arc;
    const pacingText = na.pacing_score == null ? 'N/A' : `${na.pacing_score}/100`;
    sections.push({
      id: 'narrative-arc',
      title: 'Narrative & Story',
      content: `Pacing Score: ${pacingText}\n\nArchetype: ${na.archetype} (${Math.round((na.archetype_confidence ?? 0) * 100)}% confidence)\n\n` +
        (Array.isArray(na.emotional_beats) && na.emotional_beats.length > 0
          ? `Emotional Beats:\\n${na.emotional_beats.slice(0, 8).map((b: any) => `• ${b.section}: ${b.emotion} (${Math.round((b.strength ?? 0) * 100)}%)`).join('\\n')}`
          : 'No emotional beats detected') +
        formatWhyThisScore((na as any).debug_scoring),
      evidence_ids: na.evidence_ids,
      metrics: na.pacing_score == null
        ? undefined
        : [{ label: 'Pacing Score', value: na.pacing_score, evidence_ids: na.evidence_ids }]
    });
  }
  
  if (results.financial_health) {
    const fh = results.financial_health;
    const healthScoreText = fh.health_score == null ? 'N/A' : `${fh.health_score}/100`;
    sections.push({
      id: 'financial-health',
      title: 'Financial Health',
      content: `Health Score: ${healthScoreText}\n\n` +
        (fh.runway_months ? `Runway: ${fh.runway_months} months\\n` : '') +
        (fh.burn_multiple ? `Burn Multiple: ${fh.burn_multiple.toFixed(2)}x\\n` : '') +
        (fh.risks.length > 0 
          ? `\\nRisks:\\n${fh.risks.map(r => `• [${r.severity}] ${r.description}`).join('\\n')}`
          : '') +
        formatWhyThisScore((fh as any).debug_scoring),
      evidence_ids: fh.evidence_ids,
      metrics: fh.health_score == null
        ? undefined
        : [{ label: 'Health Score', value: fh.health_score, evidence_ids: fh.evidence_ids }]
    });
  }
  
  if (results.risk_assessment) {
    const ra = results.risk_assessment;
    const allRisks = [
      ...ra.risks_by_category.market,
      ...ra.risks_by_category.team,
      ...ra.risks_by_category.financial,
      ...ra.risks_by_category.execution,
    ];
    const riskScoreText = ra.overall_risk_score == null ? 'N/A' : `${ra.overall_risk_score}/100`;
    
    sections.push({
      id: 'risk-assessment',
      title: 'Risk Assessment',
      content: `Risk Score: ${riskScoreText}\n` +
        `Total Risks: ${ra.total_risks} (Critical: ${ra.critical_count}, High: ${ra.high_count})\\n\\n` +
        `Risks by Category:\\n` +
        `• Market: ${ra.risks_by_category.market.length}\\n` +
        `• Team: ${ra.risks_by_category.team.length}\\n` +
        `• Financial: ${ra.risks_by_category.financial.length}\\n` +
        `• Execution: ${ra.risks_by_category.execution.length}\\n\\n` +
        `Top Risks:\\n${allRisks.slice(0, 5).map(r => `• [${r.severity}] ${r.description}`).join('\\n')}` +
        formatWhyThisScore((ra as any).debug_scoring),
      evidence_ids: ra.evidence_ids,
      metrics: ra.overall_risk_score == null
        ? undefined
        : [{ label: 'Risk Score', value: ra.overall_risk_score, evidence_ids: ra.evidence_ids }]
    });
  }
  
  // Recommendation
  sections.push({
    id: 'recommendation',
    title: 'Investment Recommendation',
    content: `Recommendation: ${recommendation.replace('_', ' ').toUpperCase()}\\n\\n` +
      `Overall Score: ${scoreAvailable ? `${overallScoreFinal}/100` : 'N/A'}\\n` +
      `Grade: ${grade}\\n\\n` +
      (greenFlags.length > 0 ? `Strengths:\\n${greenFlags.map(f => `• ${f}`).join('\\n')}\\n\\n` : '') +
      (redFlags.length > 0 ? `Concerns:\\n${redFlags.slice(0, 3).map(f => `• ${f.message}`).join('\\n')}` : ''),
    evidence_ids: []
  });
  
  return {
    dealId: dio.deal_id,
    generatedAt: new Date().toISOString(),
    version: dio.analysis_version,
    
    overallScore: overallScoreFinal,
    grade,
    recommendation,
    
    categories,
    redFlags,
    greenFlags,
    
    sections,
    
    completeness: calculateCompleteness(dio),
    metadata: {
      analysisCount: scores.length,
      evidenceCount: dio.inputs.evidence.length,
      documentCount: dio.inputs.documents.length,
      scoreAvailable,
      scoreConfidence: scoreExplanation?.totals?.confidence_score,
      score_explanation: scoreExplanation,
    }
  };
}

/**
 * Helper functions
 */

function scoreToGrade(score: number): 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Needs Improvement';
}

function scoreToRecommendation(score: number): 'strong_yes' | 'yes' | 'consider' | 'pass' {
  if (score >= 85) return 'strong_yes';
  if (score >= 70) return 'yes';
  if (score >= 55) return 'consider';
  return 'pass';
}

function calculateCompleteness(dio: DIO): number {
  const results = dio.analyzer_results;
  let fieldsPresent = 0;
  const totalFields = 6;
  
  if (results.slide_sequence) fieldsPresent++;
  if (results.metric_benchmark) fieldsPresent++;
  if (results.visual_design) fieldsPresent++;
  if (results.narrative_arc) fieldsPresent++;
  if (results.financial_health) fieldsPresent++;
  if (results.risk_assessment) fieldsPresent++;
  
  return Math.round((fieldsPresent / totalFields) * 100);
}
