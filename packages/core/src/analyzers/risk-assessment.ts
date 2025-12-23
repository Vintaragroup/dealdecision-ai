/**
 * Risk Assessment Engine v1.0.0
 * 
 * Multi-category risk detection with severity mapping
 * Text-based risk detection from pitch content
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import { buildRulesFromBaseAndDeltas } from "./debug-scoring";
import type { DebugScoringTrace, RiskAssessmentInput, RiskAssessmentResult, Risk } from "../types/dio";

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class RiskAssessmentEngine extends BaseAnalyzer<RiskAssessmentInput, RiskAssessmentResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "risk_assessment_engine",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - text-based risk detection"
  };

  /**
   * Analyze risks from pitch text and metrics
   */
  async analyze(input: RiskAssessmentInput): Promise<RiskAssessmentResult> {
    const executed_at = new Date().toISOString();

    const debugEnabled = Boolean((input as any).debug_scoring);

    if (!input.pitch_text || input.pitch_text.length < 10) {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["pitch_text"],
            exclusion_reason: "missing_pitch_text",
            input_summary: {
              completeness: { score: 0, notes: ["pitch_text missing/too short"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            rules: [{ rule_id: "excluded", description: "Excluded: pitch_text missing/too short", delta: 0, running_total: 0 }],
            final: { score: null, formula: "N/A (insufficient input)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "insufficient_data",
        coverage: 0,
        confidence: 0.3,

        overall_risk_score: null,
        risks_by_category: {
          market: [],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    try {
      const detected_risks = this.detectRisks(input);
      const risk_note = "No explicit risk signals detected; using neutral baseline=50";
      const overall_risk_score = detected_risks.length === 0 ? 50 : this.calculateRiskScore(detected_risks);
      const risks_by_category = this.groupByCategory(detected_risks);
      const critical_count = detected_risks.filter(r => r.severity === "critical").length;
      const high_count = detected_risks.filter(r => r.severity === "high").length;

      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? (() => {
            const severityPoints: Record<string, number> = {
              critical: 100,
              high: 70,
              medium: 40,
              low: 20,
            };

            const signals = [
              { key: "pitch_text_length", value: input.pitch_text.length },
              { key: "risks_detected", value: detected_risks.length },
              { key: "critical_count", value: critical_count },
              { key: "high_count", value: high_count },
            ];

            const penalties = detected_risks.slice(0, 10).map((r) => ({
              key: `risk:${r.category}:${r.severity}`,
              points: severityPoints[r.severity] ?? 0,
              note: r.description,
            }));

            const rules: NonNullable<DebugScoringTrace["rules"]> = (() => {
              // Mirror actual scoring:
              // - if no risks: baseline=50
              // - else: score = round(mean(severity_points)) clamped to 100
              if (detected_risks.length === 0) {
                return buildRulesFromBaseAndDeltas({
                  base: 50,
                  base_rule_id: "baseline",
                  base_description: "Neutral baseline when no explicit risks detected",
                  final_score: overall_risk_score,
                  clamp_range: { min: 0, max: 100 },
                });
              }

              const severity_weights = {
                critical: 100,
                high: 70,
                medium: 40,
                low: 20,
              } as const;

              const out: NonNullable<DebugScoringTrace["rules"]> = [];
              let running = 0;
              out.push({ rule_id: "base", description: "Start total severity points", delta: 0, running_total: running });

              for (const r of detected_risks) {
                const pts = (severity_weights as any)[r.severity] ?? 0;
                running += pts;
                out.push({
                  rule_id: `risk:${r.risk_id}`,
                  description: `${r.category}/${r.severity}: ${r.description}`,
                  delta: pts,
                  running_total: running,
                });
              }

              const avg = detected_risks.length > 0 ? running / detected_risks.length : 0;
              const deltaToAvg = avg - running;
              running = avg;
              out.push({
                rule_id: "average",
                description: `Average severity points = total / ${detected_risks.length}`,
                delta: deltaToAvg,
                running_total: running,
              });

              const final = Math.min(100, Math.round(avg));
              const deltaToFinal = final - running;
              if (Math.abs(deltaToFinal) > 1e-9) {
                running = final;
                out.push({
                  rule_id: "final_adjust",
                  description: "Final adjustment (rounding/clamp)",
                  delta: deltaToFinal,
                  running_total: running,
                });
              }

              return out;
            })();

            const completenessNotes: string[] = [];
            completenessNotes.push(input.pitch_text.length >= 10 ? "pitch_text present" : "pitch_text short");
            if (Array.isArray(input.headings) && input.headings.length > 0) completenessNotes.push("headings present");
            if (input.metrics && Object.keys(input.metrics).length > 0) completenessNotes.push("metrics present");

            return {
              inputs_used: ["pitch_text", "headings", "metrics", "team_size", "evidence_ids"],
              exclusion_reason: null,
              input_summary: {
                completeness: {
                  score: Math.min(1, (input.pitch_text.length >= 10 ? 0.6 : 0) + (Array.isArray(input.headings) && input.headings.length > 0 ? 0.2 : 0) + (input.metrics && Object.keys(input.metrics).length > 0 ? 0.2 : 0)),
                  notes: completenessNotes,
                },
                signals_count: signals.length + penalties.length,
              },
              signals,
              penalties,
              bonuses: detected_risks.length === 0 ? [{ key: "no_signal_baseline", points: 50, note: risk_note }] : [],
              rules,
              final: {
                score: overall_risk_score,
                formula: detected_risks.length === 0
                  ? "baseline risk score = 50 when no explicit risks detected"
                  : "risk_score = round(mean(severity_points)) where critical=100 high=70 medium=40 low=20",
              },
            };
          })()
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "ok",
        coverage: 0.8,
        confidence: 0.75,

        overall_risk_score,
        risks_by_category,
        total_risks: detected_risks.length,
        critical_count,
        high_count,
        note: detected_risks.length === 0 ? risk_note : undefined,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    } catch {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["pitch_text", "headings", "metrics", "team_size", "evidence_ids"],
            exclusion_reason: "extraction_failed",
            input_summary: {
              completeness: { score: 0.5, notes: ["exception during analysis"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            rules: [{ rule_id: "excluded", description: "Excluded: extraction_failed", delta: 0, running_total: 0 }],
            final: { score: null, formula: "N/A (extraction_failed)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "extraction_failed",
        coverage: 0,
        confidence: 0.2,

        overall_risk_score: null,
        risks_by_category: {
          market: [],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }
  }

  /**
   * Validate input
   */
  validateInput(input: RiskAssessmentInput): ValidationResult {
    const errors: string[] = [];
    if (!input.pitch_text || input.pitch_text.length < 10) {
      errors.push("pitch_text required and must be at least 10 characters");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Detect risks from text analysis and metrics
   */
  private detectRisks(input: RiskAssessmentInput): Risk[] {
    const risks: Risk[] = [];
    const default_evidence_id = input.evidence_ids?.[0] || "00000000-0000-0000-0000-000000000000";
    const text_lower = input.pitch_text.toLowerCase();

    // Team risks
    if (input.team_size !== undefined && input.team_size < 3) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "team",
        severity: "medium",
        description: "Small team size - may struggle with execution at scale",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("looking for") && text_lower.includes("cto")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "team",
        severity: "high",
        description: "Key technical role unfilled - CTO position vacant",
        evidence_id: default_evidence_id,
      });
    }

    // Market risks
    if (text_lower.includes("crowded market") || text_lower.includes("many competitors")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "market",
        severity: "medium",
        description: "Competitive market landscape mentioned",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("niche") && !text_lower.includes("large")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "market",
        severity: "low",
        description: "Niche market - may limit growth potential",
        evidence_id: default_evidence_id,
      });
    }

    // Financial risks
    if (input.metrics?.runway !== undefined && input.metrics.runway < 6) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "financial",
        severity: "critical",
        description: `Critical runway - only ${input.metrics.runway} months remaining`,
        evidence_id: default_evidence_id,
      });
    }

    if (input.metrics?.burn_rate !== undefined && input.metrics.burn_rate > 100000) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "financial",
        severity: "high",
        description: "High burn rate detected",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("pre-revenue") || text_lower.includes("no revenue")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "financial",
        severity: "medium",
        description: "Pre-revenue stage - monetization unproven",
        evidence_id: default_evidence_id,
      });
    }

    // Execution risks
    if (text_lower.includes("mvp") || text_lower.includes("prototype")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "execution",
        severity: "medium",
        description: "Early product stage - significant development ahead",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("regulatory") || text_lower.includes("compliance")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "execution",
        severity: "high",
        description: "Regulatory requirements - approval timeline uncertain",
        evidence_id: default_evidence_id,
      });
    }

    return risks;
  }

  /**
   * Generate unique risk ID
   */
  private generateRiskId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Calculate overall risk score (0-100, higher = more risk)
   */
  private calculateRiskScore(risks: Risk[]): number {
    if (risks.length === 0) return 0;

    const severity_weights = {
      critical: 100,
      high: 70,
      medium: 40,
      low: 20
    };

    const total = risks.reduce((sum, risk) => {
      return sum + (severity_weights[risk.severity] || 0);
    }, 0);

    const avg_score = total / risks.length;
    return Math.min(100, Math.round(avg_score));
  }

  /**
   * Group risks by category (all categories must be present)
   */
  private groupByCategory(risks: Risk[]): {
    market: Risk[];
    team: Risk[];
    financial: Risk[];
    execution: Risk[];
  } {
    const grouped = {
      market: [] as Risk[],
      team: [] as Risk[],
      financial: [] as Risk[],
      execution: [] as Risk[],
    };

    for (const risk of risks) {
      grouped[risk.category].push(risk);
    }

    return grouped;
  }
}

// Export singleton instance
export const riskAssessmentEngine = new RiskAssessmentEngine();
