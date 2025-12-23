import { buildScoreExplanationFromDIO, getContextWeights } from "../score-explanation";

describe("score_explanation", () => {
  it("should exist and sum contributions to overall_score (within rounding)", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000001",
      deal_id: "00000000-0000-4000-8000-000000000002",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        deal_type: "startup_raise",
        vertical: "saas",
        stage: "seed",
        confidence: 0.9,
      },
      inputs: {
        documents: [],
        evidence: [],
        config: {
          analyzer_versions: {
            slide_sequence: "1.0.0",
            metric_benchmark: "1.0.0",
            visual_design: "1.0.0",
            narrative_arc: "1.0.0",
            financial_health: "1.0.0",
            risk_assessment: "1.0.0",
          },
          features: {
            tavily_enabled: false,
            mcp_enabled: false,
            llm_synthesis_enabled: false,
          },
          parameters: {
            max_cycles: 3,
            depth_threshold: 2,
            min_confidence: 0.7,
          },
        },
      },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.8,
          score: 40,
          deviations: [{ expected: "Problem", actual: "Intro", position: 1 }],
        },
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.6,
          confidence: 0.7,
          overall_score: 60,
          metrics_analyzed: [{ metric: "ARR", value: 10, benchmark_value: 12, benchmark_source: "test", rating: "Adequate", deviation_pct: -16.7, evidence_id: "00000000-0000-4000-8000-000000000010" }],
        },
        visual_design: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          design_score: 50,
          strengths: [],
          weaknesses: [],
        },
        narrative_arc: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          pacing_score: 70,
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.5,
          confidence: 0.6,
          health_score: 80,
        },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.8,
          confidence: 0.5,
          overall_risk_score: 58,
        },
      },
      risk_map: [{ severity: "medium" }],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    expect(explanation).toBeDefined();
    expect(explanation.aggregation.method).toBe("weighted_mean");

    const contributions = Object.values(explanation.components)
      .map((c: any) => c.weighted_contribution)
      .filter((v: any) => typeof v === "number" && Number.isFinite(v));

    const sum = contributions.reduce((a: number, b: number) => a + b, 0);

    expect(explanation.totals.unadjusted_overall_score).not.toBeNull();
    expect(Math.round(sum)).toBe(explanation.totals.unadjusted_overall_score as number);

    // overall_score is the evidence/DD adjusted score.
    expect(explanation.totals.overall_score).not.toBeNull();
    const expectedAdjusted = Math.round(
      (explanation.totals.unadjusted_overall_score as number) * explanation.totals.adjustment_factor
        + 50 * (1 - explanation.totals.adjustment_factor)
    );
    expect(explanation.totals.overall_score as number).toBe(expectedAdjusted);
  });

  it("should not penalize overall_score when metric_benchmark is null/insufficient", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000011",
      deal_id: "00000000-0000-4000-8000-000000000012",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        deal_type: "startup_raise",
        vertical: "saas",
        stage: "seed",
        confidence: 0.9,
      },
      inputs: {
        documents: [],
        evidence: [],
        config: {
          analyzer_versions: {
            slide_sequence: "1.0.0",
            metric_benchmark: "1.0.0",
            visual_design: "1.0.0",
            narrative_arc: "1.0.0",
            financial_health: "1.0.0",
            risk_assessment: "1.0.0",
          },
          features: {
            tavily_enabled: false,
            mcp_enabled: false,
            llm_synthesis_enabled: false,
          },
          parameters: {
            max_cycles: 3,
            depth_threshold: 2,
            min_confidence: 0.7,
          },
        },
      },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.8,
          score: 40,
          deviations: [],
        },
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,
          overall_score: null,
          metrics_analyzed: [],
        },
        visual_design: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          design_score: 50,
          strengths: [],
          weaknesses: [],
        },
        narrative_arc: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          pacing_score: 70,
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.5,
          confidence: 0.6,
          health_score: 80,
        },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.8,
          confidence: 0.5,
          overall_risk_score: 58,
        },
      },
      risk_map: [{ severity: "medium" }],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    // metric_benchmark is excluded and should not reduce overall_score.
    expect(explanation.aggregation.excluded_components).toEqual(
      expect.arrayContaining([{ component: "metric_benchmark", reason: "status_not_ok" }])
    );

    // Expected weighted mean (pitch deck base weights):
    // slide 40 (w=1), visual 50 (w=1), narrative 70 (w=1.5), financial 80 (w=0.5), risk inverted 42 (w=1)
    // sum = 40 + 50 + 105 + 40 + 42 = 277; totalWeight = 5 => 55.4 => 55
    expect(explanation.totals.unadjusted_overall_score).toBe(55);

    const expectedAdjusted = Math.round(
      (explanation.totals.unadjusted_overall_score as number) * explanation.totals.adjustment_factor
        + 50 * (1 - explanation.totals.adjustment_factor)
    );
    expect(explanation.totals.overall_score).toBe(expectedAdjusted);
  });

  it("blends low-confidence included component toward neutral baseline (prevents tanking overall)", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000031",
      deal_id: "00000000-0000-4000-8000-000000000032",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        deal_type: "startup_raise",
        vertical: "saas",
        stage: "seed",
        confidence: 1,
      },
      inputs: { documents: [], evidence: [], config: { features: {} } },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.3,
          score: 0,
          deviations: [],
        },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_score: 80, metrics_analyzed: [{ metric: "ARR" }] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, design_score: 80, strengths: [], weaknesses: [] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, pacing_score: 80 },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, health_score: 80 },
        risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, overall_risk_score: 20 },
      },
      risk_map: [{ severity: "medium" }],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    // Slide sequence is included but low confidence -> blended: effective = 0*0.3 + 50*0.7 = 35
    // Pitch deck weights total = 6.0 => overall = round((35 + 80 + 80 + 1.5*80 + 0.5*80 + 80) / 6)
    // = round(435/6) = round(72.5) = 73
    expect(explanation.aggregation.included_components).toEqual(
      expect.arrayContaining(["slide_sequence", "metric_benchmark", "visual_design", "narrative_arc", "financial_health", "risk_assessment"])
    );
    expect(explanation.components.slide_sequence.notes.join("\n")).toMatch(/blended toward neutral baseline/i);
    expect(explanation.totals.unadjusted_overall_score).toBe(73);

    const expectedAdjusted = Math.round(
      (explanation.totals.unadjusted_overall_score as number) * explanation.totals.adjustment_factor
        + 50 * (1 - explanation.totals.adjustment_factor)
    );
    expect(explanation.totals.overall_score).toBe(expectedAdjusted);
  });

  it("should use neutral 50 baseline for no-signal risk on startup pitch decks", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000021",
      deal_id: "00000000-0000-4000-8000-000000000022",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        deal_type: "startup_raise",
        vertical: "saas",
        stage: "seed",
        confidence: 0.9,
      },
      inputs: {
        documents: [],
        evidence: [],
        config: {
          analyzer_versions: {
            slide_sequence: "1.0.0",
            metric_benchmark: "1.0.0",
            visual_design: "1.0.0",
            narrative_arc: "1.0.0",
            financial_health: "1.0.0",
            risk_assessment: "1.0.0",
          },
          features: {
            tavily_enabled: false,
            mcp_enabled: false,
            llm_synthesis_enabled: false,
          },
          parameters: {
            max_cycles: 3,
            depth_threshold: 2,
            min_confidence: 0.7,
          },
        },
      },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.8,
          score: 40,
          deviations: [],
        },
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.6,
          confidence: 0.7,
          overall_score: 60,
          metrics_analyzed: [{ metric: "ARR", value: 10, benchmark_value: 12, benchmark_source: "test", rating: "Adequate", deviation_pct: -16.7, evidence_id: "00000000-0000-4000-8000-000000000010" }],
        },
        visual_design: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          design_score: 50,
          strengths: [],
          weaknesses: [],
        },
        narrative_arc: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          pacing_score: 70,
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.5,
          confidence: 0.6,
          health_score: 80,
        },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.8,
          confidence: 0.5,
          overall_risk_score: 0,
        },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    expect(explanation.aggregation.included_components).toEqual(
      expect.arrayContaining(["risk_assessment"])
    );
    expect(explanation.aggregation.excluded_components).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ component: "risk_assessment" })])
    );
    expect(explanation.components.risk_assessment.inverted_investment_score).toBe(50);
    expect(explanation.components.risk_assessment.notes.join("\n")).toMatch(/neutral baseline/i);

    // Included 6 components: 40 + 60 + 50 + 70 + 80 + (risk baseline 50) = 350 => /6 = 58.33 => 58
    expect(explanation.totals.unadjusted_overall_score).toBe(58);

    const expectedAdjusted = Math.round(
      (explanation.totals.unadjusted_overall_score as number) * explanation.totals.adjustment_factor
        + 50 * (1 - explanation.totals.adjustment_factor)
    );
    expect(explanation.totals.overall_score).toBe(expectedAdjusted);
  });

  it("should adjust pitch deck weights for traction-first patterns", () => {
    const now = new Date().toISOString();

    const mkDio = (pattern_match: string): any => ({
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000031",
      deal_id: "00000000-0000-4000-8000-000000000032",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        deal_type: "startup_raise",
        vertical: "saas",
        stage: "seed",
        confidence: 0.9,
      },
      inputs: {
        documents: [],
        evidence: [],
        config: {
          analyzer_versions: {
            slide_sequence: "1.0.0",
            metric_benchmark: "1.0.0",
            visual_design: "1.0.0",
            narrative_arc: "1.0.0",
            financial_health: "1.0.0",
            risk_assessment: "1.0.0",
          },
          features: {
            tavily_enabled: false,
            mcp_enabled: false,
            llm_synthesis_enabled: false,
          },
          parameters: {
            max_cycles: 3,
            depth_threshold: 2,
            min_confidence: 0.7,
          },
        },
      },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.8,
          score: 60,
          pattern_match,
          deviations: [],
        },
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.6,
          confidence: 0.7,
          overall_score: 60,
          metrics_analyzed: [{ metric: "ARR", value: 10, benchmark_value: 12, benchmark_source: "test", rating: "Adequate", deviation_pct: -16.7, evidence_id: "00000000-0000-4000-8000-000000000010" }],
        },
        visual_design: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          design_score: 60,
          strengths: [],
          weaknesses: [],
        },
        narrative_arc: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.7,
          confidence: 0.6,
          pacing_score: 60,
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.5,
          confidence: 0.6,
          health_score: 60,
        },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.8,
          confidence: 0.5,
          overall_risk_score: 50,
        },
      },
      risk_map: [{ severity: "medium" }],
    });

    const normal = buildScoreExplanationFromDIO(mkDio("Standard"));
    const traction = buildScoreExplanationFromDIO(mkDio("Traction-First"));

    expect(normal.aggregation.weights.slide_sequence).toBeCloseTo(1.0);
    expect(normal.aggregation.weights.narrative_arc).toBeCloseTo(1.5);

    expect(traction.aggregation.weights.slide_sequence).toBeCloseTo(0.6);
    expect(traction.aggregation.weights.narrative_arc).toBeCloseTo(1.9);

    // Unchanged pitch-deck base weights
    expect(traction.aggregation.weights.visual_design).toBeCloseTo(1.0);
    expect(traction.aggregation.weights.metric_benchmark).toBeCloseTo(1.0);
    expect(traction.aggregation.weights.financial_health).toBeCloseTo(0.5);
    expect(traction.aggregation.weights.risk_assessment).toBeCloseTo(1.0);
  });

  it("Vintara: exec_summary weights downweight slide/visual so >15 pages isn't primary penalty", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000101",
      deal_id: "00000000-0000-4000-8000-000000000102",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "exec_summary",
        deal_type: "startup_raise",
        vertical: "saas",
        stage: "seed",
        confidence: 0.9,
      },
      inputs: {
        documents: [{ document_id: "00000000-0000-4000-8000-000000000150", title: "Vintara", type: "exec_summary", version_hash: "0".repeat(64), extracted_at: now, page_count: 22, metrics: [], headings: [], summary: "" }],
        evidence: [],
        config: { analyzer_versions: { slide_sequence: "1.0.0", metric_benchmark: "1.0.0", visual_design: "1.0.0", narrative_arc: "1.0.0", financial_health: "1.0.0", risk_assessment: "1.0.0" }, features: { tavily_enabled: false, mcp_enabled: false, llm_synthesis_enabled: false }, parameters: { max_cycles: 3, depth_threshold: 2, min_confidence: 0.7 } },
      },
      analyzer_results: {
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.8, score: 10, deviations: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.6, design_score: 10, strengths: [], weaknesses: ["Too many pages"] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.6, pacing_score: 90 },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.6, confidence: 0.7, overall_score: 90, metrics_analyzed: [{ metric: "ARR", value: 10, benchmark_value: 12, benchmark_source: "test", rating: "Adequate", deviation_pct: -16.7, evidence_id: "00000000-0000-4000-8000-000000000010" }] },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.6, health_score: 90 },
        risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.5, overall_risk_score: 50, total_risks: 1, critical_count: 0, high_count: 0, risks_by_category: { market: [], team: [], financial: [], execution: [] }, evidence_ids: [] },
      },
      risk_map: [{ severity: "medium" }],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    // Slide/visual are present but should be downweighted relative to narrative/metrics/financial.
    expect(explanation.aggregation.weights.slide_sequence).toBeLessThan(explanation.aggregation.weights.narrative_arc);
    expect(explanation.aggregation.weights.visual_design).toBeLessThan(explanation.aggregation.weights.metric_benchmark);

    // Overall score should not be dominated by slide/visual low scores.
    expect(explanation.totals.overall_score).not.toBeNull();
    expect(explanation.totals.overall_score as number).toBeGreaterThan(60);
  });

  it("business_plan_im weights: slide/visual are downweighted below metrics/financial", () => {
    const weights = getContextWeights(
      { primary_doc_type: "business_plan_im" },
      { documents_count: 1, total_pages: 30, types: ["business_plan_im"] }
    );

    expect(weights.slide_sequence).toBeLessThan(weights.metric_benchmark);
    expect(weights.slide_sequence).toBeLessThan(weights.financial_health);
    expect(weights.visual_design).toBeLessThan(weights.metric_benchmark);
    expect(weights.visual_design).toBeLessThan(weights.financial_health);

    // IMs still benefit from coherent structure.
    expect(weights.narrative_arc).toBeGreaterThan(0);
  });

  it("business_plan_im: overall score is not driven by slide/page-count heuristics", () => {
    const now = new Date().toISOString();

    const mkDio = (slideScore: number, designScore: number): any => ({
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000201",
      deal_id: "00000000-0000-4000-8000-000000000202",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "business_plan_im",
        deal_type: "acquisition",
        vertical: "consumer",
        stage: "growth",
        confidence: 1,
      },
      inputs: {
        // Page count is intentionally high to mimic IMs that would otherwise trigger slide/page heuristics.
        documents: [{ document_id: "00000000-0000-4000-8000-000000000250", title: "Vintara-like IM", type: "business_plan_im", version_hash: "0".repeat(64), extracted_at: now, page_count: 48, metrics: [], headings: [], summary: "" }],
        evidence: [],
        config: { analyzer_versions: { slide_sequence: "1.0.0", metric_benchmark: "1.0.0", visual_design: "1.0.0", narrative_arc: "1.0.0", financial_health: "1.0.0", risk_assessment: "1.0.0" }, features: { tavily_enabled: false, mcp_enabled: false, llm_synthesis_enabled: false }, parameters: { max_cycles: 3, depth_threshold: 2, min_confidence: 0.7 } },
      },
      analyzer_results: {
        // These are the heuristics we want to avoid dominating IM scoring.
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.9, score: slideScore, deviations: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.9, design_score: designScore, strengths: [], weaknesses: [] },

        // Fundamentals remain the primary drivers.
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.9, pacing_score: 80 },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.6, confidence: 0.9, overall_score: 90, metrics_analyzed: [{ metric: "ARR", value: 10, benchmark_value: 12, benchmark_source: "test", rating: "Adequate", deviation_pct: -16.7, evidence_id: "00000000-0000-4000-8000-000000000010" }] },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.9, health_score: 85 },
        // Risk is inverted into an investment score; 30 risk => 70 investment.
        risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.9, overall_risk_score: 30, total_risks: 1, critical_count: 0, high_count: 0, risks_by_category: { market: [], team: [], financial: [], execution: [] }, evidence_ids: [] },
      },
      risk_map: [{ severity: "medium" }],
    });

    const badSlides = buildScoreExplanationFromDIO(mkDio(0, 0));
    const greatSlides = buildScoreExplanationFromDIO(mkDio(100, 100));

    // business_plan_im should not be primarily driven by slide/visual heuristics.
    expect(badSlides.aggregation.weights.slide_sequence).toBe(0);
    expect(badSlides.aggregation.weights.visual_design).toBe(0);

    // Insensitivity check: extreme slide/visual scores do not materially change overall.
    expect(badSlides.totals.overall_score).not.toBeNull();
    expect(greatSlides.totals.overall_score).not.toBeNull();
    expect(Math.abs((badSlides.totals.overall_score as number) - (greatSlides.totals.overall_score as number))).toBeLessThanOrEqual(1);

    // And overall should still be meaningfully high based on fundamentals.
    expect(badSlides.totals.overall_score as number).toBeGreaterThan(70);
  });

  it("WebMax: pitch_deck weights are used even when attachments include financials", () => {
    const weights = getContextWeights(
      { primary_doc_type: "pitch_deck" },
      { documents_count: 2, total_pages: 20, types: ["pitch_deck", "financials"] }
    );

    expect(weights.narrative_arc).toBeCloseTo(1.5);
    expect(weights.slide_sequence).toBeCloseTo(1.0);
    expect(weights.visual_design).toBeCloseTo(1.0);
    expect(weights.metric_benchmark).toBeCloseTo(1.0);
  });

  it("adds components[component].debug_ref when analyzer debug_scoring exists", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-00000000d000",
      deal_id: "00000000-0000-4000-8000-00000000d001",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: { primary_doc_type: "pitch_deck" },
      inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 0.8,
          score: 80,
          pattern_match: "Problem-First",
          sequence_detected: ["problem"],
          expected_sequence: ["problem"],
          deviations: [],
          evidence_ids: [],
          debug_scoring: { input_summary: { completeness: { score: 1, notes: ["test"] }, signals_count: 1 }, signals: [{ key: "x" }], penalties: [], bonuses: [], final: { score: 80 } },
        },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, metrics_analyzed: [], overall_score: null, evidence_ids: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: { page_count_appropriate: false, image_to_text_ratio_balanced: false, consistent_formatting: false }, strengths: [], weaknesses: [], evidence_ids: [] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, archetype: "Unknown", archetype_confidence: 0, pacing_score: null, emotional_beats: [], evidence_ids: [] },
        financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
        risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, overall_risk_score: null, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    expect(explanation.components.slide_sequence.debug_ref).toBe("dio.analyzer_results.slide_sequence.debug_scoring");
    expect(explanation.components.metric_benchmark.debug_ref).toBeUndefined();
  });
});
