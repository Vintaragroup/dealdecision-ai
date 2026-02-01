import { inferCompanyPhaseV1 } from "../phase-inference";
import { evaluateFundabilityGatesV1 } from "../gates";

describe("fundability v1: phase inference + gates", () => {
  const now = new Date().toISOString();

  const mkBaseDio = (overrides: Partial<any> = {}): any => ({
    schema_version: "1.0.0",
    dio_id: "00000000-0000-4000-8000-000000000111",
    deal_id: "00000000-0000-4000-8000-000000000222",
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
    dio: {},
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
          debug_scoring: false,
        },
        parameters: {
          max_cycles: 3,
          depth_threshold: 2,
          min_confidence: 0.7,
        },
      },
    },
    analyzer_results: {
      financial_health: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 1,
        confidence: 0.8,
        runway_months: null,
        burn_multiple: null,
        health_score: 50,
        metrics: {
          revenue: null,
          expenses: null,
          cash_balance: null,
          burn_rate: null,
          growth_rate: null,
        },
        risks: [],
        evidence_ids: [],
      },
    },
    ...overrides,
  });

  it("infers PRE_SEED when roadmap + ICP + discovery evidence exists", () => {
    const dio = mkBaseDio({
      inputs: {
        documents: [
          {
            document_id: "00000000-0000-4000-8000-000000000333",
            title: "Pitch Deck",
            type: "pitch_deck",
            version_hash: "0".repeat(64),
            extracted_at: now,
            page_count: 12,
            metrics: [],
            headings: ["Roadmap", "ICP", "Customer discovery"],
            summary: "We ran customer interviews and refined our ICP.",
          },
        ],
        evidence: [],
        config: mkBaseDio().inputs.config,
      },
    });

    const inferred = inferCompanyPhaseV1(dio);
    expect(inferred.company_phase).toBe("PRE_SEED");
    expect(inferred.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("infers SEED_PLUS when growth + retention + unit economics + runway signals exist", () => {
    const dio = mkBaseDio({
      inputs: {
        documents: [
          {
            document_id: "00000000-0000-4000-8000-000000000333",
            title: "Metrics",
            type: "financials",
            version_hash: "0".repeat(64),
            extracted_at: now,
            page_count: 1,
            metrics: [{ name: "ARR", value: 100000, unit: "USD" }],
            headings: ["Retention", "Unit economics", "Runway"],
            summary: "MoM growth, churn down, gross margin improving; runway 18 months.",
          },
        ],
        evidence: [],
        config: mkBaseDio().inputs.config,
      },
      analyzer_results: {
        financial_health: {
          ...mkBaseDio().analyzer_results.financial_health,
          runway_months: 18,
          metrics: { ...mkBaseDio().analyzer_results.financial_health.metrics, growth_rate: 0.12, burn_rate: 50000 },
        },
      },
    });

    const inferred = inferCompanyPhaseV1(dio);
    expect(inferred.company_phase).toBe("SEED_PLUS");
  });

  it("applies low-confidence soft gate => CONDITIONAL (not FAIL)", () => {
    const dio = mkBaseDio();
    const inferred = inferCompanyPhaseV1(dio);

    expect(inferred.company_phase).toBe("IDEA");
    expect(inferred.confidence).toBeLessThan(0.65);

    const assessment = evaluateFundabilityGatesV1({ dio, phase_inference: inferred });
    expect(assessment.outcome).toBe("CONDITIONAL");
    expect(assessment.reasons.join(" ")).toContain("low_phase_confidence");
    expect(assessment.caps?.max_fundability_score_0_100).toBe(60);
  });
});
