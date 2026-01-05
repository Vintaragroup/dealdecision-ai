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

  test("falls back to slide body text when headings are low-quality", async () => {
    const headings = Array.from({ length: 10 }, () => "####");
    const slides = [
      { text: "Problem: SMBs struggle with X due to Y." },
      { text: "Solution: We provide an automated workflow that does Z." },
      { text: "Market: TAM is large; SAM/SOM details." },
      { text: "Team: Founder backgrounds and relevant experience." },
      { text: "Ask: Raising $5M to scale go-to-market." },
      { text: "Traction: 200% YoY growth and 50 customers." },
      { text: "Product: Platform overview and features." },
      { text: "Business Model: Pricing and revenue streams." },
      { text: "Competition: Competitive landscape and differentiation." },
      { text: "Financials: Projections and use of funds." },
    ];

    const result = await slideSequenceAnalyzer.analyze({
      headings,
      slides,
      evidence_ids: [EVIDENCE_ID],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.score).not.toBeNull();

    // Should classify key slide types from body text rather than returning mostly unknown.
    expect(result.sequence_detected).toEqual(
      expect.arrayContaining(["problem", "solution", "market", "team", "ask"])
    );
    const unknownCount = result.sequence_detected.filter((x) => x === "unknown").length;
    expect(unknownCount).toBeLessThan(3);
  });

  test("WebMax-like repetitive headings => low-signal insufficient_data (no score 16)", async () => {
    const headings = Array.from({ length: 12 }, () => "WebMax Confidential");

    const result = await slideSequenceAnalyzer.analyze({
      headings,
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.confidence).toBe(0.3);
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^low_signal: headingsCount=12, recognized_ratio=\d+\.\d{3}, sequence_len=\d+$/)])
    );
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

  test("insufficient_data on non-metric text", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "We are building the future of payments with an incredible team and a massive market.",
      industry: "SaaS",
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.metrics_analyzed).toEqual([]);
    expect(result.overall_score).toBeNull();
  });

  test("WebMax Excel: uses extracted_metrics when text is empty", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "",
      industry: "SaaS",
      extracted_metrics: [
        { name: "growth_rate", value: "120%", source_doc_id: "doc-webmax-xlsx" },
        { name: "gross_margin", value: "78%", source_doc_id: "doc-webmax-xlsx" },
      ],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.metrics_analyzed.length).toBeGreaterThan(0);
    expect(result.overall_score).not.toBeNull();
  });

  test("WebMax pitch deck: numeric_value-only extracted_metrics is insufficient_data", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "",
      industry: "SaaS",
      extracted_metrics: [
        { name: "numeric_value", value: "120%", source_doc_id: "doc-webmax-deck" },
        { name: "numeric_value", value: "$1.2M", source_doc_id: "doc-webmax-deck" },
      ],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.metrics_analyzed).toEqual([]);
    expect(result.overall_score).toBeNull();
    expect(result.note).toContain("only numeric_value");
  });

  test("Magarian fund: extracted_metrics-only still yields a score", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "",
      extracted_metrics: [
        { name: "aum", value: "$250M", source_doc_id: "doc-magarian" },
        { name: "irr", value: "22%", source_doc_id: "doc-magarian" },
      ],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.metrics_analyzed.length).toBeGreaterThan(0);
    expect(result.overall_score).not.toBeNull();
  });

  test("Real estate underwriting: policy KPIs map and benchmark to non-neutral score", async () => {
    const result = await metricBenchmarkValidator.analyze({
      text: "",
      policy_id: "real_estate_underwriting",
      extracted_metrics: [
        { name: "DSCR", value: "1.35", source_doc_id: "doc-re" },
        { name: "LTV", value: "70%", source_doc_id: "doc-re" },
        { name: "Cap Rate", value: "5.5%", source_doc_id: "doc-re" },
      ],
      evidence_ids: [EVIDENCE_ID],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.metrics_analyzed.length).toBeGreaterThan(0);
    expect(result.overall_score).not.toBeNull();
    // At least one benchmarked KPI should yield a non-neutral rating.
    expect(result.metrics_analyzed.some((m) => m.rating !== "Missing")).toBe(true);
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
      primary_doc_type: "pitch_deck",
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.proxy_signals.page_count_appropriate).toBe(false);
    expect(result.weaknesses.length).toBeGreaterThan(0);
  });

  test("sparse/garbled headings => heading reliability unknown reduces heading penalty weight", async () => {
    const noisy = Array.from({ length: 300 }, () => "@@@###$$$%%%^^^&&&***").join("");

    const result = await visualDesignScorer.analyze({
      page_count: 12,
      file_size_bytes: 4_200_000,
      total_text_chars: 4_800,
      headings: ["", "WebMax Confidential"],
      text_summary: noisy,
      debug_scoring: true,
      evidence_ids: [EVIDENCE_ID],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.design_score).not.toBeNull();
    expect(result.design_score!).toBeGreaterThanOrEqual(85);

    const signals = (result as any).debug_scoring?.signals || [];
    const headingReliability = signals.find((s: any) => s.key === "heading_reliability")?.value;
    expect(headingReliability).toBe("unknown");

    const penalties = (result as any).debug_scoring?.penalties || [];
    const formattingIssue = penalties.find((p: any) => p.key === "formatting_issue");
    expect(formattingIssue?.note).toContain("formatting weight x0.2");
  });

  test("page_count 16 pitch_deck does not trigger too-long penalty until >=18", async () => {
    const result = await visualDesignScorer.analyze({
      page_count: 16,
      file_size_bytes: 5_600_000,
      total_text_chars: 6_000,
      headings: Array.from({ length: 16 }, (_, i) => `Slide ${i + 1}`),
      primary_doc_type: "pitch_deck",
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.proxy_signals.page_count_appropriate).toBe(true);
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

  test("WebMax Excel: derives runway from extracted_metrics", async () => {
    const result = await financialHealthCalculator.analyze({
      extracted_metrics: [
        { name: "cash_balance", value: "$1.2M", source_doc_id: "doc-webmax-xlsx" },
        { name: "burn_rate", value: "$100k", source_doc_id: "doc-webmax-xlsx" },
      ],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.runway_months).toBe(12);
    expect(result.health_score).not.toBeNull();
    expect(result.metrics.cash_balance).toBeGreaterThan(0);
    expect(result.metrics.burn_rate).toBeGreaterThan(0);
    expect(result.coverage).toBeGreaterThanOrEqual(0.4);
  });

  test("WebMax Excel (DIO doc payload): derives cash/burn/runway from keyFinancialMetrics", async () => {
    const result = await financialHealthCalculator.analyze({
      // DIO input doc-style payload (Excel)
      keyFinancialMetrics: {
        cash_balance: "$1.2M",
        burn_rate: "$100k",
      },
      evidence_ids: [EVIDENCE_ID],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.runway_months).toBe(12);
    expect(result.metrics.cash_balance).toBeGreaterThan(0);
    expect(result.metrics.burn_rate).toBeGreaterThan(0);
    // Partial inputs should still be ok but not full coverage
    expect(result.coverage).toBeGreaterThanOrEqual(0.4);
    expect(result.coverage).toBeLessThan(1);
    expect(result.health_score).not.toBeNull();
  });

  test("WebMax Excel (keyFinancialMetrics {avg,max,min} objects): derives runway + health_score (annual burn normalized)", async () => {
    const result = await financialHealthCalculator.analyze({
      keyFinancialMetrics: {
        "Ending Cash Balance": { avg: "$1.2M", max: "$1.3M", min: "$1.1M" },
        "Annual Burn Rate": { avg: "$1.2M", max: "$1.4M", min: "$1.0M" },
      },
      evidence_ids: [EVIDENCE_ID],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.metrics.cash_balance).toBeGreaterThan(0);
    expect(result.metrics.burn_rate).toBeGreaterThan(0);
    // $1.2M annual burn => $100k/month; runway: $1.2M / $100k = 12 months
    expect(result.runway_months).toBe(12);
    expect(result.health_score).not.toBeNull();
  });
});

describe("RiskAssessmentEngine", () => {
  test("detects multiple risks from pitch text and metrics", async () => {
    const fullText =
      "We are pre-revenue with an MVP. This is a crowded market with many competitors. We are looking for a CTO. Regulatory compliance is required.";

    const result = await riskAssessmentEngine.analyze({
      pitch_text: fullText,
      documents: [{ full_text: fullText }],
      evidence: [],
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
      documents: [{ full_text: "Too short" }],
      evidence: [],
      headings: [],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.overall_risk_score).toBeNull();
    expect(result.total_risks).toBe(0);
  });

  test("ok + neutral baseline when no risks detected", async () => {
    const fullText =
      "We have a clear plan, a differentiated product, and strong customer interest. The team is complete and execution is on track.";

    const result = await riskAssessmentEngine.analyze({
      pitch_text: fullText,
      documents: [{ full_text: fullText }],
      evidence: [],
      headings: ["Problem", "Solution", "Market", "Team", "Traction"],
      evidence_ids: [EVIDENCE_ID],
    });

    expect(result.status).toBe("ok");
    expect(result.total_risks).toBe(0);
    expect(result.overall_risk_score).toBe(50);
    expect(result.note || "").toMatch(/neutral baseline=50/i);
  });

  test("real_estate_underwriting: detects protections in documents full_text and reduces risk", async () => {
    const reText = [
      "Absolute NNN lease.",
      "20-year lease.",
      "Corporate guaranty provided.",
      "100% leased.",
      "DSCR is 1.30 and LTV is 60%.",
    ].join(" ");

    const result = await riskAssessmentEngine.analyze({
      pitch_text: "(ignored)",
      documents: [{ full_text: reText }],
      evidence: [],
      headings: ["Lease", "Financials"],
      policy_id: "real_estate_underwriting",
      evidence_ids: [EVIDENCE_ID],
    } as any);

    expect(result.status).toBe("ok");
    expect(result.overall_risk_score as number).toBeLessThanOrEqual(30);
    expect(String(result.note || "")).toContain("RE protections detected");
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

describe("debug_scoring traces", () => {
  test("SlideSequenceAnalyzer: present only when enabled", async () => {
    const baseInput = {
      headings: ["Problem", "Solution", "Market", "Product", "Traction", "Team", "Financials", "Ask"],
      evidence_ids: [EVIDENCE_ID],
    };

    const off = await slideSequenceAnalyzer.analyze(baseInput);
    expect((off as any).debug_scoring).toBeUndefined();

    const on = await slideSequenceAnalyzer.analyze({ ...baseInput, debug_scoring: true } as any);
    expect((on as any).debug_scoring).toBeDefined();
    expect((on as any).debug_scoring.input_summary).toBeDefined();
  });

  test("MetricBenchmarkValidator: present only when enabled", async () => {
    const baseInput = {
      text: "MRR: $50K. Gross Margin: 80%. Growth: 150% YoY.",
      industry: "SaaS",
      evidence_ids: [EVIDENCE_ID],
    };

    const off = await metricBenchmarkValidator.analyze(baseInput);
    expect((off as any).debug_scoring).toBeUndefined();

    const on = await metricBenchmarkValidator.analyze({ ...baseInput, debug_scoring: true } as any);
    expect((on as any).debug_scoring).toBeDefined();
    expect((on as any).debug_scoring.final).toBeDefined();
  });

  test("VisualDesignScorer: present only when enabled", async () => {
    const baseInput = {
      page_count: 12,
      file_size_bytes: 4_200_000,
      total_text_chars: 4_800,
      headings: Array.from({ length: 12 }, (_, i) => `Slide ${i + 1}`),
      evidence_ids: [EVIDENCE_ID],
    };

    const off = await visualDesignScorer.analyze(baseInput);
    expect((off as any).debug_scoring).toBeUndefined();

    const on = await visualDesignScorer.analyze({ ...baseInput, debug_scoring: true } as any);
    expect((on as any).debug_scoring).toBeDefined();
    expect((on as any).debug_scoring.signals.length).toBeGreaterThan(0);
  });

  test("NarrativeArcDetector: present only when enabled", async () => {
    const baseInput = {
      slides: [
        { heading: "Problem", text: "The problem is critical and causes pain." },
        { heading: "Vision", text: "We imagine a better future and opportunity." },
        { heading: "Solution", text: "Our solution is a new approach." },
        { heading: "Traction", text: "We have traction and revenue growth." },
        { heading: "Ask", text: "We are raising $5M now." },
      ],
      evidence_ids: [EVIDENCE_ID],
    };

    const off = await narrativeArcDetector.analyze(baseInput);
    expect((off as any).debug_scoring).toBeUndefined();

    const on = await narrativeArcDetector.analyze({ ...baseInput, debug_scoring: true } as any);
    expect((on as any).debug_scoring).toBeDefined();
    expect((on as any).debug_scoring.final.score).not.toBeNull();
  });

  test("FinancialHealthCalculator: present only when enabled", async () => {
    const baseInput = {
      cash_balance: 1_200_000,
      burn_rate: 100_000,
      evidence_ids: [EVIDENCE_ID],
    };

    const off = await financialHealthCalculator.analyze(baseInput);
    expect((off as any).debug_scoring).toBeUndefined();

    const on = await financialHealthCalculator.analyze({ ...baseInput, debug_scoring: true } as any);
    expect((on as any).debug_scoring).toBeDefined();
    expect((on as any).debug_scoring.input_summary.completeness.score).toBeGreaterThanOrEqual(0);
  });

  test("RiskAssessmentEngine: present only when enabled", async () => {
    const baseInput = {
      pitch_text: "We are pre-revenue with an MVP in a crowded market.",
      headings: ["Problem", "Solution"],
      evidence_ids: [EVIDENCE_ID],
    };

    const off = await riskAssessmentEngine.analyze(baseInput);
    expect((off as any).debug_scoring).toBeUndefined();

    const on = await riskAssessmentEngine.analyze({ ...baseInput, debug_scoring: true } as any);
    expect((on as any).debug_scoring).toBeDefined();
    expect((on as any).debug_scoring.final).toBeDefined();
  });
});
