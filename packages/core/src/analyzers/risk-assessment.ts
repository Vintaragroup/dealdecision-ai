/**
 * Risk Assessment Engine v1.0.0
 * 
 * Multi-category risk detection with severity mapping
 * Text-based risk detection from pitch content
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { RiskAssessmentInput, RiskAssessmentResult, Risk } from "../types/dio";

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
    const detected_risks = this.detectRisks(input);
    const overall_risk_score = this.calculateRiskScore(detected_risks);
    const risks_by_category = this.groupByCategory(detected_risks);
    const critical_count = detected_risks.filter(r => r.severity === "critical").length;
    const high_count = detected_risks.filter(r => r.severity === "high").length;

    return {
      analyzer_version: this.metadata.version,
      executed_at: new Date().toISOString(),

      status: "ok",
      coverage: 0.8,
      confidence: 0.75,

      overall_risk_score,
      risks_by_category,
      total_risks: detected_risks.length,
      critical_count,
      high_count,
      evidence_ids: input.evidence_ids || [],
    };
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
