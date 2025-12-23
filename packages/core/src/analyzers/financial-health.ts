/**
 * Financial Health Calculator v1.0.0
 * 
 * Calculate runway, burn multiple, overall health score
 * Deterministic financial analysis
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import { buildRulesFromBaseAndDeltas } from "./debug-scoring";
import type { DebugScoringTrace, FinancialHealthInput, FinancialHealthResult } from "../types/dio";

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
      const debugEnabled = Boolean((input as any).debug_scoring);

    const extractedInput = Array.isArray((input as any).extracted_metrics) ? (input as any).extracted_metrics : [];
    const keyFinancialMetrics = ((input as any).keyFinancialMetrics ?? (input as any).key_financial_metrics) as Record<string, unknown> | undefined;

    const parseNumberish = (raw: unknown): number | null => {
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        // Accept summary-stat objects from spreadsheet extraction.
        // Priority: value -> avg -> mean -> max -> min
        const o = raw as Record<string, unknown>;
        const candidates: unknown[] = [o.value, o.avg, o.mean, o.max, o.min];
        for (const c of candidates) {
          const n = parseNumberish(c);
          if (n != null && Number.isFinite(n)) return n;
        }
        return null;
      }

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

    const normalizedExtracted = extractedInput
      .map((m: any) => {
        const name = typeof m?.name === "string" ? m.name : "other";
        const value = typeof m?.value === "number" ? m.value : parseNumberish(m?.value);
        if (value == null || !Number.isFinite(value)) return null;
        return { name, value };
      })
      .filter(Boolean) as Array<{ name: string; value: number }>;

    const inferMetricName = (key: string, value: unknown): string => {
      const k = key.toLowerCase();
      const v = (value == null ? "" : String(value)).toLowerCase();
      const combined = `${k} ${v}`;

      // Revenue metrics
      if (combined.includes("mrr")) return "mrr";
      if (combined.includes("arr")) return "arr";
      if (combined.includes("revenue") || combined.includes("sales")) return "revenue";

      // Growth
      if (combined.includes("growth") || combined.includes("yoy") || combined.includes("month-over-month") || combined.includes("mom")) return "growth_rate";

      // Cash / burn / spend
      if (
        combined.includes("cash balance") ||
        combined.includes("cash on hand") ||
        combined.includes("beginning cash") ||
        combined.includes("ending cash") ||
        combined.includes("cash")
      )
        return "cash_balance";

      if (
        (combined.includes("burn") && combined.includes("rate")) ||
        combined.includes("net burn") ||
        combined.includes("monthly burn")
      )
        return "burn_rate";
      if (combined.includes("burn")) return "burn_rate";

      if (combined.includes("operating expenses") || combined.includes("expenses") || combined.includes("opex") || combined.includes("operating spend") || combined.includes("cost")) {
        return "expenses";
      }

      // Runway
      if (combined.includes("months of runway") || combined.includes("runway")) return "runway_months";

      return k || "other";
    };

    // If an Excel doc provided keyFinancialMetrics directly (DIO input doc shape), normalize it
    // into the same extracted metric list so we can derive runway deterministically.
    if (keyFinancialMetrics && typeof keyFinancialMetrics === "object" && !Array.isArray(keyFinancialMetrics)) {
      for (const [rawKey, rawValue] of Object.entries(keyFinancialMetrics)) {
        const num = parseNumberish(rawValue);
        if (num == null || !Number.isFinite(num)) continue;
        const name = inferMetricName(rawKey, rawValue);

        // Normalize annual burn/expenses to monthly if explicitly labeled.
        const label = rawKey.toLowerCase();
        const looksAnnual = label.includes("annual") || label.includes("year") || label.includes("yearly") || label.includes("per year") || label.includes("yr");
        const value = looksAnnual && (name === "burn_rate" || name === "expenses") ? num / 12 : num;

        normalizedExtracted.push({ name, value });
      }
    }

    const normalizeName = (name: string): string => name.trim().toLowerCase();

    const pick = (names: string[]): number | undefined => {
      for (const n of names) {
        const found = normalizedExtracted.find((m) => normalizeName(m.name) === normalizeName(n));
        if (found) return found.value;
      }
      return undefined;
    };

    const revenue = input.revenue ?? pick(["revenue", "arr", "mrr"]);
    const expenses = input.expenses ?? pick(["expenses", "opex", "operating_spend"]);
    const cash_balance = input.cash_balance ?? pick(["cash_balance", "cash", "cash_on_hand"]);
    const burn_rate_raw = input.burn_rate ?? pick(["burn_rate", "monthly_burn", "burn"]);
    const growth_rate = input.growth_rate ?? pick(["growth_rate", "mom_growth"]);
    const runway_months_from_extracted = pick(["runway_months", "runway"]);

    // If burn_rate is missing but we have expenses, treat expenses as an operating spend proxy.
    // This is conservative and lowers coverage/confidence.
    const usedExpensesAsBurnProxy = burn_rate_raw === undefined && expenses !== undefined;
    const burn_rate = burn_rate_raw ?? (usedExpensesAsBurnProxy ? expenses : undefined);

    if (
      revenue === undefined &&
      expenses === undefined &&
      cash_balance === undefined &&
      burn_rate === undefined &&
      growth_rate === undefined &&
      runway_months_from_extracted === undefined
    ) {
        const debug_scoring: DebugScoringTrace | undefined = debugEnabled
          ? {
              inputs_used: [
                "revenue",
                "expenses",
                "cash_balance",
                "burn_rate",
                "growth_rate",
                "extracted_metrics",
                "keyFinancialMetrics",
                "key_financial_metrics",
              ],
              exclusion_reason: "no_financial_signals",
              input_summary: {
                completeness: { score: 0, notes: ["no financial signals present"] },
                signals_count: 0,
              },
              signals: [],
              penalties: [],
              bonuses: [],
              rules: [{ rule_id: "excluded", description: "Excluded: no financial signals present", delta: 0, running_total: 0 }],
              final: { score: null, formula: "N/A (insufficient input)" },
            }
          : undefined;

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
          ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    try {
      const start = Date.now();

      // Calculate runway
      let runway_months: number | null = null;
      if (runway_months_from_extracted !== undefined) {
        runway_months = Math.round(runway_months_from_extracted * 10) / 10;
      } else if (cash_balance !== undefined && burn_rate !== undefined) {
        runway_months = this.calculateRunway(cash_balance, burn_rate);
      }

      // Without runway we cannot produce a meaningful health score.
      if (runway_months === null) {
          const debug_scoring: DebugScoringTrace | undefined = debugEnabled
            ? {
                inputs_used: [
                  "cash_balance",
                  "burn_rate",
                  "expenses",
                  "extracted_metrics",
                  "keyFinancialMetrics",
                  "key_financial_metrics",
                ],
                exclusion_reason: "missing_runway",
                input_summary: {
                  completeness: {
                    score: 0.4,
                    notes: ["missing runway (need cash_balance + burn_rate or extracted runway)"] ,
                  },
                  signals_count: 5,
                },
                signals: [
                  { key: "cash_balance", value: cash_balance ?? null },
                  { key: "burn_rate", value: burn_rate ?? null, note: usedExpensesAsBurnProxy ? "expenses used as burn proxy" : undefined },
                  { key: "runway_months_extracted", value: runway_months_from_extracted ?? null },
                  { key: "revenue", value: revenue ?? null },
                  { key: "growth_rate", value: growth_rate ?? null },
                ],
                penalties: [{ key: "no_runway", points: -100, note: "health score withheld" }],
                bonuses: [],
                rules: [{ rule_id: "excluded", description: "Excluded: missing runway", delta: 0, running_total: 0 }],
                final: { score: null, formula: "N/A (runway required)" },
              }
            : undefined;

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
            revenue: revenue ?? null,
            expenses: expenses ?? null,
            cash_balance: cash_balance ?? null,
            burn_rate: burn_rate ?? null,
            growth_rate: growth_rate ?? null,
          },
          risks: [],
          evidence_ids: input.evidence_ids || [],
            ...(debugEnabled ? { debug_scoring } : {}),
        };
      }

      // Calculate burn multiple (not available from current input schema)
      const burn_multiple = null;

      // Calculate monthly growth rate
      const monthly_growth_rate = growth_rate ?? null;

      // Calculate health score
      const health_score = this.calculateHealthScore(
        runway_months,
        burn_multiple,
        undefined, // gross_margin not in schema
        monthly_growth_rate
      );

      // Conservative adjustment when using an operating spend proxy for burn_rate.
      const adjusted_health_score = usedExpensesAsBurnProxy && health_score != null
        ? Math.max(0, Math.min(100, Math.round((health_score - 5) * 10) / 10))
        : health_score;

      // Coverage reflects completeness of key runway inputs.
      const cashPresent = cash_balance !== undefined && cash_balance !== null;
      const burnPresent = burn_rate !== undefined && burn_rate !== null;
      const runwayPresent = runway_months !== null;
      const revPresent = revenue !== undefined && revenue !== null;
      const growthPresent = growth_rate !== undefined && growth_rate !== null;
      const burnWeight = usedExpensesAsBurnProxy ? 0.5 : 1;
      const coverageRaw =
        (runwayPresent ? 1 : 0) +
        (cashPresent ? 1 : 0) +
        (burnPresent ? burnWeight : 0) +
        (revPresent ? 1 : 0) +
        (growthPresent ? 1 : 0);
      const coverage = Math.max(0.4, Math.min(1, coverageRaw / 5));
      const confidence = Math.max(0.4, Math.min(0.85, 0.4 + coverage * 0.5 - (usedExpensesAsBurnProxy ? 0.05 : 0)));

      // Generate financial risks
      const risks = this.generateFinancialRisks(
        runway_months,
        burn_multiple,
        {
          ...input,
          revenue,
          expenses,
          cash_balance,
          burn_rate,
          growth_rate,
        },
        input.evidence_ids || []
      );

        const debug_scoring: DebugScoringTrace | undefined = debugEnabled
          ? (() => {
              const runwayPoints = runway_months >= HEALTH_THRESHOLDS.runway_months.excellent
                ? 40
                : runway_months >= HEALTH_THRESHOLDS.runway_months.healthy
                  ? 30
                  : runway_months >= HEALTH_THRESHOLDS.runway_months.warning
                    ? 20
                    : runway_months >= HEALTH_THRESHOLDS.runway_months.critical
                      ? 10
                      : 0;

              const growthPoints = monthly_growth_rate == null
                ? null
                : monthly_growth_rate >= 20
                  ? 10
                  : monthly_growth_rate >= 10
                    ? 7
                    : monthly_growth_rate >= 5
                      ? 5
                      : monthly_growth_rate >= 0
                        ? 2
                        : 0;

              const completenessRaw =
                (runway_months !== null ? 1 : 0) +
                (cash_balance !== undefined && cash_balance !== null ? 1 : 0) +
                (burn_rate !== undefined && burn_rate !== null ? 1 : 0) +
                (revenue !== undefined && revenue !== null ? 1 : 0) +
                (growth_rate !== undefined && growth_rate !== null ? 1 : 0);
              const completenessScore = Math.max(0, Math.min(1, completenessRaw / 5));

              const signals = [
                { key: "runway_months", value: runway_months, points: runwayPoints, note: "0-40" },
                { key: "growth_rate", value: monthly_growth_rate, points: growthPoints ?? undefined, note: growthPoints == null ? "not provided" : "0-10" },
                { key: "used_expenses_as_burn_proxy", value: usedExpensesAsBurnProxy },
                { key: "coverage", value: Math.round(coverage * 1000) / 1000 },
                { key: "confidence", value: Math.round(confidence * 1000) / 1000 },
              ];

              const penalties = usedExpensesAsBurnProxy
                ? [{ key: "burn_proxy_adjustment", points: -5, note: "conservative score adjustment" }]
                : [];

              const runwayRuleDesc = runway_months >= HEALTH_THRESHOLDS.runway_months.excellent
                ? `runway_months >= ${HEALTH_THRESHOLDS.runway_months.excellent} => +40`
                : runway_months >= HEALTH_THRESHOLDS.runway_months.healthy
                  ? `runway_months >= ${HEALTH_THRESHOLDS.runway_months.healthy} => +30`
                  : runway_months >= HEALTH_THRESHOLDS.runway_months.warning
                    ? `runway_months >= ${HEALTH_THRESHOLDS.runway_months.warning} => +20`
                    : runway_months >= HEALTH_THRESHOLDS.runway_months.critical
                      ? `runway_months >= ${HEALTH_THRESHOLDS.runway_months.critical} => +10`
                      : `runway_months < ${HEALTH_THRESHOLDS.runway_months.critical} => +0`;

              const growthRuleDesc = growthPoints == null || monthly_growth_rate == null
                ? null
                : monthly_growth_rate >= 20
                  ? "growth_rate >= 20% => +10"
                  : monthly_growth_rate >= 10
                    ? "growth_rate >= 10% => +7"
                    : monthly_growth_rate >= 5
                      ? "growth_rate >= 5% => +5"
                      : monthly_growth_rate >= 0
                        ? "growth_rate >= 0% => +2"
                        : "growth_rate < 0% => +0";

              const rules = buildRulesFromBaseAndDeltas({
                base: 0,
                base_rule_id: "base",
                base_description: "Start score",
                bonuses: [
                  { rule_id: "runway_points", description: runwayRuleDesc, points: runwayPoints },
                  ...(growthPoints == null
                    ? []
                    : [{ rule_id: "growth_points", description: growthRuleDesc ?? "growth points", points: growthPoints }]),
                ],
                penalties: usedExpensesAsBurnProxy
                  ? [{ rule_id: "burn_proxy_adjustment", description: "burn_rate inferred from expenses => -5", points: 5 }]
                  : [],
                final_score: adjusted_health_score,
                clamp_range: { min: 0, max: 100 },
              });

              return {
                inputs_used: [
                  "runway_months_extracted",
                  "cash_balance",
                  "burn_rate",
                  "expenses",
                  "revenue",
                  "growth_rate",
                  "extracted_metrics",
                  "keyFinancialMetrics",
                  "key_financial_metrics",
                ],
                exclusion_reason: null,
                input_summary: {
                  completeness: {
                    score: completenessScore,
                    notes: [
                      cash_balance != null ? "cash_balance present" : "cash_balance missing",
                      burn_rate != null ? "burn_rate present" : "burn_rate missing",
                      revenue != null ? "revenue present" : "revenue missing",
                      growth_rate != null ? "growth_rate present" : "growth_rate missing",
                    ],
                  },
                  signals_count: signals.length + penalties.length,
                },
                signals,
                penalties,
                bonuses: [],
                rules,
                final: {
                  score: adjusted_health_score,
                  formula: usedExpensesAsBurnProxy
                    ? "health_score adjusted downward when burn_rate inferred from expenses"
                    : "health_score from runway + optional growth bonus",
                },
              };
            })()
          : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "ok",
        coverage,
        confidence,

        runway_months,
        burn_multiple,
        health_score: adjusted_health_score,
        metrics: {
          revenue: revenue ?? null,
          expenses: expenses ?? null,
          cash_balance: cash_balance ?? null,
          burn_rate: burn_rate ?? null,
          growth_rate: growth_rate ?? null,
        },
        risks,
        evidence_ids: input.evidence_ids || [],
          ...(debugEnabled ? { debug_scoring } : {}),
      };
    } catch {
        const debug_scoring: DebugScoringTrace | undefined = debugEnabled
          ? {
              inputs_used: [
                "runway_months_extracted",
                "cash_balance",
                "burn_rate",
                "expenses",
                "revenue",
                "growth_rate",
                "extracted_metrics",
                "keyFinancialMetrics",
                "key_financial_metrics",
              ],
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
          ...(debugEnabled ? { debug_scoring } : {}),
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

    const extracted = Array.isArray((input as any).extracted_metrics) ? (input as any).extracted_metrics : [];
    if (input.revenue === undefined && input.cash_balance === undefined && extracted.length === 0) {
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
