/**
 * Analyzer Tests (Schema v1)
 *
 * These tests reflect the current Zod schemas in `src/types/dio.ts` and the
 * Step 3D semantics:
 * - `status: ok` => numeric scores present
 * - `status: insufficient_data|extraction_failed` => score fields are null
 */

import { analyzerRegistry } from "../base";
import { slideSequenceAnalyzer } from "../slide-sequence";
import { metricBenchmarkValidator } from "../metric-benchmark";
import { visualDesignScorer } from "../visual-design";
import { narrativeArcDetector } from "../narrative-arc";
import { financialHealthCalculator } from "../financial-health";
import { riskAssessmentEngine } from "../risk-assessment";

const EVIDENCE_ID = "11111111-1111-1111-1111-111111111111";

describe("SlideSequenceAnalyzer", () => {
  test("ok path returns non-null score and sequence", async () => {
    const result = await slideSequenceAnalyzer.analyze({
      headings: [
        "Problem",
        "Solution",
        "Market",
        "Product",
        "Traction",
        "Team",
        "Financials",
        "Ask",
      ],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.sequence_detected.length).toBeGreaterThan(0);
    expect(result.pattern_match).toBeTruthy();
  });

  test("insufficient_data returns null score", async () => {
    const result = await slideSequenceAnalyzer.analyze({
      headings: ["", "   "],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull();
    expect(result.sequence_detected).toEqual([]);
  });

  test("input hashing is stable", () => {
    const input = { headings: ["A", "B", "C"], evidence_ids: [EVIDENCE_ID] };
    expect(slideSequenceAnalyzer.getInputHash(input)).toBe(slideSequenceAnalyzer.getInputHash(input));
  });
});

describe("MetricBenchmarkValidator", () => {
  test("extracts validations and produces overall score", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "MRR: $50K. Gross Margin: 80%. Growth: 150% YoY. CAC: $500. LTV: $5000.",
      industry: "SaaS",
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.metrics_analyzed.length).toBeGreaterThan(0);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score!).toBeGreaterThanOrEqual(0);
    expect(result.overall_score!).toBeLessThanOrEqual(100);
  });

  test("insufficient_data on empty text", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "",
      industry: "SaaS",
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.metrics_analyzed).toEqual([]);
    expect(result.overall_score).toBeNull();
  });
});

describe("VisualDesignScorer", () => {
  test("scores a reasonable deck", async () => {
    const result = await visualDesignScorer.analyze({
      page_count: 12,
      file_size_bytes: 4_200_000,
      total_text_chars: 4_800,
      headings: Array.from({ length: 12 }, (_, i) => `Slide ${i + 1}`),
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.design_score).not.toBeNull();
    expect(result.design_score!).toBeGreaterThanOrEqual(0);
    expect(result.design_score!).toBeLessThanOrEqual(100);
    expect(typeof result.note).toBe("string");
  });

  test("flags too many pages", async () => {
    const result = await visualDesignScorer.analyze({
      page_count: 25,
      file_size_bytes: 5_000_000,
      total_text_chars: 10_000,
      headings: Array.from({ length: 25 }, () => "Slide"),
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.proxy_signals.page_count_appropriate).toBe(false);
    expect(result.weaknesses.length).toBeGreaterThan(0);
  });
});

describe("NarrativeArcDetector", () => {
  test("detects Hero's Journey archetype", async () => {
    const result = await narrativeArcDetector.analyze({
      slides: [
        { heading: "Problem", text: "The problem is critical and causes pain." },
        { heading: "Vision", text: "We imagine a better future and opportunity." },
        { heading: "Solution", text: "Our solution is a new approach." },
        { heading: "Traction", text: "We have traction and revenue growth." },
        { heading: "Ask", text: "We are raising $5M now." },
      ],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.archetype).toContain("Hero");
    expect(result.pacing_score).not.toBeNull();
    expect(result.pacing_score!).toBeGreaterThanOrEqual(0);
    expect(result.pacing_score!).toBeLessThanOrEqual(100);
    expect(result.emotional_beats.length).toBeGreaterThan(0);
  });

  test("insufficient_data on empty slides", async () => {
    const result = await narrativeArcDetector.analyze({
      slides: [],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.pacing_score).toBeNull();
    expect(result.emotional_beats).toEqual([]);
  });
});

describe("FinancialHealthCalculator", () => {
  test("calculates runway from cash and burn", async () => {
    const result = await financialHealthCalculator.analyze({
      cash_balance: 1_200_000,
      burn_rate: 100_000,
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.runway_months).toBe(12);
    expect(result.health_score).not.toBeNull();
  });

  test("insufficient_data when no financial fields provided", async () => {
    const result = await financialHealthCalculator.analyze({
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.runway_months).toBeNull();
    expect(result.health_score).toBeNull();
    expect(result.risks).toEqual([]);
  });

  test("generates runway risk when < 6 months", async () => {
    const result = await financialHealthCalculator.analyze({
      cash_balance: 300_000,
      burn_rate: 100_000,
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.runway_months).toBe(3);
    expect(result.risks.some((r) => r.category === "runway" && r.severity === "critical")).toBe(true);
  });
});

describe("RiskAssessmentEngine", () => {
  test("detects multiple risks from pitch text and metrics", async () => {
    const result = await riskAssessmentEngine.analyze({
      pitch_text:
        "We are pre-revenue with an MVP. This is a crowded market with many competitors. We are looking for a CTO. Regulatory compliance is required.",
      headings: ["Problem", "Solution", "Market", "Team", "Ask"],
      metrics: { runway: 4, burn_rate: 200_000 },
      team_size: 2,
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.total_risks).toBeGreaterThan(0);
    expect(result.overall_risk_score).not.toBeNull();
    expect(result.overall_risk_score!).toBeGreaterThanOrEqual(0);
    expect(result.overall_risk_score!).toBeLessThanOrEqual(100);

    // All categories always present
    expect(result.risks_by_category.market).toBeDefined();
    expect(result.risks_by_category.team).toBeDefined();
    expect(result.risks_by_category.financial).toBeDefined();
    expect(result.risks_by_category.execution).toBeDefined();
  });

  test("insufficient_data on short pitch text", async () => {
    const result = await riskAssessmentEngine.analyze({
      pitch_text: "Too short",
      headings: [],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.overall_risk_score).toBeNull();
    expect(result.total_risks).toBe(0);
  });
});

describe("Analyzer registry", () => {
  test("can register analyzers", () => {
    analyzerRegistry.register(slideSequenceAnalyzer);
    analyzerRegistry.register(metricBenchmarkValidator);
    analyzerRegistry.register(visualDesignScorer);
    analyzerRegistry.register(narrativeArcDetector);
    analyzerRegistry.register(financialHealthCalculator);
    analyzerRegistry.register(riskAssessmentEngine);

    const list = analyzerRegistry.list();
    expect(list.length).toBeGreaterThanOrEqual(6);
  });
});
