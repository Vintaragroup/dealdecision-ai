/**
 * Financial Health Calculator v1.0.0
 * 
 * Calculate runway, burn multiple, overall health score
 * Deterministic financial analysis
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { FinancialHealthInput, FinancialHealthResult } from "../types/dio";

// ============================================================================
// Financial Health Thresholds
// ============================================================================

const HEALTH_THRESHOLDS = {
  runway_months: {
    critical: 6,     // Less than 6 months - urgent
    warning: 12,     // 6-12 months - should be raising
    healthy: 18,     // 12-18 months - good
    excellent: 24    // 18+ months - excellent
  },
  
  burn_multiple: {
    excellent: 1.0,  // $1 burned per $1 of new ARR
    good: 1.5,
    acceptable: 2.0,
    poor: 3.0        // $3 burned per $1 of new ARR
  },
  
  gross_margin: {
    poor: 50,
    acceptable: 65,
    good: 75,
    excellent: 85
  }
};

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class FinancialHealthCalculator extends BaseAnalyzer<FinancialHealthInput, FinancialHealthResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "financial_health_calculator",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - runway, burn multiple, health score calculations"
  };

  /**
   * Analyze financial health
   * DETERMINISTIC - pure calculations
   */
  async analyze(input: FinancialHealthInput): Promise<FinancialHealthResult> {
    const executed_at = new Date().toISOString();

    if (
      input.revenue === undefined &&
      input.expenses === undefined &&
      input.cash_balance === undefined &&
      input.burn_rate === undefined &&
      input.growth_rate === undefined
    ) {
      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "insufficient_data",
        coverage: 0,
        confidence: 0.3,

        runway_months: null,
        burn_multiple: null,
        health_score: null,
        metrics: {
          revenue: null,
          expenses: null,
          cash_balance: null,
          burn_rate: null,
          growth_rate: null,
        },
        risks: [],
        evidence_ids: input.evidence_ids || [],
      };
    }

    try {
      const start = Date.now();

      // Calculate runway
      const runway_months = this.calculateRunway(
        input.cash_balance || 0,
        input.burn_rate || 0
      );

      // Calculate burn multiple (not available from current input schema)
      const burn_multiple = null;

      // Calculate monthly growth rate
      const monthly_growth_rate = input.growth_rate || null;

      // Calculate health score
      const health_score = this.calculateHealthScore(
        runway_months,
        burn_multiple,
        undefined, // gross_margin not in schema
        monthly_growth_rate
      );

      // Generate financial risks
      const risks = this.generateFinancialRisks(
        runway_months,
        burn_multiple,
        input,
        input.evidence_ids || []
      );

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "ok",
        coverage: 0.8,
        confidence: 0.75,

        runway_months,
        burn_multiple,
        health_score,
        metrics: {
          revenue: input.revenue || null,
          expenses: input.expenses || null,
          cash_balance: input.cash_balance || null,
          burn_rate: input.burn_rate || null,
          growth_rate: input.growth_rate || null,
        },
        risks,
        evidence_ids: input.evidence_ids || [],
      };
    } catch {
      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "extraction_failed",
        coverage: 0,
        confidence: 0.2,

        runway_months: null,
        burn_multiple: null,
        health_score: null,
        metrics: {
          revenue: null,
          expenses: null,
          cash_balance: null,
          burn_rate: null,
          growth_rate: null,
        },
        risks: [],
        evidence_ids: input.evidence_ids || [],
      };
    }
  }

  /**
   * Validate input
   */
  validateInput(input: FinancialHealthInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (input.cash_balance !== undefined && input.cash_balance < 0) {
      errors.push("cash_balance must be non-negative");
    }

    if (input.burn_rate !== undefined && input.burn_rate < 0) {
      errors.push("burn_rate must be non-negative");
    }

    if (!input.revenue && !input.cash_balance) {
      warnings.push("Limited financial data provided");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Calculate runway in months
   */
  private calculateRunway(cash_balance: number, monthly_burn: number): number {
    if (monthly_burn === 0) {
      return 999; // Infinite runway (profitable or break-even)
    }
    
    return Math.round((cash_balance / monthly_burn) * 10) / 10; // 1 decimal
  }

  /**
   * Calculate burn multiple
   * Burn Multiple = Net Burn / Net New ARR
   */
  private calculateBurnMultiple(
    monthly_burn: number,
    new_arr_monthly: number | undefined
  ): number | null {
    if (!new_arr_monthly || new_arr_monthly === 0) {
      return null; // Cannot calculate without growth
    }

    const burn_multiple = monthly_burn / new_arr_monthly;
    return Math.round(burn_multiple * 100) / 100; // 2 decimals
  }

  /**
   * Calculate monthly growth rate
   */
  private calculateGrowthRate(
    current_mrr: number | undefined,
    previous_mrr: number | undefined
  ): number | null {
    if (!current_mrr || !previous_mrr || previous_mrr === 0) {
      return null;
    }

    const growth_rate = ((current_mrr - previous_mrr) / previous_mrr) * 100;
    return Math.round(growth_rate * 10) / 10; // 1 decimal
  }

  /**
   * Calculate overall health score (0-100)
   */
  private calculateHealthScore(
    runway_months: number,
    burn_multiple: number | null,
    gross_margin: number | undefined,
    growth_rate: number | null
  ): number {
    let score = 0;
    let weight_sum = 0;

    // Runway score (40 points max)
    const runway_weight = 0.4;
    weight_sum += runway_weight;
    
    if (runway_months >= HEALTH_THRESHOLDS.runway_months.excellent) {
      score += 40;
    } else if (runway_months >= HEALTH_THRESHOLDS.runway_months.healthy) {
      score += 30;
    } else if (runway_months >= HEALTH_THRESHOLDS.runway_months.warning) {
      score += 20;
    } else if (runway_months >= HEALTH_THRESHOLDS.runway_months.critical) {
      score += 10;
    } else {
      score += 0; // Critical
    }

    // Burn multiple score (30 points max)
    if (burn_multiple !== null) {
      const burn_weight = 0.3;
      weight_sum += burn_weight;
      
      if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.excellent) {
        score += 30;
      } else if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.good) {
        score += 22;
      } else if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.acceptable) {
        score += 15;
      } else if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.poor) {
        score += 8;
      } else {
        score += 0;
      }
    }

    // Gross margin score (20 points max)
    if (gross_margin !== undefined) {
      const margin_weight = 0.2;
      weight_sum += margin_weight;
      
      if (gross_margin >= HEALTH_THRESHOLDS.gross_margin.excellent) {
        score += 20;
      } else if (gross_margin >= HEALTH_THRESHOLDS.gross_margin.good) {
        score += 15;
      } else if (gross_margin >= HEALTH_THRESHOLDS.gross_margin.acceptable) {
        score += 10;
      } else if (gross_margin >= HEALTH_THRESHOLDS.gross_margin.poor) {
        score += 5;
      } else {
        score += 0;
      }
    }

    // Growth rate bonus (10 points max)
    if (growth_rate !== null) {
      const growth_weight = 0.1;
      weight_sum += growth_weight;
      
      if (growth_rate >= 20) {
        score += 10; // Excellent growth
      } else if (growth_rate >= 10) {
        score += 7;
      } else if (growth_rate >= 5) {
        score += 5;
      } else if (growth_rate >= 0) {
        score += 2;
      } else {
        score += 0; // Negative growth
      }
    }

    // Return score (already 0-100 scale)
    return Math.round(score);
  }

  /**
   * Assess burn efficiency
   */
  private assessBurnEfficiency(
    burn_multiple: number | null,
    growth_rate: number | null
  ): "excellent" | "good" | "acceptable" | "poor" | "unknown" {
    if (burn_multiple === null) {
      return "unknown";
    }

    // Excellent: Low burn multiple with growth
    if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.excellent) {
      return "excellent";
    }
    
    // Good: Moderate burn with good growth
    if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.good) {
      if (growth_rate !== null && growth_rate >= 10) {
        return "good";
      }
      return "acceptable";
    }
    
    // Acceptable: Higher burn but still reasonable
    if (burn_multiple <= HEALTH_THRESHOLDS.burn_multiple.acceptable) {
      return "acceptable";
    }
    
    // Poor: High burn
    return "poor";
  }

  /**
   * Generate insights
   */
  private generateInsights(
    runway_months: number,
    burn_multiple: number | null,
    health_score: number,
    burn_efficiency: string,
    input: FinancialHealthInput
  ): string[] {
    const insights: string[] = [];

    // Runway insights
    if (runway_months >= HEALTH_THRESHOLDS.runway_months.excellent) {
      insights.push(`Excellent runway: ${runway_months} months of cash`);
    } else if (runway_months >= HEALTH_THRESHOLDS.runway_months.healthy) {
      insights.push(`Healthy runway: ${runway_months} months of cash`);
    } else if (runway_months >= HEALTH_THRESHOLDS.runway_months.warning) {
      insights.push(`⚠ Warning: Only ${runway_months} months runway - should be raising`);
    } else if (runway_months >= HEALTH_THRESHOLDS.runway_months.critical) {
      insights.push(`🚨 Critical: Only ${runway_months} months runway - urgent fundraising needed`);
    } else {
      insights.push(`🚨 CRITICAL: Less than ${HEALTH_THRESHOLDS.runway_months.critical} months runway!`);
    }

    // Burn multiple insights
    if (burn_multiple !== null) {
      if (burn_efficiency === "excellent") {
        insights.push(`Excellent burn efficiency: $${burn_multiple.toFixed(2)} per $1 new ARR`);
      } else if (burn_efficiency === "good") {
        insights.push(`Good burn efficiency: $${burn_multiple.toFixed(2)} per $1 new ARR`);
      } else if (burn_efficiency === "acceptable") {
        insights.push(`Acceptable burn efficiency: $${burn_multiple.toFixed(2)} per $1 new ARR`);
      } else if (burn_efficiency === "poor") {
        insights.push(`⚠ Poor burn efficiency: $${burn_multiple.toFixed(2)} per $1 new ARR - need to improve`);
      }
    } else {
      insights.push("Cannot calculate burn multiple - missing growth data");
    }

    // Overall health
    if (health_score >= 80) {
      insights.push("✓ Strong financial health overall");
    } else if (health_score >= 60) {
      insights.push("Moderate financial health - some areas need attention");
    } else {
      insights.push("⚠ Financial health needs improvement");
    }

    return insights;
  }

  /**
   * Generate financial risks based on calculations
   */
  private generateFinancialRisks(
    runway_months: number,
    burn_multiple: number | null,
    input: FinancialHealthInput,
    evidence_ids: string[]
  ): Array<{
    category: "runway" | "burn" | "growth" | "unit_economics";
    severity: "critical" | "high" | "medium" | "low";
    description: string;
    evidence_id: string;
  }> {
    const risks: Array<{
      category: "runway" | "burn" | "growth" | "unit_economics";
      severity: "critical" | "high" | "medium" | "low";
      description: string;
      evidence_id: string;
    }> = [];
    
    const default_evidence_id = evidence_ids[0] || "00000000-0000-0000-0000-000000000000";

    // Runway risks
    if (runway_months < HEALTH_THRESHOLDS.runway_months.critical) {
      risks.push({
        category: "runway",
        severity: "critical",
        description: `Critical runway: only ${runway_months} months of cash remaining`,
        evidence_id: default_evidence_id,
      });
    } else if (runway_months < HEALTH_THRESHOLDS.runway_months.warning) {
      risks.push({
        category: "runway",
        severity: "high",
        description: `Short runway: ${runway_months} months - should be raising soon`,
        evidence_id: default_evidence_id,
      });
    }

    // Burn multiple risks
    if (burn_multiple !== null) {
      if (burn_multiple > HEALTH_THRESHOLDS.burn_multiple.poor) {
        risks.push({
          category: "burn",
          severity: "high",
          description: `High burn multiple: $${burn_multiple.toFixed(2)} per $1 new ARR`,
          evidence_id: default_evidence_id,
        });
      } else if (burn_multiple > HEALTH_THRESHOLDS.burn_multiple.acceptable) {
        risks.push({
          category: "burn",
          severity: "medium",
          description: `Elevated burn multiple: $${burn_multiple.toFixed(2)} per $1 new ARR`,
          evidence_id: default_evidence_id,
        });
      }
    }

    return risks;
  }
}

// Export singleton instance
export const financialHealthCalculator = new FinancialHealthCalculator();
