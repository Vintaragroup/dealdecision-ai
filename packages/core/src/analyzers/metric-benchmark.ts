/**
 * Metric Benchmark Validator v1.0.0
 * 
 * Extract and validate financial metrics
 * Compare against industry benchmarks
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { MetricBenchmarkInput, MetricBenchmarkResult } from "../types/dio";

// ============================================================================
// Industry Benchmarks
// ============================================================================

/**
 * SaaS benchmarks (from OpenView, SaaS Capital)
 */
const SAAS_BENCHMARKS = {
  growth_rate: {
    seed: { min: 100, ideal: 200, max: 500 }, // YoY %
    series_a: { min: 100, ideal: 150, max: 300 },
    series_b: { min: 50, ideal: 100, max: 200 }
  },
  gross_margin: {
    seed: { min: 60, ideal: 75, max: 90 },
    series_a: { min: 70, ideal: 80, max: 90 },
    series_b: { min: 75, ideal: 85, max: 95 }
  },
  cac_payback_months: {
    seed: { min: 6, ideal: 12, max: 18 },
    series_a: { min: 6, ideal: 12, max: 15 },
    series_b: { min: 6, ideal: 10, max: 12 }
  },
  ltv_cac_ratio: {
    all: { min: 3, ideal: 5, max: 10 }
  },
  net_dollar_retention: {
    series_a: { min: 100, ideal: 120, max: 150 },
    series_b: { min: 110, ideal: 130, max: 160 }
  }
};

/**
 * E-commerce / CPG benchmarks
 */
const ECOMMERCE_BENCHMARKS = {
  gross_margin: {
    all: { min: 30, ideal: 50, max: 70 }
  },
  repeat_purchase_rate: {
    all: { min: 20, ideal: 40, max: 60 }
  },
  cac_payback_months: {
    all: { min: 3, ideal: 6, max: 12 }
  },
  ltv_cac_ratio: {
    all: { min: 2, ideal: 4, max: 8 }
  }
};

/**
 * Marketplace benchmarks
 */
const MARKETPLACE_BENCHMARKS = {
  take_rate: {
    all: { min: 10, ideal: 20, max: 30 }
  },
  gmv_growth: {
    seed: { min: 100, ideal: 300, max: 1000 },
    series_a: { min: 100, ideal: 200, max: 500 }
  },
  supply_side_retention: {
    all: { min: 70, ideal: 85, max: 95 }
  }
};

// ============================================================================
// Metric Extraction Patterns
// ============================================================================

