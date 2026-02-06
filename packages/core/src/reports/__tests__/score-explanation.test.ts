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

  it("never skips components: missing analyzer results => all components present with penalties", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000901",
      deal_id: "00000000-0000-4000-8000-000000000902",
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
      analyzer_results: {},
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    expect(explanation.aggregation.included_components).toEqual(
      expect.arrayContaining(["slide_sequence", "metric_benchmark", "visual_design", "narrative_arc", "financial_health", "risk_assessment"])
    );
    expect(explanation.aggregation.excluded_components).toEqual([]);

    for (const key of ["slide_sequence", "metric_benchmark", "visual_design", "narrative_arc", "financial_health", "risk_assessment"]) {
      const c: any = (explanation.components as any)[key];
      expect(c).toBeTruthy();
      expect(c.status).toBe("penalized_missing");
      expect(c.used_score).toBe(50);
      expect(c.penalty).toBeGreaterThan(0);
      expect(typeof c.weighted_contribution).toBe("number");
    }

    // Deterministic expectation: when no score-bearing analyzer outputs are usable,
    // the baseline is pinned and overall_score is set to neutral (50).
    expect(explanation.totals.unadjusted_pinned).toBe(true);
    expect(explanation.totals.unadjusted_overall_score).toBeNull();
    expect(explanation.totals.overall_score).toBe(50);
  });

  it("adds understanding_v1 with concrete diligence items for neutral baseline (consumer ecommerce)", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000009001",
      deal_id: "00000000-0000-4000-8000-000000009002",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        deal_type: "startup_raise",
        vertical: "consumer",
        stage: "seed",
        confidence: 0.8,
      },
      dio: {
        deal_classification_v1: {
          selected_policy: "consumer_ecommerce_brand_v1",
        },
        phase1: {
          executive_summary_v1: {
            title: "Palm",
            one_liner: "Consumer brand",
            deal_type: "startup_raise",
            raise: "TBD",
            business_model: "DTC + wholesale",
            traction_signals: [],
            key_risks_detected: [],
            unknowns: [],
            confidence: { overall: "med" },
            evidence: [],
          },
          decision_summary_v1: {
            score: 50,
            recommendation: "CONSIDER",
            reasons: [],
            blockers: [],
            next_requests: [],
            confidence: "med",
          },
          claims: [],
          coverage: {
            sections: {
              product: "present",
              market: "present",
              traction: "partial",
              team: "missing",
              terms: "missing",
              risk: "partial",
              other: "missing",
            },
          },
        },
      },
      inputs: {
        documents: [
          {
            id: "doc-1",
            type: "pitch_deck",
            page_count: 12,
            metrics: [],
          },
        ],
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
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          overall_score: null,
          metrics_analyzed: [],
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          health_score: null,
          metrics: {},
        },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0,
          overall_risk_score: null,
          total_risks: 0,
        },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);
    expect(explanation.totals.overall_score).toBe(50);

    expect(explanation.understanding_v1).toBeTruthy();
    expect(Array.isArray(explanation.understanding_v1?.diligence_open_items)).toBe(true);

    const diligence = explanation.understanding_v1?.diligence_open_items?.map((i) => i.text) ?? [];

    // Must surface diligence/open items when score is neutral.
    expect(diligence.length).toBeGreaterThanOrEqual(4);

    expect(diligence).toEqual(
      expect.arrayContaining([
        "Margin by channel (DTC vs wholesale) and contribution margin.",
        "Inventory and working capital requirements for wholesale growth.",
        "CAC and unit economics at scaled spend (LTV/CAC, payback), not just current efficiency.",
        "Confirm multi-year financial tables and accounting basis (cash vs accrual) used for reported figures.",
      ])
    );
  });

  it("includes non-ok components with neutral baseline + penalty (no skipping)", () => {
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

    // Non-ok components are not excluded; they are neutral+penalized.
    expect(explanation.aggregation.excluded_components).toEqual([]);
    expect(explanation.components.metric_benchmark.status).toBe("penalized_non_ok");
    expect(explanation.components.metric_benchmark.used_score).toBe(50);
    expect(explanation.components.metric_benchmark.penalty).toBeGreaterThan(0);
    expect(explanation.components.metric_benchmark.reason).toMatch(/no financial metrics extracted/i);

    // v2 decision scoring: metric_benchmark is diagnostic-only; aggregation uses financial_health + risk_assessment.
    // totalWeight = 0.5 + 1 = 1.5
    // financial 80
    // risk inverted 58 -> 42
    // unadjusted = round((80*0.5 + 42*1)/1.5) = round(54.666..) = 55
    expect(explanation.totals.unadjusted_overall_score).toBe(55);

    const expectedAdjusted = Math.round(
      (explanation.totals.unadjusted_overall_score as number) * explanation.totals.adjustment_factor
        + 50 * (1 - explanation.totals.adjustment_factor)
    );
    expect(explanation.totals.overall_score).toBe(expectedAdjusted);
  });

  it("does not render 0-month runway semantics when burn is non-positive", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000009901",
      deal_id: "00000000-0000-4000-8000-000000009902",
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
      inputs: { documents: [], evidence: [], config: { features: {} } },
      analyzer_results: {
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.8, score: 60, deviations: [] },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, overall_score: 50, metrics_analyzed: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, design_score: 50, strengths: [], weaknesses: [] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, pacing_score: 50 },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.6,
          confidence: 0.7,
          health_score: 70,
          metrics: {
            burn_rate: -1000,
            cash_balance: 50000,
          },
          runway_months: null,
          burn_multiple: null,
          risks: [],
          disclosures_v1: [
            {
              code: "runway_not_applicable_nonpositive_burn",
              severity: "info",
              message: "Runway is not applicable when burn is non-positive.",
            },
          ],
        },
        risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, overall_risk_score: 50 },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    const fh: any = (explanation.components as any).financial_health;
    expect(fh).toBeTruthy();

    const noteText = Array.isArray(fh.notes) ? fh.notes.join("\n") : "";
    expect(noteText).toContain("runway_not_applicable_nonpositive_burn");
    expect(noteText.toLowerCase()).not.toContain("0 months");
    expect(noteText.toLowerCase()).not.toContain("critical runway");

    const flagsText = Array.isArray(fh.red_flags) ? fh.red_flags.join("\n") : "";
    expect(flagsText.toLowerCase()).not.toContain("critical runway");
  });

  it("when runway_not_applicable_nonpositive_burn disclosure present, DIO JSON contains no forbidden runway strings and disclosure is surfaced", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000009911",
      deal_id: "00000000-0000-4000-8000-000000009912",
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
      inputs: { documents: [], evidence: [], config: { features: {} } },
      analyzer_results: {
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 0.8, score: 60, deviations: [] },
        metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, overall_score: 50, metrics_analyzed: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, design_score: 50, strengths: [], weaknesses: [] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, pacing_score: 50 },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 0.6,
          confidence: 0.7,
          health_score: 70,
          metrics: {
            burn_rate: 0,
            cash_balance: 50000,
          },
          runway_months: null,
          burn_multiple: null,
          risks: [],
          disclosures_v1: [
            {
              code: "runway_not_applicable_nonpositive_burn",
              severity: "info",
              message: "Runway not applicable: burn rate is zero or negative.",
            },
          ],
        },
        risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, overall_risk_score: 50 },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);
    const fh: any = (explanation.components as any).financial_health;

    // Disclosure appears in a user-facing channel (score explanation notes)
    const noteText = Array.isArray(fh?.notes) ? fh.notes.join("\n") : "";
    expect(noteText).toContain("runway_not_applicable_nonpositive_burn");

    // Build a representative DIO JSON payload (similar shape to stored dio_data)
    const dioData: any = {
      ...dio,
      score_explanation: explanation,
      dio: {
        phase1: {
          executive_summary_v2: {
            missing: ["runway_not_applicable_nonpositive_burn"],
          },
          decision_summary_v1: {
            reasons: [
              "[runway_not_applicable_nonpositive_burn] Runway is not applicable when burn is non-positive; do not treat this as a low-runway signal.",
            ],
          },
        },
      },
    };

    const blob = JSON.stringify(dioData);
    expect(blob).not.toContain("0 months");
    expect(blob).not.toContain("Critical runway");
    expect(blob.toLowerCase()).not.toContain("missing runway");
  });

  it("surfaces Phase 1 no_pages_with_understanding disclosure as missing-evidence gaps", () => {
    const now = new Date().toISOString();

    const dio: any = {
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000009921",
      deal_id: "00000000-0000-4000-8000-000000009922",
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
      inputs: { documents: [], evidence: [], config: { features: {} } },
      dio: {
        phase1: {
          disclosures_v1: [
            {
              code: "no_pages_with_understanding",
              message: "No pitch deck pages contained usable text understanding; slide segmentation unavailable.",
            },
          ],
        },
      },
      analyzer_results: {
        slide_sequence: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,
          score: null,
          pattern_match: "None",
          sequence_detected: [],
          expected_sequence: [],
          deviations: [],
          evidence_ids: [],
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
          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,
          design_score: null,
          proxy_signals: {},
          strengths: [],
          weaknesses: [],
          evidence_ids: [],
        },
        narrative_arc: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,
          pacing_score: null,
          archetype: "unknown",
          archetype_confidence: 0.1,
          emotional_beats: [],
          evidence_ids: [],
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,
          runway_months: null,
          burn_multiple: null,
          health_score: null,
          metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null },
          risks: [],
          evidence_ids: [],
        },
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,
          overall_risk_score: null,
          risks_by_category: { market: [], team: [], financial: [], execution: [] },
          total_risks: 0,
          critical_count: 0,
          high_count: 0,
          evidence_ids: [],
        },
      },
      risk_map: [],
    };

    const explanation = buildScoreExplanationFromDIO(dio);

    const ss: any = (explanation.components as any).slide_sequence;
    const na: any = (explanation.components as any).narrative_arc;
    const ra: any = (explanation.components as any).risk_assessment;

    expect(Array.isArray(ss?.gaps) ? ss.gaps : []).toContain("page_understanding_missing");
    expect(Array.isArray(na?.gaps) ? na.gaps : []).toContain("page_understanding_missing");
    expect(Array.isArray(ra?.gaps) ? ra.gaps : []).toContain("page_understanding_missing");

    const ssReasons = Array.isArray(ss?.reasons) ? ss.reasons.join("\n") : "";
    expect(ssReasons).toContain("no_pages_with_understanding");
    expect(ssReasons).toContain("No pitch deck pages contained usable text understanding");
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

    // v2: slide_sequence remains computed (diagnostic) but does not contribute to overall_score.
    expect(explanation.aggregation.included_components).toEqual(
      expect.arrayContaining(["metric_benchmark", "financial_health", "risk_assessment"])
    );
    expect(explanation.components.slide_sequence.notes.join("\n")).toMatch(/blended toward neutral baseline/i);
    expect(explanation.totals.unadjusted_overall_score).toBe(80);

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
      expect.arrayContaining(["metric_benchmark", "financial_health", "risk_assessment"])
    );
    expect(explanation.aggregation.excluded_components).toEqual([]);

    // No-signal risk is neutral+penalized (still included).
    expect(explanation.components.risk_assessment.status).toBe("penalized_non_ok");
    expect(explanation.components.risk_assessment.used_score).toBe(50);
    expect(explanation.components.risk_assessment.penalty).toBeGreaterThan(0);
    expect(explanation.components.risk_assessment.inverted_investment_score).toBe(50);
    expect(explanation.components.risk_assessment.notes.join("\n")).toMatch(/no_signal/i);

    // v2 decision scoring: metric_benchmark is diagnostic-only; aggregation uses financial_health + risk_assessment.
    // risk no-signal => neutral 50 - penalty(6) => 44
    // unadjusted = round((80*0.5 + 44*1)/1.5) = round(56) = 56
    expect(explanation.totals.unadjusted_overall_score).toBe(56);

    const expectedAdjusted = Math.round(
      (explanation.totals.unadjusted_overall_score as number) * explanation.totals.adjustment_factor
        + 50 * (1 - explanation.totals.adjustment_factor)
    );
    expect(explanation.totals.overall_score).toBe(expectedAdjusted);
  });

  it("traction-first pitch deck patterns do not affect v2 decision weights", () => {
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

    // v2: presentation weights are hard-zeroed.
    expect(normal.aggregation.weights.slide_sequence).toBe(0);
    expect(normal.aggregation.weights.narrative_arc).toBe(0);
    expect(normal.aggregation.weights.visual_design).toBe(0);
    expect(normal.aggregation.weights.metric_benchmark).toBe(0);

    expect(traction.aggregation.weights.slide_sequence).toBe(0);
    expect(traction.aggregation.weights.narrative_arc).toBe(0);
    expect(traction.aggregation.weights.visual_design).toBe(0);
    expect(traction.aggregation.weights.metric_benchmark).toBe(0);

    // v2 fundamentals-only scoring is driven by financial_health + risk_assessment.
    expect(traction.aggregation.weights.financial_health).toBeCloseTo(normal.aggregation.weights.financial_health);
    expect(traction.aggregation.weights.risk_assessment).toBeCloseTo(normal.aggregation.weights.risk_assessment);
  });

  it("v2: metric_benchmark is diagnostic-only and does not affect overall_score", () => {
    const now = new Date().toISOString();

    const mkDio = (metricScore: number): any => ({
      schema_version: "1.0.0",
      dio_id: "00000000-0000-4000-8000-000000000301",
      deal_id: "00000000-0000-4000-8000-000000000302",
      created_at: now,
      updated_at: now,
      analysis_version: 1,
      dio_context: {
        primary_doc_type: "pitch_deck",
        confidence: 1,
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
          features: { tavily_enabled: false, mcp_enabled: false, llm_synthesis_enabled: false },
          parameters: { max_cycles: 3, depth_threshold: 2, min_confidence: 0.7 },
        },
      },
      analyzer_results: {
        metric_benchmark: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 1,
          overall_score: metricScore,
          metrics_analyzed: [
            {
              metric: "ARR",
              value: 10,
              benchmark_value: 12,
              benchmark_source: "test",
              rating: "Adequate",
              deviation_pct: -16.7,
            },
          ],
        },
        financial_health: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 1,
          health_score: 80,
          metrics: { revenue: 10, expenses: 8, cash_balance: 20, burn_rate: 2, growth_rate: null },
          runway_months: 10,
          burn_multiple: 1,
          risks: [],
        },
        // Risk is inverted: 20 risk => 80 investment score.
        risk_assessment: {
          analyzer_version: "1.0.0",
          executed_at: now,
          status: "ok",
          coverage: 1,
          confidence: 1,
          overall_risk_score: 20,
          total_risks: 1,
          critical_count: 0,
          high_count: 0,
          risks_by_category: { market: [], team: [], financial: [], execution: [] },
          evidence_ids: [],
        },
        // Remaining analyzers are present but have no weight in v2.
        slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 1, score: 0, deviations: [] },
        visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 1, design_score: 0, strengths: [], weaknesses: [] },
        narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 1, confidence: 1, pacing_score: 0 },
      },
      risk_map: [{ severity: "low" }],
    });

    const lowMetric = buildScoreExplanationFromDIO(mkDio(0));
    const highMetric = buildScoreExplanationFromDIO(mkDio(100));

    // v2 effective weights: metric_benchmark is forced to 0.
    expect(lowMetric.aggregation.weights.metric_benchmark).toBe(0);
    expect(lowMetric.aggregation.weights.financial_health).toBeGreaterThan(0);
    expect(lowMetric.aggregation.weights.risk_assessment).toBeGreaterThan(0);

    // Metric score remains present as a diagnostic component.
    expect(lowMetric.components.metric_benchmark).toBeTruthy();
    expect(lowMetric.components.metric_benchmark.raw_score).toBe(0);
    expect(highMetric.components.metric_benchmark.raw_score).toBe(100);

    // And it must contribute nothing to the numeric aggregate.
    expect(lowMetric.components.metric_benchmark.weighted_contribution).toBe(0);
    expect(highMetric.components.metric_benchmark.weighted_contribution).toBe(0);

    // But overall score is unaffected by metric_benchmark changes.
    expect(lowMetric.totals.overall_score).toBe(highMetric.totals.overall_score);
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

    // v2: presentation weights are hard-zeroed.
    expect(explanation.aggregation.weights.slide_sequence).toBe(0);
    expect(explanation.aggregation.weights.visual_design).toBe(0);
    expect(explanation.aggregation.weights.narrative_arc).toBe(0);

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
