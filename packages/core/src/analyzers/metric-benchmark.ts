/**
 * Metric Benchmark Validator v1.0.0
 * 
 * Extract and validate financial metrics
 * Compare against industry benchmarks
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { DebugScoringTrace, MetricBenchmarkInput, MetricBenchmarkResult } from "../types/dio";
import { buildRulesFromBaseAndDeltas } from "./debug-scoring";

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
    const executed_at = new Date().toISOString();

    const debugEnabled = Boolean((input as any).debug_scoring);

    const text = typeof input.text === "string" ? input.text.trim() : "";
    const extractedInput = Array.isArray((input as any).extracted_metrics) ? (input as any).extracted_metrics : [];

    const parseNumberish = (raw: unknown): number | null => {
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw !== "string") return null;
      const s = raw.trim();
      if (!s) return null;

      const pct = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
      if (pct) return parseFloat(pct[1]);

      const m = s
        .replace(/,/g, "")
        .match(/\$?\s*(-?\d+(?:\.\d+)?)\s*([kmb]|thousand|million|billion)?\b/i);
      if (!m) return null;
      const base = parseFloat(m[1]);
      if (!Number.isFinite(base)) return null;
      const mag = (m[2] || "").toLowerCase();
      const mult = mag === "k" || mag === "thousand" ? 1_000 : mag === "m" || mag === "million" ? 1_000_000 : mag === "b" || mag === "billion" ? 1_000_000_000 : 1;
      return base * mult;
    };

    const unitFrom = (v: unknown): string => {
      if (typeof v !== "string") return "";
      const s = v.toLowerCase();
      if (s.includes("%")) return "%";
      if (s.includes("$")) return "$";
      if (s.includes("month")) return "months";
      return "";
    };

    const isNumericValueMetricName = (name: string): boolean => {
      return name.trim().toLowerCase() === "numeric_value";
    };

    const normalizedExtracted = extractedInput
      .map((m: any) => {
        const metric_name = typeof m?.name === "string" ? m.name : "other";
        const value = typeof m?.value === "number" ? m.value : parseNumberish(m?.value);
        if (value == null || !Number.isFinite(value)) return null;
        return {
          metric_name,
          value,
          unit: typeof m?.unit === "string" ? m.unit : unitFrom(m?.value),
          source: typeof m?.source_doc_id === "string" ? `doc:${m.source_doc_id}` : "structured",
          confidence: 0.9,
        };
      })
      .filter(Boolean) as Array<{ metric_name: string; value: number; unit: string; source: string; confidence: number }>;

    // Treat numeric_value as untyped and exclude it from scoring unless it can be mapped to a known KPI.
    // We do NOT attempt heuristic mapping here (no reliable context available).
    const filteredExtracted = normalizedExtracted.filter((m) => !isNumericValueMetricName(m.metric_name));

    const onlyNumericValue =
      extractedInput.length > 0 &&
      extractedInput.every((m: any) => {
        const n = typeof m?.name === "string" ? m.name.trim().toLowerCase() : "numeric_value";
        return n === "numeric_value" || n === "";
      });

    const MIN_USABLE_METRICS = 2;
    const hasUsableExtracted = filteredExtracted.length >= MIN_USABLE_METRICS;

    if (text.length === 0 && filteredExtracted.length === 0 && extractedInput.length === 0) {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: [],
            rules: [{ rule_id: "excluded", description: "Excluded: missing text and extracted_metrics", delta: 0, running_total: 0 }],
            exclusion_reason: "insufficient_data: missing text and extracted_metrics",
            input_summary: {
              completeness: { score: 0, notes: ["missing text and extracted_metrics"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            final: { score: null, formula: "N/A (insufficient input)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "insufficient_data",
        coverage: 0,
        confidence: 0.3,

        metrics_analyzed: [],
        overall_score: null,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    // If we only got untyped numeric_value metrics (or nothing recognizable) and no text,
    // this should be treated as insufficient data (do not fabricate a neutral score).
    if (text.length === 0 && extractedInput.length > 0 && filteredExtracted.length === 0) {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["extracted_metrics[]"],
            rules: [{ rule_id: "excluded", description: "Excluded: no recognized KPIs (only numeric_value)", delta: 0, running_total: 0 }],
            exclusion_reason: "insufficient_data: no recognized KPIs",
            input_summary: {
              completeness: { score: 0.4, notes: ["only untyped extracted metrics (numeric_value)"] },
              signals_count: 4,
            },
            signals: [
              { key: "text_length", value: text.length },
              { key: "extracted_input_count", value: extractedInput.length },
              { key: "filtered_extracted_count", value: filteredExtracted.length },
              { key: "only_numeric_value", value: onlyNumericValue },
            ],
            penalties: [{ key: "no_recognized_kpis", points: -100, note: "excluded from scoring" }],
            bonuses: [],
            final: { score: null, formula: "N/A (no recognized KPIs)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "insufficient_data",
        coverage: 0,
        confidence: 0.3,

        metrics_analyzed: [],
        overall_score: null,
        note: onlyNumericValue ? "no recognized KPIs (only numeric_value)" : "no recognized KPIs",
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    try {
      const start = Date.now();

      // Extract metrics from text (optional)
      const extractedFromText = text.length > 0 ? this.extractMetrics([text]) : [];
      const extracted_metrics = hasUsableExtracted
        ? filteredExtracted
        : [...filteredExtracted, ...extractedFromText];

      // Get appropriate benchmarks for industry (default to SaaS if not specified)
      const benchmarks = this.getBenchmarks(input.industry || "saas", "series_a");

      // Validate each metric
      const validations = this.validateMetrics(extracted_metrics, benchmarks, input.evidence_ids || []);

      // If we couldn't extract/validate any metrics from the text, treat this as insufficient data
      // rather than a real 0-score metric benchmark.
      if (validations.length === 0) {
        const debug_scoring: DebugScoringTrace | undefined = debugEnabled
          ? {
              inputs_used: [
                ...(text.length > 0 ? ["text"] : []),
                ...(extractedInput.length > 0 ? ["extracted_metrics[]"] : []),
                ...(typeof input.industry === "string" && input.industry ? ["industry"] : []),
              ],
              rules: [{ rule_id: "excluded", description: "Excluded: no validated metrics", delta: 0, running_total: 0 }],
              exclusion_reason: "insufficient_data: no validated metrics",
              input_summary: {
                completeness: { score: 0.3, notes: ["no metrics could be validated"] },
                signals_count: 3,
              },
              signals: [
                { key: "text_length", value: text.length },
                { key: "filtered_extracted_count", value: filteredExtracted.length },
                { key: "extracted_from_text_count", value: extractedFromText.length },
              ],
              penalties: [],
              bonuses: [],
              final: { score: null, formula: "N/A (no validated metrics)" },
            }
          : undefined;
        return {
          analyzer_version: this.metadata.version,
          executed_at,

          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,

          metrics_analyzed: [],
          overall_score: null,
          evidence_ids: input.evidence_ids || [],
          ...(debugEnabled ? { debug_scoring } : {}),
        };
      }

      // Calculate overall score
      const overall_score = this.calculateScore(validations);

      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? (() => {
            const ratings = validations.map((v) => v.rating);
            const strong = ratings.filter((r) => r === "Strong").length;
            const adequate = ratings.filter((r) => r === "Adequate").length;
            const weak = ratings.filter((r) => r === "Weak").length;
            const missing = ratings.filter((r) => r === "Missing").length;

            const signals = [
              { key: "text_length", value: text.length },
              { key: "extracted_input_count", value: extractedInput.length },
              { key: "normalized_extracted_count", value: normalizedExtracted.length },
              { key: "filtered_extracted_count", value: filteredExtracted.length },
              { key: "extracted_from_text_count", value: extractedFromText.length },
              { key: "validations_count", value: validations.length },
              { key: "ratings_strong", value: strong },
              { key: "ratings_adequate", value: adequate },
              { key: "ratings_weak", value: weak },
              { key: "ratings_missing", value: missing },
            ];

            const bonuses = strong > 0 ? [{ key: "strong_metrics", points: strong * 5, note: "informational only" }] : [];
            const penalties = weak > 0 ? [{ key: "weak_metrics", points: -weak * 5, note: "informational only" }] : [];

            const rules = buildRulesFromBaseAndDeltas({
              base: 0,
              base_rule_id: "metric_mean_base",
              base_description: "Metric benchmark score baseline",
              final_score: overall_score,
              clamp_range: { min: 0, max: 100 },
            });

            return {
              inputs_used: [
                ...(text.length > 0 ? ["text"] : []),
                ...(extractedInput.length > 0 ? ["extracted_metrics[]"] : []),
                ...(typeof input.industry === "string" && input.industry ? ["industry"] : []),
              ],
              rules,
              exclusion_reason: null,
              input_summary: {
                completeness: {
                  score: Math.min(1, validations.length / 5),
                  notes: [
                    text.length > 0 ? "text provided" : "no text",
                    filteredExtracted.length > 0 ? "recognized extracted metrics provided" : "no recognized extracted metrics",
                  ],
                },
                signals_count: signals.length + bonuses.length + penalties.length,
              },
              signals,
              penalties,
              bonuses,
              final: {
                score: overall_score,
                formula: "score = round(mean(rating_points)) where Strong=100 Adequate=70 Weak=40 Missing=50",
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

        metrics_analyzed: validations,
        overall_score,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    } catch {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: [
              ...(text.length > 0 ? ["text"] : []),
              ...(extractedInput.length > 0 ? ["extracted_metrics[]"] : []),
              ...(typeof input.industry === "string" && input.industry ? ["industry"] : []),
            ],
            rules: [{ rule_id: "excluded", description: "Excluded: exception during analysis", delta: 0, running_total: 0 }],
            exclusion_reason: "extraction_failed: exception during analysis",
            input_summary: {
              completeness: { score: Math.min(1, (text.length > 0 ? 0.6 : 0.3) + (filteredExtracted.length > 0 ? 0.4 : 0)), notes: ["exception during analysis"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            final: { score: null, formula: "N/A (extraction_failed)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "extraction_failed",
        coverage: 0,
        confidence: 0.2,

        metrics_analyzed: [],
        overall_score: null,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }
  }

  /**
   * Validate input
   */
  validateInput(input: MetricBenchmarkInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const text = typeof input.text === "string" ? input.text.trim() : "";
    const extracted = Array.isArray((input as any).extracted_metrics) ? (input as any).extracted_metrics : [];
    if (text.length === 0 && extracted.length === 0) {
      errors.push("either text or extracted_metrics must be provided");
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