const METRIC_PATTERNS = {
  // Revenue metrics
  mrr: /(?:MRR|Monthly Recurring Revenue)[:\s]*\$?([\d,]+\.?\d*)\s*([KMB]?)/i,
  arr: /(?:ARR|Annual Recurring Revenue)[:\s]*\$?([\d,]+\.?\d*)\s*([KMB]?)/i,
  revenue: /(?:Revenue|Sales)[:\s]*\$?([\d,]+\.?\d*)\s*([KMB]?)/i,
  
  // Growth metrics
  growth_rate: /(?:Growth|YoY|Year[- ]over[- ]Year)[:\s]*([\d,]+\.?\d*)%?/i,
  mom_growth: /(?:MoM|Month[- ]over[- ]Month)[:\s]*([\d,]+\.?\d*)%?/i,
  
  // Unit economics
  gross_margin: /(?:Gross Margin|GM)[:\s]*([\d,]+\.?\d*)%?/i,
  cac: /(?:CAC|Customer Acquisition Cost)[:\s]*\$?([\d,]+\.?\d*)/i,
  ltv: /(?:LTV|Lifetime Value|CLV)[:\s]*\$?([\d,]+\.?\d*)/i,
  
  // Engagement
  dau: /(?:DAU|Daily Active Users)[:\s]*([\d,]+\.?\d*)\s*([KMB]?)/i,
  mau: /(?:MAU|Monthly Active Users)[:\s]*([\d,]+\.?\d*)\s*([KMB]?)/i,
  
  // Retention
  churn: /(?:Churn|Churn Rate)[:\s]*([\d,]+\.?\d*)%?/i,
  retention: /(?:Retention|Retention Rate)[:\s]*([\d,]+\.?\d*)%?/i,
  ndr: /(?:NDR|Net Dollar Retention|NRR)[:\s]*([\d,]+\.?\d*)%?/i,
};

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class MetricBenchmarkValidator extends BaseAnalyzer<MetricBenchmarkInput, MetricBenchmarkResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "metric_benchmark_validator",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - industry benchmark validation"
  };

  /**
   * Analyze metrics
   * DETERMINISTIC - no LLM, no external calls
   */
  async analyze(input: MetricBenchmarkInput): Promise<MetricBenchmarkResult> {
    const start = Date.now();

    // Extract metrics from text
    const extracted_metrics = this.extractMetrics([input.text]);

    // Get appropriate benchmarks for industry (default to SaaS if not specified)
    const benchmarks = this.getBenchmarks(input.industry || "saas", "series_a");

    // Validate each metric
    const validations = this.validateMetrics(extracted_metrics, benchmarks, input.evidence_ids || []);

    // Calculate overall score
    const overall_score = this.calculateScore(validations);

    return {
      analyzer_version: this.metadata.version,
      executed_at: new Date().toISOString(),

      status: "ok",
      coverage: 0.8,
      confidence: 0.75,

      metrics_analyzed: validations,
      overall_score,
      evidence_ids: input.evidence_ids || [],
    };
  }

  /**
   * Validate input
   */
  validateInput(input: MetricBenchmarkInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.text || input.text.length === 0) {
      errors.push("text must be provided");
    }

    if (!input.industry) {
      warnings.push("No industry specified - using SaaS benchmarks as default");
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
   * Extract metrics from evidence text
   */
  private extractMetrics(evidence_content: string[]): Array<{
    metric_name: string;
    value: number;
    unit: string;
    source: string;
    confidence: number;
  }> {
    const metrics: Array<{
      metric_name: string;
      value: number;
      unit: string;
      source: string;
      confidence: number;
    }> = [];

    for (const content of evidence_content) {
      for (const [metric_name, pattern] of Object.entries(METRIC_PATTERNS)) {
        const match = content.match(pattern);
        if (match) {
          const value = this.parseNumber(match[1], match[2]);
          const unit = this.determineUnit(metric_name, match[2]);
          
          metrics.push({
            metric_name,
            value,
            unit,
            source: content.substring(0, 100) + "...", // First 100 chars
            confidence: 0.8 // High confidence for pattern match
          });
        }
      }
    }

    return metrics;
  }

  /**
   * Parse number with magnitude suffix (K, M, B)
   */
  private parseNumber(value: string, magnitude?: string): number {
    const num = parseFloat(value.replace(/,/g, ""));
    
    if (!magnitude) return num;
    
    const mag = magnitude.toUpperCase();
    if (mag === "K") return num * 1000;
    if (mag === "M") return num * 1000000;
    if (mag === "B") return num * 1000000000;
    
    return num;
  }

  /**
   * Determine unit for metric
   */
  private determineUnit(metric_name: string, magnitude?: string): string {
    if (["mrr", "arr", "revenue", "cac", "ltv"].includes(metric_name)) {
      return magnitude ? `$${magnitude}` : "$";
    }
    if (["growth_rate", "mom_growth", "gross_margin", "churn", "retention", "ndr"].includes(metric_name)) {
      return "%";
    }
    if (["dau", "mau"].includes(metric_name)) {
      return magnitude || "users";
    }
    return "";
  }

  /**
   * Get benchmarks for industry and stage
   */
  private getBenchmarks(industry: string, stage: string): Record<string, any> {
    const normalized_industry = industry.toLowerCase();
    const normalized_stage = stage.toLowerCase();

    // Select benchmark set
    let benchmark_set: Record<string, any> = {};
    
    if (normalized_industry.includes("saas") || normalized_industry.includes("software")) {
      benchmark_set = SAAS_BENCHMARKS;
    } else if (normalized_industry.includes("ecommerce") || normalized_industry.includes("cpg")) {
      benchmark_set = ECOMMERCE_BENCHMARKS;
    } else if (normalized_industry.includes("marketplace")) {
      benchmark_set = MARKETPLACE_BENCHMARKS;
    } else {
      // Generic benchmarks (use SaaS as default)
      benchmark_set = SAAS_BENCHMARKS;
    }

    // Get stage-specific or "all" benchmarks
    const result: Record<string, any> = {};
    for (const [metric, values] of Object.entries(benchmark_set)) {
      const stage_key = normalized_stage.includes("seed") ? "seed" :
                       normalized_stage.includes("a") ? "series_a" :
                       normalized_stage.includes("b") ? "series_b" : "all";
      
      result[metric] = (values as any)[stage_key] || (values as any)["all"] || values;
    }

    return result;
  }

  /**
   * Validate metrics against benchmarks
   */
  private validateMetrics(
    metrics: Array<{ metric_name: string; value: number; unit: string; source: string }>,
    benchmarks: Record<string, any>,
    evidence_ids: string[]
  ): Array<{
    metric: string;
    value: number;
    benchmark_value: number;
    benchmark_source: string;
    rating: "Strong" | "Adequate" | "Weak" | "Missing";
    deviation_pct: number;
    evidence_id: string;
  }> {
    const validations: Array<{
      metric: string;
      value: number;
      benchmark_value: number;
      benchmark_source: string;
      rating: "Strong" | "Adequate" | "Weak" | "Missing";
      deviation_pct: number;
      evidence_id: string;
    }> = [];
    
    const default_evidence_id = evidence_ids[0] || "00000000-0000-0000-0000-000000000000";

    for (const metric of metrics) {
      const benchmark = benchmarks[metric.metric_name];
      
      if (!benchmark) {
        validations.push({
          metric: metric.metric_name,
          value: metric.value,
          benchmark_value: 0,
          benchmark_source: "No benchmark available",
          rating: "Missing",
          deviation_pct: 0,
          evidence_id: default_evidence_id,
        });
        continue;
      }

      const { min, ideal, max } = benchmark;
      let rating: "Strong" | "Adequate" | "Weak" | "Missing" = "Weak";
      
      if (metric.value >= ideal) {
        rating = "Strong";
      } else if (metric.value >= (min + ideal) / 2) {
        rating = "Adequate";
      } else if (metric.value >= min) {
        rating = "Adequate";
      } else {
        rating = "Weak";
      }

      const deviation_pct = ((metric.value - ideal) / ideal) * 100;

      validations.push({
        metric: metric.metric_name,
        value: metric.value,
        benchmark_value: ideal,
        benchmark_source: "Industry benchmarks (SaaS/E-commerce/Marketplace)",
        rating,
        deviation_pct: Math.round(deviation_pct * 10) / 10,
        evidence_id: default_evidence_id,
      });
    }

    return validations;
  }

  /**
   * Calculate overall score (0-100)
   */
  private calculateScore(validations: Array<{ rating: "Strong" | "Adequate" | "Weak" | "Missing" }>): number {
    if (validations.length === 0) return 0;

    const rating_scores = {
      "Strong": 100,
      "Adequate": 70,
      "Weak": 40,
      "Missing": 50, // Neutral if no benchmark
    };

    const total = validations.reduce((sum, v) => {
      return sum + (rating_scores[v.rating] || 0);
    }, 0);

    return Math.round(total / validations.length);
  }

  /**
   * Generate insights
   */
  private generateInsights(
    validations: Array<{ metric_name: string; status: string; delta_from_ideal: number | null }>,
    benchmarks: Record<string, any>
  ): string[] {
    const insights: string[] = [];

    // Count by status
    const excellent = validations.filter(v => v.status === "excellent").length;
    const good = validations.filter(v => v.status === "good").length;
    const below = validations.filter(v => v.status === "below").length;

    if (excellent > 0) {
      insights.push(`${excellent} metric(s) exceed industry benchmarks`);
    }

    if (below > 0) {
      const below_metrics = validations
        .filter(v => v.status === "below")
        .map(v => v.metric_name)
        .join(", ");
      insights.push(`${below} metric(s) below benchmark: ${below_metrics}`);
    }

    if (validations.length >= 5) {
      insights.push("Comprehensive metrics coverage");
    } else if (validations.length < 3) {
      insights.push("Limited metrics - consider providing more financial data");
    }

    // Specific metric insights
    const growth = validations.find(v => v.metric_name === "growth_rate");
    if (growth && growth.delta_from_ideal !== null) {
      if (growth.delta_from_ideal > 50) {
        insights.push("Exceptional growth rate - strong momentum");
      } else if (growth.delta_from_ideal < -30) {
        insights.push("Growth rate below ideal - may need acceleration");
      }
    }

    return insights;
  }

  /**
   * Find missing critical metrics
   */
  private findMissingMetrics(
    extracted: Array<{ metric_name: string }>,
    industry: string,
    stage: string
  ): string[] {
    const found_metrics = new Set(extracted.map(m => m.metric_name));
    const missing: string[] = [];

    // Critical metrics by industry
    const critical_saas = ["arr", "growth_rate", "gross_margin", "ndr"];
    const critical_ecommerce = ["revenue", "gross_margin", "ltv", "cac"];
    const critical_marketplace = ["gmv_growth", "take_rate"];

    let critical_list = critical_saas; // Default
    if (industry.toLowerCase().includes("ecommerce") || industry.toLowerCase().includes("cpg")) {
      critical_list = critical_ecommerce;
    } else if (industry.toLowerCase().includes("marketplace")) {
      critical_list = critical_marketplace;
    }

    for (const critical of critical_list) {
      if (!found_metrics.has(critical)) {
        missing.push(critical);
      }
    }

    return missing;
  }
}

// Export singleton instance
export const metricBenchmarkValidator = new MetricBenchmarkValidator();
