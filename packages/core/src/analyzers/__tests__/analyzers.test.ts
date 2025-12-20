/**
 * Analyzer Tests
 * Test all 6 analyzers for determinism, validation, and correctness
 */

import { describe, test, expect } from "@jest/globals";
import { slideSequenceAnalyzer } from "../slide-sequence";
import { metricBenchmarkValidator } from "../metric-benchmark";
import { visualDesignScorer } from "../visual-design";
import { narrativeArcDetector } from "../narrative-arc";
import { financialHealthCalculator } from "../financial-health";
import { riskAssessmentEngine } from "../risk-assessment";

// ============================================================================
// SlideSequenceAnalyzer Tests
// ============================================================================

describe("SlideSequenceAnalyzer", () => {
  test("detects Problem-First pattern", async () => {
    const input = {
      headings: [
        "The Problem",
        "Our Solution",
        "Market Size",
        "Product Demo",
        "Traction",
        "Team",
        "Business Model",
        "The Ask"
      ],
      evidence_ids: ["ev1", "ev2"]
    };

    const result = await slideSequenceAnalyzer.analyze(input);

    expect(result.pattern_match).toContain("Problem");
    expect(result.score).toBeGreaterThan(70);
    expect(result.analyzer_version).toBe("1.0.0");
  });

  test("is deterministic - same input produces same output", async () => {
    const input = {
      headings: ["Problem", "Solution", "Market", "Team"],
      evidence_ids: []
    };

    const result1 = await slideSequenceAnalyzer.analyze(input);
    const result2 = await slideSequenceAnalyzer.analyze(input);

    expect(result1.score).toBe(result2.score);
    expect(result1.pattern_match).toBe(result2.pattern_match);
    expect(result1.deviations.length).toBe(result2.deviations.length);
  });

  test("detects missing critical slides", async () => {
    const input = {
      headings: ["Introduction", "Thank You"],
      evidence_ids: []
    };

    const result = await slideSequenceAnalyzer.analyze(input);

    const missing = result.deviations.filter(d => d.type === "missing_critical");
    expect(missing.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(50);
  });

  test("validates input correctly", () => {
    const validation = slideSequenceAnalyzer.validateInput({
      headings: [],
      evidence_ids: []
    });

    expect(validation.valid).toBe(true);
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  test("input hashing is consistent", () => {
    const input = {
      headings: ["A", "B", "C"],
      evidence_ids: ["e1"]
    };

    const hash1 = slideSequenceAnalyzer.getInputHash(input);
    const hash2 = slideSequenceAnalyzer.getInputHash(input);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256
  });
});

// ============================================================================
// MetricBenchmarkValidator Tests
// ============================================================================

describe("MetricBenchmarkValidator", () => {
  test("extracts metrics from text", async () => {
    const input = {
      evidence_content: [
        "Our MRR is $50K and growing at 20% MoM",
        "Gross Margin: 80%",
        "CAC: $500, LTV: $5000"
      ],
      industry: "SaaS",
      stage: "Series A",
      evidence_ids: ["ev1"]
    };

    const result = await metricBenchmarkValidator.analyze(input);

    expect(result.metrics_analyzed).toBeGreaterThan(0);
    expect(result.overall_score).toBeGreaterThan(0);
  });

  test("validates against SaaS benchmarks", async () => {
    const input = {
      evidence_content: ["ARR: $2M", "Growth Rate: 150%", "Gross Margin: 85%"],
      industry: "SaaS",
      stage: "Series A",
      evidence_ids: []
    };

    const result = await metricBenchmarkValidator.analyze(input);

    const excellent = result.validations.filter(v => v.status === "excellent");
    expect(excellent.length).toBeGreaterThan(0);
  });

  test("identifies missing critical metrics", async () => {
    const input = {
      evidence_content: ["Some text without metrics"],
      industry: "SaaS",
      stage: "Seed",
      evidence_ids: []
    };

    const result = await metricBenchmarkValidator.analyze(input);

    expect(result.missing_critical_metrics.length).toBeGreaterThan(0);
  });

  test("is deterministic", async () => {
    const input = {
      evidence_content: ["MRR: $100K"],
      industry: "SaaS",
      stage: "Seed",
      evidence_ids: []
    };

    const result1 = await metricBenchmarkValidator.analyze(input);
    const result2 = await metricBenchmarkValidator.analyze(input);

    expect(result1.overall_score).toBe(result2.overall_score);
  });
});

// ============================================================================
// VisualDesignScorer Tests
// ============================================================================

describe("VisualDesignScorer", () => {
  test("scores ideal deck structure", async () => {
    const input = {
      page_count: 12,
      file_size_bytes: 4200000, // ~350 KB per page
      total_text_chars: 4800, // ~400 chars per page
      headings: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
      evidence_ids: []
    };

    const result = await visualDesignScorer.analyze(input);

    expect(result.design_score).toBeGreaterThan(70);
    expect(result.proxy_signals.page_count_appropriate).toBe(true);
  });

  test("detects too many pages", async () => {
    const input = {
      page_count: 25,
      file_size_bytes: 5000000,
      total_text_chars: 10000,
      headings: Array(25).fill("Slide"),
      evidence_ids: []
    };

    const result = await visualDesignScorer.analyze(input);

    expect(result.proxy_signals.page_count_appropriate).toBe(false);
    expect(result.insights.some(i => i.includes("too long"))).toBe(true);
  });

  test("includes limitations note", async () => {
    const input = {
      page_count: 10,
      file_size_bytes: 3000000,
      total_text_chars: 4000,
      headings: Array(10).fill("Slide"),
      evidence_ids: []
    };

    const result = await visualDesignScorer.analyze(input);

    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.limitations[0]).toContain("proxy heuristics");
  });

  test("is deterministic", async () => {
    const input = {
      page_count: 12,
      file_size_bytes: 4000000,
      total_text_chars: 5000,
      headings: Array(12).fill("Slide"),
      evidence_ids: []
    };

    const result1 = await visualDesignScorer.analyze(input);
    const result2 = await visualDesignScorer.analyze(input);

    expect(result1.design_score).toBe(result2.design_score);
  });
});

// ============================================================================
// NarrativeArcDetector Tests
// ============================================================================

describe("NarrativeArcDetector", () => {
  test("detects Hero's Journey archetype", async () => {
    const input = {
      slide_categories: ["problem", "vision", "solution", "traction", "ask"],
      slide_content: [
        "There is a major problem in the market",
        "We envision a better future",
        "Our solution addresses this",
        "We have 1000 customers",
        "We are raising $5M"
      ],
      slide_text_lengths: [100, 120, 110, 90, 80],
      evidence_ids: []
    };

    const result = await narrativeArcDetector.analyze(input);

    expect(result.archetype).toContain("Hero");
    expect(result.archetype_confidence).toBeGreaterThan(0.5);
  });

  test("analyzes pacing correctly", async () => {
    const input = {
      slide_categories: ["problem", "solution", "market"],
      slide_content: ["Text", "Text", "Text"],
      slide_text_lengths: [100, 100, 100], // Even pacing
      evidence_ids: []
    };

    const result = await narrativeArcDetector.analyze(input);

    expect(result.pacing_score).toBeGreaterThan(0);
    expect(result.pacing_score).toBeLessThanOrEqual(100);
  });

  test("detects emotional beats", async () => {
    const input = {
      slide_categories: ["problem", "solution"],
      slide_content: [
        "The problem is critical and causes significant pain",
        "Our innovative solution provides hope for the future"
      ],
      slide_text_lengths: [50, 50],
      evidence_ids: []
    };

    const result = await narrativeArcDetector.analyze(input);

    expect(result.emotional_beats.length).toBeGreaterThan(0);
  });

  test("is deterministic", async () => {
    const input = {
      slide_categories: ["problem", "solution"],
      slide_content: ["Problem", "Solution"],
      slide_text_lengths: [100, 100],
      evidence_ids: []
    };

    const result1 = await narrativeArcDetector.analyze(input);
    const result2 = await narrativeArcDetector.analyze(input);

    expect(result1.archetype).toBe(result2.archetype);
    expect(result1.pacing_score).toBe(result2.pacing_score);
  });
});

// ============================================================================
// FinancialHealthCalculator Tests
// ============================================================================

describe("FinancialHealthCalculator", () => {
  test("calculates runway correctly", async () => {
    const input = {
      cash_balance: 1200000,
      monthly_burn_rate: 100000,
      evidence_ids: []
    };

    const result = await financialHealthCalculator.analyze(input);

    expect(result.runway_months).toBe(12);
  });

  test("calculates burn multiple", async () => {
    const input = {
      cash_balance: 1000000,
      monthly_burn_rate: 50000,
      new_arr_monthly: 25000,
      evidence_ids: []
    };

    const result = await financialHealthCalculator.analyze(input);

    expect(result.burn_multiple).toBe(2.0); // $50K burn / $25K new ARR
  });

  test("detects critical runway", async () => {
    const input = {
      cash_balance: 300000,
      monthly_burn_rate: 100000, // 3 months runway
      evidence_ids: []
    };

    const result = await financialHealthCalculator.analyze(input);

    expect(result.runway_months).toBeLessThan(6);
    expect(result.insights.some(i => i.includes("Critical"))).toBe(true);
  });

  test("scores excellent financial health", async () => {
    const input = {
      cash_balance: 2400000,
      monthly_burn_rate: 100000, // 24 months
      current_mrr: 200000,
      previous_mrr: 150000, // 33% growth
      gross_margin: 85,
      new_arr_monthly: 100000,
      evidence_ids: []
    };

    const result = await financialHealthCalculator.analyze(input);

    expect(result.health_score).toBeGreaterThan(80);
    expect(result.burn_efficiency).toBe("excellent");
  });

  test("is deterministic", async () => {
    const input = {
      cash_balance: 1000000,
      monthly_burn_rate: 50000,
      evidence_ids: []
    };

    const result1 = await financialHealthCalculator.analyze(input);
    const result2 = await financialHealthCalculator.analyze(input);

    expect(result1.runway_months).toBe(result2.runway_months);
    expect(result1.health_score).toBe(result2.health_score);
  });
});

// ============================================================================
// RiskAssessmentEngine Tests
// ============================================================================

describe("RiskAssessmentEngine", () => {
  test("detects market risks", async () => {
    const input = {
      market_size_tam: 500000000, // $500M (small TAM)
      market_growth_rate: 3, // Slow growth
      evidence_ids: []
    };

    const result = await riskAssessmentEngine.analyze(input);

    const market_risks = result.risks_by_category["market"];
    expect(market_risks).toBeDefined();
    expect(market_risks.length).toBeGreaterThan(0);
  });

  test("detects financial risks", async () => {
    const input = {
      runway_months: 4, // Critical
      burn_multiple: 5, // High
      evidence_ids: []
    };

    const result = await riskAssessmentEngine.analyze(input);

    expect(result.risks_by_severity.critical).toBeGreaterThan(0);
    expect(result.overall_risk_score).toBeGreaterThan(50);
  });

  test("no risks for strong company", async () => {
    const input = {
      runway_months: 24,
      burn_multiple: 0.8,
      market_size_tam: 10000000000,
      market_growth_rate: 25,
      customer_count: 500,
      churn_rate: 2,
      evidence_ids: []
    };

    const result = await riskAssessmentEngine.analyze(input);

    expect(result.total_risks_detected).toBe(0);
    expect(result.overall_risk_score).toBe(0);
  });

  test("generates mitigation suggestions", async () => {
    const input = {
      runway_months: 3,
      evidence_ids: []
    };

    const result = await riskAssessmentEngine.analyze(input);

    expect(result.mitigation_suggestions.length).toBeGreaterThan(0);
  });

  test("is deterministic", async () => {
    const input = {
      runway_months: 8,
      market_size_tam: 1000000000,
      evidence_ids: []
    };

    const result1 = await riskAssessmentEngine.analyze(input);
    const result2 = await riskAssessmentEngine.analyze(input);

    expect(result1.total_risks_detected).toBe(result2.total_risks_detected);
    expect(result1.overall_risk_score).toBe(result2.overall_risk_score);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Analyzer Integration", () => {
  test("all analyzers have version 1.0.0", () => {
    const analyzers = [
      slideSequenceAnalyzer,
      metricBenchmarkValidator,
      visualDesignScorer,
      narrativeArcDetector,
      financialHealthCalculator,
      riskAssessmentEngine
    ];

    for (const analyzer of analyzers) {
      expect(analyzer.metadata.version).toBe("1.0.0");
      expect(analyzer.metadata.released_at).toBe("2024-12-18");
    }
  });

  test("all analyzers include duration_ms", async () => {
    const results = await Promise.all([
      slideSequenceAnalyzer.analyze({ headings: ["A"], evidence_ids: [] }),
      visualDesignScorer.analyze({ 
        page_count: 10, 
        file_size_bytes: 1000000, 
        total_text_chars: 1000,
        headings: [],
        evidence_ids: [] 
      }),
      financialHealthCalculator.analyze({ 
        cash_balance: 1000000, 
        monthly_burn_rate: 50000,
        evidence_ids: [] 
      })
    ]);

    for (const result of results) {
      expect(result.duration_ms).toBeGreaterThan(0);
      expect(result.executed_at).toBeDefined();
    }
  });

  test("all analyzers are registered", async () => {
    const { analyzerRegistry } = await import("../base");
    
    analyzerRegistry.register(slideSequenceAnalyzer);
    analyzerRegistry.register(metricBenchmarkValidator);
    analyzerRegistry.register(visualDesignScorer);
    analyzerRegistry.register(narrativeArcDetector);
    analyzerRegistry.register(financialHealthCalculator);
    analyzerRegistry.register(riskAssessmentEngine);

    const list = analyzerRegistry.list();
    expect(list.length).toBe(6);
  });
});
